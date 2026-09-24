// Creatures, dropped items and arrows: CPU-built triangles drawn into the G-buffer (so they get the
// same sun, shadows, fog and bloom as the terrain) and into the shadow map.
import { HEADER, FRAME_UBO, UTIL, SHADOW, PIXEL_ART, GPACK } from './common.js';

const ATTRIBS = `
layout(location = 0) in vec3 aPos;     // camera relative
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;
layout(location = 3) in vec4 aInfo;    // layer, sky light, block light, mode (0 skin, 1 block, 2 item sprite)
layout(location = 4) in vec4 aTint;    // rgb + amount (>0 overlay, -1 masked tint, -2 cutout block, -3 cutout tinted)
`;

export const entityVS = `${HEADER}
${FRAME_UBO}
${ATTRIBS}
out vec2 vUV;
out vec3 vN;
flat out vec4 vInfo;
flat out vec4 vTint;
void main() {
  vUV = aUV;
  vN = aNormal;
  vInfo = aInfo;
  vTint = aTint;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;

export const entityFS = `${HEADER}
${FRAME_UBO}
${UTIL}
${PIXEL_ART}
${GPACK}
uniform sampler2DArray uSkins;
uniform sampler2DArray uItems;
uniform sampler2DArray uAlbedo;
uniform vec4 uTexMode;
in vec2 vUV;
in vec3 vN;
flat in vec4 vInfo;
flat in vec4 vTint;
layout(location = 0) out vec4 oAlbedo;
layout(location = 1) out vec4 oNormal;
layout(location = 2) out vec4 oLight;
void main() {
  int mode = int(vInfo.w + 0.5);
  vec4 c;
  float rough = 0.78;
  if (mode == 0) c = texture(uSkins, vec3(vUV, vInfo.x));
  else if (mode == 2) { c = texture(uItems, vec3(vUV, vInfo.x)); rough = 0.55; }
  else c = texture(uAlbedo, vec3(uTexMode.y > 0.5 ? pixelArtUV(vUV, uTexMode.x) : vUV, vInfo.x));
  if (mode != 1 && c.a < 0.5) discard;
  if (mode == 1 && vTint.a < -1.5 && c.a < 0.5) discard;
  vec3 albedo = c.rgb;
  if (vTint.a > 0.0) albedo = mix(albedo, vTint.rgb, vTint.a);
  else if (vTint.a < -2.5) albedo *= vTint.rgb;
  else if (vTint.a < -0.5 && vTint.a > -1.5) albedo *= mix(vec3(1.0), vTint.rgb, c.a);
  vec3 N = normalize(gl_FrontFacing ? vN : -vN);
  oAlbedo = vec4(albedo, rough);
  oNormal = vec4(octEncode(N), octEncode(N));
  oLight = vec4(vInfo.y, vInfo.z, packAO(1.0, 1.0), 0.0);
}
`;

export const entityShadowVS = `${HEADER}
${FRAME_UBO}
${SHADOW}
${ATTRIBS}
out vec2 vUV;
flat out vec4 vInfo;
void main() {
  vUV = aUV;
  vInfo = aInfo;
  vec4 p = uShadowMat * vec4(aPos, 1.0);
  p.xy = shadowDistort(p.xy);
  gl_Position = p;
}
`;

export const entityShadowFS = `${HEADER}
uniform sampler2DArray uSkins;
uniform sampler2DArray uItems;
in vec2 vUV;
flat in vec4 vInfo;
void main() {
  int mode = int(vInfo.w + 0.5);
  if (mode == 0 && texture(uSkins, vec3(vUV, vInfo.x)).a < 0.5) discard;
  if (mode == 2 && texture(uItems, vec3(vUV, vInfo.x)).a < 0.5) discard;
}
`;
