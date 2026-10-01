// The sky from high up and from space: the Earth below with its air, clouds, seas and city lights,
// the Moon, Mars, Jupiter, Saturn and its rings, the Sun, the stars and the Milky Way.
//
// The Earth's air is the atmosphere model of common.js (metres, the real Earth); the world's
// blocks are METRES each on that scale (space.js). Two lookup tables make it cheap per pixel:
// the transmittance of the air from any height in any direction (Bruneton's parametrisation,
// computed once) and the light scattered towards the camera from every direction (Hillaire's
// sky-view table, around the camera's own "up" from the Earth's centre, every frame it is needed).
// The space pass renders the whole view into a texture; the lighting and water passes blend it
// over the old sky by altitude (and use it alone in space and on the Moon and Mars).
import { HEADER, FRAME_UBO, UTIL, ATMOSPHERE } from './common.js';
import { CLOUD_FUNCS } from './clouds.js';
import { METRES, TILT } from '../../world/space.js';

const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

export const TRANS_W = 256, TRANS_H = 64;
export const SKYV_W = 192, SKYV_H = 108;

export const SPACE_COMMON = `
const float M_PER_BLOCK = ${f(METRES)};
const float TILT_RAD = ${f(TILT)};
const float TW = ${f(TRANS_W)}, TH = ${f(TRANS_H)};
const float SVW = ${f(SKYV_W)}, SVH = ${f(SKYV_H)};
float unitToSub(float u, float res) { return (u + 0.5 / res) * (res / (res + 1.0)); }
float subToUnit(float u, float res) { return (u - 0.5 / res) * (res / (res - 1.0)); }

// A ray from ro along unit rd against a sphere at the origin: near and far distances, or -1, -1.
// (The closest approach first, which keeps its precision far from the sphere.)
vec2 raySph(vec3 ro, vec3 rd, float R) {
  float b = dot(ro, rd);
  vec3 h = ro - b * rd;
  float d2 = R * R - dot(h, h);
  if (d2 < 0.0) return vec2(-1.0);
  float s = sqrt(d2);
  return vec2(-b - s, -b + s);
}
`;

// --------------------------------------------------------------------- transmittance
const TRANS_LOOKUP = `
uniform sampler2D uTransLut;
vec3 transLut(float r, float mu) {
  float H = sqrt(ATMOS_R * ATMOS_R - PLANET_R * PLANET_R);
  r = clamp(r, PLANET_R, ATMOS_R);
  float rho = sqrt(max(r * r - PLANET_R * PLANET_R, 0.0));
  float disc = r * r * (mu * mu - 1.0) + ATMOS_R * ATMOS_R;
  float d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  float dMin = ATMOS_R - r, dMax = rho + H;
  float xMu = clamp((d - dMin) / max(dMax - dMin, 1.0), 0.0, 1.0);
  float xR = rho / H;
  return texture(uTransLut, vec2(unitToSub(xMu, TW), unitToSub(xR, TH))).rgb;
}
// Sunlight reaching a point p (metres from the Earth's centre) from direction l: through the air,
// and gone once the sun has set behind the Earth (with a soft edge for the sun's disc).
vec3 sunTrans(vec3 p, vec3 l) {
  float r = length(p);
  float mu = dot(p, l) / r;
  float muH = -sqrt(max(1.0 - (PLANET_R * PLANET_R) / (r * r), 0.0));
  float vis = smoothstep(muH - 0.004, muH + 0.004, mu);
  if (r >= ATMOS_R && mu > 0.0) return vec3(1.0);
  return transLut(r, max(mu, muH + 0.001)) * vis;
}
`;

export const transLutFS = `${HEADER}
${UTIL}
${ATMOSPHERE}
${SPACE_COMMON}
in vec2 vUV;
out vec4 oColor;
void main() {
  float xMu = subToUnit(vUV.x, TW), xR = subToUnit(vUV.y, TH);
  float H = sqrt(ATMOS_R * ATMOS_R - PLANET_R * PLANET_R);
  float rho = H * xR;
  float r = sqrt(rho * rho + PLANET_R * PLANET_R);
  float dMin = ATMOS_R - r, dMax = rho + H;
  float d = dMin + xMu * (dMax - dMin);
  float mu = d == 0.0 ? 1.0 : clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
  vec3 ro = vec3(0.0, r, 0.0), rd = vec3(sqrt(max(1.0 - mu * mu, 0.0)), mu, 0.0);
  const int N = 40;
  float dt = d / float(N);
  vec3 od = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * (float(i) + 0.5) * dt;
    od += atmosDensity(length(p) - PLANET_R) * dt;
  }
  oColor = vec4(exp(-(RAY_BETA * od.x + vec3(MIE_EXT) * od.y + OZONE_BETA * od.z)), 1.0);
}
`;

// --------------------------------------------------------------------- the sky-view table
// v: the zenith angle, half the rows above the horizon and half below it, finest near it; u: the
// angle round from the sun's side. The camera may be anywhere, inside the air or far outside it.
const SKYVIEW_MAP = `
vec2 skyViewUV(float r, float viewZenithCos, float lightViewCos) {
  float vHorizon = sqrt(max(r * r - PLANET_R * PLANET_R, 0.0));
  float beta = acos(clamp(vHorizon / r, -1.0, 1.0));
  float zenithHorizon = PI - beta;
  float za = acos(clamp(viewZenithCos, -1.0, 1.0));
  float v;
  if (za <= zenithHorizon) {
    float c = 1.0 - za / zenithHorizon;
    v = 0.5 * (1.0 - sqrt(max(c, 0.0)));
  } else {
    float c = (za - zenithHorizon) / max(beta, 1e-5);
    v = 0.5 + 0.5 * sqrt(max(c, 0.0));
  }
  float u = sqrt(max(0.5 - 0.5 * lightViewCos, 0.0));
  return vec2(unitToSub(u, SVW), unitToSub(v, SVH));
}
`;

export const skyViewFS = `${HEADER}
${FRAME_UBO}
${UTIL}
${ATMOSPHERE}
${SPACE_COMMON}
${TRANS_LOOKUP}
in vec2 vUV;
out vec4 oColor;
uniform vec3 uLutCam;  // camera position from the Earth's centre (metres; any axes)
uniform vec3 uLutSun;  // direction to the sun (same axes)
uniform float uSunIntensity;
uniform vec4 uScatterTune; // x overall scale, y z the rough multiple scattering of Rayleigh and Mie
void main() {
  float r = length(uLutCam);
  vec3 up = uLutCam / r;
  float muS = clamp(dot(uLutSun, up), -1.0, 1.0);
  vec2 uv = vec2(subToUnit(vUV.x, SVW), subToUnit(vUV.y, SVH));
  float vHorizon = sqrt(max(r * r - PLANET_R * PLANET_R, 0.0));
  float beta = acos(clamp(vHorizon / r, -1.0, 1.0));
  float zenithHorizon = PI - beta;
  float za;
  if (uv.y < 0.5) { float c = 1.0 - 2.0 * uv.y; c = 1.0 - c * c; za = zenithHorizon * c; }
  else { float c = uv.y * 2.0 - 1.0; za = zenithHorizon + beta * c * c; }
  float cosL = 1.0 - 2.0 * uv.x * uv.x;
  float sinL = sqrt(max(1.0 - cosL * cosL, 0.0));
  vec3 rd = vec3(sin(za) * cosL, cos(za), sin(za) * sinL);
  vec3 ro = vec3(0.0, r, 0.0);
  vec3 l = vec3(sqrt(max(1.0 - muS * muS, 0.0)), muS, 0.0);

  vec2 ta = raySph(ro, rd, ATMOS_R);
  vec3 sum = vec3(0.0);
  if (ta.y > 0.0) {
    float t0 = max(ta.x, 0.0), t1 = ta.y;
    // (rows below the horizon end on the ground)
    vec2 tg = raySph(ro, rd, PLANET_R);
    if (za > zenithHorizon && tg.x > 0.0) t1 = min(t1, tg.x);
    float mu = dot(rd, l);
    float phR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
    float g = 0.8;
    float phM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-4), 1.5));
    const int N = 30;
    vec3 od = vec3(0.0);
    float len = t1 - t0;
    for (int i = 0; i < N; i++) {
      float s0 = float(i) / float(N), s1 = float(i + 1) / float(N);
      float tA = t0 + len * s0 * s0, tB = t0 + len * s1 * s1;
      float dt = tB - tA;
      vec3 p = ro + rd * (0.5 * (tA + tB));
      vec3 dens = atmosDensity(length(p) - PLANET_R);
      od += dens * dt;
      vec3 tv = exp(-(RAY_BETA * od.x + vec3(MIE_EXT) * od.y + OZONE_BETA * od.z));
      vec3 ts = sunTrans(p, l);
      sum += tv * ts * (RAY_BETA * dens.x * (phR + uScatterTune.y) + vec3(MIE_BETA) * dens.y * (phM + uScatterTune.z)) * dt;
    }
  }
  // (scaled as the old sky table, into balance with the terrain lighting)
  oColor = vec4(sum * uSunIntensity * uScatterTune.x, 1.0);
}
`;

// --------------------------------------------------------------------- the planet's weather
// Cloud cover over the whole Earth (equirectangular, made once): swirls of fronts and storms, a band
// of tall clouds along the equator, clearer skies over the deserts' latitudes.
export const cloudFieldFS = `${HEADER}
${UTIL}
in vec2 vUV;
out vec4 oColor;
uniform float uSeed;
float vn3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = hash13(i), b = hash13(i + vec3(1, 0, 0)), c = hash13(i + vec3(0, 1, 0)), d = hash13(i + vec3(1, 1, 0));
  float e = hash13(i + vec3(0, 0, 1)), f1 = hash13(i + vec3(1, 0, 1)), g = hash13(i + vec3(0, 1, 1)), h = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f1, u.x), mix(g, h, u.x), u.y), u.z);
}
float fbm3c(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += vn3(p) * a; n += a; a *= 0.5; p = p * 2.03 + vec3(1.7, -2.3, 0.9);
  }
  return s / n;
}
void main() {
  float lon = (vUV.x - 0.5) * TAU, lat = (0.5 - vUV.y) * PI;
  vec3 d = vec3(cos(lat) * cos(lon), sin(lat), -cos(lat) * sin(lon));
  vec3 p = d * 3.0 + uSeed;
  // swirls: warp the noise by itself, more so at mid latitudes where storms spin
  float storm = smoothstep(0.35, 0.8, abs(lat)) * smoothstep(1.35, 0.95, abs(lat));
  vec3 w = vec3(fbm3c(p + 11.0, 4), fbm3c(p - 7.0, 4), fbm3c(p + 3.0, 4)) - 0.5;
  vec3 q = p + w * (1.4 + 1.6 * storm);
  q.y *= 1.6; // stretched east-west, as the winds pull them
  float n = fbm3c(q * 1.3, 7);
  float band = 0.16 * exp(-pow(lat / 0.12, 2.0)) - 0.14 * exp(-pow((abs(lat) - 0.4) / 0.12, 2.0)) + 0.06 * storm;
  float cover = smoothstep(0.53, 0.76, n + band);
  // broken up within, and thin wisps between the big systems
  float fine = fbm3c(q * 5.0 + 9.0, 4);
  cover *= smoothstep(0.25, 0.65, fine + 0.15);
  cover = max(cover, smoothstep(0.66, 0.82, fbm3c(q * 4.0 + 5.0, 4)) * 0.3);
  oColor = vec4(cover, n, 0.0, 1.0);
}
`;

// --------------------------------------------------------------------- the view
export const SPACE_FUNCS = `
uniform vec4 uBody[5];      // xyz centre from the camera (blocks, camera axes), w radius (blocks)
uniform mat3 uBodyRot[5];   // columns: the body's axes in camera axes (v * m: into the body's frame)
uniform mat3 uStarRot;      // camera axes -> the celestial frame (m * v)
uniform vec4 uSpace;        // x share of this view, y the body underfoot (0 earth 1 moon 2 mars), z earth maps ready, w time (s)
uniform vec4 uEarthInfo;    // x R cos(tilt) (blocks), y R (blocks), z the sea's code in the map's alpha, w pixel angle
uniform vec4 uNear;         // xy centre (world blocks), z span, w ready
uniform vec4 uMid;          // the same for the wider map
uniform vec3 uSkyIrr[8];    // sky light on the ground with the sun at heights -0.2 .. 1
uniform vec3 uRefXZ;        // xz the world point under the camera (whose weather the clouds near it show), y 1 if valid
uniform vec4 uMoonLight;    // rgb moonlight (illuminance) on the night side
uniform sampler2D uSpaceLut, uEarthMap, uEarthLights, uNearMap, uNearLights, uMidMap, uMoonMap, uMarsMap, uCloudField;

const float SUN_E = 10.0;

vec3 skyIrrAt(float muS) {
  float x = clamp((muS + 0.2) / 1.2, 0.0, 1.0) * 7.0;
  int i = int(floor(min(x, 6.0)));
  float t = x - float(i);
  return mix(uSkyIrr[i], uSkyIrr[i + 1], t);
}

// ---- stars and the Milky Way (celestial frame)
vec3 starsC(vec3 d) {
  vec3 p = d * 190.0;
  vec3 cell = floor(p);
  vec3 h = hash33(cell);
  // more stars in the galaxy's band
  vec3 gal = normalize(vec3(-0.48, 0.81, 0.34));
  float band = exp(-pow(dot(d, gal) / 0.16, 2.0));
  if (h.x < 0.955 - 0.03 * band) return vec3(0.0);
  vec3 ctr = cell + 0.5 + (hash33(cell + 17.0) - 0.5) * 0.5;
  float dist = length(p - ctr);
  float size = mix(0.22, 0.46, pow(h.y, 3.0));
  float star = smoothstep(size, size * 0.2, dist);
  float bright = 0.35 + 3.0 * pow(h.z, 8.0);
  vec3 col = mix(vec3(0.62, 0.74, 1.0), vec3(1.0, 0.86, 0.66), h.y);
  return col * star * bright;
}
vec3 milkyWay(vec3 d) {
  vec3 gal = normalize(vec3(-0.48, 0.81, 0.34));
  float y = dot(d, gal);
  float band = exp(-pow(y / 0.11, 2.0));
  if (band < 0.002) return vec3(0.0);
  vec3 q = d * 9.0;
  float n = vnoise2(q.xz + q.y * 1.7) * 0.5 + vnoise2(q.yz * 2.1 - 3.0) * 0.3 + vnoise2(q.xy * 4.3 + 1.0) * 0.2;
  // dark lanes of dust down the middle
  float lane = smoothstep(0.03, 0.0, abs(y + (n - 0.5) * 0.05)) * 0.7;
  vec3 core = normalize(vec3(0.62, -0.18, -0.76));
  float bulge = pow(max(dot(d, core), 0.0), 6.0);
  vec3 c = mix(vec3(0.55, 0.62, 0.85), vec3(1.0, 0.85, 0.62), bulge);
  return c * band * (0.25 + 0.75 * n) * (1.0 - lane) * (0.6 + 2.2 * bulge);
}

vec3 sunDiskSpace(vec3 dir, vec3 sun) {
  float cosS = dot(dir, sun);
  float ang = acos(clamp(cosS, -1.0, 1.0)) / 0.0105;
  vec3 c = vec3(0.0);
  if (ang < 1.2) {
    float disk = smoothstep(1.0, 0.92, ang);
    float mu = sqrt(max(1.0 - ang * ang, 0.0));
    float limb = 1.0 - 0.55 * (1.0 - pow(mu, 0.6));
    c += vec3(1.0, 0.97, 0.92) * SUN_E * 700.0 * disk * limb;
  }
  // the corona and glare, which out here no sky drowns
  c += vec3(1.0, 0.93, 0.82) * SUN_E * (0.6 * exp(-ang * 0.9) + 0.04 * exp(-ang * 0.12)) * 0.05;
  return c;
}

// ---- texturing a body: its frame's longitude and latitude of a direction from its centre
vec2 lonLat(vec3 nBody) {
  return vec2(atan(-nBody.z, nBody.x), asin(clamp(nBody.y, -1.0, 1.0)));
}
vec2 eqUV(vec2 ll) { return vec2(ll.x / TAU + 0.5, 0.5 - ll.y / PI); }
// the east and north directions (camera axes) at a place of body i
void tangents(int i, vec2 ll, out vec3 E, out vec3 Nn) {
  float so = sin(ll.x), co = cos(ll.x), sl = sin(ll.y), cl = cos(ll.y);
  E = uBodyRot[i] * vec3(-so, 0.0, -co);
  Nn = uBodyRot[i] * vec3(-sl * co, cl, sl * so);
}

// The Moon: grey dust that lights as the real regolith does (Lommel-Seeliger: as bright at the
// edge as the middle when full), the relief of its craters from the map's heights.
// A body's ground (the Moon's or Mars's): its map, or near the player the finer square of it,
// with the relief from the heights a texel east and north. which: 2 the Moon, 3 Mars.
vec4 bodyGround(int i, float which, sampler2D map, vec3 N, float footprint, out vec3 n) {
  vec3 nb = N * uBodyRot[i];
  vec2 ll = lonLat(nb);
  vec2 uv = eqUV(ll);
  float R = uBody[i].w;
  float texel = TAU * R / 1024.0;
  float lod = clamp(log2(max(footprint / texel, 1.0)), 0.0, 9.0);
  vec4 m = textureLod(map, uv, lod);
  float o = exp2(lod) / 1024.0;
  float hE = textureLod(map, uv + vec2(o, 0.0), lod).a - m.a;
  float hN = textureLod(map, uv - vec2(0.0, o * 2.0), lod).a - m.a;
  float step = texel * exp2(lod);
  if (abs(uNear.w - which) < 0.5) {
    vec2 xz = vec2(ll.x, -ll.y) * R;
    vec2 nuv = (xz - uNear.xy) / uNear.z + 0.5;
    float nt = uNear.z / 512.0;
    float edge = min(min(nuv.x, 1.0 - nuv.x), min(nuv.y, 1.0 - nuv.y));
    float w = smoothstep(0.0, 0.08, edge) * (1.0 - smoothstep(nt * 0.9, nt * 3.0, footprint));
    if (w > 0.0) {
      float nl = clamp(log2(max(footprint / nt, 1.0)), 0.0, 9.0);
      float ns = nt * exp2(nl);
      vec4 q = textureLod(uNearMap, nuv, nl);
      float qE = textureLod(uNearMap, nuv + vec2(ns / uNear.z, 0.0), nl).a - q.a;
      float qN = textureLod(uNearMap, nuv - vec2(0.0, ns / uNear.z), nl).a - q.a;
      m = mix(m, q, w);
      hE = mix(hE, qE, w); hN = mix(hN, qN, w);
      step = mix(step, ns, w);
    }
  }
  vec3 E, Nn; tangents(i, ll, E, Nn);
  float k = 248.0 / max(step, 1.0) * 1.3;
  n = normalize(N - (E * hE + Nn * hN) * k);
  return m;
}

vec3 shadeMoon(vec3 P, vec3 N, vec3 V, vec3 sun, float footprint) {
  vec3 n;
  vec4 m = bodyGround(1, 2.0, uMoonMap, N, footprint, n);
  vec3 albedo = srgbToLinear(m.rgb) * 0.8; // (as its blocks; dark grey that looks bright against the black)
  float mu0 = max(dot(n, sun), 0.0), mu = max(dot(n, V), 0.02);
  float ls = mu0 / (mu0 + mu) * 2.0;
  // a little earthshine on the night side
  return albedo * (SUN_E / PI * ls * smoothstep(-0.02, 0.05, dot(N, sun)) + 0.004);
}

// Mars: rust-red ground under a thin dusty sky
vec3 shadeMars(vec3 P, vec3 N, vec3 V, vec3 sun, float footprint) {
  vec3 n;
  vec4 m = bodyGround(2, 3.0, uMarsMap, N, footprint, n);
  vec3 albedo = srgbToLinear(m.rgb);
  float sunE = SUN_E * 0.43; // half again as far from the sun
  float lit = max(dot(n, sun), 0.0) * smoothstep(-0.05, 0.08, dot(N, sun));
  return albedo * (sunE / PI * lit + sunE * 0.025 * smoothstep(-0.15, 0.2, dot(N, sun)) * vec3(0.9, 0.7, 0.55));
}

float wrapAng(float a) { return a - TAU * floor((a + PI) / TAU); }

// Jupiter and Saturn: bands of cloud
vec3 shadeGiant(int i, vec3 N, vec3 V, vec3 sun) {
  vec3 nb = N * uBodyRot[i];
  vec2 ll = lonLat(nb);
  float lat = ll.y;
  float t = uSpace.w * 0.002;
  float turb = vnoise2(vec2(ll.x * 6.0 + t, lat * 30.0)) * 0.5 + vnoise2(vec2(ll.x * 17.0 - t * 2.0, lat * 80.0)) * 0.25;
  vec3 c;
  if (i == 3) {
    float b = sin(lat * 22.0 + turb * 2.2) * 0.5 + 0.5;
    c = mix(vec3(0.82, 0.74, 0.62), vec3(0.62, 0.42, 0.28), b * b);
    c = mix(c, vec3(0.92, 0.88, 0.80), smoothstep(0.7, 1.0, sin(lat * 9.0 + 1.3) * 0.5 + 0.5) * 0.5);
    // the great red spot
    vec2 gs = vec2(wrapAng(ll.x - 1.2) * 0.9, (lat + 0.39) * 3.6);
    float spot = smoothstep(0.16, 0.08, length(gs));
    c = mix(c, vec3(0.72, 0.34, 0.22), spot);
  } else {
    float b = sin(lat * 18.0 + turb * 1.2) * 0.5 + 0.5;
    c = mix(vec3(0.86, 0.78, 0.58), vec3(0.74, 0.64, 0.44), b);
  }
  float sunE = i == 3 ? SUN_E * 0.037 : SUN_E * 0.011; // (but drawn brighter than true, to be seen)
  sunE *= 6.0;
  float mu0 = dot(N, sun), mu = max(dot(N, V), 0.0);
  float limb = 0.55 + 0.45 * pow(mu, 0.4);
  return srgbToLinear(c) * sunE / PI * max(mu0, 0.0) * limb;
}

// Saturn's rings: a radial profile (the C ring, the bright B ring, the Cassini division, the A ring)
vec4 saturnRings(vec3 dir, float tMax, vec3 sun) {
  vec3 c = uBody[4].xyz;
  float R = uBody[4].w;
  vec3 n = uBodyRot[4][1]; // its pole
  float dn = dot(dir, n);
  if (abs(dn) < 1e-6) return vec4(0.0);
  float t = dot(c, n) / dn;
  if (t <= 0.0 || t > tMax) return vec4(0.0);
  vec3 q = dir * t - c;
  float rr = length(q) / R;
  if (rr < 1.24 || rr > 2.27) return vec4(0.0);
  float a = 0.0;
  a += smoothstep(1.24, 1.3, rr) * (1.0 - smoothstep(1.5, 1.53, rr)) * 0.25;   // C
  a += smoothstep(1.52, 1.56, rr) * (1.0 - smoothstep(1.94, 1.95, rr)) * 0.9;  // B
  a += smoothstep(2.02, 2.03, rr) * (1.0 - smoothstep(2.26, 2.27, rr)) * 0.6;  // A
  a *= 1.0 - smoothstep(0.0, 0.004, 0.004 - abs(rr - 2.214)) * 0.8;            // Encke gap
  a *= 0.8 + 0.2 * vnoise2(vec2(rr * 600.0, 0.5));
  // the planet's shadow across the rings
  vec2 sh = raySph(q, sun, R);
  float lit = sh.y > 0.0 ? 0.08 : 1.0;
  vec3 col = srgbToLinear(mix(vec3(0.72, 0.66, 0.54), vec3(0.88, 0.82, 0.68), smoothstep(1.6, 1.9, rr)));
  return vec4(col * SUN_E * 0.011 * 6.0 / PI * (0.35 + 0.65 * abs(dot(sun, n))) * lit, a);
}
`;

// The Earth's surface and clouds, and the air in front of them.
export const EARTH_FUNCS = `
const float CLOUD_ALT = 250.0; // blocks above the sea: the middle of the game's cloud layer

// where on the world's map a direction from the Earth's centre falls (body frame)
vec2 worldXZ(vec2 ll) {
  return vec2(ll.x * uEarthInfo.x, (TILT_RAD - ll.y) * uEarthInfo.y);
}

// The ground's colour (sRGB) and height code: the finest map that covers the place.
vec4 earthTexel(vec2 ll, vec2 xz, float footprint, out float level, out vec4 lights) {
  float texelG = uEarthInfo.x * TAU / 2048.0;
  vec2 uvG = eqUV(ll);
  float lodG = clamp(log2(max(footprint / texelG, 1.0)), 0.0, 11.0);
  vec4 c = textureLod(uEarthMap, uvG, lodG);
  lights = vec4(textureLod(uEarthLights, uvG, lodG).r * 0.35); // (a whole village in a texel)
  level = 0.0;
  if (uMid.w > 0.5) {
    vec2 uv = (xz - uMid.xy) / uMid.z + 0.5;
    float texel = uMid.z / 512.0;
    float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float w = smoothstep(0.0, 0.08, edge) * (1.0 - smoothstep(texel * 0.9, texel * 2.5, footprint));
    if (w > 0.0) {
      c = mix(c, textureLod(uMidMap, uv, clamp(log2(max(footprint / texel, 1.0)), 0.0, 9.0)), w);
      level = w;
    }
  }
  if (uNear.w > 0.5 && uNear.w < 1.5) {
    vec2 uv = (xz - uNear.xy) / uNear.z + 0.5;
    float texel = uNear.z / 512.0;
    float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float w = smoothstep(0.0, 0.08, edge) * (1.0 - smoothstep(texel * 0.9, texel * 3.0, footprint));
    if (w > 0.0) {
      float lod = clamp(log2(max(footprint / texel, 1.0)), 0.0, 9.0);
      c = mix(c, textureLod(uNearMap, uv, lod), w);
      lights = mix(lights, vec4(textureLod(uNearLights, uv, lod).r), w);
      level = 1.0 + w;
    }
  }
  return c;
}

// cloud cover at a place: near the camera the game's own clouds (the weather map, as the
// volumetric clouds have them), further off the planet's weather
float earthCloud(vec2 ll, vec2 xz) {
  float far = texture(uCloudField, eqUV(vec2(ll.x - uSpace.w * 0.00004, ll.y))).r;
  // the clouds' own fine noise (as the volumetric clouds) breaks up their edges
  vec2 np = (xz + uCloudParams.zw) * CLOUD_SCALE;
  float n = textureLod(uNoise3D, vec3(np.x, 0.37, np.y), 1.0).r;
  float n2 = textureLod(uNoise3D, vec3(np.x * 0.21 + 0.3, 0.61, np.y * 0.21), 0.0).g;
  far = clamp(far * (0.55 + 0.75 * n2) - 0.08, 0.0, 1.0);
  if (uRefXZ.y < 0.5) return far;
  // near the camera, while its own clouds could show, the game's weather
  float d = length(xz - uRefXZ.xz);
  float wNear = (1.0 - smoothstep(5000.0, 14000.0, d)) * (1.0 - smoothstep(1800.0, 4500.0, uCamPos.y));
  if (wNear <= 0.0) return far;
  vec4 w = textureLod(uWeatherMap, (xz + uCloudParams.zw * 0.6) * WEATHER_SCALE, 0.0);
  float near = coverageFrom(w.r) * (0.75 + 0.35 * n);
  return mix(far, near, wNear);
}

// Lights of villages at night: points, a few blocks across, in the places the maps say there
// are villages (seen from far, a faint glow)
float villageLights(float density, vec2 xz, float footprint) {
  if (density <= 0.002) return 0.0;
  const float CELL = 22.0;
  vec2 c = floor(xz / CELL);
  vec2 f = xz / CELL - c;
  vec3 h = hash33(vec3(c, 7.0));
  float lit = step(1.0 - density * 0.85, h.x);
  float d = length(f - (0.25 + 0.5 * h.yz)) * CELL;
  float point = smoothstep(2.6, 0.6, d) * lit;
  // a point smaller than the pixel shows as its share of it
  float avg = density * 0.85 * 0.03;
  return mix(point, avg, smoothstep(CELL * 0.25, CELL * 1.2, footprint)) * (0.6 + 0.8 * h.z);
}

// The ground at a point P (metres from the Earth's centre, camera axes) seen along dir.
vec3 shadeEarthGround(vec3 P, vec3 dir, vec3 sun, float tCam) {
  vec3 N = normalize(P);
  vec3 nb = N * uBodyRot[0];
  vec2 ll = lonLat(nb);
  vec2 xz = worldXZ(ll);
  float cosV = max(dot(N, -dir), 0.06);
  float footprint = tCam / M_PER_BLOCK * uEarthInfo.w / cosV;
  float level;
  vec4 lights;
  vec4 m = earthTexel(ll, xz, footprint, level, lights);
  // relief from the heights around (a texel east and north, of the map it came from)
  float texel = level > 1.0 ? uNear.z / 512.0 : level > 0.0 ? uMid.z / 512.0 : uEarthInfo.x * TAU / 2048.0;
  texel = max(texel, footprint);
  vec2 llE = ll + vec2(texel / uEarthInfo.x, 0.0), llN = ll + vec2(0.0, texel / uEarthInfo.y);
  float l2; vec4 lt;
  float hE = (earthTexel(llE, worldXZ(llE), footprint, l2, lt).a - m.a) * 248.0 / texel;
  float hN = (earthTexel(llN, worldXZ(llN), footprint, l2, lt).a - m.a) * 248.0 / texel;
  vec3 E, Nn; tangents(0, ll, E, Nn);
  float sea = uEarthInfo.z;
  float water = smoothstep(sea + 0.4 / 255.0, sea - 0.6 / 255.0, m.a);
  vec3 n = normalize(N - (E * hE + Nn * hN) * (1.0 - water) * 1.5);
  vec3 albedo = srgbToLinear(m.rgb);
  float muS = dot(N, sun);
  vec3 sunC = sunTrans(P, sun) * SUN_E;
  // the clouds' shadows
  vec2 llS = lonLat(normalize(P + sun * (CLOUD_ALT * M_PER_BLOCK / max(muS, 0.15))) * uBodyRot[0]);
  float cs = earthCloud(llS, worldXZ(llS));
  sunC *= 1.0 - 0.7 * smoothstep(0.1, 0.9, cs);
  vec3 sky = skyIrrAt(muS);
  vec3 col = albedo * (sunC * max(dot(n, sun), 0.0) / PI + sky);
  if (water > 0.0) {
    // the sea: the sun's glitter (GGX on waves) and the sky in it
    vec3 V = -dir;
    vec3 H = normalize(sun + V);
    float NdH = max(dot(N, H), 0.0), NdV = max(dot(N, V), 1e-3), NdL = max(dot(N, sun), 0.0);
    float a2 = 0.035;
    float dd = NdH * NdH * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * dd * dd);
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
    float spec = D * F / max(4.0 * NdV, 1e-3) * NdL;
    float Fv = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    vec3 wcol = albedo * (sunC * NdL / PI * 0.6 + sky) + sunC * spec + sky * Fv * 1.4;
    col = mix(col, wcol, water);
  }
  // the night side: moonlight, and villages' lights
  float night = smoothstep(0.03, -0.12, muS);
  col += albedo * uMoonLight.rgb * max(dot(n, uMoonDir.xyz), 0.0) / PI * night;
  col += vec3(1.0, 0.68, 0.36) * villageLights(lights.r, xz, footprint) * night * 1.6;
  return col;
}

// The cloud layer at a point on its shell (metres from the centre): colour and cover.
vec4 shadeEarthCloud(vec3 Pc, vec3 dir, vec3 sun) {
  vec3 N = normalize(Pc);
  vec2 ll = lonLat(N * uBodyRot[0]);
  float c = earthCloud(ll, worldXZ(ll));
  float a = smoothstep(0.03, 0.75, c) * 0.96;
  if (a <= 0.001) return vec4(0.0);
  float muS = dot(N, sun);
  vec3 sunC = sunTrans(Pc, sun) * SUN_E;
  // thick clouds are darker on the side away from the sun, bright where it shines through
  float side = 0.55 + 0.45 * smoothstep(-0.2, 0.6, muS);
  vec3 col = vec3(0.92) * (sunC * max(muS, 0.0) / PI * side + skyIrrAt(muS) * 1.2 + sunC * 0.03 * hgPhase(dot(dir, sun), 0.6)
    + uMoonLight.rgb * max(dot(N, uMoonDir.xyz), 0.0) / PI * smoothstep(0.05, -0.1, muS));
  return vec4(col, a);
}
`;

export const spaceFS = `${HEADER}
${FRAME_UBO}
${UTIL}
${ATMOSPHERE}
${CLOUD_FUNCS}
${SPACE_COMMON}
${TRANS_LOOKUP}
${SKYVIEW_MAP}
${SPACE_FUNCS}
${EARTH_FUNCS}
in vec2 vUV;
out vec4 oColor;

// Mars's thin, dusty air: the sky's butterscotch, blue around a low sun, the haze over its ground
// and the faint ring of it seen from space. h: the height of the ray's lowest point (blocks).
vec4 marsAir(vec3 ro, vec3 dir, vec3 sun, float tEnd, out vec3 trans) {
  float R = uBody[2].w;
  vec3 c = uBody[2].xyz;
  vec3 rel = -c;
  float H = 220.0;   // scale height (blocks)
  float TAU0 = 640.0; // blocks of air at the ground's density to one optical depth (dust: ~0.35 straight up)
  float top = R + 2200.0;
  vec2 ta = raySph(rel, dir, top);
  trans = vec3(1.0);
  if (ta.y <= 0.0) return vec4(0.0);
  float t0 = max(ta.x, 0.0), t1 = min(ta.y, tEnd);
  if (t1 <= t0) return vec4(0.0);
  float od = 0.0;
  vec3 ins = vec3(0.0);
  const int N = 10;
  float len = t1 - t0;
  float mu = dot(dir, sun);
  // dust scatters forwards (a bright, bluish glow round the sun) and a tan light all over
  float fwd = pow(max(mu, 0.0), 60.0) * 3.0 + pow(max(mu, 0.0), 10.0) * 0.45;
  for (int i = 0; i < N; i++) {
    float s0 = float(i) / float(N), s1 = float(i + 1) / float(N);
    float ta2 = t0 + len * s0 * s0, tb2 = t0 + len * s1 * s1;
    float dt = tb2 - ta2;
    vec3 p = rel + dir * (0.5 * (ta2 + tb2));
    float r = length(p);
    float dens = exp(-(r - R) / H);
    float muS = dot(p / r, sun);
    float lit = smoothstep(-0.12, 0.06, muS);
    // sunlight through the dust above this point: redder and dimmer as the sun gets low
    float tauSun = 0.5 * exp(-(r - R) / H) / max(muS + 0.12, 0.04);
    vec3 tsun = exp(-tauSun * vec3(0.75, 1.0, 1.35));
    float dTau = dens * dt / TAU0;
    // (the dust's forward scattering favours blue: a blue glow round a setting sun)
    vec3 col = vec3(0.78, 0.55, 0.36) * 0.13 * tsun + vec3(0.3, 0.5, 1.0) * fwd * 0.3 * mix(tsun, vec3(1.0), 0.75);
    ins += col * lit * dTau * exp(-od);
    od += dTau;
  }
  trans = exp(-od * vec3(0.9, 1.0, 1.12));
  return vec4(ins * SUN_E * 0.43, 1.0);
}

void main() {
  vec3 rel = reconstructRel(vUV, 1.0);
  vec3 dir = normalize(rel);
  vec3 sun = uSunDir.xyz;
  vec3 C = uStarRot * dir;
  vec3 col = (starsC(C) * 0.045 + milkyWay(C) * 0.0035);
  col += sunDiskSpace(dir, sun);
  float tBest = 1e30; // blocks
  // ---- the Moon, Mars, Jupiter, Saturn
  for (int i = 1; i < 5; i++) {
    vec3 c = uBody[i].xyz;
    float R = uBody[i].w;
    vec2 t = raySph(-c, dir, R);
    if (t.y > 0.0 && t.x > 0.0 && t.x < tBest) {
      vec3 P = dir * t.x - c;
      vec3 N = P / R;
      float footprint = t.x * uEarthInfo.w / max(dot(N, -dir), 0.08);
      vec3 s;
      if (i == 1) s = shadeMoon(P, N, -dir, sun, footprint);
      else if (i == 2) s = shadeMars(P, N, -dir, sun, footprint);
      else s = shadeGiant(i, N, -dir, sun);
      col = s;
      tBest = t.x;
    }
  }
  vec4 ring = saturnRings(dir, tBest, sun);
  col = mix(col, ring.rgb, ring.a);
  // ---- Mars's air (thin; only near it is there any to see)
  if (length(uBody[2].xyz) < uBody[2].w * 6.0) {
    vec3 tr;
    vec4 ma = marsAir(vec3(0.0), dir, sun, tBest, tr);
    col = col * tr + ma.rgb;
  }
  // ---- the Earth, its clouds and its air
  vec3 roM = -uBody[0].xyz * M_PER_BLOCK;
  vec2 ta = raySph(roM, dir, ATMOS_R);
  if (ta.y > 0.0 && max(ta.x, 0.0) < tBest * M_PER_BLOCK) {
    float r = length(roM);
    vec3 up = roM / r;
    float vz = dot(dir, up);
    float vHorizon = sqrt(max(r * r - PLANET_R * PLANET_R, 0.0));
    bool ground = vz < -vHorizon / r;
    vec2 tg = raySph(roM, dir, PLANET_R);
    float t0 = max(ta.x, 0.0);
    vec3 pe = roM + dir * t0;
    float re = length(pe), mue = dot(pe, dir) / re;
    vec3 T;
    if (ground && tg.x > 0.0 && tg.x < tBest * M_PER_BLOCK) {
      vec3 P = roM + dir * tg.x;
      col = shadeEarthGround(P, dir, sun, tg.x);
      float mug = dot(P, dir) / PLANET_R;
      T = clamp(transLut(PLANET_R, -mug) / max(transLut(re, -mue), vec3(1e-6)), 0.0, 1.0);
      tBest = tg.x / M_PER_BLOCK;
    } else {
      T = transLut(re, mue);
    }
    // the cloud layer, where the ray crosses it before the ground
    vec2 tc = raySph(roM, dir, PLANET_R + CLOUD_ALT * M_PER_BLOCK);
    float tcl = tc.x > 0.0 ? tc.x : tc.y;
    if (tc.y > 0.0 && tcl > 0.0 && tcl < tBest * M_PER_BLOCK) {
      vec4 cl = shadeEarthCloud(roM + dir * tcl, dir, sun);
      col = mix(col, cl.rgb, cl.a);
    }
    // the air in front: its light, and how much of what is behind gets through
    vec3 sunP = sun - up * dot(sun, up);
    vec3 dP = dir - up * vz;
    float lightViewCos = dot(normalize(dP + 1e-7), normalize(sunP + 1e-7));
    vec3 ins = texture(uSpaceLut, skyViewUV(r, vz, lightViewCos)).rgb;
    col = col * T + ins;
  }
  oColor = vec4(col, 1.0);
}
`;
