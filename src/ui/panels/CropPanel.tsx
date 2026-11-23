import { useRef, useState } from 'react';
import { EditState, Geometry } from '../../state/types';
import { Slider, Section, Icon } from '../common';

type Upd = (label: string, f: (s: EditState) => void) => void;

export const ASPECTS: { k: string; label: string; r?: number }[] = [
  { k: 'free', label: 'Free' }, { k: 'original', label: 'Original' }, { k: '1:1', label: '1:1 Square', r: 1 },
  { k: '4:5', label: '4:5 Portrait', r: 4 / 5 }, { k: '3:2', label: '3:2 Landscape', r: 3 / 2 },
  { k: '16:9', label: '16:9 Landscape', r: 16 / 9 }, { k: '9:16', label: '9:16 Vertical', r: 9 / 16 },
  { k: '2:3', label: '2:3 Portrait', r: 2 / 3 }, { k: '5:4', label: '5:4', r: 5 / 4 },
];

export function aspectRatio(g: Geometry, OW: number, OH: number): number | null {
  if (g.aspect === 'free') return null;
  if (g.aspect === 'original') return OW / OH;
  if (g.aspect.startsWith('custom:')) { const [w, h] = g.aspect.slice(7).split('x').map(Number); return w && h ? w / h : null; }
  return ASPECTS.find(a => a.k === g.aspect)?.r ?? null;
}

/** Fit a crop of the given pixel ratio, centred on the current crop, inside the image. */
export function fitAspect(g: Geometry, ratio: number, OW: number, OH: number) {
  const k = (ratio * OH) / OW; // w_n / h_n
  let h = Math.min(1, 1 / k), w = h * k;
  const cx = g.crop.x + g.crop.w / 2, cy = g.crop.y + g.crop.h / 2;
  let x = Math.min(1 - w, Math.max(0, cx - w / 2)), y = Math.min(1 - h, Math.max(0, cy - h / 2));
  return { x, y, w, h };
}

export function rotateGeometry(g: Geometry, dir: 1 | -1) {
  const c = g.crop;
  g.rot90 = (((g.rot90 + dir) % 4) + 4) % 4 as 0 | 1 | 2 | 3;
  g.crop = dir === 1 ? { x: 1 - c.y - c.h, y: c.x, w: c.h, h: c.w } : { x: c.y, y: 1 - c.x - c.w, w: c.h, h: c.w };
  if (g.aspect.includes(':') && !g.aspect.startsWith('custom')) {
    const [a, b] = g.aspect.split(':'); if (a !== b) g.aspect = `${b}:${a}`;
    if (!ASPECTS.find(x => x.k === g.aspect)) g.aspect = 'free';
  }
}

export function CropPanel({ state, update, oriented }: { state: EditState; update: Upd; oriented: [number, number] }) {
  const g = state.geometry;
  const [OW, OH] = oriented;
  const outW = Math.round(OW * g.crop.w), outH = Math.round(OH * g.crop.h);
  const [cw, setCw] = useState(''); const [ch, setCh] = useState('');
  const [exp, setExp] = useState({ t: 10, r: 10, b: 10, l: 10 });

  const setAspect = (k: string) => update('Aspect ' + k, s => {
    s.geometry.aspect = k;
    const r = aspectRatio(s.geometry, OW, OH);
    if (r) s.geometry.crop = fitAspect(s.geometry, r, OW, OH);
  });
  const applyCustom = () => {
    const w = parseInt(cw), h = parseInt(ch);
    if (!(w > 0 && h > 0)) return;
    update(`Crop ${w}×${h}`, s => {
      s.geometry.aspect = `custom:${w}x${h}`;
      const wn = Math.min(1, w / OW), hn = Math.min(1, h / OH);
      // keep exact ratio
      const r = w / h;
      let fit = fitAspect(s.geometry, r, OW, OH);
      if (w <= OW && h <= OH) fit = { x: Math.max(0, 0.5 - wn / 2), y: Math.max(0, 0.5 - hn / 2), w: wn, h: hn };
      s.geometry.crop = fit;
    });
  };
  const expand = () => update('Expand canvas', s => {
    const c = s.geometry.crop;
    const l = exp.l / 100 * c.w, r = exp.r / 100 * c.w, t = exp.t / 100 * c.h, b = exp.b / 100 * c.h;
    s.geometry.crop = { x: c.x - l, y: c.y - t, w: c.w + l + r, h: c.h + t + b };
    s.geometry.aspect = 'free';
  });

  return (
    <div>
      <Section title="Aspect ratio">
        <div className="chips">
          {ASPECTS.map(a => <button key={a.k} className={'chip' + (g.aspect === a.k ? ' on' : '')} onClick={() => setAspect(a.k)}>{a.label}</button>)}
        </div>
        <div className="row gap">
          <input className="num w70" placeholder="Width" value={cw} onChange={e => setCw(e.target.value)} />
          <span>×</span>
          <input className="num w70" placeholder="Height" value={ch} onChange={e => setCh(e.target.value)} />
          <span className="muted">px</span>
          <button className="btn" onClick={applyCustom}>Apply</button>
        </div>
        <div className="muted small">Result: {outW} × {outH} px · {(outW / 300 * 2.54).toFixed(1)} × {(outH / 300 * 2.54).toFixed(1)} cm at 300 dpi</div>
      </Section>
      <Section title="Rotate & flip">
        <div className="row gap">
          <button className="btn" onClick={() => update('Rotate left', s => rotateGeometry(s.geometry, -1))}><Icon name="rotl" size={15} /> Left</button>
          <button className="btn" onClick={() => update('Rotate right', s => rotateGeometry(s.geometry, 1))}><Icon name="rotr" size={15} /> Right</button>
          <button className="btn" onClick={() => update('Flip horizontal', s => { s.geometry.flipH = !s.geometry.flipH; s.geometry.crop.x = 1 - s.geometry.crop.x - s.geometry.crop.w; })}><Icon name="fliph" size={15} /></button>
          <button className="btn" onClick={() => update('Flip vertical', s => { s.geometry.flipV = !s.geometry.flipV; s.geometry.crop.y = 1 - s.geometry.crop.y - s.geometry.crop.h; })}><Icon name="flipv" size={15} /></button>
        </div>
        <Slider label="Straighten" value={g.straighten} min={-45} max={45} step={0.1} unit="°" onChange={v => update('Straighten', s => { s.geometry.straighten = v; })} />
      </Section>
      <Section title="Perspective correction">
        <Slider label="Vertical" value={state.optics.vertical} min={-100} max={100} onChange={v => update('Vertical perspective', s => { s.optics.vertical = v; })} />
        <Slider label="Horizontal" value={state.optics.horizontal} min={-100} max={100} onChange={v => update('Horizontal perspective', s => { s.optics.horizontal = v; })} />
      </Section>
      <Section title="Canvas expansion" defaultOpen={false}>
        <div className="grid4">
          {(['t', 'r', 'b', 'l'] as const).map(k => <label key={k}>{{ t: 'Top', r: 'Right', b: 'Bottom', l: 'Left' }[k]} %<input className="num" value={exp[k]} onChange={e => setExp({ ...exp, [k]: Math.max(0, +e.target.value || 0) })} /></label>)}
        </div>
        <div className="row gap">
          <label className="row gap">Fill
            <input type="color" value={g.fill === 'transparent' ? '#ffffff' : g.fill} disabled={g.fill === 'transparent'} onChange={e => update('Canvas fill', s => { s.geometry.fill = e.target.value; })} />
          </label>
          <label className="row gap"><input type="checkbox" checked={g.fill === 'transparent'} onChange={e => update('Canvas fill', s => { s.geometry.fill = e.target.checked ? 'transparent' : '#ffffff'; })} /> Transparent</label>
        </div>
        <button className="btn wide" onClick={expand}>Expand canvas</button>
      </Section>
      <button className="btn wide" onClick={() => update('Reset crop & rotation', s => { s.geometry = { ...s.geometry, rot90: 0, flipH: false, flipV: false, straighten: 0, crop: { x: 0, y: 0, w: 1, h: 1 }, aspect: 'free' }; })}><Icon name="reset" size={14} /> Reset crop & rotation</button>
    </div>
  );
}

// ---------------- Crop overlay on the canvas ----------------
interface OverlayProps {
  box: { x: number; y: number; w: number; h: number }; // displayed frame in container px
  frame: { x: number; y: number; w: number; h: number }; // normalized region the box displays
  crop: { x: number; y: number; w: number; h: number };
  ratio: number | null; oriented: [number, number];
  onChange: (c: { x: number; y: number; w: number; h: number }) => void;
}
export function CropOverlay({ box, frame, crop, ratio, oriented, onChange }: OverlayProps) {
  const drag = useRef<{ mode: string; sx: number; sy: number; c: typeof crop } | null>(null);
  const toPx = (c: typeof crop) => ({
    left: box.x + ((c.x - frame.x) / frame.w) * box.w, top: box.y + ((c.y - frame.y) / frame.h) * box.h,
    width: (c.w / frame.w) * box.w, height: (c.h / frame.h) * box.h,
  });
  const r = toPx(crop);
  const down = (mode: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, c: { ...crop } };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = ((e.clientX - d.sx) / box.w) * frame.w, dy = ((e.clientY - d.sy) / box.h) * frame.h;
    const minX = frame.x, minY = frame.y, maxX = frame.x + frame.w, maxY = frame.y + frame.h;
    let { x, y, w, h } = d.c;
    const MIN = 0.02;
    if (d.mode === 'move') {
      x = Math.min(maxX - w, Math.max(minX, x + dx)); y = Math.min(maxY - h, Math.max(minY, y + dy));
      onChange({ x, y, w, h }); return;
    }
    let x2 = x + w, y2 = y + h;
    if (d.mode.includes('w')) x = Math.min(x2 - MIN, Math.max(minX, x + dx));
    if (d.mode.includes('e')) x2 = Math.max(x + MIN, Math.min(maxX, x2 + dx));
    if (d.mode.includes('n')) y = Math.min(y2 - MIN, Math.max(minY, y + dy));
    if (d.mode.includes('s')) y2 = Math.max(y + MIN, Math.min(maxY, y2 + dy));
    w = x2 - x; h = y2 - y;
    if (ratio) {
      const k = (ratio * oriented[1]) / oriented[0]; // w_n / h_n
      const horizontalOnly = d.mode === 'e' || d.mode === 'w';
      if (horizontalOnly) h = w / k; else if (d.mode === 'n' || d.mode === 's') w = h * k;
      else { if (w / k > h) h = w / k; else w = h * k; }
      if (d.mode.includes('w')) x = x2 - w;
      if (d.mode.includes('n')) y = y2 - h;
      if (horizontalOnly) y = d.c.y + (d.c.h - h) / 2;
      if (d.mode === 'n' || d.mode === 's') x = d.c.x + (d.c.w - w) / 2;
      // keep inside
      if (x < minX || y < minY || x + w > maxX || y + h > maxY) return;
    }
    onChange({ x, y, w, h });
  };
  const up = () => { drag.current = null; };
  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  return (
    <div className="crop-layer" onPointerMove={move} onPointerUp={up}>
      <div className="crop-rect" style={r} onPointerDown={down('move')}>
        <div className="thirds" />
        {handles.map(h => <div key={h} className={'ch ch-' + h} onPointerDown={down(h)} />)}
        <div className="crop-size">{Math.round(crop.w * oriented[0])} × {Math.round(crop.h * oriented[1])}</div>
      </div>
    </div>
  );
}
