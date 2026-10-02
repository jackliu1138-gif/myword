// The F-22 Raptor (its shape: sim/jetform.js), at its real size. A lofted fuselage with the chines
// running from its nose back into the wing roots, caret intakes on its shoulders, a gold-tinted
// bubble canopy, wings and stabilators swept 42 degrees at their leading edges and -17 at their
// trailing edges, two tails canted outwards, two flat nozzles that turn the thrust up and down, all
// in its two greys; formation lights, navigation lights and the weapons bays' doors; landing gear
// that folds away; and, burning, the afterburner's flame with its shock diamonds.
//
// The body, wings and tails are built once; each frame the parts that move (control surfaces,
// nozzles, gear, doors, flames) are built again and all of it turned and moved into place.
//
// Entity shader modes: 1 a block texture; 4 + e*0.95 glowing with strength e; 5 + r*0.95 polished
// metal of roughness r. Tint [r, g, b, a]: a > 0 mixes the texture towards the colour by a.

import { BLOCK, FACE_TEX } from '../world/blocks.js';
import * as J from '../sim/jetform.js';

const metal = (r) => 5 + r * 0.95;
const glow = (e) => 4 + Math.max(0, Math.min(1, e)) * 0.95;
const tex = (block, face = 2) => FACE_TEX[block * 4 + face];

// its paint: a darker and a lighter grey (with a little of the stone's texture for panel lines),
// the gold of the canopy, the dark metal of the nozzles
const GREY = [0.42, 0.45, 0.48, 0.9];
const GREY_DARK = [0.34, 0.36, 0.39, 0.9];
const GREY_CAMO = [0.31, 0.33, 0.36, 0.9]; // (the darker of its camouflage greys)
const GREY_RADOME = [0.38, 0.41, 0.44, 0.9];
const GOLD = [0.5, 0.41, 0.18, 0.96];
const NOZZLE = [0.24, 0.24, 0.25, 0.92];
const DUCT = [0.03, 0.03, 0.035, 1];
const TYRE = [0.06, 0.06, 0.065, 1];
const STRUT = [0.72, 0.73, 0.75, 0.85];
const MISSILE = [0.86, 0.87, 0.86, 0.9];
const PAINT_TEX = () => tex(BLOCK.SMOOTH_STONE, 0);

// ---------------------------------------------------------------- building geometry
const VF = 14;
class Mesh {
  constructor(cap) { this.d = new Float32Array(cap * VF); this.n = 0; }
  vert(p, n, u, v, layer, mode, t) {
    if ((this.n + 1) * VF > this.d.length) { const d = new Float32Array(this.d.length * 2); d.set(this.d); this.d = d; }
    const d = this.d, o = this.n * VF;
    d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2]; d[o + 3] = n[0]; d[o + 4] = n[1]; d[o + 5] = n[2]; d[o + 6] = u; d[o + 7] = v;
    d[o + 8] = layer; d[o + 9] = mode; d[o + 10] = t[0]; d[o + 11] = t[1]; d[o + 12] = t[2]; d[o + 13] = t[3];
    this.n++;
  }
}
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const faceN = (a, b, c) => norm3(cross3(sub3(b, a), sub3(c, a)));

// A triangle (counter-clockwise from the side it faces), with its own normal or the given ones.
function tri(m, a, b, c, mode, t, layer = PAINT_TEX(), na = null, nb = null, nc = null, uvs = null) {
  const n = faceN(a, b, c);
  const uv = uvs || [[a[2] / 3, a[0] / 3 + a[1] / 3], [b[2] / 3, b[0] / 3 + b[1] / 3], [c[2] / 3, c[0] / 3 + c[1] / 3]];
  m.vert(a, na || n, uv[0][0], uv[0][1], layer, mode, t);
  m.vert(b, nb || n, uv[1][0], uv[1][1], layer, mode, t);
  m.vert(c, nc || n, uv[2][0], uv[2][1], layer, mode, t);
}
// a quad a b c d, counter-clockwise from the side it faces
function quad(m, a, b, c, d, mode, t, layer, ns = null) {
  tri(m, a, b, c, mode, t, layer, ns && ns[0], ns && ns[1], ns && ns[2]);
  tri(m, a, c, d, mode, t, layer, ns && ns[0], ns && ns[2], ns && ns[3]);
}
// the same, seen from both sides (thin plates: doors, flaps)
function plate(m, a, b, c, d, mode, t, layer) {
  quad(m, a, b, c, d, mode, t, layer);
  quad(m, d, c, b, a, mode, t, layer);
}

// A skin through rings of points (rings[i][j], each ring the same count, closed round if `closed`),
// facing outwards when the rings go round counter-clockwise looking down the way they advance.
// Normals are smoothed between neighbouring faces less than `crease` apart, so chines stay sharp.
function loft(m, rings, mode, t, closed = true, crease = 0.72, flip = false) {
  const R = rings.length, N = rings[0].length;
  const M = closed ? N : N - 1;
  const fn = [];
  for (let i = 0; i < R - 1; i++) {
    fn.push([]);
    for (let j = 0; j < M; j++) {
      const a = rings[i][j], b = rings[i][(j + 1) % N], c = rings[i + 1][(j + 1) % N], d = rings[i + 1][j];
      let n = cross3(sub3(c, a), sub3(d, b));
      if (Math.hypot(n[0], n[1], n[2]) < 1e-9) n = cross3(sub3(b, a), sub3(d, a));
      n = norm3(n);
      fn[i].push(flip ? [-n[0], -n[1], -n[2]] : n);
    }
  }
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  // the normal at corner (i, j) of face (fi, fj): the faces round it close to that face's
  const cornerN = (i, j, fi, fj) => {
    const own = fn[fi][fj];
    const acc = [0, 0, 0];
    for (const [qi, qj] of [[i - 1, j - 1], [i - 1, j], [i, j - 1], [i, j]]) {
      if (qi < 0 || qi >= R - 1) continue;
      let jj = qj;
      if (closed) jj = (qj + M) % M; else if (jj < 0 || jj >= M) continue;
      const q = fn[qi][jj];
      if (dot(q, own) < crease) continue;
      acc[0] += q[0]; acc[1] += q[1]; acc[2] += q[2];
    }
    return norm3(acc);
  };
  const layer = PAINT_TEX();
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < M; j++) {
      const j1 = (j + 1) % N;
      const a = rings[i][j], b = rings[i][j1], c = rings[i + 1][j1], d = rings[i + 1][j];
      const na = cornerN(i, j, i, j), nb = cornerN(i, j1, i, j), nc = cornerN(i + 1, j1, i, j), nd = cornerN(i + 1, j, i, j);
      const uv = (p) => [p[2] / 3.2, (p[0] + p[1]) / 3.2];
      const ua = uv(a), ub = uv(b), uc = uv(c), ud = uv(d);
      if (flip) {
        tri(m, a, c, b, mode, t, layer, na, nc, nb, [ua, uc, ub]);
        tri(m, a, d, c, mode, t, layer, na, nd, nc, [ua, ud, uc]);
      } else {
        tri(m, a, b, c, mode, t, layer, na, nb, nc, [ua, ub, uc]);
        tri(m, a, c, d, mode, t, layer, na, nc, nd, [ua, uc, ud]);
      }
    }
  }
}

// A thin lifting surface: a planform from root [le, te] to tip [le, te] (points in the jet's frame),
// biconvex, `tRoot` and `tTip` thick, its thickness along `up` (a unit vector): upper and lower
// skins in a few strips along the chord, the edges closed. sEnd < 1: it stops at that fraction of
// the chord (where a control surface is hinged), closed there.
function wing(m, rootLE, rootTE, tipLE, tipTE, tRoot, tTip, up, mode, t, strips = 5, spanSteps = 3, sEnd = 1) {
  const S = strips, P = spanSteps;
  const thick = (s) => 4 * s * (1 - s);
  const pt = (k, s0, side) => {
    const s = s0 * sEnd;
    const le = lerp3(rootLE, tipLE, k), te = lerp3(rootTE, tipTE, k);
    const c = lerp3(le, te, s);
    const h = side * 0.5 * (tRoot + (tTip - tRoot) * k) * thick(s);
    return [c[0] + up[0] * h, c[1] + up[1] * h, c[2] + up[2] * h];
  };
  const rings = (side) => {
    const out = [];
    for (let p = 0; p <= P; p++) { const row = []; for (let s = 0; s <= S; s++) row.push(pt(p / P, s / S, side)); out.push(row); }
    return out;
  };
  // (orientation: the upper skin faces `up`; the lower, the other way)
  const upper = rings(1), lower = rings(-1);
  const sideOf = (rs) => { const a = rs[0][0], b = rs[0][1], c = rs[1][1]; const n = faceN(a, b, c); return n[0] * up[0] + n[1] * up[1] + n[2] * up[2]; };
  loft(m, upper, mode, t, false, 0.8, sideOf(upper) < 0);
  loft(m, lower, mode, t, false, 0.8, sideOf(lower) > 0);
  // the tip
  for (let s = 0; s < S; s++) quad(m, upper[P][s], upper[P][s + 1], lower[P][s + 1], lower[P][s], mode, t, PAINT_TEX());
  for (let s = 0; s < S; s++) quad(m, lower[P][s], lower[P][s + 1], upper[P][s + 1], upper[P][s], mode, t, PAINT_TEX());
  // (stopped short of the trailing edge: closed along the hinge line)
  if (sEnd < 1) for (let p = 0; p < P; p++) plate(m, upper[p][S], upper[p + 1][S], lower[p + 1][S], lower[p][S], mode, t, PAINT_TEX());
}

// A control surface hinged on the line h0..h1 (root and tip), half as thick there as `th0`/`th1`
// along `up`, out to the trailing edge e0..e1, turned `defl` about the hinge (positive: trailing
// edge towards -up).
function flap(m, h0, h1, th0, th1, e0, e1, up, defl, mode, t) {
  const axis = norm3(sub3(h1, h0));
  const turn = (p, h) => {
    // rotate p about the hinge axis through h by -defl (Rodrigues)
    const v = sub3(p, h), a = -defl, c = Math.cos(a), s = Math.sin(a);
    const k = axis, kv = cross3(k, v), kd = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
    return [h[0] + v[0] * c + kv[0] * s + k[0] * kd * (1 - c), h[1] + v[1] * c + kv[1] * s + k[1] * kd * (1 - c), h[2] + v[2] * c + kv[2] * s + k[2] * kd * (1 - c)];
  };
  const off = (p, d) => [p[0] + up[0] * d, p[1] + up[1] * d, p[2] + up[2] * d];
  const u0 = off(h0, th0), u1 = off(h1, th1), l0 = off(h0, -th0), l1 = off(h1, -th1);
  const E0 = turn(e0, h0), E1 = turn(e1, h1);
  quad(m, u0, u1, E1, E0, mode, t, PAINT_TEX());
  quad(m, l1, l0, E0, E1, mode, t, PAINT_TEX());
  quad(m, u1, u0, E0, E1, mode, t, PAINT_TEX());
  quad(m, l0, l1, E1, E0, mode, t, PAINT_TEX());
}

// A cylinder along the x axis (wheels), at c, radius r, half width hw; a silver hub on each side.
const HUB = [0.66, 0.68, 0.7, 0.85];
function wheel(m, c, r, hw, mode, t, seg = 12) {
  const layer = PAINT_TEX();
  for (const s of [-1, 1]) {
    const x = c[0] + s * (hw + 0.004);
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2, rr = r * 0.55;
      const p0 = [x, c[1] + Math.cos(a0) * rr, c[2] + Math.sin(a0) * rr], p1 = [x, c[1] + Math.cos(a1) * rr, c[2] + Math.sin(a1) * rr];
      if (s > 0) tri(m, [x, c[1], c[2]], p0, p1, metal(0.25), HUB, layer, [1, 0, 0], [1, 0, 0], [1, 0, 0]);
      else tri(m, [x, c[1], c[2]], p1, p0, metal(0.25), HUB, layer, [-1, 0, 0], [-1, 0, 0], [-1, 0, 0]);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = (a, x) => [c[0] + x, c[1] + Math.cos(a) * r, c[2] + Math.sin(a) * r];
    const n0 = [0, Math.cos(a0), Math.sin(a0)], n1 = [0, Math.cos(a1), Math.sin(a1)];
    tri(m, p(a0, -hw), p(a1, -hw), p(a1, hw), mode, t, layer, n0, n1, n1);
    tri(m, p(a0, -hw), p(a1, hw), p(a0, hw), mode, t, layer, n0, n1, n0);
    tri(m, [c[0] + hw, c[1], c[2]], p(a0, hw), p(a1, hw), mode, t, layer, [1, 0, 0], [1, 0, 0], [1, 0, 0]);
    tri(m, [c[0] - hw, c[1], c[2]], p(a1, -hw), p(a0, -hw), mode, t, layer, [-1, 0, 0], [-1, 0, 0], [-1, 0, 0]);
  }
}

// An axis-aligned box in the jet's frame.
function box(m, x0, y0, z0, x1, y1, z1, mode, t, layer = PAINT_TEX()) {
  const P = (x, y, z) => [x ? x1 : x0, y ? y1 : y0, z ? z1 : z0];
  quad(m, P(0, 1, 0), P(0, 1, 1), P(1, 1, 1), P(1, 1, 0), mode, t, layer); // top
  quad(m, P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1), mode, t, layer); // bottom
  quad(m, P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1), mode, t, layer); // +x
  quad(m, P(0, 0, 0), P(0, 0, 1), P(0, 1, 1), P(0, 1, 0), mode, t, layer); // -x
  quad(m, P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1), mode, t, layer); // +z
  quad(m, P(0, 0, 0), P(0, 1, 0), P(1, 1, 0), P(1, 0, 0), mode, t, layer); // -z
}

// A slender round body along z (missiles): nose at z0 (pointed), tail at z1, radius r.
function slender(m, cx, cy, z0, z1, r, mode, t, seg = 8) {
  const rings = [];
  for (const [k, rr] of [[0, 0.02], [0.06, 0.55], [0.14, 0.9], [0.24, 1], [1, 1]]) {
    const z = z0 + (z1 - z0) * k, ring = [];
    for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; ring.push([cx + Math.cos(a) * r * rr, cy + Math.sin(a) * r * rr, z]); }
    rings.push(ring);
  }
  loft(m, rings, mode, t, true, 0.5);
}

// ---------------------------------------------------------------- the shape
// The fuselage, right half of each cross-section from the top of its spine down to its keel
// (nine points; the chine is the fifth), at stations along it.
function foreSection(z, wc, top, bot, yc) {
  return [z, [[0, top], [0.3 * wc, top - 0.02], [0.58 * wc, top * 0.86 + yc * 0.14], [0.83 * wc, top * 0.52 + yc * 0.48], [wc, yc],
    [0.85 * wc, bot * 0.48 + yc * 0.52], [0.6 * wc, bot * 0.86 + yc * 0.14], [0.3 * wc, bot], [0, bot]]];
}
const BODY = [
  foreSection(-9.9, 0.16, 0.1, -0.11, -0.04),
  foreSection(-9.2, 0.38, 0.24, -0.24, -0.05),
  foreSection(-8.4, 0.62, 0.4, -0.36, -0.06),
  foreSection(-7.5, 0.86, 0.55, -0.46, -0.06),
  foreSection(-6.5, 1.06, 0.68, -0.55, -0.06),
  foreSection(-5.5, 1.22, 0.78, -0.62, -0.05),
  foreSection(-4.6, 1.34, 0.85, -0.67, -0.04),
  [-3.4, [[0, 0.86], [0.45, 0.84], [0.9, 0.72], [1.35, 0.45], [1.72, 0.03], [1.62, -0.32], [1.4, -0.6], [0.7, -0.72], [0, -0.74]]],
  [-2.0, [[0, 0.82], [0.5, 0.8], [1.05, 0.66], [1.75, 0.38], [2.3, 0.08], [2.25, -0.3], [1.9, -0.66], [0.9, -0.8], [0, -0.82]]],
  [0.0, [[0, 0.76], [0.5, 0.74], [1.1, 0.62], [1.8, 0.36], [2.38, 0.08], [2.3, -0.3], [1.95, -0.68], [0.95, -0.82], [0, -0.84]]],
  [2.5, [[0, 0.68], [0.5, 0.66], [1.1, 0.56], [1.75, 0.34], [2.3, 0.06], [2.22, -0.3], [1.85, -0.64], [0.9, -0.76], [0, -0.78]]],
  [4.8, [[0, 0.58], [0.5, 0.56], [1.05, 0.48], [1.65, 0.3], [2.12, 0.02], [2.05, -0.28], [1.72, -0.56], [0.85, -0.66], [0, -0.68]]],
  [6.6, [[0, 0.48], [0.45, 0.47], [0.95, 0.4], [1.5, 0.24], [1.88, 0.0], [1.82, -0.24], [1.55, -0.48], [0.8, -0.56], [0, -0.58]]],
  [7.4, [[0, 0.34], [0.42, 0.34], [0.9, 0.3], [1.38, 0.2], [1.66, 0.0], [1.6, -0.2], [1.38, -0.4], [0.72, -0.46], [0, -0.46]]],
];
// a ring round the whole fuselage at a station (right half going down, then the left coming up:
// counter-clockwise looking forward... the skin's outside is kept by the loft's orientation)
function ring([z, half]) {
  const out = [];
  for (const [x, y] of half) out.push([x, y, z]);
  for (let i = half.length - 2; i >= 1; i--) out.push([-half[i][0], half[i][1], z]);
  return out;
}

// where the control surfaces are hinged, as a fraction of the chord
const FLAP_AT = 0.8, RUDDER_AT = 0.72;
const halfThick = (t, s) => 0.5 * t * 4 * s * (1 - s);

let STILL = null;
function buildStill() {
  const m = new Mesh(12000);
  const P = metal(0.5), PD = metal(0.55);
  // ---- the fuselage, from the nose back to the nozzles (going back: rings advance along +z)
  const rings = BODY.map(ring);
  loft(m, rings, P, GREY, true, 0.62, true);
  // its nose cone: a fan to the tip, a slightly different grey (the radome)
  const tip = [0, -0.05, J.NOSE_Z];
  const r0 = rings[0];
  for (let j = 0; j < r0.length; j++) tri(m, tip, r0[j], r0[(j + 1) % r0.length], P, GREY_RADOME);
  // the end round the nozzles
  const last = rings[rings.length - 1];
  const cEnd = [0, -0.06, BODY[BODY.length - 1][0]];
  for (let j = 0; j < last.length; j++) tri(m, cEnd, last[j], last[(j + 1) % last.length], PD, NOZZLE);
  // ---- the caret intakes on the shoulders: a swept lip, a dark duct, merging into the sides
  for (const s of [-1, 1]) {
    const X = (p) => [p[0] * s, p[1], p[2]];
    const lip = [[1.22, 0.44, -4.6], [2.2, 0.33, -3.78], [2.1, -0.72, -3.36], [1.18, -0.66, -4.24]].map(X);
    const mid = [[1.3, 0.62, -3.0], [2.28, 0.36, -2.8], [2.24, -0.62, -2.6], [1.3, -0.72, -3.0]].map(X);
    const aft = [[1.5, 0.66, -1.6], [2.34, 0.34, -1.6], [2.3, -0.4, -1.6], [1.6, -0.72, -1.6]].map(X);
    const intake = [lip, mid, aft];
    loft(m, intake, PD, GREY_DARK, true, 0.6, s < 0);
    // the duct, a little in from the lip
    const inset = lip.map((p, i) => lerp3(p, mid[i], 0.22));
    const shrink = (p) => [p[0] * 0.97 + (s * 1.7) * 0.03, p[1] * 0.92, p[2]];
    if (s > 0) quad(m, ...inset.map(shrink), 1, DUCT, tex(BLOCK.BLACK_WOOL));
    else { const q = inset.map(shrink); quad(m, q[3], q[2], q[1], q[0], 1, DUCT, tex(BLOCK.BLACK_WOOL)); }
  }
  // ---- the canopy: a gold-tinted bubble over the cockpit
  const can = [];
  for (const [z, h, w] of [[-7.35, 0.02, 0.06], [-6.9, 0.3, 0.34], [-6.3, 0.52, 0.46], [-5.6, 0.62, 0.5], [-4.9, 0.6, 0.5], [-4.2, 0.46, 0.46], [-3.7, 0.24, 0.42]]) {
    const base = 0.6 + (z + 7.35) * 0.07;
    const r = [];
    for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI; r.push([Math.cos(a) * w, base + Math.sin(a) * (h + 0.18), z]); }
    can.push(r);
  }
  STILL_PARTS.canopy0 = m.n;
  loft(m, can, metal(0.06), GOLD, false, 0.5, true);
  STILL_PARTS.canopy1 = m.n;
  // ---- the wings: swept back 42 degrees, the trailing edge forward 17, a little anhedral
  const W = J.WING;
  for (const s of [-1, 1]) {
    const X = (x, y, z) => [x * s, y, z];
    wing(m, X(1.9, W.rootY, W.rootLE), X(1.9, W.rootY, W.rootTE), X(W.tipX, W.tipY, W.tipLE + 0.36), X(W.tipX, W.tipY, W.tipTE - 0.12), W.rootT, W.tipT, [0, 1, 0], P, GREY, 6, 3, FLAP_AT);
  }
  // ---- the tails, canted outwards (their rudders move: see buildMoving)
  const Fn = J.FIN;
  for (const s of [-1, 1]) {
    const up = [Math.sin(Fn.cant) * s, Math.cos(Fn.cant), 0];
    const out = [Math.cos(Fn.cant) * s, -Math.sin(Fn.cant), 0];
    const root = (z) => [Fn.rootX * s, Fn.rootY, z];
    const tipP = (z) => [Fn.rootX * s + up[0] * Fn.span, Fn.rootY + up[1] * Fn.span, z];
    // (the fixed part; behind RUDDER_AT of the chord, the rudder)
    const k = 1;
    wing(m, root(Fn.rootLE), root(Fn.rootTE), tipP(Fn.tipLE), tipP(Fn.tipTE), Fn.rootT, Fn.tipT, out, P, GREY, 5, 2, RUDDER_AT);
    // a dark band near the top of each tail (a squadron's tail flash)
    const b0 = 0.78, b1 = 0.9, kk = RUDDER_AT * k;
    const band = [lerp3(root(Fn.rootLE), tipP(Fn.tipLE), b0), lerp3(root(Fn.rootLE + (Fn.rootTE - Fn.rootLE) * kk), tipP(Fn.tipLE + (Fn.tipTE - Fn.tipLE) * kk), b0),
      lerp3(root(Fn.rootLE + (Fn.rootTE - Fn.rootLE) * kk), tipP(Fn.tipLE + (Fn.tipTE - Fn.tipLE) * kk), b1), lerp3(root(Fn.rootLE), tipP(Fn.tipLE), b1)];
    const off = (p, d) => [p[0] + out[0] * d, p[1] + out[1] * d, p[2]];
    plate(m, ...band.map((p) => off(p, 0.045)), 1, [0.12, 0.12, 0.14, 1], PAINT_TEX());
    plate(m, ...band.map((p) => off(p, -0.045)), 1, [0.12, 0.12, 0.14, 1], PAINT_TEX());
  }
  // ---- the nozzles' housings (their flaps move)
  for (const [x] of J.NOZZLES) box(m, x - 0.54, -0.44, 7.2, x + 0.54, 0.26, 8.0, PD, NOZZLE);
  // the "stinger" between them
  quad(m, [-0.2, 0.2, 7.3], [0.2, 0.2, 7.3], [0.1, 0.05, 8.9], [-0.1, 0.05, 8.9], PD, GREY_DARK, PAINT_TEX());
  quad(m, [-0.1, 0.05, 8.9], [0.1, 0.05, 8.9], [0.2, -0.36, 7.3], [-0.2, -0.36, 7.3], PD, GREY_DARK, PAINT_TEX());
  // ---- lights: formation strips (pale green), navigation lights at the wingtips
  STILL_PARTS.lights0 = m.n;
  for (const s of [-1, 1]) {
    plate(m, [1.2 * s, 0.05, -6.6], [1.32 * s, 0.03, -6.0], [1.34 * s, -0.08, -6.0], [1.22 * s, -0.06, -6.6], glow(0.6), [0.55, 1, 0.6, 0.9], tex(BLOCK.LIME_WOOL));
    plate(m, [(J.WING.tipX - 0.05) * s, -0.13, 1.45], [(J.WING.tipX + 0.03) * s, -0.13, 1.9], [(J.WING.tipX + 0.03) * s, -0.2, 1.9], [(J.WING.tipX - 0.05) * s, -0.2, 1.45], glow(0.9), s < 0 ? [1, 0.12, 0.1, 1] : [0.15, 1, 0.3, 1], tex(BLOCK.WHITE_WOOL));
  }
  STILL_PARTS.lights1 = m.n;
  camouflage(m, 0, m.n);
  return m;
}
const STILL_PARTS = {};
function still() { if (!STILL) STILL = buildStill(); return STILL; }

// Its paint: the F-22's two greys, soft-edged patches of the darker (FS 36170) over the lighter
// (FS 36375), the same on both sides; on what is painted the lighter grey.
function camouflage(m, from, to) {
  const d = m.d;
  const patch = (x, y, z) => {
    const ax = Math.abs(x);
    return Math.sin(ax * 0.62 + z * 0.23 + 0.7) * Math.sin(z * 0.41 - ax * 0.18 + 1.9) + 0.45 * Math.sin(z * 0.17 + ax * 0.47 - 0.6) + 0.12 * y;
  };
  for (let i = from * VF, n = to * VF; i < n; i += VF) {
    if (Math.abs(d[i + 10] - GREY[0]) > 1e-4 || Math.abs(d[i + 11] - GREY[1]) > 1e-4) continue;
    const k = Math.max(0, Math.min(1, (patch(d[i], d[i + 1], d[i + 2]) - 0.18) / 0.3));
    const kk = k * k * (3 - 2 * k);
    for (let c = 0; c < 3; c++) d[i + 10 + c] = GREY[c] + (GREY_CAMO[c] - GREY[c]) * kk;
  }
}

// ---------------------------------------------------------------- built each frame
// look: { stab (-1..1 nose up), roll (-1..1 right), yaw (-1..1 right), vector (0..1 nozzles
// down), throttle (0..1), ab (0..1 afterburner), gear (0..1 down), bays (0..1 open), gun (firing),
// cockpit (seen from inside: no canopy), eye (as for saucers) }
const MOVING = new Mesh(6000);
function buildMoving(m, t, look) {
  const P = metal(0.5), PD = metal(0.55);
  const eye = Math.sqrt(look.eye ?? 1);
  // ---- stabilators: all-moving, about their pivot
  const S = J.STAB;
  for (const s of [-1, 1]) {
    const ang = ((look.stab || 0) * 0.32 + (look.roll || 0) * 0.12 * s);
    const c = Math.cos(ang), sn = Math.sin(ang);
    const rot = (p) => { const dz = p[2] - S.pivotZ, dy = p[1] - S.y; return [p[0], S.y + dy * c + dz * sn, S.pivotZ - dy * sn + dz * c]; };
    const X = (x, z) => rot([x * s, S.y, z]);
    wing(m, X(S.rootX, S.rootLE), X(S.rootX, S.rootTE), X(S.tipX, S.tipLE), X(S.tipX, S.tipTE), S.rootT, S.tipT, [0, 1, 0], P, GREY, 4, 2);
  }
  // ---- the wings' trailing edges: flaperons inboard, ailerons outboard (down on the side that
  // rises; both down a little, slow, for lift)
  const W = J.WING;
  for (const s of [-1, 1]) {
    const defl = -(look.roll || 0) * 0.35 * s + (look.flaps || 0) * 0.3;
    const te = (k) => lerp3([1.9 * s, W.rootY, W.rootTE], [W.tipX * s, W.tipY, W.tipTE - 0.12], k);
    const le = (k) => lerp3([1.9 * s, W.rootY, W.rootLE], [W.tipX * s, W.tipY, W.tipLE + 0.36], k);
    const th = (k) => halfThick(W.rootT + (W.tipT - W.rootT) * k, FLAP_AT);
    for (const [k0, k1] of [[0.0, 0.48], [0.5, 1.0]]) {
      flap(m, lerp3(le(k0), te(k0), FLAP_AT), lerp3(le(k1), te(k1), FLAP_AT), th(k0), th(k1), te(k0), te(k1), [0, 1, 0], defl, P, GREY);
    }
  }
  // ---- rudders
  const Fn = J.FIN;
  for (const s of [-1, 1]) {
    const up = [Math.sin(Fn.cant) * s, Math.cos(Fn.cant), 0];
    const out = [Math.cos(Fn.cant) * s, -Math.sin(Fn.cant), 0];
    const k = RUDDER_AT;
    const root = (f) => [Fn.rootX * s, Fn.rootY, Fn.rootLE + (Fn.rootTE - Fn.rootLE) * f];
    const tip = (f) => [Fn.rootX * s + up[0] * Fn.span, Fn.rootY + up[1] * Fn.span, Fn.tipLE + (Fn.tipTE - Fn.tipLE) * f];
    // (both rudders the same way: trailing edges to the left for a turn to the left)
    const a = (look.yaw || 0) * 0.4 * s;
    flap(m, root(k), tip(k), halfThick(Fn.rootT, k), halfThick(Fn.tipT, k), root(1), tip(1), out, a, P, GREY);
  }
  // ---- the nozzles: flaps above and below each, turned down for hovering (thrust vectoring)
  const v = (look.vector || 0) * 0.35 - (look.stab || 0) * 0.15;
  for (const [x, y, z] of J.NOZZLES) {
    const flap = (y0, sign) => {
      const a = [x - 0.52, y0, 8.0], b = [x + 0.52, y0, 8.0];
      const L = 0.85;
      const c = [x + 0.48, y0 - Math.sin(v) * L + sign * 0.06, 8.0 + Math.cos(v) * L], d = [x - 0.48, y0 - Math.sin(v) * L + sign * 0.06, 8.0 + Math.cos(v) * L];
      plate(m, a, b, c, d, PD, NOZZLE, PAINT_TEX());
    };
    flap(0.24, -1);
    flap(-0.42, 1);
    // the exhaust's glow deep in the nozzle: a dull red at idle, white-hot burning (dark, parked)
    const hot = look.parked ? 0 : Math.min(1, 0.06 + (look.throttle || 0) * 0.3 + (look.ab || 0) * 0.64);
    if (hot > 0.01) plate(m, [x - 0.46, 0.2, 8.02], [x + 0.46, 0.2, 8.02], [x + 0.46, -0.38, 8.02], [x - 0.46, -0.38, 8.02], glow(hot * hot * eye + hot * 0.25), [1, 0.22 + hot * 0.55, 0.06 + hot * 0.6, 0.95], tex(BLOCK.SEA_LANTERN));
    else plate(m, [x - 0.46, 0.2, 8.02], [x + 0.46, 0.2, 8.02], [x + 0.46, -0.38, 8.02], [x - 0.46, -0.38, 8.02], 1, DUCT, tex(BLOCK.BLACK_WOOL));
    // the afterburner: a long flame, blue-white at its root, with shock diamonds
    const ab = look.ab || 0;
    if (ab > 0.02) {
      const fl = 0.85 + 0.15 * Math.sin(t * 37 + x * 9);
      const L = (3.2 + 5.5 * ab) * fl;
      const dir = [0, -Math.sin(v), Math.cos(v)];
      const at = (k) => [x, -0.09 + dir[1] * (0.85 + k * L), 8.0 + dir[2] * (0.85 + k * L)];
      const rings = [];
      for (const [k, w, h] of [[0, 0.46, 0.27], [0.15, 0.42, 0.25], [0.45, 0.32, 0.2], [0.75, 0.18, 0.12], [1, 0.02, 0.02]]) {
        const c = at(k), r = [];
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; r.push([c[0] + Math.cos(a) * w, c[1] + Math.sin(a) * h, c[2]]); }
        rings.push(r);
      }
      loft(m, rings, glow(0.75 * eye), [1, 0.55, 0.22, 0.9], true, 0.3);
      for (let d = 0; d < 4; d++) {
        const c = at(0.14 + d * 0.17), w = 0.24 - d * 0.04;
        plate(m, [c[0] - w, c[1] + w * 0.55, c[2]], [c[0] + w, c[1] + w * 0.55, c[2]], [c[0] + w, c[1] - w * 0.55, c[2]], [c[0] - w, c[1] - w * 0.55, c[2]], glow(eye), [1, 0.9, 0.75, 0.9], tex(BLOCK.SEA_LANTERN));
      }
    }
  }
  // ---- landing gear: nose gear and two main gears, folding up into the body
  const g = look.gear ?? 1;
  if (g > 0.02) {
    const drop = (y) => -0.6 + (y + 0.6) * g; // (pulled up towards the belly as it folds)
    // the nose gear
    const ny = drop(-1.65);
    box(m, -0.07, ny, -6.67, 0.07, -0.5, -6.53, metal(0.3), STRUT);
    wheel(m, [0, ny, -6.6], 0.3 * Math.max(0.3, g), 0.12, 1, TYRE);
    plate(m, [-0.3, -0.52, -7.5], [-0.3, -0.52, -6.4], [-0.32, -0.52 - 0.5 * g, -6.4], [-0.32, -0.52 - 0.5 * g, -7.5], P, GREY_DARK, PAINT_TEX());
    // the main gears
    for (const s of [-1, 1]) {
      const my = drop(-1.53);
      box(m, 1.55 * s - 0.09, my, 0.52, 1.55 * s + 0.09, -0.75, 0.68, metal(0.3), STRUT);
      beam(m, [1.55 * s, my + 0.35, 0.6], [1.2 * s, -0.78, 0.0], 0.08, STRUT);
      wheel(m, [1.55 * s + 0.06 * s, my, 0.6], 0.42 * Math.max(0.3, g), 0.15, 1, TYRE);
      plate(m, [1.0 * s, -0.8, -0.3], [1.0 * s, -0.8, 1.3], [(1.0 + 0.55 * g) * s, -0.8 - 0.35 * g, 1.3], [(1.0 + 0.55 * g) * s, -0.8 - 0.35 * g, -0.3], P, GREY_DARK, PAINT_TEX());
    }
  }
  // ---- the weapons bays' doors, and the missiles in them while they are open
  const b = look.bays || 0;
  if (b > 0.02) {
    const B = J.BAY_MAIN;
    for (const s of [-1, 1]) {
      const hinge = [B.x * s, B.y, 0];
      const ang = b * 1.75;
      const tipX = hinge[0] - s * Math.cos(ang) * B.x, tipY = hinge[1] - Math.sin(ang) * B.x;
      plate(m, [hinge[0], hinge[1], B.z0], [hinge[0], hinge[1], B.z1], [tipX, tipY, B.z1], [tipX, tipY, B.z0], P, GREY_DARK, PAINT_TEX());
    }
    // the bay's dark inside
    plate(m, [-B.x, B.y + 0.02, B.z0], [B.x, B.y + 0.02, B.z0], [B.x, B.y + 0.02, B.z1], [-B.x, B.y + 0.02, B.z1], 1, DUCT, tex(BLOCK.BLACK_WOOL));
    const left = look.missiles ?? 8;
    for (let i = 0; i < Math.min(6, left); i++) {
      const [mx, my, mz] = J.MISSILE_STATIONS[i];
      slender(m, mx, my - (1 - b) * 0.3, mz - 1.85, mz + 1.85, 0.09, metal(0.4), MISSILE);
    }
  }
  // ---- the gun's door opens as it fires, a flash at its muzzle
  if (look.gun) {
    const [gx, gy, gz] = J.GUN;
    const f = 0.6 + 0.4 * Math.sin(t * 90);
    plate(m, [gx - 0.18, gy + 0.08, gz - 0.25], [gx + 0.18, gy + 0.08, gz - 0.25], [gx + 0.18, gy - 0.12, gz - 0.25], [gx - 0.18, gy - 0.12, gz - 0.25], glow(eye * f), [1, 0.85, 0.45, 0.9], tex(BLOCK.SEA_LANTERN));
    for (let k = 0; k < 3; k++) {
      const s = 0.25 + k * 0.22;
      tri(m, [gx, gy + s * 0.5, gz - 0.3 - s * 1.6], [gx - s * 0.6, gy - s * 0.3, gz - 0.3], [gx + s * 0.6, gy - s * 0.3, gz - 0.3], glow(eye * f), [1, 0.75, 0.3, 0.9], tex(BLOCK.SEA_LANTERN));
    }
  }
}

// A square beam from p to q (gear braces).
function beam(m, p, q, w, tint) {
  const d = norm3(sub3(q, p));
  const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const a = norm3(cross3(d, up)), b = cross3(a, d);
  const h = w / 2;
  const C = (e, s, i) => [e[0] + (a[0] * s + b[0] * i) * h, e[1] + (a[1] * s + b[1] * i) * h, e[2] + (a[2] * s + b[2] * i) * h];
  const L = PAINT_TEX();
  for (const [s0, i0, s1, i1] of [[1, 1, 1, -1], [1, -1, -1, -1], [-1, -1, -1, 1], [-1, 1, 1, 1]]) quad(m, C(p, s0, i0), C(q, s0, i0), C(q, s1, i1), C(p, s1, i1), metal(0.3), tint, L);
}

// ---------------------------------------------------------------- into the frame
// How many floats one jet takes at most (for the entity mesh's buffer).
export function jetFloats() {
  return (still().n + 6000) * 16;
}

function put(out, o, mesh, R, org, light, from = 0, to = mesh.n) {
  const d = mesh.d;
  const r0 = R[0], r1 = R[1], r2 = R[2], r3 = R[3], r4 = R[4], r5 = R[5], r6 = R[6], r7 = R[7], r8 = R[8];
  const ox = org[0], oy = org[1], oz = org[2], sky = light[0], blk = light[1];
  for (let i = from * VF, n = to * VF; i < n; i += VF) {
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

// pos: the jet's centre; rot: its rotation (row-major 3x3, see jetform.js); cam: the camera
// (positions are sent relative to it); light: [sky, block] 0..1; t: seconds; look: see above.
export function emitJet(out, o, pos, rot, cam, light, t, look = {}) {
  const org = [pos[0] - cam[0], pos[1] - cam[1], pos[2] - cam[2]];
  const s = still();
  if (look.cockpit) {
    // (seen from the seat: everything but the canopy)
    o = put(out, o, s, rot, org, light, 0, STILL_PARTS.canopy0);
    o = put(out, o, s, rot, org, light, STILL_PARTS.canopy1, s.n);
  } else o = put(out, o, s, rot, org, light);
  MOVING.n = 0;
  buildMoving(MOVING, t, look);
  return put(out, o, MOVING, rot, org, light);
}

// A missile in flight (AIM-120 or AIM-9): body along its velocity, fins, and its motor's flame.
const MISSILE_MESH = new Mesh(600);
export function emitMissile(out, o, pos, dir, cam, light, t, burning, eye = 1) {
  const m = MISSILE_MESH;
  m.n = 0;
  slender(m, 0, 0, -1.85, 1.85, 0.09, metal(0.4), MISSILE);
  for (const [a, b] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
    plate(m, [a * 0.08, b * 0.08, 1.2], [a * 0.08, b * 0.08, 1.8], [a * 0.3, b * 0.3, 1.8], [a * 0.28, b * 0.28, 1.45], metal(0.5), GREY, PAINT_TEX());
  }
  if (burning) {
    const L = 1.2 + 0.4 * Math.sin(t * 50);
    const e = Math.sqrt(eye);
    tri(m, [-0.08, 0, 1.86], [0.08, 0, 1.86], [0, 0, 1.86 + L], glow(e), [1, 0.85, 0.5, 0.9], tex(BLOCK.SEA_LANTERN));
    tri(m, [0, -0.08, 1.86], [0, 0.08, 1.86], [0, 0, 1.86 + L], glow(e), [1, 0.85, 0.5, 0.9], tex(BLOCK.SEA_LANTERN));
  }
  // its frame: -z along dir
  const f = norm3(dir);
  const up = Math.abs(f[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const x = norm3(cross3(up, [-f[0], -f[1], -f[2]]));
  const y = cross3([-f[0], -f[1], -f[2]], x);
  const R = [x[0], y[0], -f[0], x[1], y[1], -f[1], x[2], y[2], -f[2]];
  return put(out, o, m, R, [pos[0] - cam[0], pos[1] - cam[1], pos[2] - cam[2]], light);
}
export const MISSILE_FLOATS = 600 * 16;

// A cannon round's tracer: a streak of light behind it along the way it flies, turned to face the
// camera (wider further off, so it shows from a distance).
const TRACER_MESH = new Mesh(12);
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function emitTracer(out, o, pos, vel, cam, eye = 1) {
  const m = TRACER_MESH;
  m.n = 0;
  const d = norm3(vel);
  const toCam = sub3(cam, pos);
  const dist = Math.hypot(toCam[0], toCam[1], toCam[2]);
  const len = Math.min(36, 12 + dist * 0.04);
  const w = 0.08 + dist * 0.002;
  const side = norm3(cross3(d, toCam));
  const s = [side[0] * w, side[1] * w, side[2] * w];
  const tail = [-d[0] * len, -d[1] * len, -d[2] * len];
  const L = tex(BLOCK.SEA_LANTERN);
  const g = glow(Math.min(1, 0.6 + 0.4 * Math.sqrt(eye)));
  plate(m, [-s[0], -s[1], -s[2]], [s[0], s[1], s[2]], [tail[0] + s[0] * 0.4, tail[1] + s[1] * 0.4, tail[2] + s[2] * 0.4], [tail[0] - s[0] * 0.4, tail[1] - s[1] * 0.4, tail[2] - s[2] * 0.4], g, [1, 0.72, 0.32, 0.95], L);
  return put(out, o, m, IDENTITY, [pos[0] - cam[0], pos[1] - cam[1], pos[2] - cam[2]], [1, 1]);
}
export const TRACER_FLOATS = 12 * 16;
