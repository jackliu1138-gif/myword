// The Ender Dragon: circles the End's obsidian pillars, swoops at players, now and then lands on
// the exit fountain in the middle (the best moment to hit it), and heals from the end crystals on
// top of the pillars until they are destroyed. 200 health.

import { Mob, TICK } from './entities.js';

export const DRAGON_PERCH = [0.5, 67, 0.5];

export class EnderDragon extends Mob {
  constructor(sim, id, x, y, z, health = 0) {
    super(sim, id, 'ender_dragon', x, y, z);
    if (health > 0) this.health = Math.min(this.def.health, health);
    this.phase = 'circle';
    this.phaseTime = 6 + Math.random() * 6;
    this.angle = Math.atan2(z, x);
    this.flap = 0;
    this.contactCooldown = 0;
    this.healFrom = null;
    this.body.vel = [0, 0, 0];
  }

  nearestCrystal() {
    let best = null, bd = 64 * 64;
    const p = this.body.pos;
    for (const e of this.sim.entities.values()) {
      if (e.type !== 'end_crystal' || e.removed || e.deathTime > 0) continue;
      const d = (e.body.pos[0] - p[0]) ** 2 + (e.body.pos[1] - p[1]) ** 2 + (e.body.pos[2] - p[2]) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  pickTarget() {
    return this.sim.nearestTarget(this, this.def.follow);
  }

  update() {
    const b = this.body;
    this.age += TICK;
    this.prevPos[0] = b.pos[0]; this.prevPos[1] = b.pos[1]; this.prevPos[2] = b.pos[2];
    this.prevYaw = this.yaw;
    if (this.hurtTime > 0) this.hurtTime -= TICK;
    if (this.contactCooldown > 0) this.contactCooldown -= TICK;
    if (this.deathTime > 0) {
      // rises, shaking, and bursts into light
      this.deathTime += TICK;
      b.pos[1] += TICK * 1.6;
      if (this.deathTime > 4.5) { this.removed = true; this.sim.emit({ type: 'dragonGone', pos: b.pos.slice() }); }
      return;
    }
    this.flap += TICK * (this.phase === 'perch' && this.landed ? 1.2 : 3.4);
    const crystal = this.nearestCrystal();
    this.healFrom = crystal ? crystal.body.pos.slice() : null;
    if (crystal && this.health < this.def.health && this.age % 0.5 < TICK) this.health = Math.min(this.def.health, this.health + 1);

    this.phaseTime -= TICK;
    const player = this.pickTarget();
    this.target = player;
    let goal, speed;
    if (this.phase === 'charge' && player) {
      goal = [player.pos[0], player.pos[1] + 1.2, player.pos[2]];
      speed = 21;
      if (this.phaseTime <= 0) this.setPhase('circle');
    } else if (this.phase === 'perch') {
      goal = [DRAGON_PERCH[0], DRAGON_PERCH[1] + (this.landed ? 0 : 3), DRAGON_PERCH[2]];
      const d = Math.hypot(goal[0] - b.pos[0], goal[1] - b.pos[1], goal[2] - b.pos[2]);
      speed = Math.min(12, 2 + d * 0.6);
      if (d < 2.5 && !this.landed) { this.landed = true; this.phaseTime = 7; }
      if (this.landed && this.phaseTime <= 0) { this.landed = false; this.setPhase('circle'); }
    } else {
      if (this.phase !== 'circle') this.setPhase('circle');
      this.angle += TICK * 0.32;
      goal = [Math.cos(this.angle) * 52, 84 + Math.sin(this.age * 0.6) * 7, Math.sin(this.angle) * 52];
      speed = 15;
      if (this.phaseTime <= 0) {
        const r = Math.random();
        if (player && r < 0.55) this.setPhase('charge', 5);
        else if (r < 0.85) this.setPhase('perch', 30);
        else this.setPhase('circle');
      }
    }
    // steer: turn the velocity towards the goal
    const dx = goal[0] - b.pos[0], dy = goal[1] - b.pos[1], dz = goal[2] - b.pos[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    const k = this.phase === 'charge' ? 0.09 : 0.05;
    const want = this.landed ? [0, 0, 0] : [(dx / l) * speed, (dy / l) * speed, (dz / l) * speed];
    for (let i = 0; i < 3; i++) b.vel[i] += (want[i] - b.vel[i]) * k;
    for (let i = 0; i < 3; i++) b.pos[i] += b.vel[i] * TICK;
    if (b.pos[1] < 50) { b.pos[1] = 50; b.vel[1] = Math.max(0, b.vel[1]); }
    const hs = Math.hypot(b.vel[0], b.vel[2]);
    if (hs > 0.5) {
      const want = Math.atan2(-b.vel[0], -b.vel[2]);
      this.yaw += Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw)) * 0.12;
    } else if (player) this.faceTowards(player.pos[0], player.pos[2], 2);
    this.headYaw = this.yaw;
    this.headPitch = Math.max(-0.6, Math.min(0.6, Math.atan2(b.vel[1], Math.max(hs, 1)) + (this.landed ? -0.3 : 0)));
    this.walkPhase = this.flap;
    // anyone it flies into gets hurt and thrown
    if (this.contactCooldown <= 0) {
      for (const p of this.sim.players.values()) {
        if (p.dead || p.mode === 'creative') continue;
        const cx = b.pos[0], cy = b.pos[1] + 1.5, cz = b.pos[2];
        if (Math.hypot(p.pos[0] - cx, p.pos[1] + 0.9 - cy, p.pos[2] - cz) < 4.2) {
          this.contactCooldown = 1;
          if (this.sim.damagePlayer(p.id, this.def.damage * this.sim.diff.damage, 'ender_dragon', [cx, cy, cz])) {
            this.sim.emit({ type: 'knock', id: p.id, from: [cx, cy - 1, cz], strength: 2.2 });
          }
          if (this.phase === 'charge') this.setPhase('circle');
        }
      }
    }
  }

  setPhase(phase, time) {
    this.phase = phase;
    this.phaseTime = time ?? 8 + Math.random() * 8;
    if (phase !== 'perch') this.landed = false;
  }

  // Arrows and blows; knockback doesn't move something this big.
  hurt(amount, from) {
    if (this.deathTime > 0 || this.hurtTime > 0.3) return false;
    this.health -= amount * (this.landed ? 1.5 : 1);
    this.hurtTime = 0.45;
    if (this.phase === 'perch' && this.landed && Math.random() < 0.25) { this.landed = false; this.setPhase('circle'); }
    if (this.health <= 0) { this.health = 0; this.deathTime = 0.001; this.sim.onMobDeath(this); }
    return true;
  }
}
