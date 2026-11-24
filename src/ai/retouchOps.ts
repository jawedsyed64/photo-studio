// Image helpers for retouching & restoration (pure canvas / pixel code).
import { canvas, ctx2d } from './assets';

export const FFHQ_512 = [[0.37691676, 0.46864664], [0.62285697, 0.46912813], [0.50123859, 0.61331904], [0.39308822, 0.72541100], [0.61150205, 0.72490465]].map(([x, y]) => [x * 512, y * 512]);

/** Least-squares similarity transform mapping src points onto dst points. Canvas matrix [a, b, c, d, e, f]. */
export function similarity(src: number[][], dst: number[][]): [number, number, number, number, number, number] {
  const n = src.length;
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { sx += src[i][0]; sy += src[i][1]; dx += dst[i][0]; dy += dst[i][1]; }
  sx /= n; sy /= n; dx /= n; dy /= n;
  let num1 = 0, num2 = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const px = src[i][0] - sx, py = src[i][1] - sy, qx = dst[i][0] - dx, qy = dst[i][1] - dy;
    num1 += px * qx + py * qy; num2 += px * qy - py * qx; den += px * px + py * py;
  }
  const a = num1 / den, b = num2 / den;
  return [a, b, -b, a, dx - (a * sx - b * sy), dy - (b * sx + a * sy)];
}
export function invert(m: number[]): [number, number, number, number, number, number] {
  const [a, b, c, d, e, f] = m, det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}
export function apply(m: number[], x: number, y: number) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

/** Aligned 512×512 face crop from `src` using matrix M (src -> template). */
export function warpCrop(src: CanvasImageSource, M: number[]) {
  const c = canvas(512, 512), x = ctx2d(c);
  x.imageSmoothingQuality = 'high';
  x.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
  x.drawImage(src, 0, 0);
  return c;
}

export function rgbaOf(c: HTMLCanvasElement) { return new Uint8Array(ctx2d(c).getImageData(0, 0, c.width, c.height).data.buffer); }

/** Soft mask in template space for pasting a restored face back (1 inside, fading to 0 at the border). */
export function pasteMask512() {
  const c = canvas(512, 512), x = ctx2d(c);
  const g = x.createRadialGradient(256, 270, 150, 256, 270, 250);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 512, 512);
  return c;
}

const FACE = new Set([1, 2, 3, 4, 5, 10, 11, 12, 13]);
/** Build template-space mask images from face-parsing labels. A: skin/eyes/teeth, B: hair/under-eye/face. */
export function labelMasks(lab: Uint8Array) {
  const A = canvas(512, 512), B = canvas(512, 512);
  const ia = ctx2d(A).createImageData(512, 512), ib = ctx2d(B).createImageData(512, 512);
  const ue = [[193, 274], [319, 274]];
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const i = y * 512 + x, l = lab[i], o = i * 4;
    const skin = l === 1 || l === 10 || l === 14 || l === 7 || l === 8 ? 255 : 0;
    ia.data[o] = skin; ia.data[o + 1] = l === 4 || l === 5 ? 255 : 0; ia.data[o + 2] = l === 11 ? 255 : 0; ia.data[o + 3] = 255;
    let under = 0;
    if (l === 1) for (const [cx, cy] of ue) { const d = ((x - cx) / 52) ** 2 + ((y - cy) / 24) ** 2; if (d < 1) under = Math.max(under, Math.round(255 * (1 - d) ** 1.5)); }
    ib.data[o] = l === 17 ? 255 : 0; ib.data[o + 1] = under; ib.data[o + 2] = FACE.has(l) ? 255 : 0; ib.data[o + 3] = 255;
  }
  ctx2d(A).putImageData(ia, 0, 0); ctx2d(B).putImageData(ib, 0, 0);
  return { A, B };
}

/** Mean skin colour (0..1) from an aligned crop and its labels. */
export function skinMean(crop: HTMLCanvasElement, lab: Uint8Array): [number, number, number] {
  const d = ctx2d(crop).getImageData(0, 0, 512, 512).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < 512 * 512; i += 3) if (lab[i] === 1) { r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; n++; }
  return n ? [r / n / 255, g / n / 255, b / n / 255] : [0.8, 0.6, 0.5];
}

// ---------------- healing / clone ----------------
export interface Region { x: number; y: number; w: number; h: number }

export function maskBBox(m: HTMLCanvasElement): Region | null {
  const d = ctx2d(m).getImageData(0, 0, m.width, m.height).data;
  let x0 = m.width, y0 = m.height, x1 = -1, y1 = -1;
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (d[(y * m.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Find a good source offset for spot healing by comparing the border ring around the hole. */
function findSource(work: HTMLCanvasElement, R: Region, hole: Uint8Array): [number, number] {
  const W = work.width, H = work.height;
  const span = Math.max(R.w, R.h);
  const ax = Math.max(0, R.x - span * 3), ay = Math.max(0, R.y - span * 3);
  const aw = Math.min(W, R.x + R.w + span * 3) - ax, ah = Math.min(H, R.y + R.h + span * 3) - ay;
  const area = ctx2d(work).getImageData(ax, ay, aw, ah).data;
  const px = (x: number, y: number) => ((y - ay) * aw + (x - ax)) * 4;
  const step = Math.max(1, Math.round(span / 24));
  let best: [number, number] = [span * 1.5, 0], bestScore = Infinity;
  for (const dist of [1.2, 1.8, 2.5]) for (let k = 0; k < 16; k++) {
    const ang = (k / 16) * Math.PI * 2, ox = Math.round(Math.cos(ang) * span * dist), oy = Math.round(Math.sin(ang) * span * dist);
    if (R.x + ox < ax || R.y + oy < ay || R.x + R.w + ox > ax + aw || R.y + R.h + oy > ay + ah) continue;
    let sc = 0, n = 0;
    for (let y = 0; y < R.h; y += step) for (let x = 0; x < R.w; x += step) {
      const inHole = hole[y * R.w + x] > 0;
      const a = px(R.x + x, R.y + y), b = px(R.x + x + ox, R.y + y + oy);
      if (!inHole) { sc += Math.abs(area[a] - area[b]) + Math.abs(area[a + 1] - area[b + 1]) + Math.abs(area[a + 2] - area[b + 2]); n++; }
      else sc += 0.02 * Math.abs(area[b] - (area[a] + area[b]) / 2); // mild preference for plain texture
    }
    sc /= Math.max(1, n);
    if (sc < bestScore) { bestScore = sc; best = [ox, oy]; }
  }
  return best;
}

/**
 * Build a healing / clone patch. `stroke` is the painted mask (any resolution, same aspect as `work`).
 * Returns the patch canvas and its region in working pixels, or null if nothing was painted.
 */
export function healPatch(work: HTMLCanvasElement, stroke: HTMLCanvasElement, mode: 'spot' | 'heal' | 'clone', offset: [number, number] | null, brushPx: number) {
  const bb = maskBBox(stroke); if (!bb) return null;
  const W = work.width, H = work.height, k = W / stroke.width;
  const pad = Math.ceil(Math.max(6, brushPx * 0.6));
  let R: Region = { x: Math.max(0, Math.floor(bb.x * k - pad)), y: Math.max(0, Math.floor(bb.y * k - pad)), w: 0, h: 0 };
  R.w = Math.min(W, Math.ceil((bb.x + bb.w) * k + pad)) - R.x; R.h = Math.min(H, Math.ceil((bb.y + bb.h) * k + pad)) - R.y;
  // hole mask at working resolution
  const mc = canvas(R.w, R.h), mx = ctx2d(mc);
  mx.drawImage(stroke, R.x / k, R.y / k, R.w / k, R.h / k, 0, 0, R.w, R.h);
  const md = mx.getImageData(0, 0, R.w, R.h).data, hole = new Uint8Array(R.w * R.h);
  for (let i = 0; i < hole.length; i++) hole[i] = md[i * 4 + 3] > 20 ? 1 : 0;
  let [ox, oy] = mode === 'spot' || !offset ? findSource(work, R, hole) : offset;
  // keep the source inside the image
  ox = Math.max(-R.x, Math.min(W - R.x - R.w, ox)); oy = Math.max(-R.y, Math.min(H - R.y - R.h, oy));
  const src = canvas(R.w, R.h); ctx2d(src).drawImage(work, R.x + ox, R.y + oy, R.w, R.h, 0, 0, R.w, R.h);
  const out = canvas(R.w, R.h), oc = ctx2d(out);
  if (mode === 'clone') oc.drawImage(src, 0, 0);
  else {
    const rad = Math.max(3, Math.round(brushPx * 0.5));
    // normalised blur of the destination *excluding* the hole (canvas premultiplication does the weighting)
    const dEx = canvas(R.w, R.h), dx = ctx2d(dEx);
    dx.drawImage(work, R.x, R.y, R.w, R.h, 0, 0, R.w, R.h);
    dx.globalCompositeOperation = 'destination-out'; dx.filter = 'blur(1px)'; dx.drawImage(mc, 0, 0); dx.drawImage(mc, 0, 0);
    const dB = canvas(R.w, R.h), dbx = ctx2d(dB); dbx.filter = `blur(${rad}px)`; dbx.drawImage(dEx, 0, 0);
    const sB = canvas(R.w, R.h), sbx = ctx2d(sB); sbx.filter = `blur(${rad}px)`; sbx.drawImage(src, 0, 0);
    const s = ctx2d(src).getImageData(0, 0, R.w, R.h), db = dbx.getImageData(0, 0, R.w, R.h).data, sb = sbx.getImageData(0, 0, R.w, R.h).data;
    for (let i = 0; i < R.w * R.h; i++) {
      const o = i * 4;
      const ok = db[o + 3] > 10;
      for (let c = 0; c < 3; c++) {
        const target = ok ? db[o + c] : sb[o + c];
        s.data[o + c] = s.data[o + c] + target - sb[o + c];
      }
      s.data[o + 3] = 255;
    }
    oc.putImageData(s, 0, 0);
  }
  // feathered alpha from the stroke
  const a = canvas(R.w, R.h), ax = ctx2d(a);
  ax.filter = `blur(${Math.max(1, brushPx * 0.12)}px)`; ax.drawImage(mc, 0, 0);
  oc.globalCompositeOperation = 'destination-in'; oc.drawImage(a, 0, 0);
  return { patch: out, region: R };
}

// ---------------- dust & scratches (web worker) ----------------
const DUST_SRC = `
self.onmessage = e => {
  const { data, w, h, r, thr } = e.data;
  const n = w * h, Y = new Uint8Array(n);
  for (let i = 0; i < n; i++) Y[i] = (data[i*4]*54 + data[i*4+1]*183 + data[i*4+2]*19) >> 8;
  const minmax = (src, isMin, horiz) => {
    const out = new Uint8Array(n);
    const L = horiz ? w : h, M = horiz ? h : w;
    for (let j = 0; j < M; j++) for (let i = 0; i < L; i++) {
      let v = isMin ? 255 : 0;
      for (let k = Math.max(0, i - r); k <= Math.min(L - 1, i + r); k++) {
        const p = horiz ? src[j * w + k] : src[k * w + j];
        v = isMin ? (p < v ? p : v) : (p > v ? p : v);
      }
      out[horiz ? j * w + i : i * w + j] = v;
    }
    return out;
  };
  const erode = s => minmax(minmax(s, true, true), true, false);
  const dilate = s => minmax(minmax(s, false, true), false, false);
  self.postMessage({ progress: 0.2 });
  const open = dilate(erode(Y));
  self.postMessage({ progress: 0.5 });
  const close = erode(dilate(Y));
  self.postMessage({ progress: 0.8 });
  const bad = new Uint8Array(n); let count = 0;
  for (let i = 0; i < n; i++) if (Y[i] - open[i] > thr || close[i] - Y[i] > thr) { bad[i] = 1; count++; }
  // grow defects by one pixel
  const bad2 = new Uint8Array(bad);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (bad[i]) { bad2[i-1]=1; bad2[i+1]=1; bad2[i-w]=1; bad2[i+w]=1; } }
  // fill defects with the mean of good neighbours (integral images)
  const R = r + 2, W1 = w + 1;
  const S = [new Float64Array((w+1)*(h+1)), new Float64Array((w+1)*(h+1)), new Float64Array((w+1)*(h+1)), new Float64Array((w+1)*(h+1))];
  for (let y = 0; y < h; y++) { const rs = [0,0,0,0]; for (let x = 0; x < w; x++) { const i = y*w+x, g = bad2[i] ? 0 : 1; rs[0]+=data[i*4]*g; rs[1]+=data[i*4+1]*g; rs[2]+=data[i*4+2]*g; rs[3]+=g; for (let c = 0; c < 4; c++) S[c][(y+1)*W1+x+1] = S[c][y*W1+x+1] + rs[c]; } }
  const out = new Uint8ClampedArray(data);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y*w+x; if (!bad2[i]) continue;
    let rad = R, cnt = 0, sums = [0,0,0];
    while (rad < R * 4) {
      const x0 = Math.max(0, x-rad), y0 = Math.max(0, y-rad), x1 = Math.min(w, x+rad+1), y1 = Math.min(h, y+rad+1);
      const q = c => S[c][y1*W1+x1] - S[c][y0*W1+x1] - S[c][y1*W1+x0] + S[c][y0*W1+x0];
      cnt = q(3); if (cnt > 3) { sums = [q(0), q(1), q(2)]; break; } rad *= 2;
    }
    if (cnt > 0) { out[i*4] = sums[0]/cnt; out[i*4+1] = sums[1]/cnt; out[i*4+2] = sums[2]/cnt; }
  }
  self.postMessage({ done: true, data: out, count }, [out.buffer]);
};`;

export function removeDust(img: ImageData, size: number, sensitivity: number, onProgress: (p: number) => void): Promise<{ data: Uint8ClampedArray; count: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([DUST_SRC], { type: 'text/javascript' }));
    const wk = new Worker(url);
    const thr = Math.round(255 * (0.3 - (sensitivity / 100) * 0.25));
    wk.onmessage = e => {
      if (e.data.progress != null) onProgress(e.data.progress);
      if (e.data.done) { wk.terminate(); URL.revokeObjectURL(url); resolve({ data: e.data.data, count: e.data.count }); }
    };
    wk.onerror = e => { wk.terminate(); URL.revokeObjectURL(url); reject(new Error(e.message)); };
    wk.postMessage({ data: img.data, w: img.width, h: img.height, r: Math.max(1, Math.round(size)), thr });
  });
}
