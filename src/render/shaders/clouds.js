// Volumetric cumulus clouds: raymarched through a slab using 3D Perlin-Worley noise.
//
// The march is jittered per pixel and per frame, so a single frame is noisy. cloudsResolveFS
// accumulates frames in a history buffer of its own (reprojected with the cloud distance and the
// wind), which is what keeps the clouds smooth on presets without TAA and while the camera turns.
import { HEADER, FRAME_UBO, UTIL, SKY_LUT } from './common.js';

export const CLOUD_FUNCS = `
uniform sampler3D uNoise3D;
uniform sampler2D uWeatherMap;

const float CLOUD_SCALE = 1.0 / 720.0;
const float WEATHER_SCALE = 1.0 / 7000.0;
const float NOISE_TEXELS = 64.0;

float coverageFrom(float weather) {
  float cov = uParams2.z;
  return smoothstep(1.0 - cov - 0.12, 1.0 - cov + 0.3, weather) * smoothstep(0.0, 0.08, cov);
}

// lod: mip bias chosen from the size of a pixel at the sample's distance. Sampling the noise
// with an explicit level keeps distant clouds from sparkling (the march has no useful derivatives).
float cloudDensity(vec3 p, bool detail, float lod) {
  float base = uCloudParams.x, top = uCloudParams.y;
  float h = (p.y - base) / (top - base);
  if (h <= 0.0 || h >= 1.0) return 0.0;
  vec2 wind = uCloudParams.zw;
  vec4 w = textureLod(uWeatherMap, (p.xz + wind * 0.6) * WEATHER_SCALE, 0.0);
  float coverage = coverageFrom(w.r);
  if (coverage <= 0.001) return 0.0;
  // cumulus height profile: flat-ish bottoms, rounded tops of varying height
  float topH = mix(0.55, 1.0, w.g);
  float profile = smoothstep(0.0, 0.08, h) * smoothstep(topH, topH * 0.45, h);
  vec3 np = vec3(p.x + wind.x, p.y, p.z + wind.y) * CLOUD_SCALE;
  vec4 n = textureLod(uNoise3D, np, lod);
  float wfbm = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  float shape = remap(n.r, wfbm - 1.0, 1.0, 0.0, 1.0);
  float d = saturate(remap(shape * profile, 1.0 - coverage * 0.85, 1.0, 0.0, 1.0)) * coverage;
  if (d <= 0.0) return 0.0;
  if (detail) {
    // high-frequency erosion: wispy undersides, billowy cauliflower tops
    vec3 dp = np * 6.5 + vec3(uCamPos.w * 0.004, -uCamPos.w * 0.002, 0.0);
    vec4 dn = textureLod(uNoise3D, dp, lod + 2.7);
    float dfbm = dn.g * 0.625 + dn.b * 0.25 + dn.a * 0.125;
    float erode = mix(dfbm, 1.0 - dfbm, saturate(h * 3.0)) * 0.42;
    d = remap(d, erode, 1.0, 0.0, 1.0);
  }
  // dense interiors make crisp silhouettes and dark, self-shadowed bases
  return max(d, 0.0) * 2.8;
}

// Approximate shadow cast by the cloud layer onto a point (used by terrain and god rays).
float cloudShadow(vec3 world) {
  vec3 L = uLightDir.xyz;
  float mid = mix(uCloudParams.x, uCloudParams.y, 0.35);
  float t = (mid - world.y) / max(L.y, 0.08);
  vec3 p = world + L * t;
  float d = cloudDensity(p, false, 1.5);
  return mix(1.0, exp(-d * 3.5), smoothstep(0.02, 0.15, L.y) * 0.85 + 0.15);
}

// Resolved cloud buffer, upsampled with a 5-tap Catmull-Rom filter so low-resolution clouds stay sharp.
vec4 sampleClouds(sampler2D tex, vec2 uv) {
  vec2 size = vec2(textureSize(tex, 0));
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
  vec4 r = texture(tex, vec2(tc12.x, tc0.y)) * (w12.x * w0.y)
         + texture(tex, vec2(tc0.x, tc12.y)) * (w0.x * w12.y)
         + texture(tex, tc12) * (w12.x * w12.y)
         + texture(tex, vec2(tc3.x, tc12.y)) * (w3.x * w12.y)
         + texture(tex, vec2(tc12.x, tc3.y)) * (w12.x * w3.y);
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  r /= wsum;
  return vec4(max(r.rgb, 0.0), saturate(r.a));
}
`;

export const cloudsFS = `${HEADER}
${FRAME_UBO}
${UTIL}
${SKY_LUT}
${CLOUD_FUNCS}
uniform sampler2D uSkyLut;
uniform vec2 uCloudSize;   // size of the cloud target in pixels
uniform float uLightSteps;
in vec2 vUV;
layout(location = 0) out vec4 oColor;  // rgb in-scattered light, a transmittance
layout(location = 1) out vec4 oDist;   // r: transmittance-weighted distance to the cloud

const float SIGMA = 0.075;

float lightMarch(vec3 p, vec3 L, float lod) {
  float od = 0.0;
  float step = 7.0;
  int n = int(uLightSteps);
  for (int i = 0; i < 6; i++) {
    if (i >= n) break;
    p += L * step;
    od += cloudDensity(p, i < 2, lod + float(i) * 0.5) * step;
    step *= n < 6 ? 2.2 : 1.6;
  }
  return od;
}

void main() {
  vec3 rel = reconstructRel(vUV, 1.0);
  vec3 dir = normalize(rel);
  vec3 ro = uCamPos.xyz;
  float base = uCloudParams.x, top = uCloudParams.y;
  float t0, t1;
  oDist = vec4(4000.0, 0.0, 0.0, 0.0);
  if (abs(dir.y) < 1e-4) {
    if (ro.y < base || ro.y > top) { oColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    t0 = 0.0; t1 = 8000.0;
  } else {
    float ta = (base - ro.y) / dir.y;
    float tb = (top - ro.y) / dir.y;
    t0 = max(min(ta, tb), 0.0);
    t1 = max(ta, tb);
  }
  const float MAXD = 14000.0;
  t1 = min(t1, MAXD);
  if (t1 <= t0 || uParams2.z <= 0.001) { oColor = vec4(0.0, 0.0, 0.0, 1.0); oDist.r = max(t0, 1000.0); return; }

  int steps = int(uQuality.w);
  float len = t1 - t0;
  // shorter slabs (looking up) get finer steps; grazing views take longer strides
  float dt = clamp(len / float(steps), 4.0, 160.0);
  // a different offset every frame; the resolve pass averages them
  float jitter = fract(ign(gl_FragCoord.xy, 0.0) + uParams.z * 0.61803399);
  float t = t0 + dt * jitter;
  // world size of one cloud-buffer pixel per metre of distance, for choosing noise mip levels
  float pixelAngle = 2.0 / (uProj[1][1] * uCloudSize.y);
  float texelWorld = 1.0 / (CLOUD_SCALE * NOISE_TEXELS);

  vec3 L = uLightDir.xyz;
  float cosT = dot(dir, L);
  float phase = mix(hgPhase(cosT, 0.72), hgPhase(cosT, -0.2), 0.32) + 0.03;
  float rain = uWeather.x;
  vec3 lightCol = uLightColor.rgb * 1.15;
  vec3 ambTop = uSkyColor.rgb * 0.95;
  vec3 ambBot = mix(uHorizonColor.rgb, uGroundColor.rgb, 0.4) * mix(0.42, 0.3, rain);
  // lightning lights the storm clouds from inside
  ambTop += vec3(0.75, 0.8, 1.0) * uWeather.z * 6.0;
  ambBot += vec3(0.75, 0.8, 1.0) * uWeather.z * 4.0;

  float T = 1.0;
  vec3 S = vec3(0.0);
  float tWeighted = 0.0, wSum = 0.0;
  int empty = 0;
  for (int i = 0; i < 128; i++) {
    if (i >= steps * 2 || T < 0.015 || t > t1) break;
    vec3 p = ro + dir * t;
    float lod = max(log2(t * pixelAngle / texelWorld), 0.0);
    float d = cloudDensity(p, true, lod);
    if (d > 0.002) {
      empty = 0;
      float od = lightMarch(p, L, lod);
      float h = saturate((p.y - base) / (top - base));
      float beer = exp(-od * SIGMA);
      float beer2 = exp(-od * SIGMA * 0.25) * 0.3;
      float powder = 1.0 - exp(-d * 6.0);
      vec3 sun = lightCol * phase * max(beer, beer2) * mix(1.0, powder, 0.6) * 4.0;
      vec3 amb = mix(ambBot, ambTop, h) * (0.55 + 0.45 * h);
      float ext = d * SIGMA;
      vec3 Sc = (sun + amb) * ext;
      float Ts = exp(-ext * dt);
      S += T * (Sc - Sc * Ts) / max(ext, 1e-6);
      tWeighted += t * T * (1.0 - Ts);
      wSum += T * (1.0 - Ts);
      T *= Ts;
      t += dt;
    } else {
      empty++;
      t += dt * (empty > 3 ? 2.0 : 1.0);
    }
  }
  // aerial perspective: distant clouds dissolve into the horizon haze
  float tMid = wSum > 0.0 ? tWeighted / wSum : mix(t0, t1, 0.5);
  vec3 skyCol = texture(uSkyLut, skyLutUV(vec3(dir.x, max(dir.y, 0.0), dir.z))).rgb;
  float fade = exp(-tMid / 7000.0) * smoothstep(0.0, 0.035, dir.y + 0.01);
  S = mix((1.0 - T) * skyCol, S, fade);
  oColor = vec4(S, T);
  oDist = vec4(tMid, 0.0, 0.0, 0.0);
}
`;

// Temporal accumulation of the cloud march. Each pixel finds where its cloud was last frame
// (camera motion plus wind drift), blends a small share of the new sample into that history and
// clamps the history to the range of the current neighbourhood so moving edges don't smear.
export const cloudsResolveFS = `${HEADER}
${FRAME_UBO}
${UTIL}
uniform sampler2D uRaw;
uniform sampler2D uRawDist;
uniform sampler2D uHistory;
uniform sampler2D uHistoryDist;
uniform float uHistoryValid;
uniform vec2 uWindDelta;   // how far the cloud field drifted since the last frame (xz)
uniform float uBlend;      // share of the new frame when the history is good
in vec2 vUV;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oDist;

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  ivec2 maxPx = textureSize(uRaw, 0) - 1;
  vec4 cur = texelFetch(uRaw, px, 0);
  float dist = texelFetch(uRawDist, px, 0).r;
  vec4 mn = cur, mx = cur;
  vec4 m1 = vec4(0.0), m2 = vec4(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec4 s = texelFetch(uRaw, clamp(px + ivec2(x, y), ivec2(0), maxPx), 0);
    mn = min(mn, s); mx = max(mx, s);
    m1 += s; m2 += s * s;
  }
  vec4 mean = m1 / 9.0;
  vec4 sigma = sqrt(max(m2 / 9.0 - mean * mean, 0.0));

  vec3 dir = normalize(reconstructRel(vUV, 1.0));
  // the averaged distance is far steadier than a single frame's
  float histD = texture(uHistoryDist, vUV).r;
  float d = uHistoryValid > 0.5 ? mix(histD, dist, 0.3) : dist;
  vec3 rel = dir * d;
  vec4 prev = uPrevViewProj * vec4(rel + uCamDelta.xyz + vec3(uWindDelta.x, 0.0, uWindDelta.y), 1.0);
  vec2 puv = prev.xy / prev.w * 0.5 + 0.5;
  bool inside = prev.w > 0.0 && puv.x > 0.0 && puv.y > 0.0 && puv.x < 1.0 && puv.y < 1.0;
  if (uHistoryValid < 0.5 || !inside) {
    oColor = mean * 0.5 + cur * 0.5;
    oDist = vec4(dist, 0.0, 0.0, 0.0);
    return;
  }
  vec4 hist = texture(uHistory, puv);
  // a loose box: the march is noisy, so the clamp only has to stop real changes from ghosting
  vec4 lo = min(mn, mean - sigma * 1.5), hi = max(mx, mean + sigma * 1.5);
  hist = clamp(hist, lo, hi);
  float motion = length((puv - vUV) * vec2(textureSize(uRaw, 0)));
  float a = clamp(uBlend + motion * 0.02, uBlend, 0.5);
  oColor = mix(hist, cur, a);
  oDist = vec4(mix(texture(uHistoryDist, puv).r, dist, 0.2), 0.0, 0.0, 0.0);
}
`;
