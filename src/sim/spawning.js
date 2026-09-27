// Where creatures come from in the overworld, around each player simulated here: monsters in the
// dark (witches anywhere, slimes in swamps and slime chunks), animals by biome (horses on the
// plains and savanna, wolves in the forests and taiga), fish and squid in the water, phantoms over
// those who haven't slept for days, and now and then a pillager patrol.

import { MOBS } from './entities.js';
import { BLOCK, IS_SOLID, IS_LIQUID } from '../world/blocks.js';
import { hash2 } from '../world/noise.js';

const B = { OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, BIRCH: 4, TAIGA: 5, SNOWY: 6, DESERT: 7, MOUNTAINS: 8, RIVER: 9, JUNGLE: 10, SAVANNA: 11, SWAMP: 12, BADLANDS: 13, CHERRY: 14, DARK_FOREST: 15 };
const rnd = Math.random;

// animals by biome: [type, weight, min, max]
const ANIMALS = {
  [B.PLAINS]: [['cow', 8, 2, 4], ['sheep', 12, 2, 4], ['pig', 10, 2, 4], ['chicken', 10, 2, 4], ['horse', 5, 2, 5]],
  [B.SAVANNA]: [['cow', 6, 2, 4], ['sheep', 8, 2, 4], ['horse', 8, 2, 5], ['chicken', 6, 2, 4]],
  [B.FOREST]: [['cow', 8, 2, 4], ['sheep', 10, 2, 4], ['pig', 10, 2, 4], ['chicken', 8, 2, 4], ['wolf', 4, 2, 4]],
  [B.BIRCH]: [['cow', 8, 2, 4], ['sheep', 10, 2, 4], ['pig', 10, 2, 4], ['chicken', 8, 2, 4]],
  [B.DARK_FOREST]: [['cow', 6, 2, 4], ['sheep', 6, 2, 4], ['pig', 8, 2, 4], ['chicken', 6, 2, 4]],
  [B.TAIGA]: [['sheep', 10, 2, 4], ['pig', 8, 2, 4], ['chicken', 8, 2, 4], ['wolf', 8, 2, 4]],
  [B.SNOWY]: [['wolf', 6, 2, 4], ['sheep', 4, 2, 3]],
  [B.JUNGLE]: [['chicken', 10, 2, 4], ['pig', 8, 2, 4], ['cat', 2, 1, 1]],
  [B.CHERRY]: [['pig', 6, 2, 4], ['sheep', 8, 2, 4], ['chicken', 6, 2, 4]],
  [B.MOUNTAINS]: [['sheep', 10, 2, 4], ['cow', 4, 2, 3]],
  [B.SWAMP]: [['chicken', 4, 2, 3], ['cow', 2, 2, 3]],
};
const DEFAULT_ANIMALS = [['cow', 8, 2, 4], ['sheep', 12, 2, 4], ['pig', 10, 2, 4], ['chicken', 10, 2, 4]];

function pick(list) {
  const total = list.reduce((a, e) => a + e[1], 0);
  let v = rnd() * total;
  for (const e of list) { v -= e[1]; if (v <= 0) return e; }
  return list[0];
}

// slimes live under some chunks, whatever the biome
export const slimeChunk = (x, z, seed) => hash2(Math.floor(x / 16), Math.floor(z / 16), (seed ^ 0x3ad8025f) | 0) < 0.1;

function biomeOf(sim, x, z) {
  const g = sim.world.generator;
  return g && g.column ? g.column(x, z, sim.colScratch || (sim.colScratch = {})) : null;
}

export function spawnRules(sim, p) {
  const w = sim.world;
  const cap = sim.diff.hostileCap;
  // monsters in the dark
  if (sim.spawnMobs && cap > 0 && sim.countNear((e) => e.hostile, p.pos, 72) < cap) {
    for (let i = 0; i < 4; i++) {
      const a = rnd() * Math.PI * 2, r = 22 + rnd() * 34;
      const x = Math.floor(p.pos[0] + Math.cos(a) * r), z = Math.floor(p.pos[2] + Math.sin(a) * r);
      if (!w.isChunkReady(x, z) || !sim.farFromPlayers(x, z, 20)) continue;
      const surface = rnd() < 0.5;
      let y = surface ? w.surfaceHeight(x, z) + 1 : Math.floor(p.pos[1] - 18 + rnd() * 30);
      let found = false;
      for (let k = 0; k < 10; k++, y--) if (sim.standable(x, y, z, 3)) { found = true; break; }
      if (!found || sim.lightAt(x, y, z) > 7) continue;
      const col = biomeOf(sim, x, z);
      const weights = { zombie: 4, skeleton: 3, creeper: 3, spider: sim.day ? 0 : 2, enderman: sim.day ? 0 : 0.6, witch: 0.35 };
      if ((col && col.biome === B.SWAMP && !sim.day && surface) || (y < 40 && slimeChunk(x, z, w.seed || 0))) weights.slime = 3;
      const type = sim.pickWeighted(weights);
      if (type === 'slime') { const s = sim.spawnMob('slime', x + 0.5, y, z + 0.5); s.setSize([1, 2, 4][Math.floor(rnd() * 3)]); }
      else sim.spawnMob(type, x + 0.5, y, z + 0.5);
      break;
    }
  }
  // animals on grass in the light, by biome
  if (sim.spawnMobs && sim.countNear((e) => e.def.animal, p.pos, 80) < 10) {
    const a = rnd() * Math.PI * 2, r = 28 + rnd() * 36;
    const x = Math.floor(p.pos[0] + Math.cos(a) * r), z = Math.floor(p.pos[2] + Math.sin(a) * r);
    if (w.isChunkReady(x, z) && sim.farFromPlayers(x, z, 24)) {
      const y = w.surfaceHeight(x, z) + 1;
      const ground = w.getBlock(x, y - 1, z);
      const [sl] = w.getLight(x, y, z);
      if ((ground === BLOCK.GRASS || ground === BLOCK.SNOWY_GRASS) && sim.standable(x, y, z, 2) && sl >= 12) {
        const col = biomeOf(sim, x, z);
        const [type, , lo, hi] = pick((col && ANIMALS[col.biome]) || DEFAULT_ANIMALS);
        const n = lo + Math.floor(rnd() * (hi - lo + 1));
        const look = Math.floor(rnd() * 7);
        for (let k = 0; k < n; k++) {
          const ox = x + Math.floor((rnd() - 0.5) * 5), oz = z + Math.floor((rnd() - 0.5) * 5);
          const oy = w.surfaceHeight(ox, oz) + 1;
          const g = w.getBlock(ox, oy - 1, oz);
          if ((g === BLOCK.GRASS || g === BLOCK.SNOWY_GRASS) && sim.standable(ox, oy, oz, 2)) {
            const m = sim.spawnMob(type, ox + 0.5, oy, oz + 0.5);
            if (type === 'horse') m.variant = look; // a herd shares its coat
            if (rnd() < 0.1 && type !== 'wolf') m.growth = -300; // now and then a young one
          }
        }
      }
    }
  }
  // fish and squid in the water
  if (sim.spawnMobs && sim.ticks % 40 === 0 && sim.countNear((e) => e.def.water && !e.hostile, p.pos, 64) < 10) {
    const a = rnd() * Math.PI * 2, r = 16 + rnd() * 28;
    const x = Math.floor(p.pos[0] + Math.cos(a) * r), z = Math.floor(p.pos[2] + Math.sin(a) * r);
    if (w.isChunkReady(x, z) && sim.farFromPlayers(x, z, 12)) {
      const top = w.surfaceHeight(x, z, { skipFoliage: false });
      if (w.getBlock(x, top, z) === BLOCK.WATER) {
        let depth = 0;
        while (depth < 30 && w.getBlock(x, top - depth - 1, z) === BLOCK.WATER) depth++;
        if (depth >= 2) {
          const col = biomeOf(sim, x, z);
          const biome = col ? col.biome : B.OCEAN;
          const warm = col && col.temp > 0.35, cold = col && col.temp < -0.25;
          let type, n;
          if (biome === B.RIVER || (cold && biome === B.OCEAN)) { type = 'salmon'; n = 1 + Math.floor(rnd() * 4); }
          else if (biome === B.OCEAN && depth > 6 && rnd() < 0.25) { type = 'squid'; n = 1 + Math.floor(rnd() * 2); }
          else if (biome === B.OCEAN && warm) { type = rnd() < 0.15 ? 'pufferfish' : 'tropical_fish'; n = type === 'pufferfish' ? 1 : 2 + Math.floor(rnd() * 4); }
          else if (biome === B.OCEAN || biome === B.BEACH) { type = 'cod'; n = 3 + Math.floor(rnd() * 4); }
          else if (biome === B.SWAMP && depth >= 2) { type = 'tropical_fish'; n = 0; }
          const look = Math.floor(rnd() * 4);
          for (let k = 0; k < (n || 0); k++) {
            const y = top - 1 - Math.floor(rnd() * Math.min(depth - 1, 6));
            const m = sim.spawnMob(type, x + 0.5 + (rnd() - 0.5) * 2, y + 0.2, z + 0.5 + (rnd() - 0.5) * 2);
            if (type === 'tropical_fish') m.variant = look;
          }
        }
      }
    }
  }
  // phantoms: over the heads of those who haven't slept in three nights
  if (sim.spawnMobs && cap > 0 && !sim.day && p.insomnia && sim.ticks % 200 === 0 && rnd() < 0.5) {
    const [sl] = w.getLight(Math.floor(p.pos[0]), Math.floor(p.pos[1] + 1), Math.floor(p.pos[2]));
    if (sl >= 14 && sim.countNear((e) => e.type === 'phantom', p.pos, 64) < 4) {
      const n = 1 + Math.floor(rnd() * (sim.difficulty === 'hard' ? 3 : 2));
      for (let k = 0; k < n; k++) {
        const m = sim.spawnMob('phantom', p.pos[0] + (rnd() - 0.5) * 20, p.pos[1] + 20 + rnd() * 14, p.pos[2] + (rnd() - 0.5) * 20);
        m.anchor = m.body.pos.slice();
      }
    }
  }
  // a pillager patrol, from the second day on
  if (sim.spawnMobs && cap > 0 && (sim.dayCount || 0) >= 2 && sim.ticks % 20 === 0 && rnd() < 1 / 900) {
    const a = rnd() * Math.PI * 2, r = 28 + rnd() * 20;
    const x = Math.floor(p.pos[0] + Math.cos(a) * r), z = Math.floor(p.pos[2] + Math.sin(a) * r);
    if (w.isChunkReady(x, z) && sim.farFromPlayers(x, z, 24)) {
      const n = 2 + Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) {
        const ox = x + Math.floor((rnd() - 0.5) * 6), oz = z + Math.floor((rnd() - 0.5) * 6);
        const oy = w.surfaceHeight(ox, oz) + 1;
        if (sim.standable(ox, oy, oz, 2)) sim.spawnMob(k === 0 && rnd() < 0.3 ? 'vindicator' : 'pillager', ox + 0.5, oy, oz + 0.5);
      }
      sim.emit({ type: 'patrol', pos: [x, 0, z] });
    }
  }
}

// Monster spawners (from dungeons and mineshafts): a few of their creature every 10-40 seconds
// while a player is within 16 blocks, until there are six around.
export function tickSpawners(sim) {
  const w = sim.world;
  if (!w.chunks || !sim.spawnMobs || sim.diff.hostileCap <= 0) return;
  const locals = [...sim.players.values()].filter((p) => !p.remote && !p.dead);
  if (!locals.length) return;
  for (const c of w.chunks.values()) {
    if (!c.features || !c.blocks) continue;
    for (const f of c.features) {
      if (f.kind !== 'spawner') continue;
      if (!locals.some((p) => (p.pos[0] - f.x) ** 2 + (p.pos[1] - f.y) ** 2 + (p.pos[2] - f.z) ** 2 < 16 * 16)) continue;
      if (w.getBlock(f.x, f.y, f.z) !== BLOCK.SPAWNER) continue;
      const key = f.x + ',' + f.y + ',' + f.z;
      const t = (sim.spawners.get(key) ?? 2) - 1;
      sim.spawners.set(key, t);
      if (t > 0) continue;
      sim.spawners.set(key, 10 + rnd() * 30);
      sim.emit({ type: 'spawnerFx', pos: [f.x + 0.5, f.y + 0.5, f.z + 0.5] });
      if (sim.countNear((e) => e.type === f.mob, [f.x, f.y, f.z], 9) >= 6) continue;
      const def = MOBS[f.mob];
      for (let k = 0; k < 4; k++) {
        const x = f.x + Math.floor((rnd() - 0.5) * 8), z = f.z + Math.floor((rnd() - 0.5) * 8), y = f.y + Math.floor(rnd() * 3) - 1;
        if (!sim.standable(x, y, z, def && def.h > 1 ? 2 : 1) || sim.lightAt(x, y, z) > 11) continue;
        sim.spawnMob(f.mob, x + 0.5, y, z + 0.5);
      }
    }
  }
}

// Animals in love pair up and have a young one.
export function tickBreeding(sim) {
  const lovers = [];
  for (const e of sim.entities.values()) if (e.kind === 'mob' && e.love > 0 && !e.ghost && e.deathTime === 0) lovers.push(e);
  for (const a of lovers) {
    if (a.love <= 0) continue;
    if (!a.mate || !(a.mate.love > 0) || a.mate.removed) {
      a.mate = lovers.find((b) => b !== a && b.type === a.type && b.love > 0 && (!b.mate || b.mate === a) &&
        (b.body.pos[0] - a.body.pos[0]) ** 2 + (b.body.pos[2] - a.body.pos[2]) ** 2 < 10 * 10) || null;
      if (a.mate) a.mate.mate = a;
      continue;
    }
    const b = a.mate;
    if ((b.body.pos[0] - a.body.pos[0]) ** 2 + (b.body.pos[2] - a.body.pos[2]) ** 2 > 1.8 * 1.8) continue;
    const x = (a.body.pos[0] + b.body.pos[0]) / 2, y = Math.max(a.body.pos[1], b.body.pos[1]), z = (a.body.pos[2] + b.body.pos[2]) / 2;
    const baby = sim.spawnMob(a.type, x, y, z);
    baby.growth = -600;
    baby.renderScale = 0.55;
    baby.persistent = true;
    if (a.type === 'sheep') baby.variant = Math.random() < 0.5 ? a.variant : b.variant;
    if (a.type === 'horse' || a.type === 'cat') baby.variant = Math.random() < 0.5 ? a.variant : b.variant;
    if (a.tamed) { baby.tamed = a.tamed; }
    for (const m of [a, b]) { m.love = 0; m.mate = null; m.breedCooldown = 300; m.persistent = true; }
    sim.emit({ type: 'bred', pos: [x, y + 0.5, z], breeder: a.breeder || b.breeder || null });
    if (a.breeder && sim.players.get(a.breeder) && !sim.players.get(a.breeder).remote) sim.dropXp(x, y + 0.5, z, 1 + Math.floor(Math.random() * 7));
  }
}

export { IS_SOLID, IS_LIQUID };
