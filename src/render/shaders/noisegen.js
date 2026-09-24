// GPU generation of tiling noise textures (run once at startup).
import { HEADER, UTIL, FRAME_UBO } from './common.js';

const TILING_NOISE = `
vec3 hash33w(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
// Tiling Worley: returns 1 near feature points, 0 far away. p in [0, period)
float worley3(vec3 p, float period) {
  vec3 id = floor(p);
  vec3 f = fract(p);
  float md = 1.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(x, y, z);
    vec3 c = mod(id + o, period);
    vec3 d = o + hash33w(c) - f;
    md = min(md, dot(d, d));
  }
  return 1.0 - sqrt(md);
}
vec3 grad3(vec3 c) { return normalize(hash33w(c) * 2.0 - 1.0); }
float perlin3(vec3 p, float period) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(grad3(mod(i, period)), f);
  float n100 = dot(grad3(mod(i + vec3(1, 0, 0), period)), f - vec3(1, 0, 0));
  float n010 = dot(grad3(mod(i + vec3(0, 1, 0), period)), f - vec3(0, 1, 0));
  float n110 = dot(grad3(mod(i + vec3(1, 1, 0), period)), f - vec3(1, 1, 0));
  float n001 = dot(grad3(mod(i + vec3(0, 0, 1), period)), f - vec3(0, 0, 1));
  float n101 = dot(grad3(mod(i + vec3(1, 0, 1), period)), f - vec3(1, 0, 1));
  float n011 = dot(grad3(mod(i + vec3(0, 1, 1), period)), f - vec3(0, 1, 1));
  float n111 = dot(grad3(mod(i + vec3(1, 1, 1), period)), f - vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float perlinFbm(vec3 p, float period, int oct) {
  float s = 0.0, a = 1.0, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += perlin3(p, period) * a;
    n += a;
    a *= 0.5;
    p *= 2.0;
    period *= 2.0;
  }
  return s / n;
}
float worleyFbm(vec3 p, float period) {
  return worley3(p, period) * 0.625 + worley3(p * 2.0, period * 2.0) * 0.25 + worley3(p * 4.0, period * 4.0) * 0.125;
}
`;

// One slice of the 3D cloud noise; uSlice in [0,1).
export const cloudNoiseFS = `${HEADER}
${UTIL}
${TILING_NOISE}
in vec2 vUV;
uniform float uSlice;
out vec4 oColor;
void main() {
  vec3 p = vec3(vUV, uSlice);
  // fbm of gradient noise has little variance: stretch it so the channels use the whole range
  float pf = saturate(perlinFbm(p * 4.0, 4.0, 5) * 3.2 + 0.5);
  float wf = saturate((worleyFbm(p * 4.0, 4.0) - 0.5) * 2.2 + 0.5);
  // Perlin-Worley: perlin shapes with billowy worley bulges
  float pw = saturate(pf * 0.58 + wf * 0.62 - 0.1);
  float g = saturate((worleyFbm(p * 4.0, 4.0) - 0.5) * 2.0 + 0.5);
  float b = saturate((worleyFbm(p * 8.0, 8.0) - 0.5) * 2.0 + 0.5);
  float a = saturate((worleyFbm(p * 16.0, 16.0) - 0.5) * 2.0 + 0.5);
  oColor = vec4(pw, g, b, a);
}
`;

// 2D weather map: coverage (r), cloud height variation (g)
export const weatherFS = `${HEADER}
${UTIL}
${TILING_NOISE}
in vec2 vUV;
out vec4 oColor;
void main() {
  vec3 p = vec3(vUV, 0.5);
  float c = perlinFbm(p * 5.0, 5.0, 5) * 0.5 + 0.5;
  float w = worley3(vec3(vUV * 9.0, 0.25), 9.0);
  float cov = saturate(remap(c * 0.75 + w * 0.35, 0.40, 0.70, 0.0, 1.0));
  float h = saturate((perlinFbm(p * 3.0 + 7.0, 3.0, 3) * 0.5) * 4.0 + 0.5);
  oColor = vec4(cov, h, c, 1.0);
}
`;

// Water wave normals: height from tiling noise, normal xz in rg (0.5 = flat), height in b
export const waterNormalFS = `${HEADER}
${UTIL}
${TILING_NOISE}
in vec2 vUV;
out vec4 oColor;
float waveH(vec2 uv) {
  vec3 p = vec3(uv, 0.3);
  float h = 0.0;
  h += (1.0 - abs(perlin3(p * 6.0, 6.0))) * 0.5;
  h += (1.0 - abs(perlin3(p * 12.0 + 3.1, 12.0))) * 0.25;
  h += perlin3(p * 24.0 + 1.7, 24.0) * 0.15;
  h += perlin3(p * 48.0 + 5.3, 48.0) * 0.07;
  return h;
}
void main() {
  float e = 1.0 / 256.0;
  float h = waveH(vUV);
  float hx = waveH(vUV + vec2(e, 0.0)) - waveH(vUV - vec2(e, 0.0));
  float hy = waveH(vUV + vec2(0.0, e)) - waveH(vUV - vec2(0.0, e));
  vec3 n = normalize(vec3(-hx * 18.0, -hy * 18.0, 1.0));
  oColor = vec4(n.xy * 0.5 + 0.5, h, 1.0);
}
`;

export { FRAME_UBO };
