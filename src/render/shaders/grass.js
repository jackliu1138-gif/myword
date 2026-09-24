// 3D grass: instanced blades growing on grass blocks near the camera, drawn into the G-buffer and
// (close up) into the shadow map. One instance per blade; a per-block attribute advances every
// uBlades instances, and the blade index within the block seeds its shape.
import { HEADER, FRAME_UBO, UTIL, TINTS, WAVES, SHADOW, GPACK } from './common.js';

const BLADE = `
layout(location = 0) in vec2 aBlade;   // x -1..1 across the blade, y 0..1 from root to tip
layout(location = 1) in uvec4 aSpot;   // block x, y, z (chunk relative), variant
layout(location = 2) in uvec4 aEnv;    // temperature, humidity, sky light, block light
uniform vec3 uChunkOffset;             // chunk origin - camera
uniform vec2 uChunkWorld;              // chunk origin in world blocks (for stable hashing)
uniform float uBlades;                 // blades per block in this draw
uniform vec4 uGrass;                   // x radius, y fade start, z height scale, w width scale
uniform vec3 uPlayerRel;               // player's feet relative to the camera

uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float h01(inout uint s) { s = pcg(s); return float(s) / 4294967295.0; }

struct Blade { vec3 pos; vec3 normal; float t; vec3 color; float visible; };

Blade makeBlade() {
  Blade b;
  float inst = float(gl_InstanceID);
  float idx = inst - floor(inst / uBlades) * uBlades;
  vec3 block = vec3(aSpot.xyz);
  ivec2 wb = ivec2(uChunkWorld) + ivec2(aSpot.xz);
  uint seed = uint(wb.x) * 73856093u ^ uint(wb.y) * 19349663u ^ aSpot.y * 83492791u ^ uint(idx) * 2654435761u;
  float ox = h01(seed), oz = h01(seed);
  float ang = h01(seed) * TAU;
  float tall = h01(seed), wid = h01(seed), bendR = h01(seed), shade = h01(seed), dry = h01(seed);
  vec3 root = uChunkOffset + block + vec3(0.03 + ox * 0.94, 1.0, 0.03 + oz * 0.94);
  float d = length(root.xz);
  // shrink into the ground towards the edge of the grass radius
  float fade = 1.0 - smoothstep(uGrass.y, uGrass.x, d);
  float height = mix(0.22, 0.62, tall * tall) * uGrass.z * (aSpot.w > 0u ? 0.7 : 1.0) * fade;
  float width = mix(0.028, 0.05, wid) * uGrass.w * (1.0 + (1.0 - fade) * 0.5);
  vec2 dirF = vec2(cos(ang), sin(ang));
  vec3 side = vec3(-dirF.y, 0.0, dirF.x);
  float t = aBlade.y;
  // natural lean, the wind (same field as the flat plants) and the player pushing blades aside
  float bend = mix(0.12, 0.45, bendR) * height;
  vec3 world = root + uCamPos.xyz;
  vec3 wind = waveOffset(world + vec3(0.0, 1.0, 0.0), 2u, true) * 2.2 * height;
  vec2 away = root.xz - uPlayerRel.xz;
  float pd = length(away);
  float push = (1.0 - smoothstep(0.25, 0.85, pd)) * step(abs(root.y - uPlayerRel.y - 0.5), 1.2);
  vec2 pushDir = pd > 1e-3 ? away / pd : dirF;
  float tt = t * t;
  vec3 p = root + vec3(0.0, height * t * (1.0 - push * 0.45), 0.0)
         + vec3(dirF.x, 0.0, dirF.y) * bend * tt
         + wind * tt
         + vec3(pushDir.x, 0.0, pushDir.y) * push * height * 0.8 * tt
         + side * aBlade.x * width * 0.5 * pow(1.0 - t, 0.7);
  b.pos = p;
  // blade normal, softened towards "up" so thin blades don't flicker between lit and dark
  vec3 tangent = normalize(vec3(dirF.x * 2.0 * bend * t, height, dirF.y * 2.0 * bend * t) + wind * 2.0 * t);
  vec3 n = normalize(cross(side, tangent));
  b.normal = normalize(mix(n, vec3(0.0, 1.0, 0.0), 0.55));
  b.t = t;
  float temp = float(aEnv.x) / 255.0, hum = float(aEnv.y) / 255.0;
  vec3 tint = grassTint(temp, hum);
  float grey = mix(0.5, 0.84, shade) * mix(0.62, 1.08, t);
  vec3 col = tint * grey;
  // a few dry, straw-coloured tips, more of them in warm dry places
  float dryK = step(dry, 0.1 + smoothstep(0.55, 0.85, temp) * 0.25) * smoothstep(0.4, 1.0, t);
  col = mix(col, vec3(0.72, 0.64, 0.38) * grey, dryK * 0.8);
  b.color = col;
  b.visible = fade;
  return b;
}
`;

export const grassVS = `${HEADER}
${FRAME_UBO}
${UTIL}
${TINTS}
${WAVES}
${BLADE}
out vec3 vColor;
out vec3 vN;
out vec3 vLightAO;
void main() {
  Blade b = makeBlade();
  vColor = b.color;
  vN = b.normal;
  vLightAO = vec3(float(aEnv.z) / 255.0, float(aEnv.w) / 255.0, mix(0.45, 1.0, b.t));
  gl_Position = b.visible > 0.001 ? uViewProj * vec4(b.pos, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const grassFS = `${HEADER}
${FRAME_UBO}
${UTIL}
${GPACK}
in vec3 vColor;
in vec3 vN;
in vec3 vLightAO;
layout(location = 0) out vec4 oAlbedo;
layout(location = 1) out vec4 oNormal;
layout(location = 2) out vec4 oLight;
void main() {
  vec3 N = gl_FrontFacing ? vN : vec3(-vN.x, vN.y, -vN.z);
  oAlbedo = vec4(vColor, 0.6);
  oNormal = vec4(octEncode(normalize(N)), octEncode(vec3(0.0, 1.0, 0.0)));
  // material 2 = plant: subsurface light, no puddles
  oLight = vec4(vLightAO.x, vLightAO.y, packAO(vLightAO.z, 1.0), (2.0 * 16.0) / 255.0);
}
`;

export const grassShadowVS = `${HEADER}
${FRAME_UBO}
${UTIL}
${TINTS}
${WAVES}
${SHADOW}
${BLADE}
void main() {
  Blade b = makeBlade();
  vec4 p = uShadowMat * vec4(b.pos, 1.0);
  p.xy = shadowDistort(p.xy);
  gl_Position = b.visible > 0.001 ? p : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const grassShadowFS = `${HEADER}
void main() {}
`;
