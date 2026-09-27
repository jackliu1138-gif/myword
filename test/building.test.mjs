// Block states, flowing liquids, shaped blocks, chests and furnaces, dropped items, saplings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World, chunkKey } from '../src/world/world.js';
import { ChunkMesher, VERTEX_BYTES, POS_BIAS } from '../src/world/mesher.js';
import { BLOCK, BLOCKS, WORLD_HEIGHT, LIQUID_FALLING, blockBoxes, collisionBoxes, facingOf, TEXTURE_NAMES } from '../src/world/blocks.js';
import { ITEM, blockDrops, SMELTING, fuelTime, RECIPES, itemDef } from '../src/sim/items.js';
import { Inventory, CONTAINER_REF, FURNACE_INPUT, FURNACE_FUEL, FURNACE_OUTPUT } from '../src/sim/inventory.js';
import { newEntity, tickFurnace, furnaceLit, serializeEntity, loadEntity, loadEntities, serializeEntities, contentsOf } from '../src/sim/containers.js';
import { Simulation } from '../src/sim/simulation.js';
import { raycast } from '../src/game/player.js';

const idx = (x, y, z) => (y << 8) | (z << 4) | x;

// a world of loaded chunks, stone up to y = 10
function flatWorld(r = 2) {
  const w = new World(1, { workers: 0 });
  for (let cz = -r; cz <= r; cz++) {
    for (let cx = -r; cx <= r; cx++) {
      const blocks = new Uint8Array(16 * 16 * WORLD_HEIGHT);
      for (let y = 0; y <= 10; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[idx(x, y, z)] = BLOCK.STONE;
      w.chunks.set(chunkKey(cx, cz), { cx, cz, key: chunkKey(cx, cz), blocks, states: null, version: 0, meshedVersion: -1, gpu: {} });
    }
  }
  return w;
}
const flow = (w, secs) => { for (let i = 0; i < secs * 20; i++) w.updateFluids(0.05); };

test('block states are kept beside their blocks, in edits (id | state << 8) and across other players', () => {
  const w = flatWorld(1);
  w.setBlock(3, 11, 4, BLOCK.OAK_STAIRS, { state: 2 | 4 });
  assert.equal(w.getBlock(3, 11, 4), BLOCK.OAK_STAIRS);
  assert.equal(w.getState(3, 11, 4), 6);
  assert.equal(w.edits.get(chunkKey(0, 0)).get(idx(3, 11, 4)), BLOCK.OAK_STAIRS | (6 << 8));
  // the same block with another state is a change; the same state is not
  assert.equal(w.setBlock(3, 11, 4, BLOCK.OAK_STAIRS, { state: 6 }), false);
  assert.equal(w.setBlock(3, 11, 4, BLOCK.OAK_STAIRS, { state: 1 }), true);
  const sent = [];
  w.onEdit = (x, y, z, v) => sent.push(v);
  w.setBlock(1, 11, 1, BLOCK.CHEST, { state: 3 });
  assert.deepEqual(sent, [BLOCK.CHEST | (3 << 8)]);
  // another player's edit, and a chunk generated later with a saved edit in it
  w.applyRemoteEdit(2, 11, 2, BLOCK.LADDER | (1 << 8));
  assert.deepEqual([w.getBlock(2, 11, 2), w.getState(2, 11, 2)], [BLOCK.LADDER, 1]);
  const key = chunkKey(5, 5);
  w.edits.set(key, new Map([[idx(1, 20, 1), BLOCK.OAK_DOOR | (12 << 8)], [idx(2, 20, 1), BLOCK.GLASS]]));
  w.chunks.set(key, { cx: 5, cz: 5, key, blocks: null, states: null, version: 0 });
  w.onResult({ type: 'gen', cx: 5, cz: 5, blocks: new Uint8Array(16 * 16 * WORLD_HEIGHT) });
  assert.deepEqual([w.getBlock(81, 20, 81), w.getState(81, 20, 81), w.getBlock(82, 20, 81), w.getState(82, 20, 81)], [BLOCK.OAK_DOOR, 12, BLOCK.GLASS, 0]);
  const restored = World.deserializeEdits(JSON.parse(JSON.stringify(w.serializeEdits())));
  assert.equal(restored.get(chunkKey(0, 0)).get(idx(1, 11, 1)), BLOCK.CHEST | (3 << 8));
  w.dispose();
});

test('water flows seven blocks on flat ground, falls down holes, dries up without its source, and makes new sources', () => {
  const w = flatWorld();
  w.setBlock(0, 11, 0, BLOCK.WATER);
  flow(w, 10);
  const row = [];
  for (let k = 0; k < 9; k++) row.push(w.getBlock(k, 11, 0) === BLOCK.WATER ? w.getState(k, 11, 0) : -1);
  assert.deepEqual(row, [0, 1, 2, 3, 4, 5, 6, 7, -1]);
  assert.equal(w.fluids.pending, 0);
  // a hole: the water falls into it (falling water is full) and spreads on at the bottom
  for (let y = 7; y <= 10; y++) w.setBlock(3, y, 0, 0);
  flow(w, 6);
  assert.equal(w.getBlock(3, 7, 0), BLOCK.WATER);
  assert.ok(w.getState(3, 7, 0) & LIQUID_FALLING);
  // no source, no water
  w.setBlock(0, 11, 0, 0);
  flow(w, 12);
  let left = 0;
  for (let z = -9; z <= 9; z++) for (let x = -9; x <= 9; x++) for (let y = 6; y <= 11; y++) if (w.getBlock(x, y, z) === BLOCK.WATER) left++;
  assert.equal(left, 0);
  // between two sources on firm ground, water becomes a source itself
  w.setBlock(10, 11, 10, BLOCK.WATER);
  w.setBlock(12, 11, 10, BLOCK.WATER);
  flow(w, 5);
  assert.deepEqual([w.getBlock(11, 11, 10), w.getState(11, 11, 10)], [BLOCK.WATER, 0]);
  w.dispose();
});

test('lava runs three blocks (seven in the Nether); lava meeting water turns to obsidian or cobblestone', () => {
  const w = flatWorld();
  w.setBlock(0, 11, 0, BLOCK.LAVA);
  flow(w, 20);
  const reach = [1, 2, 3, 4].map((k) => w.getBlock(k, 11, 0) === BLOCK.LAVA);
  assert.deepEqual(reach, [true, true, true, false]);
  // water poured next to flowing lava: cobblestone
  w.setBlock(2, 11, 2, BLOCK.WATER);
  flow(w, 5);
  assert.equal(w.getBlock(2, 11, 1), BLOCK.COBBLESTONE);
  // water flowing onto a lava source: obsidian
  w.setBlock(-8, 11, -8, BLOCK.LAVA);
  flow(w, 1);
  w.setBlock(-8, 11, -6, BLOCK.WATER);
  flow(w, 5);
  const around = [w.getBlock(-8, 11, -8), w.getBlock(-8, 11, -7)];
  assert.ok(around.includes(BLOCK.OBSIDIAN) || around.includes(BLOCK.COBBLESTONE));
  w.dispose();
  const nether = flatWorld();
  nether.dimension = 1;
  nether.setBlock(0, 11, 0, BLOCK.LAVA);
  flow(nether, 12);
  assert.equal(nether.getBlock(7, 11, 0), BLOCK.LAVA);
  nether.dispose();
});

test('slabs, stairs, fences, doors and gates collide by their shape', () => {
  const w = flatWorld(1);
  w.setBlock(2, 11, 2, BLOCK.OAK_SLAB, { state: 0 });
  assert.equal(w.boxCollides(2.2, 11.3, 2.2, 2.8, 11.45, 2.8), true);
  assert.equal(w.boxCollides(2.2, 11.55, 2.2, 2.8, 12.5, 2.8), false, 'the top half is free');
  w.setBlock(2, 11, 3, BLOCK.OAK_SLAB, { state: 1 });
  assert.equal(w.boxCollides(2.2, 11.1, 3.2, 2.8, 11.4, 3.8), false, 'a top slab leaves room underneath');
  // straight stairs going up to the north: the step is on the north half
  w.setBlock(4, 11, 4, BLOCK.STONE_STAIRS, { state: 0 });
  assert.equal(w.boxCollides(4.2, 11.6, 4.1, 4.8, 11.9, 4.4), true);
  assert.equal(w.boxCollides(4.2, 11.6, 4.6, 4.8, 11.9, 4.9), false);
  // fences reach 1.5 blocks up and join their neighbours
  w.setBlock(6, 11, 6, BLOCK.OAK_FENCE);
  w.setBlock(7, 11, 6, BLOCK.OAK_FENCE);
  assert.equal(w.boxCollides(6.45, 12.3, 6.45, 6.55, 12.45, 6.55), true);
  assert.equal(w.boxCollides(6.8, 11.5, 6.45, 6.95, 11.6, 6.55), true, 'the rail between the posts');
  assert.equal(w.boxCollides(6.45, 11.5, 6.05, 6.55, 11.6, 6.2), false, 'nothing to the north');
  // a closed door is a panel on the side it was placed from; open, it swings to the hinge side
  w.setBlock(8, 11, 8, BLOCK.OAK_DOOR, { state: 0 });
  assert.equal(w.boxCollides(8.3, 11.1, 8.9, 8.7, 11.9, 8.99), true);
  w.setBlock(8, 11, 8, BLOCK.OAK_DOOR, { state: 4 });
  assert.equal(w.boxCollides(8.3, 11.1, 8.9, 8.7, 11.9, 8.99), false);
  assert.equal(w.boxCollides(8.01, 11.1, 8.3, 8.1, 11.9, 8.7), true);
  // gates block when shut and let you through when open
  w.setBlock(10, 11, 10, BLOCK.OAK_FENCE_GATE, { state: 0 });
  assert.equal(w.boxCollides(10.3, 11.1, 10.4, 10.7, 12.3, 10.6), true);
  w.setBlock(10, 11, 10, BLOCK.OAK_FENCE_GATE, { state: 4 });
  assert.equal(w.boxCollides(10.3, 11.1, 10.4, 10.7, 12.3, 10.6), false);
  // signs and saplings don't block
  assert.deepEqual(collisionBoxes(BLOCK.OAK_SIGN, 0, () => 0, () => 0), []);
  w.dispose();
});

test('the crosshair outlines shaped blocks and reports the face it hit', () => {
  const w = flatWorld(1);
  w.setBlock(5, 11, 5, BLOCK.OAK_SLAB, { state: 0 });
  const down = raycast(w, [5.5, 14, 5.5], [0, -1, 0], 6);
  assert.deepEqual([down.x, down.y, down.z, down.block], [5, 11, 5, BLOCK.OAK_SLAB]);
  assert.deepEqual(down.normal, [0, 1, 0]);
  assert.ok(Math.abs(down.point[1] - 11.5) < 1e-6, 'it hits the top of the slab, half way up');
  // buckets look for liquid sources
  w.setBlock(7, 10, 7, BLOCK.WATER);
  assert.equal(raycast(w, [7.5, 14, 7.5], [0, -1, 0], 6).block, BLOCK.STONE, 'water is not a target');
  assert.equal(raycast(w, [7.5, 14, 7.5], [0, -1, 0], 6, { liquids: true }).liquid, true);
  w.dispose();
});

test('the mesher draws shaped blocks and slopes flowing water', () => {
  const blocks = new Uint8Array(16 * 16 * WORLD_HEIGHT);
  const states = new Uint8Array(16 * 16 * WORLD_HEIGHT);
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[idx(x, 10, z)] = BLOCK.STONE;
  blocks[idx(3, 11, 3)] = BLOCK.OAK_SLAB;
  const chunks = new Array(9).fill(null);
  const stateList = new Array(9).fill(null);
  chunks[4] = blocks;
  const slab = new ChunkMesher(null).mesh(0, 0, chunks);
  const ys = new Set();
  const v16 = new Uint16Array(slab.opaque);
  for (let i = 0; i < v16.length; i += VERTEX_BYTES / 2) ys.add(v16[i + 1] - POS_BIAS);
  assert.ok(ys.has(11 * 16 + 8), 'a vertex at the slab top, half way up the cell');
  // water: a source beside a cell of level 6 slopes down towards it
  blocks[idx(3, 11, 3)] = 0;
  blocks[idx(6, 11, 6)] = BLOCK.WATER;
  blocks[idx(7, 11, 6)] = BLOCK.WATER; states[idx(7, 11, 6)] = 6;
  stateList[4] = states;
  const water = new ChunkMesher(null).mesh(0, 0, chunks, null, stateList);
  const heights = new Set();
  const w16 = new Uint16Array(water.translucent);
  for (let i = 0; i < w16.length; i += VERTEX_BYTES / 2) heights.add(w16[i + 1] - POS_BIAS - 11 * 16);
  assert.ok(heights.has(14), 'the source stays near full');
  assert.ok([...heights].some((h) => h > 0 && h < 8), 'the flowing end is low');
});

test('every new block has its textures, and the shaped ones have boxes', () => {
  for (const key of ['chest', 'furnace', 'lit_furnace', 'oak_sapling', 'oak_door', 'ladder', 'iron_bars', 'oak_sign', 'oak_trapdoor']) {
    const d = BLOCKS[BLOCK[key.toUpperCase()]];
    for (const t of Object.values(d.tex)) assert.ok(TEXTURE_NAMES.includes(t), key + ' ' + t);
  }
  assert.ok(BLOCKS.length < 256 && TEXTURE_NAMES.length < 256);
  for (const d of BLOCKS) if (d.model) assert.ok(blockBoxes(d.id, 0, () => 0, () => 0, 'render').length > 0, d.key);
  assert.equal(facingOf(0, -1), 0);
  assert.equal(facingOf(1, 0.2), 1);
});

test('the furnace smelts with fuel, lava leaves its bucket, and a chest round-trips through a save', () => {
  const f = newEntity('furnace');
  f.slots[0] = { id: ITEM.RAW_IRON, count: 2, wear: 0 };
  f.slots[1] = { id: ITEM.COAL, count: 1, wear: 0 };
  assert.equal(furnaceLit(f), false);
  tickFurnace(f, 0.5);
  assert.equal(furnaceLit(f), true);
  assert.equal(f.slots[1], null, 'the coal went in');
  for (let i = 0; i < 40; i++) tickFurnace(f, 0.5);
  assert.deepEqual([f.slots[0], f.slots[2].id, f.slots[2].count], [null, ITEM.IRON_INGOT, 2]);
  // out of things to cook: the fire burns on, no new fuel is used
  const g = newEntity('furnace');
  g.slots[0] = { id: BLOCK.SAND, count: 1, wear: 0 };
  g.slots[1] = { id: ITEM.LAVA_BUCKET, count: 1, wear: 0 };
  tickFurnace(g, 1);
  assert.equal(g.slots[1].id, ITEM.BUCKET);
  assert.equal(g.burnMax, 1000);
  // a full output stops the cooking
  const h = newEntity('furnace');
  h.slots[0] = { id: BLOCK.COBBLESTONE, count: 5, wear: 0 };
  h.slots[1] = { id: ITEM.COAL, count: 5, wear: 0 };
  h.slots[2] = { id: BLOCK.STONE, count: 64, wear: 0 };
  tickFurnace(h, 20);
  assert.equal(h.slots[0].count, 5);
  assert.equal(h.slots[1].count, 5, 'no fuel spent on nothing');
  // saving
  const chest = newEntity('chest');
  chest.slots[3] = { id: ITEM.DIAMOND, count: 7, wear: 0 };
  chest.slots[4] = { id: ITEM.IRON_PICKAXE, count: 1, wear: 30 };
  const back = loadEntities(JSON.parse(JSON.stringify(serializeEntities(new Map([['1,2,3', chest], ['bad key', chest]])))));
  assert.deepEqual([...back.keys()], ['1,2,3']);
  assert.deepEqual(contentsOf(back.get('1,2,3')), [[ITEM.DIAMOND, 7, 0], [ITEM.IRON_PICKAXE, 1, 30]]);
  assert.equal(loadEntity({ kind: 'chest', slots: [[99999, 1, 0], [ITEM.DIAMOND, 500, 0]] }).slots[1].count, 64, 'stacks are clamped');
  assert.equal(loadEntity({ kind: 'nonsense' }), null);
  assert.deepEqual(loadEntity({ kind: 'sign', lines: ['a\u0000b', 'x'.repeat(40)] }).lines, ['ab', 'x'.repeat(18), '', '']);
  assert.deepEqual(serializeEntity(back.get('1,2,3')).slots[3], [ITEM.DIAMOND, 7, 0]);
});

test('shift-click moves stacks between the inventory and an open chest or furnace', () => {
  const inv = new Inventory();
  inv.container = newEntity('chest');
  inv.slots[10] = { id: BLOCK.OAK_LOG, count: 20, wear: 0 };
  assert.equal(inv.quickMove(10), true);
  assert.deepEqual(inv.container.slots[0], { id: BLOCK.OAK_LOG, count: 20, wear: 0 });
  assert.equal(inv.slots[10], null);
  assert.equal(inv.quickMove(CONTAINER_REF), true);
  assert.equal(inv.count(BLOCK.OAK_LOG), 20);
  // a furnace sorts what goes where: things to smelt on top, fuel below; nothing goes into the output
  inv.container = newEntity('furnace');
  inv.slots[11] = { id: ITEM.RAW_GOLD, count: 3, wear: 0 };
  inv.slots[12] = { id: ITEM.COAL, count: 4, wear: 0 };
  inv.quickMove(11);
  inv.quickMove(12);
  assert.equal(inv.container.slots[0].id, ITEM.RAW_GOLD);
  assert.equal(inv.container.slots[1].id, ITEM.COAL);
  inv.cursor = { id: ITEM.GOLD_INGOT, count: 1, wear: 0 };
  assert.equal(inv.accepts(FURNACE_OUTPUT, inv.cursor), false);
  assert.equal(inv.accepts(FURNACE_FUEL, { id: ITEM.DIAMOND, count: 1 }), false);
  assert.equal(inv.accepts(FURNACE_INPUT, { id: ITEM.DIAMOND, count: 1 }), true);
  // the output can be taken, and added to what is already held
  inv.container.slots[2] = { id: ITEM.GOLD_INGOT, count: 2, wear: 0 };
  assert.equal(inv.click(FURNACE_OUTPUT, 0), true);
  assert.deepEqual([inv.cursor.count, inv.container.slots[2]], [3, null]);
  let changes = 0;
  inv.onContainerChange = () => changes++;
  inv.cursor = null;
  inv.click(FURNACE_INPUT, 0);
  assert.ok(changes > 0, 'the container hears about it');
});

test('iron and gold need smelting now; chests, furnaces, slabs and stairs can be crafted', () => {
  assert.deepEqual(blockDrops(BLOCK.IRON_ORE), [[ITEM.RAW_IRON, 1]]);
  assert.deepEqual(SMELTING.get(ITEM.RAW_IRON), [ITEM.IRON_INGOT, 1]);
  assert.deepEqual(SMELTING.get(BLOCK.SAND), [BLOCK.GLASS, 1]);
  assert.equal(fuelTime(ITEM.COAL), 80);
  assert.equal(fuelTime(BLOCK.OAK_PLANKS), 15);
  assert.equal(fuelTime(BLOCK.TORCH), 0);
  const made = new Set(RECIPES.map((r) => r[0]));
  for (const id of [BLOCK.CHEST, BLOCK.FURNACE, BLOCK.OAK_SLAB, BLOCK.QUARTZ_STAIRS, ITEM.OAK_DOOR, BLOCK.OAK_FENCE, BLOCK.LADDER, ITEM.OAK_SIGN, ITEM.BUCKET, BLOCK.GLASS_PANE]) assert.ok(made.has(id), itemDef(id).key);
  // no more cooking with a lump of coal in the crafting list
  assert.ok(!RECIPES.some((r) => r[0] === ITEM.COOKED_BEEF));
  // leaves sometimes drop saplings
  let saplings = 0;
  for (let i = 0; i < 2000; i++) for (const [id] of blockDrops(BLOCK.OAK_LEAVES)) if (id === BLOCK.OAK_SAPLING) saplings++;
  assert.ok(saplings > 50 && saplings < 200);
});

test('thrown items wait before they can be picked up, and only players simulated here pick them up', () => {
  const w = flatWorld(1);
  const sim = new Simulation(w, { spawnMobs: false });
  const got = [];
  sim.pickup = (id, item, n) => { got.push([id, item, n]); return n; };
  const me = sim.addPlayer('local', { pos: [0.5, 11, 0.5] });
  sim.addPlayer('other', { remote: true, pos: [3.5, 11, 0.5] });
  sim.dropItem(ITEM.APPLE, 2, 0.5, 11.3, 0.5, [0, 0, 0], 0, { delay: 2 });
  for (let i = 0; i < 20; i++) sim.tick({});
  assert.equal(got.length, 0, 'still in the air after a second');
  for (let i = 0; i < 30; i++) sim.tick({});
  assert.deepEqual(got, [['local', ITEM.APPLE, 2]]);
  // an item next to another player is theirs to pick up (in their own game)
  sim.dropItem(ITEM.BREAD, 1, 3.5, 11.3, 0.5, [0, 0, 0], 0, { delay: 0 });
  me.pos = [-6, 11, -6];
  for (let i = 0; i < 40; i++) sim.tick({});
  assert.equal(got.length, 1);
  assert.equal([...sim.entities.values()].filter((e) => e.kind === 'item').length, 1);
  // shared items are asked for instead of taken
  const asked = [];
  sim.onTake = (it) => asked.push(it.netId);
  sim.dropItem(ITEM.BONE, 1, -6, 11.3, -6, [0, 0, 0], 0, { delay: 0, remote: true, netId: '7.1' });
  for (let i = 0; i < 20; i++) sim.tick({});
  assert.deepEqual(asked, ['7.1']);
  assert.equal(got.length, 1);
  w.dispose();
});
