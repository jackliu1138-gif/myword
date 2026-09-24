// Screen-space passes: SSAO, god rays, composite, TAA, bloom, exposure, tone mapping, FXAA.
import { HEADER, FRAME_UBO, UTIL, SHADOW, SKY_LUT } from './common.js';
import { CLOUD_FUNCS } from './clouds.js';
import { WATER_COMMON } from './lighting.js';

// ---------------------------------------------------------------- SSAO (half resolution)
export const ssaoFS = `${HEADER}
${FRAME_UBO}
${UTIL}
uniform sampler2D uDepth;
uniform sampler2D uGNormal;
in vec2 vUV;
out vec4 oColor;
void main() {
  ivec2 full = ivec2(gl_FragCoord.xy) * 2;
  float depth = texelFetch(uDepth, full, 0).r;
  if (depth >= 1.0) { oColor = vec4(1.0); return; }
  vec2 uv = (vec2(full) + 0.5) * uScreen.zw;
  vec3 P = reconstructRel(uv, depth);
  vec3 N = octDecode(texelFetch(uGNormal, full, 0).zw);
  float viewDepth = linearDepth(depth);
  float radius = mix(0.55, 1.4, smoothstep(8.0, 60.0, viewDepth));
  float noise = ign(gl_FragCoord.xy, uParams.z);
  float ang = noise * TAU;
  vec3 t = normalize(abs(N.y) < 0.99 ? cross(N, vec3(0.0, 1.0, 0.0)) : cross(N, vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(N, t);
  float occ = 0.0;
  const int NS = 10;
  for (int i = 0; i < NS; i++) {
    float fi = (float(i) + noise) / float(NS);
    float a = ang + float(i) * 2.39996;
    float r = sqrt(fi);
    float z = sqrt(max(1.0 - fi, 0.0));
    vec3 d = t * (cos(a) * r) + b * (sin(a) * r) + N * z;
    float s = mix(0.12, 1.0, fi * fi) * radius;
    vec3 S = P + d * s + N * 0.02;
    vec4 c = uViewProj * vec4(S, 1.0);
    vec2 suv = c.xy / c.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) continue;
    float sd = linearDepth(texture(uDepth, suv).r);
    float diff = c.w - sd;
    if (diff > 0.02) occ += smoothstep(0.0, 1.0, radius * 1.5 / max(diff, 1e-3)) * (1.0 - smoothstep(radius * 2.0, radius * 4.0, diff));
  }
  float ao = 1.0 - occ / float(NS);
  ao = pow(saturate(ao), 1.6);
  oColor = vec4(ao, viewDepth, 0.0, 1.0);
}
`;

// depth-aware 1D blur on the half-res AO (rg = ao, depth)
export const aoBlurFS = `${HEADER}
${UTIL}
uniform sampler2D uSrc;
uniform vec2 uDir;
in vec2 vUV;
out vec4 oColor;
void main() {
  vec2 c = texture(uSrc, vUV).rg;
  vec2 texel = 1.0 / vec2(textureSize(uSrc, 0));
  float sum = c.r, w = 1.0;
  for (int i = -3; i <= 3; i++) {
    if (i == 0) continue;
    vec2 s = texture(uSrc, vUV + uDir * texel * float(i)).rg;
    float wd = exp(-abs(s.g - c.g) / max(c.g * 0.05, 0.05)) * (1.0 - abs(float(i)) / 4.0);
    sum += s.r * wd;
    w += wd;
  }
  oColor = vec4(sum / w, c.g, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------- volumetric light (half res)
export const volumetricFS = `${HEADER}
${FRAME_UBO}
${UTIL}
${SHADOW}
${CLOUD_FUNCS}
${WATER_COMMON}
uniform sampler2D uDepth;
uniform sampler2DShadow uShadowCmp;
uniform sampler2D uWaterShadow;
uniform float uUseClouds;
in vec2 vUV;
out vec4 oColor;

float shadowHard(vec3 rel, out float waterDepth) {
  waterDepth = 0.0;
  vec4 sc = uShadowMat * vec4(rel, 1.0);
  if (abs(sc.x) > 0.995 || abs(sc.y) > 0.995) return 1.0;
  vec3 coord = vec3(shadowDistort(sc.xy) * 0.5 + 0.5, sc.z * 0.5 + 0.5);
  float depthPerBlock = 1.0 / (2.0 * uShadowParams.y);
  float wd = texture(uWaterShadow, coord.xy).r;
  if (wd < coord.z) waterDepth = (coord.z - wd) / depthPerBlock;
  return texture(uShadowCmp, vec3(coord.xy, coord.z - depthPerBlock * 0.1));
}

void main() {
  ivec2 full = ivec2(gl_FragCoord.xy) * 2;
  float depth = texelFetch(uDepth, full, 0).r;
  vec2 uv = (vec2(full) + 0.5) * uScreen.zw;
  vec3 rel = reconstructRel(uv, depth);
  float dist = length(rel);
  vec3 dir = rel / dist;
  bool underwater = uParams.w > 0.5;
  float maxD = underwater ? 48.0 : min(uShadowParams.x * 0.9, 160.0);
  dist = depth >= 1.0 ? maxD : min(dist, maxD);
  int N = int(uQuality.z);
  float dt = dist / float(N);
  float jitter = ign(gl_FragCoord.xy, uParams.z);
  vec3 L = uLightDir.xyz;
  float cosT = dot(dir, L);
  float phase = underwater ? hgPhase(cosT, 0.55) : mix(hgPhase(cosT, 0.6), hgPhase(cosT, 0.0), 0.55);
  float dens = uFogParams.x;
  float cave = uParams2.w;
  vec3 sum = vec3(0.0);
  float odAcc = 0.0;
  for (int i = 0; i < 48; i++) {
    if (i >= N) break;
    float t = (float(i) + jitter) * dt;
    vec3 p = dir * t;
    float wdepth;
    float vis = shadowHard(p, wdepth);
    if (vis <= 0.0) continue;
    vec3 world = p + uCamPos.xyz;
    float h = world.y - 63.0;
    float d;
    vec3 tint = vec3(1.0);
    if (underwater) {
      d = 0.03;
      tint = exp(-WATER_ABSORB * (wdepth + t)) * vec3(0.35, 0.8, 1.0);
    } else {
      d = dens * exp(-uFogParams.y * h) + dens * 0.15;
      if (wdepth > 0.0) tint = exp(-WATER_ABSORB * wdepth);
    }
    if (uUseClouds > 0.5) vis *= cloudShadow(world);
    sum += vis * d * tint * exp(-odAcc) * dt;
    odAcc += d * dt;
  }
  vec3 result = sum * uLightColor.rgb * phase * (underwater ? 0.35 : 0.55) * cave;
  oColor = vec4(result, 1.0);
}
`;

// ---------------------------------------------------------------- composite: god rays + underwater fog
export const compositeFS = `${HEADER}
${FRAME_UBO}
${UTIL}
uniform sampler2D uScene;
uniform sampler2D uVolumetric;
uniform sampler2D uDepth;
uniform float uUseVolumetric;
in vec2 vUV;
out vec4 oColor;
void main() {
  vec3 c = texture(uScene, vUV).rgb;
  float depth = texture(uDepth, vUV).r;
  if (uUseVolumetric > 0.5) {
    // depth-aware upsample of the half-res result
    vec2 hres = vec2(textureSize(uVolumetric, 0));
    vec2 p = vUV * hres - 0.5;
    vec2 f = fract(p);
    vec2 base = (floor(p) + 0.5) / hres;
    float ld = linearDepth(depth);
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
      vec2 suv = base + vec2(i, j) / hres;
      float sd = linearDepth(texture(uDepth, suv).r);
      float w = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
      w *= 1.0 / (1e-3 + abs(sd - ld) / max(ld, 1.0));
      acc += texture(uVolumetric, suv).rgb * w;
      wsum += w;
    }
    c += acc / max(wsum, 1e-5);
  }
  if (uParams.w > 0.5) {
    // camera under water: absorption and in-scattering along the view ray
    vec3 rel = reconstructRel(vUV, depth);
    float d = depth >= 1.0 ? 80.0 : length(rel);
    vec3 absorb = vec3(0.30, 0.075, 0.05) * 1.3 + 0.012;
    vec3 T = exp(-absorb * d);
    // light reaching the eye is attenuated by the water column above it
    float eyeDepth = uParams.w - 1.0;
    vec3 column = exp(-vec3(0.30, 0.075, 0.05) * eyeDepth * 1.2);
    vec3 scat = vec3(0.006, 0.035, 0.05) * (uSkyColor.rgb * (0.3 + 0.7 * uParams2.w) + uLightColor.rgb * 0.3) * column;
    c = c * T + scat * (1.0 - T);
  }
  oColor = vec4(c, 1.0);
}
`;

// ---------------------------------------------------------------- temporal anti-aliasing
export const taaFS = `${HEADER}
${FRAME_UBO}
${UTIL}
uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform sampler2D uDepth;
uniform float uHistoryValid;
in vec2 vUV;
out vec4 oColor;

vec3 toYCoCg(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
vec3 tm(vec3 c) { return c / (1.0 + luma(c)); }
vec3 itm(vec3 c) { return c / max(1.0 - luma(c), 1e-4); }

vec3 sampleHistory(vec2 uv) {
  // 5-tap Catmull-Rom
  vec2 size = vec2(textureSize(uHistory, 0));
  vec2 pos = uv * size;
  vec2 c = floor(pos - 0.5) + 0.5;
  vec2 f = pos - c;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 tc12 = (c + w2 / w12) / size;
  vec2 tc0 = (c - 1.0) / size;
  vec2 tc3 = (c + 2.0) / size;
  vec3 r = texture(uHistory, vec2(tc12.x, tc0.y)).rgb * (w12.x * w0.y)
         + texture(uHistory, vec2(tc0.x, tc12.y)).rgb * (w0.x * w12.y)
         + texture(uHistory, tc12).rgb * (w12.x * w12.y)
         + texture(uHistory, vec2(tc3.x, tc12.y)).rgb * (w3.x * w12.y)
         + texture(uHistory, vec2(tc12.x, tc3.y)).rgb * (w12.x * w3.y);
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(r / wsum, 0.0);
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec3 cur = texelFetch(uCurrent, px, 0).rgb;
  // neighbourhood statistics + closest depth for reprojection
  vec3 m1 = vec3(0.0), m2 = vec3(0.0);
  float closest = 1.0;
  ivec2 closestPx = px;
  ivec2 maxPx = ivec2(uScreen.xy) - 1;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec2 q = clamp(px + ivec2(x, y), ivec2(0), maxPx);
    vec3 s = toYCoCg(tm(texelFetch(uCurrent, q, 0).rgb));
    m1 += s; m2 += s * s;
    float d = texelFetch(uDepth, q, 0).r;
    if (d < closest) { closest = d; closestPx = q; }
  }
  vec3 mean = m1 / 9.0;
  vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, 0.0));
  vec2 cuv = (vec2(closestPx) + 0.5) * uScreen.zw;
  vec3 rel = reconstructRel(cuv, closest);
  vec4 prev = uPrevViewProj * vec4(rel + uCamDelta.xyz, 1.0);
  vec2 prevUV = prev.xy / prev.w * 0.5 + 0.5;
  vec2 motion = prevUV - cuv;
  if (closest < 0.021) motion = vec2(0.0); // held item is locked to the screen
  prevUV = vUV + motion;
  if (uHistoryValid < 0.5 || prevUV.x < 0.0 || prevUV.y < 0.0 || prevUV.x > 1.0 || prevUV.y > 1.0 || prev.w <= 0.0) {
    oColor = vec4(cur, 1.0);
    return;
  }
  vec3 hist = toYCoCg(tm(sampleHistory(prevUV)));
  float speed = length(motion * uScreen.xy);
  float gamma = mix(1.25, 0.8, saturate(speed / 8.0));
  vec3 lo = mean - sigma * gamma, hi = mean + sigma * gamma;
  // clip towards the mean (variance clipping)
  vec3 center = (lo + hi) * 0.5, ext = (hi - lo) * 0.5 + 1e-5;
  vec3 v = hist - center;
  vec3 a = abs(v / ext);
  float m = max(a.x, max(a.y, a.z));
  if (m > 1.0) hist = center + v / m;
  vec3 c = toYCoCg(tm(cur));
  float blend = mix(0.09, 0.25, saturate(speed / 12.0));
  vec3 res = mix(hist, c, blend);
  oColor = vec4(itm(fromYCoCg(res)), 1.0);
}
`;

// ---------------------------------------------------------------- bloom
export const bloomDownFS = `${HEADER}
${UTIL}
uniform sampler2D uSrc;
uniform float uFirst;
in vec2 vUV;
out vec4 oColor;
vec3 karis(vec3 c) { return c / (1.0 + luma(c) * 0.25); }
void main() {
  vec2 t = 1.0 / vec2(textureSize(uSrc, 0));
  vec3 a = texture(uSrc, vUV + t * vec2(-2, 2)).rgb;
  vec3 b = texture(uSrc, vUV + t * vec2(0, 2)).rgb;
  vec3 c = texture(uSrc, vUV + t * vec2(2, 2)).rgb;
  vec3 d = texture(uSrc, vUV + t * vec2(-2, 0)).rgb;
  vec3 e = texture(uSrc, vUV).rgb;
  vec3 f = texture(uSrc, vUV + t * vec2(2, 0)).rgb;
  vec3 g = texture(uSrc, vUV + t * vec2(-2, -2)).rgb;
  vec3 h = texture(uSrc, vUV + t * vec2(0, -2)).rgb;
  vec3 i = texture(uSrc, vUV + t * vec2(2, -2)).rgb;
  vec3 j = texture(uSrc, vUV + t * vec2(-1, 1)).rgb;
  vec3 k = texture(uSrc, vUV + t * vec2(1, 1)).rgb;
  vec3 l = texture(uSrc, vUV + t * vec2(-1, -1)).rgb;
  vec3 m = texture(uSrc, vUV + t * vec2(1, -1)).rgb;
  vec3 r;
  if (uFirst > 0.5) {
    // Karis average on the first mip suppresses fireflies from sun glints
    vec3 g0 = karis((a + b + d + e) * 0.25), g1 = karis((b + c + e + f) * 0.25);
    vec3 g2 = karis((d + e + g + h) * 0.25), g3 = karis((e + f + h + i) * 0.25);
    vec3 g4 = karis((j + k + l + m) * 0.25);
    r = g4 * 0.5 + (g0 + g1 + g2 + g3) * 0.125;
  } else {
    r = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  oColor = vec4(max(r, 0.0), 1.0);
}
`;

export const bloomUpFS = `${HEADER}
uniform sampler2D uSrc;
uniform float uRadius;
in vec2 vUV;
out vec4 oColor;
void main() {
  vec2 t = uRadius / vec2(textureSize(uSrc, 0));
  vec3 s = texture(uSrc, vUV).rgb * 4.0;
  s += (texture(uSrc, vUV + vec2(-t.x, 0)).rgb + texture(uSrc, vUV + vec2(t.x, 0)).rgb + texture(uSrc, vUV + vec2(0, -t.y)).rgb + texture(uSrc, vUV + vec2(0, t.y)).rgb) * 2.0;
  s += texture(uSrc, vUV + vec2(-t.x, -t.y)).rgb + texture(uSrc, vUV + vec2(t.x, -t.y)).rgb + texture(uSrc, vUV + vec2(-t.x, t.y)).rgb + texture(uSrc, vUV + vec2(t.x, t.y)).rgb;
  oColor = vec4(s / 16.0, 1.0);
}
`;

// ---------------------------------------------------------------- auto exposure
export const exposureFS = `${HEADER}
${UTIL}
uniform sampler2D uSrc;      // small bloom mip
uniform sampler2D uPrev;     // previous exposure (1x1)
uniform float uDt;
uniform float uReset;
uniform vec2 uRange;         // min / max exposure
uniform float uCompensation;
uniform float uReference;    // exposure predicted from the light intensities around the eye
in vec2 vUV;
out vec4 oColor;
void main() {
  ivec2 size = textureSize(uSrc, 0);
  float sum = 0.0, wsum = 0.0;
  for (int y = 0; y < 64; y++) {
    if (y >= size.y) break;
    for (int x = 0; x < 64; x++) {
      if (x >= size.x) break;
      vec2 uv = (vec2(x, y) + 0.5) / vec2(size);
      float l = luma(texelFetch(uSrc, ivec2(x, y), 0).rgb);
      // centre weighted metering that favours the lower half (terrain over sky)
      float w = (1.0 - 0.7 * smoothstep(0.1, 0.7, length(uv - vec2(0.5, 0.45)))) * (uv.y < 0.55 ? 1.0 : 0.45);
      sum += log2(max(l, 1e-5)) * w;
      wsum += w;
    }
  }
  float avgLog = sum / max(wsum, 1.0);
  float avgLum = exp2(avgLog);
  float metered = 0.3 / max(avgLum, 1e-5);
  // limited adaptation around the reference keeps looking at the sun from blacking out the world
  float target = uReference * clamp(metered / uReference, 0.7, 1.6) * uCompensation;
  target = clamp(target, uRange.x, uRange.y);
  float prev = texelFetch(uPrev, ivec2(0), 0).r;
  float rate = target > prev ? 1.1 : 2.2;
  float e = uReset > 0.5 ? target : mix(prev, target, 1.0 - exp(-uDt * rate));
  oColor = vec4(e, avgLum, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------- tone mapping + grading
export const tonemapFS = `${HEADER}
${FRAME_UBO}
${UTIL}
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uExposure;
uniform float uBloomStrength;
uniform float uSaturation;
uniform float uContrast;
uniform float uVignette;
uniform float uManualExposure;
in vec2 vUV;
out vec4 oColor;

// ACES fitted (Stephen Hill)
const mat3 ACES_IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACES_OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
vec3 rrtOdt(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 c) { return saturate(ACES_OUT * rrtOdt(ACES_IN * c)); }

vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec3 c = texture(uScene, vUV).rgb;
  vec3 bloom = texture(uBloom, vUV).rgb * (1.0 / 6.0);
  float exposure = uManualExposure > 0.0 ? uManualExposure : texelFetch(uExposure, ivec2(0), 0).r;
  c = mix(c, bloom, uBloomStrength);
  // scotopic vision: in dim light colours fade and shift towards blue (Purkinje effect)
  float lum = luma(c);
  float scot = 1.0 - smoothstep(0.004, 0.07, lum * max(exposure, 1.0));
  c = mix(c, vec3(0.62, 0.78, 1.15) * lum, scot * 0.75);
  c *= exposure;
  // underwater tint
  if (uParams.w > 0.5) c *= vec3(0.85, 1.0, 1.05);
  c = aces(c);
  // grading: saturation, gentle contrast around mid grey, warm highlights / cool shadows
  float l = luma(c);
  c = mix(vec3(l), c, uSaturation);
  c = saturate((c - 0.18) * uContrast + 0.18);
  c = mix(c, c * vec3(1.03, 1.0, 0.96), smoothstep(0.4, 1.0, l));
  c = mix(c * vec3(0.96, 0.99, 1.05), c, smoothstep(0.0, 0.3, l));
  vec3 s = linearToSrgb(saturate(c));
  // vignette
  vec2 d = vUV - 0.5;
  s *= 1.0 - uVignette * dot(d, d) * 1.6;
  // dither to hide banding in smooth skies
  s += (ign(gl_FragCoord.xy, uParams.z) - 0.5) / 255.0;
  oColor = vec4(s, luma(s));
}
`;

// ---------------------------------------------------------------- final: FXAA + sharpen + upscale
export const finalFS = `${HEADER}
${UTIL}
uniform sampler2D uSrc;
uniform sampler2D uDebug;
uniform float uDebugMode;
uniform float uFxaa;
uniform float uSharpen;
in vec2 vUV;
out vec4 oColor;

vec3 fxaa(vec2 uv, vec2 rcp) {
  vec3 rgbNW = texture(uSrc, uv + vec2(-1.0, -1.0) * rcp).rgb;
  vec3 rgbNE = texture(uSrc, uv + vec2(1.0, -1.0) * rcp).rgb;
  vec3 rgbSW = texture(uSrc, uv + vec2(-1.0, 1.0) * rcp).rgb;
  vec3 rgbSE = texture(uSrc, uv + vec2(1.0, 1.0) * rcp).rgb;
  vec3 rgbM = texture(uSrc, uv).rgb;
  const vec3 lw = vec3(0.299, 0.587, 0.114);
  float lNW = dot(rgbNW, lw), lNE = dot(rgbNE, lw), lSW = dot(rgbSW, lw), lSE = dot(rgbSE, lw), lM = dot(rgbM, lw);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float dirReduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcpDirMin, vec2(-8.0), vec2(8.0)) * rcp;
  vec3 rgbA = 0.5 * (texture(uSrc, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture(uSrc, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 rgbB = rgbA * 0.5 + 0.25 * (texture(uSrc, uv + dir * -0.5).rgb + texture(uSrc, uv + dir * 0.5).rgb);
  float lB = dot(rgbB, lw);
  return (lB < lMin || lB > lMax) ? rgbA : rgbB;
}

void main() {
  vec2 rcp = 1.0 / vec2(textureSize(uSrc, 0));
  vec3 c = uFxaa > 0.5 ? fxaa(vUV, rcp) : texture(uSrc, vUV).rgb;
  if (uSharpen > 0.0) {
    vec3 n = texture(uSrc, vUV + vec2(0.0, -rcp.y)).rgb + texture(uSrc, vUV + vec2(0.0, rcp.y)).rgb
           + texture(uSrc, vUV + vec2(-rcp.x, 0.0)).rgb + texture(uSrc, vUV + vec2(rcp.x, 0.0)).rgb;
    vec3 m = texture(uSrc, vUV).rgb;
    c = max(c + (m * 4.0 - n) * uSharpen * 0.25, 0.0);
  }
  if (uDebugMode > 0.5) {
    vec4 d = texture(uDebug, vUV);
    if (uDebugMode < 1.5) c = d.rgb / (1.0 + d.rgb) + vec3(0.0, 0.0, 1.0 - d.a) * 0.3; // hdr rgb, blue = opacity
    else if (uDebugMode < 2.5) c = vec3(d.r); // single channel
    else c = pow(d.rgb / (1.0 + d.rgb), vec3(1.0 / 2.2));
  }
  oColor = vec4(c, 1.0);
}
`;

export { SKY_LUT };
