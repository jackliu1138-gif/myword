// Volumetric cumulus clouds: raymarched through a slab using 3D Perlin-Worley noise.
import { HEADER, FRAME_UBO, UTIL, SKY_LUT } from './common.js';

export const CLOUD_FUNCS = `
uniform sampler3D uNoise3D;
uniform sampler2D uWeatherMap;

const float CLOUD_SCALE = 1.0 / 720.0;
const float WEATHER_SCALE = 1.0 / 7000.0;

float coverageFrom(float weather) {
  float cov = uParams2.z;
  return smoothstep(1.0 - cov - 0.12, 1.0 - cov + 0.3, weather) * smoothstep(0.0, 0.08, cov);
}

float cloudDensity(vec3 p, bool detail) {
  float base = uCloudParams.x, top = uCloudParams.y;
  float h = (p.y - base) / (top - base);
  if (h <= 0.0 || h >= 1.0) return 0.0;
  vec2 wind = uCloudParams.zw;
  vec4 w = texture(uWeatherMap, (p.xz + wind * 0.6) * WEATHER_SCALE);
  float coverage = coverageFrom(w.r);
  if (coverage <= 0.001) return 0.0;
  // cumulus height profile: flat-ish bottoms, rounded tops of varying height
  float topH = mix(0.55, 1.0, w.g);
  float profile = smoothstep(0.0, 0.08, h) * smoothstep(topH, topH * 0.45, h);
  vec3 np = vec3(p.x + wind.x, p.y, p.z + wind.y) * CLOUD_SCALE;
  vec4 n = texture(uNoise3D, np);
  float wfbm = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  float shape = remap(n.r, wfbm - 1.0, 1.0, 0.0, 1.0);
  float d = saturate(remap(shape * profile, 1.0 - coverage * 0.85, 1.0, 0.0, 1.0)) * coverage;
  if (d <= 0.0) return 0.0;
  if (detail) {
    // high-frequency erosion: wispy undersides, billowy cauliflower tops
    vec3 dp = np * 6.5 + vec3(uCamPos.w * 0.004, -uCamPos.w * 0.002, 0.0);
    vec4 dn = texture(uNoise3D, dp);
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
  float d = cloudDensity(p, false);
  return mix(1.0, exp(-d * 3.5), smoothstep(0.02, 0.15, L.y) * 0.85 + 0.15);
}
`;

export const cloudsFS = `${HEADER}
${FRAME_UBO}
${UTIL}
${SKY_LUT}
${CLOUD_FUNCS}
uniform sampler2D uSkyLut;
in vec2 vUV;
out vec4 oColor;

const float SIGMA = 0.075;

float lightMarch(vec3 p, vec3 L) {
  float od = 0.0;
  float step = 7.0;
  for (int i = 0; i < 6; i++) {
    p += L * step;
    od += cloudDensity(p, i < 2) * step;
    step *= 1.6;
  }
  return od;
}

void main() {
  vec3 rel = reconstructRel(vUV, 1.0);
  vec3 dir = normalize(rel);
  vec3 ro = uCamPos.xyz;
  float base = uCloudParams.x, top = uCloudParams.y;
  float t0, t1;
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
  if (t1 <= t0 || uParams2.z <= 0.001) { oColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  int steps = int(uQuality.w);
  float len = t1 - t0;
  // shorter slabs (looking up) get finer steps; grazing views take longer strides
  float dt = clamp(len / float(steps), 4.0, 160.0);
  float jitter = ign(gl_FragCoord.xy, uParams.z);
  float t = t0 + dt * jitter;

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
    float d = cloudDensity(p, true);
    if (d > 0.002) {
      empty = 0;
      float od = lightMarch(p, L);
      float h = saturate((p.y - base) / (top - base));
      float beer = exp(-od * SIGMA) ;
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
  float tMid = wSum > 0.0 ? tWeighted / wSum : t0;
  vec3 skyCol = texture(uSkyLut, skyLutUV(vec3(dir.x, max(dir.y, 0.0), dir.z))).rgb;
  float fade = exp(-tMid / 7000.0) * smoothstep(0.0, 0.035, dir.y + 0.01);
  S = mix((1.0 - T) * skyCol, S, fade);
  oColor = vec4(S, T);
}
`;
