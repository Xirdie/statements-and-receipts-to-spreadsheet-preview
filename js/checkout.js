// Checkout hop (D5, G1) and the purchase codes: the Payment Link opens in a new tab from inside
// the click handler (a null return -> E12, then the same tab goes to Stripe after 2 s); the
// return path is BroadcastChannel('sumline') AND localStorage (storage event + a
// visibilitychange re-read for iOS); the ack / claimed protocol (U1); the /verify client
// (confirm | start | rerun | reissue); Restore / Forget (S8). Purchase codes only, never rows.
import { LS_PURCHASES, CHANNEL, LINK_OF_KIND, POPUP_FALLBACK_MS, isSessionId } from './limits.js';
import { cfg, verify } from './net.js';
import { goal } from './analytics.js';

// ---------- purchase codes in this browser ----------
function read() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_PURCHASES) || '[]');
    return Array.isArray(v) ? v.filter((p) => p && isSessionId(p.sid)) : [];
  } catch (e) { return []; }
}
function write(list) {
  try { localStorage.setItem(LS_PURCHASES, JSON.stringify(list.slice(-20))); return true; } catch (e) { return false; }
}

export const purchases = {
  list: read,
  get: (sid) => read().find((p) => p.sid === sid) || null,
  // restored: true marks a Restore / "Use code" as the newest code (R1: it drives the main CTA)
  add({ sid, kind, at, restored }) {
    let list = read();
    const old = list.find((p) => p.sid === sid);
    if (old) {
      if (kind) old.kind = kind;
      if (restored) { old.at = new Date().toISOString(); list = list.filter((p) => p !== old).concat(old); }
    } else list.push({ sid, kind: kind || null, at: at || new Date().toISOString() });
    write(list);
  },
  claim(sid) {
    const list = read();
    const p = list.find((x) => x.sid === sid);
    if (p) p.claimed = true; else list.push({ sid, kind: null, at: new Date().toISOString(), claimed: true });
    write(list);
  },
  forget() { try { localStorage.removeItem(LS_PURCHASES); } catch (e) { /* blocked */ } },
  latest() { const l = read(); return l.length ? l[l.length - 1].sid : ''; },
};

// ---------- the channel ----------
let bc = null;
const handlers = new Set();
export function channel() {
  if (!bc && 'BroadcastChannel' in window) {
    bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = (e) => handlers.forEach((fn) => fn(e.data || {}));
  }
  return bc;
}
export function onChannel(fn) { channel(); handlers.add(fn); return () => handlers.delete(fn); }
export function post(msg) { const c = channel(); if (c) c.postMessage(msg); }

// ---------- checkout ----------
export function linkFor(kind) { return String((cfg().links || {})[LINK_OF_KIND[kind]] || ''); }

// Must run synchronously inside the click handler (a user gesture). Returns 'tab' | 'same' | 'none'.
export function openCheckout(kind, onBlocked) {
  const link = linkFor(kind);
  if (!link) return 'none';
  goal('checkout', kind);
  const w = window.open(link, '_blank');
  if (w) { try { w.opener = null; } catch (e) { /* cross-origin */ } return 'tab'; }
  onBlocked(() => { location.href = link; });
  setTimeout(() => { location.href = link; }, POPUP_FALLBACK_MS);
  return 'same';
}

// ---------- /verify ----------
export const api = {
  confirm: (sid) => verify({ session_id: sid }),
  start: (sid, job, reissue = false) => verify(reissue ? { session_id: sid, job, reissue: true } : { session_id: sid, job }),
  rerun: (ticket, ix) => verify({ ticket, rerun: ix }),
  // R1: the owner shape (plan.md § Worker endpoints); the code goes only to /verify
  owner: (code, job, reissue = false) => verify(reissue ? { owner_code: code, job, reissue: true } : { owner_code: code, job }),
};
