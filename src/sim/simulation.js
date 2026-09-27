// The living world: creatures, dropped items, arrows, spawning, combat, explosions and the players'
// health. Runs at 20 ticks per second on the game's thread in single player; written without
// DOM or WebGL so the multiplayer server can run the same code.

import { Mob, ItemDrop, Arrow, Thrown, EyeOfEnder, Fireball, MOBS, HOSTILE_TYPES, ANIMAL_TYPES, HUNTS, TICK } from './entities.js';
import { EnderDragon } from './dragon.js';
import { rayHitsBox } from './physics.js';
import { blockDrops, ITEM } from './items.js';
import { armorReduce } from './inventory.js';
import { BLOCK, IS_SOLID, IS_LIQUID, WORLD_HEIGHT } from '../world/blocks.js';
import { SplashPotion, WitherSkull, ShulkerBullet, Firework, Bobber, XpOrb } from './projectiles.js';
import { addEffect, hasEffect, potionOutcome, tickHunger, EXHAUST } from './effects.js';
import { effectMob, alive } from './creatures.js';
import { spawnRules, tickSpawners, tickBreeding } from './spawning.js';

const DIFFICULTY = {
  peaceful: { damage: 0, hostileCap: 0, regen: 3 },
  easy: { damage: 0.5, hostileCap: 8, regen: 1.3 },
  normal: { damage: 1, hostileCap: 14, regen: 1 },
  hard: { damage: 1.5, hostileCap: 20, regen: 0.7 },
};

export const MAX_HEALTH = 20;
// food that comes out cooked when what dropped it burned to death
const COOKED = {
  [ITEM.RAW_BEEF]: ITEM.COOKED_BEEF, [ITEM.RAW_PORKCHOP]: ITEM.COOKED_PORKCHOP, [ITEM.RAW_CHICKEN]: ITEM.COOKED_CHICKEN,
  [ITEM.RAW_MUTTON]: ITEM.COOKED_MUTTON, [ITEM.RAW_COD]: ITEM.COOKED_COD, [ITEM.RAW_SALMON]: ITEM.COOKED_SALMON,
};
export const MAX_AIR = 10;
// damage that armour does nothing against
const ARMOR_BYPASS = new Set(['fall', 'drown', 'void', 'pearl', 'starve', 'poison', 'wither', 'magic']);
// ...and that a shield can't stop
const UNBLOCKABLE = new Set(['fall', 'drown', 'void', 'pearl', 'starve', 'poison', 'wither', 'magic', 'fire', 'lava', 'cactus', 'magma']);

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
    this.dimension = opts.dimension || 0; // which creatures spawn: 0 overworld, 1 nether, 2 end
    this.fortressesNear = null; // (x, z) => [{ x, z }] in the nether: where blazes live
    this.spawnMobs = opts.spawnMobs !== false;
    this.pathBudget = 0;
    this.day = true;
    this.daylight = 1;
    this.pickup = null; // (playerId, itemId, count, wear) => number taken
    // multiplayer: players marked remote are simulated on their own machines (only their
    // positions are known here); creatures marked ghost belong to another player's simulation
    this.onGhostHit = null; // (ghost, damage, fromPos) => void
    this.onRemoteLoot = null; // (playerId, [[item, count]], pos) => void
    // multiplayer: every dropped item is shared. onDrop(item) announces one dropped here; a
    // player walking into a shared item asks for it with onTake(item) (the server decides who
    // gets it) instead of picking it up at once
    this.onDrop = null;
    this.onTake = null;
    this.pickupXp = null; // (playerId, points)
    this.spawners = new Map(); // "x,y,z" -> seconds until it next spawns
    this.dayCount = 0;
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
      food: 20, sat: 5, exhaust: 0, effects: {}, absorb: 0,
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
    const ticking = source === 'drown' || source === 'fire' || source === 'void' || source === 'poison' || source === 'wither' || source === 'starve';
    if (p.hurtTime > 0.4 && !ticking) return false;
    if (p.remote) {
      // their own game applies it
      p.hurtTime = 0.5;
      this.emit({ type: 'remoteHurt', id, amount, source, from });
      return true;
    }
    const fx = p.effects || {};
    if ((source === 'fire' || source === 'lava' || source === 'magma') && hasEffect(fx, 'fire_resistance')) return false;
    // a raised shield stops what comes at it from the front
    if (p.blocking && from && !UNBLOCKABLE.has(source)) {
      const dx = from[0] - p.pos[0], dz = from[2] - p.pos[2];
      const fwd = [-Math.sin(p.yaw || 0), -Math.cos(p.yaw || 0)];
      if (dx * fwd[0] + dz * fwd[1] > 0) {
        this.emit({ type: 'shieldBlock', id, amount, source, axe: source === 'vindicator' });
        p.hurtTime = 0.3;
        return false;
      }
    }
    if (p.armor && p.armor.points > 0 && !ARMOR_BYPASS.has(source)) {
      this.emit({ type: 'armorHit', id, amount }); // the armour wears down with the blow it takes
      amount = armorReduce(amount, p.armor.points, p.armor.toughness);
    }
    // enchanted armour: protection against everything, feather falling against falls
    const prot = (p.ench && p.ench.protection) || 0, ff = (p.ench && p.ench.feather_falling) || 0;
    const epf = Math.min(20, (ARMOR_BYPASS.has(source) && source !== 'fall' ? 0 : prot) + (source === 'fall' ? ff * 3 : 0));
    if (epf) amount *= 1 - epf * 0.04;
    if (hasEffect(fx, 'resistance')) amount *= Math.max(0, 1 - 0.2 * (fx.resistance.amp + 1));
    if (p.absorb > 0) { const a = Math.min(p.absorb, amount); p.absorb -= a; amount -= a; }
    p.exhaust = (p.exhaust || 0) + EXHAUST.hurt;
    p.health = Math.max(0, p.health - amount);
    p.hurtTime = 0.5;
    p.lastDamage = 0;
    this.emit({ type: 'playerHurt', id, amount, source, from });
    if (p.health <= 0 && p.totem) {
      // the totem of undying: back from the brink
      p.health = 1;
      p.effects = {};
      addEffect(p.effects, 'regeneration', 45, 1);
      addEffect(p.effects, 'absorption', 5, 1);
      addEffect(p.effects, 'fire_resistance', 40, 0);
      p.absorb = 4;
      this.emit({ type: 'totem', id, pos: p.pos.slice() });
      return true;
    }
    if (p.health <= 0) {
      p.dead = true;
      this.emit({ type: 'playerDeath', id, source });
    }
    return true;
  }

  // Status effects on a player (sent on to the player's own game when they are somewhere else).
  effectPlayer(id, key, secs, amp = 0) {
    const p = this.players.get(id);
    if (!p || p.dead || p.mode === 'creative') return;
    if (p.remote) { this.emit({ type: 'remoteEffect', id, key, secs, amp }); return; }
    if (key === 'instant_health') { this.healPlayer(id, 4 * (amp + 1)); return; }
    if (key === 'instant_damage') { this.damagePlayer(id, 6 * (amp + 1), 'magic'); return; }
    p.effects = p.effects || {};
    addEffect(p.effects, key, secs, amp);
    if (key === 'absorption') p.absorb = Math.max(p.absorb || 0, 4 * (amp + 1));
    this.emit({ type: 'effect', id, key });
  }

  potionOnPlayer(id, potion, k = 1, from = null) {
    const o = potionOutcome(potion, k);
    const p = this.players.get(id);
    if (!p) return;
    if (p.remote) { this.emit({ type: 'remotePotion', id, potion, k }); return; }
    if (o.heal) this.healPlayer(id, o.heal);
    if (o.damage) this.damagePlayer(id, o.damage, 'magic');
    for (const [key, secs, amp] of o.effects) this.effectPlayer(id, key, secs, amp);
    if (potion === 'water') p.fire = 0;
    void from;
  }

  potionOnMob(m, potion, k = 1) {
    if (m.ghost) return;
    const o = potionOutcome(potion, k);
    if (o.heal) effectMob(m, 'instant_health', 0, Math.round(o.heal / 6) - 1);
    if (o.damage) effectMob(m, 'instant_damage', 0, Math.round(o.damage / 6) - 1);
    for (const [key, secs, amp] of o.effects) effectMob(m, key, secs, amp);
    if (potion === 'water') m.burning = 0;
  }

  potionEffectMob(m, key, secs, amp) { if (!m.ghost) effectMob(m, key, secs, amp); }

  healPlayer(id, amount) {
    const p = this.players.get(id);
    if (!p || p.dead) return;
    p.health = Math.min(MAX_HEALTH, p.health + amount);
  }

  respawnPlayer(id, pos) {
    const p = this.players.get(id);
    if (!p) return;
    Object.assign(p, { dead: false, health: MAX_HEALTH, air: MAX_AIR, fire: 0, hurtTime: 0, pos: pos.slice(), food: 20, sat: 5, exhaust: 0, effects: {}, absorb: 0 });
  }

  tickPlayers() {
    const w = this.world;
    for (const p of this.players.values()) {
      if (p.hurtTime > 0) p.hurtTime -= TICK;
      if (p.remote) continue;
      p.lastDamage += TICK;
      if (p.dead || p.mode === 'creative') { p.air = MAX_AIR; p.fire = 0; continue; }
      // air under water
      if (p.headInWater) {
        p.air -= TICK;
        if (p.air <= 0) { p.air += 1; this.damagePlayer(p.id, 2, 'drown'); }
      } else p.air = Math.min(MAX_AIR, p.air + TICK * 4);
      // lava, fire, cactus, the void
      const fx = p.effects || (p.effects = {});
      const fireproof = hasEffect(fx, 'fire_resistance');
      if (p.inLava) { p.fire = fireproof ? 0 : 8; if (this.ticks % 10 === 0) this.damagePlayer(p.id, 4, 'lava'); }
      if (p.inFire) { p.fire = fireproof ? 0 : Math.max(p.fire, 3); if (this.ticks % 10 === 0) this.damagePlayer(p.id, 1, 'fire'); }
      if (p.onMagma && !p.sneaking && this.ticks % 20 === 0) this.damagePlayer(p.id, 1, 'magma');
      if (p.inWater) p.fire = 0;
      if (p.fire > 0) {
        p.fire -= TICK;
        if (this.ticks % 20 === 0) this.damagePlayer(p.id, 1, 'fire');
      }
      if (this.ticks % 10 === 0 && this.touchingCactus(p)) this.damagePlayer(p.id, 1, 'cactus');
      if (p.pos[1] < -10 && this.ticks % 10 === 0) this.damagePlayer(p.id, 4, 'void');
      // status effects
      for (const [k, e] of Object.entries(fx)) {
        e.t -= TICK;
        if (e.t <= 0) { delete fx[k]; if (k === 'absorption') p.absorb = 0; this.emit({ type: 'effectEnd', id: p.id, key: k }); continue; }
        const tick = Math.round(e.t * 20);
        if (k === 'poison' && p.health > 1 && tick % Math.max(5, 25 >> e.amp) === 0) this.damagePlayer(p.id, 1, 'poison');
        if (k === 'wither' && tick % Math.max(5, 40 >> e.amp) === 0) this.damagePlayer(p.id, 1, 'wither');
        if (k === 'regeneration' && tick % Math.max(5, 50 >> e.amp) === 0) this.healPlayer(p.id, 1);
        if (k === 'hunger') p.exhaust += 0.1 * (e.amp + 1) * TICK * 20 / 20;
      }
      // hunger: a full stomach heals, an empty one hurts
      const dh = tickHunger(p, TICK, { difficulty: this.difficulty, maxHealth: MAX_HEALTH });
      if (dh > 0) this.healPlayer(p.id, dh);
      else if (dh < 0) this.damagePlayer(p.id, 1, 'starve');
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

  // What a creature goes after: the nearest player it notices (invisible ones only up close), or
  // the nearest of the creatures it hunts (zombies and illagers go for villagers and golems).
  targetFor(mob, range) {
    let best = null, bd = range * range;
    const phantom = mob.type === 'phantom';
    for (const p of this.players.values()) {
      if (p.dead || p.mode === 'creative') continue;
      if (phantom && !p.insomnia) continue;
      const dx = p.pos[0] - mob.body.pos[0], dy = p.pos[1] - mob.body.pos[1], dz = p.pos[2] - mob.body.pos[2];
      const d = dx * dx + dy * dy * 2 + dz * dz;
      const lim = p.effects && hasEffect(p.effects, 'invisibility') ? Math.min(bd, 9) : bd;
      if (d < lim && d < bd) { bd = d; best = p; }
    }
    const hunts = HUNTS[mob.type];
    if (hunts && hunts.size) {
      for (const e of this.entities.values()) {
        if (e.kind !== 'mob' || !hunts.has(e.type) || e.deathTime > 0 || e.removed) continue;
        const dx = e.body.pos[0] - mob.body.pos[0], dy = e.body.pos[1] - mob.body.pos[1], dz = e.body.pos[2] - mob.body.pos[2];
        const d = dx * dx + dy * dy * 2 + dz * dz;
        if (d < bd) { bd = d; best = e; }
      }
    }
    return best;
  }

  nearestMob(pos, range, pred) {
    let best = null, bd = range * range;
    for (const e of this.entities.values()) {
      if (e.kind !== 'mob' || e.removed || e.deathTime > 0 || !pred(e)) continue;
      const d = (e.body.pos[0] - pos[0]) ** 2 + (e.body.pos[1] - pos[1]) ** 2 + (e.body.pos[2] - pos[2]) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  nearestPlayer(pos, range) {
    let best = null, bd = range * range;
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const d = (p.pos[0] - pos[0]) ** 2 + (p.pos[1] - pos[1]) ** 2 + (p.pos[2] - pos[2]) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // The player a tamed creature belongs to (by name, or 'local' in single player).
  ownerOf(m) {
    if (!m.tamed) return null;
    for (const p of this.players.values()) if ((p.name || p.id) === m.tamed && !p.dead) return p;
    return null;
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

  // Lit TNT: falls and blows up when its fuse runs out.
  primeTnt(x, y, z, fuse = 4) {
    const m = this.spawnMob('tnt', x + 0.5, y, z + 0.5);
    m.fuse = fuse;
    m.yaw = 0;
    m.body.vel = [(Math.random() - 0.5) * 1.2, 3, (Math.random() - 0.5) * 1.2];
    this.emit({ type: 'sound', name: 'fuse', pos: [x + 0.5, y + 0.5, z + 0.5] });
    return m;
  }

  // Experience orbs worth `points` in all.
  dropXp(x, y, z, points) {
    points = Math.round(points);
    while (points > 0) {
      const v = points >= 17 ? 17 : points >= 7 ? 7 : points >= 3 ? 3 : 1;
      points -= v;
      this.add(new XpOrb(this, this.nextId++, v, x, y, z));
    }
  }

  throwPotion(owner, pos, dir, potion, speed = 12) {
    const e = this.add(new SplashPotion(this, this.nextId++, owner, potion, pos[0], pos[1], pos[2], dir[0] * speed, dir[1] * speed + 2, dir[2] * speed));
    this.emit({ type: 'sound', name: 'throw', pos });
    return e;
  }

  mobThrowPotion(mob, target, potion) {
    const e = mob.eyePos;
    const tp = target.pos;
    const dx = tp[0] - e[0], dz = tp[2] - e[2];
    const flat = Math.hypot(dx, dz);
    const dy = tp[1] + 0.8 - e[1] + flat * 0.2;
    const l = Math.hypot(dx, dy, dz) || 1;
    this.throwPotion(mob.id, [e[0], e[1] + 0.2, e[2]], [dx / l, dy / l, dz / l], potion, 9 + flat * 0.35);
  }

  witherSkull(mob, target, blue) {
    const e = mob.eyePos;
    const tp = target.pos;
    const dx = tp[0] - e[0], dy = tp[1] + 1 - e[1], dz = tp[2] - e[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    const dir = [dx / l, dy / l, dz / l];
    this.add(new WitherSkull(this, this.nextId++, mob.id, e[0] + dir[0], e[1] + dir[1], e[2] + dir[2], dir, blue));
    this.emit({ type: 'sound', name: 'witherShoot', pos: e.slice() });
  }

  shulkerBullet(mob, target) {
    const p = mob.body.pos;
    this.add(new ShulkerBullet(this, this.nextId++, mob.id, p[0], p[1] + 1.2, p[2], target));
    this.emit({ type: 'sound', name: 'shulkerShoot', pos: p.slice() });
  }

  launchFirework(owner, pos, vel, opts) {
    const f = this.add(new Firework(this, this.nextId++, owner, pos[0], pos[1], pos[2], vel, opts));
    this.emit({ type: 'sound', name: 'fireworkLaunch', pos: pos.slice() });
    return f;
  }

  castBobber(owner, pos, vel, opts) {
    return this.add(new Bobber(this, this.nextId++, owner, pos[0], pos[1], pos[2], vel, opts));
  }

  // Evoker fangs, snapping up out of the ground near (x, y, z) after `delay` seconds.
  spawnFangs(owner, x, y, z, delay) {
    const bx = Math.floor(x), bz = Math.floor(z);
    let by = Math.floor(y + 1);
    for (let k = 0; k < 6 && !this.standable(bx, by, bz, 1); k++) by = k % 2 ? by + k : by - k;
    if (!this.standable(bx, by, bz, 1)) return;
    const m = this.spawnMob('evoker_fangs', bx + 0.5, by, bz + 0.5);
    m.owner = owner.id;
    m.delay = delay;
    m.yaw = owner.yaw;
  }

  // The wither breaking out of wherever it is boxed in.
  breakAround(m) {
    const w = this.world, p = m.body.pos;
    for (let dy = 0; dy <= 4; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = Math.floor(p[0]) + dx, y = Math.floor(p[1]) + dy, z = Math.floor(p[2]) + dz;
      const b = w.getBlock(x, y, z);
      if (b && b !== BLOCK.BEDROCK && b !== BLOCK.END_PORTAL_FRAME && b !== BLOCK.END_PORTAL && b !== BLOCK.END_GATEWAY && !IS_LIQUID[b]) w.setBlock(x, y, z, 0);
    }
    this.emit({ type: 'sound', name: 'explosion', pos: p.slice() });
  }

  // A creature's melee blow (or bite) on a player or another creature.
  attackTarget(mob, t, damage, { launch = 0, magic = false, effect = null } = {}) {
    const d = mob.def;
    const fx = mob.effects;
    if (fx && fx.strength) damage += 3 * (fx.strength.amp + 1);
    if (fx && fx.weakness) damage = Math.max(0, damage - 4);
    if (t.kind === 'mob') {
      if (t.ghost) { t.hurt(damage, mob.body.pos); return; }
      if (t.hurt(damage, mob.body.pos, 1)) {
        if (launch) t.body.vel[1] += launch;
        this.emit({ type: 'hurt', entity: t, pos: t.body.pos.slice() });
        if (d.withers) effectMob(t, 'wither', 10, 0);
        if (d.poisons) effectMob(t, 'poison', d.poisons, 0);
        // the victim (or its owner's pets and the village's golems) fight back
        if (t.def.neutral || t.type === 'iron_golem' || t.tamed) t.angryAt = mob;
      }
    } else {
      const src = magic ? 'magic' : mob.type;
      if (this.damagePlayer(t.id, damage * this.diff.damage, src, mob.body.pos)) {
        this.emit({ type: 'knock', id: t.id, from: mob.body.pos, strength: launch ? 2 : 1 });
        if (launch) this.emit({ type: 'launch', id: t.id, v: launch });
        if (d.withers) this.effectPlayer(t.id, 'wither', 10, 0);
        if (d.poisons && this.difficulty !== 'easy') this.effectPlayer(t.id, 'poison', d.poisons, 0);
        if (effect) this.effectPlayer(t.id, effect[0], effect[1], effect[2]);
        // tamed wolves defend whoever they belong to
        for (const e of this.entities.values()) if (e.type === 'wolf' && e.tamed && (t.name || t.id) === e.tamed && !e.sitting) e.target = mob;
      }
    }
    this.emit({ type: 'sound', name: mob.type + 'Attack', pos: mob.body.pos });
  }

  // delay: seconds before anyone can pick it up (thrown items fly clear of their thrower first);
  // remote: an item another player dropped (it is already shared)
  dropItem(itemId, count, x, y, z, vel = null, wear = 0, { delay = 0.5, remote = false, netId = null, ench = null } = {}) {
    if (!itemId || count <= 0) return null;
    const d = this.add(new ItemDrop(this, this.nextId++, itemId, count, x, y, z, wear));
    if (ench && Object.keys(ench).length) d.ench = ench;
    if (vel) d.body.vel = vel.slice();
    d.pickupDelay = delay;
    if (netId) d.netId = netId;
    if (!remote && this.onDrop) this.onDrop(d);
    return d;
  }

  shootArrow(owner, pos, dir, speed, damage, pickup = false) {
    const a = this.add(new Arrow(this, this.nextId++, owner, pos[0], pos[1], pos[2], dir[0] * speed, dir[1] * speed, dir[2] * speed, damage));
    a.pickup = pickup;
    this.emit({ type: 'sound', name: 'bow', pos });
    return a;
  }

  throwPearl(owner, pos, dir) {
    const v = 24;
    const e = this.add(new Thrown(this, this.nextId++, owner, ITEM.ENDER_PEARL, pos[0], pos[1], pos[2], dir[0] * v, dir[1] * v + 2, dir[2] * v));
    this.emit({ type: 'sound', name: 'throw', pos });
    return e;
  }

  throwEye(owner, pos, target) {
    const e = this.add(new EyeOfEnder(this, this.nextId++, owner, pos[0], pos[1], pos[2], target));
    this.emit({ type: 'sound', name: 'throw', pos });
    return e;
  }

  mobFireball(mob, target, small) {
    if (!target) return;
    const e = mob.eyePos;
    const dx = target.pos[0] - e[0], dy = target.pos[1] + 1.2 - e[1], dz = target.pos[2] - e[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    const spread = small ? 0.08 : 0.02;
    const dir = [dx / l + (Math.random() - 0.5) * spread, dy / l + (Math.random() - 0.5) * spread, dz / l + (Math.random() - 0.5) * spread];
    const k = mob.def.hw + 0.6;
    this.add(new Fireball(this, this.nextId++, mob.id, e[0] + dir[0] * k, e[1] + dir[1] * k, e[2] + dir[2] * k, dir, small));
    this.emit({ type: 'sound', name: small ? 'blazeShoot' : 'ghastShoot', pos: e.slice() });
  }

  // First creature a small projectile touches on its way to `next` (not its owner).
  projectileHitsMob(proj, next) {
    const a = proj.body.pos;
    const d = [next[0] - a[0], next[1] - a[1], next[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]) || 1e-6;
    const dir = [d[0] / len, d[1] / len, d[2] / len];
    for (const e of this.entities.values()) {
      if (e.kind !== 'mob' || e.id === proj.owner || e.deathTime > 0) continue;
      const b = e.body;
      const box = [b.pos[0] - b.hw, b.pos[1], b.pos[2] - b.hw, b.pos[0] + b.hw, b.pos[1] + b.h, b.pos[2] + b.hw];
      if (rayHitsBox(a, dir, box, len) !== null) return e;
    }
    return null;
  }

  projectileHitsPlayer(proj, next) {
    const a = proj.body.pos;
    const d = [next[0] - a[0], next[1] - a[1], next[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]) || 1e-6;
    const dir = [d[0] / len, d[1] / len, d[2] / len];
    for (const p of this.players.values()) {
      if (p.dead || p.id === proj.owner) continue;
      const box = [p.pos[0] - p.hw, p.pos[1], p.pos[2] - p.hw, p.pos[0] + p.hw, p.pos[1] + p.h, p.pos[2] + p.hw];
      if (rayHitsBox(a, dir, box, len) !== null) return p;
    }
    return null;
  }

  spawnDragon(x, y, z, health = 0) {
    return this.add(new EnderDragon(this, this.nextId++, x, y, z, health));
  }

  spawnCrystal(x, y, z, index) {
    const c = this.spawnMob('end_crystal', x, y, z);
    c.variant = index;
    c.yaw = 0;
    return c;
  }

  mobAttack(mob, target) {
    this.attackTarget(mob, target, mob.def.damage || 2);
  }

  mobShoot(mob, target, power = 1) {
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
    this.shootArrow(mob.id, [e[0] + dir[0] * 0.6, e[1], e[2] + dir[2] * 0.6], dir, speed * (power > 1 ? 1.25 : 1), (3 + Math.random() * 2) * power);
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
        // the wither's armour turns arrows aside once it is below half health
        if (e.type === 'wither' && e.health < e.def.health / 2) { arrow.body.vel = [-arrow.body.vel[0] * 0.2, 2, -arrow.body.vel[2] * 0.2]; return false; }
        if (e.def.vehicle && typeof arrow.owner === 'number') return false;
        const dmg = arrow.damage;
        if (typeof arrow.owner === 'string') e.lastAttacker = arrow.owner;
        e.hurt(dmg, a, 0.5 + (arrow.punch || 0) * 0.6);
        if (arrow.flame) e.burning = Math.max(e.burning, 5);
        this.emit({ type: 'hurt', entity: e, pos: b.pos.slice() });
        this.anger(e, this.players.get(arrow.owner));
        return true;
      }
    }
    for (const p of this.players.values()) {
      if (p.dead || p.id === arrow.owner) continue;
      if (p.remote && typeof arrow.owner === 'string') continue; // no friendly fire between players
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
    if (!entity.hurt(damage * (crit ? 1.5 : 1), from, 1 + (p.knockback || 0) * 0.8)) return false;
    entity.lastAttacker = playerId;
    if (p.fireAspect) entity.burning = Math.max(entity.burning || 0, 4 * p.fireAspect);
    p.exhaust = (p.exhaust || 0) + EXHAUST.attack;
    this.emit({ type: 'hurt', entity, pos: entity.body.pos.slice(), crit });
    // hostile creatures turn on whoever hurt them; neutral ones too, with their friends nearby
    if (entity.hostile) entity.target = p;
    this.anger(entity, p);
    // the village stands up for its own; pets join in on their owner's fights
    if (entity.type === 'villager' || entity.type === 'iron_golem') {
      for (const e of this.entities.values()) {
        if (e.type === 'iron_golem' && !e.ghost && (e.body.pos[0] - p.pos[0]) ** 2 + (e.body.pos[2] - p.pos[2]) ** 2 < 32 * 32) e.angryAt = p;
      }
    }
    for (const e of this.entities.values()) {
      if (e.type === 'wolf' && e.tamed === (p.name || p.id) && !e.sitting && e !== entity && !(entity.tamed === e.tamed)) e.target = entity;
    }
    return true;
  }

  anger(entity, p) {
    if (!entity.def || !p) return;
    if (entity.type === 'iron_golem') { entity.angryAt = p; return; }
    if (!entity.def.neutral || entity.tamed) return;
    entity.angryAt = p;
    for (const e of this.entities.values()) {
      if (e.type === entity.type && e !== entity && !e.ghost && e.kind === 'mob') {
        const b = e.body.pos, q = entity.body.pos;
        if ((b[0] - q[0]) ** 2 + (b[2] - q[2]) ** 2 < 20 * 20) e.angryAt = p;
      }
    }
  }

  // Another player's hit on one of our creatures.
  remoteHit(playerId, mobId, damage, from) {
    const e = this.entities.get(mobId);
    if (!e || e.kind !== 'mob' || e.ghost || e.removed) return false;
    const pos = Array.isArray(from) ? from : null;
    if (!e.hurt(Math.max(0, Math.min(40, Number(damage) || 0)), pos, 1)) return false;
    e.lastAttacker = playerId;
    this.emit({ type: 'hurt', entity: e, pos: e.body.pos.slice() });
    const p = this.players.get(playerId);
    if (e.hostile && p) e.target = p;
    this.anger(e, p);
    return true;
  }

  onMobDeath(mob) {
    const p = mob.body.pos;
    this.emit({ type: 'death', entity: mob, pos: p.slice() });
    if (mob.type === 'end_crystal') {
      mob.removed = true;
      this.emit({ type: 'crystalDeath', index: mob.variant, pos: p.slice() });
      this.explode(p[0], p[1] + 1, p[2], 3, mob);
      return;
    }
    if (mob.def.boss) this.emit({ type: 'bossDeath', entity: mob, pos: p.slice(), killer: mob.lastAttacker });
    if (mob.tamed) this.emit({ type: 'petDied', entity: mob, owner: mob.tamed });
    // big slimes split into smaller ones
    if (mob.type === 'slime' && (mob.size || 1) > 1) {
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const s = this.spawnMob('slime', p[0] + (Math.random() - 0.5) * mob.size * 0.5, p[1] + 0.2, p[2] + (Math.random() - 0.5) * mob.size * 0.5);
        s.setSize(mob.size / 2);
      }
    }
    const killer = this.players.get(mob.lastAttacker);
    // experience for a player's kill (babies and vehicles give none)
    if (killer && !mob.def.vehicle && !mob.baby && !mob.ghost) {
      const xp = mob.def.xp ?? (mob.def.hostile ? 5 : 1 + Math.floor(Math.random() * 3));
      if (!killer.remote) this.dropXp(p[0], p[1] + 0.5, p[2], mob.type === 'slime' ? mob.size || 1 : xp);
    }
    const loot = [];
    if (mob.type === 'slime' && (mob.size || 1) > 1) { /* only the smallest drop slime balls */ }
    else if (!mob.baby) {
      const looting = killer ? killer.looting || 0 : 0;
      for (const [item, lo, hi] of mob.def.drops || []) {
        let n = lo + Math.floor(Math.random() * (hi - lo + 1 + looting));
        if (hi < 1) n = Math.random() < hi + looting * 0.01 ? 1 : 0; // rare drops
        const id = item === 'wool' ? (mob.sheared ? 0 : mob.variant || BLOCK.WHITE_WOOL) : item;
        if (n > 0 && id) loot.push([id, n]);
      }
      // cooked if it burned
      if (mob.burning > 0) for (const l of loot) { const c = COOKED[l[0]]; if (c) l[0] = c; }
    }
    // the loot goes to whoever made the kill, on their machine (unless items are shared anyway)
    if (killer && killer.remote && this.onRemoteLoot && !this.onDrop) { if (loot.length) this.onRemoteLoot(killer.id, loot, [p[0], p[1], p[2]]); return; }
    for (const [id, n] of loot) this.dropItem(id, n, p[0], p[1] + 0.5, p[2]);
  }

  // Blast: breaks blocks in a rough sphere, hurts and throws back everything nearby. TNT caught
  // in it lights up.
  explode(x, y, z, power, source = null, { noBlocks = false } = {}) {
    const w = this.world;
    const r = power * 1.15;
    const ir = Math.ceil(r);
    const broken = [];
    for (let dy = -ir; dy <= ir && !noBlocks; dy++) {
      for (let dz = -ir; dz <= ir; dz++) {
        for (let dx = -ir; dx <= ir; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d > r * (0.7 + Math.random() * 0.3)) continue;
          const bx = Math.floor(x + dx), by = Math.floor(y + dy), bz = Math.floor(z + dz);
          const b = w.getBlock(bx, by, bz);
          if (!b || b === BLOCK.BEDROCK || b === BLOCK.OBSIDIAN || b === BLOCK.END_GATEWAY || b === BLOCK.END_PORTAL_FRAME || IS_LIQUID[b]) continue;
          broken.push([bx, by, bz, b]);
        }
      }
    }
    for (const [bx, by, bz, b] of broken) {
      if (b === BLOCK.TNT) { if (w.setBlock(bx, by, bz, 0)) this.primeTnt(bx, by, bz, 0.5 + Math.random()); continue; }
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
      if (e === source || e.removed || e.ghost || e.kind === 'xp') continue;
      if (source && source.type === 'wither' && e.def && e.def.undead) continue;
      const b = e.body;
      const k = impactAt(b.pos[0], b.pos[1] + b.h * 0.5, b.pos[2]);
      if (k <= 0) continue;
      if (e.kind === 'mob') { e.hurtTime = 0; e.hurt(Math.round(24 * Math.pow(k, 1.4)), [x, y, z], k * 2); }
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
    if (y < 2 || y > WORLD_HEIGHT - 3) return false;
    if (IS_SOLID[w.getBlock(x, y, z)] || IS_LIQUID[w.getBlock(x, y, z)]) return false;
    if (h > 1 && (IS_SOLID[w.getBlock(x, y + 1, z)] || IS_LIQUID[w.getBlock(x, y + 1, z)])) return false;
    if (h > 2 && (IS_SOLID[w.getBlock(x, y + 2, z)] || IS_LIQUID[w.getBlock(x, y + 2, z)])) return false;
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

  // A standable spot at a random height near (x, z) between y0 and y1 (caverns, islands).
  findFloor(x, z, y0, y1, h) {
    let y = Math.floor(y0 + Math.random() * (y1 - y0));
    for (let k = 0; k < 24; k++, y--) if (this.standable(x, y, z, h)) return y;
    return null;
  }

  pickWeighted(weights) {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (const [k, v] of Object.entries(weights)) { r -= v; if (r <= 0) return k; }
    return Object.keys(weights)[0];
  }

  // The nether: zombified piglins everywhere, ghasts in big caverns, blazes by the fortresses.
  // The end: endermen on the islands.
  trySpawnOther(p) {
    const w = this.world;
    const cap = this.dimension === 1 ? Math.max(6, this.diff.hostileCap) : 10;
    const others = (e) => e.hostile || e.def.neutral;
    if (this.countNear(others, p.pos, 72) >= cap) return;
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 36;
      const x = Math.floor(p.pos[0] + Math.cos(a) * r), z = Math.floor(p.pos[2] + Math.sin(a) * r);
      if (!w.isChunkReady(x, z) || !this.farFromPlayers(x, z, 18)) continue;
      let type;
      if (this.dimension === 2) type = 'enderman';
      else {
        const forts = this.fortressesNear ? this.fortressesNear(x, z) : [];
        const weights = { zombified_piglin: 6, ghast: this.diff.hostileCap ? 1.2 : 0, blaze: forts.length && this.diff.hostileCap ? 5 : 0, wither_skeleton: forts.length && this.diff.hostileCap ? 4 : 0 };
        type = this.pickWeighted(weights);
      }
      const def = MOBS[type];
      if (type === 'ghast') {
        // open air, several blocks from any rock
        const y = Math.floor(40 + Math.random() * 60);
        let open = true;
        for (let dy = -2; dy <= 5 && open; dy += 2) for (let dx = -3; dx <= 3 && open; dx += 3) for (let dz = -3; dz <= 3 && open; dz += 3) {
          if (w.getBlock(x + dx, y + dy, z + dz) !== 0) open = false;
        }
        if (open) { this.spawnMob(type, x + 0.5, y, z + 0.5); return; }
        continue;
      }
      const y = this.dimension === 2 ? this.findFloor(x, z, 40, 70, 3) : this.findFloor(x, z, Math.max(20, p.pos[1] - 20), Math.min(122, p.pos[1] + 24), def.h > 2 ? 3 : 2); // (the Nether and End are 128 high)
      if (y === null) continue;
      const n = type === 'zombified_piglin' ? 1 + Math.floor(Math.random() * 3) : 1;
      for (let k = 0; k < n; k++) this.spawnMob(type, x + 0.5 + k * 0.7, y, z + 0.5);
      return;
    }
  }

  trySpawn() {
    for (const p of this.players.values()) {
      if (p.dead || p.remote) continue; // remote players spawn their own
      if (this.dimension !== 0) { if (this.spawnMobs) this.trySpawnOther(p); continue; }
      spawnRules(this, p);
    }
  }

  despawn(e) {
    if (e.def && (e.def.boss || e.def.fixed || e.def.persistent || e.def.vehicle)) return false; // the dragon and its crystals stay
    if (e.persistent || e.tamed || e.rider) return false; // villagers, pets, what has been bred or ridden
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
    if (this.ticks % 20 === 0) { this.trySpawn(); tickSpawners(this); tickBreeding(this); }
    const w = this.world;
    const mobs = [];
    for (const e of this.entities.values()) {
      if (e.removed) { this.entities.delete(e.id); continue; }
      const p = e.body.pos;
      // frozen until its chunk loads (but the dragon never touches the ground, and flies on)
      if (!w.isChunkReady(p[0], p[2]) && !(e.def && e.def.boss)) continue;
      if (e.kind === 'mob' && !e.ghost && this.ticks % 40 === e.id % 40 && this.despawn(e)) { this.entities.delete(e.id); continue; }
      e.update(this);
      if (e.kind === 'mob' && !e.ghost) mobs.push(e);
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

  // Items slide to a player who walks right up to them, and are picked up on touch. Only players
  // simulated here pick things up: the others do that in their own game.
  tickItem(it) {
    if (it.pending) {
      // asked the server for it: hidden until the answer comes (or asked again after a while)
      if (performance.now() - it.pending > 4000) it.pending = 0;
      return;
    }
    if (it.pickupDelay > 0) return;
    for (const p of this.players.values()) {
      if (p.dead || p.remote || !this.pickup) continue;
      const dx = p.pos[0] - it.body.pos[0], dy = p.pos[1] + 0.9 - it.body.pos[1], dz = p.pos[2] - it.body.pos[2];
      const d = Math.hypot(dx, dy, dz);
      if (d < 2.2 && d > 0.05) {
        const k = 1 - d / 2.2;
        it.body.vel[0] += (dx / d) * 1.4 * k; it.body.vel[1] += (dy / d) * 0.9 * k; it.body.vel[2] += (dz / d) * 1.4 * k;
      }
      if (d >= 1.25) continue;
      if (it.netId && this.onTake) {
        it.pending = performance.now();
        this.onTake(it, p.id);
        return;
      }
      const taken = this.pickup(p.id, it.item, it.count, it.wear, it.ench);
      if (taken > 0) {
        it.count -= taken;
        this.emit({ type: 'pickup', id: p.id, item: it.item, count: taken, pos: it.body.pos.slice() });
        if (it.count <= 0) { it.removed = true; return; }
      }
    }
  }

  tickArrowPickup(a) {
    for (const p of this.players.values()) {
      if (p.dead || p.remote || !this.pickup) continue;
      const d = Math.hypot(p.pos[0] - a.body.pos[0], p.pos[1] + 0.9 - a.body.pos[1], p.pos[2] - a.body.pos[2]);
      if (d < 1.4 && this.pickup(p.id, ITEM.ARROW, 1, 0) > 0) {
        a.removed = true;
        this.emit({ type: 'pickup', id: p.id, item: ITEM.ARROW, count: 1, pos: a.body.pos.slice() });
        return;
      }
    }
  }

  mergeItems() {
    // shared items keep their own identity (each one is someone's to pick up)
    const items = [...this.entities.values()].filter((e) => e.kind === 'item' && !e.removed && !e.netId && !e.pending);
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      if (a.removed) continue;
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (b.removed || b.item !== a.item || a.wear || b.wear || a.ench || b.ench) continue;
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
