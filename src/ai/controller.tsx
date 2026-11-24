// Connects the AI services to the editor: keeps the "working image"
// (original or AI-enhanced base + object-removal patches), loads masks /
// backgrounds / style layers into the renderer, and runs every AI operation.
import { useCallback, useEffect, useRef, useState, MutableRefObject } from 'react';
import type { Renderer } from '../engine/Renderer';
import { EditState, clone, hexToRgbaSafe } from './util';
import { AssetStore, canvas, ctx2d, drawTo, scaleToFit, canvasToBytes, weightedMean } from './assets';
import { ai, aiError, ModelInfo } from './client';
import { Modal, toast, formatBytes } from '../ui/common';

export type BrushMode = null | 'object' | 'mask-add' | 'mask-erase';

export interface AiOps {
  removeBackground(model: 'bg-fast' | 'bg-best'): Promise<void>;
  ensureMask(): Promise<boolean>;
  removeObject(): Promise<void>;
  clearObjectMask(): void;
  enhance(strength: number): Promise<void>;
  upscale(factor: 2 | 4 | 8): Promise<void>;
  aiEdit(prompt: string, label: string): Promise<void>;
  generateBackground(prompt: string): Promise<void>;
  uploadBackground(bytes: Uint8Array): Promise<void>;
  models: ModelInfo[];
  refreshModels(): void;
  download(id: string): Promise<boolean>;
  deleteModel(id: string): Promise<void>;
  hasObjectMask: boolean;
  hasKey: boolean;
  refreshKey(): void;
}

interface Opts {
  docId: string;
  docName: string;
  loaded: { image: CanvasImageSource; width: number; height: number };
  assets: AssetStore;
  rendererRef: MutableRefObject<Renderer | null>;
  ready: boolean;
  state: EditState;
  getState: () => EditState;
  setStateLabeled: (label: string, s: EditState) => void;
  onNewDoc: (bytes: Uint8Array, name: string, state: EditState, assets: Record<string, Uint8Array>) => void;
  onTexturesChanged: () => void;
}

interface Busy { title: string; progress: number | null; provider?: string; job?: number; note?: string }

export function useAiController(o: Opts) {
  const working = useRef<HTMLCanvasElement | null>(null);
  const composeKey = useRef('');
  const [busy, setBusy] = useState<Busy | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [dl, setDl] = useState<{ id: string; name: string; size: number; received?: number; total?: number; resolve: (ok: boolean) => void; started?: boolean } | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [brush, setBrush] = useState<{ mode: BrushMode; size: number; soft: number }>({ mode: null, size: 60, soft: 50 });
  const objMask = useRef<HTMLCanvasElement | null>(null);
  const subjMask = useRef<HTMLCanvasElement | null>(null);
  const [hasObjectMask, setHasObjectMask] = useState(false);
  const [maskVersion, setMaskVersion] = useState(0);
  const W = o.loaded.width, H = o.loaded.height;

  const refreshModels = useCallback(() => { ai.models().then(setModels).catch(() => {}); }, []);
  const refreshKey = useCallback(() => { ai.hasKey().then(setHasKey).catch(() => {}); }, []);
  useEffect(() => { refreshModels(); refreshKey(); }, []);

  useEffect(() => ai.onProgress(d => {
    setBusy(b => {
      if (!b) return b;
      if (d.started) return { ...b, job: d.job };
      if (d.provider) return { ...b, provider: d.provider === 'gpu' ? 'GPU (DirectML)' : 'CPU', note: d.note };
      if (d.p != null) return { ...b, progress: d.p };
      return b;
    });
  }), []);
  useEffect(() => ai.onOnlineStatus(d => setBusy(b => b ? { ...b, note: d.status === 'starting' ? 'Waiting for a free server…' : 'Generating…' } : b)), []);
  useEffect(() => ai.onDownloadProgress(d => setDl(cur => cur && cur.id === d.id ? { ...cur, received: d.received, total: d.total } : cur)), []);

  // ---------- working image (base + patches) ----------
  useEffect(() => {
    const r = o.rendererRef.current;
    if (!o.ready || !r) return;
    const a = o.state.ai;
    const key = JSON.stringify([a.baseId, a.patches]);
    if (key === composeKey.current && working.current) return;
    const first = composeKey.current === '';
    composeKey.current = key;
    if (first && !a.baseId && !a.patches.length) { working.current = drawTo(o.loaded.image, W, H); return; }
    (async () => {
      try {
        const base = a.baseId ? await o.assets.bitmap(a.baseId) : o.loaded.image;
        const c = canvas(W, H), x = ctx2d(c);
        x.drawImage(base, 0, 0, W, H);
        for (const p of a.patches) x.drawImage(await o.assets.bitmap(p.id), p.x, p.y, p.w, p.h);
        if (composeKey.current !== key) return;
        working.current = c;
        if (a.baseId || a.patches.length || r.srcW !== W) r.setImage(c);
        else r.setImage(o.loaded.image as any);
        o.onTexturesChanged();
      } catch (e) { toast('Could not rebuild the photo: ' + aiError(e), 'error'); }
    })();
  }, [o.ready, o.state.ai.baseId, JSON.stringify(o.state.ai.patches)]);

  const getWorking = (): HTMLCanvasElement => {
    if (working.current) return working.current;
    const c = drawTo(o.loaded.image, W, H); working.current = c; return c;
  };

  // ---------- mask / background / style textures ----------
  useEffect(() => {
    const r = o.rendererRef.current; if (!o.ready || !r) return;
    const id = o.state.ai.maskId;
    if (!id) { r.setMask(null); subjMask.current = null; o.onTexturesChanged(); return; }
    o.assets.bitmap(id).then(b => {
      const c = drawTo(b, b.width, b.height);
      subjMask.current = c;
      r.setMask(c); setMaskVersion(v => v + 1); o.onTexturesChanged();
    }).catch(e => toast(aiError(e), 'error'));
  }, [o.ready, o.state.ai.maskId]);
  useEffect(() => {
    const r = o.rendererRef.current; if (!o.ready || !r) return;
    const id = o.state.ai.bgImageId;
    if (!id) { r.setBackground(null); o.onTexturesChanged(); return; }
    o.assets.bitmap(id).then(b => { r.setBackground(b); o.onTexturesChanged(); }).catch(e => toast(aiError(e), 'error'));
  }, [o.ready, o.state.ai.bgImageId]);
  useEffect(() => {
    const r = o.rendererRef.current; if (!o.ready || !r) return;
    const id = o.state.ai.styleId;
    if (!id) { r.setStyle(null); o.onTexturesChanged(); return; }
    o.assets.bitmap(id).then(b => { r.setStyle(b); o.onTexturesChanged(); }).catch(e => toast(aiError(e), 'error'));
  }, [o.ready, o.state.ai.styleId]);
  // harmonize multiplier: subject mean / background mean
  useEffect(() => {
    const r = o.rendererRef.current; if (!o.ready || !r || !subjMask.current) return;
    const a = o.state.ai;
    (async () => {
      const subj = weightedMean(getWorking(), subjMask.current, false);
      let bg: [number, number, number];
      if (a.bgMode === 'image' && a.bgImageId) bg = weightedMean(await o.assets.bitmap(a.bgImageId), null, false);
      else if (a.bgMode === 'gradient') { const c1 = hexToRgbaSafe(a.bgColor), c2 = hexToRgbaSafe(a.bgColor2); bg = [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2, (c1[2] + c2[2]) / 2]; }
      else { const c = hexToRgbaSafe(a.bgColor); bg = [c[0], c[1], c[2]]; }
      const ly = (v: number[]) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      // match brightness fully, colour cast partly
      const k = Math.min(2, Math.max(0.4, ly(subj) / Math.max(0.02, ly(bg))));
      const tint = subj.map((v, i) => Math.min(1.4, Math.max(0.7, (v / Math.max(0.02, ly(subj))) / (bg[i] / Math.max(0.02, ly(bg)) || 1))));
      r.harm = [k * (0.6 + 0.4 * tint[0]), k * (0.6 + 0.4 * tint[1]), k * (0.6 + 0.4 * tint[2])];
      o.onTexturesChanged();
    })();
  }, [o.ready, maskVersion, o.state.ai.bgMode, o.state.ai.bgImageId, o.state.ai.bgColor, o.state.ai.bgColor2]);

  // ---------- helpers ----------
  const ensureModel = (id: string) => new Promise<boolean>(async resolve => {
    const list = await ai.models(); setModels(list);
    const m = list.find(x => x.id === id);
    if (!m) return resolve(false);
    if (m.installed) return resolve(true);
    setDl({ id, name: m.name, size: m.size, resolve });
  });
  const startDownload = async () => {
    if (!dl) return;
    setDl({ ...dl, started: true });
    try { await ai.download(dl.id); dl.resolve(true); toast(dl.name + ' downloaded', 'ok'); }
    catch (e) { const msg = aiError(e); if (msg !== 'Cancelled') toast('Download failed: ' + msg, 'error'); dl.resolve(false); }
    finally { setDl(null); refreshModels(); }
  };
  const download = (id: string) => ensureModel(id);

  const rgbaOf = (c: HTMLCanvasElement) => new Uint8Array(ctx2d(c).getImageData(0, 0, c.width, c.height).data.buffer);
  const run = async <T,>(title: string, f: () => Promise<T>): Promise<T | undefined> => {
    setBusy({ title, progress: null });
    try { return await f(); }
    catch (e) { const m = aiError(e); if (m !== 'Cancelled') toast(m, 'error'); return undefined; }
    finally { setBusy(null); }
  };

  // ---------- background removal ----------
  const removeBackground = async (model: 'bg-fast' | 'bg-best') => {
    if (!(await ensureModel(model))) return;
    await run('Finding the subject…', async () => {
      const [w, h] = scaleToFit(W, H, 1600);
      const src = drawTo(getWorking(), w, h);
      const res = await ai.run({ op: 'removeBg', model, rgba: rgbaOf(src), width: w, height: h });
      const mc = canvas(w, h), x = ctx2d(mc), id = x.createImageData(w, h);
      const m: Uint8Array = res.mask;
      for (let i = 0; i < w * h; i++) { id.data[i * 4] = 255; id.data[i * 4 + 1] = 255; id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = m[i]; }
      x.putImageData(id, 0, 0);
      const maskId = await o.assets.putCanvas(mc);
      const s = clone(o.getState());
      s.ai.maskId = maskId;
      if (s.ai.bgMode === 'keep') s.ai.bgMode = 'transparent';
      o.setStateLabeled('Remove background', s);
      toast('Background removed. Choose a new background, or keep it transparent and export as PNG.', 'ok', 5000);
    });
  };
  const ensureMask = async () => {
    if (o.getState().ai.maskId) return true;
    const list = await ai.models();
    const model = list.find(m => m.id === 'bg-best')?.installed ? 'bg-best' : 'bg-fast';
    await removeBackground(model);
    return !!o.getState().ai.maskId;
  };

  // ---------- object removal ----------
  const getObjMask = () => {
    if (!objMask.current) { const [w, h] = scaleToFit(W, H, 2048); objMask.current = canvas(w, h); }
    return objMask.current;
  };
  const clearObjectMask = () => { if (objMask.current) ctx2d(objMask.current).clearRect(0, 0, objMask.current.width, objMask.current.height); setHasObjectMask(false); o.onTexturesChanged(); };
  const removeObject = async () => {
    const om = objMask.current; if (!om) return toast('Paint over the object you want to remove first.');
    if (!(await ensureModel('inpaint'))) return;
    await run('Removing object…', async () => {
      // bounding box of painted area (mask space -> source space)
      const md = ctx2d(om).getImageData(0, 0, om.width, om.height).data;
      let x0 = om.width, y0 = om.height, x1 = -1, y1 = -1;
      for (let y = 0; y < om.height; y++) for (let x = 0; x < om.width; x++) if (md[(y * om.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) throw new Error('Paint over the object you want to remove first.');
      const k = W / om.width;
      let bx0 = x0 * k, by0 = y0 * k, bx1 = (x1 + 1) * k, by1 = (y1 + 1) * k;
      const bw = bx1 - bx0, bh = by1 - by0;
      const marg = Math.max(48, 0.6 * Math.max(bw, bh));
      let rx0 = Math.max(0, Math.floor(bx0 - marg)), ry0 = Math.max(0, Math.floor(by0 - marg));
      let rx1 = Math.min(W, Math.ceil(bx1 + marg)), ry1 = Math.min(H, Math.ceil(by1 + marg));
      const rw = rx1 - rx0, rh = ry1 - ry0;
      // crop of the working image and the (slightly dilated) mask
      const crop = canvas(rw, rh); ctx2d(crop).drawImage(getWorking(), rx0, ry0, rw, rh, 0, 0, rw, rh);
      const mcrop = canvas(rw, rh), mx = ctx2d(mcrop);
      mx.filter = `blur(${Math.max(2, Math.round(rw / 200))}px)`;
      mx.drawImage(om, rx0 / k, ry0 / k, rw / k, rh / k, 0, 0, rw, rh);
      const ma = mx.getImageData(0, 0, rw, rh).data, mask = new Uint8Array(rw * rh);
      for (let i = 0; i < rw * rh; i++) mask[i] = ma[i * 4 + 3] > 8 ? 255 : 0;
      const res = await ai.run({ op: 'inpaint', model: 'inpaint', rgba: rgbaOf(crop), mask, width: rw, height: rh });
      // blend result into the crop only where painted (feathered edge)
      const out = canvas(rw, rh), ox = ctx2d(out);
      const id = new ImageData(new Uint8ClampedArray(res.data), rw, rh);
      const feather = canvas(rw, rh), fx = ctx2d(feather);
      fx.filter = `blur(${Math.max(2, Math.round(rw / 150))}px)`;
      fx.drawImage(om, rx0 / k, ry0 / k, rw / k, rh / k, 0, 0, rw, rh);
      fx.filter = 'none'; fx.globalCompositeOperation = 'source-over'; fx.drawImage(feather, 0, 0); // strengthen core
      const fa = fx.getImageData(0, 0, rw, rh).data;
      for (let i = 0; i < rw * rh; i++) id.data[i * 4 + 3] = Math.min(255, fa[i * 4 + 3] * 1.6);
      ox.putImageData(id, 0, 0);
      const pid = await o.assets.putCanvas(out);
      const s = clone(o.getState());
      s.ai.patches = [...s.ai.patches, { id: pid, x: rx0, y: ry0, w: rw, h: rh }];
      o.setStateLabeled('Remove object', s);
      clearObjectMask();
    });
  };

  // ---------- enhance / upscale ----------
  const MAX_OUT = 80e6;
  const upscaleRaw = async (src: HTMLCanvasElement, model: 'upscale-x2' | 'upscale-x4', title: string) => {
    if (!(await ensureModel(model))) throw new Error('Cancelled');
    setBusy({ title, progress: 0 });
    const res = await ai.run({ op: 'upscale', model, rgba: rgbaOf(src), width: src.width, height: src.height });
    const c = canvas(res.width, res.height);
    ctx2d(c).putImageData(new ImageData(new Uint8ClampedArray(res.data), res.width, res.height), 0, 0);
    return c;
  };
  const enhance = async (strength: number) => {
    const model = W * H * 16 <= MAX_OUT ? 'upscale-x4' : W * H * 4 <= MAX_OUT ? 'upscale-x2' : null;
    if (!model) return toast('This photo is already high resolution (over 20 MP). AI enhance works best on smaller or compressed photos.', 'error', 6000);
    if (!(await ensureModel(model))) return;
    await run('Enhancing details…', async () => {
      const big = await upscaleRaw(getWorking(), model, 'Enhancing details…');
      const back = drawTo(big, W, H);
      const c = drawTo(getWorking(), W, H), x = ctx2d(c);
      x.globalAlpha = strength / 100; x.drawImage(back, 0, 0);
      const baseId = await o.assets.putCanvas(c);
      const s = clone(o.getState());
      s.ai.baseId = baseId; s.ai.patches = [];
      o.setStateLabeled('AI enhance', s);
      toast('Details enhanced. Use the Original button to compare.', 'ok');
    });
  };
  const upscale = async (factor: 2 | 4 | 8) => {
    if (W * H * factor * factor > MAX_OUT) return toast(`A ${factor}× upscale of this photo would be over 80 megapixels. Choose a smaller factor.`, 'error', 6000);
    const r = o.rendererRef.current;
    if (r && Math.max(W, H) * factor > r.maxSize) return toast(`The result would be wider than your graphics card can edit (${r.maxSize} px). Choose a smaller factor.`, 'error', 6000);
    const first = factor === 2 ? 'upscale-x2' : 'upscale-x4';
    if (!(await ensureModel(first))) return;
    if (factor === 8 && !(await ensureModel('upscale-x2'))) return;
    await run(`Upscaling ${factor}×…`, async () => {
      let out = await upscaleRaw(getWorking(), first, factor === 8 ? 'Upscaling 8× (step 1 of 2)…' : `Upscaling ${factor}×…`);
      if (factor === 8) out = await upscaleRaw(out, 'upscale-x2', 'Upscaling 8× (step 2 of 2)…');
      setBusy({ title: 'Saving result…', progress: null });
      const bytes = await canvasToBytes(out, 'image/png');
      const st = clone(o.getState());
      st.ai.baseId = null; st.ai.patches = [];
      const keep = [st.ai.maskId, st.ai.bgImageId, st.ai.styleId].filter(Boolean) as string[];
      const assets = await o.assets.export(keep);
      o.onNewDoc(bytes, o.docName.replace(/\.[^.]+$/, '') + `-${factor}x.png`, st, assets);
      toast(`Upscaled to ${out.width} × ${out.height}. Opened as a new photo; your original is unchanged.`, 'ok', 6000);
    });
  };

  // ---------- online ----------
  const toJpeg = async (c: HTMLCanvasElement, max = 1024) => { const [w, h] = scaleToFit(c.width, c.height, max); return canvasToBytes(drawTo(c, w, h), 'image/jpeg', 0.9); };
  const aiEdit = async (prompt: string, label: string) => {
    if (!hasKey) return toast('Add your Replicate API key in Settings to use online AI features.', 'error');
    await run(label + '…', async () => {
      setBusy({ title: label + '…', progress: null, provider: 'Online (Replicate)', note: 'Uploading…' });
      const bytes = await ai.online('edit', { prompt, image: await toJpeg(getWorking()) });
      const id = await o.assets.put(new Uint8Array(bytes));
      const s = clone(o.getState()); s.ai.styleId = id; s.ai.styleMix = 100;
      o.setStateLabeled(label, s);
      toast('Done. Use the intensity slider to blend with your photo.', 'ok');
    });
  };
  const ASPECTS = ['1:1', '16:9', '21:9', '3:2', '2:3', '4:5', '5:4', '3:4', '4:3', '9:16', '9:21'];
  const generateBackground = async (prompt: string) => {
    if (!hasKey) return toast('Add your Replicate API key in Settings to generate backgrounds.', 'error');
    if (!(await ensureMask())) return;
    const r = o.rendererRef.current!;
    const [ow, oh] = r.outputSize(o.getState());
    const ratio = ow / oh;
    const aspect = ASPECTS.reduce((b, a) => { const [x, y] = a.split(':').map(Number); const [bx, by] = b.split(':').map(Number); return Math.abs(Math.log(x / y / ratio)) < Math.abs(Math.log(bx / by / ratio)) ? a : b; });
    await run('Generating background…', async () => {
      setBusy({ title: 'Generating background…', progress: null, provider: 'Online (Replicate)' });
      const bytes = await ai.online('generate', { prompt: prompt + ', background plate, no people, photographic, high detail', aspect });
      const id = await o.assets.put(new Uint8Array(bytes));
      const s = clone(o.getState()); s.ai.bgImageId = id; s.ai.bgMode = 'image';
      o.setStateLabeled('Generate background', s);
    });
  };
  const uploadBackground = async (bytes: Uint8Array) => {
    if (!(await ensureMask())) return;
    const id = await o.assets.put(bytes);
    try { await o.assets.bitmap(id); } catch { return toast('That file could not be read as an image.', 'error'); }
    const s = clone(o.getState()); s.ai.bgImageId = id; s.ai.bgMode = 'image';
    o.setStateLabeled('Custom background', s);
  };

  const deleteModel = async (id: string) => { await ai.deleteModel(id); refreshModels(); };

  const ops: AiOps = {
    removeBackground, ensureMask, removeObject, clearObjectMask, enhance, upscale, aiEdit, generateBackground, uploadBackground,
    models, refreshModels, download, deleteModel, hasObjectMask, hasKey, refreshKey,
  };

  // ---------- brush painting ----------
  const paintTarget = () => brush.mode === 'object' ? getObjMask() : brush.mode ? (subjMask.current || null) : null;
  const strokeEnd = async () => {
    if (brush.mode === 'object') { setHasObjectMask(true); return; }
    if ((brush.mode === 'mask-add' || brush.mode === 'mask-erase') && subjMask.current) {
      const id = await o.assets.putCanvas(subjMask.current);
      const s = clone(o.getState()); s.ai.maskId = id;
      o.setStateLabeled(brush.mode === 'mask-add' ? 'Refine mask (add)' : 'Refine mask (erase)', s);
    }
  };
  const liveMask = () => { const r = o.rendererRef.current; if (r && subjMask.current && brush.mode !== 'object') { r.setMask(subjMask.current); o.onTexturesChanged(); } };

  const busyEl = busy && (
    <div className="ai-busy">
      <div className="ai-busy-card">
        <div className="spinner dark" />
        <div className="grow">
          <b>{busy.title}</b>
          <div className="muted small">{busy.note || (busy.provider ? 'Running on ' + busy.provider : 'Starting the AI engine…')}</div>
          {busy.progress != null && <div className="bar"><div style={{ width: Math.round(busy.progress * 100) + '%' }} /></div>}
        </div>
        {busy.job != null && <button className="btn" onClick={() => ai.cancel(busy.job!)}>Cancel</button>}
      </div>
    </div>
  );
  const dlEl = dl && (
    <Modal title="Download AI model" onClose={() => { if (dl.started) ai.cancelDownload(dl.id); else { dl.resolve(false); setDl(null); } }} footer={dl.started
      ? <><span className="grow" /><button className="btn" onClick={() => ai.cancelDownload(dl.id)}>Cancel download</button></>
      : <><span className="grow" /><button className="btn" onClick={() => { dl.resolve(false); setDl(null); }}>Not now</button><button className="btn accent" onClick={startDownload}>Download ({formatBytes(dl.size)})</button></>}>
      <p><b>{dl.name}</b> runs on your own computer, so your photos are never uploaded. It needs a one-time download of about <b>{formatBytes(dl.size)}</b>.</p>
      {dl.started && <>
        <div className="bar big"><div style={{ width: dl.total ? Math.round((dl.received || 0) / dl.total * 100) + '%' : '3%' }} /></div>
        <div className="muted small">{formatBytes(dl.received || 0)} of {formatBytes(dl.total || dl.size)}</div>
      </>}
    </Modal>
  );

  return { ops, busyEl, dlEl, brush, setBrush, paintTarget, strokeEnd, liveMask, working, subjMask, objMask: getObjMask, hasObjectMask, setHasObjectMask };
}
