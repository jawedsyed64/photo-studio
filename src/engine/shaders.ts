// GLSL ES 3.00 shaders for the editing pipeline.

export const VERT = `#version 300 es
precision highp float;
uniform float uFlipY;
out vec2 vUv;
void main() {
  // full-screen triangle
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  if (uFlipY > 0.5) vUv.y = 1.0 - vUv.y;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Plain copy / downsample (uses mipmaps of the source for quality)
export const COPY = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 o;
void main() { o = texture(uTex, vUv); }`;

// Separable gaussian blur
export const BLUR = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uStep;   // texel size * direction
uniform float uSigma; // in texels
in vec2 vUv;
out vec4 o;
void main() {
  float s = max(uSigma, 0.3);
  int r = int(min(ceil(s * 3.0), 24.0));
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -24; i <= 24; i++) {
    if (i < -r || i > r) continue;
    float fi = float(i);
    float w = exp(-(fi * fi) / (2.0 * s * s));
    acc += texture(uTex, vUv + uStep * fi) * w;
    wsum += w;
  }
  o = acc / wsum;
}`;

export const MAIN = `#version 300 es
precision highp float;
uniform sampler2D uImg;
uniform sampler2D uBlurS;  // small radius (sharpen / texture)
uniform sampler2D uBlurN;  // noise reduction radius
uniform sampler2D uBlurL;  // large radius (clarity / dehaze)
uniform sampler2D uCurve;  // 256x1 combined curves LUT
uniform sampler2D uMask;   // subject mask (alpha), source space, mipmapped
uniform sampler2D uBg;     // background image, output space, mipmapped
uniform sampler2D uStyle;  // AI style layer, source space
uniform float uMaskOn, uStyleOn, uStyleMix;
uniform int uBgMode;       // 0 keep 1 transparent 2 colour 3 gradient 4 image 5 blur
uniform vec3 uBgColor, uBgColor2;
uniform int uBgGrad;       // 0 linear 1 radial
uniform float uBgBlur, uFeather, uShift, uHarmAmt, uShadow, uBgAspect;
uniform vec3 uHarm;

// geometry
uniform vec4 uCrop;          // x y w h in oriented normalized coords
uniform vec2 uOrientSize;    // oriented image size in px
uniform vec2 uOutSize;       // output size in px (for grain)
uniform float uStraighten;   // radians
uniform float uStraightenScale;
uniform int uRot90;
uniform vec2 uFlip;
uniform float uDistort;
uniform vec2 uPersp;         // vertical, horizontal
uniform float uCA;
uniform vec4 uFill;

// tone & colour
uniform float uExposure, uBrightness, uContrast, uHighlights, uShadows, uWhites, uBlacks;
uniform float uTemp, uTint, uSaturation, uVibrance, uClarity, uTexture, uDehaze;
uniform float uVignette, uVigMid, uGrain, uGrainSize;
uniform float uSharpen, uSharpDetail, uSharpMask, uLumaNR, uColorNR;
uniform vec3 uHsl[8];
uniform float uHslOn;
uniform vec3 uGradeShadow, uGradeMid, uGradeHigh, uGradeGlobal; // rgb tint offsets
uniform vec4 uGradeLum;   // shadow, mid, high, global luminance
uniform float uBlend, uBalance;
uniform float uCurveOn;
uniform float uSplit;
uniform vec4 uView;       // visible part of the output (x y w h), for zoomed views      // <0 off; otherwise x position of before/after split (left = original)

in vec2 vUv;
out vec4 o;

const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
float luma(vec3 c) { return dot(c, LW); }

vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5, h = 0.0, s = 0.0;
  float d = mx - mn;
  if (d > 1e-5) {
    s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}
float hue2c(float p, float q, float t) {
  t = fract(t);
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(vec3 h) {
  if (h.y < 1e-5) return vec3(h.z);
  float q = h.z < 0.5 ? h.z * (1.0 + h.y) : h.z + h.y - h.z * h.y;
  float p = 2.0 * h.z - q;
  return vec3(hue2c(p, q, h.x + 1.0/3.0), hue2c(p, q, h.x), hue2c(p, q, h.x - 1.0/3.0));
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

// output uv -> source uv
vec2 mapGeom(vec2 uv) {
  vec2 p = uCrop.xy + uv * uCrop.zw;
  vec2 c = p - 0.5;
  // perspective (keystone) correction
  c.x *= 1.0 + uPersp.x * c.y * 1.2;
  c.y *= 1.0 + uPersp.y * c.x * 1.2;
  // radial lens distortion correction
  vec2 px = c * uOrientSize;
  vec2 half_ = uOrientSize * 0.5;
  float r2 = dot(px, px) / dot(half_, half_);
  c *= 1.0 + uDistort * r2;
  // straighten (rotate about centre, zoomed to keep frame filled)
  vec2 q = c * uOrientSize / uStraightenScale;
  float cs = cos(uStraighten), sn = sin(uStraighten);
  q = vec2(cs * q.x + sn * q.y, -sn * q.x + cs * q.y);
  p = q / uOrientSize + 0.5;
  if (uFlip.x > 0.5) p.x = 1.0 - p.x;
  if (uFlip.y > 0.5) p.y = 1.0 - p.y;
  vec2 s = p;
  if (uRot90 == 1) s = vec2(p.y, 1.0 - p.x);
  else if (uRot90 == 2) s = 1.0 - p;
  else if (uRot90 == 3) s = vec2(1.0 - p.y, p.x);
  return s;
}

vec3 gradeTint(vec3 col, vec3 tint, float lum, float m) {
  col += tint * m;
  col += lum * 0.25 * m;
  return col;
}

void main() {
  vec2 uv = uView.xy + vUv * uView.zw;
  vec2 s = mapGeom(uv);
  bool outside = s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0;

  // chromatic aberration correction: scale red / blue planes radially
  vec2 cc = s - 0.5;
  float caK = uCA * 0.003;
  vec4 base = texture(uImg, s);
  float rr = texture(uImg, 0.5 + cc * (1.0 - caK)).r;
  float bb = texture(uImg, 0.5 + cc * (1.0 + caK)).b;
  vec3 bS = texture(uBlurS, s).rgb;
  vec3 bN = texture(uBlurN, s).rgb;
  vec3 bL = texture(uBlurL, s).rgb;

  if (outside) { o = uFill; return; }

  if (uSplit >= 0.0 && uv.x < uSplit) { o = base; return; }

  vec3 col = vec3(rr, base.g, bb);
  float alpha = base.a;

  // --- AI layers ---
  float m = 1.0;
  if (uMaskOn > 0.5) {
    float mr = textureLod(uMask, s, uFeather * 4.0).a;
    float c = 0.5 - uShift * 0.4, w = 0.02 + uFeather * 0.45;
    m = smoothstep(c - w, c + w, mr);
  }
  if (uStyleOn > 0.5) col = mix(col, texture(uStyle, s).rgb, uStyleMix);
  if (uMaskOn > 0.5 && uBgMode == 5) {
    vec3 bl = textureLod(uImg, s, 1.0 + uBgBlur * 6.0).rgb;
    col = mix(bl, col, m);
  }

  // --- noise reduction ---
  if (uLumaNR > 0.0) {
    float Y = luma(col), Yb = luma(bN);
    float e = abs(Y - Yb);
    float w = uLumaNR * (1.0 - smoothstep(0.015, 0.15, e));
    col += (mix(Y, Yb, w) - Y);
  }
  if (uColorNR > 0.0) {
    float Y = luma(col);
    vec3 ch = col - Y, chb = bN - luma(bN);
    col = Y + mix(ch, chb, uColorNR);
  }

  // --- sharpening (unsharp mask) ---
  if (uSharpen > 0.0) {
    vec3 hp = col - bS;
    float lim = mix(0.03, 0.5, uSharpDetail);
    hp = clamp(hp, -lim, lim);
    float mag = abs(luma(col) - luma(bS));
    float mask = uSharpMask > 0.0 ? smoothstep(uSharpMask * 0.04, uSharpMask * 0.04 + 0.03, mag) : 1.0;
    col += hp * uSharpen * 1.6 * mask;
  }
  // texture: fine local contrast
  if (uTexture != 0.0) col += (col - bS) * uTexture * 1.2;
  // clarity: mid-tone local contrast
  if (uClarity != 0.0) {
    float Y = luma(col);
    float mm = 1.0 - pow(abs(2.0 * Y - 1.0), 2.0);
    col += (col - bL) * uClarity * 0.9 * mm;
  }
  col = clamp(col, 0.0, 1.0);

  // --- dehaze (dark-channel prior, local estimate) ---
  if (uDehaze > 0.0) {
    float dark = min(bL.r, min(bL.g, bL.b));
    float t = max(1.0 - 0.95 * uDehaze * dark, 0.35);
    vec3 A = vec3(mix(0.85, 1.0, uDehaze));
    col = (col - A) / t + A;
  } else if (uDehaze < 0.0) {
    col = mix(col, vec3(0.82), -uDehaze * 0.55);
  }
  col = clamp(col, 0.0, 1.0);

  // --- white balance & exposure in linear light ---
  vec3 lin = pow(col, vec3(2.2));
  vec3 wb = vec3(1.0 + 0.35 * uTemp + 0.12 * uTint, 1.0 - 0.28 * uTint, 1.0 - 0.35 * uTemp + 0.12 * uTint);
  wb /= dot(wb, LW);
  lin *= wb;
  lin *= exp2(uExposure);
  col = pow(max(lin, 0.0), vec3(1.0 / 2.2));

  // --- tone regions ---
  {
    float Y = clamp(luma(col), 0.0, 1.0);
    float dY = 0.0;
    dY += uHighlights * 0.28 * smoothstep(0.45, 1.0, Y);
    dY += uShadows * 0.28 * (1.0 - smoothstep(0.0, 0.55, Y));
    dY += uWhites * 0.18 * smoothstep(0.7, 1.0, Y);
    dY += uBlacks * 0.14 * (1.0 - smoothstep(0.0, 0.3, Y));
    col += dY;
  }
  col = max(col, 0.0);
  // brightness (mid-tone gamma)
  if (uBrightness != 0.0) col = pow(col, vec3(exp2(-uBrightness * 0.9)));
  // contrast
  if (uContrast > 0.0) {
    vec3 c = clamp(col, 0.0, 1.0);
    col = mix(col, c * c * (3.0 - 2.0 * c), uContrast);
    col = mix(col, 0.5 + (col - 0.5) * 1.25, uContrast * 0.4);
  } else if (uContrast < 0.0) {
    col = mix(col, 0.5 + (col - 0.5) * 0.45, -uContrast);
  }
  col = clamp(col, 0.0, 1.0);

  // --- saturation / vibrance ---
  {
    float Y = luma(col);
    float mx = max(col.r, max(col.g, col.b)), mn = min(col.r, min(col.g, col.b));
    float cs = mx - mn;
    float vib = uVibrance * (1.0 - cs) * (uVibrance > 0.0 ? 1.0 : 1.0);
    col = mix(vec3(Y), col, 1.0 + uSaturation + vib);
    col = clamp(col, 0.0, 1.0);
  }

  // --- HSL per-colour ---
  if (uHslOn > 0.5) {
    vec3 h = rgb2hsl(col);
    float hd = h.x * 360.0;
    float centers[8] = float[8](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 275.0, 315.0);
    float widths[8] = float[8](30.0, 30.0, 40.0, 60.0, 60.0, 50.0, 35.0, 45.0);
    float wsum = 0.0; vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float d = abs(hd - centers[i]);
      d = min(d, 360.0 - d);
      float w = max(0.0, 1.0 - d / widths[i]);
      w = w * w * (3.0 - 2.0 * w);
      acc += uHsl[i] * w; wsum += w;
    }
    if (wsum > 0.0) acc /= max(wsum, 1.0);
    float satW = smoothstep(0.02, 0.25, h.y);
    h.x = fract(h.x + acc.x * (30.0 / 360.0) * satW + 1.0);
    h.y = clamp(h.y * (1.0 + acc.y * satW), 0.0, 1.0);
    h.z = clamp(h.z + acc.z * 0.25 * satW * (1.0 - abs(2.0 * h.z - 1.0)), 0.0, 1.0);
    col = hsl2rgb(h);
  }

  // --- curves ---
  if (uCurveOn > 0.5) {
    vec3 c = clamp(col, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0;
    col = vec3(texture(uCurve, vec2(c.r, 0.5)).r, texture(uCurve, vec2(c.g, 0.5)).g, texture(uCurve, vec2(c.b, 0.5)).b);
  }

  // --- colour grading ---
  {
    float Y = clamp(luma(col), 0.0, 1.0);
    float w = 0.12 + 0.5 * uBlend;
    float pivot = 0.5 - uBalance * 0.3;
    float sm = 1.0 - smoothstep(max(0.0, pivot - w), pivot + w * 0.3, Y);
    float hm = smoothstep(pivot - w * 0.3, min(1.0, pivot + w), Y);
    float mm = clamp(1.0 - sm - hm, 0.0, 1.0);
    col = gradeTint(col, uGradeShadow, uGradeLum.x, sm);
    col = gradeTint(col, uGradeMid, uGradeLum.y, mm);
    col = gradeTint(col, uGradeHigh, uGradeLum.z, hm);
    col = gradeTint(col, uGradeGlobal, uGradeLum.w, 1.0);
  }

  // --- vignette ---
  if (uVignette != 0.0) {
    float r = length((uv - 0.5) * 2.0) / 1.4142;
    float start = mix(0.0, 0.8, uVigMid);
    float m = smoothstep(start, 1.05, r);
    col *= 1.0 + uVignette * m;
    if (uVignette > 0.0) col = mix(col, vec3(1.0), uVignette * m * 0.3);
  }

  // --- grain ---
  if (uGrain > 0.0) {
    vec2 gp = uv * uOutSize / (1.0 + uGrainSize * 4.0);
    float n = vnoise(gp) * 0.6 + vnoise(gp * 2.13 + 17.0) * 0.4;
    float Y = luma(col);
    col += (n - 0.5) * uGrain * 0.3 * (1.0 - abs(2.0 * Y - 1.0) * 0.6);
  }

  col = clamp(col, 0.0, 1.0);

  // --- background replacement ---
  if (uMaskOn > 0.5 && uBgMode >= 1 && uBgMode <= 4) {
    if (uBgMode == 1) alpha *= m;
    else {
      vec3 bg;
      if (uBgMode == 2) bg = uBgColor;
      else if (uBgMode == 3) {
        float asp = uOutSize.x / uOutSize.y;
        float t = uBgGrad == 1 ? smoothstep(0.0, 0.9, length((uv - vec2(0.5, 0.42)) * vec2(asp, 1.0)) / max(asp, 1.0) * 1.3) : uv.y;
        bg = mix(uBgColor, uBgColor2, t);
      } else {
        float ao = uOutSize.x / uOutSize.y;
        vec2 bu = uv;
        if (uBgAspect > ao) bu.x = 0.5 + (uv.x - 0.5) * ao / uBgAspect; else bu.y = 0.5 + (uv.y - 0.5) * uBgAspect / ao;
        bg = textureLod(uBg, bu, uBgBlur * 6.0).rgb;
      }
      bg = mix(bg, clamp(bg * uHarm, 0.0, 1.0), uHarmAmt);
      if (uShadow > 0.0) {
        float sh = textureLod(uMask, s - vec2(0.012, 0.03), 4.5).a;
        bg *= 1.0 - uShadow * 0.65 * sh * (1.0 - m);
      }
      col = mix(bg, col, m);
      alpha = 1.0;
    }
  }
  if (uSplit >= 0.0) {
    if (abs(uv.x - uSplit) < fwidth(uv.x) * 1.5) col = vec3(1.0);
  }
  o = vec4(col, alpha);
}`;
