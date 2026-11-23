import { VERT, COPY, BLUR, MAIN } from './shaders';
import { buildCurveTexture, isIdentityCurve } from './curves';
import { EditState, HSL_BANDS, Wheel } from '../state/types';

type Prog = { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> };
type Target = { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number };

export interface Histogram { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array; max: number }

function wheelToRgb(w: Wheel): [number, number, number] {
  // hue (deg) at full saturation, offset around its own luminance
  const h = ((w.hue % 360) + 360) % 360 / 60;
  const x = 1 - Math.abs((h % 2) - 1);
  let r = 0, g = 0, b = 0;
  if (h < 1) [r, g, b] = [1, x, 0]; else if (h < 2) [r, g, b] = [x, 1, 0];
  else if (h < 3) [r, g, b] = [0, 1, x]; else if (h < 4) [r, g, b] = [0, x, 1];
  else if (h < 5) [r, g, b] = [x, 0, 1]; else [r, g, b] = [1, 0, x];
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const k = (w.sat / 100) * 0.35;
  return [(r - L) * k, (g - L) * k, (b - L) * k];
}

export class Renderer {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  maxSize: number;
  private copy: Prog; private blur: Prog; private main: Prog;
  private src: WebGLTexture | null = null;
  srcW = 0; srcH = 0;
  private curveTex: WebGLTexture;
  private curveKey = '';
  private tFull?: Target; private blurS?: Target;
  private half?: Target; private tHalf?: Target; private blurN?: Target;
  private small?: Target; private tSmall?: Target; private blurL?: Target;
  private sharpRadius = -1;
  private vao: WebGLVertexArrayObject;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available on this computer. Please update your graphics driver.');
    this.gl = gl;
    this.maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 16384);
    this.copy = this.prog(COPY); this.blur = this.prog(BLUR); this.main = this.prog(MAIN);
    this.vao = gl.createVertexArray()!;
    this.curveTex = this.makeTex(256, 1);
  }

  private prog(fs: string): Prog {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader error: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link error: ' + gl.getProgramInfoLog(p));
    return { p, u: new Map() };
  }
  private loc(pr: Prog, name: string) {
    if (!pr.u.has(name)) pr.u.set(name, this.gl.getUniformLocation(pr.p, name));
    return pr.u.get(name)!;
  }
  private f(pr: Prog, n: string, ...v: number[]) {
    const gl = this.gl, l = this.loc(pr, n);
    if (v.length === 1) gl.uniform1f(l, v[0]);
    else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
    else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
    else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
  }
  private i(pr: Prog, n: string, v: number) { this.gl.uniform1i(this.loc(pr, n), v); }

  private makeTex(w: number, h: number) {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = this.makeTex(w, h);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h };
  }
  private freeTarget(t?: Target) {
    if (!t) return;
    this.gl.deleteTexture(t.tex); this.gl.deleteFramebuffer(t.fb);
  }

  private draw(pr: Prog, to: Target | null, w: number, h: number, flipY: boolean) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, to ? to.fb : null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(pr.p);
    this.f(pr, 'uFlipY', flipY ? 1 : 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private blurInto(srcTex: WebGLTexture, tmp: Target, out: Target, sigma: number) {
    const gl = this.gl, b = this.blur;
    gl.useProgram(b.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    this.i(b, 'uTex', 0);
    this.f(b, 'uSigma', sigma);
    this.f(b, 'uStep', 1 / tmp.w, 0);
    this.draw(b, tmp, tmp.w, tmp.h, false);
    gl.bindTexture(gl.TEXTURE_2D, tmp.tex);
    gl.useProgram(b.p);
    this.f(b, 'uStep', 0, 1 / out.h);
    this.draw(b, out, out.w, out.h, false);
  }

  private downsample(srcTex: WebGLTexture, to: Target) {
    const gl = this.gl;
    gl.useProgram(this.copy.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    this.i(this.copy, 'uTex', 0);
    this.draw(this.copy, to, to.w, to.h, false);
  }

  /** Upload a new source image. Caller must keep it within maxSize. */
  setImage(img: TexImageSource & { width: number; height: number }) {
    const gl = this.gl;
    if (this.src) gl.deleteTexture(this.src);
    [this.tFull, this.blurS, this.half, this.tHalf, this.blurN, this.small, this.tSmall, this.blurL].forEach(t => this.freeTarget(t));
    this.srcW = img.width; this.srcH = img.height;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.src = t;
    const W = this.srcW, H = this.srcH;
    this.tFull = this.target(W, H); this.blurS = this.target(W, H);
    const hw = Math.max(1, Math.round(W / 2)), hh = Math.max(1, Math.round(H / 2));
    this.half = this.target(hw, hh); this.tHalf = this.target(hw, hh); this.blurN = this.target(hw, hh);
    const k = Math.max(1, Math.max(W, H) / 512);
    const sw = Math.max(1, Math.round(W / k)), sh = Math.max(1, Math.round(H / k));
    this.small = this.target(sw, sh); this.tSmall = this.target(sw, sh); this.blurL = this.target(sw, sh);
    // fixed blurs
    this.downsample(t, this.half);
    this.blurInto(this.half.tex, this.tHalf, this.blurN, 1.6);
    this.downsample(t, this.small);
    this.blurInto(this.small.tex, this.tSmall, this.blurL, Math.max(sw, sh) * 0.014);
    this.sharpRadius = -1;
  }

  get hasImage() { return !!this.src; }

  orientedSize(s: EditState) {
    const odd = s.geometry.rot90 % 2 === 1;
    return odd ? [this.srcH, this.srcW] : [this.srcW, this.srcH];
  }
  outputSize(s: EditState): [number, number] {
    const [W, H] = this.orientedSize(s);
    const c = s.geometry.crop;
    return [Math.max(1, Math.round(W * c.w)), Math.max(1, Math.round(H * c.h))];
  }

  private prepare(s: EditState) {
    const gl = this.gl;
    if (s.detail.sharpenRadius !== this.sharpRadius && this.src && this.tFull && this.blurS) {
      this.blurInto(this.src, this.tFull, this.blurS, s.detail.sharpenRadius);
      this.sharpRadius = s.detail.sharpenRadius;
    }
    const key = JSON.stringify(s.curves);
    if (key !== this.curveKey) {
      gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, buildCurveTexture(s.curves));
      this.curveKey = key;
    }
  }

  private setMain(s: EditState, outW: number, outH: number, split: number, view: [number, number, number, number] = [0, 0, 1, 1]) {
    const gl = this.gl, m = this.main;
    gl.useProgram(m.p);
    const tex = [this.src, this.blurS!.tex, this.blurN!.tex, this.blurL!.tex, this.curveTex];
    const names = ['uImg', 'uBlurS', 'uBlurN', 'uBlurL', 'uCurve'];
    tex.forEach((t, k) => { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, t); this.i(m, names[k], k); });

    const g = s.geometry, a = s.adjust, d = s.detail, op = s.optics;
    const [OW, OH] = this.orientedSize(s);
    const ang = (g.straighten * Math.PI) / 180, ca = Math.abs(Math.cos(ang)), sa = Math.abs(Math.sin(ang));
    const sc = Math.max((OW * ca + OH * sa) / OW, (OW * sa + OH * ca) / OH);
    this.f(m, 'uCrop', g.crop.x, g.crop.y, g.crop.w, g.crop.h);
    this.f(m, 'uOrientSize', OW, OH);
    this.f(m, 'uOutSize', outW, outH);
    this.f(m, 'uStraighten', ang);
    this.f(m, 'uStraightenScale', sc);
    this.i(m, 'uRot90', g.rot90);
    this.f(m, 'uFlip', g.flipH ? 1 : 0, g.flipV ? 1 : 0);
    this.f(m, 'uDistort', (op.distortion / 100) * 0.25);
    this.f(m, 'uPersp', (op.vertical / 100) * 0.6, (op.horizontal / 100) * 0.6);
    this.f(m, 'uCA', (op.chromatic / 100) * 1.5);
    const fill = g.fill === 'transparent' ? [0, 0, 0, 0] : hexToRgba(g.fill);
    this.f(m, 'uFill', fill[0], fill[1], fill[2], fill[3]);

    this.f(m, 'uExposure', a.exposure);
    this.f(m, 'uBrightness', a.brightness / 100);
    this.f(m, 'uContrast', a.contrast / 100);
    this.f(m, 'uHighlights', a.highlights / 100);
    this.f(m, 'uShadows', a.shadows / 100);
    this.f(m, 'uWhites', a.whites / 100);
    this.f(m, 'uBlacks', a.blacks / 100);
    this.f(m, 'uTemp', a.temperature / 100);
    this.f(m, 'uTint', a.tint / 100);
    this.f(m, 'uSaturation', a.saturation / 100);
    this.f(m, 'uVibrance', a.vibrance / 100);
    this.f(m, 'uClarity', a.clarity / 100);
    this.f(m, 'uTexture', a.texture / 100);
    this.f(m, 'uDehaze', a.dehaze / 100);
    this.f(m, 'uVignette', a.vignette / 100);
    this.f(m, 'uVigMid', a.vignetteMidpoint / 100);
    this.f(m, 'uGrain', a.grain / 100);
    this.f(m, 'uGrainSize', a.grainSize / 100);
    this.f(m, 'uSharpen', d.sharpenAmount / 100);
    this.f(m, 'uSharpDetail', d.sharpenDetail / 100);
    this.f(m, 'uSharpMask', d.sharpenMasking / 100);
    this.f(m, 'uLumaNR', d.lumaNoise / 100);
    this.f(m, 'uColorNR', d.colorNoise / 100);

    const hv = new Float32Array(24);
    let hslOn = 0;
    HSL_BANDS.forEach((b, k) => {
      const e = s.hsl[b];
      hv[k * 3] = e.h / 100; hv[k * 3 + 1] = e.s / 100; hv[k * 3 + 2] = e.l / 100;
      if (e.h || e.s || e.l) hslOn = 1;
    });
    gl.uniform3fv(this.loc(m, 'uHsl'), hv);
    this.f(m, 'uHslOn', hslOn);
    const c = s.curves;
    this.f(m, 'uCurveOn', [c.master, c.r, c.g, c.b].every(isIdentityCurve) ? 0 : 1);

    const gr = s.grading;
    this.f(m, 'uGradeShadow', ...wheelToRgb(gr.shadows));
    this.f(m, 'uGradeMid', ...wheelToRgb(gr.midtones));
    this.f(m, 'uGradeHigh', ...wheelToRgb(gr.highlights));
    this.f(m, 'uGradeGlobal', ...wheelToRgb(gr.global));
    this.f(m, 'uGradeLum', gr.shadows.lum / 100, gr.midtones.lum / 100, gr.highlights.lum / 100, gr.global.lum / 100);
    this.f(m, 'uBlend', gr.blending / 100);
    this.f(m, 'uBalance', gr.balance / 100);
    this.f(m, 'uSplit', split);
    this.f(m, 'uView', view[0], view[1], view[2], view[3]);
  }

  /** Draw the edited image into the on-screen canvas at the given pixel size. */
  render(s: EditState, w: number, h: number, split = -1, view: [number, number, number, number] = [0, 0, 1, 1]) {
    if (!this.src) return;
    this.prepare(s);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    const [ow, oh] = this.outputSize(s);
    this.setMain(s, ow, oh, split, view);
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.clear(gl.COLOR_BUFFER_BIT);
    this.draw(this.main, null, w, h, true);
  }

  /** Render at an arbitrary size off-screen; returns top-down RGBA pixels. */
  renderPixels(s: EditState, w: number, h: number, split = -1): Uint8Array {
    if (!this.src) throw new Error('No image');
    w = Math.min(w, this.maxSize); h = Math.min(h, this.maxSize);
    this.prepare(s);
    const t = this.target(w, h);
    const [ow, oh] = this.outputSize(s);
    this.setMain(s, ow, oh, split);
    this.draw(this.main, t, w, h, false);
    const gl = this.gl;
    const px = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.freeTarget(t);
    return px;
  }

  renderImageData(s: EditState, w: number, h: number): ImageData {
    const px = this.renderPixels(s, w, h);
    return new ImageData(new Uint8ClampedArray(px.buffer), Math.min(w, this.maxSize), Math.min(h, this.maxSize));
  }

  histogram(s: EditState): Histogram {
    const [ow, oh] = this.outputSize(s);
    const k = Math.max(1, Math.max(ow, oh) / 360);
    const w = Math.max(1, Math.round(ow / k)), h = Math.max(1, Math.round(oh / k));
    const px = this.renderPixels(s, w, h);
    const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      r[px[i]]++; g[px[i + 1]]++; b[px[i + 2]]++;
      l[Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2])]++;
    }
    let max = 1;
    for (let i = 2; i < 254; i++) max = Math.max(max, r[i], g[i], b[i]);
    return { r, g, b, l, max };
  }

  dispose() {
    const gl = this.gl;
    if (this.src) gl.deleteTexture(this.src);
    [this.tFull, this.blurS, this.half, this.tHalf, this.blurN, this.small, this.tSmall, this.blurL].forEach(t => this.freeTarget(t));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

export function hexToRgba(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}
