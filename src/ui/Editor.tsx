import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Renderer, Histogram } from '../engine/Renderer';
import { EditState, clone, defaultState, defaultAdjust, normalizeState } from '../state/types';
import { Icon, Planned, toast, useLatest } from './common';
import { AdjustPanel } from './panels/AdjustPanel';
import { CurvesPanel } from './panels/CurvesPanel';
import { HslPanel, GradingPanel, DetailPanel } from './panels/ColorPanels';
import { CropPanel, CropOverlay, aspectRatio, rotateGeometry } from './panels/CropPanel';
import { PresetsPanel, HistoryPanel } from './panels/PresetsPanel';
import { ExportDialog, SettingsDialog, HistogramView, AppSettings } from './dialogs';
import { platform } from '../platform';
import type { LoadedImage } from '../engine/codecs';
import { thumbnailDataUrl } from '../engine/codecs';

export interface Doc {
  id: string;
  name: string;
  path: string | null;
  bytes: Uint8Array;
  loaded: LoadedImage;
  state: EditState;
  projectPath: string | null;
  createdAt: number;
}

export interface RecentItem { id: string; name: string; imagePath: string | null; projectPath: string | null; thumb: string; editedAt: number }

type Tool = 'ai' | 'adjust' | 'color' | 'detail' | 'retouch' | 'effects' | 'filters' | 'text' | 'stickers' | 'frames' | 'crop' | 'history';
const TOOLS: { k: Tool; label: string; icon: string; phase?: number; pro?: boolean }[] = [
  { k: 'ai', label: 'AI Tools', icon: 'ai', phase: 3 },
  { k: 'adjust', label: 'Adjustments', icon: 'sliders' },
  { k: 'color', label: 'Color', icon: 'color', pro: true },
  { k: 'detail', label: 'Detail & Optics', icon: 'detail', pro: true },
  { k: 'retouch', label: 'Retouching', icon: 'retouch', phase: 4 },
  { k: 'effects', label: 'Effects', icon: 'effects', phase: 5 },
  { k: 'filters', label: 'Filters & Presets', icon: 'filters' },
  { k: 'text', label: 'Text', icon: 'text', phase: 5 },
  { k: 'stickers', label: 'Stickers', icon: 'sticker', phase: 5 },
  { k: 'frames', label: 'Frames', icon: 'frame', phase: 5 },
  { k: 'crop', label: 'Crop & Transform', icon: 'transform' },
  { k: 'history', label: 'History', icon: 'history' },
];

const PLANNED: Record<string, { title: string; items: string[]; note?: string }> = {
  ai: { title: 'AI Tools', items: ['Background removal (offline model, transparent PNG)', 'Background replacement & library', 'AI enhancement and 2× / 4× upscaling (offline model)', 'Object removal with brush', 'Portrait & art styles (online, needs API key)'], note: 'AI tools come in Phase 3. Background removal and upscaling will run offline on your computer; generated backgrounds and art styles will use an online service and need an API key (Settings).' },
  retouch: { title: 'Portrait Retouching', items: ['Skin smoothing, blemish & acne removal', 'Red-eye, teeth whitening, eye enhancement', 'Healing brush, clone stamp, spot removal', 'Local adjustment brush'] },
  effects: { title: 'Creative Effects', items: ['Film & vintage looks, light leaks', 'Glitch, bokeh, soft glow, tilt-shift', 'Double exposure, colour splash', 'Artistic filters (oil, watercolour, sketch)'] },
  text: { title: 'Text & Typography', items: ['Fonts, size, bold/italic, colour', 'Spacing, shadows, outlines, labels', 'Curved text, rotation'] },
  stickers: { title: 'Stickers & Graphics', items: ['Searchable stickers, shapes, emojis', 'Badges, labels, overlays', 'Resize, rotate, recolour'] },
  frames: { title: 'Frames & Borders', items: ['Frames, borders, decorative overlays'] },
};

const GROUPS: { k: string; label: string; test: (s: EditState) => boolean; reset: (s: EditState) => void }[] = [
  { k: 'adjust', label: 'Basic adjustments', test: s => JSON.stringify(s.adjust) !== JSON.stringify(defaultAdjust()), reset: s => { s.adjust = defaultAdjust(); } },
  { k: 'curves', label: 'Curves', test: s => JSON.stringify(s.curves) !== JSON.stringify(defaultState().curves), reset: s => { s.curves = defaultState().curves; } },
  { k: 'hsl', label: 'HSL', test: s => JSON.stringify(s.hsl) !== JSON.stringify(defaultState().hsl), reset: s => { s.hsl = defaultState().hsl; } },
  { k: 'grading', label: 'Colour grading', test: s => JSON.stringify(s.grading) !== JSON.stringify(defaultState().grading), reset: s => { s.grading = defaultState().grading; } },
  { k: 'detail', label: 'Detail & optics', test: s => JSON.stringify([s.detail, s.optics]) !== JSON.stringify([defaultState().detail, defaultState().optics]), reset: s => { s.detail = defaultState().detail; s.optics = defaultState().optics; } },
  { k: 'geometry', label: 'Crop & transform', test: s => JSON.stringify(s.geometry) !== JSON.stringify(defaultState().geometry), reset: s => { s.geometry = defaultState().geometry; } },
];

function toBase64(u8: Uint8Array) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000) as any);
  return btoa(s);
}

interface Props {
  doc: Doc;
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
  onHome: () => void;
  onOpen: () => void;
  onDocSaved: (patch: Partial<Doc>) => void;
  initialTool?: string;
}

export function Editor({ doc, settings, setSettings, onHome, onOpen, onDocSaved, initialTool }: Props) {
  const pro = settings.mode === 'pro';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [ready, setReady] = useState(false);
  const [cur, setCur] = useState<EditState>(() => normalizeState(doc.state));
  const [hist, setHist] = useState<{ entries: { label: string; state: EditState; t: number }[]; index: number }>(() => ({ entries: [{ label: 'Opened photo', state: normalizeState(doc.state), t: Date.now() }], index: 0 }));
  const [tool, setTool] = useState<Tool>((initialTool as Tool) || 'adjust');
  const [colorTab, setColorTab] = useState<'curves' | 'hsl' | 'grading'>('curves');
  const [preview, setPreview] = useState<EditState | null>(null);
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(0.5);
  const [showOrig, setShowOrig] = useState(false);
  const [histo, setHisto] = useState<Histogram | null>(null);
  const [modal, setModal] = useState<'export' | 'settings' | null>(null);
  const [cropFrame, setCropFrame] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const [without, setWithout] = useState<string | null>(null);
  const label = useRef('Edit');
  const commitTimer = useRef<any>(null);
  const curRef = useLatest(cur);
  const histRef = useLatest(hist);

  // ---------- renderer setup ----------
  useEffect(() => {
    try {
      const r = new Renderer(canvasRef.current!);
      r.setImage(doc.loaded.image as any);
      rendererRef.current = r;
      setReady(true);
      if (doc.loaded.scaledFrom) toast(`Large photo (${doc.loaded.scaledFrom[0]}×${doc.loaded.scaledFrom[1]}) was scaled to ${doc.loaded.width}×${doc.loaded.height} to fit your graphics card.`, 'info', 6000);
    } catch (e: any) { toast(e.message || String(e), 'error'); }
    return () => { rendererRef.current?.dispose(); rendererRef.current = null; };
  }, [doc.id]);

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---------- history ----------
  const commit = useCallback(() => {
    clearTimeout(commitTimer.current); commitTimer.current = null;
    const h = histRef.current, s = curRef.current;
    if (JSON.stringify(h.entries[h.index].state) === JSON.stringify(s)) return;
    const entries = [...h.entries.slice(0, h.index + 1), { label: label.current, state: clone(s), t: Date.now() }].slice(-200);
    setHist({ entries, index: entries.length - 1 });
  }, []);
  const scheduleCommit = () => { clearTimeout(commitTimer.current); commitTimer.current = setTimeout(commit, 450); };

  const update = useCallback((lbl: string, f: (s: EditState) => void) => {
    const next = clone(curRef.current); f(next);
    if (label.current !== lbl && commitTimer.current) commit();
    label.current = lbl;
    setCur(next);
    scheduleCommit();
  }, []);
  const setStateLabeled = useCallback((lbl: string, s: EditState) => {
    if (label.current !== lbl && commitTimer.current) commit();
    label.current = lbl; setCur(clone(s)); scheduleCommit();
  }, []);
  const jump = (i: number) => {
    if (commitTimer.current) commit();
    const h = histRef.current;
    if (i < 0 || i >= h.entries.length) return;
    setHist({ ...h, index: i });
    setCur(clone(h.entries[i].state));
  };
  const undo = () => { if (commitTimer.current) { commit(); setTimeout(() => jump(histRef.current.index - 1), 0); } else jump(hist.index - 1); };
  const redo = () => jump(hist.index + 1);

  // ---------- view geometry ----------
  const r = rendererRef.current;
  const [OW, OH] = r ? r.orientedSize(cur) : [doc.loaded.width, doc.loaded.height];
  const cropMode = tool === 'crop';
  useEffect(() => {
    if (cropMode) {
      const c = cur.geometry.crop;
      const x = Math.min(0, c.x), y = Math.min(0, c.y);
      setCropFrame({ x, y, w: Math.max(1, c.x + c.w) - x, h: Math.max(1, c.y + c.h) - y });
    }
    // eslint-disable-next-line
  }, [cropMode, cur.geometry.rot90, cur.geometry.crop.w > 1 || cur.geometry.crop.h > 1 || cur.geometry.crop.x < 0 || cur.geometry.crop.y < 0]);

  const display = useMemo(() => {
    let s = preview || cur;
    if (without) { s = clone(s); GROUPS.find(g => g.k === without)!.reset(s); }
    if (cropMode) { s = clone(s); s.geometry.crop = { ...cropFrame }; }
    return s;
  }, [preview, cur, cropMode, cropFrame, without]);

  const outW = Math.max(1, Math.round(OW * display.geometry.crop.w)), outH = Math.max(1, Math.round(OH * display.geometry.crop.h));
  const fitScale = Math.min((size.w - 40) / outW, (size.h - 40) / outH);
  const scale = zoom === 'fit' ? fitScale : zoom;
  const dw = outW * scale, dh = outH * scale;
  const ix = (size.w - dw) / 2 + (zoom === 'fit' ? 0 : pan.x), iy = (size.h - dh) / 2 + (zoom === 'fit' ? 0 : pan.y);
  const visL = Math.max(0, ix), visT = Math.max(0, iy), visR = Math.min(size.w, ix + dw), visB = Math.min(size.h, iy + dh);
  const visW = Math.max(0, visR - visL), visH = Math.max(0, visB - visT);

  // ---------- render ----------
  const raf = useRef(0);
  useEffect(() => {
    if (!ready || !r || visW < 1 || visH < 1) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      const view: [number, number, number, number] = [(visL - ix) / dw, (visT - iy) / dh, visW / dw, visH / dh];
      const sp = showOrig ? 1.01 : compare && !cropMode ? split : -1;
      try { r.render(display, Math.round(visW * dpr), Math.round(visH * dpr), sp, view); } catch (e) { console.error(e); }
    });
  }, [ready, display, visL, visT, visW, visH, ix, iy, dw, dh, showOrig, compare, split, cropMode]);

  useEffect(() => {
    if (!ready || !r) return;
    const t = setTimeout(() => { try { setHisto(r.histogram(preview || cur)); } catch { /* ignore */ } }, 160);
    return () => clearTimeout(t);
  }, [ready, cur, preview]);

  // ---------- autosave & recent ----------
  const makeThumb = useCallback(async () => {
    const rr = rendererRef.current; if (!rr) return '';
    const s = curRef.current; const [w, h] = rr.outputSize(s);
    const k = Math.min(1, 480 / Math.max(w, h));
    return thumbnailDataUrl(rr.renderImageData(s, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))), 320);
  }, []);
  const saveRecent = useCallback(async () => {
    try {
      const thumb = await makeThumb();
      const list = await platform.get<RecentItem[]>('recent', []);
      const item: RecentItem = { id: doc.id, name: doc.name, imagePath: doc.path, projectPath: doc.projectPath, thumb, editedAt: Date.now() };
      await platform.set('recent', [item, ...list.filter(x => x.id !== doc.id && !(doc.projectPath && x.projectPath === doc.projectPath))].slice(0, 24));
    } catch (e) { console.warn(e); }
  }, [doc]);
  useEffect(() => {
    if (!settings.autosave) return;
    const t = setTimeout(() => {
      platform.set('autosave:' + doc.id, { state: cur, name: doc.name, imagePath: doc.path, savedAt: Date.now() });
      platform.set('session', { id: doc.id, clean: false });
    }, 1200);
    return () => clearTimeout(t);
  }, [cur, settings.autosave]);
  useEffect(() => {
    if (!ready) return;
    saveRecent();
    const iv = setInterval(saveRecent, 60000);
    return () => clearInterval(iv);
  }, [ready]);

  const goHome = async () => {
    if (commitTimer.current) commit();
    await platform.set('autosave:' + doc.id, { state: curRef.current, name: doc.name, imagePath: doc.path, savedAt: Date.now() });
    await saveRecent();
    await platform.set('session', { id: doc.id, clean: true });
    onHome();
  };

  // ---------- project save ----------
  const saveProject = async (saveAs = false) => {
    if (commitTimer.current) commit();
    const proj = {
      app: 'PhotoStudio', version: 1, id: doc.id, name: doc.name, imagePath: doc.path, createdAt: doc.createdAt, savedAt: Date.now(),
      state: curRef.current,
      history: histRef.current.entries.slice(-60).map(e => ({ label: e.label, t: e.t, state: e.state })),
      image: doc.bytes.length <= 40 * 1024 * 1024 ? toBase64(doc.bytes) : null,
    };
    const p = await platform.saveText(doc.name.replace(/\.[^.]+$/, '') + '.pstudio', JSON.stringify(proj), [{ name: 'Photo Studio project', extensions: ['pstudio'] }], saveAs ? null : doc.projectPath);
    if (p) { onDocSaved({ projectPath: p }); toast('Project saved', 'ok'); saveRecent(); }
  };

  // ---------- auto enhance ----------
  const autoEnhance = () => {
    const rr = rendererRef.current; if (!rr) return;
    const base = clone(cur); base.adjust = defaultAdjust();
    const h = rr.histogram(base);
    let total = 0; for (let i = 0; i < 256; i++) total += h.l[i];
    const pct = (p: number) => { let acc = 0; for (let i = 0; i < 256; i++) { acc += h.l[i]; if (acc >= total * p) return i / 255; } return 1; };
    const lo = pct(0.005), med = pct(0.5), hi = pct(0.995);
    const a = defaultAdjust();
    a.exposure = Math.round(Math.max(-1.5, Math.min(1.5, 2.2 * Math.log2(0.45 / Math.max(med, 0.02)) * 0.6)) * 100) / 100;
    if (hi < 0.96) a.whites = Math.round(Math.min(50, (0.98 - hi) * 160));
    if (lo > 0.03) a.blacks = Math.round(Math.max(-45, -(lo - 0.01) * 220));
    if (hi >= 0.99) a.highlights = -30;
    if (med < 0.32) a.shadows = 25;
    a.contrast = 6; a.vibrance = 15;
    a.vignette = cur.adjust.vignette; a.grain = cur.adjust.grain; a.grainSize = cur.adjust.grainSize; a.vignetteMidpoint = cur.adjust.vignetteMidpoint;
    update('Auto enhance', s => { s.adjust = a; });
    toast('Auto enhance applied — adjust any slider to fine-tune', 'ok');
  };

  // ---------- copy / paste settings ----------
  const copySettings = () => { const s = clone(cur); platform.set('clipboard', { ...s, geometry: undefined }); toast('Edit settings copied'); };
  const pasteSettings = async () => {
    const c = await platform.get<any>('clipboard', null);
    if (!c) return toast('Nothing copied yet');
    update('Paste settings', s => { const g = s.geometry; Object.assign(s, normalizeState({ ...c, geometry: g })); });
  };

  // ---------- zoom ----------
  const zoomTo = (z: number, cx = size.w / 2, cy = size.h / 2) => {
    z = Math.max(0.02, Math.min(16, z));
    // keep point under (cx, cy) fixed
    const px = (cx - ix) / scale, py = (cy - iy) / scale;
    const nix = cx - px * z, niy = cy - py * z;
    setPan({ x: nix - (size.w - outW * z) / 2, y: niy - (size.h - outH * z) / 2 });
    setZoom(z);
  };
  const onWheel = (e: React.WheelEvent) => {
    const rc = wrapRef.current!.getBoundingClientRect();
    zoomTo(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - rc.left, e.clientY - rc.top);
  };
  const panDrag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  // ---------- keyboard ----------
  const keyRef = useLatest({ undo, redo, saveProject, autoEnhance, copySettings, pasteSettings, zoomTo, fitScale });
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' && (e.target as HTMLInputElement).type !== 'range' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = keyRef.current, ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); k.undo(); }
      else if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); k.redo(); }
      else if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); k.saveProject(e.shiftKey); }
      else if (ctrl && e.key.toLowerCase() === 'e') { e.preventDefault(); setModal('export'); }
      else if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); onOpen(); }
      else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); k.copySettings(); }
      else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'v') { e.preventDefault(); k.pasteSettings(); }
      else if (ctrl) return;
      else if (e.key === '\\') setShowOrig(true);
      else if (e.key.toLowerCase() === 'c') setTool(t => t === 'crop' ? 'adjust' : 'crop');
      else if (e.key.toLowerCase() === 'f') setZoom('fit');
      else if (e.key === '0') k.zoomTo(1);
      else if (e.key === '+' || e.key === '=') k.zoomTo((zoom === 'fit' ? k.fitScale : zoom) * 1.25);
      else if (e.key === '-') k.zoomTo((zoom === 'fit' ? k.fitScale : zoom) / 1.25);
      else if (e.key.toLowerCase() === 'y') setCompare(c => !c);
      else if (e.key === 'Enter' && tool === 'crop') setTool('adjust');
    };
    const up = (e: KeyboardEvent) => { if (e.key === '\\') setShowOrig(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [zoom, tool]);

  const thumbFn = useCallback((s: EditState) => {
    const rr = rendererRef.current; if (!rr) return null;
    const [w, h] = rr.outputSize(s); const k = Math.min(1, 140 / Math.max(w, h));
    const id = rr.renderImageData(s, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
    const c = document.createElement('canvas'); c.width = id.width; c.height = id.height;
    c.getContext('2d')!.putImageData(id, 0, 0);
    return c.toDataURL('image/jpeg', 0.8);
  }, []);

  const visibleTools = TOOLS.filter(t => pro || !t.pro);
  const changed = GROUPS.filter(g => g.test(cur));
  const ratio = aspectRatio(cur.geometry, OW, OH);

  return (
    <div className="editor">
      {/* ---------- top toolbar ---------- */}
      <div className="toolbar">
        <button className="icon-btn" title="Home" onClick={goHome}><Icon name="home" /></button>
        <div className="tb-title" title={doc.path || doc.name}>{doc.name}</div>
        <div className="sep" />
        <button className="icon-btn" title="Open photo (Ctrl+O)" onClick={onOpen}><Icon name="open" /></button>
        <button className="icon-btn" title="Save project (Ctrl+S) · Shift: Save as" onClick={e => saveProject(e.shiftKey)}><Icon name="save" /></button>
        <div className="sep" />
        <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={hist.index === 0 && !commitTimer.current} onClick={undo}><Icon name="undo" /></button>
        <button className="icon-btn" title="Redo (Ctrl+Y)" disabled={hist.index >= hist.entries.length - 1} onClick={redo}><Icon name="redo" /></button>
        <div className="sep" />
        <button className={'icon-btn' + (cropMode ? ' on' : '')} title="Crop (C)" onClick={() => setTool(cropMode ? 'adjust' : 'crop')}><Icon name="crop" /></button>
        <button className="icon-btn" title="Rotate left" onClick={() => update('Rotate left', s => rotateGeometry(s.geometry, -1))}><Icon name="rotl" /></button>
        <button className="icon-btn" title="Rotate right" onClick={() => update('Rotate right', s => rotateGeometry(s.geometry, 1))}><Icon name="rotr" /></button>
        <button className="icon-btn" title="Flip horizontal" onClick={() => update('Flip horizontal', s => { s.geometry.flipH = !s.geometry.flipH; s.geometry.crop.x = 1 - s.geometry.crop.x - s.geometry.crop.w; })}><Icon name="fliph" /></button>
        <button className="icon-btn" title="Flip vertical" onClick={() => update('Flip vertical', s => { s.geometry.flipV = !s.geometry.flipV; s.geometry.crop.y = 1 - s.geometry.crop.y - s.geometry.crop.h; })}><Icon name="flipv" /></button>
        <div className="sep" />
        <button className="icon-btn" title="Zoom out (−)" onClick={() => zoomTo(scale / 1.25)}><Icon name="zoomout" /></button>
        <button className="zoom-label" title="Click: fit / 100%" onClick={() => zoom === 'fit' ? zoomTo(1) : setZoom('fit')}>{zoom === 'fit' ? 'Fit' : Math.round(scale * 100) + '%'}</button>
        <button className="icon-btn" title="Zoom in (+)" onClick={() => zoomTo(scale * 1.25)}><Icon name="zoomin" /></button>
        <button className="icon-btn" title="Fit to screen (F)" onClick={() => setZoom('fit')}><Icon name="fit" /></button>
        <button className="icon-btn" title="Full screen" onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}><Icon name="eye" /></button>
        <div className="sep" />
        <button className={'icon-btn' + (compare ? ' on' : '')} title="Before / after split (Y)" onClick={() => setCompare(!compare)}><Icon name="compare" /></button>
        <button className="btn ghost small-btn" title="Hold to see the original (or hold \)" onPointerDown={() => setShowOrig(true)} onPointerUp={() => setShowOrig(false)} onPointerLeave={() => setShowOrig(false)}>Original</button>
        <span className="grow" />
        <button className="icon-btn" title="Copy edit settings (Ctrl+Shift+C)" onClick={copySettings}><Icon name="copy" /></button>
        <button className="icon-btn" title="Paste edit settings (Ctrl+Shift+V)" onClick={pasteSettings}><Icon name="paste" /></button>
        <div className="mode-toggle">
          <button className={!pro ? 'on' : ''} onClick={() => setSettings({ ...settings, mode: 'beginner' })}>Beginner</button>
          <button className={pro ? 'on' : ''} onClick={() => setSettings({ ...settings, mode: 'pro' })}>Pro</button>
        </div>
        <button className="icon-btn" title="Theme" onClick={() => setSettings({ ...settings, theme: settings.theme === 'dark' ? 'light' : 'dark' })}><Icon name={settings.theme === 'dark' ? 'sun' : 'moon'} /></button>
        <button className="icon-btn" title="Settings" onClick={() => setModal('settings')}><Icon name="settings" /></button>
        <button className="btn accent" onClick={() => setModal('export')} title="Export (Ctrl+E)"><Icon name="export" size={16} /> Export</button>
      </div>

      <div className="workspace">
        {/* ---------- left sidebar ---------- */}
        <div className="leftbar">
          {visibleTools.map(t => (
            <button key={t.k} className={'tool' + (tool === t.k ? ' on' : '') + (t.phase ? ' planned-tool' : '')} onClick={() => setTool(t.k)} title={t.phase ? `${t.label} — planned (Phase ${t.phase})` : t.label}>
              <Icon name={t.icon} size={20} /><span>{t.label}</span>{t.phase && <em>Soon</em>}
            </button>
          ))}
        </div>

        {/* ---------- canvas ---------- */}
        <div className={'canvas-wrap' + (zoom !== 'fit' ? ' pannable' : '')} ref={wrapRef} onWheel={onWheel}
          onPointerDown={e => { if (cropMode || zoom === 'fit' || (e.target as HTMLElement).closest('.split-handle')) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); panDrag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; }}
          onPointerMove={e => { const d = panDrag.current; if (d) setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }); }}
          onPointerUp={() => (panDrag.current = null)}
          onDoubleClick={() => { if (!cropMode) zoom === 'fit' ? zoomTo(1) : setZoom('fit'); }}>
          <div className="checker" style={{ left: visL, top: visT, width: visW, height: visH }} />
          <canvas ref={canvasRef} className="view" style={{ left: visL, top: visT, width: visW, height: visH }} />
          {compare && !cropMode && (
            <>
              <div className="split-handle" style={{ left: ix + split * dw, top: Math.max(0, iy), height: Math.min(size.h, dh) }}
                onPointerDown={e => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
                onPointerMove={e => { if (e.buttons) setSplit(Math.min(1, Math.max(0, (e.clientX - wrapRef.current!.getBoundingClientRect().left - ix) / dw))); }}>
                <div className="knob">⟷</div>
              </div>
              <div className="ba-label left" style={{ left: Math.max(8, ix + 8), top: Math.max(8, iy + 8) }}>Before</div>
              <div className="ba-label right" style={{ left: Math.min(size.w - 60, ix + dw - 58), top: Math.max(8, iy + 8) }}>After</div>
            </>
          )}
          {showOrig && <div className="ba-label" style={{ left: 12, top: 12 }}>Original</div>}
          {cropMode && ready && (
            <CropOverlay box={{ x: ix, y: iy, w: dw, h: dh }} frame={cropFrame} crop={cur.geometry.crop} ratio={ratio} oriented={[OW, OH]}
              onChange={c => update('Crop', s => { s.geometry.crop = c; })} />
          )}
          <div className="canvas-info">{outW} × {outH}px{preview ? ' · preview' : ''}{without ? ' · without ' + GROUPS.find(g => g.k === without)?.label.toLowerCase() : ''}</div>
        </div>

        {/* ---------- right sidebar ---------- */}
        <div className="rightbar">
          <HistogramView hist={histo} />
          <div className="panel-title">{TOOLS.find(t => t.k === tool)?.label}</div>
          <div className="panel-scroll">
            {tool === 'adjust' && <AdjustPanel state={cur} update={update} pro={pro} onAuto={autoEnhance} />}
            {tool === 'color' && <>
              <div className="tabs">
                {(['curves', 'hsl', 'grading'] as const).map(t => <button key={t} className={colorTab === t ? 'on' : ''} onClick={() => setColorTab(t)}>{{ curves: 'Curves', hsl: 'HSL', grading: 'Grading' }[t]}</button>)}
              </div>
              {colorTab === 'curves' && <CurvesPanel state={cur} update={update} hist={histo} />}
              {colorTab === 'hsl' && <HslPanel state={cur} update={update} />}
              {colorTab === 'grading' && <GradingPanel state={cur} update={update} />}
            </>}
            {tool === 'detail' && <DetailPanel state={cur} update={update} />}
            {tool === 'filters' && <PresetsPanel state={cur} setStateLabeled={setStateLabeled} onPreview={setPreview} thumb={thumbFn} imageKey={doc.id} />}
            {tool === 'crop' && <CropPanel state={cur} update={update} oriented={[OW, OH]} />}
            {tool === 'history' && <HistoryPanel entries={hist.entries} index={hist.index} onJump={jump} />}
            {PLANNED[tool] && <Planned phase={TOOLS.find(t => t.k === tool)!.phase!} {...PLANNED[tool]} />}

            <div className="stack">
              <div className="stack-head"><Icon name="layers" size={15} /> Edit stack <span className="muted small">(non-destructive)</span></div>
              {changed.length === 0 && <div className="muted small">No edits yet — the original photo is untouched.</div>}
              {changed.map(g => (
                <div key={g.k} className="stack-item">
                  <span>{g.label}</span><span className="grow" />
                  <button className={'mini' + (without === g.k ? ' on' : '')} title="Hold to preview without this" onPointerDown={() => setWithout(g.k)} onPointerUp={() => setWithout(null)} onPointerLeave={() => setWithout(null)}><Icon name="eye" size={12} /></button>
                  <button className="mini" title="Reset this group" onClick={() => update('Reset ' + g.label.toLowerCase(), g.reset)}><Icon name="reset" size={12} /></button>
                </div>
              ))}
              <div className="muted small">Full layers, masks and blending modes arrive in Phase 6.</div>
            </div>
          </div>
        </div>
      </div>

      {modal === 'export' && r && <ExportDialog renderer={r} state={cur} name={doc.name} settings={settings} onClose={() => setModal(null)} sourceSize={doc.loaded.scaledFrom} onSettings={setSettings} />}
      {modal === 'settings' && <SettingsDialog settings={settings} onChange={setSettings} onClose={() => setModal(null)} />}
    </div>
  );
}
