// Edit state model. Everything the user changes lives here, so edits are
// non-destructive: the original image is never modified, and any state can be
// re-rendered, undone, saved to a project file or copied to another photo.

export type CurvePoint = [number, number]; // 0..1 input, 0..1 output

export interface Adjust {
  exposure: number;   // EV, -5..5
  brightness: number; // -100..100
  contrast: number;   // -100..100
  highlights: number; // -100..100
  shadows: number;    // -100..100
  whites: number;     // -100..100
  blacks: number;     // -100..100
  temperature: number;// -100..100
  tint: number;       // -100..100
  saturation: number; // -100..100
  vibrance: number;   // -100..100
  clarity: number;    // -100..100
  texture: number;    // -100..100
  dehaze: number;     // -100..100
  vignette: number;   // -100..100
  vignetteMidpoint: number; // 0..100
  grain: number;      // 0..100
  grainSize: number;  // 0..100
}

export interface Detail {
  sharpenAmount: number;  // 0..150
  sharpenRadius: number;  // 0.5..3
  sharpenDetail: number;  // 0..100
  sharpenMasking: number; // 0..100
  lumaNoise: number;      // 0..100
  colorNoise: number;     // 0..100
}

export interface Optics {
  distortion: number;   // -100..100 (lens distortion correction)
  chromatic: number;    // 0..100 (CA removal)
  vertical: number;     // -100..100 perspective
  horizontal: number;   // -100..100 perspective
}

export interface Curves {
  master: CurvePoint[];
  r: CurvePoint[];
  g: CurvePoint[];
  b: CurvePoint[];
}

export const HSL_BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
export type HslBand = typeof HSL_BANDS[number];
export const HSL_CENTERS = [0, 30, 60, 120, 180, 240, 275, 315];
export const HSL_SWATCH = ['#e5484d', '#f2862f', '#f5d90a', '#46a758', '#12a594', '#3e63dd', '#8e4ec6', '#d6409f'];

export interface HslEntry { h: number; s: number; l: number } // each -100..100
export type Hsl = Record<HslBand, HslEntry>;

export interface Wheel { hue: number; sat: number; lum: number } // hue 0..360, sat 0..100, lum -100..100
export interface Grading {
  shadows: Wheel;
  midtones: Wheel;
  highlights: Wheel;
  global: Wheel;
  blending: number; // 0..100
  balance: number;  // -100..100
}

export interface Geometry {
  rot90: 0 | 1 | 2 | 3;   // clockwise quarter turns
  flipH: boolean;
  flipV: boolean;
  straighten: number;     // degrees -45..45
  crop: { x: number; y: number; w: number; h: number }; // normalized in oriented image; may exceed 0..1 (canvas expansion)
  aspect: string;         // 'free' | 'original' | '1:1' ...
  fill: string;           // canvas expansion fill colour
}

export type BgMode = 'keep' | 'transparent' | 'color' | 'gradient' | 'image' | 'blur';
export interface Patch { id: string; x: number; y: number; w: number; h: number }
export interface AiState {
  baseId: string | null;       // AI-enhanced base image (replaces the original as the starting point)
  patches: Patch[];            // object-removal patches, in source pixel coordinates
  maskId: string | null;       // subject mask from background removal (alpha = subject)
  bgMode: BgMode;
  bgColor: string;
  bgColor2: string;
  bgGradient: 'linear' | 'radial';
  bgImageId: string | null;
  bgBlur: number;     // 0..100
  feather: number;    // 0..100 edge softness
  shift: number;      // -100..100 contract / expand edge
  harmonize: number;  // 0..100 match background light & colour to the subject
  shadow: number;     // 0..100 drop shadow under the subject
  styleId: string | null;  // AI style / AI edit result layer
  styleMix: number;   // 0..100
}

export interface EditState {
  ai: AiState;
  adjust: Adjust;
  detail: Detail;
  optics: Optics;
  curves: Curves;
  hsl: Hsl;
  grading: Grading;
  geometry: Geometry;
}

export const defaultCurve = (): CurvePoint[] => [[0, 0], [1, 1]];

export const defaultAdjust = (): Adjust => ({
  exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  temperature: 0, tint: 0, saturation: 0, vibrance: 0, clarity: 0, texture: 0, dehaze: 0,
  vignette: 0, vignetteMidpoint: 50, grain: 0, grainSize: 25,
});

export const defaultDetail = (): Detail => ({
  sharpenAmount: 0, sharpenRadius: 1, sharpenDetail: 25, sharpenMasking: 0, lumaNoise: 0, colorNoise: 0,
});

export const defaultOptics = (): Optics => ({ distortion: 0, chromatic: 0, vertical: 0, horizontal: 0 });

export const defaultHsl = (): Hsl => {
  const o: any = {};
  for (const b of HSL_BANDS) o[b] = { h: 0, s: 0, l: 0 };
  return o;
};

export const defaultWheel = (): Wheel => ({ hue: 0, sat: 0, lum: 0 });
export const defaultGrading = (): Grading => ({
  shadows: defaultWheel(), midtones: defaultWheel(), highlights: defaultWheel(), global: defaultWheel(),
  blending: 50, balance: 0,
});

export const defaultGeometry = (): Geometry => ({
  rot90: 0, flipH: false, flipV: false, straighten: 0,
  crop: { x: 0, y: 0, w: 1, h: 1 }, aspect: 'free', fill: '#ffffff',
});

export const defaultAi = (): AiState => ({
  baseId: null, patches: [], maskId: null, bgMode: 'keep', bgColor: '#ffffff', bgColor2: '#c8c8c8', bgGradient: 'radial',
  bgImageId: null, bgBlur: 0, feather: 10, shift: 0, harmonize: 0, shadow: 0, styleId: null, styleMix: 100,
});

export const defaultState = (): EditState => ({
  ai: defaultAi(),
  adjust: defaultAdjust(),
  detail: defaultDetail(),
  optics: defaultOptics(),
  curves: { master: defaultCurve(), r: defaultCurve(), g: defaultCurve(), b: defaultCurve() },
  hsl: defaultHsl(),
  grading: defaultGrading(),
  geometry: defaultGeometry(),
});

export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** Merge a (possibly partial / older-version) state onto defaults. */
export function normalizeState(s: any): EditState {
  const d = defaultState();
  if (!s || typeof s !== 'object') return d;
  return {
    ai: { ...d.ai, ...(s.ai || {}), patches: Array.isArray(s.ai?.patches) ? s.ai.patches : [] },
    adjust: { ...d.adjust, ...(s.adjust || {}) },
    detail: { ...d.detail, ...(s.detail || {}) },
    optics: { ...d.optics, ...(s.optics || {}) },
    curves: { ...d.curves, ...(s.curves || {}) },
    hsl: { ...d.hsl, ...(s.hsl || {}) },
    grading: {
      ...d.grading, ...(s.grading || {}),
      shadows: { ...d.grading.shadows, ...(s.grading?.shadows || {}) },
      midtones: { ...d.grading.midtones, ...(s.grading?.midtones || {}) },
      highlights: { ...d.grading.highlights, ...(s.grading?.highlights || {}) },
      global: { ...d.grading.global, ...(s.grading?.global || {}) },
    },
    geometry: { ...d.geometry, ...(s.geometry || {}), crop: { ...d.geometry.crop, ...(s.geometry?.crop || {}) } },
  };
}

/** Parts of a state that a preset carries (no geometry). */
export type PresetSettings = Partial<Omit<EditState, 'geometry' | 'ai'>>;

/** All asset ids a state refers to. */
export function assetIds(s: EditState): string[] {
  const a = s.ai; const ids = [a.baseId, a.maskId, a.bgImageId, a.styleId, ...a.patches.map(p => p.id)];
  return ids.filter((x): x is string => !!x);
}
