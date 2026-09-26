// Inventory moves, armour, the new tools and recipes, beds and box shapes in the mesher, the nether
// and end generators, strongholds, nether portal frames, and the new creatures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Inventory, ARMOR_REF, armorReduce } from '../src/sim/inventory.js';
import { ITEM, ITEMS, RECIPES, BED_ITEMS, itemDef, breakInfo, blockDrops } from '../src/sim/items.js';
import { Simulation } from '../src/sim/simulation.js';
import { BLOCK, BLOCKS, IS_SOLID, BED_BLOCKS, BED_PARTNER, BOX_SHAPES, DYES, SHAPE, BLOCK_COUNT } from '../src/world/blocks.js';
import { createGenerator, NETHER_LAVA, END_SURFACE, END_PLATFORM } from '../src/world/dimensions.js';
import { ChunkMesher, POS_BIAS } from '../src/world/mesher.js';
import { buildItemSprites } from '../src/world/itemsprites.js';
import { buildSkins, MODELS } from '../src/render/models.js';
import { installTravel } from '../src/game/travel.js';

function flatWorld() {
  const edits = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const get = (x, y, z) => (edits.has(key(x, y, z)) ? edits.get(key(x, y, z)) : y <= 10 ? BLOCK.STONE : 0);
  return {
    edits,
    getBlock: get,
    setBlock: (x, y, z, id) => { edits.set(key(x, y, z), id); return true; },
    isSolidAt: (x, y, z) => !!IS_SOLID[get(x, y, z)],
    getLight: () => [15, 0],
    isChunkReady: () => true,
    surfaceHeight: () => 10,
  };
}

test('inventory screen moves: pick up, put down, merge, split, swap and shift-click', () => {
  const inv = new Inventory();
  assert.equal(inv.slots.length, 45);
  inv.slots[9] = { id: BLOCK.DIRT, count: 40, wear: 0 };
  inv.slots[10] = { id: BLOCK.DIRT, count: 30, wear: 0 };
  // pick up 40, drop them on the 30: fills to 64, 6 stay on the cursor
  inv.click(9, 0);
  assert.deepEqual([inv.cursor.count, inv.slots[9]], [40, null]);
  inv.click(10, 0);
  assert.deepEqual([inv.slots[10].count, inv.cursor.count], [64, 6]);
  // right click puts one down, then the rest
  inv.click(11, 2);
  assert.deepEqual([inv.slots[11].count, inv.cursor.count], [1, 5]);
  inv.click(12, 0);
  assert.equal(inv.cursor, null);
  // right click on a stack takes half (rounded up)
  inv.click(10, 2);
  assert.deepEqual([inv.cursor.count, inv.slots[10].count], [32, 32]);
  inv.click(10, 0);
  assert.equal(inv.slots[10].count, 64);
  // different items swap
  inv.slots[13] = { id: ITEM.IRON_SWORD, count: 1, wear: 5 };
  inv.click(13, 0);
  inv.click(12, 0);
  assert.equal(inv.slots[12].id, ITEM.IRON_SWORD);
  assert.equal(inv.cursor.id, BLOCK.DIRT);
  inv.returnCursor();
  // armour: only its own slot, and shift-click puts it on and takes it off
  inv.slots[20] = { id: ITEM.DIAMOND_CHESTPLATE, count: 1, wear: 0 };
  inv.click(20, 0);
  assert.equal(inv.click(ARMOR_REF, 0), false, 'a chestplate is not a helmet');
  assert.equal(inv.click(ARMOR_REF + 1, 0), true);
  assert.equal(inv.armor[1].id, ITEM.DIAMOND_CHESTPLATE);
  inv.slots[21] = { id: ITEM.IRON_HELMET, count: 1, wear: 0 };
  inv.quickMove(21);
  assert.equal(inv.armor[0].id, ITEM.IRON_HELMET);
  assert.deepEqual(inv.armorValues(), { points: 10, toughness: 2 });
  inv.quickMove(ARMOR_REF);
  assert.equal(inv.armor[0], null);
  // armour taken off goes to the bag; shift-click on it again puts it back on
  const at = inv.slots.findIndex((s) => s && s.id === ITEM.IRON_HELMET);
  assert.ok(at >= 9);
  inv.quickMove(at);
  assert.equal(inv.armor[0].id, ITEM.IRON_HELMET);
  // anything else moves between the bag and the hotbar
  inv.slots[30] = { id: ITEM.BREAD, count: 5, wear: 0 };
  inv.quickMove(30);
  assert.equal(inv.slots[30], null);
  assert.ok(inv.slots.slice(0, 9).some((s) => s && s.id === ITEM.BREAD));
});

test('inventory saves armour and loads older 36-slot saves', () => {
  const inv = new Inventory();
  inv.add(BLOCK.STONE, 10);
  inv.armor[3] = { id: ITEM.NETHERITE_BOOTS, count: 1, wear: 7 };
  const data = inv.serialize();
  assert.equal(data.length, 49);
  const b = new Inventory();
  b.load(data);
  assert.deepEqual(b.armor[3], { id: ITEM.NETHERITE_BOOTS, count: 1, wear: 7 });
  assert.equal(b.count(BLOCK.STONE), 10);
  const old = new Array(36).fill(null);
  old[35] = [BLOCK.GLASS, 3, 0];
  b.load(old);
  assert.deepEqual(b.slots[35], { id: BLOCK.GLASS, count: 3, wear: 0 });
  assert.ok(b.armor.every((s) => s === null));
});

test('armour soaks up damage, less so against big hits unless it is tough', () => {
  assert.equal(armorReduce(10, 0, 0), 10);
  // full diamond: 20 points, 8 toughness
  assert.ok(Math.abs(armorReduce(10, 20, 8) - 3) < 1e-9);
  assert.ok(armorReduce(20, 20, 0) > armorReduce(20, 20, 8));
  // a simulated player with armour takes less, and the armour gets worn
  const sim = new Simulation(flatWorld(), { spawnMobs: false });
  const p = sim.addPlayer('local', { mode: 'survival' });
  p.armor = { points: 15, toughness: 0 };
  sim.damagePlayer('local', 8, 'zombie');
  assert.ok(p.health > 20 - 8 && p.health < 20);
  assert.ok(sim.drainEvents().some((e) => e.type === 'armorHit'));
  // falling ignores armour
  p.hurtTime = 0;
  const before = p.health;
  sim.damagePlayer('local', 4, 'fall');
  assert.equal(before - p.health, 4);
});

test('every tool material, armour piece and bed exists with a sprite and a recipe', () => {
  for (const mat of ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite']) {
    for (const kind of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe']) {
      const id = ITEM[(mat + '_' + kind).toUpperCase()];
      assert.ok(itemDef(id), mat + ' ' + kind);
      assert.ok(RECIPES.some((r) => r[0] === id), 'recipe for ' + mat + ' ' + kind);
    }
  }
  for (const mat of ['leather', 'chainmail', 'iron', 'golden', 'diamond', 'netherite']) {
    for (const piece of ['helmet', 'chestplate', 'leggings', 'boots']) {
      const d = itemDef(ITEM[(mat + '_' + piece).toUpperCase()]);
      assert.ok(d && d.kind === 'armor' && d.durability > 0 && d.zh, mat + ' ' + piece);
    }
  }
  assert.equal(Object.keys(BED_ITEMS).length, 16);
  assert.equal(DYES.length, 16);
  for (const [c] of DYES) {
    const [foot, head] = BED_BLOCKS[c];
    assert.equal(BED_PARTNER[foot], head);
    assert.equal(BED_PARTNER[head], foot);
    assert.ok(RECIPES.some((r) => r[0] === BED_ITEMS[c]), c + ' bed recipe');
  }
  const sprites = buildItemSprites();
  assert.equal(sprites.layers.length, ITEMS.length);
  for (const d of ITEMS) {
    const px = sprites.layers[sprites.index.get(d.id)];
    let opaque = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 0) opaque++;
    assert.ok(opaque > 12, 'sprite drawn for ' + d.key);
  }
  for (const d of ITEMS) assert.ok(d.zh, 'Chinese name for ' + d.key);
  assert.ok(BLOCK_COUNT <= 255 && ITEMS[ITEMS.length - 1].id < 65536);
});

test('tool tiers: gold mines like wood, netherite like diamond, and ancient debris needs diamond', () => {
  assert.equal(breakInfo(BLOCK.IRON_ORE, ITEM.GOLDEN_PICKAXE).drops, false);
  assert.equal(breakInfo(BLOCK.IRON_ORE, ITEM.STONE_PICKAXE).drops, true);
  assert.ok(breakInfo(BLOCK.STONE, ITEM.GOLDEN_PICKAXE).time < breakInfo(BLOCK.STONE, ITEM.DIAMOND_PICKAXE).time);
  assert.equal(breakInfo(BLOCK.ANCIENT_DEBRIS, ITEM.IRON_PICKAXE).drops, false);
  assert.equal(breakInfo(BLOCK.ANCIENT_DEBRIS, ITEM.DIAMOND_PICKAXE).drops, true);
  assert.equal(breakInfo(BLOCK.OBSIDIAN, ITEM.NETHERITE_PICKAXE).drops, true);
  assert.equal(breakInfo(BLOCK.END_PORTAL_FRAME, ITEM.NETHERITE_PICKAXE).time, Infinity);
  assert.ok(itemDef(ITEM.NETHERITE_SWORD).damage > itemDef(ITEM.DIAMOND_SWORD).damage);
  assert.deepEqual(blockDrops(BLOCK.NETHER_QUARTZ_ORE), [[ITEM.QUARTZ, 1]]);
  assert.deepEqual(blockDrops(BLOCK.WHEAT_0), [[ITEM.WHEAT_SEEDS, 1]]);
  assert.equal(blockDrops(BLOCK.WHEAT_3)[0][0], ITEM.WHEAT);
  assert.deepEqual(blockDrops(BLOCK.RED_BED_FOOT), []);
  // the way to the End: rods to powder, powder and pearls to eyes
  assert.ok(RECIPES.some((r) => r[0] === ITEM.EYE_OF_ENDER && r[2].some(([i]) => i === ITEM.BLAZE_POWDER)));
  assert.ok(RECIPES.some((r) => r[0] === ITEM.FLINT_AND_STEEL));
});

test('beds turn towards their other half; farmland is a little lower than a block', () => {
  const S = 16, H = 128;
  const chunks = Array.from({ length: 9 }, () => new Uint8Array(S * S * H));
  const c = chunks[4];
  const at = (x, y, z) => (y << 8) | (z << 4) | x;
  for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) c[at(x, 9, z)] = BLOCK.STONE;
  c[at(4, 10, 4)] = BLOCK.RED_BED_FOOT; c[at(5, 10, 4)] = BLOCK.RED_BED_HEAD; // head towards +X
  c[at(8, 9, 8)] = BLOCK.FARMLAND;
  const m = new ChunkMesher(null).mesh(0, 0, chunks, {});
  const v = new DataView(m.opaque);
  const n = m.opaque.byteLength / 16;
  let bedMaxY = 0, legOnHeadSide = false, farmTop = false;
  for (let i = 0; i < n; i++) {
    const x = v.getUint16(i * 16, true) - POS_BIAS, y = v.getUint16(i * 16 + 2, true) - POS_BIAS, z = v.getUint16(i * 16 + 4, true) - POS_BIAS;
    if (x >= 64 && x <= 96 && z >= 64 && z <= 80 && y >= 160) bedMaxY = Math.max(bedMaxY, y);
    // legs of the head half stand at its far (+X) end: x from 93 to 96
    if (y === 160 && x >= 93 && x <= 96 && z >= 64 && z <= 80) legOnHeadSide = true;
    if (x >= 128 && x <= 144 && z >= 128 && z <= 144 && y === 9 * 16 + 15) farmTop = true;
  }
  assert.equal(bedMaxY, 160 + 11, 'the pillow tops the bed at 11/16');
  assert.ok(legOnHeadSide);
  assert.ok(farmTop, 'farmland top face at 15/16');
  assert.ok(BOX_SHAPES[BLOCK.END_PORTAL_FRAME_EYE].length === 2);
  assert.equal(BLOCKS[BLOCK.NETHER_PORTAL_X].shape, SHAPE.BOXES);
});

test('the nether has a bedrock floor and roof, a lava sea and fortresses; the end has its island', () => {
  const ng = createGenerator(4242, 1);
  const b = ng.generateChunk(0, 0);
  const at = (x, y, z) => b[(y << 8) | (z << 4) | x];
  assert.equal(at(3, 0, 3), BLOCK.BEDROCK);
  assert.equal(at(3, 127, 3), BLOCK.BEDROCK);
  let lava = 0, rack = 0, above = 0;
  for (let y = 1; y < 127; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const id = at(x, y, z);
    if (id === BLOCK.LAVA) { lava++; if (y > NETHER_LAVA) above++; }
    if (id === BLOCK.NETHERRACK) rack++;
  }
  assert.ok(rack > 5000 && lava > 0 && above === 0);
  let f = null;
  for (let g = 0; g < 50 && !f; g++) f = ng.fortressIn(g % 7 - 3, Math.floor(g / 7) - 3);
  assert.ok(f, 'fortresses exist');
  const fb = ng.generateChunk(Math.floor(f.x / 16), Math.floor(f.z / 16));
  assert.ok(fb.includes(BLOCK.NETHER_BRICKS));
  assert.deepEqual(ng.generateChunk(2, 3), ng.generateChunk(2, 3), 'deterministic');

  const eg = createGenerator(4242, 2);
  const e = eg.generateChunk(0, 0);
  const et = (x, y, z) => e[(y << 8) | (z << 4) | x];
  assert.equal(et(0, END_SURFACE, 0), BLOCK.BEDROCK, 'exit fountain');
  assert.equal(et(0, END_SURFACE + 4, 0), BLOCK.BEDROCK);
  let stone = false;
  for (let y = END_SURFACE - 2; y <= END_SURFACE + 2; y++) if (et(5, y, 5) === BLOCK.END_STONE) stone = true;
  assert.ok(stone, 'end stone around the fountain');
  const pillars = eg.pillars();
  assert.equal(pillars.length, 10);
  const [px, pz, , top] = pillars[0];
  const pc = eg.generateChunk(Math.floor(px / 16), Math.floor(pz / 16));
  const lx = px - Math.floor(px / 16) * 16, lz = pz - Math.floor(pz / 16) * 16;
  assert.equal(pc[(top << 8) | (lz << 4) | lx], BLOCK.OBSIDIAN);
  assert.equal(pc[((top + 1) << 8) | (lz << 4) | lx], BLOCK.BEDROCK);
  const [ax, ay, az] = END_PLATFORM;
  const plat = eg.generateChunk(Math.floor(ax / 16), Math.floor(az / 16));
  assert.equal(plat[((ay - 1) << 8) | ((az & 15) << 4) | (ax & 15)], BLOCK.OBSIDIAN);
});

test('strongholds hold a portal room with twelve end portal frames', () => {
  const g = createGenerator(4242, 0);
  const list = g.strongholds();
  assert.equal(list.length, 3);
  for (const s of list) assert.ok(Math.hypot(s.x, s.z) > 400);
  const s = list[1];
  let frames = 0;
  const seen = new Set();
  for (const [dx, dz] of [[-3, 1], [3, 1], [-3, 7], [3, 7], [0, 4]]) {
    const cx = Math.floor((s.x + dx) / 16), cz = Math.floor((s.z + dz) / 16);
    if (seen.has(cx + ',' + cz)) continue;
    seen.add(cx + ',' + cz);
    const b = g.generateChunk(cx, cz);
    for (const id of b) if (id === BLOCK.END_PORTAL_FRAME || id === BLOCK.END_PORTAL_FRAME_EYE) frames++;
  }
  assert.equal(frames, 12);
});

test('a nether portal frame is found in either plane, and a broken one is not', () => {
  class G {}
  installTravel(G);
  const g = new G();
  g.world = flatWorld();
  const w = g.world;
  const O = BLOCK.OBSIDIAN;
  // a 2 x 3 inside along X at z = 5, on the ground (y 11..13)
  for (let a = -1; a <= 2; a++) { w.setBlock(a, 10, 5, O); w.setBlock(a, 14, 5, O); }
  for (let k = 11; k <= 13; k++) { w.setBlock(-1, k, 5, O); w.setBlock(2, k, 5, O); }
  const f = g.portalFrame(0, 12, 5, 'x');
  assert.deepEqual([f.a0, f.a1, f.y0, f.y1], [0, 1, 11, 13]);
  assert.equal(g.portalFrame(0, 12, 5, 'z'), null);
  // the same along Z, 3 wide and 4 tall
  for (let a = -1; a <= 3; a++) { w.setBlock(20, 10, a, O); w.setBlock(20, 15, a, O); }
  for (let k = 11; k <= 14; k++) { w.setBlock(20, k, -1, O); w.setBlock(20, k, 3, O); }
  const fz = g.portalFrame(20, 11, 1, 'z');
  assert.deepEqual([fz.a0, fz.a1, fz.y0, fz.y1], [0, 2, 11, 14]);
  // too small: 1 wide
  for (let k = 11; k <= 13; k++) { w.setBlock(40, k, 5, O); w.setBlock(42, k, 5, O); }
  w.setBlock(41, 10, 5, O); w.setBlock(41, 14, 5, O);
  assert.equal(g.portalFrame(41, 12, 5, 'x'), null);
  // a gap in the frame
  w.setBlock(2, 12, 5, 0);
  assert.equal(g.portalFrame(0, 12, 5, 'x'), null);
});

test('neutral creatures only fight back, the dragon heals from crystals, crystals explode', () => {
  const sim = new Simulation(flatWorld(), { spawnMobs: false });
  const p = sim.addPlayer('local', { mode: 'survival', pos: [0.5, 11, 0.5] });
  const pig = sim.spawnMob('zombified_piglin', 2.5, 11, 0.5);
  const friend = sim.spawnMob('zombified_piglin', 4.5, 11, 0.5);
  for (let i = 0; i < 40; i++) sim.tick({ dayTime: 0.25 });
  assert.equal(p.health, 20, 'a calm piglin leaves you alone');
  sim.playerAttack('local', pig, 1);
  assert.equal(pig.angryAt, p);
  assert.equal(friend.angryAt, p, 'its friends join in');
  for (let i = 0; i < 80; i++) sim.tick({ dayTime: 0.25 });
  assert.ok(p.health < 20);

  const end = new Simulation(flatWorld(), { spawnMobs: false, dimension: 2 });
  end.addPlayer('local', { mode: 'creative', pos: [0, 11, 0] });
  const dragon = end.spawnDragon(0.5, 60, 0.5, 150);
  end.spawnCrystal(10.5, 40, 0.5, 3);
  for (let i = 0; i < 40; i++) end.tick({ dayTime: 0.25 });
  assert.ok(dragon.health > 150, 'healed by the crystal');
  const crystal = [...end.entities.values()].find((e) => e.type === 'end_crystal');
  end.playerAttack('local', crystal, 1);
  const ev = end.drainEvents();
  assert.ok(ev.some((e) => e.type === 'crystalDeath' && e.index === 3));
  assert.ok(ev.some((e) => e.type === 'explosion'));
  dragon.health = 1;
  dragon.hurtTime = 0;
  end.playerAttack('local', dragon, 5);
  assert.ok(end.drainEvents().some((e) => e.type === 'bossDeath'));
  for (let i = 0; i < 100; i++) end.tick({ dayTime: 0.25 });
  assert.ok(end.drainEvents().some((e) => e.type === 'dragonGone'));
});

test('ender pearls land and eyes of ender fly towards their target', () => {
  const sim = new Simulation(flatWorld(), { spawnMobs: false });
  sim.addPlayer('local', { mode: 'survival', pos: [0, 11, 0] });
  sim.throwPearl('local', [0, 13, 0], [0.7, 0.2, 0.7]);
  let landed = null;
  for (let i = 0; i < 100 && !landed; i++) { sim.tick({}); landed = sim.drainEvents().find((e) => e.type === 'pearlLand'); }
  assert.ok(landed && landed.pos && landed.pos[0] > 3 && landed.pos[1] < 12.5);
  const eye = sim.throwEye('local', [0, 13, 0], [100, -50]);
  for (let i = 0; i < 20; i++) eye.update();
  assert.ok(eye.body.pos[0] > 0 && eye.body.pos[2] < 0 && eye.body.pos[1] > 13);
});

test('creature skins fit their atlas, including the dragon and armour', () => {
  const skins = buildSkins({});
  for (const k of ['armor:iron', 'armor:netherite', 'ender_dragon', 'ghast', 'blaze', 'enderman', 'zombified_piglin', 'end_crystal']) assert.ok(skins.layerOf[k] !== undefined, k);
  for (const [name, m] of Object.entries(MODELS)) {
    for (const rects of Object.values(m.rects)) for (const [x, y, w, h] of Object.values(rects)) assert.ok(x + w <= 64 && y + h <= 64, name);
  }
});
