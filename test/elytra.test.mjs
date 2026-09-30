// Taking off on elytra: a jump press in the air spreads them (straight after the jump too, as
// since Java 1.15), creative's double press spreads them rather than toggling flight, and a
// firework rocket takes off with them from the ground, the air or creative flight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../src/game/player.js';

// flat ground: solid below y = 64
const FLOOR = 64;
const world = {
  getBlock: (x, y) => (y < FLOOR ? 1 : 0),
  getState: () => 0,
  isSolidAt: (x, y) => y < FLOOR,
  boxCollides: (x0, y0) => y0 < FLOOR,
  climbableAt: () => false,
};
const DT = 1 / 60;
const idle = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };

function standing(canGlide = true) {
  const p = new Player(world);
  p.pos = [0.5, FLOOR + 0.5, 0.5];
  p.canGlide = canGlide;
  for (let i = 0; i < 60; i++) p.update(DT, idle);
  assert.ok(p.onGround, 'standing on the ground');
  return p;
}

test('elytra: jump, then press jump again straight away (still going up) and they spread', () => {
  const p = standing();
  // the press that jumps doesn't also spread them (nor does holding it)
  p.update(DT, { ...idle, jump: true, jumpPressed: true });
  assert.ok(p.vel[1] > 5 && !p.gliding, 'a jump, no wings yet');
  for (let i = 0; i < 5; i++) p.update(DT, { ...idle, jump: true });
  assert.ok(!p.gliding && !p.onGround && p.vel[1] > 1, 'still rising, still not gliding');
  // the second press, while rising: they spread (before 1.15 this had to wait for the fall)
  p.update(DT, { ...idle, jumpPressed: true });
  assert.ok(p.gliding, 'gliding');
  // without elytra the same press does nothing
  const q = standing(false);
  q.update(DT, { ...idle, jump: true, jumpPressed: true });
  for (let i = 0; i < 5; i++) q.update(DT, idle);
  q.update(DT, { ...idle, jumpPressed: true });
  assert.ok(!q.gliding);
});

test('creative: the double press in the air spreads the elytra instead of toggling flight', () => {
  const p = standing();
  p.update(DT, { ...idle, jump: true, jumpPressed: true });
  for (let i = 0; i < 8; i++) p.update(DT, idle);
  // a double tap (toggleFly) whose second press comes in the air
  p.update(DT, { ...idle, jumpPressed: true, toggleFly: true });
  assert.ok(p.gliding && !p.flying, 'gliding, not flying');
  // no elytra: the double tap flies as ever
  const q = standing(false);
  q.update(DT, { ...idle, jump: true, jumpPressed: true });
  for (let i = 0; i < 8; i++) q.update(DT, idle);
  q.update(DT, { ...idle, jumpPressed: true, toggleFly: true });
  assert.ok(q.flying && !q.gliding, 'flying');
  // flying with elytra on: the double tap that stops flying doesn't also spread them
  q.canGlide = true;
  q.update(DT, { ...idle, jumpPressed: true, toggleFly: true });
  assert.ok(!q.flying && !q.gliding, 'falling, wings still folded');
  // and gliding, switching flight on (F, the fly button) flies instead
  p.update(DT, { ...idle, toggleFly: true });
  assert.ok(p.flying && !p.gliding, 'from gliding to flying');
});

test('a firework takes off with the elytra: from the ground, the air or creative flight', () => {
  // standing, looking up at the sky
  const p = standing();
  p.pitch = 0.9;
  assert.ok(p.takeOff(), 'the elytra spread');
  p.boost = 1.6;
  const y0 = p.pos[1];
  for (let i = 0; i < 60; i++) p.update(DT, idle);
  assert.ok(p.gliding, 'still gliding (not landed at once)');
  assert.ok(p.pos[1] - y0 > 12, 'the rocket carried them up: ' + (p.pos[1] - y0).toFixed(1) + ' blocks');
  // looking straight ahead, they still get off the ground and away
  const f = standing();
  f.pitch = 0.05;
  f.takeOff();
  f.boost = 1.6;
  for (let i = 0; i < 30; i++) f.update(DT, idle);
  assert.ok(f.gliding && Math.hypot(f.pos[0], f.pos[2]) > 8, 'away along the way they look');
  // flying in creative: flight gives way to the glide
  const c = standing();
  c.flying = true;
  c.pos[1] += 5;
  c.onGround = false;
  assert.ok(c.takeOff() && c.gliding && !c.flying);
  // no elytra, or in water: nothing
  assert.equal(standing(false).takeOff(), false);
  const w = standing();
  w.inWater = true;
  assert.equal(w.takeOff(), false);
});

test('gliding ends on landing', () => {
  const p = standing();
  p.pos[1] += 20;
  p.onGround = false;
  p.pitch = -0.6;
  p.vel = [0, -2, -8];
  p.gliding = true;
  let t = 0;
  while (p.gliding && t < 600) { p.update(DT, idle); t++; }
  assert.ok(!p.gliding && p.onGround, 'landed after ' + t + ' steps');
});
