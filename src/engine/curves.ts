import type { CurvePoint, Curves } from '../state/types';

/** Monotone cubic (Fritsch–Carlson) interpolation through sorted points -> 256-entry LUT. */
export function curveToLut(pointsIn: CurvePoint[]): Float32Array {
  const pts = [...pointsIn].sort((a, b) => a[0] - b[0]);
  const lut = new Float32Array(256);
  if (pts.length === 0) { for (let i = 0; i < 256; i++) lut[i] = i / 255; return lut; }
  if (pts.length === 1) { lut.fill(pts[0][1]); return lut; }
  const n = pts.length;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i];
    d.push(dx > 1e-6 ? (ys[i + 1] - ys[i]) / dx : 0);
  }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  for (let k = 0; k < 256; k++) {
    const x = k / 255;
    let y: number;
    if (x <= xs[0]) y = ys[0];
    else if (x >= xs[n - 1]) y = ys[n - 1];
    else {
      let i = 0;
      while (i < n - 2 && x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i];
      const t = h > 1e-6 ? (x - xs[i]) / h : 0;
      const t2 = t * t, t3 = t2 * t;
      y = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    }
    lut[k] = Math.min(1, Math.max(0, y));
  }
  return lut;
}

/** Combined per-channel LUT: out = channelCurve(masterCurve(in)). RGBA8 256x1. */
export function buildCurveTexture(c: Curves): Uint8Array {
  const M = curveToLut(c.master), R = curveToLut(c.r), G = curveToLut(c.g), B = curveToLut(c.b);
  const look = (lut: Float32Array, v: number) => lut[Math.round(Math.min(1, Math.max(0, v)) * 255)];
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const m = M[i];
    out[i * 4] = Math.round(look(R, m) * 255);
    out[i * 4 + 1] = Math.round(look(G, m) * 255);
    out[i * 4 + 2] = Math.round(look(B, m) * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

export function isIdentityCurve(p: CurvePoint[]) {
  return p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 1 && p[1][1] === 1;
}
