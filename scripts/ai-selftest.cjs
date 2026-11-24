// CI self-test: downloads every offline AI model, checks its SHA-256, and runs
// real inference through electron/ai/core.js with onnxruntime-node.
// Usage: node scripts/ai-selftest.cjs <model-cache-dir>
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ort = require('onnxruntime-node');
const core = require('../electron/ai/core');

const dir = path.resolve(process.argv[2] || 'ai-models');
fs.mkdirSync(dir, { recursive: true });
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? '  PASS ' : '  FAIL ') + msg); if (!cond) failed++; };

async function fetchModel(id) {
  const m = core.MODELS[id], file = path.join(dir, m.file);
  if (!fs.existsSync(file)) {
    console.log(`Downloading ${m.file} …`);
    const res = await fetch(m.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`${id}: HTTP ${res.status} for ${m.url}`);
    fs.writeFileSync(file + '.part', Buffer.from(await res.arrayBuffer()));
    fs.renameSync(file + '.part', file);
  }
  const buf = fs.readFileSync(file);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  ok(sha === m.sha256, `${id}: sha256 ${sha.slice(0, 12)}… (${(buf.length / 1048576).toFixed(1)} MB, registry says ${(m.size / 1048576).toFixed(1)} MB)`);
  return file;
}

function synthetic(W, H) {
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    let r = 90 + 40 * Math.sin(x / 23), g = 150 + 30 * Math.sin(y / 17), b = 120;
    const cx = W / 2;
    if ((x - cx) ** 2 + (y - H * 0.31) ** 2 < (H * 0.125) ** 2) { r = 225; g = 180; b = 150; }
    if (y > H * 0.44 && Math.abs(x - cx) < W * 0.11 + (y - H * 0.44) * 0.4) { r = 40; g = 50; b = 160; }
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  }
  return rgba;
}

(async () => {
  console.log('onnxruntime-node', require('onnxruntime-node/package.json').version, 'on', process.platform, process.arch);
  for (const id of Object.keys(core.MODELS)) await fetchModel(id);

  for (const gpu of [false, true]) {
    if (gpu && process.platform !== 'win32') continue;
    console.log(`\n=== provider preference: ${gpu ? 'DirectML (GPU) with CPU fallback' : 'CPU'} ===`);
    const sess = async id => { const s = await core.createSession(ort, path.join(dir, core.MODELS[id].file), gpu); console.log(`  ${id} → ${s.__provider}`); return s; };

    // background removal
    const W = 640, H = 480, img = synthetic(W, H);
    for (const id of ['bg-fast', 'bg-best']) {
      const t = Date.now();
      const mask = await core.removeBackground(ort, await sess(id), core.MODELS[id], img, W, H);
      const at = (x, y) => mask[y * W + x];
      ok(mask.length === W * H, `${id}: mask size`);
      ok(at(320, 150) > 200 && at(320, 400) > 200, `${id}: subject detected (head ${at(320, 150)}, body ${at(320, 400)})`);
      ok(at(20, 20) < 50 && at(620, 300) < 50, `${id}: background removed (corner ${at(20, 20)}, side ${at(620, 300)}) in ${Date.now() - t} ms`);
    }

    // super-resolution
    for (const id of ['upscale-x2', 'upscale-x4']) {
      const w = 120, h = 90, small = synthetic(w, h), sc = core.MODELS[id].scale;
      const t = Date.now();
      const up = await core.upscale(ort, await sess(id), core.MODELS[id], small, w, h, null, { tile: 64, pad: 8 });
      ok(up.width === w * sc && up.height === h * sc, `${id}: output ${up.width}×${up.height}`);
      const ref = core.resize(small, w, h, 4, up.width, up.height);
      let diff = 0, n = 0;
      for (let i = 0; i < ref.length; i += 4 * 7) { diff += Math.abs(ref[i] - up.data[i]) + Math.abs(ref[i + 2] - up.data[i + 2]); n += 2; }
      ok(diff / n < 25, `${id}: colours preserved (mean diff ${(diff / n).toFixed(1)}) in ${Date.now() - t} ms`);
    }

    // inpainting
    {
      const w = 300, h = 220, im = synthetic(w, h);
      const mask = new Uint8Array(w * h);
      for (let y = 140; y < 200; y++) for (let x = 230; x < 270; x++) { mask[y * w + x] = 255; const i = (y * w + x) * 4; im[i] = 250; im[i + 1] = 240; im[i + 2] = 0; }
      const t = Date.now();
      const out = await core.inpaint(ort, await sess('inpaint'), core.MODELS.inpaint, im, mask, w, h);
      ok(out.length === w * h * 4, 'inpaint: output size');
      const i = (170 * w + 250) * 4;
      ok(!(out[i] > 200 && out[i + 1] > 200 && out[i + 2] < 60), `inpaint: object filled (pixel now ${out[i]},${out[i + 1]},${out[i + 2]}) in ${Date.now() - t} ms`);
      const j = (30 * w + 30) * 4;
      ok(Math.abs(out[j] - im[j]) < 40, `inpaint: surroundings kept (${out[j]} vs ${im[j]})`);
    }
  }
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll AI checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
