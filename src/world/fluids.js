// Flowing water and lava. A liquid's level lives in its block state (see blocks.js): 0 a source,
// 1-7 flowing further from one, +8 falling. A change next to a liquid has the liquid cells
// around it take another look a moment later (water every 0.25 s, lava every 1.5 s, or 0.5 s in
// the Nether): a flowing cell works out its level from what feeds it, or dries up, and every
// liquid spreads down, or out to the sides when it can't fall. Water between two sources on firm
// ground becomes a source itself; lava meeting water turns to obsidian (a source) or cobblestone.
// Only changes made in this game flow here: another player's game runs the flows they start and
// sends us the result as block edits.

import { BLOCK, BLOCKS, IS_LIQUID, IS_SOLID, LIQUID_FALLING, CHUNK_SIZE } from './blocks.js';

const WATER = BLOCK.WATER, LAVA = BLOCK.LAVA;
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const AROUND = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
const MAX_QUEUE = 20000;
const BUDGET = 400; // cell updates per frame

export class Fluids {
  constructor(world) {
    this.world = world;
    this.time = 0;
    this.due = new Map(); // "x,y,z" -> when
    this.onEvent = null; // (type: 'fizz' | 'wash', x, y, z, id) for sounds and dropped torches
  }

  delay(id) {
    if (id === WATER) return 0.25;
    return this.world.dimension === 1 ? 0.5 : 1.5;
  }

  // how much a liquid's level drops per block it spreads: lava runs short outside the Nether
  step(id) {
    return id === LAVA && this.world.dimension !== 1 ? 2 : 1;
  }

  schedule(x, y, z, id) {
    if (this.due.size >= MAX_QUEUE) return;
    const k = x + ',' + y + ',' + z;
    const t = this.time + this.delay(id);
    const cur = this.due.get(k);
    if (cur === undefined || t < cur) this.due.set(k, t);
  }

  // A block changed at (x, y, z): the liquids there and next to it take another look.
  changed(x, y, z) {
    const w = this.world;
    const b = w.getBlock(x, y, z);
    if (IS_LIQUID[b]) this.schedule(x, y, z, b);
    for (const [dx, dy, dz] of AROUND) {
      const n = w.getBlock(x + dx, y + dy, z + dz);
      if (IS_LIQUID[n]) this.schedule(x + dx, y + dy, z + dz, n);
    }
  }

  get pending() {
    return this.due.size;
  }

  update(dt) {
    this.time += Math.min(dt, 0.25);
    if (!this.due.size) return;
    const ready = [];
    for (const [k, t] of this.due) {
      if (t <= this.time) { ready.push(k); if (ready.length >= BUDGET) break; }
    }
    for (const k of ready) {
      this.due.delete(k);
      const [x, y, z] = k.split(',').map(Number);
      this.tick(x, y, z);
    }
  }

  loaded(x, z) {
    const c = this.world.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    return !!(c && c.blocks);
  }

  // Can liquid run into this cell (it falls through, washes away, or meets the other liquid)?
  open(x, y, z, id) {
    if (y < 0) return false;
    const b = this.world.getBlock(x, y, z);
    if (b === 0) return true;
    if (IS_LIQUID[b]) return b !== id || this.world.getState(x, y, z) !== 0;
    return BLOCKS[b].replaceable === true && !IS_SOLID[b];
  }

  // Is the cell below something the liquid rests on (it spreads sideways only then)?
  rests(x, y, z, id) {
    return !this.open(x, y - 1, z, id);
  }

  touchesWater(x, y, z) {
    const w = this.world;
    if (w.getBlock(x, y + 1, z) === WATER) return true;
    for (const [dx, dz] of SIDES) if (w.getBlock(x + dx, y, z + dz) === WATER) return true;
    return false;
  }

  set(x, y, z, id, state = 0) {
    this.world.setBlock(x, y, z, id, { state });
  }

  tick(x, y, z) {
    const w = this.world;
    if (!this.loaded(x, z)) return;
    const id = w.getBlock(x, y, z);
    if (!IS_LIQUID[id]) return;
    const s = w.getState(x, y, z);
    const step = this.step(id);
    if (id === LAVA && this.touchesWater(x, y, z)) {
      this.set(x, y, z, s === 0 ? BLOCK.OBSIDIAN : BLOCK.COBBLESTONE);
      if (this.onEvent) this.onEvent('fizz', x, y, z, id);
      return;
    }
    if (s !== 0) {
      // a flowing cell: fed from above (falling), or by the best neighbour that rests on something
      let want;
      if (w.getBlock(x, y + 1, z) === id) want = LIQUID_FALLING;
      else {
        let best = 99, sources = 0;
        for (const [dx, dz] of SIDES) {
          const nx = x + dx, nz = z + dz;
          if (w.getBlock(nx, y, nz) !== id) continue;
          const ns = w.getState(nx, y, nz);
          if (!this.rests(nx, y, nz, id)) continue;
          if (ns === 0) sources++;
          best = Math.min(best, ns & LIQUID_FALLING ? 0 : ns & 7);
        }
        const firm = !this.open(x, y - 1, z, id);
        if (id === WATER && sources >= 2 && firm) want = 0;
        else if (best + step <= 7) want = best + step;
        else want = -1;
      }
      if (want < 0) { this.set(x, y, z, 0); return; }
      if (want !== s) { this.set(x, y, z, id, want); return; } // that change brings this cell back next round
    }
    this.spread(x, y, z, id, s, step);
  }

  spread(x, y, z, id, s, step) {
    // down first; only what can't fall runs out to the sides
    if (this.open(x, y - 1, z, id)) {
      this.flowInto(x, y - 1, z, id, LIQUID_FALLING);
      return;
    }
    const level = s & LIQUID_FALLING ? 0 : s & 7;
    const next = level + step;
    if (next > 7) return;
    for (const [dx, dz] of SIDES) {
      const nx = x + dx, nz = z + dz;
      if (!this.open(nx, y, nz, id)) continue;
      const b = this.world.getBlock(nx, y, nz);
      if (b === id) {
        const ns = this.world.getState(nx, y, nz);
        if (ns & LIQUID_FALLING || (ns & 7) <= next) continue; // already as full
      }
      this.flowInto(nx, y, nz, id, next);
    }
  }

  flowInto(x, y, z, id, state) {
    const w = this.world;
    const b = w.getBlock(x, y, z);
    if (b === id) {
      const s = w.getState(x, y, z);
      if (s === 0 || (state !== LIQUID_FALLING && s & LIQUID_FALLING)) return;
      if (state !== LIQUID_FALLING && (s & 7) <= state) return;
      this.set(x, y, z, id, state);
      return;
    }
    if (IS_LIQUID[b]) {
      // water running into lava hardens it; lava running into water turns the water to stone
      if (id === WATER) this.set(x, y, z, w.getState(x, y, z) === 0 ? BLOCK.OBSIDIAN : BLOCK.COBBLESTONE);
      else this.set(x, y, z, BLOCK.STONE);
      if (this.onEvent) this.onEvent('fizz', x, y, z, id);
      return;
    }
    if (b && this.onEvent) this.onEvent('wash', x, y, z, b);
    this.set(x, y, z, id, state);
  }
}
