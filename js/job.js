// The job model: which pages go where (index space 0..n-1 images, n..n+t-1 text-fallback
// pages; plan.md § Token), the free preview (column parser + chain on text pages), the AI
// results folded back into statements/receipts, the chain re-run (reconcile.js, the one
// shared copy), the rerun list (image pages only, D9) and the output rows.
import { reconcileStatement, checkReceipt } from './reconcile.js';
// column-parser.js runs in its Web Worker; the main thread loads it only for AI dates and the
// no-Worker fallback (keeps it out of the first view, V5).
let CP = null;
export async function loadParser() { if (!CP) CP = await import('./column-parser.js'); return CP; }
import { TEXT_PAGE_CHARS, TEXT_ALLOWANCE } from './limits.js';

export const CHECK_NOT_READ = 'NOT READ';
export const CHECK_TOO_LONG = 'FLAGGED: too long for the AI re-read'; // CFO O1, verbatim
const T_MAX = Math.min(TEXT_ALLOWANCE.one, TEXT_ALLOWANCE.pack, TEXT_ALLOWANCE.plan);

// ---------- the parser Web Worker (one message in flight; main-thread fallback) ----------
let worker = null;
let chain = Promise.resolve();
function parse(pages) {
  const run = () => new Promise((resolve) => {
    try {
      if (!worker) worker = new Worker(new URL('./column-parser.js', import.meta.url), { type: 'module' });
    } catch (e) { worker = null; }
    if (!worker) { resolve(safeParse(pages)); return; }
    const onMsg = (e) => { worker.removeEventListener('message', onMsg); worker.removeEventListener('error', onErr); resolve(e.data && e.data.ok ? e.data.statement : null); };
    const onErr = (e) => { if (e && e.preventDefault) e.preventDefault(); worker.removeEventListener('message', onMsg); worker.removeEventListener('error', onErr); try { worker.terminate(); } catch (x) { /* gone */ } worker = null; resolve(safeParse(pages)); };
    worker.addEventListener('message', onMsg);
    worker.addEventListener('error', onErr);
    worker.postMessage({ pages });
  });
  const p = chain.then(run);
  chain = p.catch(() => {});
  return p;
}
async function safeParse(pages) { try { return (await loadParser()).parseStatement(pages); } catch (e) { return null; } }

// ---------- dates from the AI (printed form -> ISO by code; the model never invents a year) ----------
export function normDate(raw, fmt, periodText, fallbackYear) {
  if (raw === null || raw === undefined || raw === '') return '';
  const m = CP ? CP.matchDate(String(raw).trim()) : null;
  if (!m) return String(raw);
  let mo, d;
  if (m.kind === 'iso') { mo = m.a; d = m.b; }
  else if (m.kind === 'dmon') { mo = m.b; d = m.a; }
  else if (m.kind === 'mond') { mo = m.a; d = m.b; }
  else if (String(fmt || '').toUpperCase() === 'DMY' || m.a > 12) { mo = m.b; d = m.a; }
  else { mo = m.a; d = m.b; }
  let y = m.y;
  if (!y) {
    const ys = String(periodText || '').match(/\b(19|20)\d{2}\b/g);
    y = ys ? Number(ys[ys.length === 2 && mo >= 7 ? 0 : ys.length - 1]) : (fallbackYear || new Date().getFullYear());
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return String(raw);
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// ---------- build ----------
// files: intake records in state 'ok'. mode: 'st' | 'rc'.
export async function buildJob(mode, files) {
  const job = { mode, units: [], index: [], n: 0, t: 0, textPages: 0, scanPages: 0, tooLong: 0, overAllowance: 0 };
  const img = [];
  const txt = [];
  for (const rec of files) {
    if (mode === 'rc') {
      for (const p of rec.pages) {
        const u = { type: 'rc', rec, name: rec.name, page: p.page, isText: p.isText, out: null, notRead: false, reread: false, tooLong: false, idx: null };
        job.units.push(u);
        if (p.isText) {
          job.textPages++;
          if (p.chars > TEXT_PAGE_CHARS) { u.tooLong = true; job.tooLong++; } else txt.push({ unit: u, page: p });
        } else { job.scanPages++; img.push({ unit: u, page: p }); }
      }
      continue;
    }
    const u = { type: 'st', rec, name: rec.name, pages: [], parsed: null, preview: null, result: null };
    job.units.push(u);
    const textPages = rec.pages.filter((p) => p.isText);
    if (textPages.length) {
      u.parsed = await parse(textPages.map((p) => ({ page: p.page, items: p.items })));
    }
    const parsedByPage = new Map(((u.parsed && u.parsed.pages) || []).map((pp) => [pp.page, pp]));
    for (const p of rec.pages) {
      const pp = parsedByPage.get(p.page);
      u.pages.push({
        page: p.page, isText: p.isText, src: p.isText ? 'parser' : null,
        rows: pp ? pp.rows : [], opening: pp ? pp.opening : null, closing: pp ? pp.closing : null,
        chars: p.chars, idx: null, kind: null, tooLong: false, overAllowance: false, notRead: false, reread: false,
        truncated: false, schemaError: false, hasTransactions: undefined, out: null, thumb: p.thumb,
      });
      if (p.isText) job.textPages++; else job.scanPages++;
    }
    // free preview: the chain over the text pages alone
    if (u.parsed) {
      const tp = u.pages.filter((p) => p.isText);
      const res = reconcileStatement({ kind: u.parsed.kind, opening: u.parsed.opening, closing: u.parsed.closing, summary: u.parsed.summary, pages: tp.map(chainPage) });
      u.preview = { result: res, rows: [], needAi: 0, noRows: [] };
      let k = 0;
      tp.forEach((p) => p.rows.forEach((r) => { const c = res.rows[k++]; u.preview.rows.push({ page: p.page, ...r, check: c ? c.check : '' }); }));
      u.preview.reasons = [];
      if (res.failed) {
        const failed = new Set(res.failedPages);
        for (const p of tp) {
          if (!failed.has(p.page) && p.rows.length) continue;
          if (!p.rows.length) u.preview.noRows.push(p.page);
          u.preview.needAi += p.rows.length;
          if (p.chars > TEXT_PAGE_CHARS) { p.tooLong = true; job.tooLong++; } else txt.push({ unit: u, page: p });
        }
        u.preview.rows.forEach((r) => { if (String(r.check).startsWith('FLAGGED') && u.preview.reasons.length < 3) u.preview.reasons.push({ page: r.page, reason: r.check.replace(/^FLAGGED: /, ''), tooLong: !!(tp.find((x) => x.page === r.page) || {}).tooLong }); });
      }
    }
    for (const p of u.pages) if (!p.isText) img.push({ unit: u, page: p });
  }
  // index space: images first, then text-fallback pages (at most the smallest text allowance)
  img.forEach((e, i) => { const target = e.unit.type === 'rc' ? e.unit : e.page; target.idx = i; target.kind = 'img'; job.index[i] = { ...e, kind: 'img' }; });
  job.n = img.length;
  txt.forEach((e, k) => {
    const target = e.unit.type === 'rc' ? e.unit : e.page;
    if (k >= T_MAX) { target.overAllowance = true; job.overAllowance++; return; }
    const i = job.n + k;
    target.idx = i; target.kind = 'text';
    job.index[i] = { ...e, kind: 'text' };
  });
  job.t = job.index.length - job.n;
  return job;
}

function chainPage(p) {
  return { page: p.page, rows: p.rows, opening: p.opening, closing: p.closing, truncated: p.truncated, schemaError: p.schemaError, hasTransactions: p.hasTransactions };
}

// The part body for index i: {kind: 'img', rec, page} or {kind: 'text', text}.
export function partOf(job, i) {
  const e = job.index[i];
  if (!e) return null;
  if (e.kind === 'text') {
    const fp = e.unit.rec.pages.find((p) => p.page === (e.unit.type === 'rc' ? e.unit.page : e.page.page));
    return { kind: 'text', text: fp ? fp.text : '' };
  }
  return { kind: 'img', rec: e.unit.rec, page: e.unit.type === 'rc' ? e.unit.page : e.page.page };
}

// ---------- results ----------
export function applyResult(job, i, res, model) {
  const e = job.index[i];
  if (!e) return;
  const target = e.unit.type === 'rc' ? e.unit : e.page;
  const out = res && res.out;
  target.notRead = false;
  target.notReadDetail = null;
  target.notReadRefused = null;
  target.dry = !!(res && res.dry); // R1 3b: the Worker's own word, never a guess
  if (model === 's') target.reread = true;
  if (e.unit.type === 'rc') { target.out = out && typeof out === 'object' ? out : null; target.truncated = !!res.truncated; return; }
  const ok = out && typeof out === 'object' && Array.isArray(out.rows);
  target.out = ok ? out : null;
  target.schemaError = !ok;
  target.truncated = !!res.truncated;
  target.hasTransactions = ok ? out.has_transactions : undefined;
  target.src = 'ai';
  const period = ok ? out.statement_period : '';
  const fy = e.unit.parsed && e.unit.parsed.period ? Number(String(e.unit.parsed.period.end).slice(0, 4)) : undefined;
  target.rows = ok ? out.rows.map((r) => ({ date: normDate(r.d, out.date_format, period, fy), desc: r.t == null ? '' : String(r.t), amount: num(r.a) ?? 0, balance: num(r.b) })) : [];
  if (target.isText) { target.opening = null; target.closing = null; }
}

// detail: the owner-test reason text; refused: {code, fields, scope} when the Worker refused it (R3)
export function markNotRead(job, i, detail = null, refused = null) {
  const e = job.index[i];
  if (!e) return;
  const target = e.unit.type === 'rc' ? e.unit : e.page;
  if (target.reread || target.out || target.src === 'ai') return; // a later re-read failing keeps the first read
  if (e.unit.type === 'st' && target.isText) return; // a text page keeps its parsed rows; it stays flagged by the chain (D9)
  target.notRead = true;
  target.notReadDetail = detail; // R2: shown only on an owner test
  target.notReadRefused = refused;
}

// Re-runs the chain over everything; returns the job summary.
export function finalise(job) {
  const sum = { statements: 0, receipts: 0, flaggedRows: 0, notReadPages: [], rerun: [], flaggedReceipts: 0, okReceipts: 0 };
  for (const u of job.units) {
    if (u.type === 'rc') {
      sum.receipts++;
      if (u.notRead) { sum.notReadPages.push({ name: u.name, page: u.page }); u.row = null; continue; }
      const o = u.out || {};
      const row = {
        date: normDate(o.date, o.date_format), vendor: o.vendor ?? '', subtotal: num(o.subtotal), tax: num(o.tax), tip: num(o.tip), total: num(o.total),
        currency: o.currency ?? '', payment: o.payment ?? '', card_last4: o.card_last4 ?? '', category: o.category_suggestion ?? '',
      };
      const c = u.tooLong || u.overAllowance ? { failed: true, check: u.tooLong ? CHECK_TOO_LONG : 'FLAGGED: over the AI re-read allowance', note: '' }
        : (u.out ? checkReceipt(row) : { failed: true, check: 'FLAGGED: page output failed validation', note: '' });
      u.row = row; u.check = c;
      if (c.failed) { sum.flaggedReceipts++; if (u.kind === 'img' && !u.reread && u.out) sum.rerun.push(u.idx); } else sum.okReceipts++;
      continue;
    }
    sum.statements++;
    const live = u.pages.filter((p) => !p.notRead && (p.isText || p.src === 'ai'));
    const ai = u.pages.filter((p) => p.src === 'ai' && p.out);
    const anyBal = live.some((p) => p.rows.some((r) => r.balance !== null && r.balance !== undefined));
    const aiSummary = (ai.find((p) => p.out.summary) || {}).out;
    const parsed = u.parsed || {};
    const st = {
      kind: parsed.kind === 'card' || (!anyBal && aiSummary && aiSummary.summary) ? 'card' : 'bank',
      opening: parsed.opening ?? (ai.length ? num(ai[0].out.opening_balance) : null),
      closing: parsed.closing ?? (ai.length ? num(ai[ai.length - 1].out.closing_balance) : null),
      summary: parsed.summary || (aiSummary ? aiSummary.summary : null),
      pages: live.map(chainPage),
    };
    u.result = live.length ? reconcileStatement(st, { reread: u.pages.filter((p) => p.reread).map((p) => p.page) }) : null;
    u.notRead = u.pages.filter((p) => p.notRead).map((p) => p.page);
    u.notRead.forEach((pg) => sum.notReadPages.push({ name: u.name, page: pg }));
    if (u.result) {
      sum.flaggedRows += u.result.flaggedRows;
      const failed = new Set(u.result.failedPages);
      u.pages.forEach((p) => { if (failed.has(p.page) && p.kind === 'img' && !p.reread && !p.notRead) sum.rerun.push(p.idx); });
    }
  }
  sum.rerun.sort((a, b) => a - b);
  job.summary = sum;
  return sum;
}

// Output rows (the CSV/XLSX Transactions sheet and the on-page table), in file and page order.
// labels (R1): {owner: 'owner test'} adds the note to every row; {dry: '…'} to every row read from a dry page
export function outputRows(job, labels = {}) {
  const rows = rawRows(job);
  // R2: an owner test's NOT READ row carries the provider's reason after the label
  if (labels.owner) rows.forEach((r) => { const why = r.notRead && labels.notRead ? labels.notRead(r) : r.note; r.note = why ? `${labels.owner}; ${why}` : labels.owner; });
  if (labels.dry) rows.forEach((r) => { if (r.dry) r.note = r.note ? `${labels.dry}; ${r.note}` : labels.dry; });
  return rows;
}

function rawRows(job) {
  const rows = [];
  for (const u of job.units) {
    if (u.type === 'rc') {
      if (u.notRead) { rows.push({ file: u.name, image: u.page, check: CHECK_NOT_READ, notRead: true, detail: u.notReadDetail || null, refused: u.notReadRefused || null }); continue; }
      rows.push({ file: u.name, image: u.page, ...(u.row || {}), check: u.check ? u.check.check : 'unreconciled', note: u.check ? u.check.note : '', dry: !!u.dry });
      continue;
    }
    const checks = (u.result && u.result.rows) || [];
    let k = 0;
    for (const p of u.pages) {
      if (p.notRead) { rows.push({ file: u.name, page: p.page, check: CHECK_NOT_READ, notRead: true, detail: p.notReadDetail || null, refused: p.notReadRefused || null }); continue; }
      if (!(p.isText || p.src === 'ai')) continue;
      const pageRows = [];
      for (const r of p.rows) {
        const c = checks[k++] || { check: 'unreconciled' };
        const amt = Number(r.amount) || 0;
        pageRows.push({ file: u.name, page: p.page, date: r.date, description: r.desc, debit: amt < 0 ? -amt : null, credit: amt > 0 ? amt : null, amount: amt, balance: r.balance ?? null, check: c.check, note: '', dry: !!p.dry });
      }
      if (p.tooLong || p.overAllowance) {
        const label = p.tooLong ? CHECK_TOO_LONG : 'FLAGGED: over the AI re-read allowance';
        const failedHere = u.result && u.result.failedPages.includes(p.page);
        let marked = false;
        pageRows.forEach((r) => { if (r.check.startsWith('FLAGGED')) { r.note = r.check.replace(/^FLAGGED: /, ''); r.check = label; marked = true; } });
        if (!marked && failedHere) { if (pageRows.length) { pageRows[0].note = pageRows[0].check; pageRows[0].check = label; } else pageRows.push({ file: u.name, page: p.page, check: label, note: '' }); }
      }
      rows.push(...pageRows);
    }
  }
  return rows;
}
