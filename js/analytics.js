// Cloudflare Web Analytics goals as virtual page views (integrations.md § Cloudflare, Web
// Analytics): the beacon tracks history.pushState, so goal() pushes a virtual path and restores
// the real URL at once. The beacon records the path only (it drops the query string), so the
// landing utm_* travel as path segments (qa #4):
//   <base>/goal/<checkout|paid|download>/<one|pack|plan>[/<utm_source>/<utm_medium>/<utm_campaign>]
// each segment lower-cased, [a-z0-9._-] only, <= 40 chars, "-" when absent; no segments when the
// landing URL had no utm_*. The path is absolute, built from the page's own URL (qa #8: the
// beacon's pushState patch resolves it without a base), so it stays under /<slug>/.
import { SS_UTM } from './limits.js';

const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

export function captureUtm() {
  try {
    const q = new URLSearchParams(location.search);
    const keep = new URLSearchParams();
    UTM.forEach((k) => { const v = q.get(k); if (v) keep.set(k, v.slice(0, 200)); });
    if ([...keep.keys()].length) sessionStorage.setItem(SS_UTM, keep.toString());
  } catch (e) { /* storage blocked: goals go without utm */ }
}

export function utmQuery() {
  try { return sessionStorage.getItem(SS_UTM) || ''; } catch (e) { return ''; }
}

const seg = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || '-';

export function goalPath(type, kind, href = location.href, utm = utmQuery()) {
  const q = new URLSearchParams(utm);
  const parts = ['goal', type, kind];
  if (q.get('utm_source') || q.get('utm_medium') || q.get('utm_campaign')) parts.push(seg(q.get('utm_source')), seg(q.get('utm_medium')), seg(q.get('utm_campaign')));
  return new URL('./' + parts.join('/'), href).pathname;
}

// type: checkout | paid | download; kind: one | pack | plan
export function goal(type, kind) {
  if (!/^(checkout|paid|download)$/.test(type) || !/^(one|pack|plan)$/.test(kind)) return;
  const here = location.href;
  try {
    history.pushState(history.state, '', goalPath(type, kind));
    history.replaceState(history.state, '', here);
  } catch (e) { /* history blocked */ }
}

// index.html only: the beacon is injected here, not as a static tag, because the product root
// is also Stripe's return URL (D5) and its forwarder must stop the page before any third-party
// script is even fetched. config.js ANALYTICS_TOKEN "" (as /preview writes it) means no beacon.
export function loadBeacon() {
  const token = String(window.ANALYTICS_TOKEN || '');
  if (!/^[0-9a-f]{32}$/.test(token) || document.querySelector('script[data-cf-beacon]')) return;
  const s = document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.setAttribute('data-cf-beacon', JSON.stringify({ token }));
  document.body.append(s);
}
