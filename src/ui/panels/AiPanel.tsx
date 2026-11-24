import { useEffect, useRef, useState } from 'react';
import { EditState, BgMode } from '../../state/types';
import type { AiOps, BrushMode } from '../../ai/controller';
import { aiAvailable } from '../../ai/client';
import { Slider, Section, Icon, formatBytes, toast } from '../common';
import { platform } from '../../platform';

type Upd = (label: string, f: (s: EditState) => void) => void;

const LIBRARY: { name: string; mode: BgMode; c1: string; c2?: string; grad?: 'linear' | 'radial' }[] = [
  { name: 'White studio', mode: 'gradient', c1: '#ffffff', c2: '#dcdcdc', grad: 'radial' },
  { name: 'Grey studio', mode: 'gradient', c1: '#a3a3a3', c2: '#3c3c3c', grad: 'radial' },
  { name: 'Dark studio', mode: 'gradient', c1: '#4a4a4a', c2: '#0e0e0e', grad: 'radial' },
  { name: 'Blue studio', mode: 'gradient', c1: '#6fa8dc', c2: '#1d3c6e', grad: 'radial' },
  { name: 'Warm beige', mode: 'gradient', c1: '#f3e2c7', c2: '#b48a5a', grad: 'radial' },
  { name: 'Passport white', mode: 'color', c1: '#ffffff' },
  { name: 'ID blue', mode: 'color', c1: '#3a7bd5' },
  { name: 'Sunset', mode: 'gradient', c1: '#ffb36b', c2: '#7b3fa0', grad: 'linear' },
  { name: 'Sky', mode: 'gradient', c1: '#9fd3ff', c2: '#e9f6ff', grad: 'linear' },
  { name: 'Mint', mode: 'gradient', c1: '#d7f5e6', c2: '#5fb38f', grad: 'radial' },
  { name: 'Black', mode: 'color', c1: '#000000' },
  { name: 'Green screen', mode: 'color', c1: '#00b140' },
];

const PROMPTS = [
  { name: 'Office', p: 'modern bright office interior, softly blurred, depth of field' },
  { name: 'Nature', p: 'lush green forest clearing with soft sunlight' },
  { name: 'City', p: 'city street at golden hour, bokeh lights, shallow depth of field' },
  { name: 'Beach', p: 'tropical beach with turquoise sea and clear sky' },
  { name: 'Mountains', p: 'majestic mountain landscape at sunrise' },
  { name: 'Studio', p: 'professional photo studio backdrop with soft lighting' },
  { name: 'Artistic', p: 'abstract colourful painted backdrop, fine art style' },
];

const STYLES = [
  { name: 'Studio portrait', p: 'Turn this into a professional studio portrait with soft key light and a clean backdrop' },
  { name: 'Cinematic', p: 'Make this a cinematic film still with dramatic lighting and teal-orange colour grading' },
  { name: 'Oil painting', p: 'Repaint this image as a classical oil painting with visible brush strokes' },
  { name: 'Watercolor', p: 'Repaint this image as a delicate watercolor painting on textured paper' },
  { name: 'Pencil sketch', p: 'Convert this image into a detailed graphite pencil sketch' },
  { name: 'Digital painting', p: 'Repaint this image as a polished digital painting' },
  { name: 'Cartoon', p: 'Turn this image into a clean cartoon illustration' },
  { name: 'Anime', p: 'Redraw this image in a high-quality anime art style' },
  { name: '3D character', p: 'Turn the subject into a stylised 3D animated character render' },
  { name: 'Vintage portrait', p: 'Make this look like a vintage 1950s photograph with film grain' },
  { name: 'Fantasy art', p: 'Transform this into fantasy concept art with magical lighting' },
  { name: 'Fashion', p: 'Make this a high-end fashion magazine photograph' },
  { name: 'B&W artistic', p: 'Make this a dramatic black-and-white fine art portrait with deep contrast' },
];
const KEEP = ' Keep the same person, face, identity, pose and composition.';

export function AiPanel({ state, update, ops, brush, setBrush }: {
  state: EditState; update: Upd; ops: AiOps;
  brush: { mode: BrushMode; size: number; soft: number }; setBrush: (b: { mode: BrushMode; size: number; soft: number }) => void;
}) {
  const [tab, setTab] = useState<'bg' | 'object' | 'enhance' | 'styles' | 'models'>('bg');
  const [strength, setStrength] = useState(70);
  const [prompt, setPrompt] = useState('');
  const [bgPrompt, setBgPrompt] = useState('');
  const a = state.ai;
  useEffect(() => { ops.refreshKey(); ops.refreshModels(); }, [tab]);
  // leave brush modes when switching tabs
  useEffect(() => { if (tab !== 'object' && brush.mode === 'object') setBrush({ ...brush, mode: null }); if (tab !== 'bg' && brush.mode?.startsWith('mask')) setBrush({ ...brush, mode: null }); }, [tab]);

  if (!aiAvailable) return (
    <div className="planned"><div className="badge">Desktop app</div><h3>AI tools</h3><p>AI tools run in the Windows desktop app. They are not available in a web browser.</p></div>
  );

  const inst = (id: string) => ops.models.find(m => m.id === id)?.installed;
  const tag = (id: string) => <span className={'mtag' + (inst(id) ? ' ok' : '')}>{inst(id) ? 'Offline · ready' : 'Offline · ' + formatBytes(ops.models.find(m => m.id === id)?.size || 0) + ' download'}</span>;
  const onlineTag = <span className={'mtag online' + (ops.hasKey ? ' ok' : '')}>{ops.hasKey ? 'Online · key saved' : 'Online · needs API key'}</span>;

  const brushControls = (
    <>
      <Slider label="Brush size" value={brush.size} min={5} max={300} def={60} unit="px" onChange={v => setBrush({ ...brush, size: v })} />
      <Slider label="Softness" value={brush.soft} min={0} max={100} def={50} onChange={v => setBrush({ ...brush, soft: v })} />
    </>
  );

  return (
    <div className="ai-panel">
      <div className="tabs small wrap">
        {([['bg', 'Background'], ['object', 'Remove object'], ['enhance', 'Enhance'], ['styles', 'Styles'], ['models', 'Models']] as const).map(([k, l]) =>
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === 'bg' && <>
        <Section title="Remove background">
          <div className="row gap wrap">
            <button className="btn accent grow" onClick={() => ops.removeBackground('bg-best')}><Icon name="ai" size={15} /> Remove (best)</button>
            <button className="btn grow" onClick={() => ops.removeBackground('bg-fast')}>Fast</button>
          </div>
          <div className="row gap tags">{tag('bg-best')}{tag('bg-fast')}</div>
          {a.maskId && <>
            <Slider label="Edge softness" value={a.feather} min={0} max={100} def={10} onChange={v => update('Edge softness', s => { s.ai.feather = v; })} />
            <Slider label="Edge shift" value={a.shift} min={-100} max={100} def={0} onChange={v => update('Edge shift', s => { s.ai.shift = v; })} tip="Shrink (−) or grow (+) the selection" />
            <div className="label-sm">Refine with brush</div>
            <div className="seg full">
              <button className={brush.mode === 'mask-add' ? 'on' : ''} onClick={() => setBrush({ ...brush, mode: brush.mode === 'mask-add' ? null : 'mask-add' })}>+ Add to subject</button>
              <button className={brush.mode === 'mask-erase' ? 'on' : ''} onClick={() => setBrush({ ...brush, mode: brush.mode === 'mask-erase' ? null : 'mask-erase' })}>− Erase</button>
            </div>
            {brush.mode?.startsWith('mask') && <>{brushControls}<p className="hint">Paint on the photo. Red shows what will be removed. Crop and rotation are hidden while you paint.</p></>}
            <button className="btn wide" onClick={() => { setBrush({ ...brush, mode: null }); update('Restore background', s => { s.ai.maskId = null; s.ai.bgMode = 'keep'; s.ai.bgImageId = null; }); }}><Icon name="reset" size={14} /> Restore original background</button>
          </>}
        </Section>
        {a.maskId && <Section title="New background">
          <div className="seg full">
            {(['transparent', 'color', 'gradient', 'image', 'blur', 'keep'] as BgMode[]).map(m => (
              <button key={m} className={a.bgMode === m ? 'on' : ''} disabled={m === 'image' && !a.bgImageId} onClick={() => update('Background: ' + m, s => { s.ai.bgMode = m; })}>
                {{ transparent: 'None', color: 'Colour', gradient: 'Gradient', image: 'Image', blur: 'Blur', keep: 'Original' }[m]}
              </button>))}
          </div>
          {a.bgMode === 'transparent' && <p className="hint">Transparent background. Export as PNG to keep transparency.</p>}
          {(a.bgMode === 'color' || a.bgMode === 'gradient') && <div className="row gap">
            <input type="color" value={a.bgColor} onChange={e => update('Background colour', s => { s.ai.bgColor = e.target.value; })} />
            {a.bgMode === 'gradient' && <>
              <input type="color" value={a.bgColor2} onChange={e => update('Background colour', s => { s.ai.bgColor2 = e.target.value; })} />
              <select className="select inline" value={a.bgGradient} onChange={e => update('Gradient type', s => { s.ai.bgGradient = e.target.value as any; })}><option value="radial">Radial</option><option value="linear">Linear</option></select>
            </>}
          </div>}
          {(a.bgMode === 'blur' || a.bgMode === 'image') && <Slider label="Background blur" value={a.bgBlur} min={0} max={100} def={0} onChange={v => update('Background blur', s => { s.ai.bgBlur = v; })} />}
          {a.bgMode !== 'transparent' && a.bgMode !== 'keep' && a.bgMode !== 'blur' && <>
            <Slider label="Match lighting" value={a.harmonize} min={0} max={100} def={0} onChange={v => update('Match lighting', s => { s.ai.harmonize = v; })} tip="Adjusts the background's brightness and colour to match the subject" />
            <Slider label="Shadow" value={a.shadow} min={0} max={100} def={0} onChange={v => update('Shadow', s => { s.ai.shadow = v; })} />
          </>}
          <div className="label-sm">Library</div>
          <div className="bg-lib">
            {LIBRARY.map(b => <button key={b.name} title={b.name} className="bg-sw" style={{ background: b.mode === 'color' ? b.c1 : b.grad === 'radial' ? `radial-gradient(circle at 50% 40%, ${b.c1}, ${b.c2})` : `linear-gradient(${b.c1}, ${b.c2})` }}
              onClick={() => update('Background: ' + b.name, s => { s.ai.bgMode = b.mode; s.ai.bgColor = b.c1; if (b.c2) s.ai.bgColor2 = b.c2; if (b.grad) s.ai.bgGradient = b.grad; })} />)}
          </div>
          <button className="btn wide" onClick={async () => { const f = await platform.openImages(false); if (f[0]) ops.uploadBackground(f[0].bytes); }}><Icon name="import" size={14} /> Use my own photo as background</button>
          <div className="label-sm">Generate with AI {onlineTag}</div>
          <div className="chips">{PROMPTS.map(p => <button key={p.name} className="chip" onClick={() => setBgPrompt(p.p)}>{p.name}</button>)}</div>
          <textarea className="text area" rows={2} placeholder="Describe a background, e.g. a cosy café with warm lights" value={bgPrompt} onChange={e => setBgPrompt(e.target.value)} />
          <button className="btn wide accent" disabled={!bgPrompt.trim()} onClick={() => ops.generateBackground(bgPrompt.trim())}><Icon name="ai" size={14} /> Generate background</button>
        </Section>}
        {!a.maskId && <p className="hint">AI finds people, pets and objects, including hair and fine edges. Then you can make the background transparent, replace it with a colour, gradient, your own photo or an AI-generated scene, or blur it.</p>}
      </>}

      {tab === 'object' && <>
        <Section title="Remove unwanted objects">
          <p className="hint">Paint over people, wires, marks or anything else you want gone, then press Remove. The background is rebuilt automatically.</p>
          <button className={'btn wide' + (brush.mode === 'object' ? ' accent' : '')} onClick={() => setBrush({ ...brush, mode: brush.mode === 'object' ? null : 'object' })}>
            <Icon name="retouch" size={14} /> {brush.mode === 'object' ? 'Painting… (click to stop)' : 'Start painting'}
          </button>
          {brush.mode === 'object' && brushControls}
          <div className="row gap">
            <button className="btn accent grow" disabled={!ops.hasObjectMask} onClick={() => ops.removeObject()}><Icon name="wand" size={14} /> Remove</button>
            <button className="btn" disabled={!ops.hasObjectMask} onClick={() => ops.clearObjectMask()}>Clear</button>
          </div>
          <div className="row gap tags">{tag('inpaint')}</div>
          {a.patches.length > 0 && <div className="muted small">{a.patches.length} object(s) removed. Undo (Ctrl+Z) brings any of them back.</div>}
          {a.patches.length > 0 && <button className="btn wide" onClick={() => update('Undo all removals', s => { s.ai.patches = []; })}><Icon name="reset" size={14} /> Restore all removed objects</button>}
        </Section>
        <Section title="Replace an object" defaultOpen={false}>
          <p className="hint">To replace something with something else, use <b>Styles → AI edit</b> with a description such as "replace the red car with a bicycle" (online).</p>
        </Section>
      </>}

      {tab === 'enhance' && <>
        <Section title="AI enhance">
          <p className="hint">Recovers detail and removes noise, blur and JPEG blockiness while keeping the same size. Good for old, compressed or phone photos.</p>
          <Slider label="Strength" value={strength} min={10} max={100} def={70} unit="%" onChange={setStrength} />
          <button className="btn wide accent" onClick={() => ops.enhance(strength)}><Icon name="wand" size={14} /> Enhance details</button>
          {a.baseId && <button className="btn wide" onClick={() => update('Remove AI enhance', s => { s.ai.baseId = null; })}><Icon name="reset" size={14} /> Remove enhancement</button>}
          <div className="row gap tags">{tag('upscale-x4')}</div>
        </Section>
        <Section title="HD upscale">
          <p className="hint">Creates a larger copy of the photo with new detail. It opens as a new photo, and your current one stays as it is.</p>
          <div className="row gap">
            {([2, 4, 8] as const).map(f => <button key={f} className="btn grow" onClick={() => ops.upscale(f)}>{f}×</button>)}
          </div>
          <div className="row gap tags">{tag('upscale-x2')}{tag('upscale-x4')}</div>
          <p className="hint">On a computer without a supported graphics card, a large upscale can take several minutes. You can cancel at any time.</p>
        </Section>
      </>}

      {tab === 'styles' && <>
        <Section title="Portrait & art styles">
          <div className="row gap tags">{onlineTag}</div>
          {!ops.hasKey && <p className="hint">Styles run online through Replicate, which charges a small amount per image. Add your API key under Settings → AI services.</p>}
          <div className="style-grid">
            {STYLES.map(st => <button key={st.name} className="chip" disabled={!ops.hasKey} onClick={() => ops.aiEdit(st.p + '.' + KEEP, 'Style: ' + st.name)}>{st.name}</button>)}
          </div>
          {a.styleId && <>
            <Slider label="Style intensity" value={a.styleMix} min={0} max={100} def={100} unit="%" onChange={v => update('Style intensity', s => { s.ai.styleMix = v; })} />
            <button className="btn wide" onClick={() => update('Remove style', s => { s.ai.styleId = null; })}><Icon name="reset" size={14} /> Remove style</button>
          </>}
        </Section>
        <Section title="AI edit (describe a change)">
          <textarea className="text area" rows={3} placeholder="e.g. make it look like a snowy winter day / remove the glasses / replace the car with a bicycle" value={prompt} onChange={e => setPrompt(e.target.value)} />
          <button className="btn wide accent" disabled={!ops.hasKey || !prompt.trim()} onClick={() => ops.aiEdit(prompt.trim(), 'AI edit')}><Icon name="ai" size={14} /> Apply AI edit</button>
          <p className="hint">The result is added as a layer you can blend with the intensity slider, and your adjustments still apply on top.</p>
        </Section>
      </>}

      {tab === 'models' && <ModelsTab ops={ops} />}
    </div>
  );
}

function ModelsTab({ ops }: { ops: AiOps }) {
  return (
    <div>
      <p className="hint">Offline models run on your computer: no internet needed after the first download, and photos never leave your PC. They use your graphics card through DirectML when available, otherwise the processor.</p>
      {ops.models.map(m => (
        <div key={m.id} className="model-row">
          <div className="grow"><b>{m.name}</b><div className="muted small">{formatBytes(m.size)} · {m.license}</div></div>
          {m.installed
            ? <><span className="mtag ok">Ready</span><button className="mini" title="Delete to free disk space" onClick={() => ops.deleteModel(m.id)}><Icon name="trash" size={12} /></button></>
            : <button className="btn" onClick={() => ops.download(m.id)}>Download</button>}
        </div>
      ))}
      <h4>Online services</h4>
      <div className="model-row"><div className="grow"><b>Replicate</b><div className="muted small">Art styles, AI edit, background generation (FLUX models). Needs your own API key and credit.</div></div>
        <span className={'mtag' + (ops.hasKey ? ' ok' : '')}>{ops.hasKey ? 'Key saved' : 'No key'}</span></div>
    </div>
  );
}

// ---------------- brush overlay ----------------
export function BrushOverlay({ box, target, mode, size, soft, onStroke, onEnd, showMask }: {
  box: { x: number; y: number; w: number; h: number };
  target: HTMLCanvasElement | null;
  mode: BrushMode; size: number; soft: number;
  onStroke: () => void; onEnd: () => void;
  showMask: 'object' | 'subject';
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const last = useRef<[number, number] | null>(null);
  const cursor = useRef<[number, number] | null>(null);
  const raf = useRef(0);

  const redraw = () => {
    const c = ref.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const x = c.getContext('2d')!;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, W, H);
    if (target) {
      if (showMask === 'object') {
        // painted strokes tinted red
        const t = document.createElement('canvas'); t.width = target.width; t.height = target.height;
        const tx = t.getContext('2d')!; tx.drawImage(target, 0, 0); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = 'rgba(255,40,60,0.55)'; tx.fillRect(0, 0, t.width, t.height);
        x.drawImage(t, box.x, box.y, box.w, box.h);
      } else {
        // red where the background will be removed
        x.save(); x.beginPath(); x.rect(box.x, box.y, box.w, box.h); x.clip();
        x.fillStyle = 'rgba(255,40,60,0.35)'; x.fillRect(box.x, box.y, box.w, box.h);
        x.globalCompositeOperation = 'destination-out'; x.drawImage(target, box.x, box.y, box.w, box.h);
        x.restore();
      }
    }
    if (cursor.current) {
      x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.beginPath(); x.arc(cursor.current[0], cursor.current[1], size / 2, 0, Math.PI * 2); x.stroke();
      x.strokeStyle = '#000'; x.lineWidth = 0.75; x.beginPath(); x.arc(cursor.current[0], cursor.current[1], size / 2 + 1.5, 0, Math.PI * 2); x.stroke();
    }
  };
  const schedule = () => { cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(redraw); };
  useEffect(() => { schedule(); });

  const dab = (px: number, py: number) => {
    if (!target) return;
    const k = target.width / box.w;
    const mx = (px - box.x) * k, my = (py - box.y) * k, r = Math.max(1, (size / 2) * k);
    const x = target.getContext('2d')!;
    const g = x.createRadialGradient(mx, my, r * (1 - soft / 100) * 0.95, mx, my, r);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.globalCompositeOperation = mode === 'mask-erase' ? 'destination-out' : 'source-over';
    x.fillStyle = g; x.beginPath(); x.arc(mx, my, r, 0, Math.PI * 2); x.fill();
    x.globalCompositeOperation = 'source-over';
  };
  const local = (e: React.PointerEvent) => { const rc = ref.current!.getBoundingClientRect(); return [e.clientX - rc.left, e.clientY - rc.top] as [number, number]; };

  return (
    <canvas ref={ref} className="brush-layer"
      onPointerDown={e => {
        if (e.button !== 0) return;
        if (!target) { toast('Nothing to paint on yet'); return; }
        e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const p = local(e); last.current = p; dab(p[0], p[1]); onStroke(); schedule();
      }}
      onPointerMove={e => {
        const p = local(e); cursor.current = p;
        if (last.current && e.buttons & 1) {
          const [lx, ly] = last.current, d = Math.hypot(p[0] - lx, p[1] - ly), step = Math.max(1, size / 6);
          for (let t = step; t <= d; t += step) dab(lx + (p[0] - lx) * t / d, ly + (p[1] - ly) * t / d);
          if (d >= step) last.current = p;
          onStroke();
        }
        schedule();
      }}
      onPointerUp={() => { if (last.current) { last.current = null; onEnd(); } }}
      onPointerLeave={() => { cursor.current = null; schedule(); }} />
  );
}
