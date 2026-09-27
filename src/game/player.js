// First-person player: movement, collision against the voxel grid, swimming and flight.

import { IS_SOLID, IS_LIQUID, BLOCKS, SELECT_BOX, MODEL_OF, modelSelectBox } from '../world/blocks.js';

const HALF_W = 0.3;
const HEIGHT = 1.8;
const EYE = 1.62;
const SNEAK_EYE = 1.32;
const GRAVITY = 28;
const JUMP_V = 8.6;
const EPS = 1e-4;
const STEP_UP = 0.6; // slabs and stairs are walked up without jumping
const CLIMB_V = 2.4;

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
    this.stepSmooth = 0; // the camera eases up steps instead of jumping
    this.onLadder = false;
    this.onStep = null; // callback(blockBelow)
    this.onLand = null;
    this.onSplash = null;
    this.onWallHit = null; // (speed lost) flying into a wall on elytra
    // effects on movement (from potions): { speed, jump, levitate, slowFall }
    this.fx = null;
    this.canGlide = false; // wearing elytra
    this.gliding = false;
    this.boost = 0; // seconds of firework push left
    this.riding = null; // the creature or vehicle being ridden
    this.jumped = false;
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

  // Returns true when the player box overlaps anything solid (slabs, fences and doors by their shape).
  collides(px, py, pz) {
    return this.world.boxCollides(px - HALF_W + EPS, py + EPS, pz - HALF_W + EPS, px + HALF_W - EPS, py + HEIGHT - EPS, pz + HALF_W - EPS);
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

  // Walking along one axis, stepping up onto slabs and stairs (anything up to STEP_UP high).
  moveStep(axis, amount, canStep) {
    const p = this.pos;
    const start = p[axis], y = p[1];
    const blocked = this.moveAxis(axis, amount);
    if (!blocked || !canStep) return blocked;
    const plain = p[axis];
    p[axis] = start;
    p[1] = y + STEP_UP;
    if (this.collides(p[0], p[1], p[2])) { p[1] = y; p[axis] = plain; return blocked; }
    const blocked2 = this.moveAxis(axis, amount);
    if (Math.abs(p[axis] - start) <= Math.abs(plain - start) + 1e-3) { p[1] = y; p[axis] = plain; return blocked; }
    this.moveAxis(1, -STEP_UP - EPS);
    this.stepSmooth -= p[1] - y;
    return blocked2;
  }

  groundUnder(px, pz) {
    const y = this.pos[1];
    return this.world.boxCollides(px - HALF_W + EPS, y - 0.08, pz - HALF_W + EPS, px + HALF_W - EPS, y - EPS, pz + HALF_W - EPS);
  }

  blockAt(x, y, z) {
    return this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  update(dt, ctl) {
    // ctl: { forward, strafe, jump, sneak, sprint, toggleFly }
    dt = Math.min(dt, 0.05);
    // riding: the vehicle moves; the game puts us in its seat
    if (this.riding) {
      this.gliding = false;
      this.vel = [0, 0, 0];
      this.onGround = true;
      this.fallStart = null;
      this.eyeHeight += (EYE - this.eyeHeight) * (1 - Math.exp(-dt * 14));
      return;
    }
    if (this.gliding) { this.glide(dt, ctl); return; }
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
    // on a ladder: climb while pushing into it (or holding jump), hold on while sneaking, slide down slowly
    this.onLadder = !this.flying && (this.world.climbableAt(this.pos[0], this.pos[1] + 0.05, this.pos[2]) || this.world.climbableAt(this.pos[0], this.pos[1] + 0.9, this.pos[2]));
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
    if (this.fx && !this.flying) speed *= Math.max(0.15, this.fx.speed);

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
    } else if (this.onLadder) {
      this.vel[1] -= GRAVITY * dt;
      if (ctl.jump || (this.touchingWall && len > 0.1)) this.vel[1] = CLIMB_V;
      else if (this.sneaking) this.vel[1] = Math.max(this.vel[1], 0);
      else this.vel[1] = Math.max(this.vel[1], -3);
      this.fallStart = null;
    } else {
      const fx = this.fx;
      if (fx && fx.levitate) this.vel[1] += (fx.levitate * 1.9 - this.vel[1]) * (1 - Math.exp(-dt * 4));
      else this.vel[1] -= GRAVITY * dt;
      if (fx && fx.slowFall && this.vel[1] < -2) this.vel[1] = -2;
      if (this.vel[1] < -60) this.vel[1] = -60;
      if (ctl.jump && this.onGround) {
        this.vel[1] = JUMP_V * (fx ? Math.sqrt(fx.jump) : 1);
        this.jumped = true;
        if (this.sprinting) {
          this.vel[0] += wishX * 1.2;
          this.vel[2] += wishZ * 1.2;
        }
      }
      // wearing elytra: jump again in the air to spread them
      if (ctl.jumpPressed && !this.onGround && this.canGlide && this.vel[1] < 1 && !this.onLadder) {
        this.gliding = true;
        this.fallStart = null;
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
    const canStep = (this.onGround || wasGround) && !this.flying;
    const bx = this.moveStep(0, this.vel[0] * dt, canStep);
    if (sneakGuard && !this.groundUnder(this.pos[0], this.pos[2])) { this.pos[0] = oldX; this.vel[0] = 0; }
    const bz = this.moveStep(2, this.vel[2] * dt, canStep);
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

    this.stepSmooth *= Math.exp(-dt * 14);
    if (Math.abs(this.stepSmooth) < 1e-3) this.stepSmooth = 0;
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

  // Gliding on elytra: the pitch trades height for speed and back; fireworks push along the way
  // you look. Per tick (20 a second), in the usual numbers: gravity -0.08 less a lift of up to
  // 0.06 with the wings level, sinking turns into forward speed, climbing costs it, drag 1-2%.
  glide(dt, ctl) {
    const k = dt * 20; // ticks this step
    const v = this.vel;
    const look = this.forward();
    const pitch = this.pitch;
    const hl = Math.hypot(look[0], look[2]) || 1e-4;
    // blocks per tick
    let vx = v[0] / 20, vy = v[1] / 20, vz = v[2] / 20;
    const hv = Math.hypot(vx, vz);
    const cos2 = Math.cos(pitch) ** 2;
    vy += (-0.08 + cos2 * 0.06) * k;
    if (vy < 0 && hl > 0) {
      const lift = vy * -0.1 * cos2 * k;
      vx += (look[0] / hl) * lift; vy += lift; vz += (look[2] / hl) * lift;
    }
    if (pitch > 0 && hl > 0) {
      const climb = hv * Math.sin(pitch) * 0.04 * k;
      vx -= (look[0] / hl) * climb; vy += climb * 3.2; vz -= (look[2] / hl) * climb;
    }
    const steer = 1 - Math.pow(0.9, k);
    vx += ((look[0] / hl) * hv - vx) * steer;
    vz += ((look[2] / hl) * hv - vz) * steer;
    vx *= Math.pow(0.99, k); vy *= Math.pow(0.98, k); vz *= Math.pow(0.99, k);
    if (this.boost > 0) {
      // a firework rocket: towards 1.7 blocks a tick along the look
      this.boost -= dt;
      const b = 1 - Math.pow(0.5, k);
      vx += (look[0] * 1.7 - vx) * b; vy += (look[1] * 1.7 - vy) * b; vz += (look[2] * 1.7 - vz) * b;
    }
    v[0] = vx * 20; v[1] = vy * 20; v[2] = vz * 20;
    const before = Math.hypot(v[0], v[2]);
    const by = this.moveAxis(1, v[1] * dt);
    if (by) { this.onGround = v[1] < 0; v[1] = 0; }
    const bx = this.moveAxis(0, v[0] * dt), bz = this.moveAxis(2, v[2] * dt);
    if (bx) v[0] = 0;
    if (bz) v[2] = 0;
    const lost = before - Math.hypot(v[0], v[2]);
    if ((bx || bz) && lost > 6 && this.onWallHit) this.onWallHit(lost);
    const feet = this.blockAt(this.pos[0], this.pos[1] + 0.1, this.pos[2]);
    this.inWater = IS_LIQUID[feet] === 1;
    this.headInWater = false;
    if (this.onGround || this.inWater || !this.canGlide || this.flying || ctl.sneak) {
      this.gliding = false;
      if (this.onGround && this.onLand) this.onLand(Math.min(-v[1], 10), this.blockAt(this.pos[0], this.pos[1] - 0.2, this.pos[2]));
    }
    this.eyeHeight += (0.6 - this.eyeHeight) * (1 - Math.exp(-dt * 10));
    this.bobAmount *= Math.exp(-dt * 8);
  }

  // Would placing a block at (x,y,z) intersect the player?
  intersectsBlock(x, y, z) {
    return this.pos[0] + HALF_W > x && this.pos[0] - HALF_W < x + 1 &&
      this.pos[1] + HEIGHT > y && this.pos[1] < y + 1 &&
      this.pos[2] + HALF_W > z && this.pos[2] - HALF_W < z + 1;
  }
}

// Voxel ray traversal (Amanatides & Woo). Returns the first selectable block (and, with
// { liquids: true }, the first liquid source: buckets pick those up).

// Ray against a box: [distance, normal of the face it enters through] or null.
function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let t0 = -Infinity, t1 = Infinity, axis = -1;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < b[i] || o[i] > b[i + 3]) return null;
    } else {
      let a = (b[i] - o[i]) / d[i], c = (b[i + 3] - o[i]) / d[i];
      if (a > c) { const t = a; a = c; c = t; }
      if (a > t0) { t0 = a; axis = i; }
      t1 = Math.min(t1, c);
    }
  }
  if (t1 < Math.max(t0, 0)) return null;
  const n = [0, 0, 0];
  if (axis >= 0) n[axis] = d[axis] > 0 ? -1 : 1;
  return [t0, n];
}

export function raycast(world, origin, dir, maxDist, opts = null) {
  const liquids = !!(opts && opts.liquids);
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
    if (liquids && IS_LIQUID[b] && world.getState(x, y, z) === 0) {
      return { x, y, z, block: b, normal: [nx, ny, nz], t, box: [x, y, z, x + 1, y + 0.875, z + 1], liquid: true };
    }
    if (b && BLOCKS[b].selectable) {
      const cx = x, cy = y, cz = z;
      const box = MODEL_OF[b]
        ? modelSelectBox(b, world.getState(x, y, z), (dx, dy, dz) => world.getBlock(cx + dx, cy + dy, cz + dz), (dx, dy, dz) => world.getState(cx + dx, cy + dy, cz + dz))
        : SELECT_BOX[b];
      if (!box) {
        return { x, y, z, block: b, normal: [nx, ny, nz], t, box: [x, y, z, x + 1, y + 1, z + 1], point: [ox + dx * t, oy + dy * t, oz + dz * t] };
      }
      const bb = [x + box[0], y + box[1], z + box[2], x + box[3], y + box[4], z + box[5]];
      const r = rayBox(ox, oy, oz, dx, dy, dz, bb);
      if (r && r[0] <= maxDist) {
        const th = Math.max(0, r[0]);
        const inside = r[0] <= 0 || (r[1][0] === 0 && r[1][1] === 0 && r[1][2] === 0);
        return { x, y, z, block: b, normal: inside ? [nx, ny, nz] : r[1], t: th, box: bb, point: [ox + dx * th, oy + dy * th, oz + dz * th] };
      }
    }
    if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
    else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
    else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
  }
  return null;
}

export { IS_SOLID };
