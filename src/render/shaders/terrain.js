// Terrain geometry passes: G-buffer fill and shadow map depth.
import { HEADER, FRAME_UBO, UTIL, TINTS, WAVES, SHADOW, PIXEL_ART } from './common.js';

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
  vec3 rel = uChunkOffset + aPos * (1.0 / 16.0);
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
${FACE_TABLES}
uniform sampler2DArray uAlbedo;
uniform sampler2DArray uNormalMap;
uniform sampler2DArray uMaterialMap;
in vec2 vUV;
in vec3 vRel;
in vec3 vTint;
in vec3 vLight;
flat in uvec3 vFlags;
layout(location = 0) out vec4 oAlbedo;   // rgb albedo (sRGB), a roughness (emission for emissive)
layout(location = 1) out vec4 oNormal;   // xy mapped normal (oct), zw geometric normal (oct)
layout(location = 2) out vec4 oLight;    // sky light, block light, ao, material

void main() {
  float layer = float(vFlags.x);
  vec2 gx = dFdx(vUV), gy = dFdy(vUV);
  vec3 tc = vec3(pixelArtUV(vUV, 16.0), layer);
  vec4 albedo = textureGrad(uAlbedo, tc, gx, gy);
#ifdef CUTOUT
  if (albedo.a < 0.5) discard;
  float tintMask = 1.0;
#else
  float tintMask = albedo.a;
#endif
  albedo.rgb *= mix(vec3(1.0), vTint, tintMask);
  uint face = vFlags.y;
  uint mat = vFlags.z;
  vec3 N = FACE_N[face];
  vec4 nm = textureGrad(uNormalMap, tc, gx, gy);
  vec3 tn = nm.xyz * 2.0 - 1.0;
  vec3 mapped = normalize(FACE_T[face] * tn.x + FACE_B[face] * tn.y + N * tn.z);
  vec4 m = textureGrad(uMaterialMap, tc, gx, gy);
  float rough = m.r;
  float metal = m.g;
  if (mat == 2u) mapped = N; // plants: lit like the ground they stand on
  if (mat == 3u) rough = m.b; // emissive blocks store emission in the roughness slot
  // fade normal detail with distance: reduces shimmering of 16px normal maps far away
  float dist = length(vRel);
  mapped = normalize(mix(mapped, N, smoothstep(24.0, 96.0, dist)));
  oAlbedo = vec4(albedo.rgb, rough);
  oNormal = vec4(octEncode(mapped), octEncode(N));
  oLight = vec4(vLight.x, vLight.y, vLight.z * mix(1.0, nm.w, 0.8), (float(mat) * 16.0 + floor(metal * 15.0 + 0.5)) / 255.0);
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
  vec3 rel = uChunkOffset + aPos * (1.0 / 16.0);
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
