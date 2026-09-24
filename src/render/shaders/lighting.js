// Deferred lighting: sun/moon with soft shadows, sky ambient, torches, PBR specular,
// foliage subsurface scattering, water caustics, fog and the sky itself.
import { HEADER, FRAME_UBO, UTIL, SHADOW, SKY_LUT } from './common.js';
import { CLOUD_FUNCS } from './clouds.js';

export const MATS = `
#define MAT_DEFAULT 0
#define MAT_FOLIAGE 1
#define MAT_PLANT 2
#define MAT_EMISSIVE 3
#define MAT_METAL 4
#define MAT_GLOSSY 5
#define MAT_WATER 6
#define MAT_ORE 7
#define MAT_SAND 8
#define MAT_SNOW 9
`;

// Sky rendering shared by lighting (background), water (reflections) and fog.
export const SKY_FUNCS = `
uniform sampler2D uSkyLut;
uniform float uStarAngle;
uniform float uMoonPhase; // 0 new moon .. 0.5 full .. 1 new

vec3 skyLut(vec3 dir) {
  return texture(uSkyLut, skyLutUV(dir)).rgb;
}

vec3 fogSky(vec3 dir) {
  return skyLut(normalize(vec3(dir.x, max(dir.y, 0.015), dir.z)));
}

vec3 starField(vec3 dir) {
  // rotate the celestial sphere with the time of day
  float s = sin(uStarAngle), c = cos(uStarAngle);
  vec3 d = vec3(c * dir.x + s * dir.y, -s * dir.x + c * dir.y, dir.z);
  d = vec3(d.x, d.y * 0.906 + d.z * 0.423, -d.y * 0.423 + d.z * 0.906);
  vec3 p = d * 190.0;
  vec3 cell = floor(p);
  vec3 h = hash33(cell);
  if (h.x < 0.955) return vec3(0.0);
  vec3 ctr = cell + 0.5 + (hash33(cell + 17.0) - 0.5) * 0.5;
  float dist = length(p - ctr);
  // at least a pixel or two wide so temporal AA doesn't average them away
  float size = mix(0.22, 0.46, pow(h.y, 3.0));
  float star = smoothstep(size, size * 0.2, dist);
  float bright = 0.35 + 3.0 * pow(h.z, 8.0);
  float tw = 0.85 + 0.15 * sin(uCamPos.w * (1.5 + h.y * 4.0) + h.z * 50.0);
  vec3 col = mix(vec3(0.62, 0.74, 1.0), vec3(1.0, 0.86, 0.66), h.y);
  return col * star * bright * tw;
}

vec3 moonDisk(vec3 dir) {
  vec3 m = uMoonDir.xyz;
  float cosM = dot(dir, m);
  const float R = 0.0135;
  if (cosM < cos(R * 1.4)) return vec3(0.0);
  vec3 right = normalize(cross(m, vec3(0.0, 1.0, 0.0001)));
  vec3 up = cross(right, m);
  vec2 uv = vec2(dot(dir, right), dot(dir, up)) / R;
  float r = length(uv);
  float disk = smoothstep(1.0, 0.94, r);
  float maria = vnoise2(uv * 2.2 + 3.0) * 0.55 + vnoise2(uv * 5.0) * 0.3 + vnoise2(uv * 11.0) * 0.15;
  float crater = smoothstep(0.35, 0.8, maria);
  float limb = sqrt(max(1.0 - r * r, 0.0));
  // phase: light the sphere from a virtual sun that swings around behind it over the cycle
  float th = uMoonPhase * TAU;
  vec3 n = vec3(uv, limb);
  float lit = smoothstep(-0.04, 0.08, dot(n, vec3(sin(th), 0.0, -cos(th))));
  vec3 col = vec3(0.92, 0.94, 1.0) * mix(1.0, 0.58, crater) * (0.55 + 0.45 * limb);
  col = col * lit + vec3(0.012, 0.014, 0.02) * (1.0 - lit); // faint earthshine on the dark side
  float illum = 0.5 - 0.5 * cos(th);
  float halo = exp(-max(r - 1.0, 0.0) * 6.0) * 0.08 * (1.0 - disk) * illum;
  return col * (disk * 0.9 + halo) * uMoonDir.w;
}

vec3 sunDisk(vec3 dir) {
  float cosS = dot(dir, uSunDir.xyz);
  const float R = 0.0105;
  if (cosS < cos(R * 1.5)) return vec3(0.0);
  float ang = acos(clamp(cosS, -1.0, 1.0)) / R;
  float disk = smoothstep(1.0, 0.9, ang);
  float mu = sqrt(max(1.0 - ang * ang, 0.0));
  float limb = 1.0 - 0.55 * (1.0 - pow(mu, 0.6));
  vec3 col = uLightColor.rgb * uLightDir.w;
  return col * disk * limb * 700.0;
}

vec3 renderSky(vec3 dir, bool disks) {
  // below the horizon the LUT holds ground-hitting rays; show the horizon haze instead
  vec3 col = dir.y > 0.012 ? skyLut(dir) : fogSky(dir);
  if (disks) {
    float night = uMoonDir.w;
    float horizon = smoothstep(-0.02, 0.1, dir.y);
    col += starField(dir) * night * horizon * 0.045;
    col += moonDisk(dir) * horizon * 0.35;
    col += sunDisk(dir) * smoothstep(-0.01, 0.01, dir.y);
  }
  col *= mix(1.0, 0.8, smoothstep(0.0, -0.35, dir.y));
  return col;
}
`;

export const FOG_FUNCS = `
uniform float uVolumetricOn;
vec3 applyFog(vec3 col, vec3 rel, vec3 dir, float dist) {
  float dens = uFogParams.x;
  float fall = uFogParams.y;
  float y0 = uCamPos.y - 63.0;
  float dy = rel.y;
  float fogInt = dens * exp(-fall * y0) * dist;
  if (abs(dy) > 0.01) fogInt *= (1.0 - exp(-fall * dy)) / (fall * dy);
  float T = exp(-fogInt);
  float cave = uParams2.w;
  vec3 fogCol = fogSky(dir) * (0.04 + 0.96 * cave * cave);
  vec3 ins = fogCol * (1.0 - T);
  if (uVolumetricOn < 0.5) {
    ins += uLightColor.rgb * hgPhase(dot(dir, uLightDir.xyz), 0.65) * (1.0 - T) * 1.2 * cave;
  }
  col = col * T + ins;
  float far = smoothstep(uFogParams.z, uFogParams.w, length(rel.xz));
  col = mix(col, renderSky(dir, false) * (0.04 + 0.96 * cave), far * far * (3.0 - 2.0 * far));
  return col;
}
`;

// Expanding rings from raindrops, as a normal perturbation (xz) for puddles and water.
export const RAIN_FUNCS = `
vec2 rainRipples(vec2 p, float t, float amount) {
  vec2 n = vec2(0.0);
  for (int layer = 0; layer < 2; layer++) {
    vec2 q = p * (layer == 0 ? 1.4 : 2.1) + float(layer) * 17.3;
    vec2 cell = floor(q);
    vec2 f = fract(q);
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec3 h = hash33(vec3(cell + o, float(layer) * 7.0 + 1.0));
        float period = 0.8 + h.z * 0.7;
        float age = fract(t / period + h.x * 7.0);
        vec2 d = f - (o + 0.15 + h.xy * 0.7);
        float r = length(d);
        float ring = age * 0.55;
        float s = sin((r - ring) * 38.0) * smoothstep(0.1, 0.0, abs(r - ring)) * (1.0 - age) * (1.0 - age);
        n += d / max(r, 1e-3) * s;
      }
    }
  }
  return n * amount * 0.3;
}
`;

export const WATER_COMMON = `
uniform sampler2D uWaterTex;
const vec3 WATER_ABSORB = vec3(0.34, 0.085, 0.055);
float waterHeight(vec2 p, float t) {
  return texture(uWaterTex, p * 0.065 + vec2(t * 0.021, t * 0.012)).b * 0.6
       + texture(uWaterTex, p * 0.12 - vec2(t * 0.016, -t * 0.024)).b * 0.4;
}
vec3 waterWaveNormal(vec2 p, float t, float strength) {
  vec2 n = (texture(uWaterTex, p * 0.065 + vec2(t * 0.021, t * 0.012)).rg * 2.0 - 1.0) * 0.6
         + (texture(uWaterTex, p * 0.12 - vec2(t * 0.016, -t * 0.024)).rg * 2.0 - 1.0) * 0.4
         + (texture(uWaterTex, p * 0.31 + vec2(-t * 0.04, t * 0.03)).rg * 2.0 - 1.0) * 0.25;
  return normalize(vec3(n.x * strength, 1.0, n.y * strength));
}
// caustics from the curvature of the animated water surface (focusing of refracted light)
float caustics(vec3 world, float depth) {
  vec3 L = uLightDir.xyz;
  vec2 p = world.xz + L.xz / max(L.y, 0.2) * depth;
  float t = uCamPos.w;
  float e = 0.35;
  float h = waterHeight(p, t);
  float lap = waterHeight(p + vec2(e, 0.0), t) + waterHeight(p - vec2(e, 0.0), t)
            + waterHeight(p + vec2(0.0, e), t) + waterHeight(p - vec2(0.0, e), t) - 4.0 * h;
  float k = 38.0 * min(depth, 3.0) / (1.0 + depth * 0.15);
  float c = clamp(1.0 - lap * k, 0.15, 4.0);
  return mix(1.0, c * c * 0.8, smoothstep(0.1, 1.2, depth));
}
`;

export const lightingFS = `${HEADER}
${FRAME_UBO}
${UTIL}
${SHADOW}
${SKY_LUT}
${MATS}
${CLOUD_FUNCS}
${SKY_FUNCS}
${FOG_FUNCS}
${WATER_COMMON}
${RAIN_FUNCS}
uniform sampler2D uGAlbedo;
uniform sampler2D uGNormal;
uniform sampler2D uGLight;
uniform sampler2D uDepth;
uniform sampler2DShadow uShadowCmp;
uniform sampler2D uShadowRaw;
uniform sampler2D uWaterShadow;
uniform sampler2D uClouds;
uniform sampler2D uAO;
uniform float uUseSSAO;
uniform float uUseClouds;
uniform sampler2D uPrevColor;   // last frame's resolved HDR image, for glossy reflections
uniform float uReflectSSR;
in vec2 vUV;
out vec4 oColor;

// Screen-space reflection against this frame's depth, shading hits with last frame's image.
vec4 traceLastFrame(vec3 origin, vec3 R, float jitter) {
  float stepLen = 0.25 + jitter * 0.25;
  vec3 p = origin, prev = origin;
  for (int i = 0; i < 28; i++) {
    prev = p;
    p += R * stepLen;
    stepLen *= 1.17;
    vec4 c = uViewProj * vec4(p, 1.0);
    if (c.w <= 0.05) return vec4(0.0);
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
    float sd = texture(uDepth, uv).r;
    if (sd >= 1.0 || sd < 0.021) continue;
    float diff = c.w - linearDepth(sd);
    if (diff > 0.0 && diff < stepLen * 2.5 + 0.25) {
      vec3 a = prev, b = p;
      for (int j = 0; j < 4; j++) {
        vec3 m = (a + b) * 0.5;
        vec4 mc = uViewProj * vec4(m, 1.0);
        float md = linearDepth(texture(uDepth, mc.xy / mc.w * 0.5 + 0.5).r);
        if (mc.w > md) b = m; else a = m;
      }
      vec4 pc = uPrevViewProj * vec4(b + uCamDelta.xyz, 1.0);
      vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
      vec2 edge = smoothstep(0.0, 0.07, puv) * smoothstep(1.0, 0.93, puv);
      return vec4(texture(uPrevColor, puv).rgb, edge.x * edge.y * (1.0 - float(i) / 28.0));
    }
  }
  return vec4(0.0);
}

const vec2 POISSON[16] = vec2[16](
  vec2(-0.94201624, -0.39906216), vec2(0.94558609, -0.76890725), vec2(-0.09418410, -0.92938870), vec2(0.34495938, 0.29387760),
  vec2(-0.91588581, 0.45771432), vec2(-0.81544232, -0.87912464), vec2(-0.38277543, 0.27676845), vec2(0.97484398, 0.75648379),
  vec2(0.44323325, -0.97511554), vec2(0.53742981, -0.47373420), vec2(-0.26496911, -0.41893023), vec2(0.79197514, 0.19090188),
  vec2(-0.24188840, 0.99706507), vec2(-0.81409955, 0.91437590), vec2(0.19984126, 0.78641367), vec2(0.14383161, -0.14100790));

float sampleShadow(vec3 rel, vec3 Ng, float NgdotL, bool foliage, out vec3 tint) {
  tint = vec3(1.0);
  vec3 L = uLightDir.xyz;
  vec4 c0 = uShadowMat * vec4(rel, 1.0);
  float r0 = length(c0.xy);
  if (r0 > 0.995) return 1.0;
  float df = shadowDistortFactor(c0.xy);
  float texelWorld = 2.0 * uShadowParams.x * uShadowParams.z * df * df / (1.0 - uShadowParams.w);
  vec3 p = rel + Ng * (texelWorld * 1.6 + 0.015);
  if (foliage && NgdotL < 0.0) p = rel + L * 0.85;
  vec4 sc = uShadowMat * vec4(p, 1.0);
  vec3 coord = vec3(shadowDistort(sc.xy) * 0.5 + 0.5, sc.z * 0.5 + 0.5);
  if (coord.z >= 1.0) return 1.0;
  float depthPerBlock = 1.0 / (2.0 * uShadowParams.y);
  coord.z -= depthPerBlock * (0.012 + texelWorld * 0.25);

  float angle = ign(gl_FragCoord.xy, uParams.z) * TAU;
  float cs = cos(angle), sn = sin(angle);
  mat2 rot = mat2(cs, sn, -sn, cs);
  float ts = uShadowParams.z;
  float vis = 1.0;
  if (uQuality.y > 1.5) {
    // PCSS: estimate penumbra from the average blocker distance
    float searchTexels = clamp(0.7 / texelWorld, 2.0, 18.0);
    float blockers = 0.0, bsum = 0.0;
    for (int i = 0; i < 8; i++) {
      vec2 o = rot * POISSON[i * 2 + 1] * searchTexels * ts;
      float d = texture(uShadowRaw, coord.xy + o).r;
      if (d < coord.z) { bsum += d; blockers += 1.0; }
    }
    if (blockers > 0.5) {
      float avgB = bsum / blockers;
      float distB = max(coord.z - avgB, 0.0) / depthPerBlock;
      float penumbra = distB * 0.03 + texelWorld * 1.2;
      float radius = clamp(penumbra / texelWorld, 1.0, 18.0);
      int n = int(uQuality.y);
      float sum = 0.0;
      for (int i = 0; i < 16; i++) {
        if (i >= n) break;
        vec2 o = rot * POISSON[i] * radius * ts;
        sum += texture(uShadowCmp, vec3(coord.xy + o, coord.z));
      }
      vis = sum / float(n);
    }
  } else {
    vis = texture(uShadowCmp, coord);
  }
  // fade out towards the edge of the shadow map
  vis = mix(vis, 1.0, smoothstep(0.85, 0.99, r0));

  // receivers below a water surface: absorption and caustics
  float wd = texture(uWaterShadow, coord.xy).r;
  if (wd < coord.z - depthPerBlock * 0.08) {
    float dWater = (coord.z - wd) / depthPerBlock;
    tint = exp(-dWater * WATER_ABSORB * 0.9) * caustics(rel + uCamPos.xyz, dWater);
  }
  return vis;
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  float depth = texelFetch(uDepth, px, 0).r;
  vec3 rel = reconstructRel(vUV, depth);
  vec3 dir = normalize(rel);
  if (depth >= 1.0) {
    vec3 sky = renderSky(dir, true);
    if (uUseClouds > 0.5) {
      vec4 cl = sampleClouds(uClouds, vUV);
      sky = sky * cl.a + cl.rgb;
    }
    sky += vec3(0.62, 0.67, 0.85) * uWeather.z * (0.5 + 0.8 * saturate(dir.y));
    oColor = vec4(sky, 1.0);
    return;
  }
  float dist = length(rel);
  vec3 V = -dir;
  vec4 g0 = texelFetch(uGAlbedo, px, 0);
  vec4 g1 = texelFetch(uGNormal, px, 0);
  vec4 g2 = texelFetch(uGLight, px, 0);
  vec3 albedo = srgbToLinear(g0.rgb);
  vec3 N = octDecode(g1.xy);
  vec3 Ng = octDecode(g1.zw);
  float skyL = g2.r;
  float blockL = g2.g;
  int aoPacked = int(g2.b * 255.0 + 0.5);
  float ao = float(aoPacked >> 4) / 15.0;
  float selfShadow = float(aoPacked & 15) / 15.0;
  int packed = int(g2.a * 255.0 + 0.5);
  int mat = packed >> 4;
  float metal = float(packed & 15) / 15.0;
  float rough = g0.a;
  float emission = 0.0;
  if (mat == MAT_EMISSIVE) { emission = g0.a; rough = 0.65; }
  if (mat == MAT_SNOW) albedo *= 1.05;
  bool foliage = mat == MAT_FOLIAGE || mat == MAT_PLANT;
  float ssao = uUseSSAO > 0.5 ? texture(uAO, vUV).r : 1.0;
  vec3 world = rel + uCamPos.xyz;

  // ---- rain: surfaces open to the sky get darker and glossier; flat ground collects puddles
  float wet = uWeather.y * smoothstep(0.6, 0.93, skyL) * (1.0 - uWeather.w);
  float puddle = 0.0;
  if (wet > 0.01 && mat != MAT_EMISSIVE) {
    float up = saturate(Ng.y);
    float porous = mat == MAT_SAND ? 1.0 : foliage ? 0.12 : (mat == MAT_METAL || mat == MAT_GLOSSY) ? 0.0 : 0.72;
    albedo *= mix(1.0, 0.55, wet * porous);
    // plant sprites use a faked up-normal, so only leaves (real cube faces) turn glossy
    if (mat != MAT_PLANT) rough = mix(rough, foliage ? 0.35 : 0.16, wet * (0.45 + 0.55 * up));
    if (up > 0.9 && !foliage && mat != MAT_SAND && dist < 120.0) {
      float pn = vnoise2(world.xz * 0.09) * 0.65 + vnoise2(world.xz * 0.31 + 7.0) * 0.35;
      puddle = smoothstep(0.6, 0.68, pn + wet * 0.12) * smoothstep(0.3, 0.75, wet);
      rough = mix(rough, 0.02, puddle);
      N = normalize(mix(N, Ng, max(puddle, wet * 0.6)));
      if (puddle > 0.0 && uWeather.x > 0.05) {
        vec2 rp = rainRipples(world.xz, uCamPos.w, uWeather.x);
        N = normalize(N + vec3(rp.x, 0.0, rp.y) * puddle);
      }
      albedo *= mix(1.0, 0.72, puddle);
    } else if (!foliage) {
      N = normalize(mix(N, Ng, wet * 0.4));
    }
  }

  // glints: scattered ice crystals in snow and quartz grains in sand catch the light as you move
  if ((mat == MAT_SNOW || mat == MAT_SAND) && dist < 48.0 && Ng.y > 0.5) {
    vec3 cell = floor(world * 22.0);
    float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    if (h > (mat == MAT_SNOW ? 0.965 : 0.985)) {
      rough = 0.035;
      N = normalize(Ng + (vec3(fract(h * 13.1), fract(h * 71.7), fract(h * 37.3)) - 0.5) * 0.9);
    }
  }

  vec3 L = uLightDir.xyz;
  float NdotL = dot(N, L);
  float NgdotL = dot(Ng, L);
  float shadow = 0.0;
  vec3 lightTint = vec3(1.0);
  if ((NgdotL > 0.0 || foliage) && uLightColor.a > 0.0) {
    shadow = uQuality.x > 0.5 ? sampleShadow(rel, Ng, NgdotL, foliage, lightTint) : 1.0;
    if (uUseClouds > 0.5) shadow *= cloudShadow(world);
  }
  // no direct light where the sky can't reach (deep caves) -- shadow map may not cover it
  shadow *= smoothstep(0.0, 0.25, skyL) * selfShadow;
  vec3 lightCol = uLightColor.rgb * lightTint;

  // --- direct: GGX specular + Lambert diffuse
  float NdL = saturate(NdotL) * saturate(NgdotL * 6.0 + 0.2);
  vec3 H = normalize(L + V);
  float NdV = max(dot(N, V), 1e-3);
  float NdH = saturate(dot(N, H));
  float VdH = saturate(dot(V, H));
  float a = max(rough * rough, 0.003);
  float a2 = a * a;
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dd * dd);
  float k = (rough + 1.0) * (rough + 1.0) * 0.125;
  float G = (NdL / (NdL * (1.0 - k) + k)) * (NdV / (NdV * (1.0 - k) + k));
  vec3 f0 = mix(vec3(0.04), albedo, metal);
  vec3 F = f0 + (1.0 - f0) * pow(1.0 - VdH, 5.0);
  vec3 spec = D * G * F / max(4.0 * NdL * NdV, 1e-4);
  vec3 kd = (1.0 - F) * (1.0 - metal);
  vec3 direct = (kd * albedo / PI + spec) * lightCol * NdL * shadow;

  if (foliage) {
    // light passing through thin leaves/blades, strongest when looking towards the sun
    float back = saturate(dot(-V, L));
    float thru = 0.35 + pow(back, 6.0) * 2.2;
    float amt = mat == MAT_PLANT ? 0.55 : 0.8;
    direct += albedo * lightCol * shadow * thru * amt / PI * (NgdotL < 0.0 ? 1.0 : 0.45);
  }

  // --- indirect: sky light from the light map, torches, minimum cave light
  float skyAmb = skyL * skyL * (0.35 + 0.65 * skyL);
  vec3 skyIrr = N.y >= 0.0 ? mix(uHorizonColor.rgb, uSkyColor.rgb, N.y) : mix(uHorizonColor.rgb, uGroundColor.rgb, -N.y);
  // bounce from sunlit ground and walls
  vec3 bounce = uLightColor.rgb * max(uLightDir.y, 0.0) * 0.045 * (0.6 - 0.4 * N.y);
  vec3 ambient = (skyIrr + bounce + vec3(0.75, 0.8, 1.0) * uWeather.z * 4.0) * skyAmb * ao * ssao;
  float bl = blockL;
  float flick = 0.92 + 0.08 * sin(uCamPos.w * 9.0 + world.x * 0.7) * sin(uCamPos.w * 13.7 + world.z * 0.9);
  vec3 torch = vec3(1.0, 0.58, 0.26) * (bl * bl * 1.3 + pow(bl, 8.0) * 2.3) * flick * mix(1.0, ao * ssao, 0.75);
  vec3 floorLight = vec3(0.0022, 0.0026, 0.0036) * ao;
  vec3 diffuse = albedo * (ambient + torch + floorLight) * (1.0 - metal * 0.85);

  // environment reflection for smooth surfaces (sky, occluded by the light map)
  vec3 R = reflect(-V, N);
  vec3 envF = f0 + (max(vec3(1.0 - rough), f0) - f0) * pow(1.0 - NdV, 5.0);
  float gloss = (1.0 - rough) * (1.0 - rough);
  vec3 env = renderSky(R, false) * skyAmb * envF * gloss * ao;
  if (uReflectSSR > 0.5 && gloss > 0.55 && dist < 90.0) {
    vec4 hit = traceLastFrame(rel + Ng * 0.03, R, ign(gl_FragCoord.xy, uParams.z));
    env = mix(env, hit.rgb * envF * gloss, hit.a);
  }
  env += torch * envF * gloss * 0.3;

  vec3 emissive = albedo * emission * emission * 7.0;
  vec3 color = direct + diffuse + env + emissive;
  color = applyFog(color, rel, dir, dist);
  oColor = vec4(color, 1.0);
}
`;
