// Things that fly and land: splash potions, the wither's skulls, shulker bullets, firework rockets,
// fishing bobbers, and the orbs of experience creatures and ores leave behind.

import { Entity, TICK } from './entities.js';
import { Body, rayHitsBox } from './physics.js';
import { BLOCK, IS_SOLID } from '../world/blocks.js';
import { ITEM, SPLASH_ITEMS } from './items.js';
import { POTIONS, potionOutcome } from './effects.js';

const rnd = Math.random;

// the first creature or player a small projectile touches on its way to `next`
function firstHit(sim, proj, next, { mobs = true, players = true } = {}) {
  const a = proj.body.pos;
  const d = [next[0] - a[0], next[1] - a[1], next[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]) || 1e-6;
  const dir = [d[0] / len, d[1] / len, d[2] / len];
  if (mobs) {
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob' || e.id === proj.owner || e.deathTime > 0 || e.def.fixed) continue;
      const b = e.body;
      if (rayHitsBox(a, dir, [b.pos[0] - b.hw, b.pos[1], b.pos[2] - b.hw, b.pos[0] + b.hw, b.pos[1] + b.h, b.pos[2] + b.hw], len) !== null) return e;
    }
  }
  if (players) {
    for (const p of sim.players.values()) {
      if (p.dead || p.id === proj.owner) continue;
      if (rayHitsBox(a, dir, [p.pos[0] - p.hw, p.pos[1], p.pos[2] - p.hw, p.pos[0] + p.hw, p.pos[1] + p.h, p.pos[2] + p.hw], len) !== null) return p;
    }
  }
  return null;
}

// March a projectile along its velocity; calls hit(target or null for a block) and stops there.
function march(e, hit, opts) {
  const b = e.body, v = b.vel, sim = e.sim;
  const steps = Math.max(1, Math.ceil((Math.hypot(v[0], v[1], v[2]) * TICK) / 0.3));
  for (let s = 0; s < steps; s++) {
    const nx = b.pos[0] + (v[0] * TICK) / steps, ny = b.pos[1] + (v[1] * TICK) / steps, nz = b.pos[2] + (v[2] * TICK) / steps;
    const t = firstHit(sim, e, [nx, ny, nz], opts);
    if (t) { hit(t); return true; }
    if (sim.world.isSolidAt(Math.floor(nx), Math.floor(ny), Math.floor(nz))) { hit(null); return true; }
    b.pos[0] = nx; b.pos[1] = ny; b.pos[2] = nz;
  }
  return false;
}

// A splash potion: breaks where it lands and splashes everyone around, more the closer they are.
export class SplashPotion extends Entity {
  constructor(sim, id, owner, potion, x, y, z, vx, vy, vz) {
    super(sim, id, 'thrown');
    this.owner = owner;
    this.potion = potion;
    this.item = SPLASH_ITEMS[potion] || ITEM.GLASS_BOTTLE;
    this.body = new Body(sim.world, 0.12, 0.25);
    this.body.pos = [x, y, z];
    this.body.vel = [vx, vy, vz];
    this.prevPos = [x, y, z];
  }

  update() {
    const b = this.body;
    this.age += TICK;
    this.prevPos[0] = b.pos[0]; this.prevPos[1] = b.pos[1]; this.prevPos[2] = b.pos[2];
    b.vel[1] -= 20 * TICK;
    if (march(this, () => this.splash()) || this.age > 20) this.removed = true;
  }

  splash() {
    const sim = this.sim, p = this.body.pos;
    const color = (POTIONS[this.potion] || POTIONS.water).color;
    sim.emit({ type: 'potionSplash', pos: p.slice(), color, potion: this.potion });
    sim.emit({ type: 'sound', name: 'glassBreak', pos: p.slice() });
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob' || e.deathTime > 0) continue;
      const d = Math.hypot(e.body.pos[0] - p[0], e.body.pos[1] + e.body.h / 2 - p[1], e.body.pos[2] - p[2]);
      if (d < 4) sim.potionOnMob(e, this.potion, 1 - d / 5);
    }
    for (const pl of sim.players.values()) {
      if (pl.dead) continue;
      const d = Math.hypot(pl.pos[0] - p[0], pl.pos[1] + 0.9 - p[1], pl.pos[2] - p[2]);
      if (d < 4) sim.potionOnPlayer(pl.id, this.potion, 1 - d / 5, this.owner);
    }
    // water puts out fire
    if (this.potion === 'water') {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const x = Math.floor(p[0]) + dx, y = Math.floor(p[1]) + dy, z = Math.floor(p[2]) + dz;
        if (sim.world.getBlock(x, y, z) === BLOCK.FIRE) sim.world.setBlock(x, y, z, 0);
      }
    }
  }
}

// The wither's skulls: explode where they hit and wither whoever they hit. Blue ones are stronger.
export class WitherSkull extends Entity {
  constructor(sim, id, owner, x, y, z, dir, blue) {
    super(sim, id, 'skull');
    this.owner = owner;
    this.blue = blue;
    const speed = blue ? 7 : 14;
    this.body = new Body(sim.world, 0.15, 0.3);
    this.body.pos = [x, y, z];
    this.body.vel = [dir[0] * speed, dir[1] * speed, dir[2] * speed];
    this.prevPos = [x, y, z];
    this.spin = 0;
  }

  update() {
    const b = this.body;
    this.age += TICK;
    this.spin += TICK * 6;
    this.prevPos[0] = b.pos[0]; this.prevPos[1] = b.pos[1]; this.prevPos[2] = b.pos[2];
    const done = march(this, (t) => {
      const sim = this.sim;
      if (t && t.kind === 'mob') { if (t.type !== 'wither') { t.hurt(8, b.pos, 0.5); sim.potionEffectMob(t, 'wither', 10, 1); } }
      else if (t) { if (sim.damagePlayer(t.id, 8 * Math.max(sim.diff.damage, 0.5), 'wither', b.pos)) sim.effectPlayer(t.id, 'wither', 10, 1); }
      sim.explode(b.pos[0], b.pos[1], b.pos[2], this.blue ? 1.8 : 1.1, this, { noBlocks: !this.blue && rnd() < 0.5 });
    });
    if (done || this.age > 10) this.removed = true;
  }
}

// A shulker's bullet: homes in on its target, and whoever it hits floats up into the air.
export class ShulkerBullet extends Entity {
  constructor(sim, id, owner, x, y, z, target) {
    super(sim, id, 'bullet');
    this.owner = owner;
    this.target = target;
    this.body = new Body(sim.world, 0.15, 0.3);
    this.body.pos = [x, y, z];
    this.body.vel = [0, 2, 0];
    this.prevPos = [x, y, z];
    this.spin = 0;
  }

  update() {
    const b = this.body, t = this.target;
    this.age += TICK;
    this.spin += TICK * 5;
    this.prevPos[0] = b.pos[0]; this.prevPos[1] = b.pos[1]; this.prevPos[2] = b.pos[2];
    if (t && (t.kind === 'mob' ? !t.removed : !t.dead)) {
      const tp = t.pos;
      const dx = tp[0] - b.pos[0], dy = tp[1] + 1 - b.pos[1], dz = tp[2] - b.pos[2];
      const l = Math.hypot(dx, dy, dz) || 1;
      const sp = 5;
      b.vel[0] += ((dx / l) * sp - b.vel[0]) * 0.08;
      b.vel[1] += ((dy / l) * sp - b.vel[1]) * 0.08;
      b.vel[2] += ((dz / l) * sp - b.vel[2]) * 0.08;
    }
    const done = march(this, (hit) => {
      const sim = this.sim;
      if (hit && hit.kind === 'mob') { hit.hurt(4, b.pos, 0.2); sim.potionEffectMob(hit, 'levitation', 10, 0); }
      else if (hit) { if (sim.damagePlayer(hit.id, 4 * Math.max(sim.diff.damage, 0.5), 'shulker', b.pos)) sim.effectPlayer(hit.id, 'levitation', 10, 0); }
      sim.emit({ type: 'bulletPop', pos: b.pos.slice() });
    });
    if (done || this.age > 12) this.removed = true;
  }
}

// A firework rocket: rises (or, held while gliding, pushes its owner along), then bursts into
// coloured stars. Shot from a crossbow it flies straight and hurts what is near the burst.
export class Firework extends Entity {
  constructor(sim, id, owner, x, y, z, vel, { life = 1.4 + rnd() * 0.5, attached = false, colors = null, armed = false } = {}) {
    super(sim, id, 'firework');
    this.owner = owner;
    this.item = ITEM.FIREWORK_ROCKET;
    this.body = new Body(sim.world, 0.1, 0.2);
    this.body.pos = [x, y, z];
    this.body.vel = vel.slice();
    this.prevPos = [x, y, z];
    this.life = life;
    this.attached = attached; // boosting a gliding player: follows them
    this.armed = armed;
    this.colors = colors || randomColors();
  }

  update() {
    const b = this.body, sim = this.sim;
    this.age += TICK;
    this.prevPos[0] = b.pos[0]; this.prevPos[1] = b.pos[1]; this.prevPos[2] = b.pos[2];
    if (this.attached) {
      const p = sim.players.get(this.owner);
      if (!p) { this.removed = true; return; }
      b.pos = [p.pos[0], p.pos[1] + 0.9, p.pos[2]];
      if (this.age >= this.life) { this.removed = true; sim.emit({ type: 'fireworkEnd', owner: this.owner }); }
      return;
    }
    if (!this.armed) { b.vel[0] *= 1.02; b.vel[2] *= 1.02; b.vel[1] += 12 * TICK; }
    const hit = march(this, () => {});
    if (hit || this.age >= this.life) {
      this.removed = true;
      sim.emit({ type: 'fireworkBurst', pos: b.pos.slice(), colors: this.colors });
      if (this.armed) {
        for (const e of sim.entities.values()) {
          if (e.kind !== 'mob' || e.deathTime > 0) continue;
          const d = Math.hypot(e.body.pos[0] - b.pos[0], e.body.pos[1] + e.body.h / 2 - b.pos[1], e.body.pos[2] - b.pos[2]);
          if (d < 3) { e.hurt(7 * (1 - d / 4), b.pos, 0.6); if (typeof this.owner === 'string') e.lastAttacker = this.owner; }
        }
        for (const p of sim.players.values()) {
          if (p.id === this.owner) continue;
          const d = Math.hypot(p.pos[0] - b.pos[0], p.pos[1] + 0.9 - b.pos[1], p.pos[2] - b.pos[2]);
          if (d < 3) sim.damagePlayer(p.id, 7 * (1 - d / 4), 'firework', b.pos);
        }
      }
    } else if (this.age % 0.1 < TICK) sim.emit({ type: 'fireworkTrail', pos: b.pos.slice() });
  }
}

const PALETTE = [[255, 60, 60], [255, 170, 40], [255, 240, 80], [80, 230, 90], [60, 200, 255], [120, 110, 255], [240, 90, 230], [255, 255, 255]];
export function randomColors() {
  const n = 1 + Math.floor(rnd() * 2);
  const out = [];
  for (let i = 0; i < n; i++) out.push(PALETTE[Math.floor(rnd() * PALETTE.length)]);
  return out;
}

// The fishing rod's bobber: flies out, floats, and now and then a fish bites (it dips under); it
// can also hook a creature and drag it in.
export class Bobber extends Entity {
  constructor(sim, id, owner, x, y, z, vel, { lure = 0, luck = 0 } = {}) {
    super(sim, id, 'bobber');
    this.owner = owner;
    this.body = new Body(sim.world, 0.1, 0.2);
    this.body.pos = [x, y, z];
    this.body.vel = vel.slice();
    this.prevPos = [x, y, z];
    this.lure = lure;
    this.luck = luck;
    this.hooked = null; // a creature on the hook
    this.wait = null; // seconds until something bites
    this.bite = 0; // > 0 while a fish is biting (the moment to reel in)
    this.floating = false;
  }

  update() {
    const b = this.body, sim = this.sim, w = sim.world;
    this.age += TICK;
    this.prevPos[0] = b.pos[0]; this.prevPos[1] = b.pos[1]; this.prevPos[2] = b.pos[2];
    const owner = sim.players.get(this.owner);
    if (!owner || owner.dead || Math.hypot(owner.pos[0] - b.pos[0], owner.pos[1] - b.pos[1], owner.pos[2] - b.pos[2]) > 40) { this.removed = true; return; }
    if (this.hooked) {
      const h = this.hooked;
      if (h.removed || h.deathTime > 0) { this.hooked = null; return; }
      b.pos = [h.body.pos[0], h.body.pos[1] + h.body.h * 0.7, h.body.pos[2]];
      return;
    }
    const inWater = w.getBlock(Math.floor(b.pos[0]), Math.floor(b.pos[1]), Math.floor(b.pos[2])) === BLOCK.WATER;
    if (inWater) {
      // bob on the surface
      this.floating = true;
      const surf = Math.floor(b.pos[1]) + (w.getBlock(Math.floor(b.pos[0]), Math.floor(b.pos[1]) + 1, Math.floor(b.pos[2])) === BLOCK.WATER ? 1.9 : 0.9);
      b.vel[1] += ((surf - b.pos[1]) * 6 - b.vel[1]) * 0.3;
      b.vel[0] *= 0.8; b.vel[2] *= 0.8;
      if (this.wait === null) this.wait = (5 + rnd() * 25) * (1 - this.lure * 0.2);
      if (this.bite > 0) {
        this.bite -= TICK;
        if (this.bite <= 0) this.wait = (5 + rnd() * 25) * (1 - this.lure * 0.2);
      } else {
        this.wait -= TICK;
        if (this.wait <= 0) { this.bite = 0.9; sim.emit({ type: 'bite', owner: this.owner, pos: b.pos.slice() }); }
      }
      b.pos[0] += b.vel[0] * TICK; b.pos[1] += b.vel[1] * TICK; b.pos[2] += b.vel[2] * TICK;
      if (this.bite > 0) b.pos[1] -= 0.25; // dips under
      return;
    }
    this.floating = false;
    b.vel[1] -= 18 * TICK;
    b.vel[0] *= 0.99; b.vel[2] *= 0.99;
    march(this, (t) => {
      if (t && t.kind === 'mob' && !t.def.fixed) { this.hooked = t; t.hurt(0, b.pos, 0); }
      else if (!t) { b.vel = [0, 0, 0]; this.stuck = true; }
    }, { players: false });
    if (this.stuck) b.vel = [0, 0, 0];
    if (this.age > 60 && !inWater) this.removed = true;
  }
}

// Experience: drifts to the nearest player close by and is soaked up.
export class XpOrb extends Entity {
  constructor(sim, id, value, x, y, z) {
    super(sim, id, 'xp');
    this.value = value;
    this.body = new Body(sim.world, 0.12, 0.25);
    this.body.pos = [x, y, z];
    this.body.vel = [(rnd() - 0.5) * 3, 2.5 + rnd() * 2, (rnd() - 0.5) * 3];
    this.body.drag = 1.2;
    this.prevPos = [x, y, z];
    this.pickupDelay = 0.4;
  }

  update() {
    const b = this.body, sim = this.sim;
    this.age += TICK;
    this.prevPos[0] = b.pos[0]; this.prevPos[1] = b.pos[1]; this.prevPos[2] = b.pos[2];
    if (this.pickupDelay > 0) this.pickupDelay -= TICK;
    let best = null, bd = 8 * 8;
    for (const p of sim.players.values()) {
      if (p.dead || p.remote) continue;
      const d = (p.pos[0] - b.pos[0]) ** 2 + (p.pos[1] + 0.8 - b.pos[1]) ** 2 + (p.pos[2] - b.pos[2]) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    if (best && this.pickupDelay <= 0) {
      const dx = best.pos[0] - b.pos[0], dy = best.pos[1] + 0.8 - b.pos[1], dz = best.pos[2] - b.pos[2];
      const d = Math.sqrt(bd) || 1;
      const k = (1 - d / 8) ** 2 * 18;
      b.vel[0] += (dx / d) * k * TICK * 4; b.vel[1] += (dy / d) * k * TICK * 4; b.vel[2] += (dz / d) * k * TICK * 4;
      if (d < 0.9 && sim.pickupXp) {
        sim.pickupXp(best.id, this.value);
        sim.emit({ type: 'xp', id: best.id, pos: b.pos.slice() });
        this.removed = true;
        return;
      }
    }
    b.step(TICK, null, false, { swim: true });
    if (b.inWater) b.vel[1] += 0.6;
    if (this.age > 300 || b.pos[1] < -20) this.removed = true;
  }
}

export { IS_SOLID };
