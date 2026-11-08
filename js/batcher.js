// POST /pages batcher (plan.md Flow 7-9): packs <= batch parts AND <= BATCH_BYTES of base64 per
// request, one request in flight, >= 5 s between one request's end and the next start (one KV
// write per batch), 3 attempts per page (waits 2 s, 6 s) on rate / provider / transport / 90 s timeout,
// honours retry_after (E25), never retries declined / done / 4xx (NOT READ, E26).
import { call, sleep } from './net.js';
import { BATCH_BYTES, PAGES_TIMEOUT_MS, PAGE_RETRY_MS, DEFAULT_RETRY_AFTER_S } from './limits.js';

const GAP_MS = 5000;
let lastEnd = 0;

// getPart(i) -> Promise<{field: 'p<i>' | 't<i>', value: string}> (built on demand, dropped once sent)
// onResult(i, {out, truncated}); onNotRead(i, reason, detail); onWait(seconds); onProgress()
// detail (R2): the Worker's provider reason, sent on owner tickets only; the last one seen per page
// -> {stop: null | 'ticket' | 'job', remaining: [indices not finished]}
export async function sendPages({ ticket, indices, batch, getPart, onResult, onNotRead, onWait, onProgress }) {
  const queue = indices.slice();
  const tries = new Map();
  const built = new Map();
  const detail = new Map();
  const fail = (i, reason, retryable) => {
    const n = (tries.get(i) || 0) + 1;
    tries.set(i, n);
    if (retryable && n < 3) { queue.push(i); return PAGE_RETRY_MS[n - 1]; } // 3 attempts per page (integrations.md)
    onNotRead(i, reason, detail.get(i) || null);
    return 0;
  };

  while (queue.length) {
    // pack by count AND bytes: parts are built (rasterised) on demand and kept only until sent
    const form = new FormData();
    form.append('ticket', ticket);
    const sent = [];
    let bytes = 0;
    while (queue.length && sent.length < batch) {
      const i = queue[0];
      let part = built.get(i);
      if (!part) {
        try { part = await getPart(i); } catch (e) { queue.shift(); onNotRead(i, 'raster'); continue; }
        built.set(i, part);
      }
      if (sent.length && bytes + part.value.length > BATCH_BYTES) break;
      queue.shift();
      bytes += part.value.length;
      form.append(part.field, part.value);
      sent.push(i);
    }
    if (!sent.length) continue;
    sent.forEach((i) => built.delete(i));

    const wait = GAP_MS - (Date.now() - lastEnd);
    if (wait > 0) await sleep(wait);
    const r = await call('/pages', { method: 'POST', form, timeout: PAGES_TIMEOUT_MS });
    lastEnd = Date.now();

    if (r.status === 401) return { stop: 'ticket', remaining: [...sent, ...queue] };
    if (r.status === 404) return { stop: 'job', remaining: [...sent, ...queue] };
    let delay = 0;
    if (r.status === 429) {
      const s = r.retryAfter || DEFAULT_RETRY_AFTER_S;
      onWait(s);
      sent.forEach((i) => fail(i, 'rate', true));
      delay = s * 1000;
    } else if (r.network || r.status >= 500) {
      sent.forEach((i) => { delay = Math.max(delay, fail(i, 'provider', true)); });
    } else if (!r.ok || !r.data || !Array.isArray(r.data.pages)) {
      // 400 batch/index/too-large/encoding/too-long, 409 done, 413: never for a legitimate page
      sent.forEach((i) => onNotRead(i, String((r.data && r.data.error) || r.status)));
    } else {
      const seen = new Set();
      let rateWait = 0;
      for (const pg of r.data.pages) {
        const i = Number(pg.i);
        if (!sent.includes(i) || seen.has(i)) continue;
        seen.add(i);
        if (pg.detail) detail.set(i, String(pg.detail).slice(0, 240)); else detail.delete(i);
        if (!pg.error) { onResult(i, { out: pg.out, truncated: !!pg.truncated, dry: !!pg.dry, owner: !!pg.owner }); continue; }
        if (pg.error === 'rate') { rateWait = Math.max(rateWait, Number(pg.retry_after) || DEFAULT_RETRY_AFTER_S); fail(i, 'rate', true); continue; }
        if (pg.error === 'provider') { delay = Math.max(delay, fail(i, 'provider', true)); continue; }
        onNotRead(i, pg.error, detail.get(i) || null); // invalid, declined, done
      }
      sent.forEach((i) => { if (!seen.has(i)) delay = Math.max(delay, fail(i, 'provider', true)); });
      if (rateWait) { onWait(rateWait); delay = Math.max(delay, rateWait * 1000); }
    }
    onProgress();
    if (delay && queue.length) await sleep(delay);
  }
  return { stop: null, remaining: [] };
}
