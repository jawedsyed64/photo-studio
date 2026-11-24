// AI services for the main process: model downloads, the inference worker,
// and online generation through Replicate.
'use strict';
const { app, net, utilityProcess, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { MODELS } = require('./core');

const modelDir = () => { const d = path.join(app.getPath('userData'), 'models'); fs.mkdirSync(d, { recursive: true }); return d; };
const modelPath = id => path.join(modelDir(), MODELS[id].file);
const installed = id => { try { return fs.statSync(modelPath(id)).size > 1000; } catch { return false; } };

// ---------------- downloads ----------------
const downloads = new Map(); // id -> AbortController

async function download(id, send) {
  const spec = MODELS[id];
  if (!spec) throw new Error('Unknown model');
  if (installed(id)) return true;
  if (downloads.has(id)) throw new Error('Already downloading');
  const ctrl = new AbortController();
  downloads.set(id, ctrl);
  const tmp = modelPath(id) + '.part';
  try {
    const res = await net.fetch(spec.url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
    const total = Number(res.headers.get('content-length')) || spec.size;
    const out = fs.createWriteStream(tmp);
    const hash = crypto.createHash('sha256');
    let received = 0, last = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      received += value.length;
      if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
      const now = Date.now();
      if (now - last > 200) { last = now; send('ai-download-progress', { id, received, total }); }
    }
    await new Promise((r, j) => out.end(err => err ? j(err) : r()));
    const digest = hash.digest('hex');
    if (spec.sha256 && digest !== spec.sha256) throw new Error('Downloaded file is damaged (checksum mismatch). Please try again.');
    fs.renameSync(tmp, modelPath(id));
    send('ai-download-progress', { id, received: total, total, done: true });
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    send('ai-download-progress', { id, error: ctrl.signal.aborted ? 'Cancelled' : String(e.message || e) });
    throw ctrl.signal.aborted ? new Error('Cancelled') : e;
  } finally { downloads.delete(id); }
}

// ---------------- inference worker ----------------
let worker = null;
const jobs = new Map(); // id -> { resolve, reject, send }
let jobSeq = 1;

function getWorker() {
  if (worker) return worker;
  worker = utilityProcess.fork(path.join(__dirname, 'worker.js'), [], { serviceName: 'Photo Studio AI' });
  worker.on('message', m => {
    const j = jobs.get(m.id); if (!j) return;
    if (m.type === 'progress') j.send('ai-progress', { job: m.id, p: m.p });
    else if (m.type === 'info') j.send('ai-progress', { job: m.id, provider: m.provider, note: m.note });
    else { jobs.delete(m.id); m.type === 'done' ? j.resolve(m.result) : j.reject(new Error(m.message)); }
  });
  worker.on('exit', code => {
    worker = null;
    for (const [, j] of jobs) j.reject(new Error(`The AI engine stopped (code ${code}). The photo may be too large for available memory.`));
    jobs.clear();
  });
  return worker;
}

function runJob(payload, send) {
  if (!installed(payload.model)) return Promise.reject(new Error('MODEL_MISSING:' + payload.model));
  const id = jobSeq++;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject, send });
    send('ai-progress', { job: id, started: true });
    getWorker().postMessage({ ...payload, id, modelPath: modelPath(payload.model) });
  });
}

// ---------------- Replicate (online) ----------------
function getKey() {
  const f = path.join(app.getPath('userData'), 'secrets.json');
  try {
    const v = JSON.parse(fs.readFileSync(f, 'utf8')).replicate;
    if (!v || !safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(v, 'base64'));
  } catch { return null; }
}

async function replicateError(res) {
  let detail = '';
  try { const j = await res.json(); detail = j.detail || j.title || JSON.stringify(j); } catch { /* ignore */ }
  if (res.status === 401) return new Error('Your Replicate API key was rejected. Please check it in Settings.');
  if (res.status === 402) return new Error('Your Replicate account has no credit. Add billing at replicate.com, then try again.');
  if (res.status === 429) return new Error('Replicate is rate-limiting requests. Please wait a minute and try again.');
  return new Error(`Replicate error ${res.status}: ${detail}`);
}

async function replicateRun(model, input, onStatus) {
  const key = getKey();
  if (!key) throw new Error('NO_KEY');
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'wait=60' };
  let res = await net.fetch(`https://api.replicate.com/v1/models/${model}/predictions`, { method: 'POST', headers, body: JSON.stringify({ input }) });
  if (!res.ok) throw await replicateError(res);
  let p = await res.json();
  const started = Date.now();
  while (p.status === 'starting' || p.status === 'processing') {
    if (Date.now() - started > 5 * 60 * 1000) throw new Error('Replicate took too long to respond.');
    onStatus(p.status);
    await new Promise(r => setTimeout(r, 1500));
    res = await net.fetch(p.urls.get, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw await replicateError(res);
    p = await res.json();
  }
  if (p.status !== 'succeeded') throw new Error('Generation failed: ' + (p.error || p.status));
  const url = Array.isArray(p.output) ? p.output[0] : p.output;
  if (!url) throw new Error('Replicate returned no image.');
  const img = await net.fetch(url);
  if (!img.ok) throw new Error('Could not download the generated image.');
  return new Uint8Array(await img.arrayBuffer());
}

const ONLINE = {
  generate: { model: 'black-forest-labs/flux-schnell', input: a => ({ prompt: a.prompt, aspect_ratio: a.aspect || '3:2', output_format: 'png', num_outputs: 1 }) },
  edit: { model: 'black-forest-labs/flux-kontext-pro', input: a => ({ prompt: a.prompt, input_image: 'data:image/jpeg;base64,' + Buffer.from(a.image).toString('base64'), aspect_ratio: 'match_input_image', output_format: 'png', safety_tolerance: 2 }) },
};

// ---------------- IPC ----------------
function register(getWin) {
  const send = (ch, data) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, data); };
  ipcMain.handle('ai-models', async () => Object.entries(MODELS).map(([id, m]) => ({
    id, name: m.name, size: m.size, license: m.license, installed: installed(id), downloading: downloads.has(id),
  })));
  ipcMain.handle('ai-download', async (_e, id) => download(id, send));
  ipcMain.handle('ai-cancel-download', async (_e, id) => { downloads.get(id)?.abort(); });
  ipcMain.handle('ai-delete-model', async (_e, id) => { try { fs.unlinkSync(modelPath(id)); } catch { /* ignore */ } return true; });
  ipcMain.handle('ai-run', async (_e, payload) => runJob(payload, send));
  ipcMain.handle('ai-cancel', async (_e, job) => { worker?.postMessage({ op: 'cancel', id: job }); });
  ipcMain.handle('ai-online', async (_e, kind, args) => {
    const o = ONLINE[kind]; if (!o) throw new Error('Unknown online operation');
    return replicateRun(o.model, o.input(args), status => send('ai-online-status', { status }));
  });
  ipcMain.handle('ai-has-key', async () => !!getKey());
}

module.exports = { register };
