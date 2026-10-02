// The saucer base on the Earth: a spaceport where any flying saucer can come down (the saucer
// panel's "Earth base", see game/saucer.js). Five launch pads, each as big as the Moon's, round a
// plaza with the terminal and its control tower, taxiways out to the pads lit along their edges, a
// ring of lights round the deck; levelled into the land, the hills cut away over it and the ground
// built up under it. One to a world, on the most open, level land a few hundred blocks out from the
// middle, chosen by the world's seed (so every game on a server has it in the same place).
//
// Only the new (384 high) terrain has it: the old worlds' terrain never changes.

import { BLOCK as B, IS_SOLID, WORLD_HEIGHT as H } from './blocks.js';
import { padBlock, PAD_R } from './planets.js';
import { hash2 } from './noise.js';

export const BASE_R = 128; // the deck's radius
export const BASE_PADS = 5;
export const BASE_PAD_RING = 88; // how far the pads' middles are from the base's
const CLEAR = 46; // how high it is cleared over the deck (a saucer is 31 high, the tower 45)
const PLAZA_R = 26;
const TERMINAL_R = 12;
const SHAFT_R = 4.5;
const CABIN_R = 8;

// Where the base is, and its pads: { x, z, y (the deck), pads: [[x, z]] (their middles) }, or null.
export function planSaucerBase(gen) {
  if (gen._saucerBase !== undefined) return gen._saucerBase;
  const sea = gen.sea ?? 63;
  const col = {};
  const turn = hash2(11, 23, (gen.seed | 0) ^ 0x5a17) * Math.PI * 2;
  let best = null;
  for (const ring of [460, 620, 780]) {
    for (let k = 0; k < 12; k++) {
      const a = turn + (k / 12) * Math.PI * 2;
      const x = Math.round(Math.cos(a) * ring), z = Math.round(Math.sin(a) * ring);
      const hs = [];
      let wet = 0;
      for (const [r, n] of [[0, 1], [45, 6], [85, 10], [120, 14]]) {
        for (let i = 0; i < n; i++) {
          const b = (i / n) * Math.PI * 2 + r;
          gen.column(Math.round(x + Math.cos(b) * r), Math.round(z + Math.sin(b) * r), col);
          hs.push(col.height);
          if (col.height <= sea) wet++;
        }
      }
      hs.sort((p, q) => p - q);
      const mid = hs[hs.length >> 1];
      const spread = hs[hs.length - 3] - hs[2];
      let score = spread + wet * 5 + Math.max(0, mid - (sea + 30)) * 2 + ring * 0.004;
      if (gen.structures && gen.structures.nearestVillage(x, z, BASE_R + 60)) score += 1000;
      if (!best || score < best.score) best = { score, x, z, mid };
    }
  }
  const y = Math.max(sea + 3, Math.min(sea + 45, best.mid));
  const pads = [];
  for (let k = 0; k < BASE_PADS; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / BASE_PADS;
    pads.push([Math.round(best.x + Math.cos(a) * BASE_PAD_RING), Math.round(best.z + Math.sin(a) * BASE_PAD_RING)]);
  }
  gen._saucerBase = { x: best.x, z: best.z, y, pads };
  return gen._saucerBase;
}

// The deck at (dx, dz) from the base's middle (d from it): pads, plaza, taxiways, apron, rim.
function deckBlock(plan, wx, wz, dx, dz, d) {
  for (const [px, pz] of plan.pads) {
    const fx = wx + 0.5 - px, fz = wz + 0.5 - pz;
    const pd = Math.hypot(fx, fz);
    if (pd <= PAD_R) return padBlock(fx, fz, pd, B.SMOOTH_STONE);
  }
  if (d < PLAZA_R) return d > PLAZA_R - 1.5 && Math.abs(((Math.atan2(dz, dx) / (Math.PI / 16)) % 1 + 1) % 1 - 0.5) > 0.3 ? B.SEA_LANTERN : B.QUARTZ_BLOCK;
  if (d > BASE_R - 2) return Math.abs(((Math.atan2(dz, dx) / (Math.PI / 40)) % 1 + 1) % 1 - 0.5) > 0.42 ? B.SEA_LANTERN : B.STONE_BRICKS;
  // a taxiway out to each pad: a yellow line down its middle, lights along its edges
  for (const [px, pz] of plan.pads) {
    const ux = px + 0.5 - plan.x, uz = pz + 0.5 - plan.z;
    const L = Math.hypot(ux, uz);
    const along = (dx * ux + dz * uz) / L, across = (dx * uz - dz * ux) / L;
    if (along < PLAZA_R || along > L - PAD_R + 1) continue;
    if (Math.abs(across) < 0.6) return B.YELLOW_WOOL;
    if (Math.abs(Math.abs(across) - 6) < 0.5 && Math.abs((((along - PLAZA_R) / 7) % 1) - 0.5) > 0.36) return B.SEA_LANTERN;
    if (Math.abs(across) < 6.5) return B.LIGHT_GRAY_TERRACOTTA;
  }
  // the apron, in slabs of concrete
  const jx = ((Math.floor(dx) % 16) + 16) % 16, jz = ((Math.floor(dz) % 16) + 16) % 16;
  return jx === 0 || jz === 0 ? B.LIGHT_GRAY_WOOL : B.SMOOTH_STONE;
}

// The terminal and its tower at (dx, ly, dz) from the base's middle and its deck (0 for none).
function towerBlock(dx, ly, dz, d) {
  const a = Math.atan2(dz, dx);
  const door = (w) => Math.min(Math.abs(dx), Math.abs(dz)) < w; // (the four ways in, on the axes)
  // the terminal: a round hall with a band of windows, a door on each side
  if (ly >= 1 && ly <= 6 && d < TERMINAL_R) {
    if (ly === 6) return d < SHAFT_R - 1 ? 0 : B.SMOOTH_STONE;
    if (d >= TERMINAL_R - 1) {
      if (ly <= 3 && door(1.6)) return 0;
      return ly === 2 || ly === 3 || ly === 4 ? B.GLASS : B.QUARTZ_BLOCK;
    }
    if (ly === 1 && d < TERMINAL_R - 1.5 && Math.abs(d - 7) < 0.5) return B.SEA_LANTERN; // (lights round the floor)
  }
  // the shaft up to the cabin, narrow windows on the way
  if (ly >= 1 && ly <= 30 && d < SHAFT_R && d >= SHAFT_R - 1) {
    if (ly <= 3 && door(1.2) && ly < 4) return 0;
    if (ly > 7 && ly % 6 === 0 && Math.abs(((a / (Math.PI / 4)) % 1 + 1) % 1 - 0.5) > 0.38) return B.GLASS;
    return B.QUARTZ_BLOCK;
  }
  // the control cabin: glass all round between pillars, a floor and a roof, a mast and its beacon
  if (ly === 30 && d < CABIN_R) return d < SHAFT_R - 1 && Math.abs(dx) < 1 && dz < -2 ? 0 : B.SMOOTH_STONE;
  if (ly >= 31 && ly <= 35 && d < CABIN_R && d >= CABIN_R - 1) {
    return Math.abs(((a / (Math.PI / 4)) % 1 + 1) % 1 - 0.5) > 0.44 ? B.QUARTZ_BLOCK : B.GLASS;
  }
  if (ly === 31 && d < CABIN_R - 1.5 && Math.abs(d - 5.5) < 0.5) return B.SEA_LANTERN;
  if (ly === 36 && d < CABIN_R + 0.5) return d > CABIN_R - 0.5 ? B.SEA_LANTERN : B.QUARTZ_BLOCK;
  if (ly >= 37 && ly <= 44 && d < 0.75) return B.IRON_BARS;
  if (ly === 45 && d < 0.75) return B.SEA_LANTERN;
  return -1;
}

// The base's part in one chunk (ctx: structures.js ChunkCtx).
export function pasteSaucerBase(ctx, plan) {
  if (!plan) return;
  const { x: bx, z: bz, y } = plan;
  const reach = BASE_R + 3;
  if (!ctx.touches(bx - reach, bz - reach, bx + reach, bz + reach)) return;
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const wx = ctx.x0 + lx, wz = ctx.z0 + lz;
      const dx = wx + 0.5 - bx, dz = wz + 0.5 - bz;
      const d = Math.hypot(dx, dz);
      if (d > BASE_R + 0.5) continue;
      // the hills cut away over it, the ground built up under it (through water too)
      for (let yy = y + 1; yy <= Math.min(H - 1, y + CLEAR); yy++) ctx.set(wx, yy, wz, 0);
      for (let yy = y - 1; yy > 1; yy--) {
        const b = ctx.get(wx, yy, wz);
        if (b > 0 && IS_SOLID[b] && b !== B.OAK_LEAVES && b !== B.SPRUCE_LEAVES && b !== B.BIRCH_LEAVES) break;
        ctx.set(wx, yy, wz, d > BASE_R - 2 ? B.STONE_BRICKS : B.STONE);
      }
      ctx.set(wx, y, wz, deckBlock(plan, wx, wz, dx, dz, d));
      // a low kerb round the edge
      if (d > BASE_R - 1) ctx.set(wx, y + 1, wz, B.STONE_BRICK_SLAB);
      if (d < TERMINAL_R + 1) {
        for (let ly = 1; ly <= 45; ly++) {
          const b = towerBlock(dx, ly, dz, d);
          if (b >= 0) ctx.set(wx, y + ly, wz, b);
        }
        // a ladder up the inside of the shaft, against its north wall
        if (Math.floor(dx) === 0 && Math.floor(dz) === -3) for (let ly = 1; ly <= 30; ly++) ctx.set(wx, y + ly, wz, B.LADDER, 0);
      }
    }
  }
}
