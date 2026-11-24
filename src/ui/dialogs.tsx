import { useEffect, useRef, useState } from 'react';
import { Modal, Icon, toast, formatBytes } from './common';
import type { Renderer, Histogram } from '../engine/Renderer';
import { EditState } from '../state/types';
import { encodeImage, resizeImageData } from '../engine/codecs';
import { platform, isDesktop } from '../platform';

export interface AppSettings {
  theme: 'dark' | 'light';
  mode: 'beginner' | 'pro';
  exportFormat: 'jpeg' | 'png' | 'webp' | 'tiff';
  exportQuality: number;
  exportFolder: string;
  autosave: boolean;
}
export const defaultSettings = (): AppSettings => ({ theme: 'dark', mode: 'beginner', exportFormat: 'jpeg', exportQuality: 92, exportFolder: '', autosave: true });

const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp', tiff: 'tif' } as const;

export async function renderForExport(r: Renderer, s: EditState, w: number, h: number) {
  const [ow, oh] = r.outputSize(s);
  if (w <= ow && h <= oh && (w !== ow || h !== oh)) {
    const full = r.renderImageData(s, ow, oh);
    return resizeImageData(full, w, h);
  }
  return r.renderImageData(s, w, h);
}

export function ExportDialog({ renderer, state, name, settings, onClose, sourceSize, onSettings }: {
  renderer: Renderer; state: EditState; name: string; settings: AppSettings; onClose: () => void; sourceSize?: [number, number]; onSettings?: (s: AppSettings) => void;
}) {
  const [ow, oh] = renderer.outputSize(state);
  const [format, setFormat] = useState<AppSettings['exportFormat']>(settings.exportFormat);
  const [quality, setQuality] = useState(settings.exportQuality);
  const [sizeMode, setSizeMode] = useState<'original' | 'long' | 'custom' | 'percent'>('original');
  const [long, setLong] = useState(2048);
  const [cw, setCw] = useState(ow); const [ch, setCh] = useState(oh);
  const [lock, setLock] = useState(true);
  const [pct, setPct] = useState(50);
  const [dpi, setDpi] = useState(300);
  const [fname, setFname] = useState(name.replace(/\.[^.]+$/, '') + '-edited');
  const [busy, setBusy] = useState(false);
  const [est, setEst] = useState<number | null>(null);
  const [folder, setFolder] = useState(settings.exportFolder);

  let W = ow, H = oh;
  if (sizeMode === 'long') { const k = long / Math.max(ow, oh); W = Math.round(ow * k); H = Math.round(oh * k); }
  else if (sizeMode === 'custom') { W = cw; H = ch; }
  else if (sizeMode === 'percent') { W = Math.round(ow * pct / 100); H = Math.round(oh * pct / 100); }
  W = Math.max(1, Math.min(renderer.maxSize, W)); H = Math.max(1, Math.min(renderer.maxSize, H));
  const transparent = (state.ai.bgMode === 'transparent' && !!state.ai.maskId) || state.geometry.fill === 'transparent' && (state.geometry.crop.x < 0 || state.geometry.crop.y < 0 || state.geometry.crop.x + state.geometry.crop.w > 1 || state.geometry.crop.y + state.geometry.crop.h > 1);
  useEffect(() => setEst(null), [format, quality, W, H]);

  const encode = async () => encodeImage(await renderForExport(renderer, state, W, H), format, quality);

  const estimate = async () => { setBusy(true); try { setEst((await encode()).length); } finally { setBusy(false); } };
  const doExport = async () => {
    setBusy(true);
    try {
      const bytes = await encode();
      const file = (fname.trim() || 'photo') + '.' + EXT[format];
      let path: string | null;
      if (isDesktop && folder) { path = await platform.joinPath(folder, file); await platform.writeBytes(path, bytes); }
      else path = await platform.saveBytes(file, bytes, [{ name: format.toUpperCase(), extensions: [EXT[format]] }]);
      if (path) {
        toast(`Exported ${W}×${H} ${format.toUpperCase()} (${formatBytes(bytes.length)})`, 'ok');
        const ns = { ...settings, exportFormat: format, exportQuality: quality, exportFolder: folder };
        if (onSettings) onSettings(ns); else platform.set('settings', ns);
        onClose();
      }
    } catch (e: any) { toast('Export failed: ' + (e?.message || e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Export photo" onClose={onClose} footer={<>
      <span className="muted small">{est != null ? 'Estimated file size: ' + formatBytes(est) : ''}</span><span className="grow" />
      <button className="btn" disabled={busy} onClick={estimate}>Estimate size</button>
      <button className="btn accent" disabled={busy} onClick={doExport}>{busy ? 'Working…' : <><Icon name="export" size={15} /> Export</>}</button>
    </>}>
      <div className="form">
        <label>Format
          <div className="seg">{(['jpeg', 'png', 'webp', 'tiff'] as const).map(f => <button key={f} className={format === f ? 'on' : ''} onClick={() => setFormat(f)}>{f === 'jpeg' ? 'JPEG' : f.toUpperCase()}</button>)}</div>
        </label>
        {transparent && format !== 'png' && format !== 'webp' && format !== 'tiff' && <div className="warn">Your photo has transparent areas. Choose PNG to keep transparency (JPEG fills it with white).</div>}
        {(format === 'jpeg' || format === 'webp') && (
          <label>Quality: {quality}<input type="range" min={10} max={100} value={quality} onChange={e => setQuality(+e.target.value)} /></label>
        )}
        {format === 'png' && <div className="muted small">PNG is lossless and keeps transparency.</div>}
        {format === 'tiff' && <div className="muted small">TIFF is saved uncompressed (largest file, best for printing / archiving).</div>}
        <label>Size
          <div className="seg">
            {(['original', 'long', 'custom', 'percent'] as const).map(m => <button key={m} className={sizeMode === m ? 'on' : ''} onClick={() => setSizeMode(m)}>{{ original: 'Original', long: 'Long edge', custom: 'Custom', percent: 'Percent' }[m]}</button>)}
          </div>
        </label>
        {sizeMode === 'long' && <label>Long edge (px)<input className="num" value={long} onChange={e => setLong(Math.max(1, +e.target.value || 1))} /></label>}
        {sizeMode === 'percent' && <label>Scale (%)<input className="num" value={pct} onChange={e => setPct(Math.max(1, Math.min(400, +e.target.value || 1)))} /></label>}
        {sizeMode === 'custom' && (
          <div className="row gap">
            <input className="num w70" value={cw} onChange={e => { const v = Math.max(1, +e.target.value || 1); setCw(v); if (lock) setCh(Math.round(v * oh / ow)); }} />×
            <input className="num w70" value={ch} onChange={e => { const v = Math.max(1, +e.target.value || 1); setCh(v); if (lock) setCw(Math.round(v * ow / oh)); }} />px
            <label className="row gap"><input type="checkbox" checked={lock} onChange={e => setLock(e.target.checked)} /> Keep proportions</label>
          </div>
        )}
        <div className="info-box">
          <div><b>{W} × {H}</b> px ({(W * H / 1e6).toFixed(1)} MP){sizeMode !== 'original' && W > ow ? ' · upscaled' : ''}</div>
          <div className="row gap">Print size at <input className="num w50" value={dpi} onChange={e => setDpi(Math.max(1, +e.target.value || 72))} /> dpi:
            <b>{(W / dpi * 2.54).toFixed(1)} × {(H / dpi * 2.54).toFixed(1)} cm</b> ({(W / dpi).toFixed(1)} × {(H / dpi).toFixed(1)} in)</div>
          {sourceSize && <div className="muted small">Original photo was scaled to fit your graphics card ({sourceSize[0]}×{sourceSize[1]} → editing size).</div>}
        </div>
        <label>File name<input className="text" value={fname} onChange={e => setFname(e.target.value)} /></label>
        {isDesktop && (
          <label>Output folder
            <div className="row gap">
              <input className="text grow" readOnly value={folder || 'Ask every time'} />
              <button className="btn" onClick={async () => { const f = await platform.chooseFolder(); if (f) setFolder(f); }}><Icon name="folder" size={14} /></button>
              {folder && <button className="btn" onClick={() => setFolder('')}><Icon name="close" size={14} /></button>}
            </div>
          </label>
        )}
        <div className="muted small">Colour profile: sRGB. Camera metadata (EXIF) is not copied in this version.</div>
      </div>
    </Modal>
  );
}

export function SettingsDialog({ settings, onChange, onClose }: { settings: AppSettings; onChange: (s: AppSettings) => void; onClose: () => void }) {
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [ver, setVer] = useState('');
  useEffect(() => { platform.hasSecret('replicate').then(setHasKey); platform.version().then(setVer); }, []);
  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="form">
        <label>Theme<div className="seg">{(['dark', 'light'] as const).map(t => <button key={t} className={settings.theme === t ? 'on' : ''} onClick={() => onChange({ ...settings, theme: t })}>{t === 'dark' ? 'Dark' : 'Light'}</button>)}</div></label>
        <label>Editing mode<div className="seg">
          <button className={settings.mode === 'beginner' ? 'on' : ''} onClick={() => onChange({ ...settings, mode: 'beginner' })}>Beginner</button>
          <button className={settings.mode === 'pro' ? 'on' : ''} onClick={() => onChange({ ...settings, mode: 'pro' })}>Professional</button>
        </div></label>
        <div className="muted small">Beginner mode shows simple sliders and presets. Professional mode adds curves, HSL, colour grading, detail and lens controls.</div>
        <label className="row gap"><input type="checkbox" checked={settings.autosave} onChange={e => onChange({ ...settings, autosave: e.target.checked })} /> Save my edits automatically (crash recovery)</label>
        <h3>AI services</h3>
        <div className="muted small">Manual editing and the offline AI tools (background removal, object removal, enhance, upscale) need no account. Online AI features (art styles, AI edit, background generation) use your own Replicate account and API key from replicate.com. The key is encrypted with Windows' secure storage and never shown again.</div>
        {isDesktop ? (
          <div className="row gap">
            <input className="text grow" type="password" placeholder={hasKey ? '•••••••• (saved)' : 'Replicate API key'} value={key} onChange={e => setKey(e.target.value)} />
            <button className="btn" disabled={!key} onClick={async () => { const ok = await platform.setSecret('replicate', key); setKey(''); setHasKey(ok); toast(ok ? 'API key saved securely' : 'Could not save key', ok ? 'ok' : 'error'); }}>Save</button>
          </div>
        ) : <div className="muted small">API keys can only be stored in the desktop app.</div>}
        <div className="muted small">Version {ver}</div>
      </div>
    </Modal>
  );
}

export function HistogramView({ hist }: { hist: Histogram | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    if (!hist) return;
    ctx.globalCompositeOperation = 'lighter';
    const draw = (a: Uint32Array, col: string) => {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, H);
      for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * W, H - Math.min(1, a[i] / hist.max) * H * 0.95);
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    };
    draw(hist.r, 'rgba(239,68,68,.55)'); draw(hist.g, 'rgba(34,197,94,.55)'); draw(hist.b, 'rgba(59,130,246,.6)');
    ctx.globalCompositeOperation = 'source-over';
  }, [hist]);
  const clipLo = hist ? hist.l[0] > 0 : false, clipHi = hist ? hist.l[255] > 0 : false;
  return (
    <div className="histogram">
      <canvas ref={ref} width={280} height={90} />
      <span className={'clip lo' + (clipLo ? ' on' : '')} title="Pure black pixels present" />
      <span className={'clip hi' + (clipHi ? ' on' : '')} title="Pure white pixels present" />
    </div>
  );
}
