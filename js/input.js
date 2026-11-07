// File intake (S2, Flow 2): type/size/count checks (E1-E3), pdf.js open with the in-page
// password prompt (D17, E4-E5), HEIC lazy-load (E6-E7), text vs scanned per page, thumbnails.
// Nothing leaves the tab. Each accepted file gets its SHA-256 for the job hash.
import { MAX_FILES, MAX_FILE_BYTES, THUMB_PX } from './limits.js';
import { T } from './copy.js';
import { h, clear, nextId } from './ui.js';
import { openPdf, readPage, renderPage } from './pdf-text.js';
import { thumbnail } from './raster.js';

const PDF_EXT = /\.pdf$/i;
const IMG_EXT = /\.(jpe?g|png|webp)$/i;
const HEIC_EXT = /\.(heic|heif)$/i;

export function kindOf(file) {
  const t = (file.type || '').toLowerCase();
  if (t === 'application/pdf' || PDF_EXT.test(file.name)) return 'pdf';
  if (t === 'image/heic' || t === 'image/heif' || HEIC_EXT.test(file.name)) return 'heic';
  if (/^image\/(jpeg|png|webp)$/.test(t) || IMG_EXT.test(file.name)) return 'image';
  return null;
}

async function sha256Hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// SHA-256 of the sorted per-file SHA-256s (the job hash jh, 64 hex).
export async function jobHash(files) {
  const joined = files.map((f) => f.sha).sort().join('');
  return sha256Hex(new TextEncoder().encode(joined));
}

let heicMod = null;
function loadHeic() {
  if (!heicMod) {
    heicMod = import('../vendor/heic/heic-to.min.js');
    heicMod.catch(() => { heicMod = null; });
  }
  return heicMod;
}

async function decodeImage(rec) {
  if (rec.kind === 'heic') {
    let mod;
    try { mod = await loadHeic(); } catch (e) { throw Object.assign(new Error('heic-load'), { code: 'E7' }); }
    try { return await mod.heicTo({ blob: rec.file, type: 'bitmap' }); } catch (e) { throw Object.assign(new Error('heic-decode'), { code: 'E6' }); }
  }
  try { return await createImageBitmap(rec.file); } catch (e) { throw Object.assign(new Error('image'), { code: 'E4' }); }
}

export function createIntake({ listEl, statusEl, alertEl, onChange, onPhoto }) {
  const files = [];
  let queue = Promise.resolve();
  let pending = 0;

  const changed = () => { render(); onChange(); };

  function errorRow(rec) {
    const actions = [];
    if (rec.error.retry) actions.push(h('button', { type: 'button', class: 'btn btn--small', onclick: () => enqueue(rec) }, T.tryAgain()));
    return h('div', { class: 'file__error', role: 'alert', dataset: { error: rec.error.code } },
      h('p', { class: 'msg msg--error' }, rec.error.text),
      actions.length ? h('div', { class: 'file__actions' }, actions) : null);
  }

  function pwPrompt(rec) {
    const inId = nextId('pw');
    const errId = nextId('pwe');
    const input = h('input', { type: 'password', id: inId, class: 'input', autocomplete: 'off', 'aria-describedby': rec.pw.wrong ? errId : null });
    const open = () => { const v = input.value; input.value = ''; rec.state = 'reading'; render(); rec.pw.submit(v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); open(); } });
    const box = h('div', { class: 'file__password', dataset: { state: rec.pw.wrong ? 'wrong' : 'ask' } },
      h('label', { for: inId }, T.pwLabel(rec.name)),
      input,
      rec.pw.wrong ? h('p', { class: 'msg msg--error', role: 'alert', id: errId, dataset: { error: 'E5' } }, T.E5(rec.name)) : null,
      h('div', { class: 'file__actions' },
        h('button', { type: 'button', class: 'btn btn--small', onclick: open }, T.pwOpen()),
        h('button', { type: 'button', class: 'btn btn--small btn--quiet', onclick: () => rec.pw.giveUp() }, T.pwLeave())),
      h('p', { class: 'small muted' }, T.pwNote()));
    setTimeout(() => input.focus(), 0);
    return box;
  }

  function meta(rec) {
    if (!rec.pages.length) return '';
    const text = rec.pages.filter((p) => p.isText).length;
    const scan = rec.pages.length - text;
    const parts = [T.filePages(rec.pages.length)];
    if (text && scan) parts.push(`${text} ${T.fileText()}`, `${scan} ${T.fileScanned()}`);
    else parts.push(text ? T.fileText() : T.fileScanned());
    return parts.join(' · ');
  }

  function render() {
    clear(listEl);
    for (const rec of files) {
      listEl.append(h('li', { class: 'file', dataset: { state: rec.state, id: rec.id } },
        h('div', { class: 'file__main' },
          h('span', { class: 'file__name', title: rec.name }, rec.name),
          h('span', { class: 'file__meta small muted' }, rec.state === 'ok' ? meta(rec) : ''),
          h('button', { type: 'button', class: 'btn btn--small btn--quiet file__remove', 'aria-label': `${T.remove()}: ${rec.name}`, onclick: () => remove(rec.id) }, T.remove())),
        rec.state === 'locked' ? pwPrompt(rec) : null,
        rec.state === 'error' ? errorRow(rec) : null));
    }
    listEl.hidden = files.length === 0;
  }

  function setStatus(text) {
    statusEl.textContent = text || '';
    statusEl.dataset.state = text ? 'reading' : 'idle';
  }

  async function readPdf(rec, bytes) {
    let doc;
    try {
      doc = await openPdf(bytes, (wrong, submit, giveUp) => {
        rec.state = 'locked';
        rec.pw = { wrong, submit, giveUp };
        setStatus('');
        changed();
      });
    } catch (e) {
      if (rec.removed) return;
      if (rec.state === 'locked' || (e && e.name === 'PasswordException')) { remove(rec.id); return; } // "Leave this file out"
      throw Object.assign(new Error('pdf'), { code: 'E4' });
    }
    rec.pw = null;
    rec.state = 'reading';
    rec.doc = doc;
    for (let p = 1; p <= doc.numPages; p++) {
      if (rec.removed) return;
      rec.pages.push(await readPage(doc, p));
    }
    for (const pg of rec.pages) {
      if (rec.removed) return;
      if (!pg.isText) {
        const r = await renderPage(doc, pg.page, THUMB_PX * 2);
        pg.thumb = await thumbnail(r.canvas, r.w, r.h);
        r.canvas.width = r.canvas.height = 0;
      }
    }
  }

  async function readImage(rec) {
    const bmp = await decodeImage(rec);
    const pg = { page: 1, isText: false, items: null, text: '', chars: 0 };
    pg.thumb = await thumbnail(bmp, bmp.width, bmp.height);
    if (bmp.close) bmp.close();
    rec.pages.push(pg);
    if (onPhoto) onPhoto();
  }

  async function process(rec) {
    if (rec.removed) return;
    rec.state = 'reading';
    rec.pages = [];
    rec.error = null;
    changed();
    setStatus(T.readingFile(rec.name));
    try {
      const buf = await rec.file.arrayBuffer();
      rec.sha = await sha256Hex(buf);
      if (files.some((f) => f !== rec && f.sha === rec.sha)) { remove(rec.id); return; } // the same file twice
      if (rec.kind === 'pdf') await readPdf(rec, new Uint8Array(buf));
      else await readImage(rec);
      if (rec.removed) return;
      rec.state = 'ok';
    } catch (e) {
      if (rec.removed) return;
      rec.pages.forEach((p) => p.thumb && URL.revokeObjectURL(p.thumb));
      rec.pages = [];
      rec.state = 'error';
      const code = e && e.code ? e.code : 'E4';
      rec.error = { code, text: T[code](rec.name), remove: code !== 'E7', retry: code === 'E7' };
    } finally {
      setStatus('');
    }
    changed();
  }

  function enqueue(rec) {
    pending++;
    queue = queue.then(() => process(rec)).catch(() => {}).then(() => { pending--; if (!pending) changed(); });
  }

  function add(list) {
    const incoming = [...list];
    const notes = [];
    const room = Math.max(0, MAX_FILES - files.length);
    const take = incoming.slice(0, room);
    const leftOut = incoming.slice(room);
    if (leftOut.length) {
      notes.push(h('div', { class: 'msg msg--error', dataset: { error: 'E1' } },
        h('p', {}, T.E1(leftOut.length)),
        h('details', {}, h('summary', {}, T.E1names(leftOut.length)), h('ul', { class: 'small' }, leftOut.map((f) => h('li', {}, f.name))))));
    }
    for (const file of take) {
      const kind = kindOf(file);
      if (!kind) { notes.push(h('p', { class: 'msg msg--error', dataset: { error: 'E3' } }, T.E3(file.name))); continue; }
      const rec = { id: nextId('f'), file, name: file.name, size: file.size, kind, sha: null, state: 'queued', pages: [], error: null, doc: null };
      files.push(rec);
      if (file.size > MAX_FILE_BYTES) {
        rec.state = 'error';
        rec.error = { code: 'E2', text: T.E2(file.name, Math.round(file.size / 1048576)), remove: true };
        continue;
      }
      enqueue(rec);
    }
    clear(alertEl);
    notes.forEach((n) => alertEl.append(n));
    alertEl.hidden = notes.length === 0;
    changed();
  }

  function disposeRec(rec) {
    rec.removed = true;
    rec.pages.forEach((p) => { if (p.thumb) URL.revokeObjectURL(p.thumb); p.thumb = null; p.items = null; p.text = ''; });
    if (rec.pw) { const g = rec.pw.giveUp; rec.pw = null; try { g(); } catch (e) { /* gone */ } }
    if (rec.doc) { const d = rec.doc; rec.doc = null; d.destroy().catch(() => {}); }
    rec.file = null;
  }

  function remove(id) {
    const i = files.findIndex((f) => f.id === id);
    if (i < 0) return;
    const [rec] = files.splice(i, 1);
    disposeRec(rec);
    changed();
  }

  // Drops every file, thumbnail and pdf.js document (Download / Clear now, D13).
  function clearAll() {
    files.splice(0).forEach(disposeRec);
    clear(alertEl);
    alertEl.hidden = true;
    changed();
  }

  // Full-size source for the rasteriser, decoded on demand (nothing large is kept between pages).
  async function sourceFor(rec, pageNo) {
    if (rec.kind === 'pdf') {
      const r = await renderPage(rec.doc, pageNo, 2000);
      return { source: r.canvas, w: r.w, h: r.h, dispose: () => { r.canvas.width = r.canvas.height = 0; } };
    }
    const bmp = await decodeImage(rec);
    return { source: bmp, w: bmp.width, h: bmp.height, dispose: () => { if (bmp.close) bmp.close(); } };
  }

  return {
    files,
    add,
    remove,
    clearAll,
    sourceFor,
    get busy() { return pending > 0 || files.some((f) => f.state === 'reading' || f.state === 'queued' || f.state === 'locked'); },
    ready: () => files.filter((f) => f.state === 'ok'),
  };
}
