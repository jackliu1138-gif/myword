// The F-22 Raptor (its shape: sim/jetform.js; its model: render/jet.js).
//  - Put down from its item on open ground; right click it to climb into the cockpit; landed,
//    sneak to climb out (it stays where it is).
//  - Easy to fly: it flies where you look (the circle in the middle of the HUD), banking into its
//    turns by itself; W and S open and close the throttle (W at full: afterburner), A and D roll,
//    Shift on its own works the air brake. Auto-GCAS (as real F-22s have) pulls it up out of a dive
//    into the ground.
//  - H: hover, as a jump jet would: it stops and holds still in the air, its nose where you look
//    (to aim exactly), W/A/S/D to move about slowly, Space and Shift to go up and down, down onto
//    the ground to land. From the ground: Space lifts it off, W opens the throttle for a take-off
//    run.
//  - The M61A2 cannon (left mouse button, held): twenty rounds a second, tracers among them.
//    Missiles (right mouse button): six AIM-120s from the bay under it and an AIM-9 from each side
//    bay. Hold the circle on something for a moment and it is locked (the box turns red): the
//    missile goes after it; locked onto nothing, a missile flies to wherever the circle is. What
//    they hit is blown apart as hard as the firepower (F, 1 to 5) says: blocks, creatures and
//    players (other players too, on a server, in creative mode as well).
//  - C: from behind it or from the cockpit; the wheel (or two fingers) brings the camera closer.
//  - Hit hard (into a hill, by someone's fire) it is damaged; wrecked, it blows up: crashed, the
//    seat throws you out to float down under a parachute; shot down, you go down with it.
// While flown it is part of its pilot (it goes where they go); parked, a creature that stays.
// Installed as methods on Game.prototype.

import * as J from '../sim/jetform.js';
import { IS_SOLID, IS_LIQUID, BLOCKS, WORLD_HEIGHT, WAVE } from '../world/blocks.js';
import { addEffect } from '../sim/effects.js';
import { raycast } from './player.js';
import { t } from '../ui/i18n.js';
import { FORCE_SOURCES } from '../sim/simulation.js';
import { PAD } from './gamepad.js';

export const JET_FLAGS = { JET: 16384, AB: 32768, GEAR: 65536, HOVER: 131072, GUN: 262144 };
const CAM_DIST = 26, CAM_MIN = 11, CAM_MAX = 160;
const V_STALL = 30, V_MIL = 82, V_AB = 120; // blocks a second, near the ground
const GUN_RATE = 20, GUN_ROUNDS = 480, BULLET_SPEED = 850;
const MISSILES = 8;
const CEILING = 560; // the highest it goes (the sky is near black above it)
// the firepower levels: a missile's blast, and what each cannon round breaks
export const FIREPOWER = [null, { power: 3, gun: 0.7 }, { power: 5, gun: 0.95 }, { power: 7, gun: 1.2 }, { power: 9.5, gun: 1.45 }, { power: 12, gun: 1.7 }];
const LOCK_CONE = 0.16, LOCK_KEEP = 0.26, LOCK_TIME = 0.7, LOCK_RANGE = 1400;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (e0, e1, x) => { const k = clamp((x - e0) / (e1 - e0), 0, 1); return k * k * (3 - 2 * k); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crossV = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lenV = (a) => Math.hypot(a[0], a[1], a[2]);
const normV = (a) => { const l = lenV(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const now = () => performance.now() / 1000;
// a solid block the jet hits (leaves and plants it goes through)
const hard = (b) => IS_SOLID[b] && BLOCKS[b].wave !== WAVE.LEAVES && BLOCKS[b].wave !== WAVE.PLANT;

export function installJet(Game) {
  const P = Game.prototype;

  // ---------------------------------------------------------------- the ride
  P.newJetRide = function newJetRide(at, yaw, s = {}) {
    return {
      uid: typeof s.uid === 'string' ? s.uid : 'l.jet.' + Date.now().toString(36),
      hp: Number.isFinite(s.hp) ? clamp(s.hp, 1, 100) : 100,
      q: J.quatFromEuler(yaw, 0, 0), w: [0, 0, 0], vel: [0, 0, 0], speed: 0,
      mode: 'landed', throttle: 0, ab: 0, gear: 1, bays: 0, vector: 0, stab: 0, roll: 0, yaw: 0,
      ammo: Number.isFinite(s.ammo) ? clamp(s.ammo | 0, 0, GUN_ROUNDS) : GUN_ROUNDS, gunCd: 0, firing: 0, heat: 0,
      missiles: Number.isFinite(s.missiles) ? clamp(s.missiles | 0, 0, MISSILES) : MISSILES, mslCd: 0, bayHold: 0, station: 0,
      firepower: Number.isInteger(s.firepower) ? clamp(s.firepower, 1, 5) : 3,
      lock: null, lockT: 0, lockLost: 0, locked: false,
      camDist: CAM_DIST, view: 0, gcas: false, stall: false, landedFor: 0, waitRelease: true, born: now(),
    };
  };

  // Its rotation now.
  P.jetRot = function jetRot() { return J.quatToMat(this.jet.q); };

  // ---------------------------------------------------------------- placing and boarding
  // The item used on the ground: the jet stands there on its wheels, its nose away from us.
  P.placeJet = function placeJet(hit) {
    // (it needs air to fly in: on the Earth only)
    if (this.dimension) { this.ui.toast(t('jet.noPlace'), 2600); return false; }
    const f = this.player.forward();
    const yaw = Math.atan2(-f[0], -f[2]);
    const hl = Math.hypot(f[0], f[2]) || 1;
    // (a little in front of us, or where we look)
    const tries = [[this.player.pos[0] + (f[0] / hl) * 13, this.player.pos[1] + 1, this.player.pos[2] + (f[2] / hl) * 13]];
    if (hit) tries.push([hit.x + 0.5, hit.y + 1, hit.z + 0.5]);
    for (const [x, y, z] of tries) {
      const g = this.jetGroundAt(x, z, y + 4, y - 6);
      if (g === null) continue;
      const pos = [x, g + J.GEAR_H, z];
      if (this.jetBlocked(pos, J.quatToMat(J.quatFromEuler(yaw, 0, 0)), true)) continue;
      const m = this.sim.spawnMob('jet', x, g, z);
      m.yaw = m.prevYaw = yaw;
      m.persistent = true;
      if (!this.isCreative()) this.inventory.consume(this.selected);
      this.audio.play('step', 'metal', 1.3);
      this.ui.toast(t('jet.placed'), 4200);
      return true;
    }
    this.ui.toast(t('jet.noRoom'), 3000);
    return false;
  };

  // Right click on a parked jet: into the cockpit.
  P.useJet = function useJet(mob) {
    if (this.jet || this.ride || this.passengerOf) return true;
    if (this.mp && mob.ghost) { this.wantedJet = true; this.askForSaucer(mob); return true; }
    const s = { uid: mob.uid, hp: mob.jetHp, ammo: mob.ammo, missiles: mob.missiles, firepower: mob.firepower };
    const b = mob.body.pos;
    mob.removed = true;
    this.sim.entities.delete(mob.id);
    this.boardJet([b[0], b[1] + J.GEAR_H, b[2]], mob.yaw, s);
    return true;
  };

  P.boardJet = function boardJet(at, yaw, s = {}) {
    this.jet = this.newJetRide(at, yaw, s);
    const p = this.player;
    p.pos = at.slice();
    p.vel = [0, 0, 0];
    p.flying = false;
    p.yaw = yaw;
    p.pitch = -0.08;
    this.camMode = 0;
    this.audio.play('step', 'metal', 1.2);
    this.ui.toast(t('jet.boarded'), 6500);
    document.body.classList.add('in-jet');
  };

  // Landed: out of the cockpit, the jet left standing there.
  P.leaveJet = function leaveJet() {
    const r = this.jet;
    if (!r || r.mode !== 'landed') return false;
    const R = this.jetRot();
    const p = this.player;
    const yaw = J.attitude(R).yaw;
    const ground = [p.pos[0], p.pos[1] - J.GEAR_H, p.pos[2]];
    const m = this.sim.spawnMob('jet', ground[0], ground[1], ground[2]);
    m.yaw = m.prevYaw = yaw;
    m.persistent = true;
    Object.assign(m, { uid: r.uid, jetHp: r.hp, ammo: r.ammo, missiles: r.missiles, firepower: r.firepower });
    this.jet = null;
    this.jetShots = [];
    // out on the left, by the cockpit
    const side = J.toWorld(p.pos, R, [-3.2, 0, -5.2]);
    const g = this.jetGroundAt(side[0], side[2], p.pos[1] + 2, p.pos[1] - 8);
    p.pos = [side[0], (g ?? ground[1]) + 0.02, side[2]];
    p.vel = [0, 0, 0];
    this.audio.setJet && this.audio.setJet(0, {});
    document.body.classList.remove('in-jet');
    this.ui.setJetHud(null);
    return true;
  };

  // Whether the blocks of column (bx, bz) are there yet (else the jet goes by the land's shape as
  // the world will make it: jetTerrain).
  P.jetColumnLoaded = function jetColumnLoaded(bx, bz) {
    const c = this.world.getChunk(Math.floor(bx / 16), Math.floor(bz / 16));
    return !!(c && c.blocks);
  };

  // The top of the land (or the sea) at a column not loaded yet: from the world's generator.
  P.jetTerrain = function jetTerrain(bx, bz) {
    const cache = this.jetTerrainCache || (this.jetTerrainCache = new Map());
    const key = bx + ',' + bz;
    let h = cache.get(key);
    if (h === undefined) {
      const gen = this.world.generator;
      const col = gen.column(bx, bz, this.jetCol || (this.jetCol = {}));
      h = Math.max(Math.floor(col.height) + 1, (gen.sea ?? 63) + 1);
      if (cache.size > 40000) cache.clear();
      cache.set(key, h);
    }
    return h;
  };

  // The top of the ground under (x, z) between two heights, or null. (Water is no ground for its
  // wheels.)
  P.jetGroundAt = function jetGroundAt(x, z, yTop, yBottom) {
    const w = this.world;
    const bx = Math.floor(x), bz = Math.floor(z);
    if (!this.jetColumnLoaded(bx, bz)) {
      // (as a loaded column: the ground's top, no higher than where we look from)
      const h = this.jetTerrain(bx, bz);
      return h >= yBottom ? Math.min(h, Math.floor(yTop) + 1) : null;
    }
    for (let y = Math.min(w.columnTop(bx, bz), Math.floor(yTop)); y >= Math.max(0, Math.floor(yBottom)); y--) {
      const b = w.getBlock(bx, y, bz);
      if (hard(b)) return y + 1;
    }
    return null;
  };

  // Whether a point is in something the jet can't go through (the sea too).
  P.jetSolid = function jetSolid(p) {
    const bx = Math.floor(p[0]), by = Math.floor(p[1]), bz = Math.floor(p[2]);
    if (by >= WORLD_HEIGHT) return false;
    if (!this.jetColumnLoaded(bx, bz)) return by < this.jetTerrain(bx, bz) - 0.5;
    const b = this.world.getBlock(bx, by, bz);
    return hard(b) || IS_LIQUID[b];
  };

  // Whether the jet at `pos` turned by `rot` is in anything (gear down: its wheels too): the
  // point it touches, or null.
  P.jetBlocked = function jetBlocked(pos, rot, gear) {
    for (const q of J.HULL_PTS) {
      const p = J.toWorld(pos, rot, q);
      if (this.jetSolid(p)) return p;
    }
    if (gear) for (const q of J.WHEELS) {
      const p = J.toWorld(pos, rot, [q[0], q[1] + 0.05, q[2]]);
      if (this.jetSolid(p)) return p;
    }
    return null;
  };

  // How far the jet's middle is above the ground (or the sea) under it.
  P.jetAgl = function jetAgl(pos) {
    const bx = Math.floor(pos[0]), bz = Math.floor(pos[2]);
    if (!this.jetColumnLoaded(bx, bz)) return pos[1] - this.jetTerrain(bx, bz);
    const w = this.world;
    for (let y = Math.min(w.columnTop(bx, bz), Math.floor(pos[1] + 1)); y >= 0; y--) {
      const b = w.getBlock(bx, y, bz);
      if (hard(b) || IS_LIQUID[b]) return pos[1] - (y + 1);
    }
    return pos[1];
  };

  // ---------------------------------------------------------------- flying
  // Each step (in place of the player's own movement): the controls, the jet's motion, what it runs into.
  P.jetStep = function jetStep(dt, ctl) {
    const r = this.jet;
    const p = this.player;
    p.onGround = r.mode === 'landed';
    p.flying = false;
    p.gliding = false;
    // what we look at: where it should go (and the guns point)
    const A = this.jetAim();
    let R = J.quatToMat(r.q);
    const F = [-R[2], -R[5], -R[8]], U = [R[1], R[4], R[7]], Rt = [R[0], R[3], R[6]];
    const agl = this.jetAgl(p.pos);
    const high = clamp(1 + (agl - 150) / 260, 1, 2.6);
    // ---- the throttle: W up, S down (W held at full: afterburner)
    const up = ctl.forward > 0.3, down = ctl.forward < -0.3;
    if (r.mode !== 'hover') {
      if (up) r.throttle = Math.min(1, r.throttle + dt * 0.7);
      if (down) r.throttle = Math.max(0, r.throttle - dt * 0.8);
    }
    const abWant = r.mode === 'flight' && ((up && r.throttle >= 0.999) || r.abBoost > 0);
    if (r.abBoost > 0) r.abBoost -= dt;
    r.ab += ((abWant ? 1 : 0) - r.ab) * (1 - Math.exp(-dt * 3));
    if (r.mode === 'landed') {
      // (sat on its wheels: Space lifts it straight off, the throttle opened takes it down the runway)
      r.landedFor += dt;
      p.vel = [0, 0, 0];
      r.speed = 0;
      r.vector += (0 - r.vector) * (1 - Math.exp(-dt * 2));
      r.gear = 1;
      if (!ctl.sneak) r.waitRelease = false;
      if (ctl.sneak && !r.waitRelease && r.landedFor > 0.4) { this.leaveJet(); return; }
      if (ctl.jump) { r.mode = 'hover'; r.vel = [0, 6, 0]; this.audio.jetSpool && this.audio.jetSpool(); }
      else if (r.throttle > 0.55) { r.mode = 'flight'; r.vel = F.map((v) => v * 4); r.ground = true; this.audio.jetSpool && this.audio.jetSpool(); }
      // rearming on the ground
      if (r.landedFor > 4 && (r.ammo < GUN_ROUNDS || r.missiles < MISSILES)) {
        this.ui.toast(t('jet.rearmed'), 2000);
        r.ammo = GUN_ROUNDS; r.missiles = MISSILES;
      }
      r.gLoad = 1;
      return;
    }
    r.landedFor = 0;
    let wCmd = [0, 0, 0];
    let velWant = null;
    if (r.mode === 'hover') {
      // ---- hovering: the nose where we look (as far as it will go), moving slowly
      const aimYaw = p.yaw, aimPitch = clamp(p.pitch, -1.35, 0.6);
      const roll = -clamp(ctl.strafe, -1, 1) * 0.22;
      const qWant = J.quatFromEuler(aimYaw, aimPitch, roll);
      r.q = slerpLimited(r.q, qWant, dt * 1.8);
      r.w = [0, 0, 0];
      const fwdH = normV([-Math.sin(aimYaw), 0, -Math.cos(aimYaw)]), right = [Math.cos(aimYaw), 0, -Math.sin(aimYaw)];
      const boost = ctl.sprint ? 2 : 1;
      const vy = ((ctl.jump ? 1 : 0) - (ctl.sneak ? 1 : 0)) * 10 * boost;
      velWant = [(fwdH[0] * ctl.forward * 16 + right[0] * ctl.strafe * 12) * boost, vy, (fwdH[2] * ctl.forward * 16 + right[2] * ctl.strafe * 12) * boost];
      const kk = 1 - Math.exp(-dt * 2.2);
      for (let i = 0; i < 3; i++) r.vel[i] += (velWant[i] - r.vel[i]) * kk;
      r.throttle += (0.62 - r.throttle) * (1 - Math.exp(-dt * 2));
      r.vector += (1 - r.vector) * (1 - Math.exp(-dt * 2.5));
      r.stab = clamp(-r.vel[1] * 0.02, -0.4, 0.4);
      r.roll = clamp(ctl.strafe * 0.4, -1, 1);
      r.yaw = 0;
      r.gcas = false;
      r.stall = false;
    } else {
      // ---- in flight: the instructor turns it towards where we look, banking into the turn
      r.vector += (0 - r.vector) * (1 - Math.exp(-dt * 2));
      const v = Math.max(lenV(r.vel), 1);
      const b = [dot(A, Rt), dot(A, U), dot(A, F)]; // the aim in the jet's frame: right, up, ahead
      let errPitch = Math.atan2(b[1], Math.max(b[2], 0.05));
      let errYaw = Math.atan2(b[0], Math.max(b[2], 0.05));
      const off = Math.acos(clamp(b[2], -1, 1));
      // the up we want: towards the aim when it is well off the nose, else the sky's (wings level)
      const worldUp = [0, 1, 0];
      const proj = (vv) => { const d = dot(vv, F); return normV([vv[0] - F[0] * d, vv[1] - F[1] * d, vv[2] - F[2] * d]); };
      const levelUp = proj(worldUp);
      const toAim = proj(A);
      const wgt = smooth(0.04, 0.3, off) * (b[1] > -0.2 || Math.abs(b[0]) > 0.3 ? 1 : 0.3);
      let upWant = normV([levelUp[0] * (1 - wgt) + toAim[0] * wgt, levelUp[1] * (1 - wgt) + toAim[1] * wgt, levelUp[2] * (1 - wgt) + toAim[2] * wgt]);
      // (never on its back for long: no more than 100 degrees of bank)
      if (dot(upWant, levelUp) < -0.17) upWant = normV([upWant[0] + levelUp[0] * 0.6, upWant[1] + levelUp[1] * 0.6, upWant[2] + levelUp[2] * 0.6]);
      let rollErr = Math.atan2(dot(crossV(U, upWant), F), clamp(dot(U, upWant), -1, 1));
      // Auto-GCAS: heading into the ground soon: wings level, pull up hard
      r.gcas = this.jetGroundAhead(p.pos, r.vel, r.gear > 0.5 && v < 60);
      if (r.gcas) { rollErr = Math.atan2(dot(crossV(U, levelUp), F), clamp(dot(U, levelUp), -1, 1)); errPitch = 1.2; errYaw = 0; }
      const gLimit = (9 * 9.81) / Math.max(v, 30);
      const pitchRate = clamp(errPitch * 3.2, -gLimit * 0.45, Math.min(1.6, gLimit));
      const yawRate = clamp(errYaw * 1.4, -0.45, 0.45);
      let rollRate = clamp(rollErr * 4, -3.6, 3.6);
      // A and D roll it ourselves
      if (Math.abs(ctl.strafe) > 0.2 && !r.gcas) rollRate = ctl.strafe * 3.4;
      // (positive about +x lifts the nose; about +y turns it left; about +z rolls it to the left)
      wCmd = [pitchRate, -yawRate, -rollRate];
      // ground run: on its wheels, the nose can't go down; fast enough, it lifts its nose (ten
      // degrees, or more if we look higher) and climbs away, climbing for a few seconds whatever
      // we look at
      const at0 = J.attitude(R);
      if (r.ground) {
        // (no more than nine degrees on the ground, or its tail would strike the runway)
        const want = clamp(Math.asin(clamp(A[1], -1, 1)), 0.13, 0.16);
        wCmd = [v > 46 ? clamp((want - at0.pitch) * 2, 0, 0.5) : 0, -yawRate * 0.5, 0];
        r.climbOut = 4;
      } else if (r.climbOut > 0) {
        r.climbOut -= dt;
        if (at0.pitch < 0.14 && !r.gcas) wCmd[0] = Math.max(wCmd[0], (0.14 - at0.pitch) * 2.5);
      }
      const kw = 1 - Math.exp(-dt * 6);
      for (let i = 0; i < 3; i++) r.w[i] += (wCmd[i] - r.w[i]) * kw;
      r.q = J.quatTurn(r.q, r.w, dt);
      R = J.quatToMat(r.q);
      const F2 = [-R[2], -R[5], -R[8]];
      // speed: the throttle's (faster higher up), less climbing, more diving; the air brake
      const vT = (r.ab > 0.3 ? V_MIL + (V_AB - V_MIL) * r.ab : V_STALL * 1.15 + (V_MIL - V_STALL * 1.15) * r.throttle) * high;
      let dv = (vT - v) * (r.ab > 0.3 ? 0.55 : 0.4) - 16 * F2[1];
      if (ctl.sneak && !r.ground) dv -= 28;
      const speed = Math.max(0, v + dv * dt);
      // the way it goes follows the nose (a moment behind it in a hard turn)
      const dir = normV(lenV(r.vel) > 1 ? r.vel : F2);
      const kd = 1 - Math.exp(-dt * (r.ground ? 20 : 4.5));
      let nd = normV([dir[0] + (F2[0] - dir[0]) * kd, dir[1] + (F2[1] - dir[1]) * kd, dir[2] + (F2[2] - dir[2]) * kd]);
      // too slow to fly: it sinks, its nose dropping (hover, H, to stop in the air instead)
      r.stall = speed < V_STALL && !r.ground && now() - (r.modeAt || 0) > 2.5;
      r.vel = nd.map((c) => c * speed);
      if (r.stall) { r.vel[1] -= (V_STALL - speed) * 0.9; r.w[0] -= dt * 1.2; }
      r.stab = clamp(r.w[0] * 0.5, -1, 1);
      r.roll = clamp(-r.w[2] / 3.6, -1, 1);
      r.yaw = clamp(-r.w[1] / 0.45, -1, 1);
      // the gear: down low and slow, up otherwise
    }
    r.gear += ((agl < 22 && lenV(r.vel) < 60) || r.ground ? 1 : -1) * dt * 0.6;
    r.gear = clamp(r.gear, 0, 1);
    r.speed = lenV(r.vel);
    // (the g it pulls: how hard its velocity turns, up through its wings, and gravity)
    if (r.prevVel) {
      const acc = [(r.vel[0] - r.prevVel[0]) / dt, (r.vel[1] - r.prevVel[1]) / dt + 9.81, (r.vel[2] - r.prevVel[2]) / dt];
      const U2 = [R[1], R[4], R[7]];
      const g = r.mode === 'hover' ? 1 : clamp(dot(acc, U2) / 9.81, -3, 9.5);
      r.gLoad = (r.gLoad || 1) + (g - (r.gLoad || 1)) * (1 - Math.exp(-dt * 4));
    }
    r.prevVel = r.vel.slice();
    // ---- moving: in short steps, so as not to pass through anything; what it hits
    this.jetMove(dt, R);
    if (!this.jet) return;
    // its ceiling (up where the sky darkens; into space it doesn't go, it is no spaceship)
    if (p.pos[1] > CEILING) { p.pos[1] = CEILING; r.vel[1] = Math.min(0, r.vel[1]); }
  };

  // Turned towards a rotation, at most `step` radians this time.
  function slerpLimited(q, target, step) {
    let d = q[0] * target[0] + q[1] * target[1] + q[2] * target[2] + q[3] * target[3];
    const tq = d < 0 ? target.map((v) => -v) : target;
    d = Math.abs(d);
    const ang = 2 * Math.acos(Math.min(1, d));
    if (ang < 1e-5) return tq.slice();
    const k = Math.min(1, step / ang);
    return J.quatNorm([q[0] + (tq[0] - q[0]) * k, q[1] + (tq[1] - q[1]) * k, q[2] + (tq[2] - q[2]) * k, q[3] + (tq[3] - q[3]) * k]);
  }

  // Auto-GCAS: will the way it is going take it into the ground (or a hill) in the next two and a
  // half seconds? (Coming in to land, gear down and slow: no.)
  P.jetGroundAhead = function jetGroundAhead(pos, vel, landing) {
    if (landing) return false;
    const r = this.jet;
    if (r.ground) return false;
    const v = lenV(vel);
    if (v < 20) return false;
    const pull = 9 + Math.max(0, -vel[1]) * 0.7;
    for (let k = 1; k <= 10; k++) {
      const tt = k * 0.25;
      const q = [pos[0] + vel[0] * tt, pos[1] + vel[1] * tt, pos[2] + vel[2] * tt];
      // (the ground not loaded yet counts as the land the world will make there)
      const g = this.jetGroundAt(q[0], q[2], q[1] + 60, q[1] - pull - 2);
      if (g !== null && q[1] - g < pull) return true;
    }
    return false;
  };

  // The jet's motion this step, in pieces small enough not to pass through a wall; landing gently
  // onto its wheels; a bump, or a crash, when it runs into something.
  P.jetMove = function jetMove(dt, R) {
    const r = this.jet, p = this.player;
    const v = r.vel;
    const steps = Math.min(24, Math.max(1, Math.ceil((lenV(v) * dt) / 0.7)));
    for (let i = 0; i < steps; i++) {
      const next = [p.pos[0] + (v[0] * dt) / steps, p.pos[1] + (v[1] * dt) / steps, p.pos[2] + (v[2] * dt) / steps];
      // on its wheels: down onto the ground under them (not when it is lifting off)
      if (r.gear > 0.9) {
        const g = this.jetGroundAt(next[0], next[2], next[1] - J.GEAR_H + 1.2, next[1] - J.GEAR_H - 0.6);
        if (g !== null && next[1] - J.GEAR_H < g + 0.05 && v[1] <= 0.5) {
          const vs = -v[1];
          if (r.mode === 'hover' && vs < 9) { this.jetTouchdown(next, g); return; }
          if (r.mode === 'flight') {
            if (vs < 7 && lenV(v) < 75 && J.attitude(R).pitch > -0.12) {
              // rolling on its wheels down the runway (slow enough: stopped)
              next[1] = g + J.GEAR_H; v[1] = 0; r.ground = true;
              const sp = lenV(v);
              if (r.throttle < 0.3) { const s2 = Math.max(0, sp - dt * 18); const d = normV(v); for (let j = 0; j < 3; j++) v[j] = d[j] * s2; }
              if (lenV(v) < 2.5 && r.throttle < 0.3) { this.jetTouchdown(next, g); return; }
              // (landing, or slow: the nose comes down onto its wheel)
              if (r.throttle < 0.5 || sp < 40) {
                const at = J.attitude(R);
                r.q = J.quatFromEuler(at.yaw, Math.max(0, at.pitch * 0.96), 0);
              }
            } else { this.jetCrash(Math.max(vs * 1.4, 22), [0, 1, 0]); return; }
          }
        } else if (r.ground && (g === null || next[1] - J.GEAR_H > g + 0.6 || v[1] > 0.5)) r.ground = false;
      } else r.ground = false;
      const hitP = this.jetBlocked(next, R, false);
      if (hitP) {
        const s = lenV(v);
        if (s > 20 && r.mode !== 'hover') { this.jetCrash(s, normV([p.pos[0] - hitP[0], p.pos[1] - hitP[1], p.pos[2] - hitP[2]])); return; }
        // a bump: back off it
        for (let j = 0; j < 3; j++) v[j] = -v[j] * 0.3;
        v[1] += 3;
        this.shake = Math.max(this.shake, 0.4);
        if (!(now() - (r.bumpAt || 0) < 0.6)) { r.bumpAt = now(); this.audio.play('step', 'metal', 1.4); }
        return;
      }
      p.pos = next;
      // (lifting off the runway)
      if (r.ground && v[1] > 0.5) r.ground = false;
    }
  };

  P.jetTouchdown = function jetTouchdown(at, g) {
    const r = this.jet, p = this.player;
    p.pos = [at[0], g + J.GEAR_H, at[2]];
    const yaw = J.attitude(J.quatToMat(r.q)).yaw;
    r.q = J.quatFromEuler(yaw, 0, 0);
    r.vel = [0, 0, 0];
    r.w = [0, 0, 0];
    r.mode = 'landed';
    r.ground = false;
    r.throttle = 0;
    r.ab = 0;
    r.waitRelease = true;
    r.landedFor = 0;
    this.audio.play('step', 'metal', 1.2);
    this.ui.toast(t('jet.landed'), 2600);
  };

  // Into something hard at speed: damage, a bounce, and (wrecked) the end of it.
  P.jetCrash = function jetCrash(speed, away) {
    const r = this.jet;
    const dmg = (speed - 14) * 1.6;
    r.hp -= Math.max(4, dmg);
    this.shake = Math.max(this.shake, Math.min(2, speed / 30));
    this.audio.saucerThud ? this.audio.saucerThud(Math.min(1, speed / 50)) : this.audio.sfx('explosion', 0.4, 0);
    if (r.hp <= 0) { this.wreckJet(false); return; }
    // thrown back off it, slowed
    const s = Math.min(speed * 0.35, 18);
    r.vel = [away[0] * s, Math.max(6, away[1] * s + 6), away[2] * s];
    r.w = [0.6, 0, 0];
    this.ui.toast(t('jet.damaged', { hp: Math.max(0, Math.round(r.hp)) }), 2200);
  };

  // Wrecked: it blows up where it is. Crashed, the seat throws us clear; shot down, we go with it.
  P.wreckJet = function wreckJet(shotDown, cause = 'missile') {
    const r = this.jet;
    if (!r) return;
    const p = this.player;
    const at = p.pos.slice();
    const vel = r.vel.slice();
    this.jet = null;
    this.jetShots = [];
    document.body.classList.remove('in-jet');
    this.ui.setJetHud(null);
    this.audio.setJet && this.audio.setJet(0, {});
    // shot down: we go down with it (what killed it killed us)
    if (shotDown) {
      const me = this.me && this.me();
      if (me) { me.sheltered = false; me.hurtTime = 0; }
      this.sim.damagePlayer('local', 999, FORCE_SOURCES.has(cause) ? cause : 'missile', at);
    }
    this.sim.strike(at[0], at[1], at[2], { power: 4.5, cause: 'jetwreck', spare: 'local', shooter: 'local' });
    this.jetBlast(at, 5);
    if (shotDown) return;
    // ejected: up and away, down under a parachute
    p.pos = [at[0], at[1] + 3, at[2]];
    p.vel = [vel[0] * 0.2, 22, vel[2] * 0.2];
    const me = this.me && this.me();
    if (me) addEffect(me.effects || (me.effects = {}), 'slow_falling', 25, 0);
    this.ui.toast(t('jet.ejected'), 4000);
  };

  // ---------------------------------------------------------------- aiming
  // Where we look: the unit vector of the camera's yaw and pitch.
  P.jetAim = function jetAim() {
    const p = this.player;
    const cp = Math.cos(p.pitch);
    return [-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp];
  };

  // The point the circle is on: the ground, a block or a creature it reaches (or far off).
  P.jetAimPoint = function jetAimPoint() {
    const cam = this.camera ? this.camera.pos : this.player.pos;
    const A = this.jetAim();
    const hit = raycastFar(this.world, cam, A, 1500);
    return hit ? hit.point : [cam[0] + A[0] * 1500, cam[1] + A[1] * 1500, cam[2] + A[2] * 1500];
  };

  // ---------------------------------------------------------------- the weapons
  P.jetWeapons = function jetWeapons(dt, A, R, ctl) {
    const r = this.jet;
    const input = this.input, tc = input.touch, pad = this.pads;
    const playing = this.state === 'playing';
    const creative = this.isCreative();
    const padOn = playing && pad.connected;
    // firepower: F (the controller's D-pad right)
    if (playing && (input.wasPressed('KeyF') || tc.jetPower || (padOn && pad.pressed(PAD.RIGHT)))) { tc.jetPower = false; r.firepower = (r.firepower % 5) + 1; this.ui.toast(t('jet.firepower', { n: r.firepower }), 1600); }
    // hover: H (X)
    if (playing && (input.wasPressed('KeyH') || tc.jetHover || (padOn && pad.pressed(PAD.X)))) { tc.jetHover = false; this.jetToggleHover(); }
    tc.jetPower = false; tc.jetHover = false;
    // the camera: C (handled by cycleCamera)
    // the cannon: the left button held (the touch screen's fire button, the controller's right trigger)
    const gunHeld = playing && (input.buttons.has(0) || tc.jetFire || (padOn && pad.down(PAD.RT)));
    r.firing = gunHeld && (r.ammo > 0 || creative) ? Math.min(1, r.firing + dt * 8) : Math.max(0, r.firing - dt * 6);
    r.gunCd -= dt;
    while (gunHeld && r.gunCd <= 0 && (r.ammo > 0 || creative)) {
      r.gunCd += 1 / GUN_RATE;
      if (!creative) r.ammo--;
      this.jetShoot(A, R);
    }
    if (r.gunCd < 0) r.gunCd = 0;
    r.heat = Math.max(0, r.heat + (gunHeld ? dt : -dt * 0.5));
    // a missile: the right button (or the touch screen's missile button, the left trigger)
    r.mslCd -= dt;
    const mslPress = playing && (input.clicked.has(2) || tc.jetMissile || (padOn && pad.pressed(PAD.LT)));
    tc.jetMissile = false;
    if (mslPress && r.mslCd <= 0) {
      if (r.missiles > 0 || creative) { r.bayHold = 0.35; r.pendingLaunch = 0.22; r.mslCd = 0.55; }
      else this.ui.toast(t('jet.noMissiles'), 1600);
    }
    if (r.pendingLaunch !== undefined && r.pendingLaunch !== null) {
      r.pendingLaunch -= dt;
      if (r.pendingLaunch <= 0) { r.pendingLaunch = null; this.jetLaunch(R); }
    }
    r.bayHold -= dt;
    r.bays += ((r.bayHold > 0 ? 1 : 0) - r.bays) * (1 - Math.exp(-dt * 9));
    // the lock: the circle held on something (in the air)
    if (r.mode !== 'landed') this.jetLockOn(dt, A);
    else if (r.lock) { r.lock = null; r.locked = false; r.lockT = 0; }
  };

  P.jetToggleHover = function jetToggleHover() {
    const r = this.jet;
    if (!r || r.mode === 'landed') return;
    if (r.mode === 'flight') { r.mode = 'hover'; this.ui.toast(t('jet.hover'), 2000); }
    else {
      r.mode = 'flight';
      r.modeAt = now();
      r.abBoost = 2.5; // (out of a hover: the afterburner for a moment, to get going)
      r.throttle = Math.max(r.throttle, 0.8);
      const R = this.jetRot();
      const F = [-R[2], -R[5], -R[8]];
      const s = Math.max(lenV(r.vel), 18);
      r.vel = F.map((c) => c * s);
      this.ui.toast(t('jet.flight'), 2000);
    }
  };

  // One round from the M61: out of the right wing root, towards the circle when it is close to
  // where the nose points (the gun's own sight), else straight out along the nose.
  P.jetShoot = function jetShoot(A, R) {
    const r = this.jet, p = this.player;
    const F = [-R[2], -R[5], -R[8]];
    const muzzle = J.toWorld(p.pos, R, J.GUN);
    let dir = F;
    // (the rounds go to the circle when it is near the nose: anywhere in front, hovering)
    if (dot(A, F) > Math.cos(r.mode === 'hover' || r.mode === 'landed' ? 0.6 : 0.12)) {
      const aim = this.jetAimPoint();
      dir = normV([aim[0] - muzzle[0], aim[1] - muzzle[1], aim[2] - muzzle[2]]);
    }
    const sp = 0.004;
    dir = normV([dir[0] + (Math.random() - 0.5) * sp, dir[1] + (Math.random() - 0.5) * sp, dir[2] + (Math.random() - 0.5) * sp]);
    const vel = [dir[0] * BULLET_SPEED + r.vel[0], dir[1] * BULLET_SPEED + r.vel[1], dir[2] * BULLET_SPEED + r.vel[2]];
    this.jetShots = this.jetShots || [];
    r.round = (r.round || 0) + 1;
    this.jetShots.push({ kind: 'bullet', pos: muzzle, vel, life: 1.6, tracer: r.round % 3 === 0, fp: r.firepower, mine: true });
    // (on a server: the others see the burst)
    if (this.mp && r.round % 4 === 1) this.mp.net.send({ t: 'fx', k: 'gun', p: muzzle.map((v) => Math.round(v * 10) / 10), v: dir.map((v) => Math.round(v * 1000) / 1000) });
  };

  // A missile away: dropped from its bay (the six under the middle first, then the side bays'),
  // its motor lit a moment later.
  P.jetLaunch = function jetLaunch(R) {
    const r = this.jet, p = this.player;
    if (!r) return;
    if (r.missiles <= 0 && !this.isCreative()) return;
    const n = r.missiles > 0 ? MISSILES - r.missiles : r.station++ % MISSILES;
    if (!this.isCreative()) r.missiles--;
    const st = J.MISSILE_STATIONS[Math.max(0, Math.min(MISSILES - 1, n))];
    const pos = J.toWorld(p.pos, R, st);
    const F = [-R[2], -R[5], -R[8]], U = [R[1], R[4], R[7]];
    const target = r.locked ? r.lock : null;
    this.jetShots = this.jetShots || [];
    const id = (this.mp ? this.mp.id : 'l') + '.' + (++this.jetMslSeq || (this.jetMslSeq = 1));
    // (pushed clear of the bay, already going the way the nose points, hovering or not)
    const v0 = Math.max(lenV(r.vel), 0) + 28;
    this.jetShots.push({ kind: 'missile', id, pos, vel: [F[0] * v0 - U[0] * 5, F[1] * v0 - U[1] * 5, F[2] * v0 - U[2] * 5], dir: F.slice(), t: 0, life: 14, target, fp: r.firepower, mine: true, side: n >= 6, sent: 0 });
    if (this.audio.jetMissile) this.audio.jetMissile();
    this.ui.toast(t(target ? 'jet.foxLock' : 'jet.fox'), 1500);
  };

  // The lock: the best thing under the circle (a creature, another player, their jet or saucer),
  // held there LOCK_TIME to lock; lost if it leaves the circle for long.
  // (the circle moved onto something better, nearer its middle: the lock goes to that instead)
  P.jetLockOn = function jetLockOn(dt, A) {
    const r = this.jet;
    const cam = this.camera ? this.camera.pos : this.player.pos;
    const cur = r.lock ? this.jetTargetPos(r.lock) : null;
    if (r.lock && !cur) { r.lock = null; r.locked = false; r.lockT = 0; }
    const best = this.jetBestTarget(cam, A);
    if (r.lock && best && (best.kind !== r.lock.kind || best.id !== r.lock.id)) {
      const d = normV([cur[0] - cam[0], cur[1] - cam[1], cur[2] - cam[2]]);
      if (targetScore(Math.acos(clamp(dot(d, A), -1, 1)), r.lock) > best.score + 0.02) r.lock = null;
    }
    if (r.lock) {
      const d = normV([cur[0] - cam[0], cur[1] - cam[1], cur[2] - cam[2]]);
      if (Math.acos(clamp(dot(d, A), -1, 1)) > LOCK_KEEP) { r.lockLost += dt; if (r.lockLost > 0.6) { r.lock = null; r.locked = false; r.lockT = 0; } }
      else { r.lockLost = 0; r.lockT += dt; if (!r.locked && r.lockT >= LOCK_TIME) { r.locked = true; this.audio.jetLock && this.audio.jetLock(true); } }
      return;
    }
    if (best) { r.lock = { kind: best.kind, id: best.id }; r.lockT = 0; r.lockLost = 0; r.locked = false; this.audio.jetLock && this.audio.jetLock(false); }
    else r.locked = false;
  };

  // How good a target is, off the circle's middle by `a` radians: lower is better (players and
  // their jets first, then creatures).
  function targetScore(a, tgt) { return tgt.kind === 'player' ? a * 0.6 : a; }

  // Something to lock onto in the circle: { kind: 'mob' | 'player', id, score }, or null.
  P.jetBestTarget = function jetBestTarget(cam, A) {
    let best = null, ba = LOCK_CONE;
    const consider = (pos, tgt) => {
      const d = [pos[0] - cam[0], pos[1] - cam[1], pos[2] - cam[2]];
      const l = lenV(d);
      if (l < 15 || l > LOCK_RANGE) return;
      const a = Math.acos(clamp(dot(d, A) / l, -1, 1));
      if (a > LOCK_CONE) return;
      const sc = targetScore(a, tgt);
      if (sc < ba) { ba = sc; best = { ...tgt, score: sc }; }
    };
    for (const e of this.sim.entities.values()) {
      if (e.kind !== 'mob' || e.removed || e.deathTime > 0 || e.aboard || e.carriedBy) continue;
      const b = e.body;
      consider([b.pos[0], b.pos[1] + b.h * 0.5, b.pos[2]], { kind: 'mob', id: e.id });
    }
    if (this.mp) for (const pl of this.mp.players.values()) {
      if (!pl.pos || (pl.dim | 0) !== (this.dimension | 0)) continue;
      consider([pl.pos[0], pl.pos[1] + (pl.flags & JET_FLAGS.JET ? 0 : 1), pl.pos[2]], { kind: 'player', id: pl.id });
    }
    return best;
  };

  // Where a target is now (null: gone).
  P.jetTargetPos = function jetTargetPos(tgt) {
    if (!tgt) return null;
    if (tgt.kind === 'mob') {
      const e = this.sim.entities.get(tgt.id);
      if (!e || e.removed || e.deathTime > 0) return null;
      return [e.body.pos[0], e.body.pos[1] + e.body.h * 0.5, e.body.pos[2]];
    }
    const pl = this.mp && this.mp.players.get(tgt.id);
    if (!pl || !pl.pos || (pl.dim | 0) !== (this.dimension | 0)) return null;
    return [pl.pos[0], pl.pos[1] + (pl.flags & JET_FLAGS.JET ? 0 : 1), pl.pos[2]];
  };

  // ---------------------------------------------------------------- what is in the air
  // Rounds and missiles (ours, and on a server the ones we see the others fire, for show), moved on
  // each frame; where ours hit, they strike.
  P.updateJetShots = function updateJetShots(dt) {
    const list = this.jetShots;
    if (!list || !list.length) return;
    const keep = [];
    for (const s of list) {
      s.life -= dt;
      if (s.life <= 0) { if (s.kind === 'missile' && s.mine) this.jetDetonate(s, s.pos); continue; }
      if (s.kind === 'missile') this.guideMissile(s, dt);
      else s.vel[1] -= 9 * dt;
      const step = [s.vel[0] * dt, s.vel[1] * dt, s.vel[2] * dt];
      const l = lenV(step);
      // what it runs into on the way: a creature or a player (ours: only) first, else a block
      const hit = s.mine ? this.jetShotHit(s.pos, step, l, s) : null;
      const blockHit = raycastFar(this.world, s.pos, normV(step), l);
      let at = null, direct = null;
      if (hit && (!blockHit || hit.t <= blockHit.t)) { at = hit.p; direct = hit; }
      else if (blockHit) at = blockHit.point;
      if (at) {
        // (a round that hits a block goes off in it, so the block itself breaks)
        const into = !direct && blockHit ? [blockHit.x + 0.5, blockHit.y + 0.5, blockHit.z + 0.5] : at;
        if (s.mine) { if (s.kind === 'missile') this.jetDetonate(s, at); else this.jetImpact(s, at, direct, into); }
        else if (s.kind === 'bullet') this.particles.spark(at[0], at[1], at[2], 0, 2, 0, [3, 2.2, 1], { life: 0.15, size: 0.5 });
        continue;
      }
      s.pos = [s.pos[0] + step[0], s.pos[1] + step[1], s.pos[2] + step[2]];
      // a missile's trail of smoke and the flame of its motor
      if (s.kind === 'missile' && s.t > 0.18) {
        const back = normV(s.vel);
        for (let i = 0; i < 2; i++) {
          const k = Math.random();
          this.particles.smoke(s.pos[0] - step[0] * k - back[0] * 1.8, s.pos[1] - step[1] * k - back[1] * 1.8, s.pos[2] - step[2] * k - back[2] * 1.8,
            (Math.random() - 0.5) * 1.5, 0.3 + Math.random() * 0.8, (Math.random() - 0.5) * 1.5, [0.86, 0.86, 0.86], { life: 2.5 + Math.random() * 2, size: 0.9 + Math.random() * 0.7, rise: 0.4, drag: 2.2, glow: 0 });
        }
      }
      // (on a server: where our missiles are, for the others to see)
      if (s.kind === 'missile' && s.mine && this.mp && (s.sent -= dt) <= 0) {
        s.sent = 0.2;
        this.mp.net.send({ t: 'fx', k: 'msl', n: s.id, p: s.pos.map((v) => Math.round(v * 10) / 10), v: normV(s.vel).map((v) => Math.round(v * 1000) / 1000) });
      }
      keep.push(s);
    }
    this.jetShots = keep;
  };

  // Steering a missile: dropped clear, then its motor; after its lock, or the circle's point.
  P.guideMissile = function guideMissile(s, dt) {
    s.t += dt;
    if (!s.mine) { const sp = Math.max(lenV(s.vel), 280); s.vel = normV(s.vel).map((c) => c * sp); return; }
    if (s.t < 0.18) { s.vel[1] -= 14 * dt; return; }
    const sp = Math.min(320, lenV(s.vel) + 240 * dt);
    let aim = s.target ? this.jetTargetPos(s.target) : null;
    if (!aim && this.jet && !s.target) aim = this.jetAimPoint();
    let dir = normV(s.vel);
    if (aim) {
      // (a little ahead of a moving target)
      const want = normV([aim[0] - s.pos[0], aim[1] - s.pos[1], aim[2] - s.pos[2]]);
      const ang = Math.acos(clamp(dot(dir, want), -1, 1));
      // (hard at first, off the rail; then as a missile at speed turns)
      const turn = Math.min(1, ((s.t < 1.2 ? 7 : 4.5) * dt) / Math.max(ang, 1e-4));
      dir = normV([dir[0] + (want[0] - dir[0]) * turn, dir[1] + (want[1] - dir[1]) * turn, dir[2] + (want[2] - dir[2]) * turn]);
      // close enough to what it is after: it goes off
      if (lenV([aim[0] - s.pos[0], aim[1] - s.pos[1], aim[2] - s.pos[2]]) < 3.2 && s.target) { s.life = 0.0001; s.pos = aim.slice(); }
    }
    s.vel = dir.map((c) => c * sp);
    s.dir = dir;
  };

  // What one of our rounds or missiles hits on its way from `from` by `step` (length l): a
  // creature, another player, their jet: { t, p, kind, id } or null.
  P.jetShotHit = function jetShotHit(from, step, l, s) {
    let best = null;
    const d = normV(step);
    const near = (c, rad, what) => {
      const w = [c[0] - from[0], c[1] - from[1], c[2] - from[2]];
      const tt = clamp(dot(w, d), 0, l);
      const q = [from[0] + d[0] * tt, from[1] + d[1] * tt, from[2] + d[2] * tt];
      if (lenV([c[0] - q[0], c[1] - q[1], c[2] - q[2]]) < rad && (!best || tt < best.t)) best = { t: tt, p: q, ...what };
    };
    for (const e of this.sim.entities.values()) {
      if (e.kind !== 'mob' || e.removed || e.deathTime > 0 || e.aboard) continue;
      const b = e.body;
      near([b.pos[0], b.pos[1] + b.h * 0.5, b.pos[2]], Math.max(b.hw, b.h * 0.5) + 0.3 + (e.type === 'jet' ? 4 : e.type === 'saucer' ? 20 : 0), { kind: 'mob', id: e.id });
    }
    if (this.mp) for (const pl of this.mp.players.values()) {
      if (!pl.pos || (pl.dim | 0) !== (this.dimension | 0)) continue;
      const jet = pl.flags & JET_FLAGS.JET;
      near([pl.pos[0], pl.pos[1] + (jet ? 0 : 0.9), pl.pos[2]], jet ? 5.5 : 0.9, { kind: 'player', id: pl.id });
    }
    return best;
  };

  // A cannon round's hit: it breaks what is round the point (by the firepower) and hurts what is
  // there; a direct hit on a creature or player hurts it more.
  P.jetImpact = function jetImpact(s, at, direct, into = at) {
    const fp = FIREPOWER[s.fp] || FIREPOWER[3];
    const hitBlock = direct ? 0 : this.world.getBlock(Math.floor(into[0]), Math.floor(into[1]), Math.floor(into[2]));
    if (hitBlock) this.particles.burst(Math.floor(into[0]), Math.floor(into[1]), Math.floor(into[2]), hitBlock, 1, 0, 8);
    this.sim.strike(into[0], into[1], into[2], { radius: fp.gun, damage: 3 + s.fp, reach: fp.gun + 1.2, cause: 'jetgun', spare: 'local', shooter: 'local', blast: false });
    if (direct) this.jetHurtTarget(direct, 5 + s.fp * 1.5, at, 'jetgun');
    this.particles.spark(at[0], at[1], at[2], 0, 3, 0, [4, 2.6, 1.2], { life: 0.2, size: 0.9 });
    for (let i = 0; i < 3; i++) this.particles.smoke(at[0], at[1], at[2], (Math.random() - 0.5) * 4, 1 + Math.random() * 2, (Math.random() - 0.5) * 4, [0.55, 0.5, 0.45], { life: 1 + Math.random(), size: 0.5 + Math.random() * 0.5 });
    if (this.audio.jetHitSound) this.audio.jetHitSound(this.distToCam(at));
  };

  // A missile goes off: a blast as strong as its firepower.
  P.jetDetonate = function jetDetonate(s, at) {
    const fp = FIREPOWER[s.fp] || FIREPOWER[3];
    this.sim.strike(at[0], at[1], at[2], { power: fp.power, cause: 'missile', spare: 'local', shooter: 'local', all: true });
    this.jetBlast(at, fp.power);
  };

  // The look and sound of a big blast (ours or, on a server, someone else's): a fireball, smoke
  // lit by its fire billowing out, what it blew apart thrown up, a ring of dust rushing out along
  // the ground, a column of dark smoke rising after; its flash lighting up all round (jetLights);
  // the ground shaking for whoever is near.
  P.jetBlast = function jetBlast(at, power) {
    const d = this.distToCam(at);
    const P = Math.max(1, power);
    const k = P / 6; // (1 at firepower 3's missile)
    this.shake = Math.max(this.shake, Math.max(0, 2.2 - d / (P * 7)));
    const rnd = (a, b) => a + Math.random() * (b - a);
    const dirOf = (up = 1) => { const a = Math.random() * Math.PI * 2, e = Math.asin(rnd(-0.2, 1) * up); return [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)]; };
    // the fireball: big, glowing, swelling out and burning away
    for (let i = 0; i < 14 + P * 2; i++) {
      const v = dirOf(), sp = rnd(2, 7) * k;
      this.particles.spark(at[0] + v[0] * rnd(0, 2) * k, at[1] + 0.5 + v[1] * rnd(0, 2) * k, at[2] + v[2] * rnd(0, 2) * k, v[0] * sp, v[1] * sp + 2, v[2] * sp,
        i % 3 ? [9, 4.2, 1.1] : [12, 9, 4], { life: rnd(0.35, 0.9), size: rnd(1.2, 2.6) * (0.7 + k * 0.55), drag: 2.5 });
    }
    // smoke lit by the fire, billowing out
    for (let i = 0; i < 26 + P * 5; i++) {
      const v = dirOf(), sp = rnd(4, 16) * k;
      const c = rnd(0.22, 0.42);
      this.particles.smoke(at[0] + v[0] * k, at[1] + 0.5 + v[1] * k, at[2] + v[2] * k, v[0] * sp, v[1] * sp * 0.8 + 2, v[2] * sp, [c * 1.1, c, c * 0.92],
        { life: rnd(3, 6.5), size: rnd(1.6, 3.4) * (0.6 + k * 0.6), rise: rnd(0.8, 1.8), drag: 1.5, glow: i % 2 ? 0.9 : 0.4 });
    }
    // sparks and burning bits flung out
    for (let i = 0; i < 20 + P * 4; i++) {
      const v = dirOf(), sp = rnd(10, 32) * Math.sqrt(k);
      this.particles.spark(at[0], at[1] + 0.5, at[2], v[0] * sp, Math.abs(v[1]) * sp + 4, v[2] * sp, [7, 3.4, 1], { life: rnd(0.6, 1.6), size: rnd(0.25, 0.7), gravity: 14, drag: 0.5 });
    }
    // what it blew apart: chunks of the ground it hit
    const b = this.world.getBlock(Math.floor(at[0]), Math.floor(at[1] - 1), Math.floor(at[2])) || this.world.getBlock(Math.floor(at[0]), Math.floor(at[1] - 2 - k * 2), Math.floor(at[2]));
    if (b) for (let i = 0; i < 4 + P; i++) this.particles.burst(Math.floor(at[0] + rnd(-2, 2) * k), Math.floor(at[1] + rnd(-1, 1.5)), Math.floor(at[2] + rnd(-2, 2) * k), b, 1, 0, 10);
    // the dust ring rushing out along the ground
    for (let i = 0; i < 18 + P * 2; i++) {
      const a = (i / (18 + P * 2)) * Math.PI * 2 + rnd(0, 0.3), sp = rnd(14, 22) * k;
      this.particles.smoke(at[0], at[1] + 0.4, at[2], Math.cos(a) * sp, rnd(0.3, 1.2), Math.sin(a) * sp, [0.62, 0.57, 0.5], { life: rnd(1.4, 2.4), size: rnd(1.2, 2.2) * (0.7 + k * 0.4), rise: 0.2, drag: 2.4 });
    }
    // and the smoke rising after, slow and dark
    for (let i = 0; i < 10 + P * 2; i++) {
      const c = rnd(0.12, 0.22);
      this.particles.smoke(at[0] + rnd(-1.5, 1.5) * k, at[1] + 1 + rnd(0, 3) * k, at[2] + rnd(-1.5, 1.5) * k, rnd(-1, 1), rnd(2, 6) * Math.sqrt(k), rnd(-1, 1), [c, c * 0.95, c * 0.9],
        { life: rnd(6, 10), size: rnd(2, 3.5) * (0.6 + k * 0.5), rise: rnd(1.2, 2.6), drag: 0.9, glow: 0.15 });
    }
    if (this.audio.jetBoom) this.audio.jetBoom(d, power);
    // (its fire lights up what is round it for a moment: see jetLights)
    this.jetFlashes = this.jetFlashes || [];
    this.jetFlashes.push({ pos: at.slice(), power, t: now() });
  };

  // How far a point is from the camera.
  P.distToCam = function distToCam(at) {
    const cam = this.camera ? this.camera.pos : this.player.pos;
    return lenV([at[0] - cam[0], at[1] - cam[1], at[2] - cam[2]]);
  };

  // A direct hit on a creature or a player (or their jet). (Another player's are added up and sent
  // a few times a second: a burst is twenty rounds a second.)
  P.jetHurtTarget = function jetHurtTarget(h, amount, at, cause) {
    if (h.kind === 'mob') {
      const e = this.sim.entities.get(h.id);
      if (e && e.hurt) { e.lastAttacker = 'local'; e.hurtTime = 0; e.hurt(amount, at, 0.6); }
    } else if (h.kind === 'player' && this.mp) {
      const due = this.jetDue || (this.jetDue = new Map());
      const d = due.get(h.id) || { a: 0 };
      d.a += amount; d.at = at; d.cause = cause;
      due.set(h.id, d);
    }
  };

  P.jetSendHurts = function jetSendHurts() {
    const due = this.jetDue;
    if (!due || !due.size || !this.mp || now() - (this.jetDueAt || 0) < 0.12) return;
    this.jetDueAt = now();
    for (const [id, d] of due) this.mp.net.send({ t: 'hurt', to: id, a: Math.round(d.a * 10) / 10, s: d.cause, f: d.at.map((v) => Math.round(v * 10) / 10) });
    due.clear();
  };

  // Our own jet hit by someone's fire (on a server): it takes the damage, and is shot down when
  // it has had enough (and us with it). Returns true when the jet took it.
  P.jetTakeHit = function jetTakeHit(amount, source) {
    const r = this.jet;
    if (!r) return false;
    // (a missile's blast does it far more harm than the rounds that hit it)
    r.hp -= amount * (source === 'missile' ? 2.4 : 1);
    this.shake = Math.max(this.shake, 0.6);
    this.audio.play('step', 'metal', 1.4);
    if (r.hp <= 0) this.wreckJet(true, source);
    else this.ui.toast(t('jet.hit', { hp: Math.round(r.hp) }), 1600);
    return true;
  };

  // ---------------------------------------------------------------- each frame
  P.updateJet = function updateJet(dt) {
    this.updateJetShots(dt);
    this.jetSendHurts();
    const r = this.jet;
    if (!r) { this.audio.setJet && this.jetSoundOn && (this.jetSoundOn = false, this.audio.setJet(0, {})); this.jetRemoteSound(); return; }
    this.jetSoundOn = true;
    // sound: its engines (louder burning), the cannon, warnings
    const quiet = this.state === 'paused' || this.state === 'title';
    if (this.audio.setJet) this.audio.setJet(quiet ? 0 : 0.25 + r.throttle * 0.55 + (r.mode === 'hover' ? 0.15 : 0), { ab: quiet ? 0 : r.ab, inside: r.view === 1, gun: !quiet && r.firing > 0.5, gcas: !quiet && r.gcas, speed: r.speed });
    // the HUD
    if (this.state === 'playing' && !this.hudHidden) this.ui.setJetHud(this.jetHudInfo());
    else this.ui.setJetHud(null);
  };

  // What the HUD shows: { speed (km/h), alt (m), agl, throttle, ab, mode, gear, ammo, missiles,
  // firepower, hp, gcas, stall, nose [x, y] and circle [x, y] on screen (0..1), lock {box, locked} }.
  P.jetHudInfo = function jetHudInfo() {
    const r = this.jet, p = this.player;
    const cam = this.camera;
    const R = this.jetRot();
    const F = [-R[2], -R[5], -R[8]];
    const proj = (w) => (cam ? projectRel(cam, w) : null);
    const far = (d) => [p.pos[0] + d[0] * 800, p.pos[1] + d[1] * 800, p.pos[2] + d[2] * 800];
    const lockPos = r.lock ? this.jetTargetPos(r.lock) : null;
    const att = J.attitude(R);
    const f = cam ? cam.forward : F;
    const sea = (this.world.generator && this.world.generator.sea) || 63;
    return {
      speed: Math.round(r.speed * 3.6), alt: Math.round(p.pos[1] - J.GEAR_H - sea), agl: Math.round(this.jetAgl(p.pos) - J.GEAR_H), vs: r.vel[1],
      g: r.gLoad || 1, throttle: r.throttle, ab: r.ab, mode: r.mode === 'flight' && r.ground ? 'roll' : r.mode, gear: r.gear > 0.5,
      ammo: this.isCreative() ? null : r.ammo, missiles: this.isCreative() ? null : r.missiles,
      firepower: r.firepower, hp: Math.max(0, Math.round(r.hp)), gcas: r.gcas, stall: r.stall, view: r.view,
      nose: proj(far(F)), fpm: r.speed > 1 ? proj(far(normV(r.vel))) : null,
      heading: ((-att.yaw * 180) / Math.PI + 360) % 360, bank: att.roll,
      camPitch: Math.asin(clamp(f[1], -1, 1)), fov: cam ? cam.fov : 1.2,
      lock: lockPos ? { at: proj(lockPos), locked: r.locked, dist: lenV([lockPos[0] - p.pos[0], lockPos[1] - p.pos[1], lockPos[2] - p.pos[2]]) } : null,
      touch: !!this.touch && !!(this.input.touch && this.input.touch.active),
    };
  };

  // ---------------------------------------------------------------- the camera
  // Behind and a little above it, looking where we look (the jet turning to follow); or from the
  // cockpit (C).
  P.jetCamera = function jetCamera(dt) {
    const r = this.jet, p = this.player;
    const A = this.jetAim();
    const R = this.jetRot();
    // (wider at speed, wider still burning)
    const fov = r.view === 1 && (r.zoom || 1) > 1.01 ? this.settings.fov / r.zoom : this.settings.fov * (1.06 + Math.min(0.1, r.speed / 1500) + r.ab * 0.05);
    this.fovCurrent += (fov - this.fovCurrent) * (1 - Math.exp(-dt * 3));
    const fovR = (this.fovCurrent * Math.PI) / 180;
    const sh = this.shake || 0;
    const jiggle = (pos, k) => { if (sh > 0.01) { const tm = now(); pos[0] += Math.sin(tm * 53) * sh * k; pos[1] += Math.sin(tm * 61 + 1) * sh * k; pos[2] += Math.sin(tm * 47 + 2) * sh * k; } return pos; };
    if (r.view === 1) {
      // from the seat, looking out over the nose (the canopy left out of the model)
      return { pos: jiggle(J.toWorld(p.pos, R, J.EYE), 0.05), forward: A, fov: fovR };
    }
    // behind it and a little above, along where we look
    const d = r.camDist || CAM_DIST;
    const centre = [p.pos[0], p.pos[1] + 2 + d * 0.22, p.pos[2]];
    let dist = d;
    // (not into a hill or a wall between it and us)
    const w = this.world;
    for (let k = 4; k <= d; k += 1.5) {
      const q = [centre[0] - A[0] * k, centre[1] - A[1] * k, centre[2] - A[2] * k];
      if (hard(w.getBlock(Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2])))) { dist = Math.max(4, k - 1.5); break; }
    }
    r.camNow = r.camNow === undefined ? dist : dist < r.camNow ? dist : r.camNow + (dist - r.camNow) * (1 - Math.exp(-dt * 3));
    const pos = [centre[0] - A[0] * r.camNow, centre[1] - A[1] * r.camNow, centre[2] - A[2] * r.camNow];
    return { pos: jiggle(pos, 0.25), forward: A, fov: fovR };
  };

  // The wheel or two fingers: the camera closer or further; from the cockpit, the view narrower
  // (up to four times closer) or wider.
  P.jetZoom = function jetZoom(steps) {
    const r = this.jet;
    if (!r) return;
    if (r.view === 1) r.zoom = clamp((r.zoom || 1) * Math.pow(1.15, -steps), 1, 4);
    else r.camDist = clamp((r.camDist || CAM_DIST) * Math.pow(1.15, steps), CAM_MIN, CAM_MAX);
  };

  // ---------------------------------------------------------------- light
  // What lights up the world round the jets: an afterburner's fire behind it, the cannon's flash,
  // and for a moment the fire of what a missile hits.
  P.jetLights = function jetLights() {
    const out = [];
    const tm = now();
    for (const j of this.jetModels()) {
      const L = j.look;
      if (L.ab > 0.2) {
        const k = (1.4 + 2.6 * L.ab) * (0.9 + 0.1 * Math.sin(tm * 31));
        out.push({ pos: J.toWorld(j.pos, j.rot, [0, -0.1, J.TAIL_Z + 4]), color: [k, k * 0.42, k * 0.12], reach: 30 + 30 * L.ab, air: 0.25 });
      }
      if (L.gun) out.push({ pos: J.toWorld(j.pos, j.rot, J.GUN), color: [2.6, 1.8, 0.8], reach: 18, air: 0.2 });
    }
    this.jetFlashes = (this.jetFlashes || []).filter((f) => tm - f.t < 1.4);
    for (const f of this.jetFlashes) {
      const a = tm - f.t;
      const k = (f.power / 4) * 7 * Math.exp(-a * 3.2) * (a < 0.05 ? a / 0.05 : 1);
      out.push({ pos: [f.pos[0], f.pos[1] + 2, f.pos[2]], color: [k, k * 0.55, k * 0.2], reach: 25 + f.power * 7, air: 0.35 });
    }
    return out;
  };

  // All the lights there are (saucers' and jets'), the four nearest the camera.
  P.sceneLights = function sceneLights(cam) {
    const a = this.saucerLights ? this.saucerLights(cam) : [];
    const b = this.jetLights();
    if (!b.length) return a;
    const c = cam ? cam.pos : this.player.pos;
    const d = (l) => Math.hypot(l.pos[0] - c[0], l.pos[1] - c[1], l.pos[2] - c[2]) - l.reach * 0.5;
    return [...a, ...b].sort((x, y) => d(x) - d(y)).slice(0, 4);
  };

  // ---------------------------------------------------------------- drawing
  // The jets to draw: ours (from outside, or seen from the cockpit) and on a server the others'.
  P.jetModels = function jetModels() {
    const out = [];
    const r = this.jet;
    if (r) out.push({ pos: this.player.pos.slice(), rot: this.jetRot(), look: this.jetLook(r) });
    if (this.mp) for (const pl of this.mp.players.values()) {
      if (!pl.pos || (pl.dim | 0) !== (this.dimension | 0) || !(pl.flags & JET_FLAGS.JET)) continue;
      const q = pl.jq && pl.jq.length === 4 ? pl.jq : J.quatFromEuler(pl.yaw || 0, 0, 0);
      out.push({ id: pl.id, pos: pl.pos.slice(), rot: J.quatToMat(J.quatNorm(q)), look: { gear: pl.flags & JET_FLAGS.GEAR ? 1 : 0, ab: pl.flags & JET_FLAGS.AB ? 1 : 0, throttle: 0.6, vector: pl.flags & JET_FLAGS.HOVER ? 1 : 0, gun: !!(pl.flags & JET_FLAGS.GUN), missiles: 8 } });
    }
    return out;
  };

  P.jetLook = function jetLook(r) {
    return {
      stab: r.stab, roll: r.roll, yaw: r.yaw, vector: r.vector, throttle: r.throttle, ab: r.ab, gear: r.gear, bays: r.bays,
      gun: r.firing > 0.5, missiles: r.missiles, flaps: r.mode !== 'flight' || r.speed < 50 ? 0.6 : 0, cockpit: r.view === 1,
    };
  };

  // The missiles in the air (ours and those we see), to draw.
  P.jetMissileModels = function jetMissileModels() {
    const out = [];
    for (const s of this.jetShots || []) if (s.kind === 'missile') out.push({ pos: s.pos, dir: s.dir || normV(s.vel), burning: s.t > 0.18 || !s.mine });
    return out;
  };

  // Tracers in flight: [{ from, to }] lines of light.
  P.jetTracers = function jetTracers() {
    const out = [];
    for (const s of this.jetShots || []) if (s.kind === 'bullet' && s.tracer) out.push({ pos: s.pos, vel: s.vel });
    return out;
  };

  // ---------------------------------------------------------------- on a server
  // Someone's burst or missile, to see (their game does the damage).
  P.onJetFx = function onJetFx(m) {
    if (!Array.isArray(m.p) || !Array.isArray(m.v)) return;
    this.jetShots = this.jetShots || [];
    const dir = normV(m.v.slice(0, 3).map(Number));
    const p = m.p.slice(0, 3).map(Number);
    if (m.k === 'gun') {
      for (let i = 0; i < 4; i++) this.jetShots.push({ kind: 'bullet', pos: [p[0] + dir[0] * i * 8, p[1] + dir[1] * i * 8, p[2] + dir[2] * i * 8], vel: dir.map((c) => c * BULLET_SPEED), life: 1.2, tracer: i % 2 === 0, mine: false });
      if (this.audio.jetGunFar) this.audio.jetGunFar(this.distToCam(p));
    } else if (m.k === 'msl') {
      const s = this.jetShots.find((q) => q.kind === 'missile' && q.id === m.n);
      if (s) { s.pos = p; s.vel = dir.map((c) => c * 300); s.life = 0.6; }
      else this.jetShots.push({ kind: 'missile', id: m.n, pos: p, vel: dir.map((c) => c * 300), dir, t: 1, life: 0.6, mine: false });
    }
  };

  // The roar of the others' jets (the nearest).
  P.jetRemoteSound = function jetRemoteSound() {
    if (!this.mp || !this.audio.setJetFar) return;
    let best = null, bd = Infinity;
    const cam = this.camera ? this.camera.pos : this.player.pos;
    for (const pl of this.mp.players.values()) {
      if (!pl.pos || (pl.dim | 0) !== (this.dimension | 0) || !(pl.flags & JET_FLAGS.JET)) continue;
      const d = lenV([pl.pos[0] - cam[0], pl.pos[1] - cam[1], pl.pos[2] - cam[2]]);
      if (d < bd) { bd = d; best = pl; }
    }
    this.audio.setJetFar(best && bd < 900 ? { dist: bd, ab: !!(best.flags & JET_FLAGS.AB) } : null);
  };

  // ---------------------------------------------------------------- saving
  P.serializeJet = function serializeJet() {
    const r = this.jet;
    if (!r) return {};
    return { jet: { uid: r.uid, hp: r.hp, q: r.q, mode: r.mode === 'landed' ? 'landed' : 'hover', ammo: r.ammo, missiles: r.missiles, firepower: r.firepower } };
  };

  P.loadJet = function loadJet(data) {
    const s = data && data.jet;
    this.jet = null;
    this.jetShots = [];
    document.body.classList.remove('in-jet');
    if (this.ui.setJetHud) this.ui.setJetHud(null);
    if (!s || typeof s !== 'object') return;
    const r = this.newJetRide(this.player.pos, 0, s);
    if (Array.isArray(s.q) && s.q.length === 4 && s.q.every(Number.isFinite)) r.q = J.quatNorm(s.q);
    // (flying when saved: hovering where it was)
    if (s.mode === 'hover') { r.mode = 'hover'; r.gear = 0.5; }
    this.jet = r;
    document.body.classList.add('in-jet');
  };
}

// Where a ray from o along unit d first meets a solid block within maxDist: { point, t, x, y, z }
// or null. (Through grass, flowers and torches; in short pieces, as the block raycast takes at
// most 64 cells.)
function raycastFar(world, o, d, maxDist) {
  let from = o.slice(), done = 0;
  for (let guard = 0; done < maxDist && guard < 600; guard++) {
    const seg = Math.min(maxDist - done, 20);
    const hit = raycast(world, from, d, seg);
    if (!hit || hit.t > seg) { from = [from[0] + d[0] * seg, from[1] + d[1] * seg, from[2] + d[2] * seg]; done += seg; continue; }
    if (IS_SOLID[hit.block]) {
      const p = hit.point || [from[0] + d[0] * hit.t, from[1] + d[1] * hit.t, from[2] + d[2] * hit.t];
      return { point: p, t: done + hit.t, x: hit.x, y: hit.y, z: hit.z };
    }
    // (on past it: out of its cell)
    let tx = Infinity;
    for (let i = 0; i < 3; i++) {
      const c = i === 0 ? hit.x : i === 1 ? hit.y : hit.z;
      if (d[i] > 1e-9) tx = Math.min(tx, (c + 1 - from[i]) / d[i]);
      else if (d[i] < -1e-9) tx = Math.min(tx, (c - from[i]) / d[i]);
    }
    const step = Math.max(hit.t + 0.01, Math.min(seg, tx + 0.001));
    from = [from[0] + d[0] * step, from[1] + d[1] * step, from[2] + d[2] * step];
    done += step;
  }
  return null;
}

// A point in the world on the screen (0..1 across and down), or null behind the camera.
function projectRel(cam, w) {
  const rel = [w[0] - cam.pos[0], w[1] - cam.pos[1], w[2] - cam.pos[2]];
  const f = cam.forward, up = cam.up || [0, 1, 0];
  const right = normV(crossV(f, up));
  const u = crossV(right, f);
  const z = dot(rel, f);
  if (z <= 0.5) return null;
  const fov = cam.fov || 1.2;
  const th = Math.tan(fov / 2);
  const aspect = cam.aspect || (typeof window !== 'undefined' ? window.innerWidth / Math.max(1, window.innerHeight) : 16 / 9);
  const x = dot(rel, right) / (z * th * aspect), y = dot(rel, u) / (z * th);
  return [0.5 + x * 0.5, 0.5 - y * 0.5];
}

