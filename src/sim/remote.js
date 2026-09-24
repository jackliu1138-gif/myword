// A creature simulated on another player's machine, as this game sees it: it follows the
// snapshots that player sends (smoothed at the tick rate), shows hits right away and passes them on
// to its owner. It lives in the local Simulation so it is drawn, heard and hittable like the rest,
// but it never thinks, spawns, despawns or takes part in explosions here.

import { MOBS, TICK } from './entities.js';

export const MOB_TYPES = Object.keys(MOBS);

const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

// Snapshot of one of our own creatures for the other players:
// [id, type, x, y, z (1/16 block), yaw, head yaw (1/100 rad), flags, variant, fuse (1/10 s)]
export function mobSnapshot(e) {
  const b = e.body;
  const flags = (e.deathTime > 0 ? 1 : 0) | (e.hurtTime > 0.2 ? 2 : 0) | (e.burning > 0 ? 4 : 0) | (e.mode === 'chase' ? 8 : 0) | (e.swing > 0 ? 16 : 0);
  return [e.id, MOB_TYPES.indexOf(e.type), Math.round(b.pos[0] * 16), Math.round(b.pos[1] * 16), Math.round(b.pos[2] * 16),
    Math.round(e.yaw * 100), Math.round((e.headYaw ?? e.yaw) * 100), flags, e.variant || 0, Math.round((e.fuse || 0) * 10)];
}

export class RemoteMob {
  constructor(sim, id, owner, rid, type) {
    const d = MOBS[type];
    this.sim = sim;
    this.id = id;
    this.owner = owner;
    this.rid = rid;
    this.kind = 'mob';
    this.ghost = true;
    this.type = type;
    this.def = d;
    this.body = { pos: [0, 0, 0], vel: [0, 0, 0], hw: d.hw, h: d.h, onGround: true, inWater: false };
    this.prevPos = [0, 0, 0];
    this.goal = null;
    this.yaw = 0;
    this.prevYaw = 0;
    this.goalYaw = 0;
    this.headYaw = 0;
    this.goalHeadYaw = 0;
    this.headPitch = 0;
    this.walkPhase = 0;
    this.walkAmount = 0;
    this.hurtTime = 0;
    this.deathTime = 0;
    this.fuse = 0;
    this.burning = 0;
    this.variant = 0;
    this.mode = 'idle';
    this.swing = 0;
    this.health = d.health;
    this.age = 0;
    this.stale = 0;
    this.removed = false;
  }

  get pos() { return this.body.pos; }
  get hostile() { return !!this.def.hostile; }
  get eyePos() { return [this.body.pos[0], this.body.pos[1] + this.def.eye, this.body.pos[2]]; }

  apply(s) {
    const x = s[2] / 16, y = s[3] / 16, z = s[4] / 16;
    const p = this.body.pos;
    if (!this.goal || Math.abs(x - p[0]) + Math.abs(y - p[1]) + Math.abs(z - p[2]) > 12) {
      p[0] = x; p[1] = y; p[2] = z;
      this.prevPos = p.slice();
      this.yaw = this.prevYaw = s[5] / 100;
    }
    this.goal = [x, y, z];
    this.goalYaw = s[5] / 100;
    this.goalHeadYaw = s[6] / 100;
    const f = s[7] | 0;
    if (f & 1) this.deathTime = Math.max(this.deathTime, 0.001); else this.deathTime = 0;
    if (f & 2) this.hurtTime = Math.max(this.hurtTime, 0.3);
    this.burning = f & 4 ? 1 : 0;
    this.mode = f & 8 ? 'chase' : 'idle';
    if (f & 16) this.swing = Math.max(this.swing, 0.4);
    this.variant = s[8] | 0;
    this.fuse = (s[9] | 0) / 10;
    this.stale = 0;
  }

  update() {
    this.age += TICK;
    this.stale += TICK;
    const p = this.body.pos;
    this.prevPos[0] = p[0]; this.prevPos[1] = p[1]; this.prevPos[2] = p[2];
    this.prevYaw = this.yaw;
    if (this.goal) {
      const k = 0.35;
      const dx = (this.goal[0] - p[0]) * k, dz = (this.goal[2] - p[2]) * k;
      p[0] += dx; p[1] += (this.goal[1] - p[1]) * k; p[2] += dz;
      const speed = Math.hypot(dx, dz) / TICK;
      this.walkAmount += (Math.min(1, speed / 2.5) - this.walkAmount) * 0.3;
      this.walkPhase += speed * TICK * 2.6;
      this.body.onGround = Math.abs(this.goal[1] - p[1]) < 0.3;
    }
    this.yaw = lerpAngle(this.yaw, this.goalYaw, 0.4);
    this.headYaw = lerpAngle(this.headYaw, this.goalHeadYaw, 0.4);
    if (this.hurtTime > 0) this.hurtTime -= TICK;
    if (this.swing > 0) this.swing -= TICK;
    if (this.deathTime > 0) this.deathTime += TICK;
    if (this.stale > 1.5) this.removed = true; // its owner stopped reporting it
  }

  // Hit by our player or an arrow of ours: flash now, let the owner work out the damage.
  hurt(amount, from) {
    if (this.deathTime > 0 || this.hurtTime > 0.35) return false;
    this.hurtTime = 0.5;
    if (this.sim.onGhostHit) this.sim.onGhostHit(this, amount, from ? [from[0], from[1], from[2]] : null);
    return true;
  }
}
