import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as J from '../src/sim/jetform.js';
import { Simulation, FORCE_SOURCES } from '../src/sim/simulation.js';
import { ITEM, RECIPES } from '../src/sim/items.js';
import { MOBS } from '../src/sim/entities.js';
import { BLOCK, IS_SOLID } from '../src/world/blocks.js';
import { jetFloats, emitJet, emitMissile, emitTracer } from '../src/render/jet.js';

// a world of stone up to y = 10 (and an obsidian pillar), whose blocks can be broken
function stoneWorld() {
  const changed = new Map();
  const base = (x, y, z) => (y <= 10 ? BLOCK.STONE : x === 0 && z === 4 && y <= 14 ? BLOCK.OBSIDIAN : 0);
  const get = (x, y, z) => { const k = x + ',' + y + ',' + z; return changed.has(k) ? changed.get(k) : base(x, y, z); };
  return {
    changed,
    getBlock: get,
    getState: () => 0,
    isSolidAt: (x, y, z) => !!IS_SOLID[get(x, y, z)],
    getLight: () => [15, 0],
    isChunkReady: () => true,
    surfaceHeight: () => 10,
    setBlock: (x, y, z, id) => { if (get(x, y, z) === id) return false; changed.set(x + ',' + y + ',' + z, id); return true; },
  };
}

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('the F-22 turns the way its controls say: pitch lifts the nose, roll banks it, yaw turns it', () => {
  // heading, climb and bank in and out of a quaternion
  for (const [yaw, pitch, roll] of [[0, 0, 0], [0.7, 0.2, -0.4], [-2.5, -0.5, 1.1], [3, 0.1, 0.3]]) {
    const a = J.attitude(J.quatToMat(J.quatFromEuler(yaw, pitch, roll)));
    assert.ok(near(Math.atan2(Math.sin(a.yaw - yaw), Math.cos(a.yaw - yaw)), 0, 1e-9), 'yaw ' + yaw);
    assert.ok(near(a.pitch, pitch, 1e-9), 'pitch ' + pitch);
    // (its bank, as a pilot has it: the right wing down is a bank to the right, positive)
    assert.ok(near(a.roll, -roll, 1e-9), 'bank ' + roll);
  }
  // its nose is -z: at yaw 0, flying level, it points to -z
  const R = J.quatToMat(J.quatFromEuler(0, 0, 0));
  assert.deepEqual([-R[2], -R[5], -R[8]].map((v) => Math.round(v * 1000) / 1000 + 0), [0, 0, -1]);
  // turning about +x for a second lifts the nose; about +z lifts the right wing (a roll to the left)
  let q = J.quatTurn(J.quatFromEuler(0, 0, 0), [0.3, 0, 0], 1);
  assert.ok(near(J.attitude(J.quatToMat(q)).pitch, 0.3, 1e-9));
  q = J.quatTurn(J.quatFromEuler(0, 0, 0), [0, 0, 0.4], 1);
  const Rr = J.quatToMat(q);
  assert.ok(Rr[3] > 0.3, 'the right wing goes up');
  assert.ok(J.attitude(Rr).roll < 0);
  // about +y the nose goes to the left (-x)
  q = J.quatTurn(J.quatFromEuler(0, 0, 0), [0, 0.5, 0], 1);
  const Ry = J.quatToMat(q);
  assert.ok(-Ry[2] < -0.4, 'the nose swings left');
});

test('the F-22 is its real size, and the crosshair finds it by its shape', () => {
  assert.ok(near(J.LENGTH, 18.9) && near(J.SPAN, 13.56));
  assert.ok(near(J.TAIL_Z - J.NOSE_Z, 19.1, 0.3), 'nose to nozzles');
  assert.ok(near(J.WING.tipX * 2, J.SPAN));
  // the wings' leading edges are swept 42 degrees, their trailing edges -17
  const le = (Math.atan2(J.WING.tipLE - J.WING.rootLE, J.WING.tipX - J.WING.rootX) * 180) / Math.PI;
  const te = (Math.atan2(J.WING.tipTE - J.WING.rootTE, J.WING.tipX - J.WING.rootX) * 180) / Math.PI;
  assert.ok(Math.abs(le - 42) < 1.5, 'leading edge ' + le.toFixed(1));
  assert.ok(Math.abs(te + 17) < 1.5, 'trailing edge ' + te.toFixed(1));
  for (const yaw of [0, 1, -2.4]) {
    const R = J.quatToMat(J.quatFromEuler(yaw, 0, 0));
    const tip = J.toWorld([0, J.GEAR_H, 0], R, [6.2, 0, 2.2]);
    assert.ok(J.rayHit([tip[0], 30, tip[2]], [0, -1, 0], [0, 0, 0], yaw, 100) !== null, 'a wing tip');
    const off = J.toWorld([0, J.GEAR_H, 0], R, [6.2, 0, -7]);
    assert.equal(J.rayHit([off[0], 30, off[2]], [0, -1, 0], [0, 0, 0], yaw, 100), null, 'ahead of the wing');
    // from the side, at the cockpit: hits the fuselage, a metre and a half from its middle
    const side = J.toWorld([0, J.GEAR_H, 0], R, [8, 0.3, -5]);
    const t = J.rayHit(side, [-R[0], -R[3], -R[6]], [0, 0, 0], yaw, 20);
    assert.ok(t !== null && near(t, 8 - 1.65, 0.01), 'the fuselage side ' + t);
  }
});

test('its model, missiles and tracers come out whole', () => {
  const out = new Float32Array(jetFloats() + 4096);
  const R = J.quatToMat(J.quatFromEuler(0.4, 0.1, -0.3));
  const n = emitJet(out, 0, [10, 80, 10], R, [0, 70, 0], [1, 0], 1.5, { gear: 0.4, ab: 1, throttle: 1, vector: 0.5, bays: 0.6, gun: true, missiles: 5, flaps: 0.3, stab: 0.2, roll: -0.4, yaw: 0.1, eye: 1 });
  assert.ok(n > 16 * 3000 && n <= out.length);
  for (let i = 0; i < n; i++) assert.ok(Number.isFinite(out[i]), 'finite at ' + i);
  const n2 = emitMissile(out, 0, [0, 80, 0], [0.3, -0.2, -0.9], [0, 70, 0], [1, 0], 1, true, 1);
  assert.ok(n2 > 0 && n2 % 16 === 0);
  const n3 = emitTracer(out, 0, [0, 80, -50], [0, 0, -850], [0, 70, 0], 1);
  assert.equal(n3, 12 * 16);
  // a parked jet: no fire in its nozzles
  const p = emitJet(out, 0, [0, 72, 0], J.quatToMat(J.quatFromEuler(0, 0, 0)), [0, 70, 0], [1, 0], 0, { gear: 1, parked: true });
  assert.ok(p > 0);
});

test('an F-22 to make, put down and fly: the item, its recipe and the parked jet', () => {
  assert.ok(ITEM.F22_RAPTOR > 0);
  assert.ok(RECIPES.some(([out]) => out === ITEM.F22_RAPTOR));
  assert.equal(MOBS.jet.vehicle, 'jet');
  assert.ok(MOBS.jet.drops.some(([id]) => id === ITEM.F22_RAPTOR));
  // (added at the end: the creature types' numbers on the wire never change)
  assert.equal(Object.keys(MOBS).at(-1), 'jet');
});

test("a missile's blast breaks everything in its radius (obsidian too) and kills creative players, but not the one who fired it", () => {
  const w = stoneWorld();
  const sim = new Simulation(w, { difficulty: 'normal' });
  const me = sim.addPlayer('local', { mode: 'creative' });
  me.pos = [0, 11, -30];
  const them = sim.addPlayer('p2', { mode: 'creative' });
  them.pos = [3, 11, 2];
  const n = sim.strike(0.5, 11, 0.5, { power: 7, cause: 'missile', spare: 'local', all: true });
  assert.ok(n > 300, 'broke ' + n);
  // a crater: the middle is gone, deep enough; far outside it nothing changed
  assert.equal(w.getBlock(0, 10, 0), 0);
  assert.equal(w.getBlock(0, 6, 0), 0);
  assert.equal(w.getBlock(0, 11, 4), 0, 'the obsidian pillar');
  assert.equal(w.getBlock(20, 10, 20), BLOCK.STONE);
  assert.ok(them.dead, 'the creative player in the blast');
  assert.ok(!me.dead && me.health === 20, 'the one who fired it');
  assert.ok(FORCE_SOURCES.has('missile') && FORCE_SOURCES.has('jetgun'));
});

test("a cannon round breaks the block it hits and a little round it, by its firepower; obsidian stays without `all`", () => {
  const w = stoneWorld();
  const sim = new Simulation(w, { difficulty: 'normal' });
  sim.addPlayer('local', { mode: 'survival' }).pos = [50, 11, 50];
  let n = sim.strike(5.5, 10.5, 5.5, { radius: 0.7, damage: 4, reach: 2, cause: 'jetgun', spare: 'local', blast: false });
  assert.equal(n, 1);
  assert.equal(w.getBlock(5, 10, 5), 0);
  n = sim.strike(12.5, 10.5, 12.5, { radius: 1.7, damage: 8, reach: 3, cause: 'jetgun', spare: 'local', blast: false });
  assert.ok(n >= 7 && n <= 19, 'firepower 5: ' + n);
  n = sim.strike(0.5, 12.5, 4.5, { radius: 0.7, damage: 4, reach: 2, cause: 'jetgun', blast: false });
  assert.equal(n, 0, 'obsidian holds against a round');
  assert.equal(w.getBlock(0, 12, 4), BLOCK.OBSIDIAN);
  // a survival player in the way of a round is hurt
  const p = sim.addPlayer('p3', { mode: 'survival' });
  p.pos = [20.5, 11, 20.5];
  sim.strike(20.5, 11.9, 20.5, { radius: 0.7, damage: 9, reach: 2.4, cause: 'jetgun', spare: 'local', blast: false });
  assert.ok(p.health < 20, 'hurt: ' + p.health);
});

// ---------------------------------------------------------------- round 9's others: carpets, the base
import { blockBoxes, BLOCK as BL, WOOL_OF_DYE, DYES, WORLD_HEIGHT } from '../src/world/blocks.js';
import { blockDrops, CARPET_ITEMS, BED_ITEMS, itemDef } from '../src/sim/items.js';
import { createGenerator } from '../src/world/dimensions.js';
import { planSaucerBase, pasteSaucerBase, BASE_PADS, BASE_PAD_RING } from '../src/world/saucerbase.js';
import { ChunkCtx } from '../src/world/structures.js';

test('carpets: sixteen colours from wool, a thin rug on the floor, a blanket draped over a bed, and each drops its own colour', () => {
  assert.equal(CARPET_ITEMS.length, 16);
  assert.equal(DYES.length, 16);
  for (let i = 0; i < 16; i++) {
    const r = RECIPES.find(([out]) => out === CARPET_ITEMS[i]);
    assert.ok(r && r[1] === 3 && r[2][0][0] === WOOL_OF_DYE[i] && r[2][0][1] === 2, 'recipe ' + i);
    assert.deepEqual(blockDrops(BL.CARPET, Math.random, i), [[CARPET_ITEMS[i], 1]]);
  }
  // on the floor: a sixteenth of a block thick, the whole cell across
  const floor = blockBoxes(BL.CARPET, 4, () => BL.STONE, () => 0);
  assert.equal(floor.length, 1);
  assert.deepEqual(floor[0].b, [0, 0, 0, 16, 1, 16]);
  // on a bed (the foot half, its head to the north): lying on the mattress, down three sides, and
  // nothing to bump into
  const foot = itemDef(BED_ITEMS.red).foot;
  assert.ok(foot > 0);
  const nb = (dx, dy, dz) => (dy === -1 && dx === 0 && (dz === 0 || dz === -1) ? foot : 0);
  const drape = blockBoxes(BL.CARPET, 11, nb, () => 0);
  assert.ok(drape.length >= 4, 'a blanket and the sides it hangs down');
  assert.ok(drape.every((p) => p.b[1] < 0), 'below the carpet cell: over the mattress');
  assert.equal(blockBoxes(BL.CARPET, 11, nb, () => 0, 'collide').length, 0);
});

test('the Earth saucer base: one to a world, the same for a seed, five pads round its tower, built into the land', () => {
  const gen = createGenerator(4242, 0, 2);
  const plan = planSaucerBase(gen);
  assert.ok(plan, 'a base');
  assert.deepEqual(planSaucerBase(createGenerator(4242, 0, 2)), plan, 'the same for everyone with the seed');
  assert.equal(plan.pads.length, BASE_PADS);
  for (const [px, pz] of plan.pads) assert.ok(Math.abs(Math.hypot(px - plan.x, pz - plan.z) - BASE_PAD_RING) < 1.5);
  assert.ok(Math.hypot(plan.x, plan.z) > 300, 'out from the middle');
  // the chunk with the tower: the deck at its height, cleared over it, the beacon on the mast
  const cx = Math.floor(plan.x / 16), cz = Math.floor(plan.z / 16);
  const blocks = new Uint8Array(16 * 16 * WORLD_HEIGHT);
  for (let y = 0; y < plan.y + 20; y++) for (let i = 0; i < 256; i++) blocks[(y << 8) | i] = BL.STONE;
  const ctx = new ChunkCtx(blocks, cx, cz, gen);
  pasteSaucerBase(ctx, plan);
  const at = (x, y, z) => ctx.get(x, y, z);
  assert.equal(at(plan.x, plan.y + 45, plan.z), BL.SEA_LANTERN, 'the beacon');
  assert.equal(at(plan.x, plan.y + 30, plan.z + 2), BL.SMOOTH_STONE, 'the cabin floor');
  const ox = plan.x + 13 < cx * 16 + 16 ? plan.x + 13 : plan.x - 13;
  assert.equal(at(ox, plan.y + 5, plan.z), 0, 'cleared over the deck');
  assert.ok(at(ox, plan.y, plan.z) > 0, 'the deck');
});

test('a missile fired from a hover goes off on what it was fired at, locked on or flying to the circle', async () => {
  const { installJet } = await import('../src/game/jet.js');
  function Fake() {}
  installJet(Fake);
  const g = new Fake();
  g.world = { getBlock: (x, y) => (y <= 69 ? BLOCK.STONE : 0), getChunk: () => ({ blocks: true }), columnTop: () => 70, getState: () => 0 };
  const target = [0.5, 71, 80.5];
  g.sim = { entities: new Map([[7, { kind: 'mob', id: 7, body: { pos: [target[0], 70, target[2]], h: 2, hw: 0.4 }, deathTime: 0 }]]), strike: (x, y, z) => { g.boom = [x, y, z]; return 0; } };
  g.particles = { smoke() {}, spark() {}, burst() {} };
  g.audio = {}; g.ui = { toast() {} };
  g.isCreative = () => true;
  g.jetBlast = () => {};
  for (const [from, locked] of [[[0.5, 92.95, 121.5], true], [[0.5, 92.95, 121.5], false], [[30, 100, 150], true], [[0.5, 75, 160], false]]) {
    g.boom = null; g.jetShots = [];
    g.player = { pos: from.slice(), yaw: 0, pitch: 0 };
    const d = [target[0] - from[0], target[1] - from[1], target[2] - from[2]];
    g.player.yaw = Math.atan2(-d[0], -d[2]); g.player.pitch = Math.asin(d[1] / Math.hypot(...d));
    g.camera = { pos: from.slice() };
    g.jet = g.newJetRide(from, g.player.yaw, {});
    g.jet.mode = 'hover'; g.jet.q = J.quatFromEuler(g.player.yaw, g.player.pitch, 0);
    g.jet.lock = locked ? { kind: 'mob', id: 7 } : null; g.jet.locked = locked;
    g.jetLaunch(g.jetRot());
    for (let i = 0; i < 600 && !g.boom; i++) g.updateJetShots(1 / 60);
    assert.ok(g.boom, 'it went off');
    const miss = Math.hypot(g.boom[0] - target[0], g.boom[1] - target[1], g.boom[2] - target[2]);
    assert.ok(miss < 3.5, `from ${from}, ${locked ? 'locked' : 'to the circle'}: ${miss.toFixed(1)} off`);
  }
});

test("a pilot's jet takes another player's fire, and shot down, its pilot dies with it (in creative too)", async () => {
  const { installJet } = await import('../src/game/jet.js');
  globalThis.document = globalThis.document || { body: { classList: { add() {}, remove() {} } } };
  function Fake() {}
  installJet(Fake);
  const g = new Fake();
  const sim = new Simulation(stoneWorld(), { difficulty: 'normal' });
  const me = sim.addPlayer('local', { mode: 'creative' });
  me.pos = [0.5, 40, 0.5];
  me.sheltered = true; // (in the jet: see Game.syncPlayerToSim)
  g.sim = sim;
  g.me = () => sim.players.get('local');
  g.world = stoneWorld();
  g.player = { pos: [0.5, 40, 0.5], vel: [0, 0, 0], yaw: 0, pitch: 0 };
  g.particles = { smoke() {}, spark() {}, burst() {} };
  g.audio = { play() {} }; g.ui = { toast() {}, setJetHud() {} };
  g.shake = 0;
  g.isCreative = () => true;
  g.jet = g.newJetRide(g.player.pos, 0, {});
  g.jet.mode = 'hover';
  // the cannon's hits come in a few at a time: the jet takes them, its pilot doesn't
  assert.equal(g.jetTakeHit(30, 'jetgun'), true);
  assert.ok(g.jet && g.jet.hp === 70);
  assert.equal(me.health, 20);
  // a missile's blast, far worse: shot down, and the pilot with it
  g.jetTakeHit(40, 'missile');
  assert.equal(g.jet, null, 'shot down');
  assert.ok(me.dead, 'its pilot');
});
