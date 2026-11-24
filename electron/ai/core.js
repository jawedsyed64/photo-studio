// AI image-processing core. Pure JavaScript, no Electron: used by the
// inference worker (utility process) and by the CI self-test.
// `ort` is onnxruntime-node (or any object with the same API).

'use strict';

// ---------------- model registry ----------------
const MODELS = {
  'bg-fast': {
    name: 'Background removal – Fast (Silueta)',
    file: 'silueta.onnx',
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx',
    sha256: '75da6c8d2f8096ec743d071951be73b4a8bc7b3e51d9a6625d63644f90ffeedb',
    size: 44173029,
    kind: 'segment', input: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225],
    license: 'Apache-2.0 (rembg / U²-Net)',
  },
  'bg-best': {
    name: 'Background removal – Best (IS-Net)',
    file: 'isnet-general-use.onnx',
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
    sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
    size: 178648008,
    kind: 'segment', input: 1024, mean: [0.485, 0.456, 0.406], std: [1, 1, 1],
    license: 'Apache-2.0 (DIS / IS-Net)',
  },
  'upscale-x2': {
    name: 'Upscale 2× (Real-ESRGAN x2plus)',
    file: 'real_esrgan_x2.onnx',
    url: 'https://huggingface.co/SceneWorks/real-esrgan-onnx/resolve/main/real_esrgan_x2.onnx',
    sha256: '7115ba92e8a1bfa63d68558ef006ef3d91273a068d321b1439f8bb1c9179002c',
    size: 67000000,
    kind: 'upscale', scale: 2,
    license: 'BSD-3-Clause (Real-ESRGAN)',
  },
  'upscale-x4': {
    name: 'Upscale 4× / Enhance (Real-ESRGAN x4plus)',
    file: 'real_esrgan_x4.onnx',
    url: 'https://huggingface.co/SceneWorks/real-esrgan-onnx/resolve/main/real_esrgan_x4.onnx',
    sha256: '5c586662929cbc686c1a5c38d9c060dbdb4ea5863a1f7672b8c0761e6b89c033',
    size: 67000000,
    kind: 'upscale', scale: 4,
    license: 'BSD-3-Clause (Real-ESRGAN)',
  },
  'inpaint': {
    name: 'Object removal (LaMa)',
    file: 'lama_fp32.onnx',
    url: 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx',
    sha256: '1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6',
    size: 208044816,
    kind: 'inpaint', input: 512,
    license: 'Apache-2.0 (LaMa)',
  },
  'face-detect': {
    name: 'Face detection (YOLOv8-face)',
    file: 'yoloface_8n.onnx',
    url: 'https://github.com/facefusion/facefusion-assets/releases/download/models-3.0.0/yoloface_8n.onnx',
    sha256: '821cdbb1e65fbbabdde7dd0933f754797a343e56fd962729c61ffcefcd135929',
    size: 12659761,
    kind: 'face-detect', input: 640,
    license: 'GPL-3.0 (YOLOv8-face)',
  },
  'face-parse': {
    name: 'Face parsing – skin, eyes, teeth, hair (BiSeNet)',
    file: 'face_parsing_resnet18.onnx',
    url: 'https://github.com/yakhyo/face-parsing/releases/download/v0.0.1/resnet18.onnx',
    sha256: '0d9bd318e46987c3bdbfacae9e2c0f461cae1c6ac6ea6d43bbe541a91727e33f',
    size: 53205364,
    kind: 'face-parse', input: 512, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225],
    license: 'MIT (face-parsing / BiSeNet)',
  },
  'face-restore': {
    name: 'Face restoration (GFPGAN 1.4)',
    file: 'gfpgan_1.4.onnx',
    url: 'https://github.com/facefusion/facefusion-assets/releases/download/models-3.0.0/gfpgan_1.4.onnx',
    sha256: 'accc4757b26bdb89b32b4d3500d4f79c9dff97c1dd7c7104bf9dcb95e3311385',
    size: 340299087,
    kind: 'face-restore', input: 512,
    license: 'Apache-2.0 (GFPGAN)',
  },
  'colorize': {
    name: 'Colorize black-and-white photos (DDColor)',
    file: 'ddcolor.onnx',
    url: 'https://github.com/facefusion/facefusion-assets/releases/download/models-3.0.0/ddcolor.onnx',
    sha256: 'dd6156f056d0690891ef35f9ee87176d4d976ab19bbd36e57d18e841e064d797',
    size: 980103562,
    kind: 'colorize', input: 512,
    license: 'Apache-2.0 (DDColor)',
  },
};

// FFHQ 512 alignment template (left eye, right eye, nose, left mouth, right mouth)
const FFHQ_512 = [[0.37691676, 0.46864664], [0.62285697, 0.46912813], [0.50123859, 0.61331904], [0.39308822, 0.72541100], [0.61150205, 0.72490465]].map(([x, y]) => [x * 512, y * 512]);

// ---------------- resizing helpers ----------------
/** Bilinear resize of interleaved `ch`-channel data (Uint8 or Float32). Pre-halves for big reductions. */
function resize(src, sw, sh, ch, dw, dh) {
  let cur = src, cw = sw, chh = sh;
  while (cw >= dw * 2 && chh >= dh * 2) {
    const nw = Math.floor(cw / 2), nh = Math.floor(chh / 2);
    const out = new (cur.constructor)(nw * nh * ch);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < ch; c++) {
      const i0 = ((2 * y) * cw + 2 * x) * ch + c, i1 = i0 + ch, i2 = i0 + cw * ch, i3 = i2 + ch;
      out[(y * nw + x) * ch + c] = (cur[i0] + cur[i1] + cur[i2] + cur[i3]) / 4;
    }
    cur = out; cw = nw; chh = nh;
  }
  if (cw === dw && chh === dh) return cur === src ? new (src.constructor)(src) : cur;
  const out = new (src.constructor)(dw * dh * ch);
  const sx = cw / dw, sy = chh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.max(0, Math.min(chh - 1, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(chh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.max(0, Math.min(cw - 1, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(cw - 1, x0 + 1), tx = fx - x0;
      for (let c = 0; c < ch; c++) {
        const a = cur[(y0 * cw + x0) * ch + c], b = cur[(y0 * cw + x1) * ch + c];
        const d = cur[(y1 * cw + x0) * ch + c], e = cur[(y1 * cw + x1) * ch + c];
        out[(y * dw + x) * ch + c] = (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty;
      }
    }
  }
  return out;
}

/** RGBA uint8 -> planar float32 CHW (RGB) with optional normalisation. */
function toCHW(rgba, w, h, mean = [0, 0, 0], std = [1, 1, 1], scale = 1 / 255) {
  const n = w * h, out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[c * n + i] = (rgba[i * 4 + c] * scale - mean[c]) / std[c];
  return out;
}

async function createSession(ort, modelPath, preferGpu = true) {
  const opts = { graphOptimizationLevel: 'all' };
  if (preferGpu && process.platform === 'win32') {
    try { const s = await ort.InferenceSession.create(modelPath, { ...opts, executionProviders: ['dml', 'cpu'] }); s.__provider = 'gpu'; return s; }
    catch (e) { /* DirectML not available – fall back to CPU */ }
  }
  const s = await ort.InferenceSession.create(modelPath, { ...opts, executionProviders: ['cpu'] });
  s.__provider = 'cpu';
  return s;
}

// ---------------- background removal ----------------
/** Returns a single-channel Uint8 mask (w*h) where 255 = subject. */
async function removeBackground(ort, session, spec, rgba, w, h) {
  const S = spec.input;
  // rembg-style: resize to S×S, divide by max value, normalise
  const small = resize(rgba, w, h, 4, S, S);
  let mx = 1;
  for (let i = 0; i < small.length; i += 4) mx = Math.max(mx, small[i], small[i + 1], small[i + 2]);
  const input = toCHW(small, S, S, spec.mean, spec.std, 1 / mx);
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, S, S]) };
  const out = await session.run(feeds);
  const pred = out[session.outputNames[0]].data;
  let mn = Infinity, ma = -Infinity;
  for (let i = 0; i < S * S; i++) { const v = pred[i]; if (v < mn) mn = v; if (v > ma) ma = v; }
  const rng = ma - mn || 1;
  const m8 = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) m8[i] = ((pred[i] - mn) / rng) * 255;
  const big = resize(m8, S, S, 1, w, h);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = Math.max(0, Math.min(255, Math.round(big[i])));
  return mask;
}

// ---------------- super-resolution (tiled) ----------------
/** Upscale RGBA by the model's scale using overlapping tiles. Alpha is resized bilinearly. */
async function upscale(ort, session, spec, rgba, w, h, onProgress, opts = {}) {
  const scale = spec.scale, tile = opts.tile || 256, pad = opts.pad || 16;
  const W = w * scale, H = h * scale;
  const out = new Uint8ClampedArray(W * H * 4);
  const tilesX = Math.ceil(w / tile), tilesY = Math.ceil(h / tile), total = tilesX * tilesY;
  let done = 0;
  for (let ty = 0; ty < tilesY; ty++) for (let tx = 0; tx < tilesX; tx++) {
    if (opts.isCancelled && opts.isCancelled()) throw new Error('Cancelled');
    const x0 = tx * tile, y0 = ty * tile, x1 = Math.min(w, x0 + tile), y1 = Math.min(h, y0 + tile);
    const px0 = Math.max(0, x0 - pad), py0 = Math.max(0, y0 - pad), px1 = Math.min(w, x1 + pad), py1 = Math.min(h, y1 + pad);
    const tw = px1 - px0, th = py1 - py0, n = tw * th;
    const inp = new Float32Array(3 * n);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const si = ((py0 + y) * w + px0 + x) * 4, di = y * tw + x;
      inp[di] = rgba[si] / 255; inp[n + di] = rgba[si + 1] / 255; inp[2 * n + di] = rgba[si + 2] / 255;
    }
    const res = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', inp, [1, 3, th, tw]) });
    const o = res[session.outputNames[0]], od = o.data;
    const ow = o.dims[3], oh = o.dims[2], on = ow * oh;
    // copy the un-padded part
    const ox = (x0 - px0) * scale, oy = (y0 - py0) * scale, cw = (x1 - x0) * scale, chh = (y1 - y0) * scale;
    for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
      const si = (oy + y) * ow + ox + x, di = ((y0 * scale + y) * W + x0 * scale + x) * 4;
      out[di] = od[si] * 255; out[di + 1] = od[on + si] * 255; out[di + 2] = od[2 * on + si] * 255; out[di + 3] = 255;
    }
    done++;
    if (onProgress) onProgress(done / total);
  }
  // alpha channel
  let hasAlpha = false;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) { hasAlpha = true; break; }
  if (hasAlpha) {
    const a = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) a[i] = rgba[i * 4 + 3];
    const A = resize(a, w, h, 1, W, H);
    for (let i = 0; i < W * H; i++) out[i * 4 + 3] = A[i];
  }
  return { data: out, width: W, height: H };
}

// ---------------- inpainting (object removal) ----------------
/** rgba: crop region; mask: Uint8 (w*h) >127 = remove. Returns RGBA of same size. */
async function inpaint(ort, session, spec, rgba, mask, w, h) {
  const S = spec.input;
  const img = resize(rgba, w, h, 4, S, S);
  const m = resize(mask, w, h, 1, S, S);
  const n = S * S;
  const inImg = toCHW(img, S, S);
  const inMask = new Float32Array(n);
  for (let i = 0; i < n; i++) inMask[i] = m[i] > 20 ? 1 : 0;
  const names = session.inputNames;
  const imgName = names.find(x => /image/i.test(x)) || names[0];
  const maskName = names.find(x => /mask/i.test(x)) || names[1];
  const res = await session.run({
    [imgName]: new ort.Tensor('float32', inImg, [1, 3, S, S]),
    [maskName]: new ort.Tensor('float32', inMask, [1, 1, S, S]),
  });
  const od = res[session.outputNames[0]].data;
  let mx = 0;
  for (let i = 0; i < od.length; i += 97) mx = Math.max(mx, od[i]);
  const k = mx > 2 ? 1 : 255; // output is 0..255 for Carve's export; handle 0..1 too
  const small = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    small[i * 4] = od[i] * k; small[i * 4 + 1] = od[n + i] * k; small[i * 4 + 2] = od[2 * n + i] * k; small[i * 4 + 3] = 255;
  }
  const big = resize(small, S, S, 4, w, h);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length; i++) out[i] = big[i];
  return out;
}

// ---------------- faces ----------------
function iou(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return i / (a.w * a.h + b.w * b.h - i + 1e-6);
}

/** Detect faces. Returns [{x,y,w,h,score,kps:[[x,y]×5]}] in image pixels, best first. */
async function detectFaces(ort, session, spec, rgba, w, h, minScore = 0.5) {
  const S = spec.input, k = S / Math.max(w, h);
  const rw = Math.max(1, Math.round(w * k)), rh = Math.max(1, Math.round(h * k));
  const small = resize(rgba, w, h, 4, rw, rh);
  const n = S * S, inp = new Float32Array(3 * n); // letterbox top-left, zero padding
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const si = (y * rw + x) * 4, di = y * S + x;
    inp[di] = small[si] / 255; inp[n + di] = small[si + 1] / 255; inp[2 * n + di] = small[si + 2] / 255;
  }
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', inp, [1, 3, S, S]) });
  const o = out[session.outputNames[0]], d = o.data, N = o.dims[2];
  const cands = [];
  for (let i = 0; i < N; i++) {
    const sc = d[4 * N + i];
    if (sc < minScore) continue;
    const cx = d[i] / k, cy = d[N + i] / k, bw = d[2 * N + i] / k, bh = d[3 * N + i] / k;
    const kps = [];
    for (let j = 0; j < 5; j++) kps.push([d[(5 + j * 3) * N + i] / k, d[(6 + j * 3) * N + i] / k]);
    cands.push({ x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh, score: sc, kps });
  }
  cands.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const c of cands) if (!keep.some(k2 => iou(k2, c) > 0.4)) keep.push(c);
  return keep;
}

/** Face parsing on an aligned 512×512 RGBA face crop → Uint8 labels (CelebAMask-HQ classes). */
async function parseFace(ort, session, spec, rgba) {
  const S = spec.input;
  const inp = toCHW(rgba, S, S, spec.mean, spec.std);
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', inp, [1, 3, S, S]) });
  const o = out[session.outputNames[0]], d = o.data, C = o.dims[1], n = S * S;
  const lab = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let best = 0, bv = d[i];
    for (let c = 1; c < C; c++) { const v = d[c * n + i]; if (v > bv) { bv = v; best = c; } }
    lab[i] = best;
  }
  return lab;
}

/** GFPGAN on an aligned 512×512 RGBA crop → RGBA 512×512. */
async function restoreFace(ort, session, spec, rgba) {
  const S = spec.input, n = S * S;
  const inp = toCHW(rgba, S, S, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', inp, [1, 3, S, S]) });
  const d = out[session.outputNames[0]].data;
  const res = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    res[i * 4] = (Math.max(-1, Math.min(1, d[i])) + 1) * 127.5;
    res[i * 4 + 1] = (Math.max(-1, Math.min(1, d[n + i])) + 1) * 127.5;
    res[i * 4 + 2] = (Math.max(-1, Math.min(1, d[2 * n + i])) + 1) * 127.5;
    res[i * 4 + 3] = 255;
  }
  return res;
}

// ---------------- colour space (matches OpenCV float sRGB <-> Lab, D65) ----------------
const lin = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const gam = v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
const fLab = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
const fInv = t => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };
function rgbToLab(r, g, b) {
  r = lin(r); g = lin(g); b = lin(b);
  const X = (0.412453 * r + 0.357580 * g + 0.180423 * b) / 0.950456;
  const Y = 0.212671 * r + 0.715160 * g + 0.072169 * b;
  const Z = (0.019334 * r + 0.119193 * g + 0.950227 * b) / 1.088754;
  const fy = fLab(Y);
  return [Y > 0.008856 ? 116 * fy - 16 : 903.3 * Y, 500 * (fLab(X) - fy), 200 * (fy - fLab(Z))];
}
function labToRgb(L, a, b) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const X = fInv(fx) * 0.950456, Y = L > 7.9996 ? fy * fy * fy : L / 903.3, Z = fInv(fz) * 1.088754;
  const r = 3.240479 * X - 1.537150 * Y - 0.498535 * Z;
  const g = -0.969256 * X + 1.875992 * Y + 0.041556 * Z;
  const bb = 0.055648 * X - 0.204043 * Y + 1.057311 * Z;
  return [gam(Math.max(0, r)), gam(Math.max(0, g)), gam(Math.max(0, bb))];
}

/** Colorize: returns RGBA of the same size with original lightness and predicted colour. */
async function colorize(ort, session, spec, rgba, w, h) {
  const S = spec.input, n = S * S;
  const small = resize(rgba, w, h, 4, S, S);
  const inp = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const L = rgbToLab(small[i * 4] / 255, small[i * 4 + 1] / 255, small[i * 4 + 2] / 255)[0];
    const g = labToRgb(L, 0, 0)[0];
    inp[i] = g; inp[n + i] = g; inp[2 * n + i] = g;
  }
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', inp, [1, 3, S, S]) });
  const d = out[session.outputNames[0]].data;
  const ab = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { ab[i * 2] = d[i]; ab[i * 2 + 1] = d[n + i]; }
  const AB = resize(ab, S, S, 2, w, h);
  const res = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const L = rgbToLab(rgba[i * 4] / 255, rgba[i * 4 + 1] / 255, rgba[i * 4 + 2] / 255)[0];
    const [r, g, b] = labToRgb(L, AB[i * 2], AB[i * 2 + 1]);
    res[i * 4] = r * 255; res[i * 4 + 1] = g * 255; res[i * 4 + 2] = b * 255; res[i * 4 + 3] = rgba[i * 4 + 3];
  }
  return res;
}

module.exports = { MODELS, FFHQ_512, resize, toCHW, createSession, removeBackground, upscale, inpaint, detectFaces, parseFace, restoreFace, colorize, rgbToLab, labToRgb };
