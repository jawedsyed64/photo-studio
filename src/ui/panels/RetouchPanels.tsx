import { useEffect, useState } from 'react';
import { EditState, Retouch, defaultRetouch, defaultLocal } from '../../state/types';
import type { AiOps, BrushMode } from '../../ai/controller';
import { aiAvailable } from '../../ai/client';
import { Slider, Section, Icon, formatBytes } from '../common';

type Upd = (label: string, f: (s: EditState) => void) => void;
type Brush = { mode: BrushMode; size: number; soft: number };

const LOOKS: { name: string; v: Partial<Retouch> }[] = [
  { name: 'Natural', v: { smooth: 30, blemish: 45, acne: 30, wrinkle: 15, underEye: 30, teeth: 20, eyes: 20, redEye: 100 } },
  { name: 'Soft glow', v: { smooth: 55, blemish: 60, acne: 45, wrinkle: 35, underEye: 45, teeth: 30, eyes: 30, faceLight: 15, redEye: 100 } },
  { name: 'Light touch', v: { smooth: 15, blemish: 30, acne: 15, wrinkle: 0, underEye: 15, teeth: 10, eyes: 10, redEye: 100 } },
];

function ModelTag({ ops, ids }: { ops: AiOps; ids: string[] }) {
  return <div className="row gap tags">{ids.map(id => {
    const m = ops.models.find(x => x.id === id);
    return <span key={id} className={'mtag' + (m?.installed ? ' ok' : '')} title={m?.name}>{m?.installed ? (m.name.split(' (')[0] + ' · ready') : (m ? m.name.split(' (')[0] + ' · ' + formatBytes(m.size) : id)}</span>;
  })}</div>;
}

function ManualTools({ brush, setBrush, ops, state, update }: { brush: Brush; setBrush: (b: Brush) => void; ops: AiOps; state: EditState; update: Upd }) {
  const tools: { m: BrushMode; label: string; tip: string }[] = [
    { m: 'spot', label: 'Spot removal', tip: 'Click or paint over spots, blemishes or small marks. A matching area is found automatically.' },
    { m: 'heal', label: 'Healing brush', tip: 'Alt+click a clean area to copy from, then paint. The texture is copied and the colour blends in.' },
    { m: 'clone', label: 'Clone stamp', tip: 'Alt+click a source area, then paint to copy it exactly.' },
    { m: 'local-add', label: 'Local adjust', tip: 'Paint an area, then change its exposure, contrast, colour or clarity.' },
  ];
  const active = tools.find(t => t.m === brush.mode || (t.m === 'local-add' && brush.mode === 'local-erase'));
  const l = state.local;
  return (
    <Section title="Manual tools">
      <div className="seg full">
        {tools.map(t => <button key={t.m} className={active?.m === t.m ? 'on' : ''} title={t.tip}
          onClick={() => setBrush({ ...brush, mode: active?.m === t.m ? null : t.m })}>{t.label}</button>)}
      </div>
      {active && <>
        <p className="hint">{active.tip}{(active.m === 'heal' || active.m === 'clone') && !ops.healSource ? ' No source set yet.' : ''}</p>
        <Slider label="Brush size" value={brush.size} min={4} max={300} def={40} unit="px" onChange={v => setBrush({ ...brush, size: v })} />
        <Slider label="Softness" value={brush.soft} min={0} max={100} def={50} onChange={v => setBrush({ ...brush, soft: v })} />
      </>}
      {active?.m === 'local-add' && <>
        <div className="seg full">
          <button className={brush.mode === 'local-add' ? 'on' : ''} onClick={() => setBrush({ ...brush, mode: 'local-add' })}>+ Paint</button>
          <button className={brush.mode === 'local-erase' ? 'on' : ''} onClick={() => setBrush({ ...brush, mode: 'local-erase' })}>− Erase</button>
        </div>
      </>}
      {(active?.m === 'local-add' || l.maskId) && <>
        <div className="label-sm">Local adjustment {l.maskId ? '' : '(paint an area first)'}</div>
        <Slider label="Exposure" value={l.exposure} min={-100} max={100} onChange={v => update('Local exposure', s => { s.local.exposure = v; })} />
        <Slider label="Contrast" value={l.contrast} min={-100} max={100} onChange={v => update('Local contrast', s => { s.local.contrast = v; })} />
        <Slider label="Saturation" value={l.saturation} min={-100} max={100} onChange={v => update('Local saturation', s => { s.local.saturation = v; })} />
        <Slider label="Temperature" value={l.temperature} min={-100} max={100} gradient="linear-gradient(to right,#3b82f6,#e5e7eb,#f59e0b)" onChange={v => update('Local temperature', s => { s.local.temperature = v; })} />
        <Slider label="Clarity" value={l.clarity} min={-100} max={100} onChange={v => update('Local clarity', s => { s.local.clarity = v; })} />
        {l.maskId && <button className="btn wide" onClick={() => { ops.clearLocal(); update('Reset local adjustment', s => { s.local = defaultLocal(); }); }}><Icon name="reset" size={14} /> Remove local adjustment</button>}
      </>}
      {state.ai.patches.length > 0 && <div className="muted small">{state.ai.patches.length} repair(s) applied. Ctrl+Z undoes them one by one.</div>}
    </Section>
  );
}

export function RetouchPanel({ state, update, ops, brush, setBrush }: { state: EditState; update: Upd; ops: AiOps; brush: Brush; setBrush: (b: Brush) => void }) {
  const [strength, setStrength] = useState(70);
  const [bgBlur, setBgBlur] = useState(state.ai.bgMode === 'blur' ? state.ai.bgBlur : 0);
  const r = state.retouch;
  const has = !!(r.maskA && r.maskB);
  useEffect(() => { ops.refreshModels(); }, []);
  if (!aiAvailable) return <div className="planned"><div className="badge">Desktop app</div><h3>Portrait retouching</h3><p>Face-aware retouching runs in the Windows desktop app.</p></div>;
  const sl = (k: keyof Retouch, label: string, min = 0, tip?: string) => (
    <Slider key={k} label={label} value={r[k] as number} min={min} max={100} tip={tip} onChange={v => update(label, s => { (s.retouch as any)[k] = v; })} />
  );
  return (
    <div className="ai-panel">
      <Section title="Face analysis">
        {has
          ? <div className="row gap"><Icon name="check" size={15} /><span className="grow">{r.faces.length === 1 ? '1 face found' : `${r.faces.length} faces found`}</span><button className="btn" onClick={() => ops.analyzeFaces()}>Re-scan</button></div>
          : <>
              <p className="hint">The face is analysed first so that each tool only touches the right area: skin, eyes, teeth or hair.</p>
              <button className="btn wide accent" onClick={() => ops.analyzeFaces()}><Icon name="portrait" size={15} /> Find faces</button>
            </>}
        <ModelTag ops={ops} ids={['face-detect', 'face-parse']} />
        {has && <div className="chips">
          {LOOKS.map(lk => <button key={lk.name} className="chip" onClick={() => update('Retouch: ' + lk.name, s => { s.retouch = { ...s.retouch, ...lk.v }; })}>{lk.name}</button>)}
          <button className="chip" onClick={() => update('Reset retouching', s => { const d = defaultRetouch(); s.retouch = { ...d, maskA: s.retouch.maskA, maskB: s.retouch.maskB, faces: s.retouch.faces, skinAvg: s.retouch.skinAvg }; })}>Reset</button>
        </div>}
      </Section>
      {has && <>
        <Section title="Skin">
          {sl('smooth', 'Smooth skin', 0, 'Softens skin while keeping pores and texture')}
          {sl('blemish', 'Remove blemishes', 0, 'Lightens small dark spots')}
          {sl('acne', 'Reduce acne & redness')}
          {sl('wrinkle', 'Soften wrinkles')}
          {sl('warmth', 'Skin tone (cool ↔ warm)', -100)}
          {sl('even', 'Even out skin tone')}
        </Section>
        <Section title="Eyes & teeth">
          {sl('eyes', 'Eye enhancement')}
          {sl('redEye', 'Red-eye correction')}
          {sl('underEye', 'Under-eye correction', 0, 'Lightens dark circles')}
          {sl('teeth', 'Teeth whitening')}
        </Section>
        <Section title="Face & hair">
          {sl('faceLight', 'Face lighting', -100)}
          {sl('lightDir', 'Light from (left ↔ right)', -100)}
          {sl('hair', 'Hair refinement', 0, 'Adds definition and shine to hair')}
          <Slider label="Background blur" value={bgBlur} min={0} max={100} onChange={setBgBlur} tip="Blurs everything except the person" />
          <button className="btn wide" onClick={async () => { if (await ops.ensureMask()) update('Background blur', s => { s.ai.bgMode = 'blur'; s.ai.bgBlur = bgBlur; }); }}>Apply background blur</button>
        </Section>
        <p className="hint">Retouching is designed to look natural. Hold <b>Original</b> or press <b>Y</b> to compare.</p>
      </>}
      <Section title="Improve face details (AI)" defaultOpen={false}>
        <p className="hint">Rebuilds sharp eyes, skin and hair on soft, small or low-quality faces. Best for old or blurry photos.</p>
        <Slider label="Strength" value={strength} min={10} max={100} def={70} unit="%" onChange={setStrength} />
        <button className="btn wide accent" onClick={() => ops.restoreFaces(strength)}><Icon name="wand" size={14} /> Improve faces</button>
        <ModelTag ops={ops} ids={['face-detect', 'face-restore']} />
      </Section>
      <ManualTools brush={brush} setBrush={setBrush} ops={ops} state={state} update={update} />
    </div>
  );
}

export function RestorePanel({ state, update, ops, brush, setBrush, onCompare, compare }: {
  state: EditState; update: Upd; ops: AiOps; brush: Brush; setBrush: (b: Brush) => void; onCompare: () => void; compare: boolean;
}) {
  const [size, setSize] = useState(2);
  const [sens, setSens] = useState(50);
  const [strength, setStrength] = useState(80);
  useEffect(() => { ops.refreshModels(); }, []);
  if (!aiAvailable) return <div className="planned"><div className="badge">Desktop app</div><h3>Photo restoration</h3><p>Restoration tools run in the Windows desktop app.</p></div>;
  return (
    <div className="ai-panel">
      <button className={'btn wide' + (compare ? ' accent' : '')} onClick={onCompare}><Icon name="compare" size={14} /> {compare ? 'Hide before / after' : 'Compare before / after'}</button>
      <p className="hint">A good order for old photos: 1 dust & scratches, 2 repair damage, 3 colours, 4 faces, 5 colorize.</p>
      <Section title="1 · Dust & scratches">
        <Slider label="Defect size" value={size} min={1} max={8} def={2} unit="px" onChange={setSize} tip="Largest speck or scratch width to remove" />
        <Slider label="Sensitivity" value={sens} min={0} max={100} def={50} onChange={setSens} tip="Higher finds fainter marks but may soften fine detail" />
        <button className="btn wide accent" onClick={() => ops.removeDust(size, sens)}><Icon name="wand" size={14} /> Clean photo</button>
        <div className="row gap tags"><span className="mtag ok">Offline · no download</span></div>
      </Section>
      <Section title="2 · Repair damaged areas">
        <p className="hint">Paint over tears, stains, cracks or missing corners, then press Repair. The missing part is rebuilt by AI.</p>
        <button className={'btn wide' + (brush.mode === 'object' ? ' accent' : '')} onClick={() => setBrush({ ...brush, mode: brush.mode === 'object' ? null : 'object' })}>
          <Icon name="retouch" size={14} /> {brush.mode === 'object' ? 'Painting… (click to stop)' : 'Paint damage'}
        </button>
        {brush.mode === 'object' && <Slider label="Brush size" value={brush.size} min={4} max={300} def={40} unit="px" onChange={v => setBrush({ ...brush, size: v })} />}
        <div className="row gap">
          <button className="btn accent grow" disabled={!ops.hasObjectMask} onClick={() => ops.removeObject()}>Repair</button>
          <button className="btn" disabled={!ops.hasObjectMask} onClick={() => ops.clearObjectMask()}>Clear</button>
        </div>
        <ModelTag ops={ops} ids={['inpaint']} />
        <p className="hint">For small spots, the <b>Spot removal</b> and <b>Healing brush</b> tools in Retouching are quicker.</p>
      </Section>
      <Section title="3 · Faded colours & contrast">
        <p className="hint">Removes yellow or red fading, restores black and white points and adds back contrast. The result is normal curves you can still edit.</p>
        <button className="btn wide accent" onClick={() => ops.autoRestoreColors()}><Icon name="color" size={14} /> Auto restore colours</button>
        <button className="btn wide" onClick={() => ops.enhance(70)}><Icon name="ai" size={14} /> Enhance old scan (sharpen & de-noise)</button>
        <ModelTag ops={ops} ids={['upscale-x4']} />
      </Section>
      <Section title="4 · Faces">
        <Slider label="Strength" value={strength} min={10} max={100} def={80} unit="%" onChange={setStrength} />
        <button className="btn wide accent" onClick={() => ops.restoreFaces(strength)}><Icon name="portrait" size={14} /> Improve faces</button>
        <ModelTag ops={ops} ids={['face-detect', 'face-restore']} />
      </Section>
      <Section title="5 · Colorize black & white">
        <button className="btn wide accent" onClick={() => ops.colorize()}><Icon name="color" size={14} /> Colorize photo</button>
        {state.ai.styleId && <>
          <Slider label="Colour intensity" value={state.ai.styleMix} min={0} max={100} def={100} unit="%" onChange={v => update('Colour intensity', s => { s.ai.styleMix = v; })} />
          <button className="btn wide" onClick={() => update('Remove colorize', s => { s.ai.styleId = null; })}><Icon name="reset" size={14} /> Back to black & white</button>
        </>}
        <ModelTag ops={ops} ids={['colorize']} />
        <p className="hint">The colour model is large (about 1 GB) and is downloaded only once.</p>
      </Section>
    </div>
  );
}
