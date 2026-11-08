// R1 (revisions/round-1.md 1a, 3a, 3b; plan.md § Owner test path): the reviewer block under the
// greyed button (dry codes, owner code field), the OWNER TEST / DRY RUN banners and the owner
// start-error copy. Loaded only when /status reports mode "dry" or owner: true (preview-only, CTO R1).
// The owner code is kept in memory by app.js; it is never written to localStorage or the channel.
import { R } from './copy-r1.js';
import { h } from './ui.js';

export { R };

// opts: {dry, owner, onUse(code) -> Promise<{text, kind}>, msg: {text, kind} | null}
export function reviewerBlock(opts) {
  const lines = [h('p', { class: 'reviewer__head' }, h('strong', {}, R.reviewerHead()))];
  if (opts.owner) lines.push(h('p', { class: 'reviewer__owner' }, R.reviewerOwner()));
  if (opts.dry) {
    const codes = [];
    R.reviewerDryCodes().forEach(([code, what], k, all) => {
      codes.push(h('code', { class: 'reviewer__code' }, code), ` (${what})${k < all.length - 2 ? ', ' : k === all.length - 2 ? ' or ' : '.'}`);
    });
    lines.push(h('p', { class: 'reviewer__dry' }, R.reviewerDry(), codes, R.reviewerDryTail()));
  }
  const input = h('input', { id: 'reviewer-code', name: 'code', class: 'input input--mono', type: 'text', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', maxlength: '100' });
  const out = h('p', { class: 'reviewer__result', id: 'reviewer-result', 'aria-live': 'polite' });
  const say = (m) => { out.textContent = m ? m.text : ''; out.dataset.state = m ? m.kind : ''; if (m && m.kind === 'error') out.setAttribute('role', 'alert'); else out.removeAttribute('role'); };
  say(opts.msg);
  const form = h('form', { class: 'reviewer__form', novalidate: true },
    h('label', { for: 'reviewer-code' }, R.fieldLabel()), input,
    h('button', { type: 'submit', class: 'btn btn--block reviewer__use' }, R.useCode()), out);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = form.querySelector('button');
    b.disabled = true;
    const m = await opts.onUse(input.value);
    b.disabled = false;
    input.value = '';
    say(m);
    if (m && m.kind === 'ok') out.focus();
  });
  out.setAttribute('tabindex', '-1');
  return h('div', { class: 'reviewer', id: 'reviewer', dataset: { dry: opts.dry ? 'yes' : 'no', owner: opts.owner ? 'yes' : 'no' } }, lines, form);
}

// kind: 'owner' | 'dry'; mode: 'st' | 'rc'. Text, bordered, role="note", never animated.
export function banner(kind, mode) {
  if (kind === 'owner') return h('div', { class: 'run-banner run-banner--owner', role: 'note', dataset: { banner: 'owner' } }, h('p', {}, h('strong', {}, R.ownerBannerHead())), h('p', {}, R.ownerBannerBody()));
  return h('div', { class: 'run-banner run-banner--dry', role: 'note', dataset: { banner: 'dry' } }, h('p', {}, h('strong', {}, R.dryHead())), h('p', {}, mode === 'rc' ? R.dryBodyRc() : R.dryBodySt()));
}

// /verify owner errors (E33-E36) -> {code, text, lock}
export function ownerError(r, n) {
  const e = r.data && r.data.error;
  if (r.status === 401) return { code: 'E33', text: R.E33(), drop: true };
  if (r.status === 429 && r.data && r.data.scope === 'owner') return { code: 'E34', text: R.E34(), drop: true, lock: true };
  if (r.status === 409 && e === 'cap') {
    const d = r.data;
    return d.left > 0 ? { code: 'E35', text: R.ownerOver(n, d.left), left: d.left, cap: d.cap } : { code: 'E35', text: R.E35(d.cap, d.cap), left: 0, cap: d.cap };
  }
  if (r.status === 503) return { code: 'E36', text: R.E36(), drop: true };
  return null;
}
