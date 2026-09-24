// Axis-aligned box physics for creatures, dropped items and arrows: gravity, swimming,
// collision against the voxel grid, and stepping up single blocks while walking.

import { IS_LIQUID, BLOCK } from '../world/blocks.js';

const EPS = 1e-4;

export class Body {
  // hw: half width, h: height
  constructor(world, hw = 0.3, h = 1.8) {
    this.world = world;
    this.hw = hw;
    this.h = h;
    this.pos = [0, 0, 0];
    this.vel = [0, 0, 0];
    this.onGround = false;
    this.inWater = false;
    this.inLava = false;
    this.headInWater = false;
    this.hitWall = false;
    this.fallDistance = 0;
    this.gravity = 28;
    this.drag = 0; // extra horizontal damping in the air (items)
  }

  collides(px, py, pz) {
    const w = this.world, hw = this.hw;
    const x0 = Math.floor(px - hw + EPS), x1 = Math.floor(px + hw - EPS);
    const y0 = Math.floor(py + EPS), y1 = Math.floor(py + this.h - EPS);
    const z0 = Math.floor(pz - hw + EPS), z1 = Math.floor(pz + hw - EPS);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++)
          if (w.isSolidAt(x, y, z)) return true;
    return false;
  }

  moveAxis(axis, amount) {
    if (amount === 0) return false;
    const p = this.pos;
    const steps = Math.ceil(Math.abs(amount) / 0.4);
    const inc = amount / steps;
    for (let s = 0; s < steps; s++) {
      const orig = p[axis];
      p[axis] = orig + inc;
      if (this.collides(p[0], p[1], p[2])) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          p[axis] = orig + inc * mid;
          if (this.collides(p[0], p[1], p[2])) hi = mid; else lo = mid;
        }
        p[axis] = orig + inc * lo;
        return true;
      }
    }
    return false;
  }

  blockAt(x, y, z) {
    return this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  // wish: desired horizontal velocity [vx, vz]; jump: try to jump this step
  step(dt, wish = null, jump = false, opts = {}) {
    const p = this.pos, v = this.vel;
    if (this.collides(p[0], p[1], p[2])) { p[1] = Math.floor(p[1]) + 1 + EPS; v[1] = Math.max(v[1], 0); }
    const feet = this.blockAt(p[0], p[1] + 0.1, p[2]);
    const mid = this.blockAt(p[0], p[1] + this.h * 0.5, p[2]);
    this.inWater = IS_LIQUID[feet] === 1 && feet !== BLOCK.LAVA || IS_LIQUID[mid] === 1 && mid !== BLOCK.LAVA;
    this.inLava = feet === BLOCK.LAVA || mid === BLOCK.LAVA;
    this.headInWater = this.blockAt(p[0], p[1] + this.h * 0.85, p[2]) === BLOCK.WATER;
    if (wish) {
      const control = this.onGround ? 14 : this.inWater ? 5 : 2;
      const k = 1 - Math.exp(-dt * control);
      v[0] += (wish[0] - v[0]) * k;
      v[2] += (wish[1] - v[2]) * k;
    } else if (this.onGround) {
      const k = Math.exp(-dt * 10);
      v[0] *= k; v[2] *= k;
    } else if (this.drag) {
      const k = Math.exp(-dt * this.drag);
      v[0] *= k; v[2] *= k;
    }
    if (this.inWater || this.inLava) {
      v[1] -= this.gravity * 0.2 * dt;
      // creatures paddle to keep their head above water
      if (opts.swim && (this.headInWater || this.inLava)) v[1] += 30 * dt;
      v[1] *= Math.exp(-dt * 3);
      v[1] = Math.max(-4, Math.min(3, v[1]));
    } else {
      v[1] -= this.gravity * dt;
      if (v[1] < -60) v[1] = -60;
    }
    if (jump && this.onGround) v[1] = opts.jumpV || 8.4;
    if (jump && this.inWater && this.hitWall) v[1] = Math.max(v[1], 5);

    const wasGround = this.onGround;
    const vyBefore = v[1];
    const by = this.moveAxis(1, v[1] * dt);
    if (by) { this.onGround = v[1] < 0; v[1] = 0; } else this.onGround = false;
    const bx = this.moveAxis(0, v[0] * dt);
    const bz = this.moveAxis(2, v[2] * dt);
    if (bx) v[0] = 0;
    if (bz) v[2] = 0;
    this.hitWall = bx || bz;
    // falling: accumulate distance, report the landing speed
    let landed = 0;
    if (!this.onGround && v[1] < 0 && !this.inWater) this.fallDistance -= vyBefore * dt;
    if (this.inWater) this.fallDistance = 0;
    if (this.onGround && !wasGround) { landed = this.fallDistance; this.fallDistance = 0; }
    return landed;
  }

  // Is there a solid block ahead at knee height with room above it (worth jumping)?
  blockedAhead(dirX, dirZ) {
    const p = this.pos;
    const ax = p[0] + dirX * (this.hw + 0.35), az = p[2] + dirZ * (this.hw + 0.35);
    const y = Math.floor(p[1] + 0.5);
    const w = this.world;
    return w.isSolidAt(Math.floor(ax), y, Math.floor(az)) &&
      !w.isSolidAt(Math.floor(ax), y + 1, Math.floor(az)) &&
      (this.h <= 1 || !w.isSolidAt(Math.floor(ax), y + 2, Math.floor(az)));
  }

  intersects(o) {
    return this.pos[0] + this.hw > o.pos[0] - o.hw && this.pos[0] - this.hw < o.pos[0] + o.hw &&
      this.pos[1] + this.h > o.pos[1] && this.pos[1] < o.pos[1] + o.h &&
      this.pos[2] + this.hw > o.pos[2] - o.hw && this.pos[2] - this.hw < o.pos[2] + o.hw;
  }
}

// Ray against an entity's box; returns the distance or null.
export function rayHitsBox(o, d, box, maxDist) {
  let t0 = 0, t1 = maxDist;
  for (let i = 0; i < 3; i++) {
    const lo = box[i], hi = box[i + 3];
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo || o[i] > hi) return null;
    } else {
      let a = (lo - o[i]) / d[i], b = (hi - o[i]) / d[i];
      if (a > b) { const t = a; a = b; b = t; }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) return null;
    }
  }
  return t0;
}
