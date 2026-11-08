// The Worker client: one fetch helper with a hard timeout (no spinner outlives it, Flow 6).
// Every endpoint the page calls is in plan.md § Worker endpoints; nothing else is called.

export function cfg() {
  const w = window;
  return {
    workerUrl: String(w.WORKER_URL || '').replace(/\/+$/, ''),
    links: w.PAYMENT_LINKS || {},
    portal: String(w.PORTAL_URL || ''),
    turnstileKey: String(w.TURNSTILE_SITE_KEY || ''),
    contact: String(w.CONTACT || ''),
    hub: String(w.HUB_URL || ''),
    preview: !!w.STUDIO_PREVIEW,
  };
}

// Page-wide facts other modules read (footer.js: the Restore label and the owner-code gate).
export const runtime = { status: null };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -> { ok, status, data, retryAfter, network }   (status 0 + network:true = unreachable/timeout)
export async function call(path, { method = 'GET', json, form, timeout = 15000 } = {}) {
  const base = cfg().workerUrl;
  if (!base) return { ok: false, status: 0, data: null, retryAfter: 0, network: true };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const init = { method, signal: ctl.signal, credentials: 'omit', cache: 'no-store' };
  if (json !== undefined) { init.body = JSON.stringify(json); init.headers = { 'content-type': 'application/json' }; }
  else if (form) init.body = form;
  try {
    const res = await fetch(base + path, init);
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    const ra = Number(res.headers.get('retry-after'));
    return { ok: res.ok, status: res.status, data, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : 0, network: false };
  } catch (e) {
    return { ok: false, status: 0, data: null, retryAfter: 0, network: true };
  } finally {
    clearTimeout(timer);
  }
}

// POST /verify with the page-side retries for transient failures (1 s, 3 s, 9 s; Flow 6d).
// 4xx answers are final and returned at once.
export async function verify(body, { retries = [1000, 3000, 9000], timeout = 15000 } = {}) {
  let r;
  for (let a = 0; a <= retries.length; a++) {
    r = await call('/verify', { method: 'POST', json: body, timeout });
    const transient = r.network || (r.status >= 500 && !(r.data && r.data.error === 'misconfigured'));
    if (!transient) return r;
    if (a < retries.length) await sleep(retries[a]);
  }
  return r;
}
