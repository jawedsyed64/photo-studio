import { Slider, Section, Icon } from '../common';
import { EditState, Adjust, defaultAdjust } from '../../state/types';

type Upd = (label: string, f: (s: EditState) => void) => void;

interface Row { k: keyof Adjust; label: string; min: number; max: number; step?: number; grad?: string; tip?: string; basic?: boolean }

const LIGHT: Row[] = [
  { k: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.01, basic: true, tip: 'Overall brightness in stops (EV)' },
  { k: 'brightness', label: 'Brightness', min: -100, max: 100, basic: true, tip: 'Brightens mid-tones without clipping' },
  { k: 'contrast', label: 'Contrast', min: -100, max: 100, basic: true },
  { k: 'highlights', label: 'Highlights', min: -100, max: 100, basic: true, tip: 'Recover (−) or boost (+) bright areas' },
  { k: 'shadows', label: 'Shadows', min: -100, max: 100, basic: true, tip: 'Lift (+) or deepen (−) dark areas' },
  { k: 'whites', label: 'Whites', min: -100, max: 100 },
  { k: 'blacks', label: 'Blacks', min: -100, max: 100 },
];
const COLOR: Row[] = [
  { k: 'temperature', label: 'Temperature', min: -100, max: 100, basic: true, grad: 'linear-gradient(to right,#3b82f6,#e5e7eb,#f59e0b)', tip: 'Cooler (blue) or warmer (yellow)' },
  { k: 'tint', label: 'Tint', min: -100, max: 100, grad: 'linear-gradient(to right,#22c55e,#e5e7eb,#d946ef)' },
  { k: 'vibrance', label: 'Vibrance', min: -100, max: 100, basic: true, tip: 'Boosts muted colours more than already-saturated ones' },
  { k: 'saturation', label: 'Saturation', min: -100, max: 100, basic: true, grad: 'linear-gradient(to right,#888,#e5484d,#f5d90a,#46a758,#3e63dd)' },
];
const PRESENCE: Row[] = [
  { k: 'texture', label: 'Texture', min: -100, max: 100, tip: 'Fine detail; negative softens skin' },
  { k: 'clarity', label: 'Clarity', min: -100, max: 100, basic: true, tip: 'Mid-tone local contrast' },
  { k: 'dehaze', label: 'Dehaze', min: -100, max: 100, tip: 'Removes (or adds) atmospheric haze' },
];
const FX: Row[] = [
  { k: 'vignette', label: 'Vignette', min: -100, max: 100, basic: true },
  { k: 'vignetteMidpoint', label: 'Vignette midpoint', min: 0, max: 100 },
  { k: 'grain', label: 'Grain', min: 0, max: 100 },
  { k: 'grainSize', label: 'Grain size', min: 0, max: 100 },
];

export function AdjustPanel({ state, update, pro, onAuto }: { state: EditState; update: Upd; pro: boolean; onAuto: () => void }) {
  const d = defaultAdjust();
  const rows = (list: Row[]) => list.filter(r => pro || r.basic).map(r => (
    <Slider key={r.k} label={r.label} value={state.adjust[r.k]} min={r.min} max={r.max} step={r.step} def={d[r.k]} gradient={r.grad} tip={r.tip}
      onChange={v => update(r.label, s => { s.adjust[r.k] = v; })} />
  ));
  const resetGroup = (list: Row[], name: string) => (
    <button className="mini" title={'Reset ' + name} onClick={() => update('Reset ' + name, s => { list.forEach(r => { (s.adjust as any)[r.k] = d[r.k]; }); })}><Icon name="reset" size={12} /></button>
  );
  return (
    <div>
      <div className="panel-actions">
        <button className="btn accent" onClick={onAuto} title="Analyse the photo and set exposure, whites, blacks and vibrance automatically"><Icon name="wand" size={15} /> Auto enhance</button>
        <button className="btn" onClick={() => update('Reset adjustments', s => { s.adjust = defaultAdjust(); })}><Icon name="reset" size={15} /> Reset all</button>
      </div>
      <Section title="Light" right={resetGroup(LIGHT, 'light')}>{rows(LIGHT)}</Section>
      <Section title="Colour" right={resetGroup(COLOR, 'colour')}>{rows(COLOR)}</Section>
      <Section title="Presence" right={resetGroup(PRESENCE, 'presence')}>{rows(PRESENCE)}</Section>
      {!pro && (
        <Section title="Sharpness">
          <Slider label="Sharpness" value={state.detail.sharpenAmount} min={0} max={150} def={0} onChange={v => update('Sharpness', s => { s.detail.sharpenAmount = v; })} />
          <Slider label="Noise reduction" value={state.detail.lumaNoise} min={0} max={100} def={0} onChange={v => update('Noise reduction', s => { s.detail.lumaNoise = v; s.detail.colorNoise = Math.max(s.detail.colorNoise, v / 2); })} />
        </Section>
      )}
      <Section title="Vignette & grain" right={resetGroup(FX, 'effects')} defaultOpen={pro}>{rows(FX)}</Section>
    </div>
  );
}
