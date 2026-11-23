import { useRef, useState, useMemo } from 'react';
import { EditState, CurvePoint, defaultCurve } from '../../state/types';
import { curveToLut } from '../../engine/curves';
import type { Histogram } from '../../engine/Renderer';
import { Icon } from '../common';

type Upd = (label: string, f: (s: EditState) => void) => void;
type Ch = 'master' | 'r' | 'g' | 'b';
const CH: { k: Ch; label: string; color: string }[] = [
  { k: 'master', label: 'RGB', color: 'var(--text)' }, { k: 'r', label: 'Red', color: '#ef4444' },
  { k: 'g', label: 'Green', color: '#22c55e' }, { k: 'b', label: 'Blue', color: '#3b82f6' },
];
const SZ = 256;

const PRESETS: { name: string; pts: CurvePoint[] }[] = [
  { name: 'Linear', pts: [[0, 0], [1, 1]] },
  { name: 'Medium contrast', pts: [[0, 0], [0.25, 0.21], [0.75, 0.79], [1, 1]] },
  { name: 'Strong contrast', pts: [[0, 0], [0.25, 0.16], [0.75, 0.84], [1, 1]] },
  { name: 'Matte fade', pts: [[0, 0.1], [0.25, 0.28], [0.75, 0.75], [1, 0.94]] },
  { name: 'Brighten', pts: [[0, 0], [0.45, 0.58], [1, 1]] },
  { name: 'Darken', pts: [[0, 0], [0.55, 0.42], [1, 1]] },
];

export function CurvesPanel({ state, update, hist }: { state: EditState; update: Upd; hist: Histogram | null }) {
  const [ch, setCh] = useState<Ch>('master');
  const [sel, setSel] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ i: number } | null>(null);
  const pts = state.curves[ch];
  const lut = useMemo(() => curveToLut(pts), [pts]);
  const color = CH.find(c => c.k === ch)!.color;

  const setPts = (p: CurvePoint[], label = 'Curve') => update(label + (ch === 'master' ? '' : ` (${ch.toUpperCase()})`), s => { s.curves[ch] = p; });

  const toLocal = (e: React.PointerEvent | PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height] as [number, number];
  };
  const clamp = (v: number) => Math.min(1, Math.max(0, v));

  const onDown = (e: React.PointerEvent) => {
    const [x, y] = toLocal(e);
    let idx = pts.findIndex(p => Math.hypot(p[0] - x, p[1] - y) < 0.04);
    let next = pts;
    if (idx < 0) {
      next = [...pts, [clamp(x), clamp(y)] as CurvePoint].sort((a, b) => a[0] - b[0]);
      idx = next.findIndex(p => p[0] === clamp(x) && p[1] === clamp(y));
      setPts(next, 'Add curve point');
    }
    setSel(idx);
    drag.current = { i: idx };
    svg.current?.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const [x, y] = toLocal(e);
    const i = drag.current.i;
    const p = pts.map(q => [...q] as CurvePoint);
    const last = p.length - 1;
    // drag far outside to remove interior points
    if (i > 0 && i < last && (y < -0.15 || y > 1.15)) {
      p.splice(i, 1); drag.current = null; setSel(null); setPts(p, 'Remove curve point'); return;
    }
    const lo = i === 0 ? 0 : p[i - 1][0] + 0.01;
    const hi = i === last ? 1 : p[i + 1][0] - 0.01;
    p[i] = [Math.min(hi, Math.max(lo, clamp(x))), clamp(y)];
    setPts(p);
  };
  const onUp = () => { drag.current = null; };
  const removeSel = () => {
    if (sel == null || sel === 0 || sel === pts.length - 1) return;
    const p = pts.filter((_, k) => k !== sel); setSel(null); setPts(p, 'Remove curve point');
  };

  // histogram path
  const hpath = useMemo(() => {
    if (!hist) return '';
    const arr = ch === 'master' ? hist.l : hist[ch];
    let max = 1; for (let i = 2; i < 254; i++) max = Math.max(max, arr[i]);
    let d = `M0 ${SZ}`;
    for (let i = 0; i < 256; i++) d += ` L${i} ${SZ - Math.min(1, arr[i] / max) * SZ * 0.9}`;
    return d + ` L${SZ} ${SZ} Z`;
  }, [hist, ch]);

  let cpath = '';
  for (let i = 0; i < 256; i++) cpath += (i ? ' L' : 'M') + i + ' ' + (SZ - lut[i] * SZ);
  const sp = sel != null ? pts[sel] : null;

  return (
    <div className="curves">
      <div className="tabs small">
        {CH.map(c => <button key={c.k} className={ch === c.k ? 'on' : ''} onClick={() => { setCh(c.k); setSel(null); }} style={{ color: ch === c.k ? c.color : undefined }}>{c.label}</button>)}
      </div>
      <svg ref={svg} className="curve-box" viewBox={`0 0 ${SZ} ${SZ}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        onDoubleClick={removeSel} onContextMenu={e => { e.preventDefault(); removeSel(); }}>
        <rect width={SZ} height={SZ} className="curve-bg" />
        {hpath && <path d={hpath} className="curve-hist" />}
        {[0.25, 0.5, 0.75].map(g => <g key={g}><line x1={g * SZ} y1={0} x2={g * SZ} y2={SZ} className="curve-grid" /><line y1={g * SZ} x1={0} y2={g * SZ} x2={SZ} className="curve-grid" /></g>)}
        <line x1={0} y1={SZ} x2={SZ} y2={0} className="curve-diag" />
        <path d={cpath} fill="none" stroke={color} strokeWidth={2} />
        {pts.map((p, i) => <circle key={i} cx={p[0] * SZ} cy={SZ - p[1] * SZ} r={sel === i ? 6 : 4.5} className={'curve-pt' + (sel === i ? ' sel' : '')} style={{ stroke: color }} />)}
      </svg>
      <div className="curve-io">
        <label>Input <input className="num" disabled={!sp} value={sp ? Math.round(sp[0] * 255) : ''} onChange={e => {
          if (sel == null) return; const v = Math.min(255, Math.max(0, +e.target.value || 0)) / 255;
          const p = pts.map(q => [...q] as CurvePoint); p[sel][0] = v; setPts(p.sort((a, b) => a[0] - b[0]));
        }} /></label>
        <label>Output <input className="num" disabled={!sp} value={sp ? Math.round(sp[1] * 255) : ''} onChange={e => {
          if (sel == null) return; const v = Math.min(255, Math.max(0, +e.target.value || 0)) / 255;
          const p = pts.map(q => [...q] as CurvePoint); p[sel][1] = v; setPts(p);
        }} /></label>
        <button className="btn" onClick={removeSel} disabled={sel == null || sel === 0 || sel === pts.length - 1} title="Remove point"><Icon name="trash" size={14} /></button>
        <button className="btn" onClick={() => { setSel(null); setPts(defaultCurve(), 'Reset curve'); }} title="Reset this channel"><Icon name="reset" size={14} /></button>
      </div>
      <p className="hint">Click to add a point, drag to adjust. Double-click, right-click or drag a point off the box to remove it.</p>
      <div className="chips">
        {PRESETS.map(p => <button key={p.name} className="chip" onClick={() => { setSel(null); setPts(p.pts.map(q => [...q] as CurvePoint), 'Curve: ' + p.name); }}>{p.name}</button>)}
      </div>
      <button className="btn wide" onClick={() => update('Reset all curves', s => { s.curves = { master: defaultCurve(), r: defaultCurve(), g: defaultCurve(), b: defaultCurve() }; })}>Reset all channels</button>
    </div>
  );
}
