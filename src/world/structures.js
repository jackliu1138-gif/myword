// Structures of the newer terrain: villages, desert temples, witch huts, pillager outposts, ocean
// monuments, woodland mansions, mineshafts and dungeons. Each kind starts at most once in every
// region of `spacing` chunks (where the biome suits it); its layout is worked out once from the
// world seed and then pasted into every chunk it reaches, so the pieces always line up.
// What a chunk gets besides blocks goes in its features: creatures that live there (spawned the
// first time the chunk is ever made) and monster spawners.

import { BLOCK, BLOCKS, CHUNK_SIZE, WORLD_HEIGHT, IS_SOLID, IS_LIQUID, BED_BLOCKS } from './blocks.js';
import { hash2, hash3, mulberry32 } from './noise.js';
import { SEA2, BIOME2 } from './biomes.js';

const B = BLOCK;
const BI = BIOME2;
const CS = CHUNK_SIZE;
const H = WORLD_HEIGHT;
const SEA = SEA2;
const idx = (x, y, z) => (y << 8) | (z << 4) | x;
// what foundations reach down through: trees, plants and snow
const SOFT = new Uint8Array(256);
for (const b of BLOCKS) if (b.key.endsWith('_leaves') || b.key.endsWith('_log') || b.key.endsWith('_sapling') || !b.solid) SOFT[b.id] = 1;
SOFT[BLOCK.CACTUS] = 1;
SOFT[BLOCK.SNOW] = 1;

// chest loot tables (a chest's state keeps its table in bits 4-7 until it is first opened)
export const LOOT = { dungeon: 1, mineshaft: 2, desert_temple: 3, village: 4, smith: 5, outpost: 6, mansion: 7, witch: 8, end_city: 9, end_ship: 10, monument: 11 };
// what a monster spawner (its state) brings out
export const SPAWNER_MOBS = ['zombie', 'skeleton', 'spider', 'cave_spider', 'blaze'];

// Writes into one chunk: world coordinates in, anything outside the chunk ignored.
export class ChunkCtx {
  constructor(blocks, cx, cz, gen) {
    this.blocks = blocks;
    this.states = null;
    this.features = null;
    this.cx = cx; this.cz = cz;
    this.x0 = cx * CS; this.z0 = cz * CS;
    this.gen = gen;
    this.maxH = H - 1;
  }

  setState(i, s) {
    if (s) {
      if (!this.states) this.states = new Uint8Array(this.blocks.length);
      this.states[i] = s;
    } else if (this.states) this.states[i] = 0;
  }

  inside(x, z) { return x >= this.x0 && x < this.x0 + CS && z >= this.z0 && z < this.z0 + CS; }
  // does the rectangle [ax, az]..[bx, bz] (inclusive) reach into this chunk?
  touches(ax, az, bx, bz) { return bx >= this.x0 && ax < this.x0 + CS && bz >= this.z0 && az < this.z0 + CS; }

  get(x, y, z) {
    if (!this.inside(x, z) || y < 0 || y >= H) return -1;
    return this.blocks[idx(x - this.x0, y, z - this.z0)];
  }

  set(x, y, z, id, state = 0) {
    if (!this.inside(x, z) || y < 1 || y >= H) return;
    const i = idx(x - this.x0, y, z - this.z0);
    if (this.blocks[i] === B.BEDROCK && y < 5) return;
    this.blocks[i] = id;
    this.setState(i, state);
  }

  // only where there is something solid now (dungeon walls open onto caves)
  setSolid(x, y, z, id) {
    const b = this.get(x, y, z);
    if (b > 0 && IS_SOLID[b] && b !== B.BEDROCK) this.set(x, y, z, id);
  }

  fill(ax, ay, az, bx, by, bz, id, state = 0) {
    const x0 = Math.max(Math.min(ax, bx), this.x0), x1 = Math.min(Math.max(ax, bx), this.x0 + CS - 1);
    const z0 = Math.max(Math.min(az, bz), this.z0), z1 = Math.min(Math.max(az, bz), this.z0 + CS - 1);
    const y0 = Math.max(1, Math.min(ay, by)), y1 = Math.min(H - 1, Math.max(ay, by));
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, id, state);
  }

  // a column of `id` from y down to the ground (at most `max` blocks)
  foundation(x, y, z, id, max = 24) {
    if (!this.inside(x, z)) return;
    for (let k = 0; k < max && y - k > 0; k++) {
      const b = this.get(x, y - k, z);
      if (IS_SOLID[b] && !SOFT[b]) break;
      this.set(x, y - k, z, id);
    }
  }

  feature(f) {
    if (!this.inside(Math.floor(f.x), Math.floor(f.z))) return;
    (this.features || (this.features = [])).push(f);
  }
  mob(type, x, y, z, data = null) { this.feature({ kind: 'mob', type, x, y, z, data }); }
  chest(x, y, z, facing, loot) { this.set(x, y, z, B.CHEST, (facing & 3) | (loot << 4)); }
  spawner(x, y, z, mob) {
    this.set(x, y, z, B.SPAWNER, mob);
    this.feature({ kind: 'spawner', x, y, z, mob: SPAWNER_MOBS[mob] });
  }

  result() {
    return { blocks: this.blocks, states: this.states, features: this.features };
  }
}

// A building's own coordinates: lx across, lz front (-) to back (+), ly up from its floor; turned
// so its front faces `f` (0 north, 1 east, 2 south, 3 west) around (cx, cz).
class Frame {
  constructor(ctx, cx, y0, cz, f) { this.ctx = ctx; this.cx = cx; this.y0 = y0; this.cz = cz; this.f = f & 3; }
  w(lx, lz) {
    let x = lx, z = lz;
    for (let i = 0; i < this.f; i++) { const t = x; x = -z; z = t; }
    return [this.cx + x, this.cz + z];
  }
  face(g) { return (g + this.f) & 3; } // a local facing (0 = out of the front, 2 = towards the back) in the world
  set(lx, ly, lz, id, state = 0) { const [x, z] = this.w(lx, lz); this.ctx.set(x, this.y0 + ly, z, id, state); }
  get(lx, ly, lz) { const [x, z] = this.w(lx, lz); return this.ctx.get(x, this.y0 + ly, z); }
  fill(ax, ay, az, bx, by, bz, id, state = 0) {
    for (let ly = Math.min(ay, by); ly <= Math.max(ay, by); ly++) {
      for (let lz = Math.min(az, bz); lz <= Math.max(az, bz); lz++) for (let lx = Math.min(ax, bx); lx <= Math.max(ax, bx); lx++) this.set(lx, ly, lz, id, state);
    }
  }
  // the ring of cells around a rectangle's edge
  ring(ax, az, bx, bz, ly, id, state = 0) {
    for (let lx = ax; lx <= bx; lx++) { this.set(lx, ly, az, id, state); this.set(lx, ly, bz, id, state); }
    for (let lz = az + 1; lz < bz; lz++) { this.set(ax, ly, lz, id, state); this.set(bx, ly, lz, id, state); }
  }
  foundation(lx, lz, id) { const [x, z] = this.w(lx, lz); this.ctx.foundation(x, this.y0 - 1, z, id); }
  // doors: a lower and an upper half, facing into the building from the front
  door(lx, ly, lz, id, g = 2) {
    this.set(lx, ly, lz, id, this.face(g));
    this.set(lx, ly + 1, lz, id, this.face(g) | 8);
  }
  stairs(lx, ly, lz, id, g, upside = false) { this.set(lx, ly, lz, id, this.face(g) | (upside ? 4 : 0)); }
  chest(lx, ly, lz, g, loot) { this.set(lx, ly, lz, B.CHEST, this.face(g) | (loot << 4)); }
  bed(lx, ly, lz, color = 'red') {
    // head against the back wall, foot towards the front
    const [foot, head] = BED_BLOCKS[color] || BED_BLOCKS.red;
    this.set(lx, ly, lz, head);
    this.set(lx, ly, lz - 1, foot);
  }
  mob(type, lx, ly, lz, data = null) {
    const [x, z] = this.w(lx, lz);
    this.ctx.mob(type, x + 0.5, this.y0 + ly, z + 0.5, data);
  }
  // world bounds of the local rectangle
  bounds(ax, az, bx, bz) {
    const [x0, z0] = this.w(ax, az), [x1, z1] = this.w(bx, bz);
    return [Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)];
  }
}

// ---------------------------------------------------------------------------------- villages
const V = (o) => ({ glass: B.GLASS_PANE, bed: 'red', ...o });
const VILLAGE_STYLES = {
  [BI.PLAINS]: V({ name: 'plains', planks: B.OAK_PLANKS, log: B.OAK_LOG, stairs: B.OAK_STAIRS, slab: B.OAK_SLAB, door: B.OAK_DOOR, fence: B.OAK_FENCE, floor: B.OAK_PLANKS, base: B.COBBLESTONE, path: B.DIRT_PATH }),
  [BI.TAIGA]: V({ name: 'taiga', planks: B.SPRUCE_PLANKS, log: B.SPRUCE_LOG, stairs: B.SPRUCE_STAIRS, slab: B.SPRUCE_SLAB, door: B.SPRUCE_DOOR, fence: B.SPRUCE_FENCE, floor: B.SPRUCE_PLANKS, base: B.COBBLESTONE, path: B.DIRT_PATH, bed: 'brown' }),
  [BI.SNOWY]: V({ name: 'snowy', planks: B.SPRUCE_PLANKS, log: B.SPRUCE_LOG, stairs: B.SPRUCE_STAIRS, slab: B.SPRUCE_SLAB, door: B.SPRUCE_DOOR, fence: B.SPRUCE_FENCE, floor: B.SPRUCE_PLANKS, base: B.STONE_BRICKS, path: B.DIRT_PATH, bed: 'light_blue', snow: true }),
  [BI.SAVANNA]: V({ name: 'savanna', planks: B.ACACIA_PLANKS, log: B.ACACIA_LOG, stairs: B.OAK_STAIRS, slab: B.OAK_SLAB, door: B.OAK_DOOR, fence: B.OAK_FENCE, floor: B.ACACIA_PLANKS, base: B.COBBLESTONE, path: B.DIRT_PATH, accent: B.ORANGE_TERRACOTTA, bed: 'orange' }),
  [BI.DESERT]: V({ name: 'desert', planks: B.SANDSTONE, log: B.SANDSTONE, stairs: B.SANDSTONE_STAIRS, slab: B.SANDSTONE_SLAB, door: B.OAK_DOOR, fence: B.OAK_FENCE, floor: B.SANDSTONE, base: B.SANDSTONE, path: B.SANDSTONE, accent: B.YELLOW_TERRACOTTA, flat: true, bed: 'yellow' }),
};
// what each building is, how big (half widths across and deep), and how often it comes up
const BUILDINGS = {
  house: { hw: 2, hd: 2, w: 30 },
  big_house: { hw: 3, hd: 4, w: 12 },
  farm: { hw: 4, hd: 3, w: 16 },
  smithy: { hw: 3, hd: 3, w: 6 },
  library: { hw: 3, hd: 3, w: 6 },
  church: { hw: 2, hd: 4, w: 5 },
  pen: { hw: 3, hd: 3, w: 8 },
};
const HOUSE_JOBS = ['fletcher', 'shepherd', 'butcher', 'fisherman', 'leatherworker', 'cartographer', 'mason', 'nitwit'];

// A small house's walls and roof (a gable across, or flat in the desert), floor at ly = 0.
function shell(F, S, hw, hd, wallH, walls = S.planks) {
  F.fill(-hw - 1, 1, -hd - 1, hw + 1, wallH + hw + 3, hd + 1, 0);
  for (let lz = -hd; lz <= hd; lz++) for (let lx = -hw; lx <= hw; lx++) { F.set(lx, 0, lz, S.floor); F.foundation(lx, lz, S.base); }
  for (let ly = 1; ly <= wallH; ly++) {
    for (let lx = -hw; lx <= hw; lx++) {
      for (const lz of [-hd, hd]) F.set(lx, ly, lz, Math.abs(lx) === hw ? S.log : walls);
    }
    for (let lz = -hd + 1; lz < hd; lz++) for (const lx of [-hw, hw]) F.set(lx, ly, lz, walls);
  }
  if (S.accent) F.ring(-hw, -hd, hw, hd, wallH, S.accent);
  // windows along the sides and at the back
  for (let lz = -hd + 2; lz <= hd - 2; lz += 2) { F.set(-hw, 2, lz, S.glass); F.set(hw, 2, lz, S.glass); }
  if (hw >= 2) F.set(0, 2, hd, S.glass);
  F.door(0, 1, -hd, S.door);
  F.fill(0, 1, -hd - 1, 0, 2, -hd - 1, 0);
  F.set(0, 0, -hd - 1, S.base === B.SANDSTONE ? B.SANDSTONE : B.COBBLESTONE_STAIRS, S.base === B.SANDSTONE ? 0 : F.face(2));
  // roof
  if (S.flat) {
    F.fill(-hw, wallH + 1, -hd, hw, wallH + 1, hd, S.planks);
    F.ring(-hw, -hd, hw, hd, wallH + 2, S.slab);
    return wallH + 2;
  }
  for (let k = 0; k <= hw; k++) {
    const ly = wallH + 1 + k;
    for (let lz = -hd - 1; lz <= hd + 1; lz++) {
      F.stairs(-hw - 1 + k, ly, lz, S.stairs, 1);
      F.stairs(hw + 1 - k, ly, lz, S.stairs, 3);
    }
    for (let lx = -hw + k; lx <= hw - k; lx++) { F.set(lx, ly, -hd, S.planks); F.set(lx, ly, hd, S.planks); }
  }
  for (let lz = -hd - 1; lz <= hd + 1; lz++) F.set(0, wallH + hw + 2, lz, S.slab);
  return wallH + hw + 2;
}

const BUILDERS = {
  house(F, S, rand) {
    shell(F, S, 2, 2, 3);
    F.bed(-1, 1, 1, S.bed);
    F.set(1, 1, 1, B.CRAFTING_TABLE);
    F.set(1, 1, -1, B.LANTERN);
    if (rand() < 0.4) F.chest(1, 1, 0, 3, LOOT.village);
    F.mob('villager', 0, 1, -4, { job: HOUSE_JOBS[Math.floor(rand() * HOUSE_JOBS.length)], style: S.name });
  },
  big_house(F, S, rand) {
    shell(F, S, 3, 4, 4);
    // a loft floor with a ladder
    F.fill(-2, 3, 1, 2, 3, 3, S.floor);
    F.fill(-2, 1, 1, -2, 3, 1, B.LADDER, F.face(3));
    F.bed(1, 1, 3, S.bed);
    F.bed(-1, 4, 3, S.bed);
    F.set(2, 1, 0, B.FURNACE, F.face(3));
    F.set(2, 1, -1, B.CRAFTING_TABLE);
    F.chest(-2, 1, -2, 1, LOOT.village);
    F.set(2, 1, -3, B.LANTERN);
    F.set(1, 4, 1, B.LANTERN);
    F.mob('villager', 0, 1, -6, { job: HOUSE_JOBS[Math.floor(rand() * HOUSE_JOBS.length)], style: S.name });
    F.mob('villager', 1, 1, -1, { job: HOUSE_JOBS[Math.floor(rand() * HOUSE_JOBS.length)], style: S.name });
  },
  farm(F, S, rand) {
    const crops = [[B.WHEAT_0, 4], [B.CARROTS_0, 4], [B.POTATOES_0, 4]][Math.floor(rand() * 3)];
    F.fill(-4, 1, -3, 4, 3, 3, 0);
    for (let lz = -3; lz <= 3; lz++) {
      for (let lx = -4; lx <= 4; lx++) {
        F.foundation(lx, lz, B.DIRT);
        const edge = Math.abs(lx) === 4 || Math.abs(lz) === 3;
        if (edge) F.set(lx, 0, lz, S.log === B.SANDSTONE ? B.SANDSTONE : S.log);
        else if (lx === 0) F.set(lx, 0, lz, B.WATER);
        else {
          F.set(lx, 0, lz, B.FARMLAND);
          F.set(lx, 1, lz, crops[0] + Math.floor(rand() * crops[1]));
        }
      }
    }
    F.mob('villager', 0, 1, -4, { job: 'farmer', style: S.name });
  },
  smithy(F, S, rand) {
    F.fill(-4, 1, -4, 4, 6, 4, 0);
    for (let lz = -3; lz <= 3; lz++) for (let lx = -3; lx <= 3; lx++) { F.set(lx, 0, lz, B.COBBLESTONE); F.foundation(lx, lz, B.COBBLESTONE); }
    for (let ly = 1; ly <= 3; ly++) {
      for (let lx = -3; lx <= 3; lx++) F.set(lx, ly, 3, B.COBBLESTONE);
      for (let lz = -3; lz <= 2; lz++) { F.set(-3, ly, lz, lz === -3 ? S.log : B.COBBLESTONE); F.set(3, ly, lz, lz === -3 ? S.log : B.COBBLESTONE); }
    }
    F.set(-3, 2, 0, B.IRON_BARS); F.set(3, 2, 0, B.IRON_BARS);
    F.fill(-3, 4, -3, 3, 4, 3, B.COBBLESTONE_SLAB);
    // the forge: lava behind bars, furnaces either side, the smith's chest
    F.set(-1, 0, 2, B.LAVA);
    F.set(-1, 1, 1, B.IRON_BARS);
    F.set(-2, 1, 2, B.FURNACE, F.face(0));
    F.set(0, 1, 2, B.FURNACE, F.face(0));
    F.chest(2, 1, 2, 0, LOOT.smith);
    F.set(2, 1, -1, B.CRAFTING_TABLE);
    F.set(-2, 1, -2, B.LANTERN);
    const jobs = ['armorer', 'weaponsmith', 'toolsmith'];
    F.mob('villager', 0, 1, -1, { job: jobs[Math.floor(rand() * 3)], style: S.name });
  },
  library(F, S, rand) {
    shell(F, S, 3, 3, 4);
    for (let ly = 1; ly <= 2; ly++) {
      for (let lx = -2; lx <= 2; lx++) F.set(lx, ly, 2, B.BOOKSHELF);
      for (const lz of [-1, 1]) { F.set(-2, ly, lz, B.BOOKSHELF); F.set(2, ly, lz, B.BOOKSHELF); }
    }
    F.set(0, 1, 0, B.CRAFTING_TABLE);
    F.set(-2, 1, -2, B.LANTERN);
    F.set(2, 1, -2, B.LANTERN);
    F.mob('villager', 0, 1, -1, { job: 'librarian', style: S.name });
  },
  church(F, S) {
    const stone = S.name === 'desert' ? B.SANDSTONE : B.COBBLESTONE;
    const S2 = { ...S, planks: stone, log: S.name === 'desert' ? B.SANDSTONE : B.STONE_BRICKS, flat: true, slab: S.name === 'desert' ? B.SANDSTONE_SLAB : B.STONE_BRICK_SLAB, floor: stone, accent: null };
    shell(F, S2, 2, 4, 7);
    F.set(-2, 5, 0, S.glass); F.set(2, 5, 0, S.glass); F.set(0, 5, 4, S.glass);
    F.set(0, 1, 3, B.BREWING_STAND);
    F.set(-1, 1, 3, B.LANTERN); F.set(1, 1, 3, B.LANTERN);
    for (const lz of [-1, 1]) { F.stairs(-1, 1, lz, S.stairs, 0); F.stairs(1, 1, lz, S.stairs, 0); }
    F.mob('villager', 0, 1, 1, { job: 'cleric', style: S.name });
  },
  pen(F, S, rand) {
    F.fill(-3, 1, -3, 3, 3, 3, 0);
    for (let lz = -3; lz <= 3; lz++) for (let lx = -3; lx <= 3; lx++) { F.foundation(lx, lz, B.DIRT); F.set(lx, 0, lz, S.name === 'desert' ? B.SAND : B.GRASS); }
    F.ring(-3, -3, 3, 3, 1, S.fence);
    F.set(0, 1, -3, B.OAK_FENCE_GATE, F.face(0));
    F.set(2, 1, 2, B.HAY_BALE);
    const kind = ['cow', 'sheep', 'pig'][Math.floor(rand() * 3)];
    for (let i = 0; i < 3; i++) F.mob(kind, -1 + i, 1, 0);
    F.mob('villager', 0, 1, -5, { job: kind === 'sheep' ? 'shepherd' : 'butcher', style: S.name });
  },
};

// --------------------------------------------------------------------------------- the planner
const KINDS = {
  village: { spacing: 26, sep: 7, salt: 10387312, reach: 76, surface: true },
  temple: { spacing: 24, sep: 8, salt: 14357617, reach: 16, surface: true },
  hut: { spacing: 18, sep: 6, salt: 14357620, reach: 9, surface: true },
  outpost: { spacing: 28, sep: 8, salt: 165745296, reach: 16, surface: true },
  monument: { spacing: 28, sep: 5, salt: 10387313, reach: 34 },
  mansion: { spacing: 40, sep: 12, salt: 10387319, reach: 32, surface: true },
  mineshaft: { spacing: 9, sep: 2, salt: 0x3a1b7, reach: 88 },
};

export class Structures {
  constructor(gen) {
    this.gen = gen;
    this.seed = gen.seed | 0;
    this.layouts = new Map();
  }

  // the start of `kind` in region (rx, rz), in chunk coordinates
  start(kind, rx, rz) {
    const k = KINDS[kind];
    const s = this.seed ^ k.salt;
    const cx = rx * k.spacing + Math.floor(hash2(rx, rz, s) * (k.spacing - k.sep));
    const cz = rz * k.spacing + Math.floor(hash2(rz + 7, rx - 3, s ^ 0x55) * (k.spacing - k.sep));
    return { kind, cx, cz, x: cx * CS + 8, z: cz * CS + 8, key: kind + ':' + cx + ':' + cz };
  }

  layout(st) {
    let L = this.layouts.get(st.key);
    if (L !== undefined) return L;
    const rand = mulberry32((hash2(st.cx, st.cz, this.seed ^ KINDS[st.kind].salt ^ 0x9e37) * 4294967296) >>> 0);
    L = this['plan_' + st.kind](st, rand) || null;
    this.layouts.set(st.key, L);
    if (this.layouts.size > 400) this.layouts.delete(this.layouts.keys().next().value);
    return L;
  }

  // every structure whose reach covers the rectangle (block coordinates)
  near(kind, ax, az, bx, bz) {
    const k = KINDS[kind];
    const span = k.spacing * CS;
    const out = [];
    const rx0 = Math.floor((ax - k.reach - span) / span), rx1 = Math.floor((bx + k.reach) / span);
    const rz0 = Math.floor((az - k.reach - span) / span), rz1 = Math.floor((bz + k.reach) / span);
    for (let rz = rz0; rz <= rz1; rz++) {
      for (let rx = rx0; rx <= rx1; rx++) {
        const st = this.start(kind, rx, rz);
        if (st.x + k.reach < ax || st.x - k.reach > bx || st.z + k.reach < az || st.z - k.reach > bz) continue;
        const L = this.layout(st);
        if (L) out.push(L);
      }
    }
    return out;
  }

  build(ctx) {
    const ax = ctx.x0, az = ctx.z0, bx = ax + CS - 1, bz = az + CS - 1;
    this.dungeon(ctx);
    for (const L of this.near('mineshaft', ax, az, bx, bz)) this.paste_mineshaft(ctx, L);
    for (const kind of ['monument', 'village', 'temple', 'hut', 'outpost', 'mansion']) {
      for (const L of this.near(kind, ax, az, bx, bz)) this['paste_' + kind](ctx, L);
    }
  }

  // Trees keep off the villages and buildings.
  treeFree(x, z) {
    for (const kind of ['village', 'temple', 'hut', 'outpost', 'mansion']) {
      for (const L of this.near(kind, x, z, x, z)) {
        for (const r of L.clear) if (x >= r[0] - 2 && x <= r[2] + 2 && z >= r[1] - 2 && z <= r[3] + 2) return false;
      }
    }
    return true;
  }

  nearestVillage(x, z, maxDist) {
    let best = null, bd = maxDist * maxDist;
    for (const L of this.near('village', x - maxDist, z - maxDist, x + maxDist, z + maxDist)) {
      const d = (L.x - x) ** 2 + (L.z - z) ** 2;
      if (d < bd) { bd = d; best = L; }
    }
    return best;
  }

  // The nearest structure of a kind (for /locate): { kind, x, y, z } or null.
  locate(kind, x, z, maxDist = 3000) {
    const k = KINDS[kind];
    if (!k) return null;
    const span = k.spacing * CS;
    let best = null, bd = Infinity;
    for (let r = 0; r * span <= maxDist && !best; r++) {
      const rx0 = Math.floor(x / span) - r, rx1 = Math.floor(x / span) + r;
      const rz0 = Math.floor(z / span) - r, rz1 = Math.floor(z / span) + r;
      for (let rz = rz0; rz <= rz1; rz++) for (let rx = rx0; rx <= rx1; rx++) {
        if (Math.max(Math.abs(rx - Math.floor(x / span)), Math.abs(rz - Math.floor(z / span))) !== r) continue;
        const L = this.layout(this.start(kind, rx, rz));
        if (!L) continue;
        const d = (L.x - x) ** 2 + (L.z - z) ** 2;
        if (d < bd) { bd = d; best = { kind, x: L.x, y: L.y, z: L.z }; }
      }
      if (best && r > 0) break;
    }
    return best;
  }

  col(x, z) { return this.gen.column(x, z, {}); }

  // ------------------------------------------------------------------------------ village
  plan_village(st, rand) {
    const c = this.col(st.x, st.z);
    const S = VILLAGE_STYLES[c.biome];
    if (!S || c.height <= SEA + 1 || c.height > SEA + 60) return null;
    const L = { kind: 'village', x: st.x, z: st.z, y: c.height, S, roads: [], plots: [], lamps: [], clear: [] };
    const rects = [];
    const overlaps = (r) => rects.some((q) => r[0] <= q[2] && r[2] >= q[0] && r[1] <= q[3] && r[3] >= q[1]);
    const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const well = [st.x - 3, st.z - 3, st.x + 2, st.z + 2];
    rects.push(well);
    L.clear.push(well);
    // roads: arms out of the square, with a branch or two off them
    const segs = [];
    for (let f = 0; f < 4; f++) {
      if (f > 1 && rand() < 0.2) continue;
      const len = 18 + Math.floor(rand() * 26);
      segs.push({ x: st.x + DIRS[f][0] * 4, z: st.z + DIRS[f][1] * 4, f, len });
    }
    for (const s of segs.slice()) {
      if (rand() < 0.6) {
        const at = 10 + Math.floor(rand() * (s.len - 12));
        const f = (s.f + (rand() < 0.5 ? 1 : 3)) & 3;
        segs.push({ x: s.x + DIRS[s.f][0] * at, z: s.z + DIRS[s.f][1] * at, f, len: 10 + Math.floor(rand() * 14), branch: true });
      }
    }
    for (const s of segs) {
      const [dx, dz] = DIRS[s.f];
      const ex = s.x + dx * s.len, ez = s.z + dz * s.len;
      const r = [Math.min(s.x, ex) - 1, Math.min(s.z, ez) - 1, Math.max(s.x, ex) + 1, Math.max(s.z, ez) + 1];
      L.roads.push(r);
      L.clear.push(r);
    }
    for (const r of L.roads) rects.push(r);
    // buildings on both sides of every road, facing it
    const kinds = Object.keys(BUILDINGS);
    const total = kinds.reduce((a, k) => a + BUILDINGS[k].w, 0);
    const pick = () => { let v = rand() * total; for (const k of kinds) { v -= BUILDINGS[k].w; if (v <= 0) return k; } return 'house'; };
    for (const s of segs) {
      const [dx, dz] = DIRS[s.f];
      for (let t = 5; t < s.len - 2; t += 7 + Math.floor(rand() * 4)) {
        for (const side of [1, 3]) {
          if (rand() < 0.2) continue;
          const kind = pick();
          const { hw, hd } = BUILDINGS[kind];
          const sf = (s.f + side) & 3; // from the road towards the plot
          const [sx, sz] = DIRS[sf];
          const px = s.x + dx * t + sx * (3 + hd), pz = s.z + dz * t + sz * (3 + hd);
          const face = (sf + 2) & 3; // the plot's front faces the road
          const ex = face & 1 ? hd : hw, ez = face & 1 ? hw : hd;
          const r = [px - ex - 1, pz - ez - 1, px + ex + 1, pz + ez + 1];
          if (overlaps(r)) continue;
          // not on steep ground or in the water
          let lo = Infinity, hi = -Infinity, wet = false;
          for (const [qx, qz] of [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]], [px, pz]]) {
            const q = this.col(qx, qz);
            lo = Math.min(lo, q.height); hi = Math.max(hi, q.height);
            if (q.height <= SEA || q.biome === BI.RIVER || q.biome === BI.OCEAN) wet = true;
          }
          if (wet || hi - lo > 5) continue;
          rects.push(r);
          L.clear.push(r);
          L.plots.push({ kind, x: px, z: pz, y: this.col(px, pz).height, f: face, seed: Math.floor(rand() * 1e9), r });
        }
      }
      // lamp posts along the way
      for (let t = 6; t < s.len; t += 13) L.lamps.push([s.x + dx * t + (dz ? 2 : 0), s.z + dz * t + (dx ? 2 : 0)]);
    }
    if (L.plots.length < 3) return null;
    return L;
  }

  paste_village(ctx, L) {
    const S = L.S;
    // roads: path blocks on the ground, planks where they cross water
    for (const r of L.roads) {
      if (!ctx.touches(r[0], r[1], r[2], r[3])) continue;
      for (let z = Math.max(r[1], ctx.z0); z <= Math.min(r[3], ctx.z0 + CS - 1); z++) {
        for (let x = Math.max(r[0], ctx.x0); x <= Math.min(r[2], ctx.x0 + CS - 1); x++) {
          const h = this.gen.column(x, z, this.tmp || (this.tmp = {})).height;
          if (h < SEA) { ctx.set(x, SEA, z, S.planks === B.SANDSTONE ? B.OAK_PLANKS : S.planks); continue; }
          ctx.set(x, h, z, S.path);
          for (let k = 1; k <= 4; k++) { const b = ctx.get(x, h + k, z); if (b > 0 && (!IS_SOLID[b] || b === B.OAK_LEAVES)) ctx.set(x, h + k, z, 0); }
        }
      }
    }
    // the well in the middle
    if (ctx.touches(L.x - 3, L.z - 3, L.x + 2, L.z + 2)) {
      const F = new Frame(ctx, L.x, L.y, L.z, 0);
      F.fill(-3, 1, -3, 2, 5, 2, 0);
      for (let lz = -3; lz <= 2; lz++) for (let lx = -3; lx <= 2; lx++) { F.set(lx, 0, lz, S.base); F.foundation(lx, lz, S.base); }
      F.fill(-2, -2, -2, 1, -1, 1, S.base);
      F.fill(-1, -1, -1, 0, 0, 0, B.WATER);
      F.ring(-2, -2, 1, 1, 1, S.base);
      for (const [lx, lz] of [[-2, -2], [1, -2], [-2, 1], [1, 1]]) F.fill(lx, 2, lz, lx, 3, lz, S.fence);
      F.fill(-2, 4, -2, 1, 4, 1, S.slab);
      F.mob('iron_golem', 3, 1, 3);
      F.mob('cat', -4, 1, 3, { style: S.name });
    }
    for (const [x, z] of L.lamps) {
      if (!ctx.inside(x, z)) continue;
      const h = this.gen.column(x, z, this.tmp).height;
      if (h < SEA) continue;
      ctx.set(x, h, z, S.base);
      ctx.set(x, h + 1, z, S.fence);
      ctx.set(x, h + 2, z, S.fence);
      ctx.set(x, h + 3, z, B.LANTERN);
    }
    for (const p of L.plots) {
      if (!ctx.touches(p.r[0] - 1, p.r[1] - 1, p.r[2] + 1, p.r[3] + 1)) continue;
      const F = new Frame(ctx, p.x, p.y, p.z, p.f);
      BUILDERS[p.kind](F, S, mulberry32(p.seed));
    }
  }

  // ------------------------------------------------------------------------------ desert temple
  plan_temple(st) {
    const c = this.col(st.x, st.z);
    if (c.biome !== BI.DESERT || c.height <= SEA + 1) return null;
    return { kind: 'temple', x: st.x, y: c.height, z: st.z, clear: [[st.x - 11, st.z - 11, st.x + 11, st.z + 11]] };
  }

  paste_temple(ctx, L) {
    if (!ctx.touches(L.x - 11, L.z - 11, L.x + 11, L.z + 11)) return;
    const F = new Frame(ctx, L.x, L.y, L.z, 0);
    const SS = B.SANDSTONE, OR = B.ORANGE_TERRACOTTA;
    F.fill(-10, 1, -10, 10, 20, 10, 0);
    for (let lz = -10; lz <= 10; lz++) for (let lx = -10; lx <= 10; lx++) { F.set(lx, 0, lz, SS); F.foundation(lx, lz, SS); }
    // the hall's walls, then a stepped, hollow pyramid over it
    for (let ly = 1; ly <= 4; ly++) F.ring(-10, -10, 10, 10, ly, SS);
    for (let k = 0; k <= 4; k++) {
      const r = 10 - 2 * k;
      for (let lz = -r; lz <= r; lz++) for (let lx = -r; lx <= r; lx++) {
        const edge = Math.abs(lx) >= r - 1 || Math.abs(lz) >= r - 1;
        if (edge || k === 4) F.set(lx, 5 + k, lz, SS);
      }
    }
    // towers at the front corners, striped in orange
    for (const tx of [-8, 8]) {
      for (let ly = 1; ly <= 12; ly++) {
        for (let lz = -10; lz <= -6; lz++) for (let lx = tx - 2; lx <= tx + 2; lx++) {
          const edge = Math.abs(lx - tx) === 2 || lz === -10 || lz === -6;
          F.set(lx, ly, lz, edge ? (ly === 7 || ly === 9 ? OR : SS) : 0);
        }
      }
      F.fill(tx - 2, 13, -10, tx + 2, 13, -6, B.SANDSTONE_SLAB);
      F.fill(tx - 1, 1, -9, tx - 1, 12, -9, B.LADDER, F.face(3));
      F.set(tx, 1, -6, 0); F.set(tx, 2, -6, 0);
    }
    // the entrance, patterned
    F.fill(-1, 1, -10, 1, 3, -10, 0);
    for (const lx of [-2, 2]) for (let ly = 1; ly <= 4; ly++) F.set(lx, ly, -10, OR);
    F.fill(-2, 5, -10, 2, 5, -10, OR);
    // the hall floor: a star over the hidden shaft
    for (let lz = -2; lz <= 2; lz++) for (let lx = -2; lx <= 2; lx++) F.set(lx, 0, lz, Math.abs(lx) === Math.abs(lz) || lx === 0 || lz === 0 ? OR : SS);
    F.set(0, 0, 0, B.WHITE_TERRACOTTA);
    // the treasure room, 14 below: four chests around a pressure plate over TNT
    F.fill(-5, -15, -5, 5, -9, 5, SS);
    F.fill(-4, -13, -4, 4, -10, 4, 0);
    F.fill(-1, -9, -1, 1, -1, 1, 0);
    F.set(0, -1, 0, SS);
    F.fill(-1, -16, -1, 1, -16, 1, B.TNT);
    F.set(0, -14, 0, SS);
    F.set(0, -13, 0, B.STONE_PRESSURE_PLATE);
    for (const [lx, lz, g] of [[0, -4, 2], [0, 4, 0], [-4, 0, 1], [4, 0, 3]]) {
      F.chest(lx, -13, lz, g, LOOT.desert_temple);
      F.set(lx, -14, lz, OR);
    }
    for (const [lx, lz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) F.set(lx, -13, lz, B.TORCH);
  }

  // ------------------------------------------------------------------------------ witch hut
  plan_hut(st, rand) {
    const c = this.col(st.x, st.z);
    if (c.biome !== BI.SWAMP) return null;
    return { kind: 'hut', x: st.x, y: SEA + 2, z: st.z, f: Math.floor(rand() * 4), clear: [[st.x - 5, st.z - 5, st.x + 5, st.z + 5]] };
  }

  paste_hut(ctx, L) {
    if (!ctx.touches(L.x - 5, L.z - 5, L.x + 5, L.z + 5)) return;
    const F = new Frame(ctx, L.x, L.y, L.z, L.f);
    F.fill(-3, 1, -4, 3, 7, 4, 0);
    // stilts down into the water
    for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 3], [2, 3]]) {
      F.set(lx, 0, lz, B.SPRUCE_LOG);
      for (let k = 1; k < 12; k++) {
        const b = F.get(lx, -k, lz);
        if (b > 0 && IS_SOLID[b]) break;
        F.set(lx, -k, lz, B.SPRUCE_LOG);
      }
    }
    F.fill(-2, 1, -2, 2, 1, 3, B.SPRUCE_PLANKS);
    F.fill(-3, 1, -4, 3, 1, -3, B.SPRUCE_SLAB);
    for (let ly = 2; ly <= 4; ly++) {
      F.ring(-2, -2, 2, 3, ly, B.SPRUCE_PLANKS);
      for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 3], [2, 3]]) F.set(lx, ly, lz, B.OAK_LOG);
    }
    F.set(-2, 3, 0, B.GLASS_PANE); F.set(2, 3, 0, B.GLASS_PANE); F.set(0, 3, 3, B.GLASS_PANE);
    F.door(0, 2, -2, B.SPRUCE_DOOR);
    for (let lz = -3; lz <= 4; lz++) {
      F.stairs(-3, 5, lz, B.SPRUCE_STAIRS, 1);
      F.stairs(3, 5, lz, B.SPRUCE_STAIRS, 3);
      F.fill(-2, 6, lz, 2, 6, lz, B.SPRUCE_SLAB);
      F.set(-2, 5, lz, B.SPRUCE_PLANKS); F.set(2, 5, lz, B.SPRUCE_PLANKS);
    }
    F.fill(-1, 5, -2, 1, 5, 3, B.SPRUCE_PLANKS);
    F.set(1, 2, 2, B.CRAFTING_TABLE);
    F.set(-1, 2, 2, B.BREWING_STAND);
    F.chest(1, 2, 1, 3, LOOT.witch);
    F.mob('witch', 0, 2, 1);
    F.mob('cat', 0, 2, 0, { color: 'black' });
  }

  // ------------------------------------------------------------------------------ pillager outpost
  plan_outpost(st, rand) {
    const c = this.col(st.x, st.z);
    if (![BI.PLAINS, BI.DESERT, BI.SAVANNA, BI.TAIGA, BI.SNOWY].includes(c.biome) || c.height <= SEA + 1) return null;
    // not right next to a village
    if (this.near('village', st.x - 160, st.z - 160, st.x + 160, st.z + 160).length) return null;
    return { kind: 'outpost', x: st.x, y: c.height, z: st.z, f: Math.floor(rand() * 4), clear: [[st.x - 9, st.z - 9, st.x + 9, st.z + 9]] };
  }

  paste_outpost(ctx, L) {
    if (!ctx.touches(L.x - 9, L.z - 9, L.x + 9, L.z + 9)) return;
    const F = new Frame(ctx, L.x, L.y, L.z, L.f);
    const log = B.DARK_OAK_LOG, wall = B.BIRCH_PLANKS, floor = B.DARK_OAK_PLANKS;
    F.fill(-4, 1, -4, 4, 26, 4, 0);
    for (let lz = -4; lz <= 4; lz++) for (let lx = -4; lx <= 4; lx++) { F.set(lx, 0, lz, B.COBBLESTONE); F.foundation(lx, lz, B.COBBLESTONE); }
    for (let ly = 1; ly <= 20; ly++) {
      for (let lz = -3; lz <= 3; lz++) for (let lx = -3; lx <= 3; lx++) {
        const edge = Math.abs(lx) === 3 || Math.abs(lz) === 3;
        const corner = Math.abs(lx) === 3 && Math.abs(lz) === 3;
        if (!edge) continue;
        const window = !corner && ly % 5 === 3 && (lx === 0 || lz === 0);
        F.set(lx, ly, lz, corner ? log : window ? 0 : wall);
      }
      if (ly % 5 === 0) {
        F.fill(-2, ly, -2, 2, ly, 2, floor);
        F.set(-2, ly, -2, 0);
      }
    }
    F.fill(-2, 1, -2, -2, 22, -2, B.LADDER, F.face(3));
    F.fill(-1, 1, -3, 1, 2, -3, 0);
    // the lookout: a wider deck with a railing and a roof
    F.fill(-5, 21, -5, 5, 21, 5, floor);
    F.set(-2, 21, -2, 0);
    F.ring(-5, -5, 5, 5, 22, B.DARK_OAK_LOG);
    for (let lx = -4; lx <= 4; lx += 2) { F.set(lx, 22, -5, B.OAK_FENCE); F.set(lx, 22, 5, B.OAK_FENCE); F.set(-5, 22, lx, B.OAK_FENCE); F.set(5, 22, lx, B.OAK_FENCE); }
    for (const [lx, lz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) F.fill(lx, 23, lz, lx, 25, lz, B.DARK_OAK_LOG);
    F.fill(-5, 26, -5, 5, 26, 5, B.DARK_OAK_PLANKS);
    F.chest(2, 22, 2, 0, LOOT.outpost);
    F.set(-3, 22, 3, B.LANTERN);
    for (const [lx, ly, lz] of [[0, 1, -6], [4, 1, -6], [-5, 1, 2], [6, 1, 3], [1, 22, 1], [-1, 22, 3]]) F.mob('pillager', lx, ly, lz);
  }

  // ------------------------------------------------------------------------------ ocean monument
  plan_monument(st) {
    const c = this.col(st.x, st.z);
    if (c.biome !== BI.OCEAN || c.height > SEA - 20) return null;
    for (const [dx, dz] of [[-24, -24], [24, -24], [-24, 24], [24, 24], [0, 30], [30, 0], [-30, 0], [0, -30]]) {
      const q = this.col(st.x + dx, st.z + dz);
      if (q.biome !== BI.OCEAN || q.height > SEA - 14) return null;
    }
    return { kind: 'monument', x: st.x, y: Math.min(c.height + 1, SEA - 24), z: st.z, clear: [] };
  }

  paste_monument(ctx, L) {
    if (!ctx.touches(L.x - 26, L.z - 26, L.x + 26, L.z + 26)) return;
    const F = new Frame(ctx, L.x, L.y, L.z, 0);
    const PB = B.PRISMARINE_BRICKS, PR = B.PRISMARINE, DP = B.DARK_PRISMARINE, LT = B.SEA_LANTERN;
    // clear the sea floor inside and lay the base
    F.fill(-24, 1, -24, 24, 23, 24, B.WATER);
    for (let lz = -24; lz <= 24; lz++) for (let lx = -24; lx <= 24; lx++) { F.set(lx, 0, lz, PB); F.foundation(lx, lz, PR); }
    // three tiers, each a hollow box of bricks trimmed in dark prismarine
    const tiers = [[22, 1, 7], [16, 8, 13], [10, 14, 19]];
    for (const [r, y0, y1] of tiers) {
      for (let ly = y0; ly <= y1; ly++) {
        for (let lz = -r; lz <= r; lz++) for (let lx = -r; lx <= r; lx++) {
          const edge = Math.abs(lx) === r || Math.abs(lz) === r;
          const cap = ly === y1;
          if (!edge && !cap) continue;
          const trim = (Math.abs(lx) === r && Math.abs(lz) === r) || (cap && edge);
          const light = edge && !cap && ly === y0 + 2 && (lx % 6 === 0 || lz % 6 === 0);
          F.set(lx, ly, lz, light ? LT : trim ? DP : (lx + lz + ly) % 7 === 0 ? PR : PB);
        }
      }
    }
    // four corner towers
    for (const [tx, tz] of [[-19, -19], [19, -19], [-19, 19], [19, 19]]) {
      for (let ly = 1; ly <= 12; ly++) {
        for (let lz = -2; lz <= 2; lz++) for (let lx = -2; lx <= 2; lx++) {
          const edge = Math.abs(lx) === 2 || Math.abs(lz) === 2;
          F.set(tx + lx, ly, tz + lz, edge ? (ly % 4 === 0 ? DP : PB) : B.WATER);
        }
      }
      F.fill(tx - 2, 13, tz - 2, tx + 2, 13, tz + 2, DP);
      F.set(tx, 14, tz, LT);
    }
    // the entrance: a tall arch in the front
    F.fill(-3, 1, -22, 3, 6, -22, B.WATER);
    F.fill(-2, 8, -16, 2, 11, -16, B.WATER);
    F.fill(-4, 7, -22, 4, 7, -22, DP);
    // the heart: a dark room around a block of gold
    F.fill(-4, 9, -4, 4, 15, 4, DP);
    F.fill(-3, 10, -3, 3, 14, 3, B.WATER);
    F.fill(-1, 11, -1, 0, 12, 0, B.GOLD_BLOCK);
    F.fill(-1, 10, -4, 0, 12, -4, B.WATER);
    for (const [lx, lz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) F.set(lx, 14, lz, LT);
    F.mob('elder_guardian', 2, 11, 2);
    F.mob('elder_guardian', -16, 4, 8);
    F.mob('elder_guardian', 16, 4, 8);
    for (const [lx, ly, lz] of [[-8, 3, -8], [8, 3, -8], [0, 3, -12], [-12, 10, 0], [12, 10, 0], [0, 10, 12], [-20, 18, 0], [20, 18, 0], [0, 21, -10]]) F.mob('guardian', lx, ly, lz);
  }

  // ------------------------------------------------------------------------------ woodland mansion
  plan_mansion(st, rand) {
    const c = this.col(st.x, st.z);
    if (c.biome !== BI.DARK_FOREST || c.height <= SEA + 1) return null;
    return { kind: 'mansion', x: st.x, y: c.height, z: st.z, f: Math.floor(rand() * 4), seed: Math.floor(rand() * 1e9), clear: [[st.x - 18, st.z - 18, st.x + 18, st.z + 18]] };
  }

  paste_mansion(ctx, L) {
    if (!ctx.touches(L.x - 19, L.z - 19, L.x + 19, L.z + 19)) return;
    const F = new Frame(ctx, L.x, L.y, L.z, L.f);
    const rand = mulberry32(L.seed);
    const HW = 15, HD = 11, FLOOR = 6; // half sizes and the height of a storey
    const LOG = B.DARK_OAK_LOG, WALL = B.DARK_OAK_PLANKS, FL = B.BIRCH_PLANKS, CO = B.COBBLESTONE;
    F.fill(-HW - 1, 1, -HD - 1, HW + 1, 3 * FLOOR + 8, HD + 1, 0);
    for (let lz = -HD; lz <= HD; lz++) for (let lx = -HW; lx <= HW; lx++) { F.set(lx, 0, lz, CO); F.foundation(lx, lz, CO); }
    for (let floor = 0; floor < 3; floor++) {
      const y0 = floor * FLOOR;
      if (floor) F.fill(-HW, y0, -HD, HW, y0, HD, FL);
      for (let ly = y0 + 1; ly < y0 + FLOOR; ly++) {
        for (let lx = -HW; lx <= HW; lx++) {
          for (const lz of [-HD, HD]) F.set(lx, ly, lz, lx % 4 === 0 ? LOG : (ly - y0 === 3 && lx % 2 !== 0) ? B.GLASS_PANE : WALL);
        }
        for (let lz = -HD + 1; lz < HD; lz++) {
          for (const lx of [-HW, HW]) F.set(lx, ly, lz, lz % 4 === 0 ? LOG : (ly - y0 === 3 && lz % 2 !== 0) ? B.GLASS_PANE : WALL);
        }
      }
      // rooms: a corridor through the middle, rooms either side
      for (let ly = y0 + 1; ly < y0 + FLOOR; ly++) {
        for (let lx = -HW + 1; lx < HW; lx++) { F.set(lx, ly, -2, WALL); F.set(lx, ly, 2, WALL); }
        for (let lx = -HW + 8; lx < HW; lx += 8) for (let lz = -HD + 1; lz < HD; lz++) if (Math.abs(lz) > 2) F.set(lx, ly, lz, WALL);
      }
      for (let lx = -HW + 4; lx < HW; lx += 8) for (const lz of [-2, 2]) F.door(lx, y0 + 1, lz, B.SPRUCE_DOOR, lz < 0 ? 0 : 2);
      // carpets of wool down the corridor, lanterns
      for (let lx = -HW + 1; lx < HW; lx++) for (let lz = -1; lz <= 1; lz++) F.set(lx, y0, lz, lz === 0 ? B.RED_WOOL : floor ? FL : B.DARK_OAK_PLANKS);
      for (let lx = -HW + 2; lx < HW; lx += 6) F.set(lx, y0 + 1, lz0(lx), B.LANTERN);
      // what is in the rooms
      for (let rx = -HW + 4; rx < HW; rx += 8) {
        for (const side of [-1, 1]) {
          const rz = side * 6;
          const what = Math.floor(rand() * 5);
          if (what === 0) { F.bed(rx - 1, y0 + 1, side * 9, 'red'); F.bed(rx + 1, y0 + 1, side * 9, 'white'); }
          else if (what === 1) { for (let k = -2; k <= 2; k++) { F.set(rx + k, y0 + 1, rz + side * 3, B.BOOKSHELF); F.set(rx + k, y0 + 2, rz + side * 3, B.BOOKSHELF); } }
          else if (what === 2) F.chest(rx, y0 + 1, rz + side * 3, side > 0 ? 0 : 2, LOOT.mansion);
          else if (what === 3) { F.fill(rx - 2, y0, rz - 2, rx + 2, y0, rz + 2, B.WHITE_WOOL); F.set(rx, y0 + 1, rz, B.CRAFTING_TABLE); }
          else F.set(rx, y0 + 1, rz, B.LANTERN);
          if (rand() < 0.55) F.mob(rand() < 0.2 ? 'evoker' : 'vindicator', rx, y0 + 1, rz);
        }
      }
    }
    // stairs up: ladders at the corridor's far end
    for (let ly = 1; ly <= 2 * FLOOR; ly++) F.set(HW - 1, ly, 0, B.LADDER, F.face(1));
    // the front door
    F.fill(-1, 1, -HD, 1, 3, -HD, 0);
    F.door(-1, 1, -HD, B.SPRUCE_DOOR); F.door(1, 1, -HD, B.SPRUCE_DOOR);
    F.fill(-2, 0, -HD - 1, 2, 0, -HD - 1, CO);
    // a stepped roof
    const top = 3 * FLOOR;
    for (let k = 0; k < 6; k++) {
      F.ring(-HW - 1 + k, -HD - 1 + k, HW + 1 - k, HD + 1 - k, top + k, k % 2 ? B.DARK_OAK_PLANKS : CO);
    }
    F.fill(-HW + 5, top + 5, -HD + 5, HW - 5, top + 5, HD - 5, B.DARK_OAK_PLANKS);
    function lz0(lx) { return lx % 12 === 0 ? 1 : -1; }
  }

  // ------------------------------------------------------------------------------ mineshaft
  plan_mineshaft(st, rand) {
    if (rand() < 0.45) return null;
    const c = this.col(st.x, st.z);
    if (c.biome === BI.OCEAN || c.height < SEA - 4) return null;
    const y = Math.max(14, Math.min(c.height - 18, 18 + Math.floor(rand() * 26)));
    if (y < 14) return null;
    const L = { kind: 'mineshaft', x: st.x, y, z: st.z, pieces: [], clear: [] };
    L.pieces.push({ t: 'room', x0: st.x - 5, y0: y, z0: st.z - 5, x1: st.x + 5, y1: y + 4, z1: st.z + 5 });
    const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const queue = [];
    for (let f = 0; f < 4; f++) if (rand() < 0.85) queue.push({ x: st.x + DIRS[f][0] * 6, y, z: st.z + DIRS[f][1] * 6, f, depth: 0 });
    let n = 0;
    while (queue.length && n < 44) {
      const q = queue.shift();
      const [dx, dz] = DIRS[q.f];
      const len = 10 + Math.floor(rand() * 7) * 4;
      const ex = q.x + dx * len, ez = q.z + dz * len;
      if (Math.abs(ex - st.x) > 80 || Math.abs(ez - st.z) > 80) continue;
      n++;
      const spider = rand() < 0.1;
      const piece = { t: 'corridor', x0: Math.min(q.x, ex), z0: Math.min(q.z, ez), x1: Math.max(q.x, ex), z1: Math.max(q.z, ez), y: q.y, axis: dx ? 'x' : 'z', rails: rand() < 0.55, spider, seed: Math.floor(rand() * 1e9) };
      piece.chests = [];
      if (rand() < 0.35) piece.chests.push(Math.floor(rand() * len));
      L.pieces.push(piece);
      if (q.depth >= 4) continue;
      // at the end: a crossing to go on from, or a turn
      const r = rand();
      const nx = ex + dx, nz = ez + dz;
      if (r < 0.45) {
        L.pieces.push({ t: 'cross', x0: nx - 2, y0: q.y, z0: nz - 2, x1: nx + 2, y1: q.y + 3, z1: nz + 2 });
        for (const f of [(q.f + 1) & 3, q.f, (q.f + 3) & 3]) if (rand() < 0.7) queue.push({ x: nx + DIRS[f][0] * 3, y: q.y, z: nz + DIRS[f][1] * 3, f, depth: q.depth + 1 });
      } else if (r < 0.75) {
        const f = (q.f + (rand() < 0.5 ? 1 : 3)) & 3;
        L.pieces.push({ t: 'cross', x0: nx - 1, y0: q.y, z0: nz - 1, x1: nx + 1, y1: q.y + 2, z1: nz + 1 });
        queue.push({ x: nx + DIRS[f][0] * 2, y: q.y, z: nz + DIRS[f][1] * 2, f, depth: q.depth + 1 });
      }
    }
    return L;
  }

  paste_mineshaft(ctx, L) {
    const carve = (x, y, z) => {
      const b = ctx.get(x, y, z);
      if (b < 0 || b === B.BEDROCK || IS_LIQUID[b]) return;
      ctx.set(x, y, z, 0);
    };
    for (const p of L.pieces) {
      if (p.t === 'room' || p.t === 'cross') {
        if (!ctx.touches(p.x0, p.z0, p.x1, p.z1)) continue;
        for (let y = p.y0; y <= p.y1; y++) for (let z = Math.max(p.z0, ctx.z0); z <= Math.min(p.z1, ctx.z0 + CS - 1); z++) {
          for (let x = Math.max(p.x0, ctx.x0); x <= Math.min(p.x1, ctx.x0 + CS - 1); x++) carve(x, y, z);
        }
        if (p.t === 'room') {
          for (let z = Math.max(p.z0, ctx.z0); z <= Math.min(p.z1, ctx.z0 + CS - 1); z++) {
            for (let x = Math.max(p.x0, ctx.x0); x <= Math.min(p.x1, ctx.x0 + CS - 1); x++) if (!IS_SOLID[Math.max(0, ctx.get(x, p.y0 - 1, z))]) ctx.set(x, p.y0 - 1, z, B.DIRT);
          }
        }
        continue;
      }
      const x0 = p.axis === 'x' ? p.x0 : p.x0 - 1, x1 = p.axis === 'x' ? p.x1 : p.x1 + 1;
      const z0 = p.axis === 'z' ? p.z0 : p.z0 - 1, z1 = p.axis === 'z' ? p.z1 : p.z1 + 1;
      if (!ctx.touches(x0, z0, x1, z1)) continue;
      const along = p.axis === 'x' ? p.x0 : p.z0;
      for (let z = Math.max(z0, ctx.z0); z <= Math.min(z1, ctx.z0 + CS - 1); z++) {
        for (let x = Math.max(x0, ctx.x0); x <= Math.min(x1, ctx.x0 + CS - 1); x++) {
          const t = (p.axis === 'x' ? x : z) - along;
          const side = p.axis === 'x' ? z - p.z0 : x - p.x0; // -1, 0, 1 across the corridor
          for (let y = p.y; y <= p.y + 2; y++) carve(x, y, z);
          // a plank floor over caves
          const below = ctx.get(x, p.y - 1, z);
          if (below === 0 || below === B.WATER || below === B.LAVA) ctx.set(x, p.y - 1, z, B.OAK_PLANKS);
          const h = hash3(x, p.y, z, p.seed);
          if (t % 4 === 0) {
            // a timber support
            if (side !== 0) { ctx.set(x, p.y, z, B.OAK_FENCE); ctx.set(x, p.y + 1, z, B.OAK_FENCE); }
            ctx.set(x, p.y + 2, z, B.OAK_PLANKS);
            if (side === 0 && h < 0.08) ctx.set(x, p.y + 1, z, B.TORCH);
          } else if (side === 0) {
            if (p.rails && h < 0.8) ctx.set(x, p.y, z, B.RAIL, p.axis === 'x' ? 1 : 0);
          } else if (h < (p.spider ? 0.3 : 0.05)) ctx.set(x, p.y + (h < 0.02 ? 0 : 2), z, B.COBWEB);
          if (side === 1 && p.chests.includes(t) && t % 4 !== 0) ctx.chest(x, p.y, z, p.axis === 'x' ? 0 : 3, LOOT.mineshaft);
          if (p.spider && side === 0 && t === (((p.axis === 'x' ? p.x1 - p.x0 : p.z1 - p.z0) >> 1) | 1)) ctx.spawner(x, p.y, z, 3);
        }
      }
    }
  }

  // ------------------------------------------------------------------------------ dungeon
  // Small rooms entirely inside one chunk: a spawner, a chest or two.
  dungeon(ctx) {
    const h = hash2(ctx.cx, ctx.cz, this.seed ^ 0xd06e);
    if (h > 0.22) return;
    const rand = mulberry32((h * 4294967296) >>> 0);
    const x = ctx.x0 + 4 + Math.floor(rand() * 8), z = ctx.z0 + 4 + Math.floor(rand() * 8);
    const ground = this.col(x, z).height;
    const top = Math.min(ground - 10, SEA + 10);
    if (top < 14) return;
    const y = 12 + Math.floor(rand() * (top - 12));
    if (ctx.get(x, y, z) !== B.STONE) return;
    for (let dy = -1; dy <= 4; dy++) {
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
        const wall = Math.abs(dx) === 4 || Math.abs(dz) === 4 || dy === -1 || dy === 4;
        if (wall) ctx.setSolid(x + dx, y + dy, z + dz, dy === -1 && rand() < 0.7 ? B.MOSSY_COBBLESTONE : rand() < 0.2 ? B.MOSSY_COBBLESTONE : B.COBBLESTONE);
        else ctx.set(x + dx, y + dy, z + dz, 0);
      }
    }
    const mob = rand();
    ctx.spawner(x, y, z, mob < 0.5 ? 0 : mob < 0.75 ? 1 : 2);
    const spots = [[-3, 0, 1], [3, 0, 3], [0, -3, 2], [0, 3, 0]];
    const n = 1 + (rand() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const [dx, dz, g] = spots[Math.floor(rand() * 4)];
      ctx.chest(x + dx, y, z + dz, g, LOOT.dungeon);
    }
  }
}

// ------------------------------------------------------------------------------------ end cities
// On some of the End's outer islands: a purpur tower with a chest at the top and a ship floating
// off its side holding a pair of elytra. A gateway back to the main island stands at the edge.
export function pasteEndCity(ctx, city) {
  const { x, y, z } = city;
  const F = new Frame(ctx, x, y, z, city.f);
  const PU = B.PURPUR_BLOCK, PP = B.PURPUR_PILLAR, EB = B.END_STONE_BRICKS, ROD = B.END_ROD;
  // the base house
  F.fill(-5, 1, -5, 5, 30, 5, 0);
  for (let lz = -4; lz <= 4; lz++) for (let lx = -4; lx <= 4; lx++) { F.set(lx, 0, lz, EB); F.foundation(lx, lz, B.END_STONE); }
  for (let ly = 1; ly <= 5; ly++) {
    F.ring(-4, -4, 4, 4, ly, PU);
    for (const [lx, lz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) F.set(lx, ly, lz, PP);
  }
  F.fill(-4, 6, -4, 4, 6, 4, PU);
  F.fill(-1, 1, -4, 1, 3, -4, 0);
  F.set(-3, 1, -3, ROD); F.set(3, 1, -3, ROD);
  // the tower: three storeys up a ladder, platforms and end rods at each level
  for (let s = 0; s < 3; s++) {
    const y0 = 6 + s * 7;
    for (let ly = y0 + 1; ly <= y0 + 6; ly++) {
      F.ring(-2, -2, 2, 2, ly, ly === y0 + 3 ? PP : PU);
      F.set(0, ly, -2, ly === y0 + 3 ? B.GLASS : PU);
    }
    F.fill(-3, y0 + 7, -3, 3, y0 + 7, 3, PU);
    for (const [lx, lz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) F.set(lx, y0 + 8, lz, ROD);
  }
  F.fill(-1, 1, 1, -1, 28, 1, B.LADDER, F.face(3));
  // the top room
  const ty = 27;
  for (let ly = ty + 1; ly <= ty + 4; ly++) F.ring(-4, -4, 4, 4, ly, ly === ty + 2 ? PP : PU);
  F.fill(-4, ty + 5, -4, 4, ty + 5, 4, PU);
  F.set(1, ty + 1, 2, B.CHEST, F.face(0) | (LOOT.end_city << 4));
  F.set(-2, ty + 1, -2, ROD);
  F.mob('shulker', 3, ty + 1, 3);
  F.mob('shulker', -3, ty + 1, 3);
  F.mob('shulker', 3, 7, -3);
  F.mob('shulker', -3, 14, 3);
  // the ship, off to the side and higher up
  const sx = 22, sy = 20;
  for (let lx = -9; lx <= 9; lx++) {
    const w = lx < -6 ? 1 : lx > 6 ? Math.max(0, 9 - lx) : 2;
    for (let lz = -w; lz <= w; lz++) {
      F.set(sx + lx, sy, lz, PU);
      F.set(sx + lx, sy + 1, lz, Math.abs(lz) === w ? PU : 0);
      F.set(sx + lx, sy + 2, lz, Math.abs(lz) === w ? PU : Math.abs(lx) < 6 ? EB : 0);
    }
  }
  for (let ly = 3; ly <= 10; ly++) F.set(sx, sy + ly, 0, PP);
  F.fill(sx - 3, sy + 8, 0, sx + 3, sy + 8, 0, PP);
  F.set(sx - 4, sy + 1, 0, B.CHEST, F.face(3) | (LOOT.end_ship << 4));
  F.set(sx + 2, sy + 1, 0, B.CHEST, F.face(1) | (LOOT.end_city << 4));
  F.set(sx - 9, sy + 1, 0, ROD);
  F.mob('shulker', sx + 5, sy + 3, 1);
  F.mob('shulker', sx - 5, sy + 3, -1);
  // the gateway home, at the island's edge
  const g = city.gate;
  if (g) {
    for (let dy = -1; dy <= 1; dy += 2) ctx.set(g[0], g[1] + dy, g[2], B.BEDROCK);
    ctx.set(g[0], g[1], g[2], B.END_GATEWAY);
  }
}
