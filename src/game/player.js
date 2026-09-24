// First-person player: movement, collision against the voxel grid, swimming and flight.

import { IS_SOLID, IS_LIQUID, BLOCKS, SHAPE } from '../world/blocks.js';

const HALF_W = 0.3;
const HEIGHT = 1.8;
const EYE = 1.62;
const SNEAK_EYE = 1.32;
const GRAVITY = 28;
const JUMP_V = 8.6;
const EPS = 1e-4;

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = [0.5, 80, 0.5];
    this.vel = [0, 0, 0];
    this.yaw = 0; // 0 looks towards -Z
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.inWater = false;
    this.headInWater = false;
    this.sprinting = false;
    this.sneaking = false;
    this.eyeHeight = EYE;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.stepAccum = 0;
    this.fallStart = null;
    this.onStep = null; // callback(blockBelow)
    this.onLand = null;
    this.onSplash = null;
  }

  get eye() {
    return [this.pos[0], this.pos[1] + this.eyeHeight, this.pos[2]];
  }

  forward() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  look(dx, dy, sensitivity, invert) {
    const k = 0.0022 * sensitivity;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (invert ? -1 : 1);
    const lim = Math.PI / 2 - 0.001;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
  }

  solidAt(x, y, z) {
    return this.world.isSolidAt(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  // Returns true when the player box overlaps any solid block.
  collides(px, py, pz) {
    const x0 = Math.floor(px - HALF_W + EPS), x1 = Math.floor(px + HALF_W - EPS);
    const y0 = Math.floor(py + EPS), y1 = Math.floor(py + HEIGHT - EPS);
    const z0 = Math.floor(pz - HALF_W + EPS), z1 = Math.floor(pz + HALF_W - EPS);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++)
          if (this.world.isSolidAt(x, y, z)) return true;
    return false;
  }

  // Move along one axis, stopping flush against the first solid block. Returns true if blocked.
  moveAxis(axis, amount) {
    if (amount === 0) return false;
    const p = this.pos;
    const steps = Math.ceil(Math.abs(amount) / 0.45);
    const inc = amount / steps;
    for (let s = 0; s < steps; s++) {
      const orig = p[axis];
      p[axis] = orig + inc;
      if (this.collides(p[0], p[1], p[2])) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 10; i++) {
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

  groundUnder(px, pz) {
    const y = Math.floor(this.pos[1] - 0.05);
    const x0 = Math.floor(px - HALF_W + EPS), x1 = Math.floor(px + HALF_W - EPS);
    const z0 = Math.floor(pz - HALF_W + EPS), z1 = Math.floor(pz + HALF_W - EPS);
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++)
        if (this.world.isSolidAt(x, y, z)) return true;
    return false;
  }

  blockAt(x, y, z) {
    return this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  update(dt, ctl) {
    // ctl: { forward, strafe, jump, sneak, sprint, toggleFly }
    dt = Math.min(dt, 0.05);
    // pushed out if something ended up inside the player (e.g. terrain loaded around them)
    if (this.collides(this.pos[0], this.pos[1], this.pos[2])) {
      this.pos[1] = Math.floor(this.pos[1]) + 1 + EPS;
      this.vel[1] = Math.max(this.vel[1], 0);
    }
    if (ctl.toggleFly) {
      this.flying = !this.flying;
      if (this.flying) this.vel[1] = Math.max(this.vel[1], 0);
    }
    const feet = this.blockAt(this.pos[0], this.pos[1] + 0.1, this.pos[2]);
    const waist = this.blockAt(this.pos[0], this.pos[1] + 0.8, this.pos[2]);
    const wasInWater = this.inWater;
    this.inWater = IS_LIQUID[feet] === 1 || IS_LIQUID[waist] === 1;
    const eyeBlock = this.blockAt(this.pos[0], this.pos[1] + this.eyeHeight, this.pos[2]);
    this.headInWater = BLOCKS[eyeBlock].key === 'water';
    if (this.inWater && !wasInWater && this.vel[1] < -4 && this.onSplash) this.onSplash();

    this.sneaking = ctl.sneak && !this.flying;
    if (ctl.sprint && ctl.forward > 0 && !this.sneaking) this.sprinting = true;
    if (ctl.forward <= 0 || this.sneaking) this.sprinting = false;

    // wish direction in the horizontal plane
    let fx = ctl.forward, sx = ctl.strafe;
    const len = Math.hypot(fx, sx);
    if (len > 1) { fx /= len; sx /= len; }
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    const wishX = -sinY * fx + cosY * sx;
    const wishZ = -cosY * fx - sinY * sx;

    let speed;
    if (this.flying) speed = this.sprinting ? 22 : 11;
    else if (this.inWater) speed = this.sprinting ? 3.4 : 2.4;
    else if (this.sneaking) speed = 1.35;
    else speed = this.sprinting ? 5.6 : 4.32;

    const control = this.flying ? 7 : this.onGround ? 18 : this.inWater ? 6 : 2.2;
    const k = 1 - Math.exp(-dt * control);
    this.vel[0] += (wishX * speed - this.vel[0]) * k;
    this.vel[2] += (wishZ * speed - this.vel[2]) * k;

    if (this.flying) {
      const vy = (ctl.jump ? 1 : 0) - (ctl.sneak ? 1 : 0);
      this.vel[1] += (vy * (this.sprinting ? 12 : 8) - this.vel[1]) * (1 - Math.exp(-dt * 8));
    } else if (this.inWater) {
      this.vel[1] -= GRAVITY * 0.18 * dt;
      if (ctl.jump) this.vel[1] += 22 * dt;
      this.vel[1] *= Math.exp(-dt * 2.8);
      if (this.vel[1] > 3.2) this.vel[1] = 3.2;
      if (this.vel[1] < -5) this.vel[1] = -5;
      // hop out at the shore
      if (ctl.jump && this.touchingWall && !this.headInWater) this.vel[1] = Math.max(this.vel[1], 5.5);
    } else {
      this.vel[1] -= GRAVITY * dt;
      if (this.vel[1] < -60) this.vel[1] = -60;
      if (ctl.jump && this.onGround) {
        this.vel[1] = JUMP_V;
        if (this.sprinting) {
          this.vel[0] += wishX * 1.2;
          this.vel[2] += wishZ * 1.2;
        }
      }
    }

    // integrate with collisions
    const oldX = this.pos[0], oldZ = this.pos[2];
    const wasGround = this.onGround;
    const vyBefore = this.vel[1];
    let blockedY = this.moveAxis(1, this.vel[1] * dt);
    if (blockedY) {
      this.onGround = this.vel[1] < 0;
      this.vel[1] = 0;
    } else {
      this.onGround = false;
    }
    const sneakGuard = this.sneaking && wasGround;
    const bx = this.moveAxis(0, this.vel[0] * dt);
    if (sneakGuard && !this.groundUnder(this.pos[0], this.pos[2])) { this.pos[0] = oldX; this.vel[0] = 0; }
    const bz = this.moveAxis(2, this.vel[2] * dt);
    if (sneakGuard && !this.groundUnder(this.pos[0], this.pos[2])) { this.pos[2] = oldZ; this.vel[2] = 0; }
    if (bx) this.vel[0] = 0;
    if (bz) this.vel[2] = 0;
    this.touchingWall = bx || bz;
    if (this.onGround && !wasGround) {
      if (this.flying) this.flying = false;
      if (this.onLand) this.onLand(-vyBefore, this.blockAt(this.pos[0], this.pos[1] - 0.2, this.pos[2]));
    }
    // step-up assist for single blocks while holding forward against a wall (auto-jump)
    if (this.touchingWall && this.onGround && !this.flying && !this.inWater && len > 0.1 && ctl.autoJump) {
      const aheadX = this.pos[0] + wishX * 0.45, aheadZ = this.pos[2] + wishZ * 0.45;
      const yb = Math.floor(this.pos[1] + 0.5);
      if (this.world.isSolidAt(Math.floor(aheadX), yb, Math.floor(aheadZ)) &&
          !this.world.isSolidAt(Math.floor(aheadX), yb + 1, Math.floor(aheadZ)) &&
          !this.world.isSolidAt(Math.floor(aheadX), yb + 2, Math.floor(aheadZ)) &&
          !this.world.isSolidAt(Math.floor(this.pos[0]), Math.floor(this.pos[1] + 2.2), Math.floor(this.pos[2]))) {
        this.vel[1] = JUMP_V * 0.95;
      }
    }

    // eye height (sneak lowers the camera smoothly)
    const targetEye = this.sneaking ? SNEAK_EYE : EYE;
    this.eyeHeight += (targetEye - this.eyeHeight) * (1 - Math.exp(-dt * 14));

    // view bobbing and footsteps
    const hs = Math.hypot(this.vel[0], this.vel[2]);
    const moving = this.onGround && hs > 0.3;
    this.bobAmount += ((moving ? Math.min(hs / 5, 1.2) : 0) - this.bobAmount) * (1 - Math.exp(-dt * 8));
    if (moving) {
      this.bobPhase += hs * dt * 1.9;
      this.stepAccum += hs * dt;
      if (this.stepAccum > (this.sprinting ? 2.2 : 1.8)) {
        this.stepAccum = 0;
        if (this.onStep) this.onStep(this.blockAt(this.pos[0], this.pos[1] - 0.2, this.pos[2]));
      }
    } else if (this.inWater && hs > 0.5) {
      this.stepAccum += hs * dt;
      if (this.stepAccum > 2.5) { this.stepAccum = 0; if (this.onStep) this.onStep(-1); }
    }
  }

  // Would placing a block at (x,y,z) intersect the player?
  intersectsBlock(x, y, z) {
    return this.pos[0] + HALF_W > x && this.pos[0] - HALF_W < x + 1 &&
      this.pos[1] + HEIGHT > y && this.pos[1] < y + 1 &&
      this.pos[2] + HALF_W > z && this.pos[2] - HALF_W < z + 1;
  }
}

// Voxel ray traversal (Amanatides & Woo). Returns the first selectable block.
const SELECT_BOX = {
  [SHAPE.CROSS]: [0.15, 0, 0.15, 0.85, 0.85, 0.85],
  [SHAPE.TORCH]: [0.375, 0, 0.375, 0.625, 0.65, 0.625],
};

function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let t0 = -Infinity, t1 = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < b[i] || o[i] > b[i + 3]) return null;
    } else {
      let a = (b[i] - o[i]) / d[i], c = (b[i + 3] - o[i]) / d[i];
      if (a > c) { const t = a; a = c; c = t; }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
    }
  }
  return t1 >= Math.max(t0, 0) ? t0 : null;
}

export function raycast(world, origin, dir, maxDist) {
  let [ox, oy, oz] = origin;
  const [dx, dy, dz] = dir;
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = Math.abs(1 / dx), tdy = Math.abs(1 / dy), tdz = Math.abs(1 / dz);
  let tmx = dx === 0 ? Infinity : (dx > 0 ? x + 1 - ox : ox - x) * tdx;
  let tmy = dy === 0 ? Infinity : (dy > 0 ? y + 1 - oy : oy - y) * tdy;
  let tmz = dz === 0 ? Infinity : (dz > 0 ? z + 1 - oz : oz - z) * tdz;
  let nx = 0, ny = 0, nz = 0, t = 0;
  for (let i = 0; i < 64 && t <= maxDist; i++) {
    const b = world.getBlock(x, y, z);
    if (b && BLOCKS[b].selectable) {
      const shape = BLOCKS[b].shape;
      const box = SELECT_BOX[shape];
      if (!box) {
        return { x, y, z, block: b, normal: [nx, ny, nz], t, box: [x, y, z, x + 1, y + 1, z + 1] };
      }
      const bb = [x + box[0], y + box[1], z + box[2], x + box[3], y + box[4], z + box[5]];
      const th = rayBox(ox, oy, oz, dx, dy, dz, bb);
      if (th !== null && th <= maxDist) return { x, y, z, block: b, normal: [nx, ny, nz], t: th, box: bb };
    }
    if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
    else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
    else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
  }
  return null;
}

export { IS_SOLID };
