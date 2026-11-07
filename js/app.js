// Sumline page state machine (S1-S9): input -> reading -> preview -> checkout -> running ->
// done | failed, on index.html, the SEO pages and paid.html (data-page="paid": S5, then the
// tool when no other tab answers within 2 s). Every visible string comes from copy.js (T).
// Polish hooks: #tool[data-state], .phase[data-phase], .recon / .chip / .row--flagged /
// .row--notread / .pay-panel / .disclosure class names; no animation lives here.
import { T } from './copy.js';
import * as L from './limits.js';
import { cfg, call, sleep } from './net.js';
import { $, h, clear, show, focusHeading, reducedMotion } from './ui.js';
import { captureUtm, goal, loadBeacon } from './analytics.js';
import { prefetchPdfjs } from './pdf-text.js';
import { createIntake, jobHash } from './input.js';
import { buildJob, partOf, applyResult, markNotRead, finalise, outputRows, loadParser } from './job.js';
import { rasterise, toBase64 } from './raster.js';
import { fmtCents } from './reconcile.js';
// loaded when a paid job starts / on Download (keeps them out of the first view, V5)
const lazyBatcher = () => import('./batcher.js');
const lazyOutput = () => import('./output.js');
import { purchases, onChannel, post, openCheckout, linkFor, api } from './checkout.js';
import { initFooter, kindWord, fmtReset, openReport } from './footer.js';

const body = document.body;
const PAGE = body.dataset.page; // 'tool' | 'paid'
const tool = $('#tool');

const S = {
  mode: body.dataset.modeDefault === 'rc' ? 'rc' : 'st',
  status: { state: 'unknown', batch: L.MAX_BATCH_DEFAULT, mode: 'live' },
  job: null, version: 0, building: false,
  selected: null, touched: false, packShown: false, buyOther: false,
  owned: null, ownedLoading: false,
  pending: null, // {kind, at} after a checkout click in this tab
  hiddenSince: false,
  paid: null,    // paid.html: {sid, kind, cap, left, reset}
  run: null,     // {sid, kind, ticket, left, cap, reset, rerunDone, finishTried, models:Set, startedAt, pagesDone}
  fmt: 'xlsx', downloaded: false, rows: null,
};

const els = {
  file: $('#file-input'), drop: $('#dropzone'), status: $('#read-status'), photo: $('#photo-note'),
  alerts: $('#intake-alerts'), list: $('#file-list'),
  preview: $('#preview'), previewH: $('#preview-h'), cards: $('#cards'), scans: $('#scans'), scanCounts: $('#scan-counts'),
  thumbs: $('#thumbs'), jobAlerts: $('#job-alerts'), price: $('#pricebox'), pay: $('#pay-panel'),
  run: $('#run'), runH: $('#run-h'), runBody: $('#run-body'),
};

const setState = (s) => { if (tool) tool.dataset.state = s; };
const stateIs = (...s) => tool && s.includes(tool.dataset.state);

// ---------------------------------------------------------------- intake
const intake = tool ? createIntake({
  listEl: els.list, statusEl: els.status, alertEl: els.alerts,
  onChange: () => scheduleBuild(),
  onPhoto: () => { if (S.mode === 'st') show(els.photo, true); },
}) : null;

function wireInput() {
  els.file.addEventListener('change', () => { if (els.file.files.length) intake.add(els.file.files); els.file.value = ''; });
  const zone = els.drop;
  const on = (e) => { e.preventDefault(); zone.dataset.drag = 'on'; };
  const off = () => { zone.dataset.drag = 'off'; };
  zone.addEventListener('dragenter', on);
  zone.addEventListener('dragover', on);
  zone.addEventListener('dragleave', off);
  zone.addEventListener('drop', (e) => { e.preventDefault(); off(); if (!stateIs('input', 'preview')) return; if (e.dataTransfer && e.dataTransfer.files.length) intake.add(e.dataTransfer.files); });
  for (const r of tool.querySelectorAll('input[name="doctype"]')) {
    r.checked = r.value === S.mode;
    r.addEventListener('change', () => { if (!r.checked) return; setMode(r.value); });
  }
  setMode(S.mode);
}

function setMode(m) {
  S.mode = m === 'rc' ? 'rc' : 'st';
  tool.dataset.mode = S.mode;
  tool.querySelectorAll('[data-for]').forEach((el) => { el.hidden = el.dataset.for !== S.mode; });
  if (S.mode === 'rc') show(els.photo, false);
  scheduleBuild();
}

function lockInput(on) {
  tool.querySelectorAll('input[name="doctype"]').forEach((r) => { r.disabled = on; });
  els.file.disabled = on;
}

// ---------------------------------------------------------------- job build + preview
let buildTimer = null;
function scheduleBuild() {
  if (!intake || !stateIs('input', 'reading', 'preview', 'checkout')) return;
  clearTimeout(buildTimer);
  buildTimer = setTimeout(rebuild, 60);
}

async function rebuild() {
  const v = ++S.version;
  const ready = intake.ready();
  if (intake.busy) { setState(ready.length || intake.files.length ? 'reading' : 'input'); renderPreview(); return; }
  if (!ready.length) { S.job = null; setState('input'); renderPreview(); return; }
  S.building = true;
  const job = await buildJob(S.mode, ready);
  if (v !== S.version) return;
  S.building = false;
  const first = !S.job;
  S.job = job;
  if (!S.touched) S.selected = null;
  if (stateIs('checkout')) { renderPreview(); return; }
  setState('preview');
  renderPreview();
  if (first) focusHeading(els.previewH);
  loadOwned();
}

function chip(status, n) {
  const word = status === 'reconciled' ? T.chipReconciled() : status === 'flagged' ? T.chipFlagged(n) : T.chipUnreconciled();
  return h('span', { class: `chip chip--${status}`, dataset: { status } }, h('span', { class: 'chip__glyph', 'aria-hidden': 'true' }), h('span', { class: 'chip__word' }, word));
}

// S7: the reconciliation line for one statement result.
function reconBlock(res) {
  if (!res) return h('p', { class: 'recon recon--empty small muted' }, T.lineNoBalance());
  if (res.status === 'unreconciled') {
    const c = (res.checks || []).find((x) => x.name === 'charges' || x.name === 'debits');
    const text = c ? T.lineCard(fmtCents(c.rows), fmtCents(c.printed), c.ok, fmtCents(Math.abs(c.rows - c.printed)), c.name) : T.lineNoBalance();
    return h('div', { class: 'recon recon--text', dataset: { status: 'unreconciled', failed: res.failed ? 'yes' : 'no' } }, h('p', {}, text), h('p', { class: 'recon__status' }, chip('unreconciled')));
  }
  const l = res.line;
  const off = l.diff ? fmtCents(Math.abs(l.diff)) : '';
  const term = (cls, label, val) => h('div', { class: `recon__term ${cls}` }, h('dt', {}, label), h('dd', {}, val));
  return h('div', { class: 'recon', dataset: { status: res.status } },
    h('p', { class: 'visually-hidden' }, T.srLine(fmtCents(l.opening), fmtCents(l.credits), fmtCents(l.debits), fmtCents(l.computed), l.printed === null ? '' : fmtCents(l.printed), res.status, off)),
    h('dl', { class: 'recon__line', 'aria-hidden': 'true' },
      term('recon__term--opening', T.lnOpening(), fmtCents(l.opening)),
      term('recon__term--plus', T.lnCredits(), fmtCents(l.credits)),
      term('recon__term--minus', T.lnDebits(), fmtCents(l.debits)),
      term('recon__term--total', T.lnComputed(), fmtCents(l.computed)),
      term('recon__term--printed', T.lnPrinted(), l.printed === null ? T.lnNotPrinted() : fmtCents(l.printed))),
    h('p', { class: 'recon__status' }, chip(res.status, res.flaggedRows), off ? h('span', { class: 'recon__off' }, T.lnOffBy(off)) : null));
}

function rowsTable(rows, caption, opts = {}) {
  const head = opts.full
    ? ['file', 'page', 'date', 'description', 'debit', 'credit', 'amount', 'balance', 'check']
    : ['date', 'description', 'amount', 'balance'];
  const th = (k) => h('th', { scope: 'col', class: `col-${k}` }, T['col_' + k]());
  const tb = h('tbody');
  let lastFile = null;
  for (const r of rows) {
    if (opts.full && r.file !== lastFile) { lastFile = r.file; tb.append(h('tr', { class: 'row--group' }, h('th', { scope: 'rowgroup', colspan: String(head.length) }, r.file))); }
    const flagged = r.check && String(r.check).startsWith('FLAGGED');
    const notRead = r.check === 'NOT READ';
    const tr = h('tr', { class: flagged ? 'row--flagged' : notRead ? 'row--notread' : null });
    for (const k of head) {
      let v = r[k === 'description' ? (r.description !== undefined ? 'description' : 'desc') : k];
      if (['debit', 'credit', 'amount', 'balance'].includes(k)) v = v === null || v === undefined || v === '' ? '' : fmtCents(Math.round(Number(v) * 100));
      if (notRead && k === 'description') v = T.notReadRow(r.page);
      const cell = h('td', { class: `col-${k}` }, v === undefined ? '' : String(v));
      if (k === 'description' && r.check && r.check !== 'ok' && !notRead) cell.append(h('span', { class: 'cell-check' }, r.check));
      tr.append(cell);
    }
    tb.append(tr);
    if (flagged && opts.full && opts.reason) tb.append(h('tr', { class: 'row--reason' }, h('td', { colspan: String(head.length) }, opts.reason(r))));
  }
  return h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': caption },
    h('table', { class: 'rows' }, h('caption', { class: 'visually-hidden' }, caption), h('thead', {}, h('tr', {}, head.map(th))), tb));
}

function rcRowsTable(rows, caption) {
  const head = ['file', 'image', 'date', 'vendor', 'tax', 'total', 'currency', 'category', 'check'];
  const tb = h('tbody');
  let lastFile = null;
  for (const r of rows) {
    if (r.file !== lastFile) { lastFile = r.file; tb.append(h('tr', { class: 'row--group' }, h('th', { scope: 'rowgroup', colspan: String(head.length) }, r.file))); }
    const flagged = String(r.check || '').startsWith('FLAGGED');
    const tr = h('tr', { class: flagged ? 'row--flagged' : r.check === 'NOT READ' ? 'row--notread' : null });
    for (const k of head) {
      let v = r[k];
      if (['tax', 'total'].includes(k)) v = v === null || v === undefined ? '' : fmtCents(Math.round(Number(v) * 100));
      const cell = h('td', { class: `col-${k}` }, v === undefined || v === null ? '' : String(v));
      if (k === 'vendor' && r.check) cell.append(h('span', { class: 'cell-check' }, r.check));
      tr.append(cell);
    }
    tb.append(tr);
  }
  return h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': caption },
    h('table', { class: 'rows rows--receipts' }, h('caption', { class: 'visually-hidden' }, caption),
      h('thead', {}, h('tr', {}, head.map((k) => h('th', { scope: 'col', class: `col-${k}` }, T['col_' + k]())))), tb));
}

function renderCards(job) {
  clear(els.cards);
  if (job.mode !== 'st') return;
  let first = true;
  const narrow = window.matchMedia && matchMedia('(max-width: 599px)').matches;
  const many = job.units.filter((u) => u.preview).length > 1;
  for (const u of job.units) {
    if (!u.preview) continue;
    const p = u.parsed || {};
    const res = u.preview.result;
    const mixed = u.pages.some((x) => !x.isText);
    const card = h('article', { class: 'card statement-card', dataset: { status: res.status } },
      h('h3', { class: 'card__title' }, h('span', { class: 'file__name', title: u.name }, u.name)),
      p.period ? h('p', { class: 'small muted' }, T.period(p.period.start, p.period.end)) : null,
      mixed ? h('p', { class: 'small muted' }, T.mixedNote(u.pages.filter((x) => !x.isText).length)) : reconBlock(res));
    if (u.preview.rows.length) {
      const d = h('details', { class: 'card__rows', open: first && !(narrow && many) },
        h('summary', {}, T.showRows(Math.min(L.PREVIEW_ROWS, u.preview.rows.length))),
        rowsTable(u.preview.rows.slice(0, L.PREVIEW_ROWS), T.rowsCaption(u.name)));
      card.append(d);
    }
    if (!mixed && u.preview.reasons && u.preview.reasons.length) {
      card.insertBefore(h('ul', { class: 'card__reasons' }, u.preview.reasons.map((x) => h('li', {}, T.flagReason(x.reason, x.page, false), ' ', x.tooLong ? T.tooLongNote() : T.previewReread()))), card.querySelector('.card__rows'));
    }
    if (u.preview.needAi) card.append(h('p', { class: 'small' }, T.needAi(u.preview.needAi)));
    for (const pg of u.preview.noRows) card.append(h('p', { class: 'small msg msg--note', dataset: { error: 'E11' } }, T.E11(pg, u.name)));
    els.cards.append(card);
    first = false;
  }
}

function renderScans(job) {
  clear(els.thumbs);
  const thumbs = [];
  for (const u of job.units) {
    if (u.type === 'rc') { const pg = u.rec.pages.find((x) => x.page === u.page); if (pg && pg.thumb) thumbs.push({ src: pg.thumb, alt: T.thumbAlt(u.page, u.name) }); continue; }
    for (const p of u.pages) if (!p.isText && p.thumb) thumbs.push({ src: p.thumb, alt: T.thumbAlt(p.page, u.name) });
  }
  for (const t of thumbs) els.thumbs.append(h('li', { class: 'thumb' }, h('img', { src: t.src, alt: t.alt, width: '72', height: '96', loading: 'lazy', decoding: 'async' })));
  show(els.scans, thumbs.length > 0);
  els.scanCounts.textContent = job.scanPages ? (job.mode === 'rc' ? T.receiptCounts(job.scanPages, job.textPages) : T.scanCounts(job.scanPages, job.textPages)) : '';
}

// The plan the job fits, or null when it fits none.
function fits(kind, job) {
  if (job.n > L.CAP[kind]) return false;
  if (job.t > L.TEXT_ALLOWANCE[kind]) return false;
  return true;
}

function needsProvider(job) { return job.n > 0 || job.t > 0; }

function blockReason(job) {
  if (S.status.state === 'unreachable') return { code: 'E14', text: T.E14(), retry: true };
  if (S.status.state === 'unknown') return { code: 'wait', text: '' };
  if (job.n > L.MAX_PAGES_IMG) return { code: 'E8', text: T.E8(job.n) };
  if (job.textPages > L.MAX_PAGES_TEXT) return { code: 'E9', text: T.E9(job.textPages) };
  if (S.status.state === 'down' && needsProvider(job)) return { code: 'E15', text: T.E15() };
  return null;
}

function usablePurchase(job) {
  if (!S.owned) return null;
  const ok = S.owned.filter((o) => o.ok);
  const plan = ok.find((o) => o.kind === 'plan' && o.left >= job.n);
  if (plan) return plan;
  const pack = ok.find((o) => o.kind === 'pack' && o.left >= job.n);
  return pack || null;
}
function resumableOneOff() {
  if (!S.owned) return null;
  return S.owned.find((o) => o.ok && o.kind === 'one') || null;
}

function renderPrice(job) {
  const box = els.price;
  clear(box);
  if (PAGE === 'paid') { renderPaidCta(job); return; }
  const block = blockReason(job);
  clear(els.jobAlerts);
  if (block && block.text) {
    els.jobAlerts.append(h('div', { class: 'msg msg--error', role: 'alert', dataset: { error: block.code } }, h('p', {}, block.text),
      block.retry ? h('button', { type: 'button', class: 'btn btn--small', onclick: () => fetchStatus(true) }, T.tryAgain()) : null));
  }
  const owned = usablePurchase(job);
  const resume = resumableOneOff();
  const n = job.n;
  if (!S.touched || !S.selected) S.selected = n > L.CAP.plan ? 'pack' : n > L.PLAN_PRESELECT_ABOVE ? 'plan' : 'one';
  if (n > L.CAP.one && S.selected === 'one') S.selected = n > L.CAP.plan ? 'pack' : 'plan';
  const packVisible = n > L.CAP.one || S.packShown || S.selected === 'pack';
  box.append(h('p', { class: 'pricebox__job' }, jobLine(job)));

  const showPlans = !owned || S.buyOther;
  let cta;
  if (owned && !S.buyOther) {
    const label = owned.kind === 'plan' ? T.runPlan(owned.left) : T.usePack(owned.left);
    cta = h('button', { type: 'button', class: 'btn btn--primary btn--cta', id: 'cta', dataset: { kind: owned.kind, owned: 'yes' } }, label);
    cta.addEventListener('click', () => runJob({ sid: owned.sid, kind: owned.kind }));
    box.append(cta);
    box.append(h('button', { type: 'button', class: 'btn btn--link', onclick: () => { S.buyOther = true; renderPreview(); } }, T.buySomethingElse()));
  }
  if (showPlans) {
    const fs = h('fieldset', { class: 'plans' }, h('legend', { class: 'visually-hidden' }, T.plansLegend()));
    const opt = (kind, label, disabled) => {
      const id = `plan-${kind}`;
      const input = h('input', { type: 'radio', name: 'plan', id, value: kind, checked: S.selected === kind, disabled });
      input.addEventListener('change', () => { S.selected = kind; S.touched = true; renderPreview(); });
      return h('label', { class: 'plan', for: id, dataset: { kind, selected: S.selected === kind ? 'yes' : 'no', disabled: disabled ? 'yes' : 'no' } }, input, h('span', { class: 'plan__label' }, label));
    };
    fs.append(opt('one', n === 0 && job.mode === 'st' ? T.planOneText() : T.planOne(), n > L.CAP.one));
    fs.append(opt('plan', T.planMonthly(), n > L.CAP.plan));
    if (packVisible) fs.append(opt('pack', T.planPack(), false));
    box.append(fs);
    if (n > L.CAP.one) box.append(h('p', { class: 'msg msg--note', dataset: { error: 'E10' } }, T.E10(n)));
    if (!packVisible) box.append(h('button', { type: 'button', class: 'btn btn--link pricebox__pack-link', onclick: () => { S.packShown = true; S.selected = 'pack'; S.touched = true; renderPreview(); } }, T.packLink()));
    box.append(h('p', { class: 'pricebox__anchor small' }, T.anchorLine()));
    const kind = S.selected;
    const label = kind === 'one' ? T.ctaOne() : kind === 'plan' ? T.ctaPlan() : T.ctaPack();
    cta = h('button', { type: 'button', class: 'btn btn--primary btn--cta', id: 'cta', dataset: { kind } }, label);
    cta.addEventListener('click', () => checkoutClick(S.selected));
    const noLink = !linkFor(kind);
    const disabled = !!block || noLink || !fits(kind, job) || S.building;
    cta.disabled = disabled;
    const reasonId = 'cta-reason';
    if (disabled) cta.setAttribute('aria-describedby', reasonId);
    box.append(cta);
    const why = block ? block.text : noLink ? T.checkoutOff() : '';
    box.append(h('p', { class: 'pricebox__reason small', id: reasonId, hidden: !why }, why));
    box.append(h('p', { class: 'pricebox__secure small muted' }, T.underCta()));
  }
  if (owned && !S.buyOther && block) { cta.disabled = true; }
  if (resume) {
    box.append(h('button', { type: 'button', class: 'btn btn--link pricebox__resume', onclick: () => runJob({ sid: resume.sid, kind: 'one', reissue: resume.left === 0 }) }, T.resumeOne()));
  }
}

function jobLine(job) {
  const total = job.scanPages + job.textPages;
  let fit = '';
  if (job.n > L.MAX_PAGES_IMG) fit = T.fitNone();
  else if (job.n === 0 && job.mode === 'st') fit = T.fitText();
  else if (job.n <= L.CAP.one) fit = T.fitOne();
  else fit = T.fitOver();
  if (job.mode === 'rc') return T.jobLineReceipts(job.units.length, fit);
  // photos are pages, not statements (qa #34)
  return T.jobLine(job.units.filter((u) => u.rec.kind === 'pdf').length, total, job.scanPages, job.textPages, fit);
}

function renderPreview() {
  if (!tool) return;
  const job = S.job;
  const visible = !!job && stateIs('preview', 'checkout');
  show(els.preview, visible || stateIs('reading') && !!S.job);
  if (!job) { clear(els.cards); clear(els.thumbs); clear(els.price); clear(els.jobAlerts); return; }
  renderCards(job);
  renderScans(job);
  renderPrice(job);
  show(els.price, !stateIs('checkout'));
  show(els.pay, stateIs('checkout'));
}

// ---------------------------------------------------------------- status
async function fetchStatus(rerender) {
  if (rerender) { S.status.state = 'unknown'; renderPreview(); }
  const r = await call('/status', { timeout: L.STATUS_TIMEOUT_MS });
  if (r.ok && r.data && r.data.ok) {
    S.status = { state: r.data.provider === 'down' ? 'down' : 'up', batch: Math.max(1, Math.min(L.MAX_BATCH_DEFAULT, Number(r.data.batch) || L.MAX_BATCH_DEFAULT)), mode: r.data.mode || 'live' };
  } else {
    S.status = { state: 'unreachable', batch: L.MAX_BATCH_DEFAULT, mode: 'live' };
  }
  renderPreview();
}

// Returning buyer: confirm every stored code once (newest first, at most 5).
async function loadOwned() {
  if (S.owned || S.ownedLoading || PAGE !== 'tool' || S.status.state === 'unreachable') return;
  const list = purchases.list().slice(-5).reverse();
  if (!list.length) { S.owned = []; return; }
  S.ownedLoading = true;
  const out = [];
  for (const p of list) {
    if (p.kind === 'one' && Date.now() - Date.parse(p.at) > L.ONE_OFF_MAX_AGE_DAYS * 864e5) continue;
    const r = await api.confirm(p.sid);
    if (r.ok && r.data) out.push({ sid: p.sid, ok: true, kind: r.data.kind, cap: r.data.cap, left: r.data.left, reset: r.data.reset });
  }
  S.owned = out;
  S.ownedLoading = false;
  renderPreview();
}
window.addEventListener('sumline:purchases', () => { S.owned = null; S.buyOther = false; if (S.job) loadOwned(); });

// ---------------------------------------------------------------- checkout (S4)
function checkoutClick(kind) {
  const res = openCheckout(kind, (go) => {
    clear(els.jobAlerts);
    els.jobAlerts.append(h('div', { class: 'msg msg--note', role: 'alert', dataset: { error: 'E12' } }, h('p', {}, T.E12()),
      h('button', { type: 'button', class: 'btn btn--primary', onclick: go }, T.continueCheckout())));
  });
  if (res !== 'tab') return;
  S.pending = { kind, at: Date.now() };
  S.hiddenSince = false;
  setState('checkout');
  renderPay();
  renderPreview();
  // at 375 px the panel would sit below the fold (qa #36)
  els.pay.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
}

function renderPay(abandoned) {
  const p = els.pay;
  clear(p);
  p.append(
    h('span', { class: 'pay-panel__pictogram', 'aria-hidden': 'true' }),
    h('p', { class: 'pay-panel__line' }, T.payPanel()),
    h('p', { class: 'pay-panel__phone small only-narrow' }, T.payPhone()),
    abandoned ? h('p', { class: 'msg msg--note', dataset: { error: 'E13' } }, T.E13()) : null,
    h('div', { class: 'pay-panel__actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => checkoutClick(S.pending ? S.pending.kind : S.selected) }, T.reopenCheckout()),
      h('button', { type: 'button', class: 'btn btn--quiet', onclick: () => { S.pending = null; setState('preview'); renderPreview(); focusHeading(els.previewH); } }, T.changePlan())));
}

// A purchase code arrived (channel, storage event or visibility re-read) for this tab's checkout.
function maybeClaim(sid, kind) {
  if (!S.pending || !L.isSessionId(sid) || !stateIs('checkout', 'preview')) return false;
  const p = purchases.get(sid);
  if (p && p.claimed) return false;
  post({ type: 'ack', sid });
  S.pending = null;
  runJob({ sid, kind: kind || (p && p.kind) || 'one' });
  return true;
}

function rereadStorage() {
  if (!S.pending) return false;
  const since = S.pending.at - 60000;
  const fresh = purchases.list().filter((p) => !p.claimed && Date.parse(p.at) >= since);
  if (fresh.length) { const p = fresh[fresh.length - 1]; return maybeClaim(p.sid, p.kind); }
  return false;
}

function wireReturnPath() {
  onChannel((m) => {
    if (m.type === 'paid') maybeClaim(m.sid, m.kind);
  });
  window.addEventListener('storage', (e) => { if (e.key === L.LS_PURCHASES) rereadStorage(); });
  const back = () => {
    if (document.visibilityState === 'hidden') { S.hiddenSince = true; return; }
    if (!S.pending) return;
    if (rereadStorage()) return;
    if (stateIs('checkout')) renderPay(true);
  };
  document.addEventListener('visibilitychange', back);
  window.addEventListener('focus', back);
}

// ---------------------------------------------------------------- the paid run (S6)
function beforeUnload(e) { e.preventDefault(); e.returnValue = ''; return ''; }
function guardLeave(on) { if (on) window.addEventListener('beforeunload', beforeUnload); else window.removeEventListener('beforeunload', beforeUnload); }

// The input phase leaves the page (and the tab order) while a paid job runs or shows its
// result; one line says what the job is (qa #11). It comes back on Clear now / Convert more.
function showInput(on) {
  const ph = tool.querySelector('[data-phase="input"]');
  if (ph) ph.hidden = !on;
  let f = $('#run-files');
  if (!f) { f = h('p', { class: 'run__files small muted', id: 'run-files' }); els.runH.after(f); }
  const job = S.job;
  f.hidden = on || !job;
  if (job && !on) f.textContent = T.runFiles(new Set(job.units.map((u) => u.name)).size, job.scanPages + job.textPages, job.scanPages, job.textPages);
}

function runShell() {
  setState('running');
  show(els.preview, false);
  show(els.run, true);
  showInput(false);
  els.runH.textContent = T.runH2();
  clear(els.runBody);
  focusHeading(els.runH);
}

const reportLink = () => h('button', { type: 'button', class: 'btn btn--link', onclick: () => openReport() }, T.reportLink());

function runError(code, text, actions = []) {
  setState('failed');
  guardLeave(false);
  els.runBody.append(h('div', { class: 'msg msg--error run__error', role: 'alert', dataset: { error: code } }, h('p', {}, text), actions.length ? h('div', { class: 'msg__actions' }, actions) : null));
  lockInput(false);
}

const btn = (label, fn, cls = 'btn') => h('button', { type: 'button', class: cls, onclick: fn }, label);
const backToPreview = () => { show(els.run, false); showInput(true); S.run = null; setState(S.job ? 'preview' : 'input'); renderPreview(); focusHeading(S.job ? els.previewH : els.runH); };

function startError(r, sid, kind, retry) {
  const e = r.data && r.data.error;
  const convert = btn(T.ctaOne(), () => { backToPreview(); S.selected = 'one'; S.touched = true; S.buyOther = true; renderPreview(); checkoutClick('one'); }, 'btn btn--primary');
  if (r.status === 409 && e === 'used') return runError('E18', T.E18(), [convert]);
  if (r.status === 410) return runError('E19', T.E19(), [convert]);
  if (r.status === 403 && e === 'inactive') {
    const portal = (r.data && r.data.portal) || cfg().portal;
    return runError('E20', T.E20(), [h('a', { class: 'btn', href: portal, target: '_blank', rel: 'noopener' }, T.manageSub()), convert]);
  }
  if (r.status === 409 && e === 'cap') {
    const d = r.data;
    if (d.kind === 'plan') return runError('E21', T.E21(S.job.n, d.left, fmtReset(d.reset)), [h('a', { class: 'btn', href: cfg().portal, target: '_blank', rel: 'noopener' }, T.manageSub()), btn(T.changePlan(), backToPreview)]);
    if (d.kind === 'pack') return runError('E22', T.E22(d.left, S.job.n), [btn(T.ctaPack(), () => { backToPreview(); S.selected = 'pack'; S.packShown = true; S.touched = true; S.buyOther = true; renderPreview(); checkoutClick('pack'); }, 'btn btn--primary')]);
    return runError('E23', T.E23(S.job.n, L.CAP.one), [btn(T.remove(), backToPreview)]);
  }
  if (r.status === 409 && e === 'reissue') return runError('E27', T.E27none(sid), [reportLink()]);
  if (r.status === 429) {
    const b = btn(T.tryAgain(), retry, 'btn');
    b.disabled = true;
    setTimeout(() => { b.disabled = false; }, (r.retryAfter || 60) * 1000);
    return runError('E24', T.E24(), [b]);
  }
  if (r.status === 400 || r.status === 403 || r.status === 404) return runError('E17', T.E17(), [btn(T.backToSumline(), backToPreview)]);
  return runError('E16', T.E16tool(sid), [btn(T.tryAgain(), retry, 'btn'), reportLink()]);
}

async function runJob({ sid, kind, reissue = false }) {
  const job = S.job;
  if (!job || !L.isSessionId(sid)) return;
  const stored = purchases.get(sid);
  if (PAGE === 'paid' && stored && stored.claimed && !reissue && !S.run) { showClaimed(); return; }
  lockInput(true);
  runShell();
  const progress = h('progress', { class: 'run__progress', max: String(Math.max(1, job.n + job.t)), value: '0' });
  const line = h('p', { class: 'run__line', 'aria-live': 'polite' }, T.progressStart());
  const keep = h('p', { class: 'small muted' }, T.keepOpen());
  const live = h('div', { class: 'run__rows' });
  els.runBody.append(progress, line, keep, live);
  guardLeave(true);

  const jh = await jobHash(intake.ready());
  const spec = { jh, d: job.mode, n: job.n, t: job.t };
  const r = await api.start(sid, spec, reissue);
  if (!r.ok || !r.data || !r.data.ticket) {
    clear(els.runBody);
    return startError(r, sid, kind, () => runJob({ sid, kind, reissue }));
  }
  const d = r.data;
  purchases.add({ sid, kind: d.kind });
  purchases.claim(sid);
  post({ type: 'claimed', sid });
  S.run = { sid, kind: d.kind || kind, ticket: d.ticket, left: d.left, cap: d.cap, reset: d.reset, models: new Set(), rerunDone: false, finishTried: false, startedAt: Date.now(), done: 0, ui: { progress, line, live }, lastLine: 0, reissued: reissue };
  if (PAGE === 'paid') hidePaidWait();
  await loadParser();
  const all = [];
  for (let i = 0; i < job.n + job.t; i++) all.push(i);
  await passes(all);
}

function sayProgress(text, force) {
  const R = S.run;
  if (!R) return;
  const now = Date.now();
  if (!force && now - R.lastLine < L.PROGRESS_EVERY_MS) return;
  R.lastLine = now;
  R.ui.line.textContent = text;
}

function progressText() {
  const R = S.run; const job = S.job;
  const total = job.n + job.t;
  const done = Math.min(total, R.done);
  const per = done ? (Date.now() - R.startedAt) / done : 4000;
  const left = Math.round(((total - done) * per) / 1000);
  return T.progress(Math.min(total, done + 1), total, left);
}

async function getPart(i) {
  const p = partOf(S.job, i);
  if (p.kind === 'text') return { field: `t${i}`, value: p.text.slice(0, L.TEXT_PAGE_CHARS) };
  const rec = S.job.index[i].unit.rec;
  const src = await intake.sourceFor(rec, p.page);
  try {
    const r = await rasterise(src.source, src.w, src.h);
    return { field: `p${i}`, value: toBase64(r.buf) };
  } finally { src.dispose(); }
}

function pageRowsPreview(i) {
  const e = S.job.index[i];
  const R = S.run;
  if (!e || !R) return;
  const target = e.unit.type === 'rc' ? e.unit : e.page;
  if (e.unit.type === 'rc') {
    const o = target.out || {};
    R.ui.live.append(h('p', { class: 'run__row small' }, [o.date, o.vendor, o.total].filter((x) => x !== undefined && x !== null).join(' · ')));
  } else {
    for (const row of (target.rows || []).slice(0, 50)) R.ui.live.append(h('p', { class: 'run__row small' }, [row.date, row.desc, row.amount].join(' · ')));
  }
}

async function send(indices, ticket, model) {
  const R = S.run;
  const { sendPages } = await lazyBatcher();
  const res = await sendPages({
    ticket, indices,
    batch: model === 's' ? Math.min(L.SONNET_BATCH, S.status.batch) : S.status.batch,
    getPart,
    onResult: (i, out) => { applyResult(S.job, i, out, model); R.models.add(model); if (model === 'h') { R.done++; pageRowsPreview(i); } },
    onNotRead: (i) => { markNotRead(S.job, i); if (model === 'h') R.done++; },
    onWait: (s) => sayProgress(T.E25(s), true),
    onProgress: () => { R.ui.progress.value = String(R.done); R.ui.progress.setAttribute('aria-valuetext', progressText()); sayProgress(progressText()); },
  });
  return res;
}

// First pass, chain, one Sonnet re-read of failed image pages, chain again, result.
async function passes(indices) {
  const R = S.run;
  const job = S.job;
  if (indices.length) {
    sayProgress(progressText(), true);
    const res = await send(indices, R.ticket, 'h');
    if (res.stop === 'ticket') return ticketExpired(res.remaining);
    if (res.stop === 'job') return jobGone();
  }
  let sum = finalise(job);
  if (sum.rerun.length && !R.rerunDone) {
    R.rerunDone = true;
    sayProgress(T.rerunLine(sum.rerun.length), true);
    const rr = await api.rerun(R.ticket, sum.rerun);
    if (rr.ok && rr.data && rr.data.ticket) {
      await send(sum.rerun, rr.data.ticket, 's');
      sum = finalise(job);
    }
  }
  done();
}

function ticketExpired(remaining) {
  const R = S.run;
  R.pendingIdx = remaining;
  guardLeave(false);
  els.runBody.append(h('div', { class: 'msg msg--error', role: 'alert', dataset: { error: 'E28' } }, h('p', {}, T.E28()),
    btn(T.resumeOne(), async (e) => { e.currentTarget.disabled = true; await resume(remaining); }, 'btn btn--primary')));
  setState('failed');
}

async function resume(indices) {
  const R = S.run;
  guardLeave(true);
  setState('running');
  const jh = await jobHash(intake.ready());
  const r = await api.start(R.sid, { jh, d: S.job.mode, n: S.job.n, t: S.job.t }, true);
  if (!r.ok || !r.data || !r.data.ticket) {
    if (r.status === 409 || r.status === 404) return jobGone();
    return startError(r, R.sid, R.kind, () => resume(indices));
  }
  R.ticket = r.data.ticket;
  R.reissued = true;
  // after a re-issue the Worker cleared the image bits; resend only what this tab has no result for
  const missing = indices.filter((i) => { const e = S.job.index[i]; const t = e.unit.type === 'rc' ? e.unit : e.page; return !(t.out || t.src === 'ai'); });
  await passes(missing);
}

function jobGone() {
  finalise(S.job);
  S.run.finishTried = true;
  done(true);
}

// ---------------------------------------------------------------- result (S6 done)
function done(gaveUp) {
  const R = S.run;
  const job = S.job;
  guardLeave(false);
  setState('done');
  lockInput(false);
  S.rows = outputRows(job);
  S.downloaded = false;
  els.runH.textContent = T.doneH2();
  clear(els.runBody);
  const sum = job.summary;
  const out = els.runBody;
  // per-statement lines and chips (S7)
  if (job.mode === 'st') {
    for (const u of job.units) {
      const p = u.parsed || {};
      // each statement's reasons sit under its card, outside the table's scroll box (qa #6)
      const reasons = S.rows.filter((r) => r.file === u.name && String(r.check).startsWith('FLAGGED')).slice(0, 5);
      out.append(h('article', { class: 'card statement-card', dataset: { status: u.result ? u.result.status : 'unreconciled' } },
        h('h3', { class: 'card__title' }, h('span', { class: 'file__name', title: u.name }, u.name)),
        p.period ? h('p', { class: 'small muted' }, T.period(p.period.start, p.period.end)) : null,
        reconBlock(u.result),
        reasons.length ? h('ul', { class: 'card__reasons' }, reasons.map((r) => h('li', {}, reasonOf(r)))) : null));
    }
  } else {
    out.append(h('div', { class: 'recon recon--text', dataset: { status: 'unreconciled' } }, h('p', {}, T.lineReceipts(sum.okReceipts, sum.receipts, sum.flaggedReceipts)), h('p', {}, chip('unreconciled'))));
  }
  if (sum.notReadPages.length) {
    out.append(h('p', { class: 'msg msg--notread run__incomplete' }, T.incomplete(sum.notReadPages.length)));
    if (gaveUp || R.finishTried) {
      const fin = finishedPages(job);
      out.append(h('div', { class: 'msg msg--error', role: 'alert', dataset: { error: 'E27' } }, h('p', {}, fin > 0 ? T.E27(R.sid, fin) : T.E27none(R.sid)),
        h('div', { class: 'msg__actions' }, fin > 0 ? btn(T.downloadFinished(fin), () => $('#download-btn').focus()) : null, reportLink())));
    } else {
      const pages = sum.notReadPages.map((p) => p.page);
      out.append(h('div', { class: 'msg msg--note', role: 'alert', dataset: { error: 'E26' } }, h('p', {}, T.E26(pages.length, pages)),
        h('div', { class: 'msg__actions' }, btn(T.finish(), finishRemaining, 'btn btn--primary'), reportLink())));
    }
  }
  const flagged = job.mode === 'st' ? sum.flaggedRows : sum.flaggedReceipts;
  if (flagged) out.append(h('p', { class: 'run__refund' }, T.refundLead(), ' ', h('a', { href: refundMailto(R.sid, job, flagged) }, T.refundLink())));
  // the table, flagged rows highlighted
  out.append(job.mode === 'rc' ? rcRowsTable(S.rows, T.resultCaption()) : rowsTable(S.rows, T.resultCaption(), { full: true, reason: reasonOf }));
  // the disclosure block directly above the format picker and Download (S1)
  const browserOnly = job.n === 0 && job.t === 0;
  out.append(h('div', { class: 'disclosure', id: 'disclosure' },
    h('p', { class: 'disclosure__label' }, h('strong', {}, T.disclosureLabel())),
    h('p', {}, browserOnly ? T.browserOnly() : T.aiDisclosure()),
    job.mode === 'rc' ? h('p', {}, T.receiptsNote()) : null));
  const fmtBox = h('fieldset', { class: 'formats' }, h('legend', { class: 'visually-hidden' }, T.formatLegend()),
    ['xlsx', 'csv'].map((f) => {
      const input = h('input', { type: 'radio', name: 'fmt', id: `fmt-${f}`, value: f, checked: S.fmt === f });
      input.addEventListener('change', () => { S.fmt = f; dl.textContent = T.download(f); });
      return h('label', { class: 'format', for: `fmt-${f}` }, input, h('span', {}, f === 'xlsx' ? T.fmtXlsx() : T.fmtCsv()));
    }));
  const dl = h('button', { type: 'button', class: 'btn btn--primary btn--cta', id: 'download-btn', 'aria-describedby': 'disclosure' }, T.download(S.fmt));
  dl.addEventListener('click', () => download(S.fmt));
  const after = h('div', { class: 'after', id: 'after-download', hidden: true });
  const err = h('div', { id: 'download-error' });
  out.append(fmtBox, dl, err, after);
  focusHeading(els.runH);
}

function reasonOf(r) {
  const reread = S.job.units.some((u) => u.type === 'st' && u.name === r.file && u.pages.some((p) => p.page === r.page && p.reread));
  return T.flagReason(String(r.check).replace(/^FLAGGED: /, ''), r.page, reread);
}

function finishedPages(job) {
  return job.n + job.t - job.summary.notReadPages.length;
}

function refundMailto(sid, job, n) {
  const files = job.units.map((u) => u.name).filter((v, i, a) => a.indexOf(v) === i).slice(0, 5).join(', ');
  return `mailto:${cfg().contact}?subject=${encodeURIComponent(T.refundSubject(sid))}&body=${encodeURIComponent(T.refundBody(sid, files, n))}`;
}

async function finishRemaining(e) {
  if (e && e.currentTarget) e.currentTarget.disabled = true;
  const R = S.run;
  const job = S.job;
  R.finishTried = true;
  const idx = [];
  for (const u of job.units) {
    if (u.type === 'rc') { if (u.notRead && u.idx !== null) idx.push(u.idx); continue; }
    u.pages.forEach((p) => { if (p.notRead && p.idx !== null) idx.push(p.idx); });
  }
  guardLeave(true);
  setState('running');
  els.runH.textContent = T.runH2();
  clear(els.runBody);
  R.done = job.n + job.t - idx.length;
  const progress = h('progress', { class: 'run__progress', max: String(job.n + job.t), value: String(R.done) });
  const line = h('p', { class: 'run__line', 'aria-live': 'polite' }, '');
  R.ui = { progress, line, live: h('div', { class: 'run__rows' }) };
  els.runBody.append(progress, line, R.ui.live);
  focusHeading(els.runH);
  // a NOT READ page is retried from scratch
  idx.forEach((i) => { const en = job.index[i]; const t = en.unit.type === 'rc' ? en.unit : en.page; t.notRead = false; });
  const res = await send(idx, R.ticket, 'h');
  if (res.stop === 'ticket') return ticketExpired(res.remaining);
  if (res.stop === 'job') return jobGone();
  finalise(job);
  done();
}

async function download(fmt) {
  const job = S.job;
  const R = S.run;
  const err = $('#download-error');
  clear(err);
  const info = {
    models: [R && R.models.has('h') ? L.MODELS.haiku : null, R && R.models.has('s') ? L.MODELS.sonnet : null].filter(Boolean),
    runDate: new Date().toISOString().slice(0, 10),
    browserOnly: job.n === 0 && job.t === 0,
  };
  let blob, saveName, save;
  try {
    const O = await lazyOutput();
    blob = fmt === 'xlsx' ? await O.buildXlsx(job, S.rows, info) : O.buildCsv(job.mode, S.rows);
    saveName = O.fileName(fmt);
    save = O.saveBlob;
  } catch (e) {
    err.append(h('div', { class: 'msg msg--error', role: 'alert', dataset: { error: 'E30' } }, h('p', {}, T.E30()),
      h('div', { class: 'msg__actions' }, btn(T.download('xlsx'), () => download('xlsx')), btn(T.fmtCsv(), () => download('csv')))));
    return;
  }
  save(blob, saveName);
  if (R) goal('download', R.kind);
  if (!S.downloaded) clearSources();
  S.downloaded = true;
  renderAfter(fmt);
}

// D13 / S3: once the file is handed to the browser, the source files, rasters and thumbnails go.
function clearSources() {
  if (intake) intake.clearAll();
  if (els.file) els.file.value = '';
  clear(els.thumbs);
  if (S.job) for (const u of S.job.units) { u.rec = { name: u.name, pages: [] }; }
  const finish = els.runBody.querySelector('[data-error="E26"] button');
  if (finish) finish.disabled = true;
}

function renderAfter(fmt) {
  const box = $('#after-download');
  clear(box);
  box.hidden = false;
  const other = fmt === 'xlsx' ? 'csv' : 'xlsx';
  const R = S.run;
  box.append(
    h('p', { class: 'after__cleared', role: 'status' }, T.cleared()),
    h('div', { class: 'after__actions' },
      btn(T.downloadToo(other), () => download(other)),
      btn(T.clearNow(), () => clearEverything(true)),
      btn(T.convertMore(), () => clearEverything(false))));
  if (R && R.kind === 'one') box.append(h('p', { class: 'after__offer' }, T.offerLine()));
  else if (R && R.kind === 'plan') box.append(h('p', { class: 'after__left' }, T.planLeft(R.left, fmtReset(R.reset))));
  else if (R && R.kind === 'pack') box.append(h('p', { class: 'after__left' }, T.packLeft(R.left)));
}

function clearEverything(say) {
  guardLeave(false);
  if (intake) intake.clearAll();
  S.job = null; S.run = null; S.rows = null; S.touched = false; S.packShown = false; S.buyOther = false;
  clear(els.runBody);
  show(els.run, false);
  showInput(true);
  setState('input');
  renderPreview();
  if (PAGE === 'paid') { const w = $('#paid-wait'); if (w) w.hidden = true; }
  els.status.textContent = say ? T.clearedAll() : '';
  const first = tool.querySelector('input[name="doctype"]:checked') || els.file;
  first.focus();
}

// ---------------------------------------------------------------- paid.html (S5)
function hidePaidWait() { const w = $('#paid-wait'); if (w) w.hidden = true; }
function showClaimed() {
  const w = $('#paid-wait');
  if (w) { clear(w); w.hidden = false; w.append(h('p', { class: 'paid__claimed', role: 'status' }, T.claimedLine())); }
  if (!S.run) show(tool, false);
}

function renderPaidCta(job) {
  const box = els.price;
  const P = S.paid;
  clear(els.jobAlerts);
  box.append(h('p', { class: 'pricebox__job' }, jobLine(job)));
  let over = null;
  if (P.kind === 'one' && job.n > L.CAP.one) over = { code: 'E23', text: T.E23(job.n, L.CAP.one) };
  else if (P.kind === 'plan' && job.n > P.left) over = { code: 'E21', text: T.E21(job.n, P.left, fmtReset(P.reset)) };
  else if (P.kind === 'pack' && job.n > P.left) over = { code: 'E22', text: T.E22(P.left, job.n) };
  else if (job.n > L.MAX_PAGES_IMG) over = { code: 'E8', text: T.E8(job.n) };
  if (over) els.jobAlerts.append(h('p', { class: 'msg msg--error', role: 'alert', dataset: { error: over.code } }, over.text));
  const cta = h('button', { type: 'button', class: 'btn btn--primary btn--cta', id: 'cta', dataset: { kind: P.kind, owned: 'yes' } }, T.runPaid());
  cta.disabled = !!over || S.building;
  cta.addEventListener('click', () => runJob({ sid: P.sid, kind: P.kind }));
  box.append(cta);
}

async function paidInit() {
  const sid = String(window.__SUMLINE_SID || '');
  const head = $('#paid-h1');
  const code = $('#paid-code');
  const wait = $('#paid-wait');
  const fail = (codeId, text, actions) => {
    head.textContent = T.paidProblemH1();
    clear(wait); wait.hidden = false;
    wait.append(h('div', { class: 'msg msg--error', role: 'alert', dataset: { error: codeId } }, h('p', {}, text), actions || null));
  };
  const back = h('a', { class: 'btn', href: './' }, T.backToSumline());
  if (!L.isSessionId(sid)) { fail('E17', T.E17(), back); return; }
  head.textContent = T.paidChecking();
  const r = await api.confirm(sid);
  if (!r.ok || !r.data || !r.data.kind) {
    const e = r.data && r.data.error;
    if (r.status === 400 || (r.status === 403 && e !== 'inactive')) { fail('E17', T.E17(), back); return; }
    if (r.status === 403) { fail('E20', T.E20(), h('a', { class: 'btn', href: (r.data && r.data.portal) || cfg().portal, target: '_blank', rel: 'noopener' }, T.manageSub())); return; }
    if (r.status === 429) { fail('E24', T.E24(), btn(T.tryAgain(), () => location.reload())); return; }
    fail('E16', T.E16(sid), btn(T.reload(), () => location.reload()));
    show(code, true);
    $('#paid-sid').textContent = sid;
    return;
  }
  const d = r.data;
  S.paid = { sid, kind: d.kind, cap: d.cap, left: d.left, reset: d.reset };
  head.textContent = T.paidH1(kindWord(d.kind));
  $('#paid-sid').textContent = sid;
  show(code, true);
  const copyBtn = $('#copy-sid');
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(sid); } catch (e) { const rng = document.createRange(); rng.selectNodeContents($('#paid-sid')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rng); return; }
    copyBtn.textContent = T.copied();
    setTimeout(() => { copyBtn.textContent = T.copyBtn(); }, 1600);
  });
  const already = purchases.get(sid);
  purchases.add({ sid, kind: d.kind });
  if (!already) goal('paid', d.kind); // once per purchase code, not per reload (qa #22)
  const keep = $('#paid-keep');
  if (keep) keep.textContent = d.kind === 'one' ? T.keepCodeOne() : T.keepCode(); // qa #33, CEO 11:4x
  if (already && already.claimed) { showClaimed(); return; }
  let answered = false;
  onChannel((m) => {
    if (m.sid !== sid) return;
    if (m.type === 'claimed' && !S.run) { answered = true; showClaimed(); }
    if (m.type === 'ack' && !answered) {
      answered = true;
      clear(wait); wait.hidden = false;
      const closeBtn = btn(T.closeTab(), () => {
        window.close();
        setTimeout(() => { closeBtn.replaceWith(h('p', {}, T.switchBack())); }, 300);
      });
      wait.append(h('p', { role: 'status' }, T.ackLine()), closeBtn);
    }
  });
  window.addEventListener('storage', (e) => { if (e.key === L.LS_PURCHASES && !S.run) { const p = purchases.get(sid); if (p && p.claimed) { answered = true; showClaimed(); } } });
  post({ type: 'paid', sid, kind: d.kind });
  await sleep(L.ACK_WAIT_MS);
  if (answered) return;
  // no other tab answered: this page becomes the tool
  clear(wait); wait.hidden = false;
  wait.append(h('p', {}, T.noAckLine()));
  show(tool, true);
  wireInput();
}

// ---------------------------------------------------------------- start
function init() {
  captureUtm();
  if (body.dataset.beacon === 'dynamic') loadBeacon();
  initFooter();
  if (!tool) return;
  if (PAGE === 'paid') {
    show(tool, false);
    fetchStatus(false);
    prefetchPdfjs();
    paidInit();
    return;
  }
  wireInput();
  wireReturnPath();
  fetchStatus(false);
  prefetchPdfjs();
}

init();
