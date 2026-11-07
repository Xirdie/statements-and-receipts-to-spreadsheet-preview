// Rasteriser (D19, G2): greyscale, white-margin trim, scaled to fit BOTH a 1,568 px long edge
// and ceil(w/28) x ceil(h/28) <= 2,464 tokens, JPEG quality 0.8 -> 0.5 until <= 450 KB.
// Output is an ArrayBuffer (never a Blob held in memory). fitBox/tokensOf are pure and
// importable from Node (worker/test/raster-fit.test.mjs); everything else needs a DOM.
import { IMG_LONG_EDGE, IMG_TOKEN_TARGET, IMG_MAX_BYTES, JPEG_QUALITIES, THUMB_PX } from './limits.js';

export const tokensOf = (w, h) => Math.ceil(w / 28) * Math.ceil(h / 28);

// Largest integer box inside both caps, never upscaled.
export function fitBox(w, h, longEdge = IMG_LONG_EDGE, maxTokens = IMG_TOKEN_TARGET) {
  if (!(w > 0 && h > 0)) throw new Error('bad size');
  let s = Math.min(1, longEdge / Math.max(w, h));
  const dims = (k) => [Math.max(1, Math.floor(w * k)), Math.max(1, Math.floor(h * k))];
  let [W, H] = dims(s);
  if (tokensOf(W, H) > maxTokens) {
    s *= Math.sqrt((maxTokens * 784) / (W * H));
    [W, H] = dims(s);
  }
  while (tokensOf(W, H) > maxTokens) { s *= 0.995; [W, H] = dims(s); }
  return { w: W, h: H, scale: s, tokens: tokensOf(W, H) };
}
export const fit = fitBox;

// ---------- DOM part ----------
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toJpeg(c, q) {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', q));
}

// Ink bounding box on a greyscale reading of the work canvas; white margins trimmed with 1% padding.
function inkBox(ctx, w, h) {
  const step = Math.max(1, Math.floor(Math.max(w, h) / 800)); // sample grid keeps this cheap
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (lum < 225 && d[i + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w, h };
  const pad = Math.round(Math.max(w, h) * 0.01) + step;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function greyscale(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    d[i] = d[i + 1] = d[i + 2] = g; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// source: ImageBitmap | HTMLCanvasElement | HTMLImageElement with natural size sw x sh.
// -> { buf: ArrayBuffer, w, h, bytes, tokens }
export async function rasterise(source, sw, sh) {
  const work = canvas(sw, sh);
  const wctx = work.getContext('2d', { willReadFrequently: true });
  wctx.fillStyle = '#fff';
  wctx.fillRect(0, 0, sw, sh);
  wctx.drawImage(source, 0, 0, sw, sh);
  const box = inkBox(wctx, sw, sh);
  let shrink = 1;
  for (let round = 0; round < 6; round++) {
    const f = fitBox(box.w * shrink, box.h * shrink);
    const out = canvas(f.w, f.h);
    const octx = out.getContext('2d', { willReadFrequently: true });
    octx.fillStyle = '#fff';
    octx.fillRect(0, 0, f.w, f.h);
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(work, box.x, box.y, box.w, box.h, 0, 0, f.w, f.h);
    greyscale(octx, f.w, f.h);
    for (const q of JPEG_QUALITIES) {
      const blob = await toJpeg(out, q);
      if (blob.size <= IMG_MAX_BYTES) {
        const buf = await blob.arrayBuffer();
        out.width = out.height = 0;
        work.width = work.height = 0;
        return { buf, w: f.w, h: f.h, bytes: buf.byteLength, tokens: f.tokens };
      }
    }
    out.width = out.height = 0;
    shrink *= 0.85;
  }
  work.width = work.height = 0;
  throw new Error('raster too large');
}

// 96 px thumbnail as an object URL (revoked on Download / Clear now).
export async function thumbnail(source, sw, sh) {
  const k = THUMB_PX / Math.max(sw, sh);
  const c = canvas(Math.max(1, Math.round(sw * k)), Math.max(1, Math.round(sh * k)));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(source, 0, 0, c.width, c.height);
  const blob = await toJpeg(c, 0.7);
  c.width = c.height = 0;
  return URL.createObjectURL(blob);
}

// ArrayBuffer -> base64 (chunked: no call-stack blow-up on 450 KB).
export function toBase64(buf) {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export const base64Length = (bytes) => 4 * Math.ceil(bytes / 3);
