// Small forward passes: selection outline, block-break particles, held block.
import { HEADER, FRAME_UBO, UTIL, SKY_LUT, PIXEL_ART } from './common.js';

export const outlineVS = `${HEADER}
${FRAME_UBO}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
uniform vec3 uMin;
uniform vec3 uSize;
out vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = uViewProj * vec4(uMin + aPos * uSize, 1.0);
}
`;

export const outlineFS = `${HEADER}
uniform float uProgress; // survival mining, 0..1
in vec2 vUV;
out vec4 oColor;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// Voronoi cell borders on a 16-texel grid: pixel-art cracks
float cracks(vec2 px, float cells, float width) {
  vec2 g = px * cells, c = floor(g), f = fract(g);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(i, j);
    vec2 r = o + vec2(h21(c + o), h21(c + o + 17.0)) - f;
    float dd = dot(r, r);
    if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
  }
  return sqrt(d2) - sqrt(d1) < width ? 1.0 : 0.0;
}
void main() {
  vec2 d = min(vUV, 1.0 - vUV);
  vec2 fw = max(fwidth(vUV), vec2(1e-5));
  vec2 e = d / fw;
  float edge = min(e.x, e.y);
  float a = (1.0 - smoothstep(0.8, 1.9, edge)) * 0.7;
  if (uProgress > 0.0) {
    // ten stages, spreading out from the middle of each face
    float stage = floor(uProgress * 10.0) / 10.0;
    vec2 px = (floor(vUV * 16.0) + 0.5) / 16.0;
    float r = length(px - 0.5) * 1.42;
    float big = cracks(px, 2.6, 0.22) * step(r, stage * 1.35 + 0.08);
    float fine = cracks(px + 0.37, 5.0, 0.26) * step(r, (stage - 0.45) * 1.9);
    a = max(a, max(big, fine) * (0.45 + 0.25 * stage));
  }
  if (a <= 0.01) discard;
  oColor = vec4(0.02, 0.02, 0.03, a);
}
`;

export const particleVS = `${HEADER}
${FRAME_UBO}
layout(location = 0) in vec3 aCenter;
layout(location = 1) in vec2 aCorner;
layout(location = 2) in vec2 aUV;
layout(location = 3) in vec3 aData; // layer, sky light, block light
layout(location = 4) in vec4 aTint; // rgb tint, a > 0.5: alpha-tested (leaves)
out vec2 vUV;
flat out float vLayer;
out vec2 vLight;
out vec3 vRel;
out vec4 vTint;
void main() {
  vTint = aTint;
  vec3 right = vec3(uView[0][0], uView[1][0], uView[2][0]);
  vec3 up = vec3(uView[0][1], uView[1][1], uView[2][1]);
  vec3 p = aCenter + right * aCorner.x + up * aCorner.y;
  vRel = p;
  vUV = aUV;
  vLayer = aData.x;
  vLight = aData.yz;
  gl_Position = uViewProj * vec4(p, 1.0);
}
`;

export const particleFS = `${HEADER}
${FRAME_UBO}
${UTIL}
uniform sampler2DArray uAlbedo;
in vec2 vUV;
flat in float vLayer;
in vec2 vLight;
in vec3 vRel;
in vec4 vTint;
out vec4 oColor;
void main() {
  vec4 t = texture(uAlbedo, vec3(vUV, vLayer));
  if (vTint.a > 0.5) { if (t.a < 0.5) discard; }
  else if (t.a < 0.3) t = vec4(t.rgb, 1.0);
  vec3 albedo = srgbToLinear(t.rgb * vTint.rgb);
  float sky = vLight.x * vLight.x;
  vec3 light = uSkyColor.rgb * sky + uLightColor.rgb * max(uLightDir.y, 0.0) * sky * 0.3 + vec3(1.0, 0.58, 0.26) * pow(vLight.y, 3.0) * 1.2 + 0.003;
  oColor = vec4(albedo * light, 1.0);
}
`;

// Held block, drawn into the G-buffer with its own projection.
export const handVS = `${HEADER}
${FRAME_UBO}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in vec3 aNormal;
layout(location = 3) in float aFace;
uniform mat4 uModel;
uniform float uAspect;
out vec2 vUV;
out vec3 vNormal;
flat out int vFace;
void main() {
  vec4 vp = uModel * vec4(aPos, 1.0);
  float f = 1.0 / tan(radians(35.0));
  float n = 0.05, fa = 10.0;
  gl_Position = vec4(vp.x * f / uAspect, vp.y * f, (vp.z * (fa + n) + 2.0 * fa * n) / (n - fa), -vp.z);
  vec3 nv = mat3(uModel) * aNormal;
  vNormal = transpose(mat3(uView)) * nv;
  vUV = aUV;
  vFace = int(aFace + 0.5);
}
`;

export const handFS = `${HEADER}
${FRAME_UBO}
${UTIL}
${PIXEL_ART}
uniform sampler2DArray uAlbedo;
uniform sampler2DArray uNormalMap;
uniform sampler2DArray uMaterialMap;
uniform sampler2DArray uItems;
uniform float uSprite;  // 1: a flat item sprite (tools, food) instead of a block
uniform vec4 uLayers;   // top, bottom, side, cutout flag
uniform vec4 uLight;    // sky, block, tint on/off, material
uniform vec4 uTexMode;  // texels per face, pixel-art sampling
uniform vec3 uTint;
in vec2 vUV;
in vec3 vNormal;
flat in int vFace;
layout(location = 0) out vec4 oAlbedo;
layout(location = 1) out vec4 oNormal;
layout(location = 2) out vec4 oLight;
void main() {
  if (uSprite > 0.5) {
    vec4 c = texture(uItems, vec3(vUV, uLayers.x));
    if (c.a < 0.5) discard;
    vec3 Ns = normalize(vNormal);
    oAlbedo = vec4(c.rgb, 0.62);
    oNormal = vec4(octEncode(Ns), octEncode(Ns));
    oLight = vec4(uLight.x, uLight.y, 1.0, 0.0);
    return;
  }
  float layer = vFace == 2 ? uLayers.x : vFace == 3 ? uLayers.y : uLayers.z;
  vec2 gx = dFdx(vUV), gy = dFdy(vUV);
  vec2 puv = uTexMode.y > 0.5 ? pixelArtUV(vUV, uTexMode.x) : vUV;
  vec4 a = textureGrad(uAlbedo, vec3(puv, layer), gx, gy);
  bool cutout = uLayers.w > 0.5;
  if (cutout && a.a < 0.5) discard;
  float tintMask = cutout ? 1.0 : a.a;
  if (uLight.z > 0.5) a.rgb *= mix(vec3(1.0), uTint, tintMask);
  vec4 m = textureGrad(uMaterialMap, vec3(puv, layer), gx, gy);
  vec3 N = normalize(vNormal);
  int mat = int(uLight.w + 0.5);
  float rough = mat == 3 ? m.b : m.r;
  oAlbedo = vec4(a.rgb, rough);
  oNormal = vec4(octEncode(N), octEncode(N));
  oLight = vec4(uLight.x, uLight.y, 1.0, (float(mat) * 16.0 + floor(m.g * 15.0 + 0.5)) / 255.0);
}
`;

export { SKY_LUT };
