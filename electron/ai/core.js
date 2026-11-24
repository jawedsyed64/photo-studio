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
};

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

module.exports = { MODELS, resize, toCHW, createSession, removeBackground, upscale, inpaint };
