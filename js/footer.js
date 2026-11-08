// Footer (S9) on every page: Report a problem · Manage subscription · Restore purchase · Forget
// my purchases · Privacy · Terms · More tools. Panels expand in place (never a modal, never open
// on load), focus their first field, and Escape closes them and returns focus to the link.
import { T } from './copy.js';
import { cfg, runtime } from './net.js';
import { $, $$ } from './ui.js';
import { isSessionId, isOwnerCode, normaliseOwner } from './limits.js';
import { purchases, api } from './checkout.js';

let openBtn = null;

function panelOf(btn) { return document.getElementById(btn.getAttribute('aria-controls')); }

function close(btn, returnFocus) {
  if (!btn) return;
  btn.setAttribute('aria-expanded', 'false');
  const p = panelOf(btn);
  if (p) { p.hidden = true; p.dataset.state = 'closed'; }
  if (returnFocus) btn.focus();
  if (openBtn === btn) openBtn = null;
}

const hooks = {};

function open(btn) {
  if (openBtn && openBtn !== btn) close(openBtn, false);
  btn.setAttribute('aria-expanded', 'true');
  const p = panelOf(btn);
  p.hidden = false;
  p.dataset.state = 'open';
  openBtn = btn;
  const name = btn.dataset.panel;
  if (hooks[name]) hooks[name]();
  const first = p.querySelector('input, textarea, button, a[href]');
  if (first) first.focus();
}

export const kindWord = (kind) => (kind === 'plan' ? T.kindPlan() : kind === 'pack' ? T.kindPack() : T.kindOne());

function fmtReset(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
export { fmtReset };

// One handler for every code field (the footer Restore panel and, R1, the reviewer field in the
// price box): a purchase code is confirmed and stored; on a preview whose /status says owner: true
// a 12-character owner code is handed to app.js in memory (never stored; preview-only, CTO R1).
// -> {text, kind: 'ok' | 'error'}
export async function applyCode(raw) {
  const sid = String(raw || '').trim();
  const st = runtime.status || {};
  if (st.owner && !isSessionId(sid) && isOwnerCode(sid)) {
    window.dispatchEvent(new CustomEvent('sumline:owner', { detail: { code: normaliseOwner(sid) } }));
    const { R } = await import('./copy-r1.js');
    return { text: R.ownerEntered(), kind: 'ok' };
  }
  if (!isSessionId(sid)) return { text: T.E29(), kind: 'error' };
  const r = await api.confirm(sid);
  if (r.ok && r.data) {
    const d = r.data;
    purchases.add({ sid, kind: d.kind, restored: true });
    window.dispatchEvent(new CustomEvent('sumline:purchases'));
    return { text: d.kind === 'plan' ? T.restoredPlan(d.left, fmtReset(d.reset)) : d.kind === 'pack' ? T.restoredPack(d.left) : T.restoredOne(d.left > 0), kind: 'ok' };
  }
  const code = r.data && r.data.error;
  if (r.status === 400) return { text: T.E29(), kind: 'error' };
  if (r.status === 403 && code === 'inactive') return { text: T.E20(), kind: 'error' };
  if (r.status === 403) return { text: T.E17(), kind: 'error' };
  if (r.status === 429) return { text: T.E24(), kind: 'error' };
  return { text: T.E16restore(), kind: 'error' };
}

function initRestore(root) {
  const form = root.querySelector('form');
  const input = root.querySelector('[name="code"]');
  const label = root.querySelector('label');
  const out = root.querySelector('[data-role="result"]');
  const say = (t, kind) => { out.textContent = t; out.dataset.state = kind; out.setAttribute('role', kind === 'error' ? 'alert' : 'status'); };
  // R1: "Purchase or test code" only on a dry or owner preview
  const relabel = () => { const st = runtime.status || {}; label.textContent = st.mode === 'dry' || st.owner ? T.restoreLabelTest() : T.restoreLabel(); };
  window.addEventListener('sumline:status', relabel);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    const m = await applyCode(input.value);
    btn.disabled = false;
    say(m.text, m.kind);
    if (m.kind === 'ok') input.value = '';
  });
}

function initForget(root, btn) {
  const text = root.querySelector('[data-role="prompt"]');
  const yes = root.querySelector('[data-action="forget"]');
  const no = root.querySelector('[data-action="keep"]');
  const out = root.querySelector('[data-role="result"]');
  hooks.forget = () => {
    const n = purchases.list().length;
    text.textContent = n ? T.forgetPrompt(n) : T.forgetNone();
    yes.hidden = !n;
    out.textContent = '';
  };
  yes.addEventListener('click', () => {
    purchases.forget();
    out.textContent = T.forgotten();
    yes.hidden = true;
    window.dispatchEvent(new CustomEvent('sumline:purchases'));
  });
  no.addEventListener('click', () => close(btn, true));
}

export function initFooter() {
  const portal = cfg().portal;
  $$('[data-portal]').forEach((a) => { if (portal) a.href = portal; else a.closest('li').hidden = true; });
  for (const btn of $$('[data-panel]')) {
    btn.addEventListener('click', () => (btn.getAttribute('aria-expanded') === 'true' ? close(btn, true) : open(btn)));
    const p = panelOf(btn);
    if (!p) continue;
    p.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(btn, true); } });
    const name = btn.dataset.panel;
    if (name === 'report') {
      // bug.js (and Turnstile) load only when the form first opens (V-Q2, V5)
      let ready = null;
      hooks.report = () => { if (!ready) ready = import('./bug.js').then((m) => m.initBug(p)); ready.then((b) => b.onOpen()); };
    }
    if (name === 'restore') initRestore(p);
    if (name === 'forget') initForget(p, btn);
  }
  $$('[data-open-report]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openReport(); }));
}

// Error copy may link to the form (§ UX Report a problem): open it in the footer and go there.
export function openReport() {
  const b = $('[data-panel="report"]');
  if (!b) return;
  if (b.getAttribute('aria-expanded') !== 'true') open(b);
  b.scrollIntoView({ block: 'start' });
  const f = panelOf(b).querySelector('textarea');
  if (f) f.focus({ preventScroll: true });
}

// privacy.html / terms.html load this module alone.
if (document.body && document.body.dataset.page === 'static') initFooter();
