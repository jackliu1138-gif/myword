// Creatures, dropped items and arrows. Each creature has a physics body and a small brain;
// the Simulation calls think() and step() at 20 ticks per second.

import { Body } from './physics.js';
import { findPath } from './path.js';
import { ITEM } from './items.js';
import { BLOCK, IS_OPAQUE } from '../world/blocks.js';

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
    if (type === 'sheep') this.variant = SHEEP_COLORS[Math.floor(rnd() * SHEEP_COLORS.length)];
  }

  get hostile() { return !!this.def.hostile; }
  get eyePos() { return [this.body.pos[0], this.body.pos[1] + this.def.eye, this.body.pos[2]]; }

  hurt(amount, from, knock = 0.8) {
    if (this.deathTime > 0) return false;
    if (this.hurtTime > 0.35) return false; // brief invulnerability after a hit
    this.health -= amount;
    this.hurtTime = 0.5;
    if (from) {
      const dx = this.body.pos[0] - from[0], dz = this.body.pos[2] - from[2];
      const l = Math.hypot(dx, dz) || 1;
      this.body.vel[0] += (dx / l) * 6 * knock;
      this.body.vel[2] += (dz / l) * 6 * knock;
      this.body.vel[1] = Math.max(this.body.vel[1], 4.5 * knock);
    }
    if (!this.hostile) { this.panic = 5; this.path = null; }
    if (this.health <= 0) { this.deathTime = 0.001; this.sim.onMobDeath(this); }
    return true;
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

  // Brain ---------------------------------------------------------------------
  think(env) {
    const d = this.def;
    const b = this.body;
    let wish = null, jump = false;
    if (this.deathTime > 0) return { wish: null, jump: false };

    if (this.hostile) {
      const t = this.sim.nearestTarget(this, d.follow);
      this.target = t;
      if (t) {
        const tp = t.pos;
        const dist = Math.hypot(tp[0] - b.pos[0], tp[2] - b.pos[2]);
        const dy = tp[1] - b.pos[1];
        const sees = lineOfSight(this.sim.world, this.eyePos, [tp[0], tp[1] + 1.5, tp[2]]);
        if (sees) this.lastSeen = 0; else this.lastSeen += TICK;
        this.headYaw = this.yaw;
        this.headPitch = Math.atan2(tp[1] + 1.5 - (b.pos[1] + d.eye), Math.max(dist, 0.1)) * 0.8;
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
            this.shootTime = 1.6 + rnd() * 0.9;
            this.sim.mobShoot(this, t);
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
        this.goal = [b.pos[0] + Math.cos(a) * r, b.pos[1], b.pos[2] + Math.sin(a) * r];
      }
    }
    if (this.mode === 'walk' && this.goal) {
      const p = b.pos;
      if (Math.hypot(this.goal[0] - p[0], this.goal[2] - p[2]) < 0.6) { this.mode = 'idle'; this.modeTime = 2 + rnd() * 4; }
      else {
        wish = this.walkTowards(this.goal[0], this.goal[2], d.speed);
        // don't wander off cliffs or into water
        const ax = Math.floor(p[0] + wish[0] * 0.6), az = Math.floor(p[2] + wish[1] * 0.6);
        const w = this.sim.world;
        const fy = Math.floor(p[1]);
        const drop = !w.isSolidAt(ax, fy - 1, az) && !w.isSolidAt(ax, fy - 2, az) && !w.isSolidAt(ax, fy - 3, az);
        const water = w.getBlock(ax, fy, az) === BLOCK.WATER || w.getBlock(ax, fy - 1, az) === BLOCK.WATER;
        if (drop || (water && !b.inWater)) { this.mode = 'idle'; this.modeTime = 1 + rnd() * 2; wish = [0, 0]; }
        jump = b.hitWall && b.blockedAhead(wish[0] / (d.speed || 1), wish[1] / (d.speed || 1));
      }
    } else if (this.headTarget !== undefined) {
      const dd = Math.atan2(Math.sin(this.headTarget - this.headYaw), Math.cos(this.headTarget - this.headYaw));
      this.headYaw += dd * 0.05;
    }
    return { wish, jump };
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
    const { wish, jump } = this.think(env);
    if (!this.hostile || this.mode !== 'chase') {
      // the head follows the body when nothing holds its attention
      const dd = Math.atan2(Math.sin(this.yaw - this.headYaw), Math.cos(this.yaw - this.headYaw));
      this.headYaw += dd * 0.15;
      this.headPitch *= 0.9;
    }
    const landed = b.step(TICK, wish, jump, { swim: true, jumpV: this.type === 'spider' ? 7 : 8.4 });
    if (this.def.flutter && !b.onGround && b.vel[1] < -2) b.vel[1] = -2; // chickens glide down
    else if (landed > 3.5 && !this.def.flutter) this.hurt(Math.floor(landed - 3), null);
    const hs = Math.hypot(b.vel[0], b.vel[2]);
    this.walkAmount += ((b.onGround || b.inWater ? Math.min(1, hs / 2.5) : 0) - this.walkAmount) * 0.3;
    this.walkPhase += hs * TICK * 2.6;
    // sunlight sets undead on fire; water puts them out
    if (this.def.burns && env.day && !b.inWater) {
      const [sl] = this.sim.world.getLight(Math.floor(b.pos[0]), Math.floor(b.pos[1] + this.def.eye), Math.floor(b.pos[2]));
      if (sl >= 14) this.burning = Math.max(this.burning, 3);
    }
    if (b.inWater) this.burning = 0;
    if (b.inLava) { this.burning = 8; if (this.age % 0.5 < TICK) this.hurt(4, null, 0.1); }
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
