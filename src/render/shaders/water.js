// Forward pass for translucent geometry: water (screen-space reflections, refraction,
// absorption, sun glints) and ice (alpha blended).
import { HEADER, FRAME_UBO, UTIL, SHADOW, SKY_LUT, WAVES } from './common.js';
import { SKY_FUNCS, FOG_FUNCS, WATER_COMMON, RAIN_FUNCS } from './lighting.js';

export const waterVS = `${HEADER}
${FRAME_UBO}
${UTIL}
${WAVES}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in uvec4 aInfo0;
layout(location = 3) in uvec4 aInfo1;
uniform vec3 uChunkOffset;
out vec3 vRel;
out vec2 vUV;
out vec2 vLight;
flat out uvec3 vFlags;
void main() {
  vec3 rel = uChunkOffset + (aPos - 32.0) * (1.0 / 16.0);
  vec3 world = rel + uCamPos.xyz;
  uint ff = aInfo0.y;
  bool top = (aInfo0.z & 4u) != 0u;
  rel += waveOffset(world, (ff >> 3) & 3u, top);
  vRel = rel;
  vUV = aUV * (1.0 / 16.0);
  vLight = vec2(float(aInfo0.w) / 255.0, float(aInfo1.x) / 255.0);
  vFlags = uvec3(aInfo0.x, ff & 7u, aInfo0.z >> 3);
  gl_Position = uViewProj * vec4(rel, 1.0);
}
`;

export const waterFS = `${HEADER}
${FRAME_UBO}
${UTIL}
${SHADOW}
${SKY_LUT}
${SKY_FUNCS}
${FOG_FUNCS}
${WATER_COMMON}
${RAIN_FUNCS}
uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
uniform sampler2DShadow uShadowCmp;
uniform sampler2DArray uAlbedo;
uniform float uSSR;
in vec3 vRel;
in vec2 vUV;
in vec2 vLight;
flat in uvec3 vFlags;
out vec4 oColor;

const vec3 FACE_N[6] = vec3[6](vec3(1,0,0), vec3(-1,0,0), vec3(0,1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1));

float shadowAt(vec3 rel, vec3 n) {
  if (uQuality.x < 0.5) return 1.0;
  vec4 c0 = uShadowMat * vec4(rel, 1.0);
  float r0 = length(c0.xy);
  if (r0 > 0.995) return 1.0;
  float df = shadowDistortFactor(c0.xy);
  float texelWorld = 2.0 * uShadowParams.x * uShadowParams.z * df * df / (1.0 - uShadowParams.w);
  vec4 sc = uShadowMat * vec4(rel + n * (texelWorld * 1.5 + 0.02), 1.0);
  vec3 coord = vec3(shadowDistort(sc.xy) * 0.5 + 0.5, sc.z * 0.5 + 0.5);
  float depthPerBlock = 1.0 / (2.0 * uShadowParams.y);
  coord.z -= depthPerBlock * 0.03;
  float ts = uShadowParams.z * 1.5;
  float s = texture(uShadowCmp, coord) * 0.4;
  s += texture(uShadowCmp, coord + vec3(ts, ts, 0.0)) * 0.15;
  s += texture(uShadowCmp, coord + vec3(-ts, ts, 0.0)) * 0.15;
  s += texture(uShadowCmp, coord + vec3(ts, -ts, 0.0)) * 0.15;
  s += texture(uShadowCmp, coord + vec3(-ts, -ts, 0.0)) * 0.15;
  return mix(s, 1.0, smoothstep(0.85, 0.99, r0));
}

vec2 projectUV(vec3 rel, out float w) {
  vec4 c = uViewProj * vec4(rel, 1.0);
  w = c.w;
  return c.xy / c.w * 0.5 + 0.5;
}

// Screen space reflection marched in camera-relative world space.
vec4 traceSSR(vec3 origin, vec3 R, float jitter) {
  float stepLen = 0.35 + jitter * 0.3;
  vec3 p = origin;
  vec3 prev = origin;
  for (int i = 0; i < 40; i++) {
    prev = p;
    p += R * stepLen;
    stepLen *= 1.14;
    float w;
    vec2 uv = projectUV(p, w);
    if (w <= 0.05 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
    float sd = texture(uSceneDepth, uv).r;
    if (sd >= 1.0) continue;
    float sceneW = linearDepth(sd);
    float diff = w - sceneW;
    if (diff > 0.0 && diff < stepLen * 2.5 + 0.3) {
      // refine with a short binary search
      vec3 a = prev, b = p;
      for (int j = 0; j < 5; j++) {
        vec3 m = (a + b) * 0.5;
        float mw;
        vec2 muv = projectUV(m, mw);
        float md = linearDepth(texture(uSceneDepth, muv).r);
        if (mw > md) b = m; else a = m;
      }
      float bw;
      vec2 huv = projectUV(b, bw);
      vec2 edge = smoothstep(0.0, 0.08, huv) * smoothstep(1.0, 0.92, huv);
      float fade = edge.x * edge.y * (1.0 - float(i) / 40.0);
      return vec4(texture(uSceneColor, huv).rgb, fade);
    }
  }
  return vec4(0.0);
}

void main() {
  uint face = vFlags.y;
  uint mat = vFlags.z;
  vec3 world = vRel + uCamPos.xyz;
  float dist = length(vRel);
  vec3 dir = vRel / dist;
  vec3 V = -dir;
  vec2 suv = gl_FragCoord.xy * uScreen.zw;
  bool underwater = uParams.w > 0.5;
  float skyL = vLight.x;
  float skyAmb = skyL * skyL;
  vec3 L = uLightDir.xyz;

  if (mat != 6u) {
    // ---- ice / other translucent blocks: lit, alpha blended, with a glossy sky reflection
    vec4 tex = texture(uAlbedo, vec3(vUV, float(vFlags.x)));
    vec3 N = FACE_N[face];
    vec3 albedo = srgbToLinear(tex.rgb);
    float sh = dot(N, L) > 0.0 ? shadowAt(vRel, N) : 0.0;
    vec3 diff = albedo * (uLightColor.rgb * max(dot(N, L), 0.0) * sh / PI + uSkyColor.rgb * skyAmb + vec3(1.0, 0.6, 0.3) * pow(vLight.y, 3.0));
    float F = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 refl = renderSky(reflect(dir, N), false) * skyAmb;
    vec3 c = mix(diff, refl, F);
    vec3 H = normalize(L + V);
    c += uLightColor.rgb * pow(max(dot(N, H), 0.0), 400.0) * 2.0 * sh;
    float alpha = mix(tex.a, 1.0, F);
    c = applyFog(c, vRel, dir, dist);
    oColor = vec4(c * alpha, alpha);
    return;
  }

  // ---- water surface normal
  vec3 Ngeo = FACE_N[face];
  vec3 N;
  if (face == 2u) {
    float strength = mix(0.34, 0.08, smoothstep(8.0, 80.0, dist)) * (1.0 + uWeather.x * 0.8);
    N = waterWaveNormal(world.xz, uCamPos.w, strength);
    if (uWeather.x > 0.05 && uWeather.w < 0.5 && dist < 48.0) {
      vec2 rp = rainRipples(world.xz, uCamPos.w, uWeather.x);
      N = normalize(N + vec3(rp.x, 0.0, rp.y));
    }
  } else {
    vec3 wn = waterWaveNormal(world.xz + world.y, uCamPos.w, 0.2);
    N = normalize(Ngeo + vec3(wn.x, 0.0, wn.z) * 0.3);
  }
  bool fromBelow = dot(Ngeo, V) < 0.0;
  if (fromBelow) N = -N;
  float NdV = max(dot(N, V), 0.0);

  // ---- refraction
  float waterW = dot(vRel, -vec3(uView[0][2], uView[1][2], uView[2][2]));
  float sceneD = texture(uSceneDepth, suv).r;
  float sceneW = linearDepth(sceneD);
  float thick = max(sceneW - waterW, 0.0);
  vec2 refrUV = suv + N.xz * vec2(0.03, 0.03) * saturate(thick * 0.25) * (fromBelow ? 1.5 : 1.0) / max(1.0, waterW * 0.04);
  float refrD = texture(uSceneDepth, refrUV).r;
  float refrW = linearDepth(refrD);
  if (refrW < waterW) { refrUV = suv; refrW = sceneW; refrD = sceneD; }
  vec3 refr = texture(uSceneColor, refrUV).rgb;

  vec3 color;
  if (!fromBelow) {
    // distance travelled through water (view-depth difference -> along the ray)
    float travel = refrD >= 1.0 ? 200.0 : max(refrW - waterW, 0.0) * dist / max(waterW, 1e-3);
    vec3 T = exp(-WATER_ABSORB * travel);
    float sunVis = shadowAt(vRel, vec3(0.0, 1.0, 0.0));
    vec3 scatterLight = uSkyColor.rgb * skyAmb * 0.9 + uLightColor.rgb * sunVis * max(L.y, 0.0) * 0.35 + vec3(1.0, 0.6, 0.3) * pow(vLight.y, 3.0);
    vec3 waterCol = vec3(0.0045, 0.032, 0.05);
    vec3 below = refr * T + waterCol * scatterLight * (1.0 - T);

    // reflection: SSR with sky fallback
    vec3 R = reflect(dir, N);
    R.y = abs(R.y);
    vec3 skyRefl = renderSky(R, true) * mix(0.08, 1.0, skyAmb);
    vec3 refl = skyRefl;
    if (uSSR > 0.5) {
      vec4 ssr = traceSSR(vRel + N * 0.02, R, ign(gl_FragCoord.xy, uParams.z));
      refl = mix(skyRefl, ssr.rgb, ssr.a);
    }
    float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    color = mix(below, refl, F);

    // sun glints: sharp GGX lobe on the wavy surface
    vec3 H = normalize(L + V);
    float NdH = max(dot(N, H), 0.0);
    float a2 = 0.0016;
    float dd = NdH * NdH * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * dd * dd);
    float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
    color += uLightColor.rgb * D * Fs * 0.25 * sunVis * saturate(dot(N, L) * 4.0) * (uLightDir.w > 0.5 ? 1.0 : 0.3);

    // soft foam where the water is very shallow
    float foam = (1.0 - smoothstep(0.0, 0.45, travel)) * smoothstep(0.35, 0.7, waterHeight(world.xz * 2.0, uCamPos.w * 1.5));
    color = mix(color, (uSkyColor.rgb * skyAmb + uLightColor.rgb * sunVis * max(L.y, 0.0) / PI) * 0.8, foam * 0.35);
    color = applyFog(color, vRel, dir, dist);
  } else {
    // looking up from under the surface: Snell's window and total internal reflection
    vec3 Rr = refract(dir, N, 1.333);
    float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    vec3 deep = vec3(0.004, 0.022, 0.034) * (uSkyColor.rgb * skyAmb + uLightColor.rgb * 0.1);
    if (dot(Rr, Rr) < 0.01) color = deep;
    else color = mix(refr, deep, F);
  }
  oColor = vec4(color, 1.0);
}
`;
