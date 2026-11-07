// Report a problem (S9, build.bugs): the form expands in place from the footer, Turnstile is
// loaded and rendered only when it opens (V-Q2), "See exactly what we send" shows the literal
// values, POST /bug -> {id}. Never asks for files or rows.
import { T } from './copy.js';
import { cfg, call } from './net.js';
import { BUG_TIMEOUT_MS } from './limits.js';
import { purchases } from './checkout.js';

const TS_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__sumlineTurnstile';
let tsP = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!tsP) {
    tsP = new Promise((res, rej) => {
      window.__sumlineTurnstile = () => res(window.turnstile);
      const s = document.createElement('script');
      s.src = TS_SRC;
      s.async = true;
      s.onerror = () => { s.remove(); tsP = null; rej(new Error('turnstile')); };
      document.head.append(s);
    });
  }
  return tsP;
}

function facts() {
  return {
    page: (location.origin + location.pathname).slice(0, 300),
    ua: navigator.userAgent.slice(0, 400),
    session: purchases.latest().slice(0, 80),
  };
}

export function initBug(root) {
  const form = root.querySelector('form');
  const report = root.querySelector('[name="report"]');
  const email = root.querySelector('[name="email"]');
  const seeBtn = root.querySelector('[data-action="see"]');
  const seeOut = root.querySelector('[data-role="see"]');
  const tsBox = root.querySelector('[data-role="turnstile"]');
  const result = root.querySelector('[data-role="result"]');
  const send = root.querySelector('[type="submit"]');
  let widget = null;
  let token = '';

  const say = (text, kind) => {
    result.textContent = text;
    result.dataset.state = kind;
    result.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  };

  function renderSee() {
    const f = facts();
    seeOut.textContent = JSON.stringify({ report: report.value, email: email.value || null, page: f.page, ua: f.ua, session: f.session || null }, null, 2);
  }

  seeBtn.addEventListener('click', () => {
    const open = seeBtn.getAttribute('aria-expanded') !== 'true';
    seeBtn.setAttribute('aria-expanded', String(open));
    seeOut.hidden = !open;
    if (open) renderSee();
  });
  report.addEventListener('input', () => { if (!seeOut.hidden) renderSee(); });
  email.addEventListener('input', () => { if (!seeOut.hidden) renderSee(); });

  function onOpen() {
    if (widget !== null) return;
    widget = 'loading';
    loadTurnstile().then((ts) => {
      widget = ts.render(tsBox, {
        sitekey: cfg().turnstileKey,
        callback: (t) => { token = t; },
        'expired-callback': () => { token = ''; },
        'error-callback': () => { token = ''; },
      });
    }).catch(() => { widget = null; });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!report.value.trim()) { report.focus(); say(T.bugRequired(), 'error'); return; }
    if (!token) { say(widget === null || widget === 'loading' || window.turnstile ? T.bugWait() : T.bug403(), 'error'); return; }
    send.disabled = true;
    const f = facts();
    const body = { turnstile: token, report: report.value.slice(0, 2000), page: f.page, ua: f.ua };
    if (email.value.trim()) body.email = email.value.trim().slice(0, 200);
    if (f.session) body.session = f.session;
    const r = await call('/bug', { method: 'POST', json: body, timeout: BUG_TIMEOUT_MS });
    send.disabled = false;
    token = '';
    if (window.turnstile && widget && widget !== 'loading') { try { window.turnstile.reset(widget); } catch (x) { /* gone */ } }
    if (r.ok && r.data && r.data.id) {
      report.value = '';
      email.value = '';
      if (!seeOut.hidden) renderSee();
      say(T.bugSent(String(r.data.id)), 'ok');
      result.setAttribute('tabindex', '-1');
      result.focus();
      return;
    }
    if (r.status === 429) say(r.data && r.data.scope === 'all' ? T.bug429all() : T.bug429(), 'error');
    else if (r.status === 403) say(T.bug403(), 'error');
    else say(T.bugNetwork(), 'error');
  });

  return { onOpen };
}
