import { EditState, PresetSettings, defaultState, clone, HSL_BANDS, CurvePoint } from './types';

export interface Preset {
  id: string;
  name: string;
  category: string;
  builtIn?: boolean;
  settings: PresetSettings;
}

export const PRESET_CATEGORIES = ['Portrait', 'Landscape', 'Street Photography', 'Wedding', 'Fashion', 'Food Photography',
  'Travel', 'Nature', 'Architecture', 'Product Photography', 'Cinematic', 'Vintage', 'Black and White', 'My Presets'];

const S = (shadow: [number, number] = [0.25, 0.25], high: [number, number] = [0.75, 0.75], lift = 0, roll = 1): CurvePoint[] =>
  [[0, lift], [shadow[0], shadow[1]], [high[0], high[1]], [1, roll]];

export const BUILT_IN_PRESETS: Preset[] = [
  { id: 'p-soft-portrait', name: 'Soft Portrait', category: 'Portrait', settings: { adjust: { exposure: 0.15, contrast: -10, highlights: -20, shadows: 15, temperature: 6, vibrance: 10, clarity: -12, texture: -10 } as any, hsl: { orange: { h: 0, s: -8, l: 10 }, red: { h: 0, s: -5, l: 4 } } as any } },
  { id: 'p-bright-portrait', name: 'Bright & Airy', category: 'Portrait', settings: { adjust: { exposure: 0.4, contrast: -15, highlights: -30, shadows: 25, whites: 10, temperature: 4, saturation: -8, vibrance: 8 } as any } },
  { id: 'p-vivid-land', name: 'Vivid Landscape', category: 'Landscape', settings: { adjust: { contrast: 20, highlights: -40, shadows: 30, vibrance: 30, clarity: 25, dehaze: 15 } as any, hsl: { blue: { h: 0, s: 15, l: -10 }, green: { h: 5, s: 10, l: 0 } } as any } },
  { id: 'p-golden', name: 'Golden Hour', category: 'Landscape', settings: { adjust: { temperature: 25, tint: 5, highlights: -25, shadows: 15, vibrance: 15 } as any, grading: { highlights: { hue: 40, sat: 25, lum: 0 }, shadows: { hue: 25, sat: 10, lum: 0 } } as any } },
  { id: 'p-street-grit', name: 'Gritty Street', category: 'Street Photography', settings: { adjust: { contrast: 30, clarity: 35, saturation: -30, blacks: -15, vignette: -25, grain: 20 } as any } },
  { id: 'p-street-night', name: 'Neon Night', category: 'Street Photography', settings: { adjust: { contrast: 15, temperature: -15, tint: 10, vibrance: 25, shadows: 10 } as any, hsl: { magenta: { h: 0, s: 25, l: 5 }, aqua: { h: 0, s: 25, l: 0 } } as any } },
  { id: 'p-wedding-clean', name: 'Clean Wedding', category: 'Wedding', settings: { adjust: { exposure: 0.3, contrast: -5, highlights: -35, shadows: 20, whites: 8, temperature: 3, vibrance: 5 } as any, hsl: { orange: { h: 0, s: -10, l: 8 } } as any } },
  { id: 'p-wedding-film', name: 'Romantic Film', category: 'Wedding', settings: { adjust: { exposure: 0.2, contrast: -10, temperature: 8, saturation: -10, grain: 10 } as any, curves: { master: S([0.25, 0.28], [0.75, 0.73], 0.06, 0.96) } as any } },
  { id: 'p-fashion-edge', name: 'Editorial', category: 'Fashion', settings: { adjust: { contrast: 25, highlights: -15, clarity: 10, saturation: -15, blacks: -10 } as any, grading: { shadows: { hue: 200, sat: 15, lum: 0 }, highlights: { hue: 35, sat: 10, lum: 0 } } as any } },
  { id: 'p-food-fresh', name: 'Fresh Food', category: 'Food Photography', settings: { adjust: { exposure: 0.2, contrast: 10, shadows: 15, temperature: 5, vibrance: 25, texture: 15 } as any, hsl: { red: { h: 0, s: 10, l: 0 }, green: { h: 0, s: 15, l: 5 } } as any } },
  { id: 'p-travel-pop', name: 'Travel Pop', category: 'Travel', settings: { adjust: { contrast: 15, highlights: -30, shadows: 25, vibrance: 35, clarity: 15 } as any, hsl: { blue: { h: -5, s: 20, l: -5 }, aqua: { h: 0, s: 20, l: 0 } } as any } },
  { id: 'p-nature-forest', name: 'Deep Forest', category: 'Nature', settings: { adjust: { contrast: 10, shadows: 10, clarity: 15, dehaze: 10 } as any, hsl: { green: { h: 10, s: -10, l: -10 }, yellow: { h: 15, s: -10, l: 0 } } as any } },
  { id: 'p-arch-crisp', name: 'Crisp Architecture', category: 'Architecture', settings: { adjust: { contrast: 15, highlights: -25, shadows: 25, clarity: 30, vibrance: -5 } as any, detail: { sharpenAmount: 50, sharpenMasking: 30 } as any } },
  { id: 'p-product-white', name: 'Clean Product', category: 'Product Photography', settings: { adjust: { exposure: 0.25, contrast: 10, whites: 25, highlights: -10, texture: 15, vibrance: 5 } as any, detail: { sharpenAmount: 40 } as any } },
  { id: 'p-teal-orange', name: 'Teal & Orange', category: 'Cinematic', settings: { adjust: { contrast: 15, highlights: -20, shadows: 10, vibrance: 10 } as any, grading: { shadows: { hue: 190, sat: 35, lum: 0 }, highlights: { hue: 32, sat: 30, lum: 0 }, blending: 60 } as any } },
  { id: 'p-moody', name: 'Moody Film', category: 'Cinematic', settings: { adjust: { exposure: -0.2, contrast: 20, saturation: -20, vignette: -20 } as any, curves: { master: S([0.25, 0.22], [0.75, 0.74], 0.08, 0.94) } as any, grading: { shadows: { hue: 210, sat: 20, lum: 0 } } as any } },
  { id: 'p-vintage-fade', name: 'Faded Vintage', category: 'Vintage', settings: { adjust: { contrast: -10, saturation: -25, temperature: 12, grain: 25, vignette: -15 } as any, curves: { master: S([0.25, 0.3], [0.75, 0.74], 0.12, 0.92) } as any } },
  { id: 'p-vintage-warm', name: 'Warm 70s', category: 'Vintage', settings: { adjust: { temperature: 25, tint: 8, saturation: -10, grain: 20 } as any, grading: { highlights: { hue: 45, sat: 25, lum: 0 }, shadows: { hue: 15, sat: 20, lum: 0 } } as any, curves: { master: S(undefined, undefined, 0.07, 0.95) } as any } },
  { id: 'p-bw-classic', name: 'Classic B&W', category: 'Black and White', settings: { adjust: { saturation: -100, contrast: 20, clarity: 10 } as any } },
  { id: 'p-bw-high', name: 'High Contrast B&W', category: 'Black and White', settings: { adjust: { saturation: -100, contrast: 50, blacks: -20, whites: 15, clarity: 25, grain: 15 } as any } },
  { id: 'p-bw-soft', name: 'Soft Matte B&W', category: 'Black and White', settings: { adjust: { saturation: -100, contrast: -10 } as any, curves: { master: S([0.25, 0.3], [0.75, 0.72], 0.1, 0.92) } as any } },
].map(p => ({ ...p, builtIn: true }));

/** Apply preset onto a state at a given intensity (0..100), keeping geometry. */
export function applyPreset(base: EditState, preset: Preset, intensity = 100): EditState {
  const k = intensity / 100;
  const d = defaultState();
  const out = clone(base);
  const st = preset.settings;
  // reset non-geometry to defaults then apply the scaled preset
  out.adjust = { ...d.adjust }; out.detail = { ...d.detail }; out.hsl = d.hsl; out.grading = d.grading; out.curves = d.curves; out.optics = { ...base.optics };
  const lerp = (def: number, v: number) => def + (v - def) * k;
  if (st.adjust) for (const [key, v] of Object.entries(st.adjust)) (out.adjust as any)[key] = lerp((d.adjust as any)[key], v as number);
  if (st.detail) for (const [key, v] of Object.entries(st.detail)) (out.detail as any)[key] = lerp((d.detail as any)[key], v as number);
  if (st.hsl) for (const b of HSL_BANDS) { const e = (st.hsl as any)[b]; if (e) out.hsl[b] = { h: e.h * k, s: e.s * k, l: e.l * k }; }
  if (st.grading) {
    const g: any = st.grading;
    for (const w of ['shadows', 'midtones', 'highlights', 'global'] as const) if (g[w]) out.grading[w] = { hue: g[w].hue ?? 0, sat: (g[w].sat ?? 0) * k, lum: (g[w].lum ?? 0) * k };
    if (g.blending != null) out.grading.blending = lerp(50, g.blending);
    if (g.balance != null) out.grading.balance = g.balance * k;
  }
  if (st.curves) for (const ch of ['master', 'r', 'g', 'b'] as const) {
    const pts = (st.curves as any)[ch] as CurvePoint[] | undefined;
    if (pts) out.curves[ch] = pts.map(([x, y]) => [x, x + (y - x) * k] as CurvePoint);
  }
  return out;
}

/** Make preset settings from a state (everything except geometry). */
export function settingsFromState(s: EditState): PresetSettings {
  const c = clone(s);
  return { adjust: c.adjust, detail: c.detail, optics: c.optics, curves: c.curves, hsl: c.hsl, grading: c.grading };
}
