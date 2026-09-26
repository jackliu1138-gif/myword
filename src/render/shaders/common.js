// Shared GLSL snippets.

export const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
precision highp sampler2DArray;
precision highp sampler2DShadow;
`;

// Per-frame data shared by every program (std140, binding 0).
export const FRAME_UBO = `
layout(std140) uniform Frame {
  mat4 uView;
  mat4 uProj;
  mat4 uViewProj;
  mat4 uInvViewProj;
  mat4 uPrevViewProj;
  mat4 uViewProjNoJitter;
  mat4 uShadowMat;
  mat4 uInvProj;
  vec4 uCamPos;        // xyz camera world position, w time (s)
  vec4 uLightDir;      // xyz direction to the shadow-casting light, w 1=sun 0=moon
  vec4 uSunDir;        // xyz direction to the sun, w daylight factor 0..1
  vec4 uLightColor;    // rgb illuminance of the shadow light at ground level
  vec4 uSkyColor;      // rgb sky irradiance on an up-facing surface
  vec4 uHorizonColor;  // rgb sky irradiance on a vertical surface
  vec4 uGroundColor;   // rgb bounce light from the ground
  vec4 uFogParams;     // x density, y height falloff, z far fog start, w far fog end
  vec4 uScreen;        // xy resolution, zw 1/resolution
  vec4 uParams;        // x near, y far, z frame index, w camera underwater
  vec4 uParams2;       // x rain, y wind, z cloud coverage, w eye sky light 0..1
  vec4 uCamDelta;      // xyz camera movement since last frame
  vec4 uShadowParams;  // x radius, y depth range, z 1/resolution, w distortion
  vec4 uCloudParams;   // x base, y top, zw wind offset
  vec4 uMoonDir;       // xyz direction to the moon, w night factor
  vec4 uQuality;       // x shadows on, y pcf samples, z volumetric steps, w cloud steps
  vec4 uWeather;       // x precipitation, y surface wetness, z lightning flash, w snow (0/1)
  vec4 uDim;           // x dimension (0 overworld, 1 the nether, 2 the end), yzw light everywhere
  vec4 uDimFog;        // rgb haze and sky colour of the nether and the end
};
vec3 reconstructRel(vec2 uv, float depth) {
  vec4 p = uInvViewProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
float linearDepth(float d) {
  float n = uParams.x, f = uParams.y;
  float z = d * 2.0 - 1.0;
  return 2.0 * n * f / (f + n - z * (f - n));
}
`;

export const UTIL = `
#define PI 3.14159265359
#define TAU 6.28318530718
#define saturate(x) clamp(x, 0.0, 1.0)

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec2 signNotZero(vec2 v) { return vec2(v.x >= 0.0 ? 1.0 : -1.0, v.y >= 0.0 ? 1.0 : -1.0); }
vec2 octEncode(vec3 n) {
  vec2 p = n.xy * (1.0 / (abs(n.x) + abs(n.y) + abs(n.z)));
  return n.z <= 0.0 ? (1.0 - abs(p.yx)) * signNotZero(p) : p;
}
vec3 octDecode(vec2 e) {
  vec3 v = vec3(e.xy, 1.0 - abs(e.x) - abs(e.y));
  if (v.z < 0.0) v.xy = (1.0 - abs(v.yx)) * signNotZero(v.xy);
  return normalize(v);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
// Interleaved gradient noise (Jimenez): cheap per-pixel dither, animated by frame.
float ign(vec2 px, float frame) {
  px += 5.588238 * mod(frame, 64.0);
  return fract(52.9829189 * fract(0.06711056 * px.x + 0.00583715 * px.y));
}

float vnoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec3 srgbToLinear(vec3 c) { return pow(c, vec3(2.2)); }

float remap(float v, float l0, float h0, float l1, float h1) {
  return l1 + (v - l0) * (h1 - l1) / (h0 - l0);
}

// Henyey-Greenstein phase
float hgPhase(float cosT, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * cosT, 1e-4), 1.5));
}
`;

// Fragment-only: "sharp bilinear" sampling for pixel art. Crisp texels up close with a
// one-pixel antialiased edge, ordinary trilinear/anisotropic filtering when minified.
export const PIXEL_ART = `
vec2 pixelArtUV(vec2 uv, float texSize) {
  vec2 t = uv * texSize;
  vec2 fw = max(abs(dFdx(t)) + abs(dFdy(t)), vec2(1e-4));
  vec2 s = floor(t + 0.5);
  t = s + clamp((t - s) / fw, -0.5, 0.5);
  return t / texSize;
}
`;

// G-buffer light channel b: ambient occlusion (high 4 bits) and parallax self-shadow (low 4 bits).
export const GPACK = `
float packAO(float ao, float selfShadow) {
  return (floor(saturate(ao) * 15.0 + 0.5) * 16.0 + floor(saturate(selfShadow) * 15.0 + 0.5)) / 255.0;
}
`;

// Shadow map distortion: spends resolution near the player.
export const SHADOW = `
vec2 shadowDistort(vec2 p) {
  float k = uShadowParams.w;
  return p / (length(p) * k + (1.0 - k));
}
float shadowDistortFactor(vec2 p) {
  float k = uShadowParams.w;
  return length(p) * k + (1.0 - k);
}
`;

// Physically based single-scattering atmosphere (Rayleigh + Mie + ozone), in metres.
export const ATMOSPHERE = `
const float PLANET_R = 6360e3;
const float ATMOS_R = 6460e3;
const vec3 RAY_BETA = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const float MIE_BETA = 3.996e-6;
const float MIE_EXT = 4.44e-6;
const vec3 OZONE_BETA = vec3(0.650e-6, 1.881e-6, 0.085e-6);
const float RAY_H = 8000.0;
const float MIE_H = 1200.0;

vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(-1.0);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

vec3 atmosDensity(float h) {
  float r = exp(-h / RAY_H);
  float m = exp(-h / MIE_H);
  float o = max(0.0, 1.0 - abs(h - 25000.0) / 15000.0);
  return vec3(r, m, o);
}

vec3 atmosExtinction(vec3 dens) {
  return RAY_BETA * dens.x + vec3(MIE_EXT) * dens.y + OZONE_BETA * dens.z;
}

vec3 transmittanceToSpace(vec3 p, vec3 l) {
  vec2 tp = raySphere(p, l, PLANET_R);
  if (tp.x > 0.0) return vec3(0.0); // light is below the horizon for this point
  vec2 t = raySphere(p, l, ATMOS_R);
  float len = t.y;
  const int N = 8;
  float dt = len / float(N);
  vec3 od = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 q = p + l * (float(i) + 0.5) * dt;
    od += atmosDensity(length(q) - PLANET_R) * dt;
  }
  return exp(-(RAY_BETA * od.x + vec3(MIE_EXT) * od.y + OZONE_BETA * od.z));
}

// In-scattered radiance along a view ray for a light of unit illuminance from direction l.
vec3 atmosScatter(vec3 rd, vec3 l, float camAlt, int steps) {
  vec3 ro = vec3(0.0, PLANET_R + camAlt, 0.0);
  vec2 ta = raySphere(ro, rd, ATMOS_R);
  vec2 tg = raySphere(ro, rd, PLANET_R);
  float tMax = ta.y;
  if (tg.x > 0.0) tMax = min(tMax, tg.x);
  // Cap the view path: without multiple scattering, the far end of a grazing ray only adds
  // red-shifted light and turns a clear daytime horizon yellow.
  tMax = min(tMax, 120e3);
  float dt = tMax / float(steps);
  float mu = dot(rd, l);
  float phR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g = 0.8;
  float phM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-4), 1.5));
  vec3 sum = vec3(0.0);
  vec3 odView = vec3(0.0);
  for (int i = 0; i < 48; i++) {
    if (i >= steps) break;
    float t = (float(i) + 0.5) * dt;
    vec3 p = ro + rd * t;
    float h = length(p) - PLANET_R;
    vec3 dens = atmosDensity(h);
    odView += dens * dt;
    vec3 tView = exp(-(RAY_BETA * odView.x + vec3(MIE_EXT) * odView.y + OZONE_BETA * odView.z));
    vec3 tSun = transmittanceToSpace(p, l);
    vec3 scatR = RAY_BETA * dens.x;
    vec3 scatM = vec3(MIE_BETA) * dens.y;
    // cheap isotropic multiple-scattering term keeps the zenith and twilight from going too dark
    sum += tView * tSun * (scatR * (phR + 0.11) + scatM * (phM + 0.05)) * dt;
  }
  return sum;
}
`;

// Sky-view LUT addressing: more resolution near the horizon.
export const SKY_LUT = `
vec2 skyLutUV(vec3 d) {
  float az = atan(d.z, d.x);
  float u = az / TAU + 0.5;
  float el = asin(clamp(d.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (PI * 0.5));
  return vec2(u, v);
}
vec3 skyLutDir(vec2 uv) {
  float az = (uv.x - 0.5) * TAU;
  float s = uv.y * 2.0 - 1.0;
  float el = sign(s) * s * s * PI * 0.5;
  return vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
}
`;

// Tints for biome coloured blocks (grass/foliage) from temperature & humidity.
export const TINTS = `
vec3 grassTint(float t, float h) {
  vec3 cold = vec3(0.50, 0.70, 0.52);
  vec3 temperate = vec3(0.50, 0.76, 0.33);
  vec3 lush = vec3(0.36, 0.72, 0.24);
  vec3 dry = vec3(0.78, 0.72, 0.36);
  vec3 c = mix(cold, temperate, smoothstep(0.15, 0.45, t));
  c = mix(c, lush, smoothstep(0.55, 0.8, h) * smoothstep(0.3, 0.6, t));
  c = mix(c, dry, smoothstep(0.62, 0.85, t) * (1.0 - smoothstep(0.4, 0.7, h)));
  return c;
}
vec3 foliageTint(float t, float h) {
  vec3 c = grassTint(t, h);
  c = mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 0.82);
  return c * vec3(0.86, 0.9, 0.8);
}
vec3 blockTint(uint kind, float t, float h) {
  if (kind == 1u) return grassTint(t, h);
  if (kind == 2u) return foliageTint(t, h);
  if (kind == 3u) return vec3(0.52, 0.68, 0.36);
  if (kind == 4u) return vec3(0.40, 0.58, 0.40);
  return vec3(1.0);
}
`;

// Wind / waves shared by the terrain and shadow passes so shadows follow the animation.
export const WAVES = `
vec3 waveOffset(vec3 world, uint wave, bool top) {
  float t = uCamPos.w;
  float wind = uParams2.y;
  if (wave == 1u) {
    // leaves: gentle multi-frequency sway, all vertices
    float ph = dot(world, vec3(0.61, 0.37, 0.53));
    vec3 o = vec3(sin(t * 1.7 + ph), sin(t * 2.3 + ph * 1.3) * 0.5, cos(t * 1.3 + ph * 0.8));
    return o * 0.035 * wind;
  }
  if (wave == 2u && top) {
    float ph = dot(world.xz, vec2(0.37, 0.29));
    float gust = 0.6 + 0.4 * sin(t * 0.35 + world.x * 0.05 + world.z * 0.03);
    vec2 o = vec2(sin(t * 2.1 + ph), cos(t * 1.7 + ph * 1.2)) * 0.09 * gust;
    return vec3(o.x, 0.0, o.y) * wind;
  }
  if (wave == 3u && top) {
    float w = sin(world.x * 0.9 + t * 1.6) * 0.5 + sin(world.z * 1.1 + t * 1.25) * 0.5 + sin((world.x + world.z) * 0.4 + t * 0.9);
    return vec3(0.0, w * 0.018 - 0.02, 0.0);
  }
  return vec3(0.0);
}
`;

export function glsl(...parts) {
  return parts.join('\n');
}
