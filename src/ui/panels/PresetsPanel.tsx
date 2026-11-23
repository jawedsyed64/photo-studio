import { useEffect, useMemo, useRef, useState } from 'react';
import { EditState, clone } from '../../state/types';
import { Preset, BUILT_IN_PRESETS, PRESET_CATEGORIES, applyPreset, settingsFromState } from '../../state/presets';
import { Slider, Icon, toast } from '../common';
import { platform } from '../../platform';

interface Props {
  state: EditState;
  setStateLabeled: (label: string, s: EditState) => void;
  onPreview: (s: EditState | null) => void;
  thumb: (s: EditState) => string | null;
  imageKey: string;
}

export function usePresets() {
  const [user, setUser] = useState<Preset[]>([]);
  useEffect(() => { platform.get<Preset[]>('presets', []).then(setUser); }, []);
  const save = (list: Preset[]) => { setUser(list); platform.set('presets', list); };
  return { user, save, all: [...BUILT_IN_PRESETS, ...user] };
}

export function PresetsPanel({ state, setStateLabeled, onPreview, thumb, imageKey }: Props) {
  const { user, save, all } = usePresets();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const [active, setActive] = useState<{ id: string; base: EditState; amount: number } | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [naming, setNaming] = useState<{ id?: string; name: string } | null>(null);
  const thumbKey = useRef('');

  const list = useMemo(() => all.filter(p => (cat === 'All' || p.category === cat) && p.name.toLowerCase().includes(q.toLowerCase())), [all, cat, q]);

  // build thumbnails progressively (real renders of this photo with each preset)
  useEffect(() => {
    if (thumbKey.current !== imageKey) { thumbKey.current = imageKey; setThumbs({}); }
    let cancelled = false;
    const todo = list.filter(p => !thumbs[p.id]);
    let i = 0;
    const step = () => {
      if (cancelled || i >= todo.length) return;
      const p = todo[i++];
      const base = active ? active.base : state;
      const url = thumb(applyPreset({ ...base, geometry: state.geometry }, p, 100));
      if (url) setThumbs(t => ({ ...t, [p.id]: url }));
      setTimeout(step, 10);
    };
    const t = setTimeout(step, 50);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line
  }, [list, imageKey]);

  const apply = (p: Preset) => {
    const base = active ? active.base : clone(state);
    setActive({ id: p.id, base, amount: 100 });
    onPreview(null);
    setStateLabeled('Preset: ' + p.name, applyPreset({ ...base, geometry: state.geometry }, p, 100));
  };
  const setAmount = (v: number) => {
    if (!active) return;
    const p = all.find(x => x.id === active.id); if (!p) return;
    setActive({ ...active, amount: v });
    setStateLabeled('Preset intensity', applyPreset({ ...active.base, geometry: state.geometry }, p, v));
  };

  const saveCurrent = (name: string) => {
    const p: Preset = { id: 'u-' + Date.now(), name, category: 'My Presets', settings: settingsFromState(state) };
    save([...user, p]); toast(`Preset "${name}" saved`, 'ok');
  };
  const rename = (id: string, name: string) => save(user.map(p => p.id === id ? { ...p, name } : p));
  const remove = (id: string) => { save(user.filter(p => p.id !== id)); if (active?.id === id) setActive(null); };

  const exportPresets = async () => {
    if (!user.length) return toast('You have no custom presets to export yet');
    const path = await platform.saveText('photo-studio-presets.json', JSON.stringify({ app: 'PhotoStudio', type: 'presets', presets: user }, null, 2), [{ name: 'Presets', extensions: ['json'] }]);
    if (path) toast('Presets exported', 'ok');
  };
  const importPresets = async () => {
    const text = await platform.pickJson(); if (!text) return;
    try {
      const data = JSON.parse(text);
      const arr: Preset[] = Array.isArray(data) ? data : data.presets;
      if (!Array.isArray(arr)) throw new Error();
      const clean = arr.filter(p => p && p.name && p.settings).map(p => ({ ...p, id: 'u-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), category: p.category && PRESET_CATEGORIES.includes(p.category) ? p.category : 'My Presets', builtIn: false }));
      save([...user, ...clean]); toast(`Imported ${clean.length} preset(s)`, 'ok');
    } catch { toast('That file is not a valid preset file', 'error'); }
  };

  const activeP = active && all.find(p => p.id === active.id);
  return (
    <div className="presets">
      <input className="search" placeholder="Search presets…" value={q} onChange={e => setQ(e.target.value)} />
      <select className="select" value={cat} onChange={e => setCat(e.target.value)}>
        <option>All</option>{PRESET_CATEGORIES.map(c => <option key={c}>{c}</option>)}
      </select>
      {activeP && (
        <div className="active-preset">
          <div className="row"><b>{activeP.name}</b><span className="grow" /><button className="mini" title="Undo preset" onClick={() => { setStateLabeled('Remove preset', { ...active!.base, geometry: state.geometry }); setActive(null); }}><Icon name="close" size={12} /></button></div>
          <Slider label="Intensity" value={active!.amount} min={0} max={150} def={100} onChange={setAmount} unit="%" />
        </div>
      )}
      <div className="preset-grid">
        {list.map(p => (
          <div key={p.id} className={'preset' + (active?.id === p.id ? ' on' : '')}
            onMouseEnter={() => onPreview(applyPreset({ ...(active ? active.base : state), geometry: state.geometry }, p, 100))}
            onMouseLeave={() => onPreview(null)} onClick={() => apply(p)} title={p.category}>
            <div className="pthumb">{thumbs[p.id] ? <img src={thumbs[p.id]} alt="" /> : <div className="ph" />}</div>
            <div className="pname">{p.name}</div>
            {!p.builtIn && <div className="pact" onClick={e => e.stopPropagation()}>
              <button className="mini" title="Rename" onClick={() => setNaming({ id: p.id, name: p.name })}><Icon name="edit" size={11} /></button>
              <button className="mini" title="Delete" onClick={() => remove(p.id)}><Icon name="trash" size={11} /></button>
            </div>}
          </div>
        ))}
        {!list.length && <div className="muted">No presets match.</div>}
      </div>
      {naming ? (
        <div className="row gap">
          <input className="search" autoFocus value={naming.name} placeholder="Preset name" onChange={e => setNaming({ ...naming, name: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter' && naming.name.trim()) { naming.id ? rename(naming.id, naming.name.trim()) : saveCurrent(naming.name.trim()); setNaming(null); } }} />
          <button className="btn accent" disabled={!naming.name.trim()} onClick={() => { naming.id ? rename(naming.id, naming.name.trim()) : saveCurrent(naming.name.trim()); setNaming(null); }}><Icon name="check" size={14} /></button>
          <button className="btn" onClick={() => setNaming(null)}><Icon name="close" size={14} /></button>
        </div>
      ) : (
        <button className="btn wide accent" onClick={() => setNaming({ name: '' })}><Icon name="plus" size={14} /> Save current look as preset</button>
      )}
      <div className="row gap">
        <button className="btn grow" onClick={importPresets}><Icon name="import" size={14} /> Import</button>
        <button className="btn grow" onClick={exportPresets}><Icon name="export" size={14} /> Export</button>
      </div>
      <p className="hint">Hover a preset to preview it on your photo. Click to apply, then fine-tune the intensity.</p>
    </div>
  );
}

export function HistoryPanel({ entries, index, onJump }: { entries: { label: string; t: number }[]; index: number; onJump: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [index]);
  return (
    <div className="history" ref={ref}>
      {entries.map((e, i) => (
        <div key={i} className={'hist-item' + (i === index ? ' on' : '') + (i > index ? ' future' : '')} onClick={() => onJump(i)}>
          <span className="hn">{i}</span><span className="hl">{e.label}</span>
          <span className="ht">{new Date(e.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      ))}
      <p className="hint">Click any step to go back to it. The original photo is never changed.</p>
    </div>
  );
}
