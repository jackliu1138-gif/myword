// Creatures, dropped items and arrows. Each creature has a physics body and a small brain;
// the Simulation calls think() and step() at 20 ticks per second.

import { Body } from './physics.js';
import { findPath } from './path.js';
import { ITEM } from './items.js';
import { BLOCK, IS_OPAQUE, IS_SOLID } from '../world/blocks.js';
import { BRAINS, TICKERS, tickMobEffects, alive } from './creatures.js';
import { FISH_COUNT, CAT_COUNT, HORSE_COUNT, JOB_LIST } from './looks.js';

export const TICK = 1 / 20;

// drops: [item, min, max]
export const MOBS = {
  zombie: {
    hostile: true, hw: 0.3, h: 1.9, eye: 1.7, health: 20, speed: 2.1, chase: 2.7, damage: 3, reach: 1.25,
    follow: 32, burns: true, drops: [[ITEM.ROTTEN_FLESH, 0, 2], [ITEM.IRON_INGOT, 0, 0.1]], xp: 5,
  },
  creeper: {
    hostile: true, hw: 0.3, h: 1.7, eye: 1.5, health: 20, speed: 2.0, chase: 2.5, fuse: 1.5, blast: 3,
    follow: 18, drops: [[ITEM.GUNPOWDER, 0, 2]], xp: 5,
  },
  skeleton: {
    hostile: true, hw: 0.3, h: 1.95, eye: 1.75, health: 20, speed: 2.1, chase: 2.4, ranged: true, burns: true,
    follow: 18, drops: [[ITEM.BONE, 0, 2], [ITEM.ARROW, 0, 2]], xp: 5,
  },
  spider: {
    hostile: true, nightOnly: true, hw: 0.65, h: 0.9, eye: 0.6, health: 16, speed: 2.8, chase: 3.4, damage: 2, reach: 1.4,
    follow: 18, climbs: true, drops: [[ITEM.STRING, 0, 2]], xp: 5,
  },
  cow: { hw: 0.45, h: 1.4, eye: 1.3, health: 10, speed: 1.3, drops: [[ITEM.RAW_BEEF, 1, 3], [ITEM.LEATHER, 0, 2]] },
  pig: { hw: 0.45, h: 0.9, eye: 0.8, health: 10, speed: 1.3, drops: [[ITEM.RAW_PORKCHOP, 1, 3]] },
  sheep: { hw: 0.45, h: 1.3, eye: 1.2, health: 8, speed: 1.3, drops: [[ITEM.RAW_MUTTON, 1, 2], ['wool', 1, 1]] },
  chicken: { hw: 0.2, h: 0.7, eye: 0.6, health: 4, speed: 1.2, flutter: true, drops: [[ITEM.RAW_CHICKEN, 1, 1], [ITEM.FEATHER, 0, 2]] },
  // the Nether and the End (appended: snapshots send the type's index)
  zombified_piglin: {
    neutral: true, hw: 0.3, h: 1.9, eye: 1.7, health: 20, speed: 1.6, chase: 3.0, damage: 5, reach: 1.25, follow: 32,
    held: ITEM.GOLDEN_SWORD, fireproof: true, drops: [[ITEM.ROTTEN_FLESH, 0, 1], [ITEM.GOLD_NUGGET, 0, 1], [ITEM.GOLD_INGOT, 0, 0.05]], xp: 5,
  },
  blaze: {
    hostile: true, hw: 0.3, h: 1.8, eye: 1.5, health: 20, speed: 1.3, chase: 1.8, flies: 'hover', follow: 32, fireproof: true,
    drops: [[ITEM.BLAZE_ROD, 0, 1]], xp: 10,
  },
  ghast: {
    hostile: true, hw: 2, h: 4, eye: 2.6, health: 10, speed: 1.4, flies: 'float', follow: 64, fireproof: true,
    drops: [[ITEM.GUNPOWDER, 0, 2]], xp: 5,
  },
  enderman: {
    neutral: true, hw: 0.3, h: 2.9, eye: 2.55, health: 40, speed: 1.8, chase: 4.4, damage: 7, reach: 1.4, follow: 48,
    teleports: true, drops: [[ITEM.ENDER_PEARL, 0, 1]], xp: 5,
  },
  ender_dragon: { hostile: true, boss: true, hw: 3, h: 3, eye: 1.5, health: 200, damage: 10, follow: 220, fireproof: true, drops: [], xp: 500 },
  end_crystal: { hw: 1, h: 2, eye: 1, health: 1, fixed: true, fireproof: true, drops: [] },
  // ---- appended with villages, pets, the sea, the illagers, the wither and what is ridden
  villager: { hw: 0.3, h: 1.95, eye: 1.62, health: 20, speed: 1.5, persistent: true, drops: [] },
  iron_golem: { hw: 0.7, h: 2.7, eye: 2.4, health: 100, speed: 1.4, chase: 2.2, damage: 11, reach: 1.5, follow: 18, persistent: true, heavy: true, drops: [[ITEM.IRON_INGOT, 3, 5], [BLOCK.POPPY, 0, 2]] },
  wolf: { neutral: true, animal: true, hw: 0.3, h: 0.85, eye: 0.7, health: 8, speed: 1.9, chase: 4.4, damage: 3, reach: 1.1, follow: 24, tameWith: 'bone', drops: [], xp: 1 },
  cat: { animal: true, hw: 0.3, h: 0.7, eye: 0.55, health: 10, speed: 1.7, chase: 4, tameWith: 'fish', drops: [[ITEM.STRING, 0, 2]], xp: 1 },
  cod: { water: true, school: true, hw: 0.25, h: 0.3, eye: 0.15, health: 3, speed: 2.2, drops: [[ITEM.RAW_COD, 1, 1], [ITEM.BONE_MEAL, 0, 0.05]], xp: 1 },
  salmon: { water: true, school: true, hw: 0.35, h: 0.4, eye: 0.2, health: 3, speed: 2.6, drops: [[ITEM.RAW_SALMON, 1, 1]], xp: 1 },
  tropical_fish: { water: true, school: true, hw: 0.25, h: 0.4, eye: 0.2, health: 3, speed: 2.2, drops: [[ITEM.TROPICAL_FISH, 1, 1]], xp: 1 },
  pufferfish: { water: true, hw: 0.35, h: 0.35, eye: 0.2, health: 3, speed: 1.6, drops: [[ITEM.PUFFERFISH, 1, 1]], xp: 1 },
  squid: { water: true, hw: 0.4, h: 0.8, eye: 0.4, health: 10, speed: 1.4, drops: [[ITEM.INK_SAC, 1, 3]], xp: 2 },
  witch: {
    hostile: true, hw: 0.3, h: 1.95, eye: 1.62, health: 26, speed: 1.7, chase: 2.1, follow: 16,
    drops: [[ITEM.GLASS_BOTTLE, 0, 2], [ITEM.GLOWSTONE_DUST, 0, 2], [ITEM.GUNPOWDER, 0, 2], [ITEM.SPIDER_EYE, 0, 2], [ITEM.SUGAR, 0, 2], [ITEM.STICK, 0, 2]], xp: 5,
  },
  slime: { hostile: true, hw: 0.26, h: 0.52, eye: 0.3, health: 1, speed: 2.2, damage: 0, follow: 16, drops: [[ITEM.SLIME_BALL, 0, 2]], xp: 1 },
  phantom: { hostile: true, undead: true, hw: 0.45, h: 0.5, eye: 0.25, health: 20, speed: 6, flies: 'swoop', damage: 3, burns: true, follow: 64, drops: [[ITEM.PHANTOM_MEMBRANE, 0, 1]], xp: 5 },
  pillager: { hostile: true, illager: true, hw: 0.3, h: 1.95, eye: 1.62, health: 24, speed: 1.9, chase: 2.3, ranged: 'crossbow', follow: 24, held: ITEM.CROSSBOW, drops: [[ITEM.ARROW, 0, 2], [ITEM.CROSSBOW, 0, 0.08]], xp: 5 },
  vindicator: { hostile: true, illager: true, hw: 0.3, h: 1.95, eye: 1.62, health: 24, speed: 1.9, chase: 3.1, damage: 8, reach: 1.3, follow: 20, held: ITEM.IRON_AXE, axe: true, drops: [[ITEM.EMERALD, 0, 1]], xp: 5 },
  evoker: { hostile: true, illager: true, hw: 0.3, h: 1.95, eye: 1.62, health: 24, speed: 1.7, chase: 2.3, follow: 20, drops: [[ITEM.TOTEM_OF_UNDYING, 1, 1], [ITEM.EMERALD, 0, 1]], xp: 10 },
  wither: { hostile: true, boss: true, undead: true, hw: 0.9, h: 3.5, eye: 3.0, health: 300, speed: 3, flies: 'wither', fireproof: true, follow: 64, drops: [[ITEM.NETHER_STAR, 1, 1]], xp: 50 },
  wither_skeleton: {
    hostile: true, undead: true, hw: 0.35, h: 2.4, eye: 2.1, health: 20, speed: 2.2, chase: 2.9, damage: 8, reach: 1.4, fireproof: true, follow: 20,
    held: ITEM.STONE_SWORD, withers: true, drops: [[ITEM.COAL, 0, 1], [ITEM.BONE, 0, 2], [BLOCK.WITHER_SKELETON_SKULL, 0, 0.12]], xp: 5,
  },
  guardian: { hostile: true, water: true, hw: 0.45, h: 0.85, eye: 0.45, health: 30, speed: 2.4, laser: 6, follow: 16, drops: [[ITEM.PRISMARINE_SHARD, 0, 2], [ITEM.RAW_COD, 0, 1], [ITEM.PRISMARINE_CRYSTALS, 0, 0.4]], xp: 10 },
  elder_guardian: { hostile: true, water: true, elder: true, persistent: true, hw: 1.0, h: 2.0, eye: 1.0, health: 80, speed: 1.2, laser: 8, follow: 16, drops: [[ITEM.PRISMARINE_SHARD, 0, 2], [ITEM.PRISMARINE_CRYSTALS, 1, 2], [ITEM.RAW_COD, 0, 1], [BLOCK.PRISMARINE_BRICKS, 1, 1]], xp: 10 },
  shulker: { hostile: true, still: true, persistent: true, hw: 0.5, h: 1.0, eye: 0.5, health: 30, follow: 16, drops: [[ITEM.SHULKER_SHELL, 0, 0.5]], xp: 5 },
  cave_spider: { hostile: true, hw: 0.35, h: 0.5, eye: 0.4, health: 12, speed: 3.0, chase: 3.6, damage: 2, reach: 1.2, follow: 16, climbs: true, poisons: 7, drops: [[ITEM.STRING, 0, 2], [ITEM.SPIDER_EYE, 0, 1]], xp: 5 },
  horse: { animal: true, hw: 0.7, h: 1.6, eye: 1.5, health: 22, speed: 1.6, ride: true, step: 1.05, drops: [[ITEM.LEATHER, 0, 2]], xp: 1 },
  boat: { vehicle: 'boat', hw: 0.7, h: 0.56, eye: 0.3, health: 3, seat: 0.25, drops: [[ITEM.OAK_BOAT, 1, 1]] },
  minecart: { vehicle: 'minecart', hw: 0.49, h: 0.7, eye: 0.35, health: 4, seat: 0.35, drops: [[ITEM.MINECART, 1, 1]] },
  // (parked: flown, it is part of its pilot; see game/saucer.js)
  // (it stays exactly where it stands: sim/saucerform.js has its shape, for the crosshair)
  saucer: { vehicle: 'saucer', persistent: true, fixed: true, hw: 1.5, h: 1.6, eye: 1.2, health: 40, seat: 1.8, drops: [[ITEM.FLYING_SAUCER, 1, 1]] },
  tnt: { fixed: true, invulnerable: true, hw: 0.49, h: 0.98, eye: 0.5, health: 1, drops: [] },
  evoker_fangs: { fixed: true, invulnerable: true, hw: 0.25, h: 0.8, eye: 0.4, health: 1, drops: [] },
  // an F-22 parked on its wheels (flown, it is part of its pilot; see game/jet.js; its shape, for
  // the crosshair: sim/jetform.js)
  jet: { vehicle: 'jet', persistent: true, fixed: true, hw: 3, h: 3.4, eye: 2, health: 60, seat: 1.9, drops: [[ITEM.F22_RAPTOR, 1, 1]] },
};
// what each kind goes after besides players
export const HUNTS = {
  zombie: new Set(['villager', 'iron_golem']), pillager: new Set(['villager', 'iron_golem']), vindicator: new Set(['villager', 'iron_golem']),
  evoker: new Set(['villager', 'iron_golem']), witch: new Set(), wither_skeleton: new Set(), guardian: new Set(['squid']),
};

export const HOSTILE_TYPES = ['zombie', 'creeper', 'skeleton', 'spider'];
export const ANIMAL_TYPES = ['cow', 'pig', 'sheep', 'chicken'];
export const SHEEP_COLORS = [BLOCK.WHITE_WOOL, BLOCK.WHITE_WOOL, BLOCK.WHITE_WOOL, BLOCK.WHITE_WOOL, BLOCK.WHITE_WOOL, BLOCK.GRAY_WOOL, BLOCK.BLACK_WOOL, BLOCK.BROWN_WOOL];

const rnd = Math.random;

// Straight line of sight between two points (opaque blocks block it).
export function lineOfSight(world, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const dist = Math.hypot(dx, dy, dz);
  const steps = Math.ceil(dist * 3);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.floor(a[0] + dx * t), y = Math.floor(a[1] + dy * t), z = Math.floor(a[2] + dz * t);
    if (IS_OPAQUE[world.getBlock(x, y, z)]) return false;
  }
  return true;
}

export class Entity {
  constructor(sim, id, kind) {
    this.sim = sim;
    this.id = id;
    this.kind = kind; // 'mob' | 'item' | 'arrow'
    this.removed = false;
    this.age = 0;
    this.prevPos = [0, 0, 0];
    this.prevYaw = 0;
  }
  get pos() { return this.body.pos; }
}

export class Mob extends Entity {
  constructor(sim, id, type, x, y, z) {
    super(sim, id, 'mob');
    const d = MOBS[type];
    this.type = type;
    this.def = d;
    this.body = new Body(sim.world, d.hw, d.h);
    this.body.pos = [x, y, z];
    this.prevPos = [x, y, z];
    this.yaw = rnd() * Math.PI * 2; // facing, 0 = -Z like the player
    this.headYaw = this.yaw;
    this.headPitch = 0;
    this.prevYaw = this.yaw;
    this.health = d.health;
    this.hurtTime = 0;
    this.deathTime = 0;
    this.attackCooldown = 0;
    this.walkPhase = rnd() * 10;
    this.walkAmount = 0;
    this.mode = 'idle';
    this.modeTime = 1 + rnd() * 3;
    this.target = null;
    this.path = null;
    this.pathTime = 0;
    this.pathGoal = null;
    this.goal = null;
    this.panic = 0;
    this.fuse = 0;
    this.burning = 0;
    this.shootTime = 1 + rnd();
    this.variant = 0;
    this.lastSeen = 0;
    this.effects = null;
    this.home = null;
    if (type === 'sheep') this.variant = SHEEP_COLORS[Math.floor(rnd() * SHEEP_COLORS.length)];
    else if (type === 'tropical_fish') this.variant = Math.floor(rnd() * FISH_COUNT);
    else if (type === 'cat') this.variant = Math.floor(rnd() * CAT_COUNT);
    else if (type === 'villager') this.variant = 1 + Math.floor(rnd() * (JOB_LIST.length - 1));
    else if (type === 'horse') {
      this.variant = Math.floor(rnd() * HORSE_COUNT);
      this.stats = { speed: 7 + rnd() * 5, jump: 8 + rnd() * 3.5 };
      this.health = 15 + Math.floor(rnd() * 16);
    } else if (type === 'slime') this.setSize([1, 2, 4][Math.floor(rnd() * 3)]);
    else if (type === 'wolf' && rnd() < 0.05) this.age = 0;
  }

  setSize(n) {
    this.size = n;
    this.variant = n;
    this.body.hw = 0.26 * n;
    this.body.h = 0.52 * n;
    this.health = n * n;
    this.renderScale = n;
  }

  get maxHealth() { return this.type === 'slime' ? (this.size || 1) ** 2 : this.tamed && this.type === 'wolf' ? 20 : this.def.health; }
  get baby() { return (this.growth || 0) < 0; }

  get hostile() { return !!this.def.hostile; }
  get eyePos() { return [this.body.pos[0], this.body.pos[1] + this.def.eye, this.body.pos[2]]; }

  hurt(amount, from, knock = 0.8) {
    if (this.deathTime > 0 || this.def.invulnerable || this.charge > 0) return false;
    if (this.hurtTime > 0.35) return false; // brief invulnerability after a hit
    if (this.type === 'shulker' && !this.open) amount *= 0.2; // shut tight in its shell
    if (this.def.heavy) knock *= 0.1;
    this.lastHurt = this.age;
    this.health -= amount;
    this.hurtTime = 0.5;
    if (from) {
      const dx = this.body.pos[0] - from[0], dz = this.body.pos[2] - from[2];
      const l = Math.hypot(dx, dz) || 1;
      this.body.vel[0] += (dx / l) * 6 * knock;
      this.body.vel[2] += (dz / l) * 6 * knock;
      this.body.vel[1] = Math.max(this.body.vel[1], 4.5 * knock);
    }
    if (!this.hostile && !this.def.neutral && !this.def.fixed && !this.def.vehicle && this.type !== 'iron_golem' && !this.tamed) { this.panic = 5; this.path = null; }
    if (this.health <= 0) {
      if (this.def.vehicle) { this.removed = true; this.sim.onMobDeath(this); return true; }
      this.deathTime = 0.001; this.sim.onMobDeath(this);
    }
    else if (this.def.teleports && Math.random() < 0.7) this.teleportAway();
    return true;
  }

  // Endermen blink to a random spot nearby when hurt.
  teleportAway() {
    const b = this.body;
    for (let i = 0; i < 16; i++) {
      const x = Math.floor(b.pos[0] + (rnd() - 0.5) * 24), z = Math.floor(b.pos[2] + (rnd() - 0.5) * 24);
      let y = Math.floor(b.pos[1] + (rnd() - 0.5) * 12);
      for (let k = 0; k < 12; k++, y--) {
        if (this.sim.standable(x, y, z, 3)) {
          this.sim.emit({ type: 'sound', name: 'teleport', pos: b.pos.slice() });
          b.pos = [x + 0.5, y, z + 0.5];
          this.prevPos = b.pos.slice();
          b.vel = [0, 0, 0];
          this.path = null;
          return true;
        }
      }
    }
    return false;
  }

  // Flying creatures: ghasts drift and shoot fireballs from afar; blazes hover near the target
  // and fire bursts of small fireballs.
  flyTowards(tp, dist, sees) {
    const d = this.def, b = this.body;
    this.faceTowards(tp[0], tp[2], 6);
    const ghast = this.type === 'ghast';
    const wantDist = ghast ? 18 : 7;
    const wantY = tp[1] + (ghast ? 6 : 2.5);
    let wish = [0, 0];
    if (dist > wantDist + 3 || !sees) wish = this.walkTowards(tp[0], tp[2], d.speed * 1.4);
    else if (dist < wantDist - 3) wish = this.walkTowards(b.pos[0] * 2 - tp[0], b.pos[2] * 2 - tp[2], d.speed);
    b.vel[1] += (Math.max(-2, Math.min(2, (wantY - b.pos[1]) * 0.8)) - b.vel[1]) * 0.1;
    this.shootTime -= TICK;
    if (sees && dist < (ghast ? 52 : 26) && this.shootTime <= 0) {
      if (ghast) { this.shootTime = 3 + rnd() * 1.5; this.sim.mobFireball(this, this.target, false); }
      else {
        this.burst = 3;
        this.shootTime = 4 + rnd() * 1.5;
      }
    }
    if (this.burst > 0 && (this.burstTimer = (this.burstTimer || 0) - TICK) <= 0) {
      this.burst--;
      this.burstTimer = 0.3;
      this.sim.mobFireball(this, this.target, true);
    }
    return { wish, jump: false };
  }

  flyIdle() {
    const d = this.def, b = this.body;
    this.modeTime -= TICK;
    if (!this.goal || this.modeTime <= 0 || b.hitWall) {
      const a = rnd() * Math.PI * 2, r = 4 + rnd() * (this.type === 'ghast' ? 20 : 6);
      const floor = this.sim.world.surfaceBelow ? this.sim.world.surfaceBelow(b.pos[0], b.pos[1], b.pos[2]) : b.pos[1] - 3;
      const y = this.type === 'ghast' ? b.pos[1] + (rnd() - 0.5) * 10 : floor + 1.5 + rnd() * 2;
      this.goal = [b.pos[0] + Math.cos(a) * r, Math.max(8, Math.min(118, y)), b.pos[2] + Math.sin(a) * r];
      this.modeTime = 3 + rnd() * 4;
    }
    this.mode = 'idle';
    b.vel[1] += (Math.max(-1.5, Math.min(1.5, (this.goal[1] - b.pos[1]) * 0.5)) - b.vel[1]) * 0.08;
    return { wish: this.walkTowards(this.goal[0], this.goal[2], d.speed), jump: false };
  }

  // Steering helpers --------------------------------------------------------
  faceTowards(x, z, rate = 8, dt = TICK) {
    const want = Math.atan2(-(x - this.body.pos[0]), -(z - this.body.pos[2]));
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, rate * dt);
  }

  walkTowards(x, z, speed) {
    const p = this.body.pos;
    const dx = x - p[0], dz = z - p[2];
    const l = Math.hypot(dx, dz);
    if (l < 0.05) return [0, 0];
    this.faceTowards(x, z);
    return [(dx / l) * speed, (dz / l) * speed];
  }

  // Follow a path computed towards goal (refreshed when the goal moves or the path runs out).
  followPath(goal, speed) {
    const p = this.body.pos;
    const bx = Math.floor(p[0]), by = Math.floor(p[1] + 0.1), bz = Math.floor(p[2]);
    const g = [Math.floor(goal[0]), Math.floor(goal[1] + 0.1), Math.floor(goal[2])];
    this.pathTime -= TICK;
    const moved = !this.pathGoal || Math.abs(this.pathGoal[0] - g[0]) + Math.abs(this.pathGoal[2] - g[2]) > 1.5;
    if (!this.path || this.pathTime <= 0 || (moved && this.pathTime < 0.6)) {
      if (this.sim.pathBudget > 0) {
        this.sim.pathBudget--;
        this.path = findPath(this.sim.world, [bx, by, bz], g, { height: this.def.h > 1 ? 2 : 1, maxNodes: this.hostile ? 520 : 200 });
        this.pathGoal = g;
        this.pathTime = 1.2 + rnd() * 0.6;
      }
    }
    if (this.path && this.path.length) {
      let n = this.path[0];
      // reached this waypoint?
      if (Math.abs(n[0] + 0.5 - p[0]) < 0.4 && Math.abs(n[2] + 0.5 - p[2]) < 0.4 && Math.abs(n[1] - p[1]) < 1.2) {
        this.path.shift();
        if (!this.path.length) return { wish: this.walkTowards(goal[0], goal[2], speed), jump: false };
        n = this.path[0];
      }
      const wish = this.walkTowards(n[0] + 0.5, n[2] + 0.5, speed);
      const jump = n[1] > p[1] + 0.4 || (this.body.hitWall && this.body.onGround);
      return { wish, jump };
    }
    const wish = this.walkTowards(goal[0], goal[2], speed);
    return { wish, jump: this.body.hitWall };
  }

  // Wander about (near `home`, when given), stand and look about now and then, graze.
  idleWander({ home = null, radius = 0, speed = this.def.speed } = {}) {
    const b = this.body;
    let wish = null, jump = false;
    this.modeTime -= TICK;
    if (this.modeTime <= 0) {
      if (this.mode === 'walk' || rnd() < 0.4) {
        this.mode = 'idle';
        this.modeTime = 2 + rnd() * 6;
        this.goal = null;
        this.headTarget = rnd() * Math.PI * 2;
      } else {
        this.mode = 'walk';
        this.modeTime = 4 + rnd() * 5;
        const a = rnd() * Math.PI * 2, r = 3 + rnd() * 7;
        let gx = b.pos[0] + Math.cos(a) * r, gz = b.pos[2] + Math.sin(a) * r;
        // tethered: back towards home when too far from it
        if (home && radius && Math.hypot(gx - home[0], gz - home[2]) > radius) { gx = home[0] + (rnd() - 0.5) * 6; gz = home[2] + (rnd() - 0.5) * 6; }
        this.goal = [gx, b.pos[1], gz];
      }
    }
    if (this.mode === 'walk' && this.goal) {
      const p = b.pos;
      if (Math.hypot(this.goal[0] - p[0], this.goal[2] - p[2]) < 0.6) { this.mode = 'idle'; this.modeTime = 2 + rnd() * 4; }
      else {
        wish = this.walkTowards(this.goal[0], this.goal[2], speed);
        const ax = Math.floor(p[0] + wish[0] * 0.6), az = Math.floor(p[2] + wish[1] * 0.6);
        const w = this.sim.world;
        const fy = Math.floor(p[1]);
        const drop = !w.isSolidAt(ax, fy - 1, az) && !w.isSolidAt(ax, fy - 2, az) && !w.isSolidAt(ax, fy - 3, az);
        const water = w.getBlock(ax, fy, az) === BLOCK.WATER || w.getBlock(ax, fy - 1, az) === BLOCK.WATER;
        if (drop || (water && !b.inWater)) { this.mode = 'idle'; this.modeTime = 1 + rnd() * 2; wish = [0, 0]; }
        jump = b.hitWall && b.blockedAhead(wish[0] / (speed || 1), wish[1] / (speed || 1));
      }
    } else if (this.headTarget !== undefined) {
      const dd = Math.atan2(Math.sin(this.headTarget - this.headYaw), Math.cos(this.headTarget - this.headYaw));
      this.headYaw += dd * 0.05;
    }
    return { wish, jump };
  }

  // Brain ---------------------------------------------------------------------
  think(env) {
    const d = this.def;
    const b = this.body;
    let wish = null, jump = false;
    if (this.deathTime > 0) return { wish: null, jump: false };
    const brain = BRAINS[this.type];
    if (brain) return brain(this, env);
    // a bred animal looks for its mate; any animal follows someone holding its food
    if (this.love > 0 && this.mate && alive(this.mate)) {
      const q = this.mate.body.pos;
      this.mode = 'walk';
      return { wish: this.walkTowards(q[0], q[2], d.speed * 1.2), jump: b.hitWall };
    }
    if (this.lure && this.lure.pos && !this.hostile) {
      const q = this.lure.pos;
      if (Math.hypot(q[0] - b.pos[0], q[2] - b.pos[2]) > 2.2) { this.mode = 'walk'; return { wish: this.walkTowards(q[0], q[2], d.speed * 1.3), jump: b.hitWall && b.blockedAhead(-Math.sin(this.yaw), -Math.cos(this.yaw)) }; }
      this.faceTowards(q[0], q[2], 6);
      return { wish: [0, 0], jump: false };
    }
    // creepers keep away from cats
    if (this.type === 'creeper' && this.age >= (this.catCheck || 0)) {
      this.catCheck = this.age + 0.5;
      this.fearCat = this.sim.nearestMob(b.pos, 6, (e) => e.type === 'cat');
    }
    if (this.type === 'creeper' && this.fearCat && alive(this.fearCat)) {
      this.fuse = Math.max(0, this.fuse - TICK);
      const q = this.fearCat.body.pos;
      return { wish: this.walkTowards(b.pos[0] * 2 - q[0], b.pos[2] * 2 - q[2], d.chase), jump: b.hitWall };
    }

    if (this.hostile || this.angryAt) {
      let t;
      if (d.neutral) {
        // neutral creatures only go after whoever angered them, while they stay close
        const a = this.angryAt;
        const ok = a && alive(a) && Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]) < d.follow && (a.kind === 'mob' || this.sim.players.get(a.id) === a);
        t = ok ? a : null;
        if (!ok) this.angryAt = null;
      } else t = this.sim.targetFor(this, d.follow);
      this.target = t;
      if (t) {
        const tp = t.pos;
        const dist = Math.hypot(tp[0] - b.pos[0], tp[2] - b.pos[2]);
        const dy = tp[1] - b.pos[1];
        const sees = lineOfSight(this.sim.world, this.eyePos, [tp[0], tp[1] + 1.5, tp[2]]);
        if (sees) this.lastSeen = 0; else this.lastSeen += TICK;
        this.headYaw = this.yaw;
        this.headPitch = Math.atan2(tp[1] + 1.5 - (b.pos[1] + d.eye), Math.max(dist, 0.1)) * 0.8;
        if (d.flies) {
          ({ wish, jump } = this.flyTowards(tp, dist, sees));
          this.mode = 'chase';
          return { wish, jump };
        }
        if (this.type === 'creeper') {
          if (dist < 3 && sees) { this.fuse += TICK; wish = [0, 0]; this.faceTowards(tp[0], tp[2]); }
          else {
            this.fuse = Math.max(0, this.fuse - TICK * (dist > 7 ? 1 : 0.4));
            ({ wish, jump } = this.followPath(tp, d.chase));
          }
          if (this.fuse >= d.fuse) { this.sim.explode(b.pos[0], b.pos[1] + 0.8, b.pos[2], d.blast, this); this.removed = true; }
        } else if (d.ranged) {
          // keep a comfortable distance, circle, shoot when the target is in view
          if (dist < 5.5) {
            const away = this.walkTowards(b.pos[0] - (tp[0] - b.pos[0]), b.pos[2] - (tp[2] - b.pos[2]), d.chase);
            wish = away;
            jump = b.hitWall;
          } else if (dist > 13 || !sees) ({ wish, jump } = this.followPath(tp, d.chase));
          else {
            const side = Math.sin(this.age * 0.8 + this.id) > 0 ? 1 : -1;
            const ang = Math.atan2(tp[2] - b.pos[2], tp[0] - b.pos[0]) + side * Math.PI / 2;
            wish = [Math.cos(ang) * 1.2, Math.sin(ang) * 1.2];
            jump = b.hitWall;
          }
          this.faceTowards(tp[0], tp[2], 12);
          this.shootTime -= TICK;
          if (sees && dist < 18 && this.shootTime <= 0) {
            // a crossbow takes longer to load but hits harder
            this.shootTime = d.ranged === 'crossbow' ? 2.4 + rnd() : 1.6 + rnd() * 0.9;
            this.sim.mobShoot(this, t, d.ranged === 'crossbow' ? 1.5 : 1);
          }
        } else {
          const reach = (d.reach || 1.2) + d.hw;
          if (dist < reach && Math.abs(dy) < 1.6) {
            wish = [0, 0];
            this.faceTowards(tp[0], tp[2], 12);
            if (this.attackCooldown <= 0) {
              this.attackCooldown = 1.0;
              this.swing = 0.4;
              this.sim.mobAttack(this, t);
            }
          } else if (this.type === 'spider' && dist < 3.5 && b.onGround && sees && this.attackCooldown <= 0.3) {
            // leap
            const l = dist || 1;
            b.vel[0] = ((tp[0] - b.pos[0]) / l) * 6;
            b.vel[2] = ((tp[2] - b.pos[2]) / l) * 6;
            b.vel[1] = 5.5;
            this.attackCooldown = 1.2;
          } else ({ wish, jump } = this.followPath(tp, d.chase));
        }
        if (d.climbs && b.hitWall && wish && (wish[0] || wish[1])) b.vel[1] = 3.2;
        this.mode = 'chase';
        return { wish, jump };
      }
      this.fuse = Math.max(0, this.fuse - TICK);
    }

    if (d.flies) return this.flyIdle();
    // sheep grow their wool back by eating grass
    if (this.type === 'sheep' && this.sheared && this.mode === 'idle' && rnd() < 0.002) {
      const w = this.sim.world, x = Math.floor(b.pos[0]), y = Math.floor(b.pos[1] - 0.1), z = Math.floor(b.pos[2]);
      if (w.getBlock(x, y, z) === BLOCK.GRASS) { this.sheared = false; this.sim.emit({ type: 'graze', pos: [x, y, z] }); }
    }
    // animals and idle monsters: wander, graze, panic when hurt
    if (this.panic > 0) {
      this.panic -= TICK;
      if (!this.goal || this.modeTime <= 0 || this.body.hitWall) {
        const a = rnd() * Math.PI * 2;
        this.goal = [b.pos[0] + Math.cos(a) * 8, b.pos[1], b.pos[2] + Math.sin(a) * 8];
        this.modeTime = 1 + rnd();
      }
      this.modeTime -= TICK;
      wish = this.walkTowards(this.goal[0], this.goal[2], d.speed * 2.4);
      jump = this.body.hitWall;
      return { wish, jump };
    }
    return this.idleWander({ home: this.home, radius: this.home ? 16 : 0 });
  }

  update(env) {
    const b = this.body;
    this.age += TICK;
    this.prevPos[0] = b.pos[0]; this.prevPos[1] = b.pos[1]; this.prevPos[2] = b.pos[2];
    this.prevYaw = this.yaw;
    if (this.hurtTime > 0) this.hurtTime -= TICK;
    if (this.attackCooldown > 0) this.attackCooldown -= TICK;
    if (this.swing > 0) this.swing -= TICK;
    if (this.deathTime > 0) {
      this.deathTime += TICK;
      b.step(TICK, null, false);
      if (this.deathTime > 1.0) this.removed = true;
      return;
    }
    // in someone's arms: placed there each frame, kicking its legs a little
    if (this.carriedBy) {
      b.vel[0] = b.vel[1] = b.vel[2] = 0;
      this.walkPhase += TICK * 3;
      this.walkAmount = 0.25;
      this.fallStart = null;
      return;
    }
    // sitting aboard a flying saucer: placed in its seat each frame (game/saucer.js)
    if (this.aboard) {
      b.vel[0] = b.vel[1] = b.vel[2] = 0;
      this.walkAmount = 0;
      this.fallStart = null;
      return;
    }
    const ticker = TICKERS[this.type];
    if (ticker && ticker(this, env)) return;
    if (this.def.fixed) { this.walkAmount = 0; return; }
    tickMobEffects(this);
    // babies grow up; animals in love look for a mate for a while
    if (this.growth < 0) { this.growth = Math.min(0, this.growth + TICK); this.renderScale = this.growth < 0 ? 0.55 : 1; }
    if (this.love > 0) this.love -= TICK;
    if (this.breedCooldown > 0) this.breedCooldown -= TICK;
    const d = this.def;
    if (d.still) { this.think(env); b.step(TICK, null, false, {}); return; }
    b.gravity = d.flies || (d.water && b.inWater) ? 0 : 28;
    const { wish, jump, moved } = this.think(env);
    if (moved) {
      // (a minecart on its rails moved itself)
      const hs = Math.hypot(b.vel[0], b.vel[2]);
      this.walkAmount += (Math.min(1, hs / 2.5) - this.walkAmount) * 0.3;
      this.walkPhase += hs * TICK * 2.6;
      if (b.pos[1] < -20) this.removed = true;
      return;
    }
    if (!this.hostile || this.mode !== 'chase') {
      // the head follows the body when nothing holds its attention
      const dd = Math.atan2(Math.sin(this.yaw - this.headYaw), Math.cos(this.yaw - this.headYaw));
      this.headYaw += dd * 0.15;
      this.headPitch *= 0.9;
    }
    let slow = 1;
    if (this.effects && this.effects.slowness) slow = Math.max(0.2, 1 - 0.15 * (this.effects.slowness.amp + 1));
    const w2 = wish && slow < 1 ? [wish[0] * slow, wish[1] * slow] : wish;
    const landed = b.step(TICK, w2, jump, {
      swim: !d.flies && !d.water && !d.vehicle, jumpV: this.jumpV || (this.type === 'spider' || this.type === 'cave_spider' ? 7 : 8.4), step: d.flies || d.vehicle ? 0 : d.step || 0.6,
    });
    if (this.def.flutter && !b.onGround && b.vel[1] < -2) b.vel[1] = -2; // chickens glide down
    else if (landed > (this.type === 'horse' ? 5.5 : 3.5) && !this.def.flutter && !this.def.flies && !d.vehicle && this.type !== 'slime' && this.type !== 'cat') this.hurt(Math.floor(landed - 3), null);
    const hs = Math.hypot(b.vel[0], b.vel[2]);
    this.walkAmount += ((b.onGround || b.inWater ? Math.min(1, hs / 2.5) : 0) - this.walkAmount) * 0.3;
    this.walkPhase += hs * TICK * 2.6;
    // sunlight sets undead on fire; water puts them out
    if (this.def.burns && env.day && !b.inWater) {
      const [sl] = this.sim.world.getLight(Math.floor(b.pos[0]), Math.floor(b.pos[1] + this.def.eye), Math.floor(b.pos[2]));
      if (sl >= 14) this.burning = Math.max(this.burning, 3);
    }
    if (b.inWater) this.burning = 0;
    if (b.inWater && this.def.teleports && this.age % 1 < TICK) this.teleportAway();
    if (b.inLava && !this.def.fireproof) { this.burning = 8; if (this.age % 0.5 < TICK) this.hurt(4, null, 0.1); }
    if (this.def.fireproof) this.burning = 0;
    if (this.burning > 0) {
      this.burning -= TICK;
      this.burnTick = (this.burnTick || 0) + TICK;
      if (this.burnTick >= 1) { this.burnTick = 0; this.hurtTime = 0; this.hurt(1, null, 0); }
    }
    if (b.pos[1] < -20) this.removed = true;
  }
}

export class ItemDrop extends Entity {
  constructor(sim, id, itemId, count, x, y, z, wear = 0) {
    super(sim, id, 'item');
    this.item = itemId;
    this.count = count;
    this.wear = wear;
    this.body = new Body(sim.world, 0.125, 0.25);
    this.body.pos = [x, y, z];
    this.body.drag = 1.5;
    this.body.vel = [(rnd() - 0.5) * 3, 3 + rnd() * 1.5, (rnd() - 0.5) * 3];
    this.prevPos = [x, y, z];
    this.pickupDelay = 0.6;
    this.spin = rnd() * Math.PI * 2;
  }

  update() {
    const b = this.body;
    this.age += TICK;
    this.prevPos[0] = b.pos[0]; this.prevPos[1] = b.pos[1]; this.prevPos[2] = b.pos[2];
    if (this.pickupDelay > 0) this.pickupDelay -= TICK;
    b.step(TICK, null, false, { swim: true });
    if (b.inWater) b.vel[1] += 0.8; // bob up
    this.spin += TICK * 1.6;
    if (this.age > 300 || b.pos[1] < -20) this.removed = true;
  }
}

export class Arrow extends Entity {
  constructor(sim, id, owner, x, y, z, vx, vy, vz, damage) {
    super(sim, id, 'arrow');
    this.owner = owner; // entity id or player id
    this.body = new Body(sim.world, 0.05, 0.1);
    this.body.pos = [x, y, z];
    this.body.vel = [vx, vy, vz];
    this.prevPos = [x, y, z];
    this.damage = damage;
    this.stuck = false;
    this.pickup = false;
  }

  get yaw() { return Math.atan2(-this.body.vel[0], -this.body.vel[2]); }
  get pitch() { return Math.atan2(this.body.vel[1], Math.hypot(this.body.vel[0], this.body.vel[2])); }

  update() {
    const b = this.body;
    this.age += TICK;
    this.prevPos[0] = b.pos[0]; this.prevPos[1] = b.pos[1]; this.prevPos[2] = b.pos[2];
    if (this.stuck) {
      if (this.age > 60) this.removed = true;
      return;
    }
    if (!this.dir) this.dir = [b.vel[0], b.vel[1], b.vel[2]];
    b.vel[1] -= 20 * TICK;
    const v = b.vel;
    const speed = Math.hypot(v[0], v[1], v[2]);
    // march the segment so fast arrows don't tunnel through targets or thin walls
    const steps = Math.max(1, Math.ceil((speed * TICK) / 0.3));
    for (let s = 0; s < steps; s++) {
      const nx = b.pos[0] + (v[0] * TICK) / steps, ny = b.pos[1] + (v[1] * TICK) / steps, nz = b.pos[2] + (v[2] * TICK) / steps;
      const hit = this.sim.arrowHit(this, [nx, ny, nz]);
      if (hit) { this.removed = true; return; }
      if (this.sim.world.isSolidAt(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
        this.stuck = true;
        this.dir = [v[0], v[1], v[2]];
        b.vel = [0, 0, 0];
        this.sim.emit({ type: 'sound', name: 'arrowHit', pos: [nx, ny, nz] });
        return;
      }
      b.pos[0] = nx; b.pos[1] = ny; b.pos[2] = nz;
    }
    this.dir = [v[0], v[1], v[2]];
    if (b.pos[1] < -20 || this.age > 20) this.removed = true;
  }
}

// ---------------------------------------------------------------------------- thrown things
// An ender pearl: flies like a thrown ball; where it lands, its thrower appears.
export class Thrown extends Entity {
  constructor(sim, id, owner, item, x, y, z, vx, vy, vz) {
    super(sim, id, 'thrown');
    this.owner = owner;
    this.item = item;
    this.body = new Body(sim.world, 0.1, 0.2);
    this.body.pos = [x, y, z];
    this.body.vel = [vx, vy, vz];
    this.prevPos = [x, y, z];
  }

  update() {
    const b = this.body;
    this.age += TICK;
    this.prevPos[0] = b.pos[0]; this.prevPos[1] = b.pos[1]; this.prevPos[2] = b.pos[2];
    b.vel[1] -= 18 * TICK;
    const v = b.vel;
    const steps = Math.max(1, Math.ceil((Math.hypot(v[0], v[1], v[2]) * TICK) / 0.3));
    for (let s = 0; s < steps; s++) {
      const nx = b.pos[0] + (v[0] * TICK) / steps, ny = b.pos[1] + (v[1] * TICK) / steps, nz = b.pos[2] + (v[2] * TICK) / steps;
      const hitMob = this.sim.projectileHitsMob(this, [nx, ny, nz]);
      if (hitMob || this.sim.world.isSolidAt(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
        if (hitMob) hitMob.hurt(0, b.pos, 0.4);
        this.sim.emit({ type: 'pearlLand', owner: this.owner, pos: b.pos.slice() });
        this.removed = true;
        return;
      }
      b.pos[0] = nx; b.pos[1] = ny; b.pos[2] = nz;
    }
    if (b.pos[1] < -40 || this.age > 30) {
      this.sim.emit({ type: 'pearlLand', owner: this.owner, pos: null });
      this.removed = true;
    }
  }
}

// An eye of ender: rises and flies a little way towards the nearest stronghold, then falls
// (and sometimes shatters).
export class EyeOfEnder extends Entity {
  constructor(sim, id, owner, x, y, z, target) {
    super(sim, id, 'thrown');
    this.owner = owner;
    this.item = ITEM.EYE_OF_ENDER;
    this.body = new Body(sim.world, 0.1, 0.2);
    this.body.pos = [x, y, z];
    this.prevPos = [x, y, z];
    this.start = [x, y, z];
    this.target = target; // [x, z] or null
  }

  update() {
    const b = this.body;
    this.age += TICK;
    this.prevPos[0] = b.pos[0]; this.prevPos[1] = b.pos[1]; this.prevPos[2] = b.pos[2];
    const t = this.age;
    if (t < 1.8) {
      let dx = 0, dz = 0;
      if (this.target) {
        const ex = this.target[0] - this.start[0], ez = this.target[1] - this.start[2];
        const l = Math.hypot(ex, ez) || 1;
        // straight up when standing right over it
        const k = Math.min(1, l / 12);
        dx = (ex / l) * k; dz = (ez / l) * k;
      }
      const f = Math.min(1, t / 1.5);
      b.pos[0] = this.start[0] + dx * 12 * f;
      b.pos[2] = this.start[2] + dz * 12 * f;
      b.pos[1] = this.start[1] + Math.sin(f * Math.PI * 0.5) * 5;
      if (this.age % 0.1 < TICK) this.sim.emit({ type: 'eyeTrail', pos: b.pos.slice() });
    } else {
      this.removed = true;
      this.sim.emit({ type: 'eyeDone', owner: this.owner, pos: b.pos.slice(), shatter: Math.random() < 0.2 });
    }
  }
}

// Fireballs: a ghast's explodes; a blaze's small ones set what they hit on fire.
export class Fireball extends Entity {
  constructor(sim, id, owner, x, y, z, dir, small) {
    super(sim, id, 'fireball');
    this.owner = owner;
    this.small = small;
    const speed = small ? 16 : 11;
    this.body = new Body(sim.world, 0.15, 0.3);
    this.body.pos = [x, y, z];
    this.body.vel = [dir[0] * speed, dir[1] * speed, dir[2] * speed];
    this.prevPos = [x, y, z];
    this.spin = 0;
  }

  update() {
    const b = this.body;
    this.age += TICK;
    this.spin += TICK * 8;
    this.prevPos[0] = b.pos[0]; this.prevPos[1] = b.pos[1]; this.prevPos[2] = b.pos[2];
    const v = b.vel;
    const steps = Math.max(1, Math.ceil((Math.hypot(v[0], v[1], v[2]) * TICK) / 0.3));
    for (let s = 0; s < steps; s++) {
      const nx = b.pos[0] + (v[0] * TICK) / steps, ny = b.pos[1] + (v[1] * TICK) / steps, nz = b.pos[2] + (v[2] * TICK) / steps;
      const player = this.sim.projectileHitsPlayer(this, [nx, ny, nz]);
      const solid = this.sim.world.isSolidAt(Math.floor(nx), Math.floor(ny), Math.floor(nz));
      if (player || solid) {
        this.removed = true;
        if (this.small) {
          if (player) {
            const shooter = this.sim.entities.get(this.owner);
            if (this.sim.damagePlayer(player.id, 5 * this.sim.diff.damage, shooter ? shooter.type : 'fire', b.pos)) player.fire = Math.max(player.fire || 0, 4);
          } else this.sim.emit({ type: 'igniteAt', pos: [b.pos[0], b.pos[1], b.pos[2]] });
        } else this.sim.explode(b.pos[0], b.pos[1], b.pos[2], 1.6, this);
        return;
      }
      b.pos[0] = nx; b.pos[1] = ny; b.pos[2] = nz;
    }
    if (this.age > 12) this.removed = true;
  }
}
