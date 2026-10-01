// Space: the Earth this world is the surface of, the Moon, Mars, Jupiter, Saturn and the Sun --
// where they are, how they turn, and how a place on each one maps onto the blocks you walk on.
//
// Frames (right-handed; a frame is its three axes as vectors in C):
//  - C, the celestial frame: the Earth's centre at the origin, +Y its north pole, the Sun far off
//    along +X (always: there is no year), the stars fixed.
//  - a body's own frame: x on its equator at longitude 0, y its north pole. Longitude grows
//    eastwards, lon = atan2(-z, x) in those axes.
//  - a local frame on a world you stand on: x east, y up, z south (in the game's blocks -z is north).
//
// The overworld is a flat map of the Earth: lon = x / (R cos TILT), lat = TILT - z / R. Its middle
// lies at latitude TILT, where the game's sun has always been seen from (it crosses the sky tilted
// by TILT: the sky of an equinox there). Its sky is that of the middle wherever you are on the map,
// so the Earth's own frame is chosen for where you stand (earthFrameAt): the ground under you is
// the right place on the map, the sun where the sky shows it. The Moon and Mars are mapped
// lon = x / R, lat = -z / R, their middles on their equators.

export const TILT = 0.42; // the renderer's sun tilt
// The Earth is the real one at a block to 50 m: 6360 km, its air thinning out 100 km up (where
// space begins, as the game's flying reaches it).
export const METRES = 50; // per block, for the planet's air
export const EARTH_R = 127200; // blocks
export const SPACE_ALT = 2000; // blocks above the sea: the top of the air, where space begins
export const SUN_RADIUS = 0.0105; // the sun's angular radius in the sky (as the game always drew it)

// R radius; d distance from the Earth; elong angle east of the Sun (seen from the Earth), lift
// angle out of the Earth's equator; g gravity as a share of the Earth's; top where space begins
// above its surface (blocks); base the height of its surface datum in its dimension. The Moon is
// as large in the sky as the game's moon has always been (so nearer than the real one), the
// planets much nearer than theirs, so they can be flown to.
export const BODIES = {
  earth: { R: EARTH_R, g: 1, top: SPACE_ALT, dim: 0 },
  moon: { R: 34700, d: 2.57e6, incl: 0.105, g: 1 / 6, top: 1500, base: 100, dim: 4 },
  mars: { R: 67800, d: 2.5e7, elong: 2.62, lift: 0.04, g: 0.38, top: 1800, base: 90, dim: 5, tilt: 0.44 },
  // (no ground: a station floats high over their clouds, at [lon, lat], with gravity of its own;
  // base is the cloud tops, 380 blocks under its deck)
  jupiter: { R: 1.425e6, d: 1.8e8, elong: 1.75, lift: -0.02, tilt: 0.05, g: 1, top: 1500, base: -260, dim: 6, station: [1.2, -0.37] },
  saturn: { R: 1.2e6, d: 3.5e8, elong: -2.18, lift: 0.03, tilt: 0.47, rings: [1.24, 2.27], g: 1, top: 1500, base: -260, dim: 7, station: [0.4, 0.42] },
};
export const BODY_NAMES = ['earth', 'moon', 'mars', 'jupiter', 'saturn'];
export const DIM_BODY = { 0: 'earth', 4: 'moon', 5: 'mars', 6: 'jupiter', 7: 'saturn' };

// ------------------------------------------------------------------ vectors and frames
export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
const { add, sub, scale, dot, cross, len, norm } = v3;

export const IDENTITY = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
// a vector given in frame f, in C; and a C vector in f
export const toC = (f, v) => [
  f.x[0] * v[0] + f.y[0] * v[1] + f.z[0] * v[2],
  f.x[1] * v[0] + f.y[1] * v[1] + f.z[1] * v[2],
  f.x[2] * v[0] + f.y[2] * v[1] + f.z[2] * v[2],
];
export const fromC = (f, v) => [dot(f.x, v), dot(f.y, v), dot(f.z, v)];
// the frame g's axes expressed in frame f (so that toC(g, v) = toC(f, toC(rel, v)))
export const relFrame = (f, g) => ({ x: fromC(f, g.x), y: fromC(f, g.y), z: fromC(f, g.z) });
// column-major mat3 taking vectors in f to vectors in C (for a shader)
export const mat3Of = (f) => [...f.x, ...f.y, ...f.z];

// rotation of v about the unit axis k by angle a
export function rotate(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), d = dot(k, v);
  const kv = cross(k, v);
  return [v[0] * c + kv[0] * s + k[0] * d * (1 - c), v[1] * c + kv[1] * s + k[1] * d * (1 - c), v[2] * c + kv[2] * s + k[2] * d * (1 - c)];
}
export const rotateFrame = (f, k, a) => ({ x: rotate(f.x, k, a), y: rotate(f.y, k, a), z: rotate(f.z, k, a) });

// Gram-Schmidt: keeps a frame that drifted (from blending) a rotation
export function orthonormal(f) {
  const y = norm(f.y);
  let x = sub(f.x, scale(y, dot(f.x, y)));
  x = norm(x);
  const z = cross(x, y);
  return { x, y, z };
}

// A frame part way from a towards b (t 0..1): enough for the slow re-levelling in flight.
export function blendFrame(a, b, t) {
  const m = (p, q) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  return orthonormal({ x: m(a.x, b.x), y: m(a.y, b.y), z: m(a.z, b.z) });
}

// ------------------------------------------------------------------ places on a body
// The local axes (east, up, south) at (lon, lat), in the body frame's terms.
function localInBody(lon, lat) {
  const cl = Math.cos(lat), sl = Math.sin(lat), co = Math.cos(lon), so = Math.sin(lon);
  return { x: [-so, 0, -co], y: [cl * co, sl, -cl * so], z: [sl * co, -cl, -sl * so] };
}
// ... and in C, for a body whose frame is bf
export function localFrame(bf, lon, lat) {
  const l = localInBody(lon, lat);
  return { x: toC(bf, l.x), y: toC(bf, l.y), z: toC(bf, l.z) };
}
// the direction of (lon, lat) from the body's centre, in the body frame
export function dirOf(lon, lat) {
  const cl = Math.cos(lat);
  return [cl * Math.cos(lon), Math.sin(lat), -cl * Math.sin(lon)];
}
// a direction in the body frame -> [lon, lat]
export function lonLatOf(v) {
  const l = len(v) || 1;
  return [Math.atan2(-v[2], v[0]), Math.asin(Math.max(-1, Math.min(1, v[1] / l)))];
}

// blocks <-> longitude and latitude
// (a station's world is a little map around where it floats)
export function worldToLonLat(body, x, z) {
  if (body === 'earth') return [x / (EARTH_R * Math.cos(TILT)), TILT - z / EARTH_R];
  const b = BODIES[body], R = b.R;
  if (b.station) return [b.station[0] + x / (R * Math.cos(b.station[1])), b.station[1] - z / R];
  return [x / R, -z / R];
}
export function lonLatToWorld(body, lon, lat) {
  if (body === 'earth') return [wrapAngle(lon) * EARTH_R * Math.cos(TILT), (TILT - lat) * EARTH_R];
  const b = BODIES[body], R = b.R;
  if (b.station) return [wrapAngle(lon - b.station[0]) * R * Math.cos(b.station[1]), (b.station[1] - lat) * R];
  return [wrapAngle(lon) * R, -lat * R];
}
export function wrapAngle(a) {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

// ------------------------------------------------------------------ time and orbits
// T: days since the world began (dayCount + dayTime). The Moon goes round once in eight days,
// full on the first night (as the game's phases always were).
export const moonPhase = (T) => ((((T + 3.25) % 8) + 8) % 8) / 8;

// The Moon's direction from the Earth: E east of the Sun, in an orbit tilted out of the equator
// (so it is neither eclipsed when full nor in front of the Sun when new).
function moonDir(T) {
  const E = moonPhase(T) * 2 * Math.PI, i = BODIES.moon.incl;
  return [Math.cos(E) * Math.cos(i), Math.cos(E) * Math.sin(i), -Math.sin(E)];
}
const MOON_POLE = [-Math.sin(BODIES.moon.incl), Math.cos(BODIES.moon.incl), 0];

function fixedPos(b) {
  return scale([Math.cos(b.elong) * Math.cos(b.lift), Math.sin(b.lift), -Math.sin(b.elong) * Math.cos(b.lift)], b.d);
}
const POS = { mars: fixedPos(BODIES.mars), jupiter: fixedPos(BODIES.jupiter), saturn: fixedPos(BODIES.saturn) };

export function bodyPos(name, T) {
  if (name === 'earth') return [0, 0, 0];
  if (name === 'moon') return scale(moonDir(T), BODIES.moon.d);
  return POS[name];
}

// The Earth's frame when it is not seen from the overworld (from space, with the same turn the
// overworld gives it at the world's middle). Spin: once a day, eastwards.
export function earthFrameStd(T) {
  const th = 2 * Math.PI * T - Math.PI / 2;
  return { x: [Math.cos(th), 0, -Math.sin(th)], y: [0, 1, 0], z: [Math.sin(th), 0, Math.cos(th)] };
}

// A frame turned eastwards about C's +Y by the Earth's spin over dT days.
export const spinEarth = (f, dT) => rotateFrame(f, [0, 1, 0], 2 * Math.PI * dT);

// The local frame of the overworld's sky at time T: the world's middle latitude, local solar time
// as the game's clock (dayTime 0 sunrise, 0.25 noon).
export function overworldFrame(T) {
  return localFrame(IDENTITY, 2 * Math.PI * T - Math.PI / 2, TILT);
}

// The Earth's frame for someone at (x, z) of the overworld at time T: the ground under them is
// (x, z)'s place on the map, and their sky the overworld's.
export function earthFrameAt(x, z, T) {
  const [lon, lat] = worldToLonLat('earth', x, z);
  const L = overworldFrame(T); // the local axes in C
  const P = localInBody(lon, lat); // the same axes in the Earth's frame
  // Q takes body coordinates to C: Q = L * P^T (columns of L are the local axes in C)
  const col = (k) => add(add(scale(L.x, P.x[k]), scale(L.y, P.y[k])), scale(L.z, P.z[k]));
  return { x: col(0), y: col(1), z: col(2) };
}

export function moonFrame(T) {
  const x = scale(moonDir(T), -1); // the near side faces the Earth
  const y = MOON_POLE;
  return orthonormal({ x, y, z: cross(x, y) });
}

// Mars, Jupiter and Saturn turn about tilted axes; Mars once a day, as Earth (a sol is almost a day).
function tiltedFrame(b, spin) {
  const ax = norm([Math.sin(b.tilt), Math.cos(b.tilt), 0.25 * Math.sin(b.tilt)]);
  const ref = norm(cross(ax, [0, 0, 1]));
  const f0 = { x: ref, y: ax, z: cross(ref, ax) };
  return rotateFrame(f0, ax, spin);
}
export function bodyFrame(name, T, earth = null) {
  if (name === 'earth') return earth || earthFrameStd(T);
  if (name === 'moon') return moonFrame(T);
  if (name === 'mars') return tiltedFrame(BODIES.mars, 2 * Math.PI * T * 0.973 + 1.1);
  if (name === 'jupiter') return tiltedFrame(BODIES.jupiter, 2 * Math.PI * T * 2.4);
  if (name === 'saturn') {
    // the rings open towards the Earth by the axial tilt
    const b = BODIES.saturn, s = norm(POS.saturn);
    const ax = norm(add(scale([0, 1, 0], Math.cos(b.tilt)), scale(norm([s[0], 0, s[2]]), Math.sin(b.tilt))));
    const ref = norm(cross(ax, [0, 0, 1]));
    return rotateFrame({ x: ref, y: ax, z: cross(ref, ax) }, ax, 2 * Math.PI * T * 2.2);
  }
  return IDENTITY;
}

// The Sun lies along +X of C.
export const SUN_DIR = [1, 0, 0];

// ------------------------------------------------------------------ where you are
// In space: the body whose surface is nearest, its distance and the height above that surface.
export function nearestBody(posC, T) {
  let best = null;
  for (const name of BODY_NAMES) {
    const c = bodyPos(name, T);
    const d = len(sub(posC, c));
    const alt = d - BODIES[name].R;
    if (!best || alt < best.alt) best = { name, alt, dist: d, centre: c };
  }
  return best;
}

// A place on a body, from a position in C: { lon, lat, alt, up (C) }.
export function placeOn(name, posC, T, frame = null) {
  const bf = frame || bodyFrame(name, T);
  const rel = sub(posC, bodyPos(name, T));
  const [lon, lat] = lonLatOf(fromC(bf, rel));
  return { lon, lat, alt: len(rel) - BODIES[name].R, up: norm(rel) };
}

// The position in C of a height `alt` above (lon, lat) of a body, and its local frame there.
export function positionOn(name, lon, lat, alt, T, frame = null) {
  const bf = frame || bodyFrame(name, T);
  const R = BODIES[name].R;
  const p = add(bodyPos(name, T), scale(toC(bf, dirOf(lon, lat)), R + alt));
  return { pos: p, local: localFrame(bf, lon, lat) };
}

// Crossing from a world you walk on into space: a dimension, a position there (blocks, its sea or
// datum `base`), the time -> the position in C, the local frame in C, and the body's frame (kept
// by the flight, so the Earth below stays as it was seen).
export function leaveSurface(name, x, y, z, base, T) {
  const bf = name === 'earth' ? earthFrameAt(x, z, T) : bodyFrame(name, T);
  const [lon, lat] = worldToLonLat(name, x, z);
  const { pos, local } = positionOn(name, lon, lat, y - base, T, bf);
  return { pos, local, bodyFrame: bf };
}

// A position in C as a body's own coordinates (fixed to its ground, turning and moving with it),
// and back: how players in space tell each other where they are.
export function toBody(name, posC, T, frame = null) {
  return fromC(frame || bodyFrame(name, T), sub(posC, bodyPos(name, T)));
}
export function fromBody(name, q, T, frame = null) {
  return add(bodyPos(name, T), toC(frame || bodyFrame(name, T), q));
}

// Near a body you are carried along with it, turning with its ground and going round with it
// (so stopping above a place keeps you over it, as an orbit that keeps pace would): all of the
// way within 1.5 of its radii of its centre, none beyond 6 (the Earth's geostationary orbit is at
// 6.6 radii).
export function carryWeight(name, dist) {
  const R = BODIES[name].R;
  const k = Math.min(1, Math.max(0, (6 * R - dist) / (4.5 * R)));
  return k * k * (3 - 2 * k);
}

// Coming down from space onto a body: where in its dimension, and the frame you then stand in.
export function reachSurface(name, posC, T, frame = null) {
  const bf = frame || bodyFrame(name, T);
  const p = placeOn(name, posC, T, bf);
  const [x, z] = lonLatToWorld(name, p.lon, p.lat);
  return { x, z, alt: p.alt, lon: p.lon, lat: p.lat, local: localFrame(bf, p.lon, p.lat) };
}

// ------------------------------------------------------------------ the sky
// Everything the renderer draws in the sky, for a camera at posC whose local frame (x east,
// y up, z south) is `local`: per body its centre relative to the camera and the rotation from
// camera space into its own frame (both in the camera's local axes), the Sun's direction, and the
// rotation from camera space into C (for the stars).
export function skyView(posC, local, T, earthFrame = null) {
  const bodies = BODY_NAMES.map((name) => {
    const bf = name === 'earth' ? (earthFrame || earthFrameStd(T)) : bodyFrame(name, T);
    const c = fromC(local, sub(bodyPos(name, T), posC));
    return { name, centre: c, R: BODIES[name].R, rot: relFrame(local, bf) };
  });
  return { bodies, sun: fromC(local, SUN_DIR), toC: local };
}

// The sun's direction at a place on a body: [local x, y, z].
export function sunAt(name, lon, lat, T, frame = null) {
  const bf = frame || bodyFrame(name, T);
  return fromC(localFrame(bf, lon, lat), SUN_DIR);
}
