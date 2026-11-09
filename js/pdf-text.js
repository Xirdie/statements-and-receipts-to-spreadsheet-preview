// pdf.js glue: open (with the in-page password prompt, D17), text items for the column parser,
// page -> canvas for the rasteriser and the 96 px thumbnails. pdf.js 4.10.38 is vendored; the
// core is prefetched on idle and its worker starts on the first PDF (core + worker > 450 KB gz).
import { TEXT_ITEMS_MIN, wireText } from './limits.js';

let libP = null;
const VENDOR = new URL('../vendor/', import.meta.url).href;

export function loadPdfjs() {
  if (!libP) {
    libP = import('../vendor/pdf.min.js').then((m) => {
      m.GlobalWorkerOptions.workerSrc = VENDOR + 'pdf.worker.min.js';
      return m;
    });
    libP.catch(() => { libP = null; });
  }
  return libP;
}

export function prefetchPdfjs() {
  const go = () => { loadPdfjs().catch(() => {}); };
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 4000 });
  else setTimeout(go, 1500);
}

// onPassword(wrong: boolean, submit(pw), giveUp()) is called whenever pdf.js needs a password.
// The password goes to pdf.js in this tab only.
export async function openPdf(bytes, onPassword) {
  const lib = await loadPdfjs();
  const task = lib.getDocument({
    data: bytes,
    cMapUrl: VENDOR + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: VENDOR + 'standard_fonts/',
    isEvalSupported: false,
    enableXfa: false,
  });
  task.onPassword = (update, reason) => {
    const wrong = reason === lib.PasswordResponses.INCORRECT_PASSWORD;
    onPassword(wrong, (pw) => update(pw), () => { task.destroy(); });
  };
  return task.promise;
}

// One page: {page, items: [{str,x,y,w,h}], text, chars, isText}
export async function readPage(doc, pageNo) {
  const page = await doc.getPage(pageNo);
  const tc = await page.getTextContent();
  const items = tc.items
    .filter((it) => typeof it.str === 'string' && it.str.trim() !== '')
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.height || it.transform[3]) }));
  const digits = items.filter((it) => /\d/.test(it.str)).length;
  // lone surrogates become U+FFFD (3 bytes) in a form entry: measure the well-formed string (R3);
  // a CR or LF inside an item's str is put in its wire form too (lone CR -> CRLF, R3 QA)
  const raw = linesOf(items);
  const text = wireText(typeof raw.toWellFormed === 'function' ? raw.toWellFormed() : raw);
  page.cleanup();
  // chars = UTF-8 bytes, the unit the Worker caps (TEXT_PAGE_CHARS = 8,000 bytes, qa #19)
  return { page: pageNo, items, text, chars: new TextEncoder().encode(text).length, isText: digits >= TEXT_ITEMS_MIN };
}

// Plain reading-order text for a text-fallback page (sent only after payment, only if its rows
// didn't add up, never over TEXT_PAGE_CHARS).
function linesOf(items) {
  const sorted = items.slice().sort((p, q) => (q.y - p.y) || (p.x - q.x));
  const lines = [];
  for (const it of sorted) {
    const l = lines[lines.length - 1];
    if (l && Math.abs(l.y - it.y) <= 2) l.parts.push(it); else lines.push({ y: it.y, parts: [it] });
  }
  // CRLF: multipart/form-data turns every bare LF of a string part into CRLF on the wire, so the
  // string measured here is byte-for-byte the string the Worker measures (R3, the UTF-8 byte gate)
  return lines.map((l) => l.parts.sort((a, b) => a.x - b.x).map((p) => p.str.trim()).join('  ')).join('\r\n');
}

// Render a page so its long edge is about `longEdge` px. -> {canvas, w, h}
export async function renderPage(doc, pageNo, longEdge) {
  const page = await doc.getPage(pageNo);
  const v1 = page.getViewport({ scale: 1 });
  const scale = Math.min(4, longEdge / Math.max(v1.width, v1.height));
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.floor(vp.width));
  c.height = Math.max(1, Math.floor(vp.height));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  // intent 'print' renders without requestAnimationFrame: the paid job runs in a background tab
  // (the buyer is on Stripe or paid.html), where rAF never fires.
  await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
  page.cleanup();
  return { canvas: c, w: c.width, h: c.height };
}
