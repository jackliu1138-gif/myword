// Terrain geometry passes: G-buffer fill and shadow map depth.
import { HEADER, FRAME_UBO, UTIL, TINTS, WAVES, SHADOW, PIXEL_ART, GPACK } from './common.js';

const ATTRIBS = `
layout(location = 0) in vec3 aPos;     // 1/16 block units, chunk relative
layout(location = 1) in vec2 aUV;      // 0..16
layout(location = 2) in uvec4 aInfo0;  // layer, face|wave|tint, ao|top|mat, sky
layout(location = 3) in uvec4 aInfo1;  // block light, temperature, humidity, -
uniform vec3 uChunkOffset;             // chunk origin - camera
`;

const FACE_TABLES = `
const vec3 FACE_N[6] = vec3[6](vec3(1,0,0), vec3(-1,0,0), vec3(0,1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1));
const vec3 FACE_T[6] = vec3[6](vec3(0,0,-1), vec3(0,0,1), vec3(1,0,0), vec3(1,0,0), vec3(1,0,0), vec3(-1,0,0));
const vec3 FACE_B[6] = vec3[6](vec3(0,-1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1), vec3(0,-1,0), vec3(0,-1,0));
`;

export const gbufferVS = (cutout) => `${HEADER}
${cutout ? '#define CUTOUT' : ''}
${FRAME_UBO}
${UTIL}
${TINTS}
${WAVES}
${ATTRIBS}
out vec2 vUV;
out vec3 vRel;
out vec3 vTint;
out vec3 vLight;
flat out uvec3 vFlags;

void main() {
  vec3 rel = uChunkOffset + (aPos - 32.0) * (1.0 / 16.0);
  vec3 world = rel + uCamPos.xyz;
  uint ff = aInfo0.y;
  uint wave = (ff >> 3) & 3u;
  uint tint = ff >> 5;
  bool top = (aInfo0.z & 4u) != 0u;
  rel += waveOffset(world, wave, top);
  vRel = rel;
  gl_Position = uViewProj * vec4(rel, 1.0);
  vUV = aUV * (1.0 / 16.0);
  vLight = vec3(float(aInfo0.w) / 255.0, float(aInfo1.x) / 255.0, float(aInfo0.z & 3u) / 3.0);
  vTint = blockTint(tint, float(aInfo1.y) / 255.0, float(aInfo1.z) / 255.0);
  vFlags = uvec3(aInfo0.x, ff & 7u, aInfo0.z >> 3);
}
`;

export const gbufferFS = (cutout) => `${HEADER}
${cutout ? '#define CUTOUT' : ''}
${FRAME_UBO}
${UTIL}
${PIXEL_ART}
${GPACK}
${FACE_TABLES}
uniform sampler2DArray uAlbedo;
uniform sampler2DArray uNormalMap;
uniform sampler2DArray uMaterialMap;
uniform vec4 uTexMode;   // x texels per block face, y 1 = pixel-art sampling, z parallax steps (0 = off), w parallax depth
in vec2 vUV;
in vec3 vRel;
in vec3 vTint;
in vec3 vLight;
flat in uvec3 vFlags;
layout(location = 0) out vec4 oAlbedo;   // rgb albedo (sRGB), a roughness (emission for emissive)
layout(location = 1) out vec4 oNormal;   // xy mapped normal (oct), zw geometric normal (oct)
layout(location = 2) out vec4 oLight;    // sky light, block light, ao | self-shadow, material

// Parallax occlusion mapping on the material map's height (alpha): steps into the surface along the
// view ray, then marches towards the sun to find whether the found point is shadowed by the relief.
vec2 parallax(vec2 uv, float layer, vec3 Vt, vec2 gx, vec2 gy, out float depthOut) {
  float steps = mix(uTexMode.z, uTexMode.z * 0.4, Vt.z);
  float dl = 1.0 / steps;
  vec2 duv = Vt.xy / max(Vt.z, 0.25) * uTexMode.w * dl;
  float d = 0.0;
  float h = 1.0 - textureGrad(uMaterialMap, vec3(uv, layer), gx, gy).a;
  vec2 prevUV = uv;
  float prevH = h, prevD = 0.0;
  for (int i = 0; i < 32; i++) {
    if (float(i) >= steps || d >= h) break;
    prevUV = uv; prevH = h; prevD = d;
    uv -= duv;
    d += dl;
    h = 1.0 - textureGrad(uMaterialMap, vec3(uv, layer), gx, gy).a;
  }
  // linear refinement between the last two samples
  float after = h - d, before = prevH - prevD;
  float w = after / min(after - before, -1e-4);
  uv = mix(uv, prevUV, clamp(w, 0.0, 1.0));
  depthOut = mix(d, prevD, clamp(w, 0.0, 1.0));
  return uv;
}

float parallaxShadow(vec2 uv, float layer, float depth, vec3 Lt, vec2 gx, vec2 gy) {
  if (Lt.z <= 0.02) return 1.0;
  float lit = 1.0;
  vec2 duv = Lt.xy / Lt.z * uTexMode.w / 8.0;
  float d = depth;
  for (int i = 1; i <= 8; i++) {
    d -= 1.0 / 8.0;
    if (d <= 0.0) break;
    float h = 1.0 - textureGrad(uMaterialMap, vec3(uv + duv * float(i), layer), gx, gy).a;
    if (h < d - 0.02) lit = min(lit, 1.0 - (d - h) * 9.0);
  }
  return clamp(lit, 0.0, 1.0);
}

void main() {
  float layer = float(vFlags.x);
  uint face = vFlags.y;
  uint mat = vFlags.z;
  vec3 N = FACE_N[face];
  vec2 gx = dFdx(vUV), gy = dFdy(vUV);
  vec2 uv = vUV;
  float dist = length(vRel);
  float selfShadow = 1.0;
#ifndef CUTOUT
  if (uTexMode.z > 0.5 && dist < 18.0 && mat != 3u && mat < 10u) {
    vec3 T = FACE_T[face], B = FACE_B[face];
    vec3 V = -vRel / max(dist, 1e-4);
    vec3 Vt = vec3(dot(V, T), dot(V, B), dot(V, N));
    if (Vt.z > 0.05) {
      float depth;
      vec2 puv = parallax(uv, layer, Vt, gx, gy, depth);
      float fade = smoothstep(18.0, 12.0, dist);
      uv = mix(uv, puv, fade);
      vec3 L = uLightDir.xyz;
      vec3 Lt = vec3(dot(L, T), dot(L, B), dot(L, N));
      selfShadow = mix(1.0, parallaxShadow(uv, layer, depth, Lt, gx, gy), fade * uLightColor.a);
    }
  }
#endif
  vec3 tc = vec3(uTexMode.y > 0.5 ? pixelArtUV(uv, uTexMode.x) : uv, layer);
  vec4 albedo = textureGrad(uAlbedo, tc, gx, gy);
#ifdef CUTOUT
  if (albedo.a < 0.5) discard;
  float tintMask = 1.0;
#else
  float tintMask = albedo.a;
#endif
  albedo.rgb *= mix(vec3(1.0), vTint, tintMask);
  vec4 nm = textureGrad(uNormalMap, tc, gx, gy);
  vec3 tn = nm.xyz * 2.0 - 1.0;
  vec3 mapped = normalize(FACE_T[face] * tn.x + FACE_B[face] * tn.y + N * tn.z);
  vec4 m = textureGrad(uMaterialMap, tc, gx, gy);
  float rough = m.r;
  float metal = m.g;
  if (mat == 2u) mapped = N; // plants: lit like the ground they stand on
  if (mat == 3u) rough = m.b; // emissive blocks store emission in the roughness slot
  if (mat == 10u) {
    // nether portal: a slowly churning purple swirl, written as an emissive surface
    vec3 w = vRel + uCamPos.xyz;
    vec2 p = face < 2u ? w.zy : face < 4u ? w.xz : w.xy;
    if (uTexMode.y > 0.5) p = (floor(p * 16.0) + 0.5) / 16.0;
    float t = uCamPos.w;
    vec2 q = p * 1.3;
    for (int i = 0; i < 3; i++) q += vec2(sin(q.y * 2.3 + t * 1.1 + float(i)), cos(q.x * 2.1 - t * 0.9 + float(i) * 1.7)) * 0.35;
    float v = 0.5 + 0.5 * sin(q.x * 3.0 + q.y * 2.0 + t * 0.7);
    float detail = luma(textureGrad(uAlbedo, vec3(q * 0.35, layer), gx, gy).rgb);
    albedo.rgb = mix(vec3(0.24, 0.04, 0.46), vec3(0.78, 0.5, 1.0), clamp(v * 0.75 + detail * 0.5 - 0.15, 0.0, 1.0));
    rough = 0.5 + v * 0.25;
    mapped = N;
    mat = 3u;
  } else if (mat == 11u) {
    // end portal: layers of drifting stars far below the surface
    vec3 V = normalize(vRel);
    vec3 w = vRel + uCamPos.xyz;
    vec3 col = vec3(0.02, 0.04, 0.05);
    float t = uCamPos.w;
    for (int i = 0; i < 5; i++) {
      float depth = 1.5 + float(i) * 2.5;
      vec2 sp = w.xz + V.xz / max(-V.y, 0.12) * depth;
      sp = sp * (0.9 + float(i) * 0.35) + vec2(t * 0.03, t * 0.017) * float(i + 1);
      vec2 cell = floor(sp * 3.0);
      vec3 h = hash33(vec3(cell, float(i) * 7.0));
      vec2 f = fract(sp * 3.0) - 0.5 - (h.xy - 0.5) * 0.6;
      float star = smoothstep(0.16, 0.0, length(f)) * step(0.72, h.z);
      col += mix(vec3(0.25, 0.95, 0.75), vec3(0.65, 0.45, 1.0), h.x) * star * (1.0 - float(i) * 0.15);
    }
    albedo.rgb = col;
    rough = 1.0;
    mapped = N;
    mat = 3u;
  }
  // fade normal detail with distance: reduces shimmering of small normal maps far away
  mapped = normalize(mix(mapped, N, smoothstep(24.0, 96.0, dist)));
  oAlbedo = vec4(albedo.rgb, rough);
  oNormal = vec4(octEncode(mapped), octEncode(N));
  oLight = vec4(vLight.x, vLight.y, packAO(vLight.z * mix(1.0, nm.w, 0.8), selfShadow), (float(mat) * 16.0 + floor(metal * 15.0 + 0.5)) / 255.0);
}
`;

export const shadowVS = (cutout) => `${HEADER}
${cutout ? '#define CUTOUT' : ''}
${FRAME_UBO}
${UTIL}
${WAVES}
${SHADOW}
${ATTRIBS}
out vec2 vUV;
flat out float vLayer;
void main() {
  vec3 rel = uChunkOffset + (aPos - 32.0) * (1.0 / 16.0);
  vec3 world = rel + uCamPos.xyz;
  uint ff = aInfo0.y;
  bool top = (aInfo0.z & 4u) != 0u;
  rel += waveOffset(world, (ff >> 3) & 3u, top);
  vec4 p = uShadowMat * vec4(rel, 1.0);
  p.xy = shadowDistort(p.xy);
  gl_Position = p;
  vUV = aUV * (1.0 / 16.0);
  vLayer = float(aInfo0.x);
}
`;

export const shadowFS = (cutout) => `${HEADER}
${cutout ? '#define CUTOUT' : ''}
uniform sampler2DArray uAlbedo;
in vec2 vUV;
flat in float vLayer;
void main() {
#ifdef CUTOUT
  if (texture(uAlbedo, vec3(vUV, vLayer)).a < 0.5) discard;
#endif
}
`;
