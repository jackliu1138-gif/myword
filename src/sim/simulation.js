// The living world: creatures, dropped items, arrows, spawning, combat, explosions and the players'
// health. Runs at 20 ticks per second on the game's thread in single player; written without
// DOM or WebGL so the multiplayer server can run the same code.

import { Mob, ItemDrop, Arrow, MOBS, HOSTILE_TYPES, ANIMAL_TYPES, TICK } from './entities.js';
import { rayHitsBox } from './physics.js';
import { blockDrops, ITEM } from './items.js';
import { BLOCK, IS_SOLID, IS_LIQUID } from '../world/blocks.js';

const DIFFICULTY = {
  peaceful: { damage: 0, hostileCap: 0, regen: 3 },
  easy: { damage: 0.5, hostileCap: 8, regen: 1.3 },
  normal: { damage: 1, hostileCap: 14, regen: 1 },
  hard: { damage: 1.5, hostileCap: 20, regen: 0.7 },
};

export const MAX_HEALTH = 20;
export const MAX_AIR = 10;

export class Simulation {
  constructor(world, opts = {}) {
    this.world = world;
    this.entities = new Map();
    this.nextId = 1;
    this.players = new Map();
    this.events = [];
    this.acc = 0;
    this.ticks = 0;
    this.difficulty = opts.difficulty || 'normal';
    this.spawnMobs = opts.spawnMobs !== false;
    this.pathBudget = 0;
    this.day = true;
    this.daylight = 1;
    this.pickup = null; // (playerId, itemId, count, wear) => number taken
  }

  get diff() { return DIFFICULTY[this.difficulty] || DIFFICULTY.normal; }

  emit(e) {
    this.events.push(e);
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ------------------------------------------------------------------ players
  addPlayer(id, info = {}) {
    const p = {
      id, pos: [0, 80, 0], vel: [0, 0, 0], hw: 0.3, h: 1.8, eyeHeight: 1.62,
      health: MAX_HEALTH, air: MAX_AIR, fire: 0, hurtTime: 0, lastDamage: 99, dead: false,
      mode: 'survival', inWater: false, headInWater: false, inLava: false, regen: 0, name: '',
      ...info,
    };
    this.players.set(id, p);
    return p;
  }

  player(id) {
    return this.players.get(id);
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  damagePlayer(id, amount, source, from = null) {
    const p = this.players.get(id);
    if (!p || p.dead || p.mode === 'creative' || amount <= 0) return false;
    if (p.hurtTime > 0.4 && source !== 'drown' && source !== 'fire' && source !== 'void') return false;
    p.health = Math.max(0, p.health - amount);
    p.hurtTime = 0.5;
    p.lastDamage = 0;
    this.emit({ type: 'playerHurt', id, amount, source, from });
    if (p.health <= 0) {
      p.dead = true;
      this.emit({ type: 'playerDeath', id, source });
    }
    return true;
  }

  healPlayer(id, amount) {
    const p = this.players.get(id);
    if (!p || p.dead) return;
    p.health = Math.min(MAX_HEALTH, p.health + amount);
  }

  respawnPlayer(id, pos) {
    const p = this.players.get(id);
    if (!p) return;
    Object.assign(p, { dead: false, health: MAX_HEALTH, air: MAX_AIR, fire: 0, hurtTime: 0, pos: pos.slice() });
  }

  tickPlayers() {
    const w = this.world;
    for (const p of this.players.values()) {
      if (p.hurtTime > 0) p.hurtTime -= TICK;
      p.lastDamage += TICK;
      if (p.dead || p.mode === 'creative') { p.air = MAX_AIR; p.fire = 0; continue; }
      // air under water
      if (p.headInWater) {
        p.air -= TICK;
        if (p.air <= 0) { p.air += 1; this.damagePlayer(p.id, 2, 'drown'); }
      } else p.air = Math.min(MAX_AIR, p.air + TICK * 4);
      // lava, fire, cactus, the void
      if (p.inLava) { p.fire = 8; if (this.ticks % 10 === 0) this.damagePlayer(p.id, 4, 'lava'); }
      if (p.inWater) p.fire = 0;
      if (p.fire > 0) {
        p.fire -= TICK;
        if (this.ticks % 20 === 0) this.damagePlayer(p.id, 1, 'fire');
      }
      if (this.ticks % 10 === 0 && this.touchingCactus(p)) this.damagePlayer(p.id, 1, 'cactus');
      if (p.pos[1] < -10 && this.ticks % 10 === 0) this.damagePlayer(p.id, 4, 'void');
      // slow natural regeneration after a while without damage
      if (p.health < MAX_HEALTH && p.lastDamage > 6) {
        p.regen += TICK * this.diff.regen;
        if (p.regen >= 3) { p.regen = 0; p.health = Math.min(MAX_HEALTH, p.health + 1); }
      }
      void w;
    }
  }

  touchingCactus(p) {
    const w = this.world;
    const x0 = Math.floor(p.pos[0] - 0.4), x1 = Math.floor(p.pos[0] + 0.4);
    const z0 = Math.floor(p.pos[2] - 0.4), z1 = Math.floor(p.pos[2] + 0.4);
    const y0 = Math.floor(p.pos[1]), y1 = Math.floor(p.pos[1] + 1.7);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (w.getBlock(x, y, z) === BLOCK.CACTUS) return true;
    }
    return false;
  }

  // Nearest living survival player a hostile creature notices.
  nearestTarget(mob, range) {
    let best = null, bd = range * range;
    for (const p of this.players.values()) {
      if (p.dead || p.mode === 'creative') continue;
      const dx = p.pos[0] - mob.body.pos[0], dy = p.pos[1] - mob.body.pos[1], dz = p.pos[2] - mob.body.pos[2];
      const d = dx * dx + dy * dy * 2 + dz * dz;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // ------------------------------------------------------------------ entities
  add(e) {
    this.entities.set(e.id, e);
    return e;
  }

  spawnMob(type, x, y, z) {
    const m = this.add(new Mob(this, this.nextId++, type, x, y, z));
    return m;
  }

  dropItem(itemId, count, x, y, z, vel = null, wear = 0) {
    if (!itemId || count <= 0) return null;
    const d = this.add(new ItemDrop(this, this.nextId++, itemId, count, x, y, z, wear));
    if (vel) d.body.vel = vel.slice();
    return d;
  }

  shootArrow(owner, pos, dir, speed, damage, pickup = false) {
    const a = this.add(new Arrow(this, this.nextId++, owner, pos[0], pos[1], pos[2], dir[0] * speed, dir[1] * speed, dir[2] * speed, damage));
    a.pickup = pickup;
    this.emit({ type: 'sound', name: 'bow', pos });
    return a;
  }

  mobAttack(mob, target) {
    const dmg = (mob.def.damage || 2) * this.diff.damage;
    if (this.damagePlayer(target.id, dmg, mob.type, mob.body.pos)) {
      this.emit({ type: 'knock', id: target.id, from: mob.body.pos, strength: 1 });
    }
    this.emit({ type: 'sound', name: mob.type + 'Attack', pos: mob.body.pos });
  }

  mobShoot(mob, target) {
    const e = mob.eyePos;
    const tx = target.pos[0], ty = target.pos[1] + 1.3, tz = target.pos[2];
    const dx = tx - e[0], dz = tz - e[2];
    const flat = Math.hypot(dx, dz);
    const speed = 22;
    // aim a little high to make up for the drop, with some spread
    const dy = ty - e[1] + flat * flat * 20 / (2 * speed * speed);
    const l = Math.hypot(dx, dy, dz) || 1;
    const spread = 0.05 * (this.difficulty === 'hard' ? 0.5 : 1);
    const dir = [dx / l + (Math.random() - 0.5) * spread, dy / l + (Math.random() - 0.5) * spread, dz / l + (Math.random() - 0.5) * spread];
    this.shootArrow(mob.id, [e[0] + dir[0] * 0.6, e[1], e[2] + dir[2] * 0.6], dir, speed, 3 + Math.random() * 2);
  }

  // An arrow moving to `next`: hits the first creature or player on the way.
  arrowHit(arrow, next) {
    const a = arrow.body.pos;
    const d = [next[0] - a[0], next[1] - a[1], next[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]) || 1e-6;
    const dir = [d[0] / len, d[1] / len, d[2] / len];
    for (const e of this.entities.values()) {
      if (e.kind !== 'mob' || e.id === arrow.owner || e.deathTime > 0) continue;
      const b = e.body;
      const box = [b.pos[0] - b.hw, b.pos[1], b.pos[2] - b.hw, b.pos[0] + b.hw, b.pos[1] + b.h, b.pos[2] + b.hw];
      if (rayHitsBox(a, dir, box, len) !== null) {
        const dmg = arrow.damage;
        e.hurt(dmg, a, 0.5);
        this.emit({ type: 'hurt', entity: e, pos: b.pos.slice() });
        return true;
      }
    }
    for (const p of this.players.values()) {
      if (p.dead || p.id === arrow.owner) continue;
      const box = [p.pos[0] - p.hw, p.pos[1], p.pos[2] - p.hw, p.pos[0] + p.hw, p.pos[1] + p.h, p.pos[2] + p.hw];
      if (rayHitsBox(a, dir, box, len) !== null) {
        const byMob = typeof arrow.owner === 'number';
        const dmg = arrow.damage * (byMob ? this.diff.damage : 1);
        const shooter = byMob ? this.entities.get(arrow.owner) : null;
        if (this.damagePlayer(p.id, dmg, shooter ? shooter.type : 'arrow', a)) this.emit({ type: 'knock', id: p.id, from: a, strength: 0.6 });
        return true;
      }
    }
    return false;
  }

  // First creature along a ray (the player's melee attack), within maxDist.
  pickEntity(origin, dir, maxDist) {
    let best = null, bt = maxDist;
    for (const e of this.entities.values()) {
      if (e.kind !== 'mob' || e.deathTime > 0) continue;
      const b = e.body;
      const pad = 0.1;
      const box = [b.pos[0] - b.hw - pad, b.pos[1] - pad, b.pos[2] - b.hw - pad, b.pos[0] + b.hw + pad, b.pos[1] + b.h + pad, b.pos[2] + b.hw + pad];
      const t = rayHitsBox(origin, dir, box, bt);
      if (t !== null && t < bt) { bt = t; best = e; }
    }
    return best ? { entity: best, t: bt } : null;
  }

  playerAttack(playerId, entity, damage, crit = false) {
    const p = this.players.get(playerId);
    if (!p || !entity || entity.removed) return false;
    const from = p.pos;
    if (!entity.hurt(damage * (crit ? 1.5 : 1), from, 1)) return false;
    this.emit({ type: 'hurt', entity, pos: entity.body.pos.slice(), crit });
    // hostile creatures turn on whoever hurt them
    if (entity.hostile) entity.target = p;
    return true;
  }

  onMobDeath(mob) {
    const p = mob.body.pos;
    this.emit({ type: 'death', entity: mob, pos: p.slice() });
    for (const [item, lo, hi] of mob.def.drops || []) {
      let n = lo + Math.floor(Math.random() * (hi - lo + 1));
      if (hi < 1) n = Math.random() < hi ? 1 : 0; // rare drops
      const id = item === 'wool' ? mob.variant || BLOCK.WHITE_WOOL : item;
      if (n > 0) this.dropItem(id, n, p[0], p[1] + 0.5, p[2]);
    }
  }

  // Blast: breaks blocks in a rough sphere, hurts and throws back everything nearby.
  explode(x, y, z, power, source = null) {
    const w = this.world;
    const r = power * 1.15;
    const ir = Math.ceil(r);
    const broken = [];
    for (let dy = -ir; dy <= ir; dy++) {
      for (let dz = -ir; dz <= ir; dz++) {
        for (let dx = -ir; dx <= ir; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d > r * (0.7 + Math.random() * 0.3)) continue;
          const bx = Math.floor(x + dx), by = Math.floor(y + dy), bz = Math.floor(z + dz);
          const b = w.getBlock(bx, by, bz);
          if (!b || b === BLOCK.BEDROCK || b === BLOCK.OBSIDIAN || IS_LIQUID[b]) continue;
          broken.push([bx, by, bz, b]);
        }
      }
    }
    for (const [bx, by, bz, b] of broken) {
      if (w.setBlock(bx, by, bz, 0) && Math.random() < 0.3) {
        for (const [id, n] of blockDrops(b)) this.dropItem(id, n, bx + 0.5, by + 0.5, bz + 0.5);
      }
    }
    this.emit({ type: 'explosion', pos: [x, y, z], power, blocks: broken.length });
    const reach = power * 2;
    const impactAt = (px, py, pz) => {
      const d = Math.hypot(px - x, py - y, pz - z);
      return d < reach ? 1 - d / reach : 0;
    };
    for (const e of this.entities.values()) {
      if (e === source || e.removed) continue;
      const b = e.body;
      const k = impactAt(b.pos[0], b.pos[1] + b.h * 0.5, b.pos[2]);
      if (k <= 0) continue;
      if (e.kind === 'mob') e.hurt(Math.round(24 * Math.pow(k, 1.4)), [x, y, z], k * 2);
      const dx = b.pos[0] - x, dy = b.pos[1] + b.h * 0.5 - y, dz = b.pos[2] - z;
      const l = Math.hypot(dx, dy, dz) || 1;
      b.vel[0] += (dx / l) * 14 * k; b.vel[1] += (dy / l) * 10 * k + 3 * k; b.vel[2] += (dz / l) * 14 * k;
    }
    for (const p of this.players.values()) {
      const k = impactAt(p.pos[0], p.pos[1] + 0.9, p.pos[2]);
      if (k <= 0) continue;
      this.damagePlayer(p.id, Math.round(24 * Math.pow(k, 1.4) * Math.max(this.diff.damage, 0.5)), source && source.type === 'creeper' ? 'creeper' : 'explosion', [x, y, z]);
      this.emit({ type: 'knock', id: p.id, from: [x, y, z], strength: k * 2.5 });
    }
  }

  // ------------------------------------------------------------------ spawning
  standable(x, y, z, h) {
    const w = this.world;
    if (y < 2 || y > 125) return false;
    if (IS_SOLID[w.getBlock(x, y, z)] || IS_LIQUID[w.getBlock(x, y, z)]) return false;
    if (h > 1 && (IS_SOLID[w.getBlock(x, y + 1, z)] || IS_LIQUID[w.getBlock(x, y + 1, z)])) return false;
    const below = w.getBlock(x, y - 1, z);
    return IS_SOLID[below] && below !== BLOCK.CACTUS && below !== BLOCK.BEDROCK;
  }

  lightAt(x, y, z) {
    const [sl, bl] = this.world.getLight(x, y, z);
    return Math.max(sl * this.daylight, bl);
  }

  countNear(pred, pos, radius) {
    let n = 0;
    const r2 = radius * radius;
    for (const e of this.entities.values()) {
      if (e.kind !== 'mob' || !pred(e)) continue;
      const dx = e.body.pos[0] - pos[0], dz = e.body.pos[2] - pos[2];
      if (dx * dx + dz * dz < r2) n++;
    }
    return n;
  }

  farFromPlayers(x, z, minDist) {
    for (const p of this.players.values()) {
      const dx = p.pos[0] - x, dz = p.pos[2] - z;
      if (dx * dx + dz * dz < minDist * minDist) return false;
    }
    return true;
  }

  trySpawn() {
    const w = this.world;
    for (const p of this.players.values()) {
      if (p.dead) continue;
      // monsters in the dark
      const cap = this.diff.hostileCap;
      if (this.spawnMobs && cap > 0 && this.countNear((e) => e.hostile, p.pos, 72) < cap) {
        for (let i = 0; i < 4; i++) {
          const a = Math.random() * Math.PI * 2, r = 22 + Math.random() * 34;
          const x = Math.floor(p.pos[0] + Math.cos(a) * r), z = Math.floor(p.pos[2] + Math.sin(a) * r);
          if (!w.isChunkReady(x, z) || !this.farFromPlayers(x, z, 20)) continue;
          // surface at night, or a cave near the player's height
          let y = Math.random() < 0.5 ? w.surfaceHeight(x, z) + 1 : Math.floor(p.pos[1] - 18 + Math.random() * 30);
          let found = false;
          for (let k = 0; k < 10; k++, y--) if (this.standable(x, y, z, 2)) { found = true; break; }
          if (!found || this.lightAt(x, y, z) > 7) continue;
          let types = HOSTILE_TYPES.filter((tp) => !MOBS[tp].nightOnly || !this.day);
          const weights = { zombie: 4, skeleton: 3, creeper: 3, spider: 2 };
          const total = types.reduce((s, tp) => s + weights[tp], 0);
          let pick = Math.random() * total, type = types[0];
          for (const tp of types) { pick -= weights[tp]; if (pick <= 0) { type = tp; break; } }
          this.spawnMob(type, x + 0.5, y, z + 0.5);
          break;
        }
      }
      // animals on grass in the light
      if (this.spawnMobs && this.countNear((e) => !e.hostile, p.pos, 80) < 10) {
        const a = Math.random() * Math.PI * 2, r = 28 + Math.random() * 36;
        const x = Math.floor(p.pos[0] + Math.cos(a) * r), z = Math.floor(p.pos[2] + Math.sin(a) * r);
        if (!w.isChunkReady(x, z) || !this.farFromPlayers(x, z, 24)) continue;
        const y = w.surfaceHeight(x, z) + 1;
        if (w.getBlock(x, y - 1, z) !== BLOCK.GRASS || !this.standable(x, y, z, 2)) continue;
        const [sl] = w.getLight(x, y, z);
        if (sl < 12) continue;
        const type = ANIMAL_TYPES[Math.floor(Math.random() * ANIMAL_TYPES.length)];
        const n = 2 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n; k++) {
          const ox = x + Math.floor((Math.random() - 0.5) * 5), oz = z + Math.floor((Math.random() - 0.5) * 5);
          const oy = w.surfaceHeight(ox, oz) + 1;
          if (w.getBlock(ox, oy - 1, oz) === BLOCK.GRASS && this.standable(ox, oy, oz, 2)) this.spawnMob(type, ox + 0.5, oy, oz + 0.5);
        }
      }
    }
  }

  despawn(e) {
    let near = Infinity;
    for (const p of this.players.values()) {
      const dx = p.pos[0] - e.body.pos[0], dz = p.pos[2] - e.body.pos[2];
      near = Math.min(near, dx * dx + dz * dz);
    }
    const limit = e.hostile ? 84 : 120;
    return near > limit * limit;
  }

  // ------------------------------------------------------------------ the tick
  // env: { dayTime } where 0 = sunrise, 0.25 = noon, 0.5 = sunset
  update(dt, env = {}) {
    this.acc += Math.min(dt, 0.25);
    let n = 0;
    while (this.acc >= TICK && n < 5) {
      this.acc -= TICK;
      this.tick(env);
      n++;
    }
    this.alpha = this.acc / TICK;
  }

  tick(env) {
    this.ticks++;
    const sun = Math.sin((env.dayTime ?? 0.25) * Math.PI * 2);
    this.day = sun > 0.05;
    this.daylight = Math.max(0.27, Math.min(1, sun * 4 + 0.5));
    this.pathBudget = 6;
    this.tickPlayers();
    if (this.ticks % 20 === 0) this.trySpawn();
    const w = this.world;
    const mobs = [];
    for (const e of this.entities.values()) {
      if (e.removed) { this.entities.delete(e.id); continue; }
      const p = e.body.pos;
      if (!w.isChunkReady(p[0], p[2])) continue; // frozen until its chunk loads
      if (e.kind === 'mob' && this.ticks % 40 === e.id % 40 && this.despawn(e)) { this.entities.delete(e.id); continue; }
      e.update(this);
      if (e.kind === 'mob') mobs.push(e);
      else if (e.kind === 'item') this.tickItem(e);
      else if (e.kind === 'arrow' && e.stuck && e.pickup) this.tickArrowPickup(e);
      if (e.removed) this.entities.delete(e.id);
    }
    // creatures push each other apart instead of stacking up
    for (let i = 0; i < mobs.length; i++) {
      const a = mobs[i].body;
      for (let j = i + 1; j < mobs.length; j++) {
        const b = mobs[j].body;
        const dx = b.pos[0] - a.pos[0], dz = b.pos[2] - a.pos[2];
        const min = a.hw + b.hw;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && Math.abs(b.pos[1] - a.pos[1]) < 1.5 && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.5 / d;
          a.vel[0] -= dx * push * 4; a.vel[2] -= dz * push * 4;
          b.vel[0] += dx * push * 4; b.vel[2] += dz * push * 4;
        }
      }
    }
    if (this.ticks % 20 === 0) this.mergeItems();
  }

  tickItem(it) {
    for (const p of this.players.values()) {
      if (p.dead || !this.pickup) continue;
      const dx = p.pos[0] - it.body.pos[0], dy = p.pos[1] + 0.9 - it.body.pos[1], dz = p.pos[2] - it.body.pos[2];
      const d = Math.hypot(dx, dy, dz);
      if (it.pickupDelay <= 0 && d < 3) {
        // drift towards the player, then collect
        it.body.vel[0] += (dx / d) * 30 * TICK; it.body.vel[1] += (dy / d) * 30 * TICK; it.body.vel[2] += (dz / d) * 30 * TICK;
      }
      if (it.pickupDelay <= 0 && d < 1.3) {
        const taken = this.pickup(p.id, it.item, it.count, it.wear);
        if (taken > 0) {
          it.count -= taken;
          this.emit({ type: 'pickup', id: p.id, item: it.item, count: taken, pos: it.body.pos.slice() });
          if (it.count <= 0) { it.removed = true; return; }
        }
      }
    }
  }

  tickArrowPickup(a) {
    for (const p of this.players.values()) {
      if (p.dead || !this.pickup) continue;
      const d = Math.hypot(p.pos[0] - a.body.pos[0], p.pos[1] + 0.9 - a.body.pos[1], p.pos[2] - a.body.pos[2]);
      if (d < 1.4 && this.pickup(p.id, ITEM.ARROW, 1, 0) > 0) {
        a.removed = true;
        this.emit({ type: 'pickup', id: p.id, item: ITEM.ARROW, count: 1, pos: a.body.pos.slice() });
        return;
      }
    }
  }

  mergeItems() {
    const items = [...this.entities.values()].filter((e) => e.kind === 'item' && !e.removed);
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      if (a.removed) continue;
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (b.removed || b.item !== a.item || a.wear || b.wear) continue;
        if (Math.abs(a.body.pos[0] - b.body.pos[0]) + Math.abs(a.body.pos[1] - b.body.pos[1]) + Math.abs(a.body.pos[2] - b.body.pos[2]) < 1.2) {
          a.count += b.count;
          b.removed = true;
        }
      }
    }
  }

  clear() {
    this.entities.clear();
  }
}
