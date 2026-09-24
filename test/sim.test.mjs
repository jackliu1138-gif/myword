import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Inventory } from '../src/sim/inventory.js';
import { ITEM, RECIPES, itemDef, breakInfo, blockDrops } from '../src/sim/items.js';
import { findPath } from '../src/sim/path.js';
import { Simulation } from '../src/sim/simulation.js';
import { BLOCK, IS_SOLID } from '../src/world/blocks.js';

// a flat stone world with an optional wall, enough for bodies and path finding
function flatWorld(wallX = null) {
  const get = (x, y, z) => (y <= 10 ? BLOCK.STONE : wallX !== null && x === wallX && y <= 13 && z > -20 && z < 20 ? BLOCK.STONE : 0);
  return {
    getBlock: get,
    isSolidAt: (x, y, z) => !!IS_SOLID[get(x, y, z)],
    getLight: () => [15, 0],
    isChunkReady: () => true,
    surfaceHeight: () => 10,
    setBlock: () => true,
  };
}

test('inventory stacks, takes and wears tools out', () => {
  const inv = new Inventory();
  assert.equal(inv.add(BLOCK.DIRT, 100), 0);
  assert.equal(inv.slots[0].count, 64);
  assert.equal(inv.slots[1].count, 36);
  assert.equal(inv.take(BLOCK.DIRT, 70), 70);
  assert.equal(inv.count(BLOCK.DIRT), 30);
  inv.add(ITEM.WOODEN_SWORD, 1);
  const i = inv.slots.findIndex((s) => s && s.id === ITEM.WOODEN_SWORD);
  assert.equal(inv.wear(i, itemDef(ITEM.WOODEN_SWORD).durability - 1), false);
  assert.equal(inv.wear(i, 1), true);
  assert.equal(inv.slots[i], null);
  inv.add(BLOCK.OAK_PLANKS, 2); inv.add(BLOCK.BIRCH_PLANKS, 2);
  assert.equal(inv.count('planks'), 4);
});

test('every recipe and drop refers to real items', () => {
  for (const [out, n, ings] of RECIPES) {
    assert.ok(itemDef(out), 'recipe output ' + out);
    assert.ok(n >= 1);
    for (const [id, c] of ings) assert.ok(id === 'planks' || itemDef(id), 'ingredient ' + id);
  }
  for (const b of [BLOCK.STONE, BLOCK.GRASS, BLOCK.COAL_ORE, BLOCK.OAK_LOG]) for (const [id] of blockDrops(b)) assert.ok(itemDef(id));
  // stone needs a pickaxe to drop anything; the right tool is faster
  assert.equal(breakInfo(BLOCK.STONE, 0).drops, false);
  assert.equal(breakInfo(BLOCK.STONE, ITEM.WOODEN_PICKAXE).drops, true);
  assert.ok(breakInfo(BLOCK.OAK_LOG, ITEM.STONE_AXE).time < breakInfo(BLOCK.OAK_LOG, 0).time);
});

test('path finding walks around a wall', () => {
  const w = flatWorld(3);
  const path = findPath(w, [0, 11, 0], [6, 11, 0], { maxNodes: 4000 });
  assert.ok(path && path.length > 6);
  const last = path[path.length - 1];
  assert.deepEqual([last[0], last[2]], [6, 0]);
  for (const [x, y, z] of path) assert.ok(!w.isSolidAt(x, y, z) && w.isSolidAt(x, y - 1, z));
});

test('a zombie chases and hurts a survival player, never a creative one', () => {
  const w = flatWorld();
  const sim = new Simulation(w, { difficulty: 'normal', spawnMobs: false });
  const p = sim.addPlayer('p', { pos: [0.5, 11, 0.5], mode: 'survival' });
  const z = sim.spawnMob('zombie', 8.5, 11, 0.5);
  const env = { dayTime: 0.6 }; // night: no sunburn
  for (let i = 0; i < 200 && p.health === 20; i++) sim.tick(env);
  assert.ok(Math.hypot(z.body.pos[0] - p.pos[0], z.body.pos[2] - p.pos[2]) < 2.5, 'zombie reached the player');
  assert.ok(p.health < 20, 'player got hurt');
  const c = sim.addPlayer('c', { pos: [0.5, 11, 5.5], mode: 'creative' });
  p.mode = 'creative';
  for (let i = 0; i < 100; i++) sim.tick(env);
  assert.equal(c.health, 20);
  // killing it drops loot
  z.hurtTime = 0;
  z.hurt(100, null);
  for (let i = 0; i < 30; i++) sim.tick(env);
  assert.ok(!sim.entities.has(z.id));
});
