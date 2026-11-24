// Inference worker – runs in an Electron utility process so heavy AI work
// never freezes the editor window.
'use strict';
const core = require('./core');
let ort = null;
const sessions = new Map(); // modelPath -> session
const cancelled = new Set();

function post(msg) { process.parentPort.postMessage(msg); }

async function getSession(path, cpuOnly) {
  if (!ort) ort = require('onnxruntime-node');
  const key = path + (cpuOnly ? '#cpu' : '');
  if (!sessions.has(key)) sessions.set(key, await core.createSession(ort, path, !cpuOnly));
  return sessions.get(key);
}

async function runOp(msg, cpuOnly) {
  const s = await getSession(msg.modelPath, cpuOnly);
  const spec = core.MODELS[msg.model];
  post({ id: msg.id, type: 'info', provider: s.__provider });
  if (msg.op === 'removeBg') {
    const mask = await core.removeBackground(ort, s, spec, msg.rgba, msg.width, msg.height);
    return { mask, width: msg.width, height: msg.height };
  }
  if (msg.op === 'upscale') {
    return core.upscale(ort, s, spec, msg.rgba, msg.width, msg.height,
      p => post({ id: msg.id, type: 'progress', p }), { isCancelled: () => cancelled.has(msg.id), tile: msg.tile || 256 });
  }
  if (msg.op === 'inpaint') {
    const data = await core.inpaint(ort, s, spec, msg.rgba, msg.mask, msg.width, msg.height);
    return { data, width: msg.width, height: msg.height };
  }
  throw new Error('Unknown AI operation: ' + msg.op);
}

process.parentPort.on('message', async e => {
  const msg = e.data;
  if (msg.op === 'cancel') { cancelled.add(msg.id); return; }
  try {
    let result;
    try { result = await runOp(msg, false); }
    catch (err) {
      // Some GPU drivers fail on particular layers – retry once on the CPU.
      const s = sessions.get(msg.modelPath);
      if (s && s.__provider === 'gpu' && !/Cancelled/.test(String(err))) {
        post({ id: msg.id, type: 'info', provider: 'cpu', note: 'GPU failed, using CPU' });
        result = await runOp(msg, true);
      } else throw err;
    }
    post({ id: msg.id, type: 'done', result });
  } catch (err) {
    post({ id: msg.id, type: 'error', message: String(err && err.message || err) });
  } finally { cancelled.delete(msg.id); }
});
