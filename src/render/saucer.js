// The flying saucer: a mothership 55 blocks across (its shape: sim/saucerform.js). A smooth disc
// of plated metal turned on a lathe, a band of chasing lights round its rim with navigation lights
// and a strobe, a ring of glowing windows, a great glass dome over a deck where the pilot sits at
// the controls with sixteen seats round a hologram of where it is going, a main engine under its
// middle and eight thrusters round it (white-hot and pouring out flame when it flies), and six
// landing legs that stretch down to the ground under each foot and fold away in flight.
//
// Everything but the legs and the flames is built once, in the saucer's own frame, and each frame
// only turned and moved into place (the lights' brightness and the hologram's colour are set on
// the way); the legs and flames are built each frame.
//
// Entity shader modes used here: 1 a block texture; 4 + e*0.95 a block texture that glows with
// strength e (0..1); 5 + r*0.95 a block texture as polished metal of roughness r.

import { BLOCK, FACE_TEX } from '../world/blocks.js';
import * as F from '../sim/saucerform.js';

export const SAUCER_LEG = F.HULL; // the hull's underside above the foot
export const SAUCER_RIM = F.RIM;
export const SAUCER_SEAT = F.DECK + F.SEAT_H; // a seat's cushion above the foot

const TAU = Math.PI * 2;
const metal = (r) => 5 + r * 0.95;
const glow = (e) => 4 + Math.max(0, Math.min(1, e)) * 0.95;
const CUTOUT = [1, 1, 1, -2];
const NONE = [1, 1, 1, 0];
const tex = (block, face = 2) => FACE_TEX[block * 4 + face];

// ---------------------------------------------------------------- building geometry
// Vertices in the saucer's frame: pos3 normal3 uv2 layer mode tint4 (14 floats).
const VF = 14;
class Mesh {
  constructor(cap) { this.d = new Float32Array(cap * VF); this.n = 0; }
  grow() { const d = new Float32Array(this.d.length * 2); d.set(this.d); this.d = d; }
  vert(x, y, z, nx, ny, nz, u, v, layer, mode, t) {
    if ((this.n + 1) * VF > this.d.length) this.grow();
    const d = this.d, o = this.n * VF;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = nx; d[o + 4] = ny; d[o + 5] = nz; d[o + 6] = u; d[o + 7] = v;
    d[o + 8] = layer; d[o + 9] = mode; d[o + 10] = t[0]; d[o + 11] = t[1]; d[o + 12] = t[2]; d[o + 13] = t[3];
    this.n++;
  }
}

// A surface turned round the y axis through the profile [[r, y], ...] (between angles a0 and a1,
// seg steps round), the texture tiled every `tile` blocks, round the point (cx, cz). It faces to
// the right of the way the profile goes in (r, y): out and down for one going out, out and up for
// one going up and in, up for one coming in level; so a floor is listed from its edge in.
// (Counter-clockwise seen from that side: the shader takes the far side's normal for back faces.)
function lathe(m, prof, seg, block, mode, t, tile = 2.5, a0 = 0, a1 = TAU, cx = 0, cz = 0, face = 2) {
  const layer = tex(block, face);
  let vAcc = 0;
  for (let i = 1; i < prof.length; i++) {
    const r0 = prof[i - 1][0], y0 = prof[i - 1][1], r1 = prof[i][0], y1 = prof[i][1];
    const dr = r1 - r0, dy = y1 - y0, l = Math.hypot(dr, dy) || 1;
    const nr = dy / l, ny = -dr / l;
    const nu = Math.max(1, Math.round(((a1 - a0) * Math.max(r0, r1, 0.5)) / tile));
    const v0 = vAcc / tile, v1 = (vAcc + l) / tile;
    vAcc += l;
    for (let j = 0; j < seg; j++) {
      const aa = a0 + ((a1 - a0) * j) / seg, ab = a0 + ((a1 - a0) * (j + 1)) / seg;
      const ca = Math.cos(aa), sa = Math.sin(aa), cb = Math.cos(ab), sb = Math.sin(ab);
      const ua = (nu * j) / seg, ub = (nu * (j + 1)) / seg;
      // p00 (r0, aa), p11 (r1, ab), p01 (r0, ab); p00, p10 (r1, aa), p11
      m.vert(cx + ca * r0, y0, cz + sa * r0, ca * nr, ny, sa * nr, ua, v0, layer, mode, t);
      m.vert(cx + cb * r1, y1, cz + sb * r1, cb * nr, ny, sb * nr, ub, v1, layer, mode, t);
      m.vert(cx + cb * r0, y0, cz + sb * r0, cb * nr, ny, sb * nr, ub, v0, layer, mode, t);
      m.vert(cx + ca * r0, y0, cz + sa * r0, ca * nr, ny, sa * nr, ua, v0, layer, mode, t);
      m.vert(cx + ca * r1, y1, cz + sa * r1, ca * nr, ny, sa * nr, ua, v1, layer, mode, t);
      m.vert(cx + cb * r1, y1, cz + sb * r1, cb * nr, ny, sb * nr, ub, v1, layer, mode, t);
    }
  }
}

// one face of a box: corners a b c d counter-clockwise from outside, normal n, uv size w by h
function face(m, a, b, c, d, n, w, h, layer, mode, t) {
  m.vert(a[0], a[1], a[2], n[0], n[1], n[2], 0, h, layer, mode, t);
  m.vert(b[0], b[1], b[2], n[0], n[1], n[2], w, h, layer, mode, t);
  m.vert(c[0], c[1], c[2], n[0], n[1], n[2], w, 0, layer, mode, t);
  m.vert(a[0], a[1], a[2], n[0], n[1], n[2], 0, h, layer, mode, t);
  m.vert(c[0], c[1], c[2], n[0], n[1], n[2], w, 0, layer, mode, t);
  m.vert(d[0], d[1], d[2], n[0], n[1], n[2], 0, 0, layer, mode, t);
}

// A box turned by `ang` about the y axis round its own middle (cx, cz); y0..y1 up.
const BX = [[0, 0], [0, 0], [0, 0], [0, 0]];
function box(m, cx, cz, hw, hd, y0, y1, block, mode, t, ang = 0) {
  const c = Math.cos(ang), s = Math.sin(ang);
  // corners round the bottom (and top): (-,-) (+,-) (+,+) (-,+) in the box's own x and z
  const xs = [-hw, hw, hw, -hw], zs = [-hd, -hd, hd, hd];
  for (let i = 0; i < 4; i++) { BX[i][0] = cx + c * xs[i] + s * zs[i]; BX[i][1] = cz - s * xs[i] + c * zs[i]; }
  const B = (i) => [BX[i][0], y0, BX[i][1]], T = (i) => [BX[i][0], y1, BX[i][1]];
  const top = tex(block, 0), bot = tex(block, 1), side = tex(block, 2);
  const w = hw * 2, d = hd * 2, h = y1 - y0;
  face(m, T(3), T(2), T(1), T(0), [0, 1, 0], w, d, top, mode, t);
  face(m, B(0), B(1), B(2), B(3), [0, -1, 0], w, d, bot, mode, t);
  // sides: (0,1) faces -z, (1,2) +x, (2,3) +z, (3,0) -x in the box's frame
  const N = [[-s, 0, -c], [c, 0, -s], [s, 0, c], [-c, 0, s]];
  const W = [w, d, w, d];
  for (let i = 0; i < 4; i++) { const j = (i + 1) & 3; face(m, B(j), B(i), T(i), T(j), N[i], W[i], h, side, mode, t); }
}

// A square beam from p to q, w thick.
function beam(m, p, q, w, block, mode, t) {
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const f = [d[0] / l, d[1] / l, d[2] / l];
  const up = Math.abs(f[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let a = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];
  const al = Math.hypot(a[0], a[1], a[2]);
  a = [a[0] / al, a[1] / al, a[2] / al];
  const b = [f[1] * a[2] - f[2] * a[1], f[2] * a[0] - f[0] * a[2], f[0] * a[1] - f[1] * a[0]];
  const hw = w / 2;
  const C = (e, s, i) => [e[0] + (a[0] * s + b[0] * i) * hw, e[1] + (a[1] * s + b[1] * i) * hw, e[2] + (a[2] * s + b[2] * i) * hw];
  const layer = tex(block);
  // (f, a, b) right-handed: each side from p to q is counter-clockwise from outside
  const sides = [[1, 1, 1, -1, a], [1, -1, -1, -1, [-b[0], -b[1], -b[2]]], [-1, -1, -1, 1, [-a[0], -a[1], -a[2]]], [-1, 1, 1, 1, b]];
  for (const [s0, i0, s1, i1, n] of sides) face(m, C(p, s0, i0), C(q, s0, i0), C(q, s1, i1), C(p, s1, i1), n, w, l, layer, mode, t);
}

// ---------------------------------------------------------------- the saucer, built once
const PANEL = [0.82, 0.85, 0.9, 0.18];
const PANEL_DARK = [0.55, 0.58, 0.64, 0.3];
const LIGHTS = 48;
const LIGHT_COLOURS = [[1, 0.25, 0.3], [1, 0.8, 0.25], [0.35, 1, 0.5], [0.3, 0.9, 1], [0.4, 0.55, 1], [1, 0.4, 0.9]];

function seat(m, [x, z, f], cushion) {
  const y = F.DECK;
  box(m, x, z, 0.5, 0.45, y, y + F.SEAT_H - 0.12, BLOCK.QUARTZ_BLOCK, metal(0.25), NONE, f);
  box(m, x, z, 0.46, 0.42, y + F.SEAT_H - 0.12, y + F.SEAT_H, BLOCK.WHITE_WOOL, 1, cushion, f);
  // the back, behind the sitter (a seat faces -z turned by f)
  box(m, x + Math.sin(f) * 0.5, z + Math.cos(f) * 0.5, 0.5, 0.1, y + F.SEAT_H - 0.1, y + F.SEAT_H + 0.95, BLOCK.QUARTZ_BLOCK, metal(0.25), NONE, f);
}

// Builds the still saucer with `seg` steps round; `parts` gets the vertex ranges whose look
// changes ([from, to) for each light, the engines, the hologram).
function buildStill(seg) {
  const m = new Mesh(16000);
  const H = F.HULL;
  const parts = { lights: [], nav: [], engine: null, thrusters: null, holo: null };
  const mark = (fn) => { const a = m.n; fn(); return [a, m.n]; };
  // the underside, in panels of two shades, out to the rim
  const sectors = 16, per = Math.max(1, Math.round(seg / sectors));
  for (let k = 0; k < sectors; k++) {
    lathe(m, F.LOWER.slice(1), per, BLOCK.IRON_BLOCK, metal(k & 1 ? 0.34 : 0.26), k & 1 ? PANEL : PANEL_DARK, 2.5, (k / sectors) * TAU, ((k + 1) / sectors) * TAU);
  }
  // a dark band round the engine bay, and the engine's housing
  lathe(m, [[5.6, H + 0.06], [9.4, H + 0.82]], seg, BLOCK.NETHERITE_BLOCK, metal(0.3), NONE, 2);
  lathe(m, [[4.6, H - 0.95], [5, H]], seg, BLOCK.NETHERITE_BLOCK, metal(0.32), NONE, 2);
  // the main engine's core, white-hot when it flies
  parts.engine = mark(() => lathe(m, [[0, H - 0.9], [F.ENGINE_R, H - 0.9]], Math.max(16, seg / 3), BLOCK.SEA_LANTERN, glow(0.3), [1, 0.7, 0.4, 0.75], 1.5, 0, TAU, 0, 0, 1));
  // the thrusters' bells round it, and their glowing mouths
  const y0 = F.undersideAt(F.THRUSTER_R);
  for (let i = 0; i < F.THRUSTERS; i++) {
    const a = (i / F.THRUSTERS) * TAU + Math.PI / 8;
    lathe(m, [[1.6, y0 - 2], [1.45, y0 - 1.2], [1, y0 - 0.3], [0.9, y0 + 0.3]], 10, BLOCK.NETHERITE_BLOCK, metal(0.3), NONE, 1.2, 0, TAU, Math.cos(a) * F.THRUSTER_R, Math.sin(a) * F.THRUSTER_R);
  }
  parts.thrusters = mark(() => {
    for (let i = 0; i < F.THRUSTERS; i++) {
      const a = (i / F.THRUSTERS) * TAU + Math.PI / 8;
      lathe(m, [[0, y0 - 1.95], [1.5, y0 - 1.95]], 10, BLOCK.MAGMA_BLOCK, glow(0.2), [1, 0.55, 0.2, 0.5], 1, 0, TAU, Math.cos(a) * F.THRUSTER_R, Math.sin(a) * F.THRUSTER_R, 1);
    }
  });
  // the rim: a white band with its lights, the navigation lights at its sides and a strobe behind
  lathe(m, [[F.RIM, H + 6], [F.RIM, H + 7]], seg, BLOCK.QUARTZ_BLOCK, metal(0.2), NONE, 1.5);
  for (let i = 0; i < LIGHTS; i++) {
    const a = (i / LIGHTS) * TAU, r = F.RIM + 0.06;
    const c = LIGHT_COLOURS[i % LIGHT_COLOURS.length];
    parts.lights.push(mark(() => box(m, Math.cos(a) * r, Math.sin(a) * r, 0.35, 0.12, H + 6.25, H + 6.75, BLOCK.SEA_LANTERN, glow(0.5), [c[0], c[1], c[2], 0.8], Math.PI / 2 - a)));
  }
  parts.nav.push(mark(() => box(m, -F.RIM - 0.25, 0, 0.3, 0.6, H + 6.1, H + 6.9, BLOCK.RED_WOOL, glow(0.5), [1, 0.1, 0.08, 0.9])));
  parts.nav.push(mark(() => box(m, F.RIM + 0.25, 0, 0.3, 0.6, H + 6.1, H + 6.9, BLOCK.LIME_WOOL, glow(0.5), [0.15, 1, 0.25, 0.9])));
  parts.strobe = mark(() => box(m, 0, F.RIM + 0.25, 0.6, 0.3, H + 6.1, H + 6.9, BLOCK.WHITE_WOOL, glow(0.1), [1, 1, 1, 0.9]));
  // the top of the hull, in to the deck, and a ring of lit windows round it
  for (let k = 0; k < sectors; k++) {
    lathe(m, F.UPPER, per, BLOCK.IRON_BLOCK, metal(k & 1 ? 0.24 : 0.3), k & 1 ? PANEL_DARK : PANEL, 2.5, (k / sectors) * TAU + 0.2, ((k + 1) / sectors) * TAU + 0.2);
  }
  for (let i = 0; i < 40; i++) {
    lathe(m, [[22.6, H + 8.85], [21.2, H + 9.28]], 2, BLOCK.SEA_LANTERN, glow(0.55), [1, 0.86, 0.62, 0.7], 1, (i / 40) * TAU + 0.02, ((i + 0.62) / 40) * TAU + 0.02);
  }
  // the lip round the dome
  lathe(m, [[13.2, F.DECK - 0.05], [12.5, F.DECK + 0.35], [12.2, F.DECK + 0.35]], seg, BLOCK.QUARTZ_BLOCK, metal(0.2), NONE, 1.5);
  // the deck: a pale floor with a teal ring and a ring of light round the hologram
  lathe(m, [[12.3, F.DECK + 0.02], [0, F.DECK + 0.02]], seg, BLOCK.SMOOTH_STONE, 1, [0.95, 0.96, 1, 0.35], 2, 0, TAU, 0, 0, 0);
  lathe(m, [[7, F.DECK + 0.04], [6.2, F.DECK + 0.04]], seg, BLOCK.PRISMARINE_BRICKS, 1, NONE, 1, 0, TAU, 0, 0, 0);
  lathe(m, [[2.6, F.DECK + 0.05], [2.2, F.DECK + 0.05]], seg, BLOCK.SEA_LANTERN, glow(0.5), [0.4, 0.9, 1, 0.6], 1, 0, TAU, 0, 0, 0);
  // the pilot's console: a curved desk at the front, low enough to see out over, its screens
  // tilted towards the pilot
  lathe(m, [[10.6, F.DECK], [10.6, F.DECK + 1.05], [9.6, F.DECK + 0.75], [9.6, F.DECK]], 10, BLOCK.NETHERITE_BLOCK, metal(0.35), NONE, 1.5, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
  lathe(m, [[10.5, F.DECK + 1.035], [9.7, F.DECK + 0.795]], 10, BLOCK.SEA_LANTERN, glow(0.55), [0.35, 0.95, 1, 0.75], 1, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
  seat(m, F.PILOT_SEAT, [0.95, 0.75, 0.25, 0.6]);
  for (const s of F.SEATS) seat(m, s, [0.5, 0.8, 1, 0.55]);
  // the hologram in the middle over its projector
  lathe(m, [[1.5, F.DECK], [1.3, F.DECK + 0.3], [0, F.DECK + 0.3]], 16, BLOCK.NETHERITE_BLOCK, metal(0.3), NONE, 1);
  parts.holo = mark(() => {
    const hr = 1.25, hy = F.DECK + 2.6, holo = [];
    for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (Math.PI * i) / 8; holo.push([Math.max(0.02, Math.cos(a) * hr), hy + Math.sin(a) * hr]); }
    lathe(m, holo, 14, BLOCK.SEA_LANTERN, glow(0.7), [0.4, 0.9, 1, 0.85], 1);
    box(m, 0, 0, 0.06, 0.06, F.DECK + 0.3, hy - hr, BLOCK.SEA_LANTERN, glow(0.6), [0.4, 0.9, 1, 0.8]);
  });
  // the glass dome over it all
  const dome = [];
  for (let i = 0; i <= 10; i++) { const y = F.DECK + 0.35 + ((F.TOP - F.DECK - 0.35) * i) / 10; dome.push([Math.max(0.05, F.domeRadius(y)), y]); }
  lathe(m, dome, seg, BLOCK.GLASS, 1, CUTOUT, 3.2);
  // an antenna on top with a beacon
  box(m, 0, 0, 0.12, 0.12, F.TOP - 0.2, F.TOP + 2.2, BLOCK.IRON_BLOCK, metal(0.3), NONE);
  parts.beacon = mark(() => box(m, 0, 0, 0.3, 0.3, F.TOP + 2.2, F.TOP + 2.8, BLOCK.RED_WOOL, glow(0.5), [1, 0.12, 0.08, 0.9]));
  return { m, parts };
}

let STILL = null;
function still(near) {
  if (!STILL) STILL = { near: buildStill(64), far: buildStill(28) };
  return near ? STILL.near : STILL.far;
}

// The brightness (and the hologram's colour) of this frame, written into the still mesh.
const DEST_COLOURS = { earth: [0.35, 0.65, 1], moon: [0.85, 0.85, 0.9], mars: [1, 0.45, 0.25], jupiter: [1, 0.78, 0.5], saturn: [1, 0.9, 0.55] };
function setMode(m, [a, b], mode) { const d = m.d; for (let i = a; i < b; i++) d[i * VF + 9] = mode; }
function setTint(m, [a, b], c) { const d = m.d; for (let i = a; i < b; i++) { d[i * VF + 10] = c[0]; d[i * VF + 11] = c[1]; d[i * VF + 12] = c[2]; } }
function animate({ m, parts }, t, look) {
  const engine = look.engine ?? 0;
  const speed = engine > 0.05 ? 9 : 1.8;
  for (let i = 0; i < LIGHTS; i++) setMode(m, parts.lights[i], glow(0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * speed - i * (TAU / LIGHTS) * 4))));
  const blink = Math.sin(t * 4) > 0.6 ? 1 : 0.12;
  for (const r of parts.nav) setMode(m, r, glow(blink));
  setMode(m, parts.strobe, glow(Math.sin(t * 9) > 0.92 ? 1 : 0.1));
  setMode(m, parts.beacon, glow(Math.sin(t * 3) > 0.2 ? 1 : 0.15));
  // (the fire as bright to the eye at night as by day: see Renderer.bindPointLights)
  const eye = Math.sqrt(look.eye ?? 1);
  setMode(m, parts.engine, glow((0.25 + 0.75 * engine) * (engine > 0.05 ? eye : 1)));
  setMode(m, parts.thrusters, glow((0.2 + 0.8 * engine) * (engine > 0.05 ? eye : 1)));
  const hc = DEST_COLOURS[look.dest] || [0.4, 0.9, 1];
  setTint(m, parts.holo, hc);
}

// ---------------------------------------------------------------- built each frame
const MOVING = new Mesh(3000);
function buildMoving(m, t, look) {
  const H = F.HULL;
  const engine = look.engine ?? 0, legs = look.legs ?? 1;
  // flame pouring out: a long white-hot core inside a longer orange cone, flickering (as bright to
  // the eye at night as by day: see Renderer.bindPointLights)
  if (engine > 0.04) {
    const eye = Math.sqrt(look.eye ?? 1);
    const fl = (k) => 0.82 + 0.18 * Math.sin(t * 31 + k * 1.7) * Math.sin(t * 17 + k);
    const L = (7 + 26 * engine) * fl(0);
    lathe(m, [[0.3, H - 1 - L], [2.6, H - 1 - L * 0.5], [3.9, H - 1]], 16, BLOCK.SEA_LANTERN, glow(0.6 * eye), [1, 0.36, 0.06, 0.88], 3);
    lathe(m, [[0.2, H - 1 - L * 0.62], [1.2, H - 1 - L * 0.42], [2.7, H - 1.05]], 12, BLOCK.SEA_LANTERN, glow(eye), [1, 0.9, 0.66, 0.85], 3);
    const y0 = F.undersideAt(F.THRUSTER_R) - 2;
    for (let i = 0; i < F.THRUSTERS; i++) {
      const a = (i / F.THRUSTERS) * TAU + Math.PI / 8;
      const l = (2.5 + 10 * engine) * fl(i + 1);
      lathe(m, [[0.12, y0 - l], [0.95, y0 - l * 0.5], [1.4, y0]], 8, BLOCK.SEA_LANTERN, glow(0.7 * eye), [1, 0.45, 0.1, 0.88], 2, 0, TAU, Math.cos(a) * F.THRUSTER_R, Math.sin(a) * F.THRUSTER_R);
    }
  }
  // the legs: a strut from the hull and its piston, stretched down to the ground under each foot
  // (look.feet: how much further down each reaches), a brace and a broad pad; drawn up into the
  // hull in flight
  if (legs > 0.01) {
    const ext = look.feet || null;
    const top = F.undersideAt(F.FOOT_R) + 0.2;
    for (let i = 0; i < F.LEGS; i++) {
      const [x, z] = F.FEET[i];
      const footY = (top - 0.6) * (1 - legs) - (ext ? ext[i] || 0 : 0) * legs;
      const mid = top - (top - footY) * 0.45;
      box(m, x, z, 0.6, 0.6, mid, top, BLOCK.IRON_BLOCK, metal(0.35), NONE);
      box(m, x, z, 0.38, 0.38, footY + 0.4, mid + 0.2, BLOCK.QUARTZ_BLOCK, metal(0.15), NONE);
      const br = F.FOOT_R - 5.5, ba = Math.atan2(z, x);
      beam(m, [Math.cos(ba) * br, F.undersideAt(br) + 0.1, Math.sin(ba) * br], [x * 0.98, mid + 0.3, z * 0.98], 0.45, BLOCK.IRON_BLOCK, metal(0.4), NONE);
      box(m, x, z, 1.6, 1.6, footY, footY + 0.45, BLOCK.NETHERITE_BLOCK, metal(0.4), NONE);
    }
  }
}

// How many floats one saucer takes at most (for the mesh's buffer).
export function saucerFloats() {
  return (still(true).m.n + 2600) * 16;
}

// rotation: yaw about y, then pitch about x, then roll about z (the saucer banking in flight)
function rotation(yaw, pitch, roll) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  return [
    cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp,
    cp * sr, cp * cr, -sp,
    -sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp,
  ];
}

// Into the frame's vertices (pos3 camera relative, normal3, uv2, layer, sky, block, mode, tint4).
function put(out, o, mesh, R, org, light) {
  const d = mesh.d;
  const r0 = R[0], r1 = R[1], r2 = R[2], r3 = R[3], r4 = R[4], r5 = R[5], r6 = R[6], r7 = R[7], r8 = R[8];
  const ox = org[0], oy = org[1], oz = org[2], sky = light[0], blk = light[1];
  for (let i = 0, n = mesh.n * VF; i < n; i += VF) {
    const x = d[i], y = d[i + 1], z = d[i + 2], nx = d[i + 3], ny = d[i + 4], nz = d[i + 5];
    out[o] = ox + r0 * x + r1 * y + r2 * z;
    out[o + 1] = oy + r3 * x + r4 * y + r5 * z;
    out[o + 2] = oz + r6 * x + r7 * y + r8 * z;
    out[o + 3] = r0 * nx + r1 * ny + r2 * nz;
    out[o + 4] = r3 * nx + r4 * ny + r5 * nz;
    out[o + 5] = r6 * nx + r7 * ny + r8 * nz;
    out[o + 6] = d[i + 6]; out[o + 7] = d[i + 7];
    out[o + 8] = d[i + 8]; out[o + 9] = sky; out[o + 10] = blk; out[o + 11] = d[i + 9];
    out[o + 12] = d[i + 10]; out[o + 13] = d[i + 11]; out[o + 14] = d[i + 12]; out[o + 15] = d[i + 13];
    o += 16;
  }
  return o;
}

// pos: the saucer's foot, cam: the camera (positions are sent relative to it), light: [sky, block]
// 0..1, t: seconds, look: { legs 0..1 (down), engine 0..1 (the thrust), pitch, roll (banking),
// feet: [how much further down each leg reaches], dest: where it is going, eye: how much to dim
// its fire for an eye set for the dark (1 by day) }.
export function emitSaucer(out, o, pos, yaw, cam, light, t, look = {}) {
  const R = rotation(yaw, look.pitch || 0, look.roll || 0);
  const org = [pos[0] - cam[0], pos[1] - cam[1], pos[2] - cam[2]];
  const s = still(Math.hypot(org[0], org[1] + 15, org[2]) < 260);
  animate(s, t, look);
  o = put(out, o, s.m, R, org, light);
  MOVING.n = 0;
  buildMoving(MOVING, t, look);
  return put(out, o, MOVING, R, org, light);
}
