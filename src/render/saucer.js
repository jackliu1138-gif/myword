// A flying saucer, built of little block-textured boxes (so it looks of a piece with the world): a
// stepped silver disc of iron and quartz, a ring of coloured lights round its rim that chase each
// other, a glass dome on top that the pilot shows through, a glowing engine underneath with
// thruster nozzles round it, a blinking light on top and three landing legs that fold away in
// flight. Drawn for parked saucers and for whoever flies one.
//
// Entity shader modes used here: 1 a block texture; 4 + e*0.95 a block texture that glows with
// strength e (0..1); 5 + r*0.95 a block texture as polished metal of roughness r.

import { BLOCK, FACE_TEX } from '../world/blocks.js';

const V = 0.25; // the size of a step of the disc, in blocks
export const SAUCER_LEG = 0.85; // how far the legs reach below the hull
export const SAUCER_RIM = 2.75; // the rim's radius
export const SAUCER_SEAT = SAUCER_LEG + 0.95; // where the pilot sits, above the saucer's foot
const LIGHT_COLOURS = [[1, 0.25, 0.3], [1, 0.8, 0.25], [0.35, 1, 0.5], [0.3, 0.9, 1], [0.4, 0.55, 1], [1, 0.4, 0.9]];

// the faces of a box: corner indices into [x0|x1, y0|y1, z0|z1], their normal, and which of a
// block's textures they show (0 top, 1 bottom, 2 side)
const FACES = [
  { c: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]], n: [0, 1, 0], tex: 0, uv: (w, h, d) => [w, d] },
  { c: [[0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]], n: [0, -1, 0], tex: 1, uv: (w, h, d) => [w, d] },
  { c: [[0, 1, 1], [1, 1, 1], [1, 0, 1], [0, 0, 1]], n: [0, 0, 1], tex: 2, uv: (w, h) => [w, h] },
  { c: [[1, 1, 0], [0, 1, 0], [0, 0, 0], [1, 0, 0]], n: [0, 0, -1], tex: 2, uv: (w, h) => [w, h] },
  { c: [[1, 1, 1], [1, 1, 0], [1, 0, 0], [1, 0, 1]], n: [1, 0, 0], tex: 2, uv: (w, h, d) => [d, h] },
  { c: [[0, 1, 0], [0, 1, 1], [0, 0, 1], [0, 0, 0]], n: [-1, 0, 0], tex: 2, uv: (w, h, d) => [d, h] },
];
const QUAD = [0, 1, 2, 0, 2, 3];

// rotation: yaw about y, then pitch about x, then roll about z (the saucer banking in flight)
function rotation(yaw, pitch, roll) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  // Ry * Rx * Rz as rows
  return [
    cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp,
    cp * sr, cp * cr, -sp,
    -sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp,
  ];
}

class Builder {
  constructor(out, o, R, origin, light) {
    this.out = out; this.o = o; this.R = R; this.origin = origin; this.light = light;
  }

  // a box (local blocks, y up from the saucer's foot) of a block's textures, tiled once a block
  box(x0, y0, z0, x1, y1, z1, block, mode = 1, tint = [1, 1, 1, 0]) {
    const { out, R, origin } = this;
    let o = this.o;
    const X = [x0, x1], Y = [y0, y1], Z = [z0, z1];
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    for (const f of FACES) {
      const nx = R[0] * f.n[0] + R[1] * f.n[1] + R[2] * f.n[2];
      const ny = R[3] * f.n[0] + R[4] * f.n[1] + R[5] * f.n[2];
      const nz = R[6] * f.n[0] + R[7] * f.n[1] + R[8] * f.n[2];
      const layer = FACE_TEX[block * 4 + f.tex];
      const [uw, vh] = f.uv(w, h, d);
      const uv = [[0, 0], [uw, 0], [uw, vh], [0, vh]];
      for (const qi of QUAD) {
        const c = f.c[qi];
        const lx = X[c[0]], ly = Y[c[1]], lz = Z[c[2]];
        out[o++] = origin[0] + R[0] * lx + R[1] * ly + R[2] * lz;
        out[o++] = origin[1] + R[3] * lx + R[4] * ly + R[5] * lz;
        out[o++] = origin[2] + R[6] * lx + R[7] * ly + R[8] * lz;
        out[o++] = nx; out[o++] = ny; out[o++] = nz;
        out[o++] = uv[qi][0]; out[o++] = uv[qi][1];
        out[o++] = layer; out[o++] = this.light[0]; out[o++] = this.light[1]; out[o++] = mode;
        out[o++] = tint[0]; out[o++] = tint[1]; out[o++] = tint[2]; out[o++] = tint[3];
      }
    }
    this.o = o;
  }

  // a stepped disc of radius r between heights y0 and y1, in rows along z
  disc(r, y0, y1, block, mode, tint) {
    for (let z = -r; z < r - 1e-6; z += V) {
      const zc = z + V / 2;
      const hw = Math.round(Math.sqrt(Math.max(0, r * r - zc * zc)) / V) * V;
      if (hw <= 0) continue;
      this.box(-hw, y0, z, hw, y1, Math.min(z + V, r), block, mode, tint);
    }
  }
}

// How many floats one saucer can take (for the mesh's buffer).
export const SAUCER_FLOATS = 220 * 36 * 16;

// pos: the saucer's foot (where its legs stand when down), cam: the camera (positions are sent
// relative to it), light: [sky, block] 0..1, t: seconds (performance.now), look: { legs 0..1 (down),
// engine 0..1 (the thrust), pitch, roll (banking, radians) }.
export function emitSaucer(out, o, pos, yaw, cam, light, t, look = {}) {
  const legs = look.legs ?? 1, engine = look.engine ?? 0;
  const R = rotation(yaw, look.pitch || 0, look.roll || 0);
  const b = new Builder(out, o, R, [pos[0] - cam[0], pos[1] - cam[1], pos[2] - cam[2]], light);
  const metal = (r) => 5 + r * 0.95;
  const glow = (e) => 4 + Math.max(0, Math.min(1, e)) * 0.95;
  const hb = SAUCER_LEG; // the hull's bottom
  // the engine underneath, brighter with the thrust, and the nozzles round it
  b.disc(0.75, hb - 0.2, hb, BLOCK.SEA_LANTERN, glow(0.35 + 0.65 * engine), [0.35, 0.85, 1, 0.55]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6, x = Math.cos(a) * 1.25, z = Math.sin(a) * 1.25;
    b.box(x - 0.14, hb - 0.12, z - 0.14, x + 0.14, hb, z + 0.14, BLOCK.MAGMA_BLOCK, glow(0.15 + 0.85 * engine), [1, 0.55, 0.15, 0.4]);
  }
  // the hull: polished metal in steps out to the rim and back in
  b.disc(1.75, hb, hb + 0.25, BLOCK.IRON_BLOCK, metal(0.32));
  b.disc(2.4, hb + 0.25, hb + 0.5, BLOCK.IRON_BLOCK, metal(0.28));
  b.disc(SAUCER_RIM, hb + 0.5, hb + 0.78, BLOCK.QUARTZ_BLOCK, metal(0.22));
  b.disc(2.3, hb + 0.78, hb + 1.02, BLOCK.IRON_BLOCK, metal(0.26));
  b.disc(1.6, hb + 1.02, hb + 1.2, BLOCK.QUARTZ_BLOCK, metal(0.2));
  // the ring of lights, chasing round (steadier when parked)
  const n = 12;
  const speed = engine > 0.05 ? 7 : 1.6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, x = Math.cos(a) * (SAUCER_RIM + 0.02), z = Math.sin(a) * (SAUCER_RIM + 0.02);
    const wave = 0.5 + 0.5 * Math.sin(t * speed - i * (Math.PI * 2 / n) * 2);
    const c = LIGHT_COLOURS[i % LIGHT_COLOURS.length];
    b.box(x - 0.13, hb + 0.53, z - 0.13, x + 0.13, hb + 0.75, z + 0.13, BLOCK.SEA_LANTERN, glow(0.35 + 0.65 * wave), [c[0], c[1], c[2], 0.75]);
  }
  // the glass dome (the pilot sits in it), a blinking light on top
  b.disc(1.25, hb + 1.2, hb + 1.8, BLOCK.GLASS, 1, [1, 1, 1, -2]);
  b.disc(0.95, hb + 1.8, hb + 2.15, BLOCK.GLASS, 1, [1, 1, 1, -2]);
  b.disc(0.55, hb + 2.15, hb + 2.4, BLOCK.GLASS, 1, [1, 1, 1, -2]);
  const blink = Math.sin(t * 5) > 0.3 ? 1 : 0.15;
  b.box(-0.08, hb + 2.4, -0.08, 0.08, hb + 2.62, 0.08, BLOCK.RED_WOOL, glow(blink), [1, 0.15, 0.1, 0.8]);
  // the legs: down to the ground when parked, folded into the hull in flight
  if (legs > 0.02) {
    const L = SAUCER_LEG * legs;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2, x = Math.cos(a) * 1.45, z = Math.sin(a) * 1.45;
      b.box(x - 0.08, hb - L, z - 0.08, x + 0.08, hb, z + 0.08, BLOCK.IRON_BLOCK, metal(0.4));
      b.box(x - 0.24, hb - L, z - 0.24, x + 0.24, hb - L + 0.08, z + 0.24, BLOCK.IRON_BLOCK, metal(0.45));
    }
  }
  return b.o;
}
