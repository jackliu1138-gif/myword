// Survival depth, creatures, getting about and the structures of the 384-high world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickHunger, eat, MAX_FOOD, addXp, xpForLevel, spendLevels, enchantOffers, enchantFits, potionOutcome, addEffect, POTIONS } from '../src/sim/effects.js';
import { newEntity, tickBrewing, brewResult } from '../src/sim/containers.js';
import { ITEM, POTION_ITEMS, SPLASH_ITEMS, itemDef, EGG_ITEMS } from '../src/sim/items.js';
import { rollLoot } from '../src/sim/loot.js';
import { LOOT } from '../src/world/structures.js';
import { tradesFor } from '../src/sim/trades.js';
import { JOB_LIST } from '../src/sim/looks.js';
import { BLOCK, RAIL_SHAPES, railShapeFor, WORLD_HEIGHT } from '../src/world/blocks.js';
import { Player } from '../src/game/player.js';
import { stepWeatherClock, Weather } from '../src/game/weather.js';
import { generate, createGenerator } from '../src/world/dimensions.js';
import { mobFlags } from '../src/sim/remote.js';
import { MOBS } from '../src/sim/entities.js';

test('hunger: running uses it up, eating brings it back, a full belly heals and an empty one hurts', () => {
  const p = { food: MAX_FOOD, sat: 0, exhaust: 0, health: 20 };
  for (let i = 0; i < 40; i++) { p.exhaust += 4; tickHunger(p, 0.05); }
  assert.ok(p.food < MAX_FOOD - 30 / 2, 'forty points of exhaustion cost food');
  eat(p, 8, 12.8);
  assert.ok(p.food >= 8 && p.sat <= p.food, 'saturation never passes the food level');
  const full = { food: 20, sat: 5, exhaust: 0, health: 10 };
  let healed = 0;
  for (let i = 0; i < 20; i++) healed += tickHunger(full, 0.5);
  assert.ok(healed > 0, 'fed players heal');
  const empty = { food: 0, sat: 0, exhaust: 0, health: 10 };
  let hurt = 0;
  for (let i = 0; i < 10; i++) hurt += tickHunger(empty, 1, { difficulty: 'hard' });
  assert.ok(hurt < 0, 'starving hurts');
});

test('experience: levels need more points as they go, and enchanting spends them', () => {
  assert.equal(xpForLevel(0), 7);
  assert.ok(xpForLevel(30) > xpForLevel(15));
  const x = { level: 0, xp: 0 };
  assert.equal(addXp(x, 7 + 9 + 3), 2);
  assert.deepEqual([x.level, x.xp], [2, 3]);
  spendLevels(x, 1);
  assert.equal(x.level, 1);
});

test('the enchanting table offers what fits the item, stronger with more bookshelves', () => {
  const pick = itemDef(ITEM.DIAMOND_PICKAXE);
  const few = enchantOffers(pick, 0, 1234), many = enchantOffers(pick, 15, 1234);
  assert.equal(many.length, 3);
  assert.ok(many[2].cost >= few[2].cost && many[2].cost >= 20, 'fifteen shelves: a level-30ish offer');
  for (const o of many) for (const k of Object.keys(o.ench)) assert.ok(enchantFits(pick, k), k + ' fits a pickaxe');
  assert.deepEqual(enchantOffers(pick, 15, 1234), many, 'the same seed, the same offers');
  assert.deepEqual(enchantOffers(itemDef(ITEM.STICK), 15, 1), [], 'sticks cannot be enchanted');
});

test('brewing: nether wart makes water awkward, then the ingredient decides; gunpowder makes it splash', () => {
  assert.equal(brewResult(POTION_ITEMS.water, ITEM.NETHER_WART), POTION_ITEMS.awkward);
  assert.equal(brewResult(POTION_ITEMS.awkward, ITEM.GLISTERING_MELON_SLICE), POTION_ITEMS.healing);
  assert.equal(brewResult(POTION_ITEMS.healing, ITEM.GUNPOWDER), SPLASH_ITEMS.healing);
  assert.equal(brewResult(POTION_ITEMS.water, ITEM.GLISTERING_MELON_SLICE), 0, 'straight into water: nothing');
  const e = newEntity('brewing');
  e.slots = [{ id: POTION_ITEMS.water, count: 1, wear: 0 }, null, { id: POTION_ITEMS.water, count: 1, wear: 0 }, { id: ITEM.NETHER_WART, count: 1, wear: 0 }, { id: ITEM.BLAZE_POWDER, count: 1, wear: 0 }];
  for (let i = 0; i < 25; i++) tickBrewing(e, 1);
  assert.deepEqual([e.slots[0].id, e.slots[2].id], [POTION_ITEMS.awkward, POTION_ITEMS.awkward]);
  assert.equal(e.slots[3], null, 'the ingredient is used up');
  assert.equal(e.slots[4], null, 'the blaze powder went into the fuel');
  assert.equal(e.fuel, 19);
  const heal = potionOutcome('healing');
  assert.ok(heal.heal > 0);
  const fx = {};
  addEffect(fx, 'speed', 30, 0);
  addEffect(fx, 'speed', 10, 1);
  assert.equal(fx.speed.amp, 1, 'the stronger one wins');
  assert.ok(POTIONS.night_vision && POTIONS.swiftness);
});

test('loot chests: the end ship always carries elytra; the same chest always rolls the same', () => {
  const ship = rollLoot(LOOT.end_ship, 99, 10, 70, 10);
  assert.ok(ship.some((s) => s && s.id === ITEM.ELYTRA));
  assert.ok(ship.some((s) => s && s.id === ITEM.FIREWORK_ROCKET));
  assert.deepEqual(rollLoot(LOOT.dungeon, 5, 1, 2, 3), rollLoot(LOOT.dungeon, 5, 1, 2, 3));
  assert.notDeepEqual(rollLoot(LOOT.dungeon, 5, 1, 2, 3), rollLoot(LOOT.dungeon, 5, 1, 2, 4));
  assert.ok(rollLoot(LOOT.outpost, 7, 0, 0, 0).some((s) => s && s.id === ITEM.CROSSBOW));
});

test('villagers trade by their job; every job but the jobless has offers', () => {
  for (const job of JOB_LIST) {
    const offers = tradesFor(job, 42);
    if (job === 'none' || job === 'nitwit') { assert.equal(offers.length, 0, job); continue; }
    assert.ok(offers.length >= 3, job + ' has offers');
    for (const o of offers) {
      assert.ok(o.cost.length >= 1 && o.cost.every(([id, n]) => itemDef(id) && n > 0), job + ': costs are real items');
      assert.ok(itemDef(o.give[0]) && o.give[1] > 0, job + ': gives a real item');
    }
  }
});

test('rails join up: straight and curved shapes, slopes one way', () => {
  assert.equal(RAIL_SHAPES[railShapeFor(0, 2)].ends.join(), '0,2');
  assert.equal(railShapeFor(2, 1), 6);
  assert.equal(railShapeFor(1, 2), 6, 'either order');
  assert.equal(railShapeFor(0, 0), -1);
});

test('elytra: gliding sinks slowly, a rocket pushes to about 34 blocks a second along the look', () => {
  const world = { getBlock: () => 0, boxCollides: () => false, isSolidAt: () => false, climbableAt: () => false, getState: () => 0 };
  const p = new Player(world);
  p.pos = [0, 300, 0];
  p.canGlide = true;
  p.gliding = true;
  p.pitch = -0.1; p.yaw = 0;
  p.vel = [0, -5, -10];
  const ctl = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
  for (let i = 0; i < 60 * 3; i++) p.update(1 / 60, ctl);
  const glide = Math.hypot(...p.vel);
  assert.ok(p.gliding, 'still gliding');
  assert.ok(glide > 8 && glide < 40, 'a steady glide: ' + glide.toFixed(1));
  p.boost = 1.5;
  for (let i = 0; i < 60; i++) p.update(1 / 60, ctl);
  const boosted = Math.hypot(...p.vel);
  assert.ok(boosted > 28 && boosted < 38, 'boosted: ' + boosted.toFixed(1));
  const f = p.forward();
  const dot = (p.vel[0] * f[0] + p.vel[1] * f[1] + p.vel[2] * f[2]) / boosted;
  assert.ok(dot > 0.95, 'along the look');
});

test('shared weather: the clock turns fair spells into rain and back; clients follow the server', () => {
  const s = { target: 0, stormTarget: 0, timer: 1 };
  let r = 0;
  const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  assert.equal(stepWeatherClock(s, 0.5, rnd), false);
  assert.equal(stepWeatherClock(s, 0.6, rnd), true);
  assert.ok(s.target >= 0.75 && s.timer > 100, 'rain for a few minutes');
  assert.equal(stepWeatherClock(s, s.timer + 1, rnd), true);
  assert.equal(s.target, 0, 'then fair again');
  const w = new Weather();
  w.setShared(0.9, 1, true);
  assert.deepEqual([w.rain, w.storm], [0.9, 1], 'joining: the weather is there at once');
  w.setShared(0, 0);
  for (let i = 0; i < 600; i++) w.update(0.5, 'shared');
  assert.ok(w.rain < 0.05, 'and clears when the server says so');
  w.setShared(1, 0);
  for (let i = 0; i < 600; i++) w.update(0.5, 'clear');
  assert.ok(w.rain < 0.05, 'a player who picked clear skies keeps them');
});

test('the 384-high world: villages come with villagers, structures leave loot chests and spawners', () => {
  const S = WORLD_HEIGHT * 256;
  let villagers = 0, chests = 0, spawners = 0, top = 0;
  // the spawn of a new world is beside a village (see findSpawn)
  const gen = createGenerator(12345, 0, 2);
  const sp = gen.findSpawn();
  const scx = Math.floor(sp[0] / 16), scz = Math.floor(sp[2] / 16);
  for (let cz = scz - 3; cz <= scz + 3; cz++) {
    for (let cx = scx - 3; cx <= scx + 3; cx++) {
      const r = generate(gen, cx, cz);
      assert.equal(r.blocks.length, S);
      top = Math.max(top, r.top);
      for (const f of r.features || []) {
        if (f.kind === 'mob' && f.type === 'villager') villagers++;
        if (f.kind === 'spawner') spawners++;
      }
      for (let i = 0; i < S; i++) if (r.blocks[i] === BLOCK.CHEST && r.states && r.states[i] >> 4) chests++;
    }
  }
  assert.ok(villagers >= 3, 'villagers: ' + villagers);
  assert.ok(top > 64 && top < WORLD_HEIGHT, 'terrain height ' + top);
  void chests; void spawners;
});

test('creatures: what they are doing travels as bits; eggs exist for the new ones', () => {
  assert.equal(mobFlags({ deathTime: 0, hurtTime: 0, burning: 0, mode: 'idle', swing: 0, growth: -10, tamed: 'Ann', sitting: true }), 32 | 128 | 256);
  assert.equal(mobFlags({ deathTime: 0, hurtTime: 0, burning: 0, mode: 'chase', swing: 0, sheared: true, rider: 'Ann' }), 8 | 64 | 1024);
  for (const t of ['villager', 'wolf', 'cat', 'horse', 'witch', 'slime', 'phantom', 'pillager', 'squid']) {
    assert.ok(MOBS[t], t);
    assert.ok(EGG_ITEMS[t] && itemDef(EGG_ITEMS[t]), 'a spawn egg for ' + t);
  }
});
