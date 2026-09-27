// Brains for the creatures that came with villages, pets, the sea and the End's cities, and the
// driving of whatever is ridden (boats, minecarts, horses). A brain runs at 20 ticks a second in
// place of the Mob's usual one and returns what the creature wants to do: { wish: [vx, vz] or
// null, jump }. Tickers run for things that only wait (lit TNT, evoker fangs).

import { IS_OPAQUE, IS_SOLID, IS_LIQUID, BLOCK, RAIL_SHAPES, IS_RAIL, FACING } from '../world/blocks.js';
import { addEffect, hasEffect } from './effects.js';

const TICK = 1 / 20;
const rnd = Math.random;
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2;

export function lineOfSight(world, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const steps = Math.ceil(Math.hypot(dx, dy, dz) * 3);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (IS_OPAQUE[world.getBlock(Math.floor(a[0] + dx * t), Math.floor(a[1] + dy * t), Math.floor(a[2] + dz * t))]) return false;
  }
  return true;
}

// is a target (a player record or a creature) still there to go after?
export function alive(t) {
  if (!t) return false;
  if (t.kind === 'mob') return !t.removed && t.deathTime === 0;
  return !t.dead && t.mode !== 'creative';
}

const standOn = (m) => ({ wish: [0, 0], jump: false });

// Run from something.
function flee(m, from, speed) {
  const b = m.body;
  return { wish: m.walkTowards(b.pos[0] * 2 - from[0], b.pos[2] * 2 - from[2], speed), jump: b.hitWall };
}

// Close in and bite (or punch) something: the common melee chase.
export function meleeChase(m, t, { damage = m.def.damage || 2, reach = (m.def.reach || 1.2) + m.def.hw, speed = m.def.chase || m.def.speed * 1.6, launch = 0, cooldown = 1 } = {}) {
  const b = m.body, tp = t.pos;
  const dist = Math.sqrt(d2(tp, b.pos));
  m.mode = 'chase';
  m.target = t;
  m.headYaw = m.yaw;
  if (dist < reach && Math.abs(tp[1] - b.pos[1]) < 2) {
    m.faceTowards(tp[0], tp[2], 12);
    if (m.attackCooldown <= 0) {
      m.attackCooldown = cooldown;
      m.swing = 0.4;
      m.sim.attackTarget(m, t, damage, { launch });
    }
    return { wish: [0, 0], jump: false };
  }
  return m.followPath(tp, speed);
}

// ---------------------------------------------------------------- villagers and golems
function villager(m) {
  const sim = m.sim, b = m.body, d = m.def;
  if (m.age >= (m.nextScan || 0)) {
    m.nextScan = m.age + 0.6;
    m.threat = sim.nearestMob(b.pos, 9, (e) => e.type === 'zombie' || e.def.illager || e.type === 'vex');
    m.watch = sim.nearestPlayer(b.pos, 6);
  }
  if (m.threat && alive(m.threat)) { m.mode = 'flee'; return flee(m, m.threat.pos, d.speed * 2.3); }
  if (m.trading && sim.players.get(m.trading)) {
    const p = sim.players.get(m.trading).pos;
    m.faceTowards(p[0], p[2], 10);
    m.headYaw = m.yaw;
    return standOn(m);
  }
  m.trading = null;
  if (m.watch && Math.sqrt(d2(m.watch.pos, b.pos)) < 6) {
    const p = m.watch.pos;
    const want = Math.atan2(-(p[0] - b.pos[0]), -(p[2] - b.pos[2]));
    m.headYaw += Math.atan2(Math.sin(want - m.headYaw), Math.cos(want - m.headYaw)) * 0.15;
  }
  // evenings at home
  if (!sim.day && m.home) {
    if (Math.sqrt(d2(m.home, b.pos)) > 2.5) return m.followPath(m.home, d.speed);
    return standOn(m);
  }
  return m.idleWander({ home: m.home, radius: 18 });
}

function ironGolem(m) {
  const sim = m.sim, b = m.body, d = m.def;
  if (m.age >= (m.nextScan || 0)) {
    m.nextScan = m.age + 0.5;
    const a = m.angryAt;
    m.target = a && sim.players.get(a.id) === a && alive(a) && d2(a.pos, b.pos) < 28 * 28 ? a
      : sim.nearestMob(b.pos, d.follow, (e) => e.hostile && e.type !== 'creeper' && !e.def.boss && !e.def.water);
    if (!m.target) m.angryAt = null;
  }
  if (alive(m.target)) return meleeChase(m, m.target, { launch: 7, cooldown: 1.25 });
  m.mode = 'idle';
  return m.idleWander({ home: m.home, radius: 20, speed: d.speed * 0.6 });
}

// ---------------------------------------------------------------- pets and horses
// Tamed wolves and cats: sit when told, follow their owner (and a wolf fights for them).
function pet(m, fights) {
  const sim = m.sim, b = m.body;
  const owner = sim.ownerOf(m);
  if (m.sitting) { m.mode = 'idle'; m.target = null; return standOn(m); }
  if (fights && alive(m.target) && (!owner || d2(owner.pos, b.pos) < 24 * 24)) return meleeChase(m, m.target);
  m.target = null;
  m.mode = 'idle';
  if (owner) {
    const dist = Math.sqrt(d2(owner.pos, b.pos));
    if (dist > 16 && !owner.flying) {
      // catch up: appear beside the owner
      for (let k = 0; k < 10; k++) {
        const x = Math.floor(owner.pos[0] + (rnd() - 0.5) * 4), z = Math.floor(owner.pos[2] + (rnd() - 0.5) * 4);
        let y = Math.floor(owner.pos[1] + 1);
        for (let j = 0; j < 4; j++, y--) {
          if (sim.standable(x, y, z, 1)) { b.pos = [x + 0.5, y, z + 0.5]; m.prevPos = b.pos.slice(); b.vel = [0, 0, 0]; m.path = null; return standOn(m); }
        }
      }
    }
    if (dist > 3.2) return m.followPath(owner.pos, (m.def.chase || m.def.speed * 2) * 0.9);
  }
  return m.idleWander({ home: owner ? owner.pos : null, radius: 4 });
}

function wolf(m) {
  if (m.tamed) return pet(m, true);
  const a = m.angryAt;
  if (a && alive(a) && d2(a.pos, m.body.pos) < 24 * 24) return meleeChase(m, a);
  m.angryAt = null;
  m.mode = 'idle';
  return m.idleWander({ radius: 12 });
}

function cat(m) {
  if (m.tamed) return pet(m, false);
  m.mode = 'idle';
  return m.idleWander({ home: m.home, radius: 12 });
}

// Horses: wild ones graze and wander; with a rider the rider's controls drive a tamed, saddled
// horse, and an untamed one bucks them off until it gives in.
function horse(m) {
  const b = m.body, c = m.control;
  if (m.rider && c) {
    m.mode = 'ridden';
    if (!m.tamed) {
      m.buck = (m.buck ?? 1 + rnd() * 2) - TICK;
      m.yaw += Math.sin(m.age * 13) * 0.08;
      if (m.buck <= 0) {
        m.buck = undefined;
        if (rnd() * 100 < (m.temper || 0)) { m.tamed = m.rider; m.persistent = true; m.sim.emit({ type: 'tamed', entity: m, pos: b.pos.slice() }); }
        else { m.temper = Math.min(100, (m.temper || 0) + 8); m.sim.emit({ type: 'buck', entity: m, rider: m.rider }); }
      }
      return { wish: [0, 0], jump: false };
    }
    if (!m.saddled) return { wish: [0, 0], jump: false };
    m.yaw = c.yaw;
    m.headYaw = c.yaw;
    const sp = (m.stats ? m.stats.speed : 10) * (c.forward > 0 ? 1 : 0.4) * Math.sign(c.forward);
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    const sx = Math.cos(c.yaw), sz = -Math.sin(c.yaw);
    const wish = [fx * sp + sx * c.strafe * 2.5, fz * sp + sz * c.strafe * 2.5];
    const jump = c.jump && b.onGround;
    if (jump) m.jumpV = m.stats ? m.stats.jump : 9;
    return { wish, jump };
  }
  m.mode = 'idle';
  return m.idleWander({ radius: 14 });
}

// ---------------------------------------------------------------- water creatures
// Fish and squid swim about the water (fish in schools), and flop about on land until they dry out.
function swimmer(m, { speed = m.def.speed, school = !!m.def.school, bursts = false } = {}) {
  const sim = m.sim, b = m.body, w = sim.world;
  if (!b.inWater) {
    m.dry = (m.dry || 0) + TICK;
    if (b.onGround && rnd() < 0.12) { b.vel[1] = 4.5; b.vel[0] = (rnd() - 0.5) * 3; b.vel[2] = (rnd() - 0.5) * 3; }
    if (m.dry > 4 && m.age % 1 < TICK) { m.hurtTime = 0; m.hurt(1, null, 0); }
    return { wish: null, jump: false };
  }
  m.dry = 0;
  const p = b.pos;
  m.modeTime -= TICK;
  const scared = m.panic > 0 || (m.age >= (m.nextScan || 0) && (m.scare = sim.nearestPlayer(p, 3.5)) && m.scare);
  if (m.age >= (m.nextScan || 0)) m.nextScan = m.age + 0.5;
  if (!m.goal || m.modeTime <= 0 || b.hitWall || Math.hypot(m.goal[0] - p[0], m.goal[1] - p[1], m.goal[2] - p[2]) < 0.8) {
    let gx = p[0], gy = p[1], gz = p[2];
    if (school) {
      // drift towards the others of the school
      let n = 0, sx = 0, sy = 0, sz = 0;
      for (const e of sim.entities.values()) {
        if (e === m || e.type !== m.type || e.kind !== 'mob') continue;
        const q = e.body.pos;
        if (Math.abs(q[0] - p[0]) < 8 && Math.abs(q[2] - p[2]) < 8 && Math.abs(q[1] - p[1]) < 4) { sx += q[0]; sy += q[1]; sz += q[2]; n++; }
        if (n > 8) break;
      }
      if (n) { gx = sx / n; gy = sy / n; gz = sz / n; }
    }
    for (let k = 0; k < 6; k++) {
      const tx = gx + (rnd() - 0.5) * 10, ty = gy + (rnd() - 0.5) * 3, tz = gz + (rnd() - 0.5) * 10;
      if (w.getBlock(Math.floor(tx), Math.floor(ty), Math.floor(tz)) === BLOCK.WATER && w.getBlock(Math.floor(tx), Math.floor(ty + 0.5), Math.floor(tz)) === BLOCK.WATER) {
        m.goal = [tx, ty, tz];
        break;
      }
    }
    m.modeTime = 2 + rnd() * 4;
  }
  if (scared && m.scare) {
    const s = m.scare.pos;
    const dx = p[0] - s[0], dz = p[2] - s[2], l = Math.hypot(dx, dz) || 1;
    const tx = p[0] + (dx / l) * 5, tz = p[2] + (dz / l) * 5;
    if (w.getBlock(Math.floor(tx), Math.floor(p[1]), Math.floor(tz)) === BLOCK.WATER) m.goal = [tx, p[1], tz];
  }
  if (!m.goal) return { wish: [0, 0], jump: false };
  let sp = speed * (scared ? 1.8 : 1);
  if (bursts) {
    // squid: pulses of speed
    const ph = (m.age + m.id) % 2.2;
    sp *= ph < 0.5 ? 2.2 : 0.35;
  }
  const wish = m.walkTowards(m.goal[0], m.goal[2], sp);
  let vy = Math.max(-1.6, Math.min(1.6, (m.goal[1] - p[1]) * 1.6));
  // stay under the surface
  if (w.getBlock(Math.floor(p[0]), Math.floor(p[1] + b.h + 0.3), Math.floor(p[2])) !== BLOCK.WATER) vy = Math.min(vy, -0.4);
  b.vel[1] += (vy - b.vel[1]) * 0.2;
  m.headPitch = Math.atan2(b.vel[1], Math.max(0.3, Math.hypot(b.vel[0], b.vel[2]))) * 0.6;
  return { wish, jump: false };
}

function pufferfish(m) {
  const sim = m.sim, b = m.body;
  const near = sim.nearestPlayer(b.pos, 2.6);
  if (near && !near.remote) m.puffed = 2.5;
  if (m.puffed > 0) {
    m.puffed -= TICK;
    if (near && Math.sqrt(d2(near.pos, b.pos)) < 1.3 && Math.abs(near.pos[1] + 0.8 - b.pos[1]) < 1.3 && m.attackCooldown <= 0) {
      m.attackCooldown = 1;
      sim.attackTarget(m, near, 1, { effect: ['poison', 6, 0] });
    }
  }
  m.renderScale = m.puffed > 0 ? 2.4 : 1;
  return swimmer(m, { speed: m.def.speed * (m.puffed > 0 ? 0.4 : 1) });
}

// Guardians: swim about their monument and fire a beam that charges up while it stays on target.
function guardian(m) {
  const sim = m.sim, b = m.body, d = m.def;
  if (m.age >= (m.nextScan || 0)) {
    m.nextScan = m.age + 0.5;
    const t = sim.targetFor(m, d.follow);
    m.target = t && lineOfSight(sim.world, m.eyePos, [t.pos[0], t.pos[1] + 1, t.pos[2]]) ? t : null;
  }
  if (d.elder && m.age >= (m.nextCurse ?? 5)) {
    // the elder's curse on everyone in (and around) the monument
    m.nextCurse = m.age + 60;
    for (const p of sim.players.values()) {
      if (p.dead || p.mode === 'creative' || d2(p.pos, b.pos) > 50 * 50) continue;
      sim.effectPlayer(p.id, 'mining_fatigue', 300, 2);
      sim.emit({ type: 'elderCurse', id: p.id, pos: b.pos.slice() });
    }
  }
  const t = m.target;
  if (alive(t)) {
    m.mode = 'chase';
    m.faceTowards(t.pos[0], t.pos[2], 8);
    m.headYaw = m.yaw;
    m.headPitch = Math.atan2(t.pos[1] + 1 - (b.pos[1] + d.eye), Math.max(0.5, Math.sqrt(d2(t.pos, b.pos))));
    m.beam = (m.beam || 0) + TICK;
    const charge = d.elder ? 2.6 : 2;
    if (m.beam >= charge) {
      m.beam = -1.2;
      sim.attackTarget(m, t, d.laser, { magic: true });
      sim.emit({ type: 'sound', name: 'guardianBeam', pos: b.pos.slice() });
    }
    m.beamTarget = m.beam > 0 ? t : null;
    const dist = Math.sqrt(d2(t.pos, b.pos));
    if (dist > 10) { m.goal = [t.pos[0], t.pos[1] + 1, t.pos[2]]; m.modeTime = 1; }
    else if (dist < 5) { m.goal = [b.pos[0] * 2 - t.pos[0], b.pos[1], b.pos[2] * 2 - t.pos[2]]; m.modeTime = 1; }
  } else { m.beam = 0; m.beamTarget = null; m.mode = 'idle'; }
  return swimmer(m, { speed: d.speed });
}

// ---------------------------------------------------------------- monsters
// Witches keep their distance and throw potions; they drink one themselves when hurt or burning.
function witch(m) {
  const sim = m.sim, b = m.body, d = m.def;
  if (m.drinking > 0) {
    m.drinking -= TICK;
    m.mode = 'drink';
    if (m.drinking <= 0) {
      if (m.drinkWhat === 'fire') m.fireproofFor = 30;
      else m.health = Math.min(d.health, m.health + 8);
      sim.emit({ type: 'sound', name: 'drink', pos: b.pos.slice() });
      m.drinkCooldown = 6;
    }
    return standOn(m);
  }
  if (m.drinkCooldown > 0) m.drinkCooldown -= TICK;
  if (!(m.drinkCooldown > 0) && (m.health < d.health * 0.55 || (m.burning > 0 && !(m.fireproofFor > 0)))) {
    m.drinking = 1.6;
    m.drinkWhat = m.burning > 0 ? 'fire' : 'heal';
    return standOn(m);
  }
  if (m.fireproofFor > 0) { m.fireproofFor -= TICK; m.burning = 0; }
  const t = sim.targetFor(m, d.follow);
  m.target = t;
  if (!alive(t)) { m.mode = 'idle'; return m.idleWander({ radius: 10 }); }
  m.mode = 'chase';
  const tp = t.pos, dist = Math.sqrt(d2(tp, b.pos));
  const sees = lineOfSight(sim.world, m.eyePos, [tp[0], tp[1] + 1.4, tp[2]]);
  m.faceTowards(tp[0], tp[2], 10);
  m.headYaw = m.yaw;
  m.shootTime -= TICK;
  if (sees && dist < 11 && m.shootTime <= 0) {
    m.shootTime = 3;
    const fx = t.effects || {};
    const potion = dist >= 8 && !hasEffect(fx, 'slowness') ? 'slowness'
      : (t.health ?? 20) >= 8 && !hasEffect(fx, 'poison') ? 'poison'
        : dist <= 3 && !hasEffect(fx, 'weakness') ? 'weakness' : 'harming';
    sim.mobThrowPotion(m, t, potion);
  }
  if (dist < 5) return flee(m, tp, d.chase);
  if (dist > 9 || !sees) return m.followPath(tp, d.chase);
  return standOn(m);
}

// Slimes hop at whoever they see; big ones hurt, the smallest only bump.
function slime(m) {
  const sim = m.sim, b = m.body, d = m.def;
  const size = m.size || 1;
  const t = sim.targetFor(m, d.follow);
  m.target = t;
  m.hopTimer = (m.hopTimer ?? rnd()) - TICK;
  if (b.onGround) {
    b.vel[0] *= 0.6; b.vel[2] *= 0.6;
    if (m.hopTimer <= 0) {
      m.hopTimer = (alive(t) ? 0.6 : 1.4) + rnd() * 1.2;
      let dx, dz;
      if (alive(t)) { m.faceTowards(t.pos[0], t.pos[2], 20); dx = -Math.sin(m.yaw); dz = -Math.cos(m.yaw); m.mode = 'chase'; }
      else { m.yaw += (rnd() - 0.5) * 2; dx = -Math.sin(m.yaw); dz = -Math.cos(m.yaw); m.mode = 'idle'; }
      const sp = 1.8 + size * 0.5;
      b.vel[0] = dx * sp; b.vel[2] = dz * sp; b.vel[1] = 5.5 + size * 0.5;
      sim.emit({ type: 'sound', name: 'slime', pos: b.pos.slice(), size });
    }
  }
  if (alive(t) && size > 1 && m.attackCooldown <= 0) {
    const reach = b.hw + 0.6;
    if (Math.sqrt(d2(t.pos, b.pos)) < reach && Math.abs(t.pos[1] - b.pos[1]) < b.h) {
      m.attackCooldown = 0.8;
      sim.attackTarget(m, t, size === 2 ? 2 : 4);
    }
  }
  return { wish: null, jump: false };
}

// Phantoms: circle high over whoever has gone too long without sleep, then swoop down on them.
function phantom(m) {
  const sim = m.sim, b = m.body, d = m.def;
  const t = sim.targetFor(m, d.follow);
  m.target = t;
  const v = b.vel;
  let want;
  if (!alive(t)) {
    m.mode = 'idle';
    m.anchor = m.anchor || b.pos.slice();
    const a = m.age * 0.5 + m.id;
    want = [m.anchor[0] + Math.cos(a) * 12, m.anchor[1], m.anchor[2] + Math.sin(a) * 12];
  } else {
    m.mode = 'chase';
    m.phase = m.phase || 'circle';
    m.phaseTime = (m.phaseTime ?? 4 + rnd() * 4) - TICK;
    const tp = t.pos;
    if (m.phase === 'circle') {
      const a = m.age * 0.7 + m.id;
      want = [tp[0] + Math.cos(a) * 11, tp[1] + 18, tp[2] + Math.sin(a) * 11];
      if (m.phaseTime <= 0) { m.phase = 'swoop'; m.phaseTime = 4; sim.emit({ type: 'sound', name: 'phantomSwoop', pos: b.pos.slice() }); }
    } else if (m.phase === 'swoop') {
      want = [tp[0], tp[1] + 0.9, tp[2]];
      const dist = Math.hypot(tp[0] - b.pos[0], tp[1] + 0.9 - b.pos[1], tp[2] - b.pos[2]);
      if (dist < 1.3 && m.attackCooldown <= 0) {
        m.attackCooldown = 1;
        m.swing = 0.4;
        sim.attackTarget(m, t, d.damage);
        m.phase = 'climb'; m.phaseTime = 2;
      }
      if (m.phaseTime <= 0 || b.hitWall) { m.phase = 'climb'; m.phaseTime = 2; }
    } else {
      want = [b.pos[0] + v[0], tp[1] + 20, b.pos[2] + v[2]];
      if (m.phaseTime <= 0) { m.phase = 'circle'; m.phaseTime = 5 + rnd() * 5; }
    }
  }
  const dx = want[0] - b.pos[0], dy = want[1] - b.pos[1], dz = want[2] - b.pos[2];
  const l = Math.hypot(dx, dy, dz) || 1;
  const sp = m.phase === 'swoop' ? 10 : d.speed;
  v[0] += ((dx / l) * sp - v[0]) * 0.12;
  v[1] += ((dy / l) * sp - v[1]) * 0.12;
  v[2] += ((dz / l) * sp - v[2]) * 0.12;
  m.yaw = Math.atan2(-v[0], -v[2]);
  m.headYaw = m.yaw;
  m.headPitch = Math.atan2(v[1], Math.hypot(v[0], v[2]));
  return { wish: [v[0], v[2]], jump: false };
}

// Evokers keep back and send lines of fangs snapping up out of the ground at their target.
function evoker(m) {
  const sim = m.sim, b = m.body, d = m.def;
  const t = sim.targetFor(m, d.follow);
  m.target = t;
  if (m.casting > 0) m.casting -= TICK;
  if (!alive(t)) { m.mode = 'idle'; return m.idleWander({ home: m.home, radius: 8 }); }
  m.mode = 'chase';
  const tp = t.pos, dist = Math.sqrt(d2(tp, b.pos));
  m.faceTowards(tp[0], tp[2], 10);
  m.headYaw = m.yaw;
  m.shootTime -= TICK;
  if (m.shootTime <= 0 && dist < 16) {
    m.shootTime = 5;
    m.casting = 1.2;
    sim.emit({ type: 'sound', name: 'evokerCast', pos: b.pos.slice() });
    if (dist < 3.5) {
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; sim.spawnFangs(m, b.pos[0] + Math.cos(a) * 1.6, b.pos[1], b.pos[2] + Math.sin(a) * 1.6, 0.1); }
    } else {
      const dx = (tp[0] - b.pos[0]) / dist, dz = (tp[2] - b.pos[2]) / dist;
      for (let i = 1; i <= 14; i++) sim.spawnFangs(m, b.pos[0] + dx * i * 1.25, b.pos[1], b.pos[2] + dz * i * 1.25, i * 0.05);
    }
  }
  if (dist < 6) return flee(m, tp, d.chase);
  if (dist > 12) return m.followPath(tp, d.chase);
  return standOn(m);
}

// Shulkers cling to their spot, open up to fire homing bullets at whoever comes near.
function shulker(m) {
  const sim = m.sim, b = m.body;
  b.vel[0] = b.vel[1] = b.vel[2] = 0;
  if (m.age >= (m.nextScan || 0)) {
    m.nextScan = m.age + 0.5;
    const t = sim.targetFor(m, 16);
    m.target = t && lineOfSight(sim.world, [b.pos[0], b.pos[1] + 0.8, b.pos[2]], [t.pos[0], t.pos[1] + 1, t.pos[2]]) ? t : null;
  }
  m.peek = (m.peek || 0) - TICK;
  if (alive(m.target)) {
    m.open = true;
    m.mode = 'chase';
    m.faceTowards(m.target.pos[0], m.target.pos[2], 6);
    m.headYaw = m.yaw;
    m.shootTime -= TICK;
    if (m.shootTime <= 0) { m.shootTime = 1 + rnd() * 4.5; sim.shulkerBullet(m, m.target); }
  } else {
    m.mode = 'idle';
    if (m.peek <= 0) { m.peek = 3 + rnd() * 6; m.open = rnd() < 0.3; }
  }
  return { wish: null, jump: false };
}

// The wither: rises from its summoning in a blast, then hovers over its target raining skulls
// from all three heads; below half health it grows an armour arrows bounce off.
function wither(m) {
  const sim = m.sim, b = m.body, d = m.def;
  const v = b.vel;
  if (m.charge > 0) {
    m.charge -= TICK;
    m.health = Math.min(d.health, m.health + (d.health / 10) * TICK);
    v[0] = v[2] = 0; v[1] = 0.3;
    if (m.charge <= 0) { sim.explode(b.pos[0], b.pos[1] + 1.5, b.pos[2], 7, m); sim.emit({ type: 'sound', name: 'witherSpawn', pos: b.pos.slice() }); }
    return { wish: [0, 0], jump: false };
  }
  if (m.age >= (m.nextScan || 0)) {
    m.nextScan = m.age + 1;
    m.target = sim.targetFor(m, d.follow) || sim.nearestMob(b.pos, 20, (e) => !e.def.undead && !e.def.vehicle && !e.def.fixed && e.type !== 'wither');
  }
  const t = m.target;
  let want;
  if (alive(t)) {
    m.mode = 'chase';
    const a = m.age * 0.35 + m.id;
    want = [t.pos[0] + Math.cos(a) * 9, t.pos[1] + 6, t.pos[2] + Math.sin(a) * 9];
    m.faceTowards(t.pos[0], t.pos[2], 8);
    m.headYaw = m.yaw;
    m.headPitch = Math.atan2(t.pos[1] + 1 - (b.pos[1] + d.eye), Math.max(1, Math.sqrt(d2(t.pos, b.pos))));
    m.shootTime -= TICK;
    if (m.shootTime <= 0) {
      m.shootTime = m.health < d.health / 2 ? 0.7 : 1.1;
      sim.witherSkull(m, t, m.health >= d.health / 2 && rnd() < 0.08);
      // the side heads pick at whatever else is about
      const other = sim.nearestMob(b.pos, 14, (e) => e !== t && !e.def.undead && !e.def.vehicle && !e.def.fixed && e.type !== 'wither');
      if (other && rnd() < 0.5) sim.witherSkull(m, other, false);
    }
  } else {
    m.mode = 'idle';
    want = [b.pos[0] + Math.cos(m.age * 0.2) * 4, b.pos[1], b.pos[2] + Math.sin(m.age * 0.2) * 4];
  }
  const dx = want[0] - b.pos[0], dy = want[1] - b.pos[1], dz = want[2] - b.pos[2];
  const l = Math.hypot(dx, dz) || 1;
  const sp = Math.min(d.speed * (m.health < d.health / 2 ? 1.5 : 1), l);
  v[1] += (Math.max(-3, Math.min(3, dy)) - v[1]) * 0.1;
  // breaks out of anything that boxes it in once it has been hurt
  if (b.hitWall && m.lastHurt && m.age - m.lastHurt < 20 && m.age >= (m.nextBreak || 0)) { m.nextBreak = m.age + 1; sim.breakAround(m); }
  return { wish: [(dx / l) * sp, (dz / l) * sp], jump: false };
}

// ---------------------------------------------------------------- vehicles
// A boat floats on the water; its rider rows it forward and turns it.
function boat(m) {
  const sim = m.sim, b = m.body, w = sim.world, c = m.rider ? m.control : null;
  const p = b.pos, v = b.vel;
  // the water's surface under the boat
  const bx = Math.floor(p[0]), bz = Math.floor(p[2]);
  let surface = null;
  for (let y = Math.floor(p[1] + 0.6); y >= Math.floor(p[1] - 1.2); y--) {
    if (w.getBlock(bx, y, bz) === BLOCK.WATER) { surface = y + 1; break; }
  }
  const onIce = w.getBlock(bx, Math.floor(p[1] - 0.1), bz) === BLOCK.ICE;
  if (surface !== null) {
    b.gravity = 0;
    v[1] += ((surface - 0.28 - p[1]) * 8 - v[1]) * 0.35;
  } else b.gravity = 28;
  if (c) {
    m.yaw -= c.strafe * 2.4 * TICK;
    const thrust = c.forward * (surface !== null ? 9 : onIce ? 14 : 1.2);
    v[0] += -Math.sin(m.yaw) * thrust * TICK;
    v[2] += -Math.cos(m.yaw) * thrust * TICK;
    if (c.forward || c.strafe) m.rowPhase = (m.rowPhase || 0) + TICK * 9;
  }
  const max = surface !== null ? 8 : onIce ? 30 : 1.5;
  const hs = Math.hypot(v[0], v[2]);
  if (hs > max) { v[0] *= max / hs; v[2] *= max / hs; }
  // water drag; ice barely slows it; land a lot
  const drag = surface !== null ? 0.96 : onIce ? 0.995 : 0.6;
  v[0] *= drag; v[2] *= drag;
  m.headYaw = m.yaw;
  return { wish: null, jump: false };
}

const RAIL_CHECK = [0, -1, 1];
// A minecart runs along rails (up and down slopes and round curves); powered rails push it along.
function minecart(m) {
  const sim = m.sim, b = m.body, w = sim.world, c = m.rider ? m.control : null;
  const p = b.pos, v = b.vel;
  const x = Math.floor(p[0]), z = Math.floor(p[2]);
  let ry = null, rb = 0;
  for (const dy of RAIL_CHECK) {
    const y = Math.floor(p[1] + 0.05) + dy;
    const blk = w.getBlock(x, y, z);
    if (IS_RAIL[blk]) { ry = y; rb = blk; break; }
  }
  if (ry === null) { b.gravity = 28; b.drag = 1.5; m.onRail = false; return { wish: null, jump: false }; }
  m.onRail = true;
  b.gravity = 0;
  const shape = RAIL_SHAPES[w.getState(x, ry, z) & 15] || RAIL_SHAPES[0];
  const e0 = FACING[shape.ends[0]], e1 = FACING[shape.ends[1]];
  let speed = Math.hypot(v[0], v[2]);
  // which way it is going along this piece
  let dir = (v[0] * e0[0] + v[2] * e0[1]) >= (v[0] * e1[0] + v[2] * e1[1]) ? e0 : e1;
  if (speed < 0.02) dir = m.railDir && (m.railDir[0] === e0[0] && m.railDir[1] === e0[1] || m.railDir[0] === e1[0] && m.railDir[1] === e1[1]) ? m.railDir : e0;
  // the rider pushes it along the way they look
  if (c && c.forward) {
    const lx = -Math.sin(c.yaw), lz = -Math.cos(c.yaw);
    const along = lx * dir[0] + lz * dir[1];
    const other = dir === e0 ? e1 : e0;
    const alongOther = lx * other[0] + lz * other[1];
    if (alongOther > along + 0.3 && speed < 0.5) dir = other;
    speed += Math.sign(c.forward) * 5 * TICK * (Math.max(along, alongOther) > 0 ? 1 : -1);
    if (speed < 0) { speed = -speed; dir = dir === e0 ? e1 : e0; }
  }
  // slopes speed it up going down and slow it going up
  if (shape.up !== undefined) {
    const u = FACING[shape.up];
    const goingUp = dir[0] === u[0] && dir[1] === u[1];
    speed += (goingUp ? -6 : 6) * TICK;
    if (speed < 0) { speed = -speed; dir = goingUp ? [-u[0], -u[1]] : u; }
  }
  if (rb === 2) {
    // powered rail: a push along, and a kick away from a wall when standing still
    if (speed > 0.05) speed = Math.min(8, speed + 14 * TICK);
    else {
      for (const e of [e0, e1]) if (IS_SOLID[w.getBlock(x - e[0], ry, z - e[1])]) { dir = e; speed = 3; }
    }
  }
  speed = Math.min(8, speed * (c ? 0.997 : 0.994));
  m.railDir = dir;
  // stay on the line of the rail
  const cx = x + 0.5, cz = z + 0.5;
  if (dir[0] !== 0) p[2] += (cz - p[2]) * 0.4; else p[0] += (cx - p[0]) * 0.4;
  let nx = p[0] + dir[0] * speed * TICK, nz = p[2] + dir[1] * speed * TICK;
  // a wall ahead stops it
  if (IS_SOLID[w.getBlock(Math.floor(nx + dir[0] * 0.49), ry, Math.floor(nz + dir[1] * 0.49))] && !IS_RAIL[w.getBlock(Math.floor(nx + dir[0] * 0.49), ry + 1, Math.floor(nz + dir[1] * 0.49))]) {
    speed = 0; nx = p[0]; nz = p[2];
  }
  p[0] = nx; p[2] = nz;
  // height: on a slope it follows the incline
  let y = ry + 0.0625;
  const shape2 = RAIL_SHAPES[w.getState(Math.floor(nx), ry, Math.floor(nz)) & 15];
  if (IS_RAIL[w.getBlock(Math.floor(nx), ry, Math.floor(nz))] && shape2 && shape2.up !== undefined) {
    const u = FACING[shape2.up];
    const fx = nx - Math.floor(nx), fz = nz - Math.floor(nz);
    const k = u[0] > 0 ? fx : u[0] < 0 ? 1 - fx : u[1] > 0 ? fz : 1 - fz;
    y = ry + k + 0.0625;
  }
  p[1] = y;
  v[0] = dir[0] * speed; v[2] = dir[1] * speed; v[1] = 0;
  m.yaw = Math.atan2(-dir[0], -dir[1]);
  m.headYaw = m.yaw;
  return { wish: null, jump: false, moved: true };
}

// ---------------------------------------------------------------- the ones that only wait
function tntTick(m) {
  const b = m.body;
  m.fuse -= TICK;
  b.gravity = 28;
  b.step(TICK, null, false, {});
  if (m.fuse <= 0) {
    m.removed = true;
    m.sim.explode(b.pos[0], b.pos[1] + 0.5, b.pos[2], 4, m);
  }
  return true;
}

function fangsTick(m) {
  m.age += 0; // (age is kept by update)
  if (m.delay > 0) { m.delay -= TICK; m.renderScale = 0.001; return true; }
  m.renderScale = 1;
  m.life = (m.life || 0) + TICK;
  m.fangAge = m.life;
  if (!m.bit && m.life >= 0.4) {
    m.bit = true;
    const sim = m.sim, p = m.body.pos;
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob' || e === m || e.id === m.owner || e.def.illager || e.def.fixed || e.deathTime > 0) continue;
      if (Math.abs(e.body.pos[0] - p[0]) < 0.9 && Math.abs(e.body.pos[2] - p[2]) < 0.9 && Math.abs(e.body.pos[1] - p[1]) < 1.5) e.hurt(6, p, 0.3);
    }
    for (const pl of sim.players.values()) {
      if (Math.abs(pl.pos[0] - p[0]) < 0.9 && Math.abs(pl.pos[2] - p[2]) < 0.9 && Math.abs(pl.pos[1] - p[1]) < 1.5) sim.damagePlayer(pl.id, 6 * sim.diff.damage, 'evoker', p);
    }
    sim.emit({ type: 'sound', name: 'fangs', pos: p.slice() });
  }
  if (m.life > 1.1) m.removed = true;
  return true;
}

export const BRAINS = {
  villager, iron_golem: ironGolem, wolf, cat, horse,
  cod: (m) => swimmer(m), salmon: (m) => swimmer(m), tropical_fish: (m) => swimmer(m), pufferfish,
  squid: (m) => swimmer(m, { bursts: true }), guardian, elder_guardian: guardian,
  witch, slime, phantom, evoker, shulker, wither, boat, minecart,
};
export const TICKERS = { tnt: tntTick, evoker_fangs: fangsTick };

// Status effects on creatures: poison and wither hurt, instant health heals the living and
// harms the undead (and the other way round).
export function tickMobEffects(m) {
  const fx = m.effects;
  if (!fx) return;
  for (const [k, e] of Object.entries(fx)) {
    e.t -= TICK;
    if (e.t <= 0) { delete fx[k]; continue; }
    if (k === 'poison' && !m.def.undead && m.health > 1 && Math.floor(e.t * 20) % 25 === 0) { m.hurtTime = 0; m.hurt(1, null, 0); }
    if (k === 'wither' && Math.floor(e.t * 20) % 40 === 0) { m.hurtTime = 0; m.hurt(1, null, 0); }
    if (k === 'regeneration' && Math.floor(e.t * 20) % 50 === 0) m.health = Math.min(m.def.health, m.health + 1);
    if (k === 'levitation') m.body.vel[1] = Math.max(m.body.vel[1], 1.6);
  }
}

export function effectMob(m, key, secs, amp = 0) {
  if (m.def.fixed || m.def.vehicle || m.def.boss) return;
  if (key === 'instant_health' || key === 'instant_damage') {
    const harm = (key === 'instant_damage') !== !!m.def.undead;
    const n = 6 * (amp + 1);
    if (harm) { m.hurtTime = 0; m.hurt(n, null, 0.2); } else m.health = Math.min(m.def.health, m.health + n);
    return;
  }
  m.effects = m.effects || {};
  addEffect(m.effects, key, secs, amp);
}
