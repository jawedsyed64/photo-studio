import { useRef, useState, useEffect } from 'react';
import { EditState, HSL_BANDS, HSL_SWATCH, HSL_CENTERS, defaultHsl, defaultGrading, Wheel, defaultDetail, defaultOptics } from '../../state/types';
import { Slider, Section, Icon } from '../common';

type Upd = (label: string, f: (s: EditState) => void) => void;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// ---------------- HSL ----------------
export function HslPanel({ state, update }: { state: EditState; update: Upd }) {
  const [mode, setMode] = useState<'h' | 's' | 'l' | 'all'>('h');
  const names = { h: 'Hue', s: 'Saturation', l: 'Luminance' } as const;
  const grad = (i: number, m: 'h' | 's' | 'l') => {
    const c = HSL_CENTERS[i];
    if (m === 'h') return `linear-gradient(to right, hsl(${c - 30},80%,55%), hsl(${c},80%,55%), hsl(${c + 30},80%,55%))`;
    if (m === 's') return `linear-gradient(to right, hsl(${c},0%,55%), hsl(${c},90%,55%))`;
    return `linear-gradient(to right, hsl(${c},70%,15%), hsl(${c},70%,50%), hsl(${c},70%,88%))`;
  };
  const row = (b: typeof HSL_BANDS[number], i: number, m: 'h' | 's' | 'l', label: string) => (
    <Slider key={b + m} label={label} value={state.hsl[b][m]} min={-100} max={100} gradient={grad(i, m)}
      onChange={v => update(`${cap(b)} ${names[m].toLowerCase()}`, s => { s.hsl[b][m] = v; })} />
  );
  return (
    <div>
      <div className="tabs small">
        {(['h', 's', 'l', 'all'] as const).map(m => <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m === 'all' ? 'All' : names[m]}</button>)}
      </div>
      {mode !== 'all'
        ? HSL_BANDS.map((b, i) => <div key={b} className="hsl-row"><span className="dot" style={{ background: HSL_SWATCH[i] }} />{row(b, i, mode, cap(b))}</div>)
        : HSL_BANDS.map((b, i) => (
          <Section key={b} title={cap(b)} defaultOpen={i < 2} right={<span className="dot" style={{ background: HSL_SWATCH[i] }} />}>
            {row(b, i, 'h', 'Hue')}{row(b, i, 's', 'Saturation')}{row(b, i, 'l', 'Luminance')}
          </Section>
        ))}
      <button className="btn wide" onClick={() => update('Reset HSL', s => { s.hsl = defaultHsl(); })}><Icon name="reset" size={14} /> Reset HSL</button>
    </div>
  );
}

// ---------------- Colour wheel ----------------
function ColorWheel({ value, onChange, size = 120 }: { value: Wheel; onChange: (w: Wheel) => void; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  useEffect(() => {
    const c = ref.current!; const ctx = c.getContext('2d')!;
    const r = size / 2;
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = x - r, dy = y - r, d = Math.hypot(dx, dy) / r;
      const i = (y * size + x) * 4;
      if (d > 1) { img.data[i + 3] = 0; continue; }
      const h = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360;
      const [R, G, B] = hsl(h / 360, d, 0.5 + (1 - d) * 0.25);
      img.data[i] = R; img.data[i + 1] = G; img.data[i + 2] = B; img.data[i + 3] = d > 0.97 ? Math.round((1 - d) / 0.03 * 255) : 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [size]);
  const set = (e: React.PointerEvent) => {
    const rc = ref.current!.getBoundingClientRect();
    const dx = e.clientX - rc.left - rc.width / 2, dy = e.clientY - rc.top - rc.height / 2;
    const d = Math.min(1, Math.hypot(dx, dy) / (rc.width / 2));
    const h = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360;
    onChange({ ...value, hue: Math.round(h), sat: Math.round(d * 100) });
  };
  const a = (value.hue * Math.PI) / 180, rr = (value.sat / 100) * (size / 2);
  return (
    <div className="wheel" style={{ width: size, height: size }}
      onPointerDown={e => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); set(e); }}
      onPointerMove={e => dragging.current && set(e)} onPointerUp={() => (dragging.current = false)}
      onDoubleClick={() => onChange({ ...value, hue: 0, sat: 0 })}>
      <canvas ref={ref} width={size} height={size} />
      <div className="puck" style={{ left: size / 2 + Math.cos(a) * rr, top: size / 2 - Math.sin(a) * rr }} />
    </div>
  );
}
function hsl(h: number, s: number, l: number) {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255));
}

export function GradingPanel({ state, update }: { state: EditState; update: Upd }) {
  const [view, setView] = useState<'3way' | 'shadows' | 'midtones' | 'highlights' | 'global'>('3way');
  const g = state.grading;
  const wheel = (k: 'shadows' | 'midtones' | 'highlights' | 'global', size: number) => (
    <div className="wheel-block" key={k}>
      <div className="wheel-title">{cap(k)}</div>
      <ColorWheel size={size} value={g[k]} onChange={w => update(cap(k) + ' colour', s => { s.grading[k] = w; })} />
      <div className="wheel-vals">H {g[k].hue}° · S {g[k].sat}</div>
      <Slider label="Luminance" value={g[k].lum} min={-100} max={100} onChange={v => update(cap(k) + ' luminance', s => { s.grading[k].lum = v; })} />
      {view !== '3way' && <>
        <Slider label="Hue" value={g[k].hue} min={0} max={360} def={0} gradient="linear-gradient(to right,red,yellow,lime,cyan,blue,magenta,red)" onChange={v => update(cap(k) + ' hue', s => { s.grading[k].hue = v; })} />
        <Slider label="Saturation" value={g[k].sat} min={0} max={100} onChange={v => update(cap(k) + ' saturation', s => { s.grading[k].sat = v; })} />
      </>}
    </div>
  );
  return (
    <div>
      <div className="tabs small">
        {(['3way', 'shadows', 'midtones', 'highlights', 'global'] as const).map(v => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v === '3way' ? '3-Way' : cap(v)}</button>)}
      </div>
      {view === '3way'
        ? <div className="wheels3">
            <div className="wheel-top">{wheel('midtones', 112)}</div>
            <div className="wheel-pair">{wheel('shadows', 104)}{wheel('highlights', 104)}</div>
          </div>
        : wheel(view, 170)}
      <Slider label="Blending" value={g.blending} min={0} max={100} def={50} onChange={v => update('Grading blending', s => { s.grading.blending = v; })} tip="How much the shadow / mid / highlight ranges overlap" />
      <Slider label="Balance" value={g.balance} min={-100} max={100} def={0} onChange={v => update('Grading balance', s => { s.grading.balance = v; })} tip="Shift the split point towards shadows (−) or highlights (+)" />
      <Section title="Split toning presets" defaultOpen={false}>
        <div className="chips">
          {[
            { n: 'Teal & orange', sh: [190, 35], hi: [32, 30] },
            { n: 'Warm / cool', sh: [220, 25], hi: [45, 25] },
            { n: 'Sepia', sh: [30, 30], hi: [40, 20] },
            { n: 'Cyberpunk', sh: [260, 40], hi: [320, 30] },
            { n: 'Forest', sh: [150, 25], hi: [55, 20] },
          ].map(p => <button key={p.n} className="chip" onClick={() => update('Split tone: ' + p.n, s => {
            s.grading.shadows = { ...s.grading.shadows, hue: p.sh[0], sat: p.sh[1] };
            s.grading.highlights = { ...s.grading.highlights, hue: p.hi[0], sat: p.hi[1] };
          })}>{p.n}</button>)}
        </div>
      </Section>
      <button className="btn wide" onClick={() => update('Reset colour grading', s => { s.grading = defaultGrading(); })}><Icon name="reset" size={14} /> Reset grading</button>
    </div>
  );
}

// ---------------- Detail & optics ----------------
export function DetailPanel({ state, update }: { state: EditState; update: Upd }) {
  const d = state.detail, o = state.optics;
  return (
    <div>
      <Section title="Sharpening">
        <Slider label="Amount" value={d.sharpenAmount} min={0} max={150} onChange={v => update('Sharpen amount', s => { s.detail.sharpenAmount = v; })} />
        <Slider label="Radius" value={d.sharpenRadius} min={0.5} max={3} step={0.1} def={1} onChange={v => update('Sharpen radius', s => { s.detail.sharpenRadius = v; })} />
        <Slider label="Detail" value={d.sharpenDetail} min={0} max={100} def={25} onChange={v => update('Sharpen detail', s => { s.detail.sharpenDetail = v; })} tip="Low values suppress halos" />
        <Slider label="Masking" value={d.sharpenMasking} min={0} max={100} onChange={v => update('Sharpen masking', s => { s.detail.sharpenMasking = v; })} tip="Higher values sharpen only edges, not smooth areas like skin or sky" />
      </Section>
      <Section title="Noise reduction">
        <Slider label="Luminance" value={d.lumaNoise} min={0} max={100} onChange={v => update('Luminance noise reduction', s => { s.detail.lumaNoise = v; })} />
        <Slider label="Colour" value={d.colorNoise} min={0} max={100} onChange={v => update('Colour noise reduction', s => { s.detail.colorNoise = v; })} />
      </Section>
      <Section title="Lens corrections">
        <Slider label="Distortion" value={o.distortion} min={-100} max={100} onChange={v => update('Lens distortion', s => { s.optics.distortion = v; })} tip="Corrects barrel (+) or pincushion (−) distortion" />
        <Slider label="Chromatic aberration" value={o.chromatic} min={-100} max={100} onChange={v => update('Chromatic aberration', s => { s.optics.chromatic = v; })} tip="Slide until coloured fringes on edges disappear" />
      </Section>
      <Section title="Perspective">
        <Slider label="Vertical" value={o.vertical} min={-100} max={100} onChange={v => update('Vertical perspective', s => { s.optics.vertical = v; })} tip="Straightens converging vertical lines (e.g. buildings)" />
        <Slider label="Horizontal" value={o.horizontal} min={-100} max={100} onChange={v => update('Horizontal perspective', s => { s.optics.horizontal = v; })} />
      </Section>
      <button className="btn wide" onClick={() => update('Reset detail', s => { s.detail = defaultDetail(); s.optics = defaultOptics(); })}><Icon name="reset" size={14} /> Reset detail & optics</button>
    </div>
  );
}
