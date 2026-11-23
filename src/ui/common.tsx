import { useEffect, useRef, useState, ReactNode } from 'react';

// ---------- Icons (inline SVG, stroke style) ----------
const P: Record<string, string> = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  open: 'M3 7h6l2 2h10v10H3zM3 7V5h6',
  save: 'M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-4',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h4',
  crop: 'M6 2v16h16M2 6h16v16',
  rotl: 'M3 12a9 9 0 109-9M3 4v5h5',
  rotr: 'M21 12a9 9 0 11-9-9M21 4v5h-5',
  fliph: 'M12 3v18M8 7L3 12l5 5zM16 7l5 5-5 5z',
  flipv: 'M3 12h18M7 8l5-5 5 5zM7 16l5 5 5-5z',
  zoomin: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5M11 8v6M8 11h6',
  zoomout: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5M8 11h6',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  compare: 'M12 3v18M4 5h16v14H4z',
  export: 'M12 3v12M7 8l5-5 5 5M4 15v5h16v-5',
  ai: 'M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4zM19 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1z',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  color: 'M12 3a9 9 0 100 18c1 0 2-1 2-2s-1-1.5-1-2.5S14 15 15 15h2a4 4 0 004-4c0-4.4-4-8-9-8zM7.5 11.5h0M9.5 7.5h0M14.5 7.5h0M17 11h0',
  detail: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 7v10M7 12h10',
  retouch: 'M15 3l6 6-11 11H4v-6zM13 5l6 6',
  effects: 'M5 3v4M3 5h4M6 17v4M4 19h4M13 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  filters: 'M9 3a6 6 0 100 12A6 6 0 009 3zM15 9a6 6 0 110 12 6 6 0 010-12z',
  text: 'M4 6V4h16v2M12 4v16M8 20h8',
  sticker: 'M12 2a10 10 0 100 20h0l10-10A10 10 0 0012 2zM22 12h-6a4 4 0 00-4 4v6',
  frame: 'M3 3h18v18H3zM7 7h10v10H7z',
  transform: 'M6 2v16h16M2 6h16v16M10 14l4-4',
  history: 'M3 12a9 9 0 109-9 9 9 0 00-7 3.3M3 4v4h4M12 7v5l3 3',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15 9h0',
  folder: 'M3 6h6l2 2h10v11H3z',
  batch: 'M7 7h14v12H7zM3 3h14v2M3 3v12h2',
  restore: 'M4 4l16 16M9 4h11v11M4 9v11h11',
  portrait: 'M12 3a4 4 0 100 8 4 4 0 000-8zM4 21c1-4 4-6 8-6s7 2 8 6',
  share: 'M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zM18 22a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  close: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 14h12l1-14M9 7V4h6v3',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 13A9 9 0 1111 3a7 7 0 0010 10z',
  wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  paste: 'M9 3h6v3H9zM6 5H4v16h16V5h-2',
  import: 'M12 3v12M7 10l5 5 5-5M4 15v5h16v-5',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  check: 'M5 12l5 5 9-11',
  reset: 'M3 12a9 9 0 109-9 9 9 0 00-7 3.3M3 4v4h4',
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name] || P.image} />
    </svg>
  );
}

// ---------- Slider with numeric input ----------
interface SliderProps {
  label: string; value: number; min: number; max: number; step?: number; def?: number;
  onChange: (v: number) => void; gradient?: string; unit?: string; tip?: string; decimals?: number;
}
export function Slider({ label, value, min, max, step = 1, def = 0, onChange, gradient, unit, tip, decimals }: SliderProps) {
  const [text, setText] = useState<string | null>(null);
  const dec = decimals ?? (step < 1 ? (step < 0.1 ? 2 : 1) : 0);
  const bipolar = min < 0 && max > 0;
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const fillStyle = gradient
    ? { background: gradient }
    : bipolar
      ? { background: `linear-gradient(to right, var(--track) 0%, var(--track) ${Math.min(pct(0), pct(value))}%, var(--accent) ${Math.min(pct(0), pct(value))}%, var(--accent) ${Math.max(pct(0), pct(value))}%, var(--track) ${Math.max(pct(0), pct(value))}%)` }
      : { background: `linear-gradient(to right, var(--accent) ${pct(value)}%, var(--track) ${pct(value)}%)` };
  const commitText = () => {
    if (text == null) return;
    const v = parseFloat(text);
    if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
    setText(null);
  };
  return (
    <div className={'slider' + (value !== def ? ' changed' : '')} title={tip}>
      <div className="slider-head">
        <label onDoubleClick={() => onChange(def)} title={(tip ? tip + ' — ' : '') + 'Double-click to reset'}>{label}</label>
        <input className="num" value={text ?? value.toFixed(dec)} onChange={e => setText(e.target.value)}
          onBlur={commitText} onKeyDown={e => { if (e.key === 'Enter') { commitText(); (e.target as HTMLInputElement).blur(); } }} />
        {unit && <span className="unit">{unit}</span>}
        <button className="mini reset" title="Reset" onClick={() => onChange(def)} disabled={value === def}><Icon name="reset" size={12} /></button>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} style={fillStyle}
        onChange={e => onChange(parseFloat(e.target.value))} onDoubleClick={() => onChange(def)} />
    </div>
  );
}

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={'section' + (open ? ' open' : '')}>
      <div className="section-head" onClick={() => setOpen(!open)}>
        <span className="chev">{open ? '▾' : '▸'}</span><span>{title}</span>
        <span className="grow" />
        <span onClick={e => e.stopPropagation()}>{right}</span>
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

export function Planned({ phase, title, items, note }: { phase: number; title: string; items: string[]; note?: string }) {
  return (
    <div className="planned">
      <div className="badge">Planned · Phase {phase}</div>
      <h3>{title}</h3>
      <p>{note || 'This workspace is part of a later build phase. It is shown here so you can see what is coming; nothing here runs yet.'}</p>
      <ul>{items.map(i => <li key={i}>{i}</li>)}</ul>
    </div>
  );
}

// ---------- Toasts ----------
type Toast = { id: number; text: string; kind: 'info' | 'error' | 'ok' };
let listeners: ((t: Toast[]) => void)[] = [];
let toasts: Toast[] = [];
let tid = 1;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 3500) {
  const t = { id: tid++, text, kind };
  toasts = [...toasts, t];
  listeners.forEach(l => l(toasts));
  setTimeout(() => { toasts = toasts.filter(x => x.id !== t.id); listeners.forEach(l => l(toasts)); }, kind === 'error' ? ms * 2 : ms);
}
export function Toasts() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => { listeners.push(setList); return () => { listeners = listeners.filter(l => l !== setList); }; }, []);
  return <div className="toasts">{list.map(t => <div key={t.id} className={'toast ' + t.kind}>{t.text}</div>)}</div>;
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (wide ? ' wide' : '')}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose}><Icon name="close" /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function useLatest<T>(v: T) { const r = useRef(v); r.current = v; return r; }

export function formatDate(t: number) {
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function formatBytes(n: number) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}
