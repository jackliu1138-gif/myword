// What the chests of villages, temples, dungeons and the rest hold: filled the first time
// somebody opens one (the table is in the chest's block state until then), the same way for
// everybody from the world's seed and the chest's place. Used by the game and the server.

import { ITEM, POTION_ITEMS, itemDef } from './items.js';
import { BLOCK } from '../world/blocks.js';
import { LOOT } from '../world/structures.js';
import { CHEST_SLOTS } from './containers.js';
import { enchantOffers } from './effects.js';

// [item, min, max, weight]; rolls: how many draws; `ench`: some of the tools come enchanted
const TABLES = {
  [LOOT.dungeon]: { rolls: [4, 8], items: [
    [ITEM.SADDLE, 1, 1, 20], [ITEM.GOLDEN_APPLE, 1, 1, 15], [ITEM.BREAD, 1, 3, 20], [ITEM.WHEAT, 1, 4, 20], [ITEM.GUNPOWDER, 1, 4, 10],
    [ITEM.STRING, 1, 4, 10], [ITEM.BUCKET, 1, 1, 10], [ITEM.IRON_INGOT, 1, 4, 10], [ITEM.GOLD_INGOT, 1, 4, 5], [ITEM.BONE, 1, 8, 10],
    [ITEM.ROTTEN_FLESH, 1, 8, 10], [ITEM.MELON_SLICE, 2, 4, 10], [ITEM.IRON_SWORD, 1, 1, 5, true], [ITEM.BOOK, 1, 1, 8],
  ] },
  [LOOT.mineshaft]: { rolls: [3, 7], items: [
    [ITEM.BREAD, 1, 3, 15], [ITEM.COAL, 3, 8, 10], [BLOCK.RAIL, 4, 8, 12], [BLOCK.POWERED_RAIL, 1, 4, 5], [ITEM.IRON_INGOT, 1, 5, 10],
    [ITEM.GOLD_INGOT, 1, 3, 5], [ITEM.LAPIS_LAZULI, 4, 9, 5], [ITEM.DIAMOND, 1, 2, 3], [BLOCK.TORCH, 1, 16, 15], [ITEM.MELON_SLICE, 2, 4, 10],
    [ITEM.IRON_PICKAXE, 1, 1, 3, true], [ITEM.CARROT, 2, 4, 8], [ITEM.POTATO, 2, 4, 8], [ITEM.MINECART, 1, 1, 4],
  ] },
  [LOOT.desert_temple]: { rolls: [3, 6], items: [
    [ITEM.DIAMOND, 1, 3, 5], [ITEM.IRON_INGOT, 1, 5, 15], [ITEM.GOLD_INGOT, 2, 7, 15], [ITEM.EMERALD, 1, 3, 15], [ITEM.BONE, 4, 6, 25],
    [ITEM.SPIDER_EYE, 1, 3, 25], [ITEM.ROTTEN_FLESH, 3, 7, 25], [ITEM.SADDLE, 1, 1, 20], [ITEM.GOLDEN_APPLE, 1, 1, 20], [BLOCK.SAND, 1, 8, 10],
    [ITEM.GOLDEN_SWORD, 1, 1, 6, true], [ITEM.GUNPOWDER, 1, 5, 10],
  ] },
  [LOOT.village]: { rolls: [3, 7], items: [
    [ITEM.BREAD, 1, 4, 20], [ITEM.APPLE, 1, 5, 15], [ITEM.WHEAT, 1, 7, 15], [ITEM.EMERALD, 1, 2, 5], [ITEM.CARROT, 1, 4, 10], [ITEM.POTATO, 1, 4, 10],
    [ITEM.WHEAT_SEEDS, 2, 6, 10], [BLOCK.TORCH, 1, 4, 8], [ITEM.PAPER, 1, 4, 6], [ITEM.BOOK, 1, 1, 3], [ITEM.COOKED_COD, 1, 3, 6],
  ] },
  [LOOT.smith]: { rolls: [3, 8], items: [
    [ITEM.DIAMOND, 1, 3, 3], [ITEM.IRON_INGOT, 1, 5, 10], [ITEM.GOLD_INGOT, 1, 3, 5], [ITEM.BREAD, 1, 3, 15], [ITEM.APPLE, 1, 3, 15],
    [ITEM.IRON_PICKAXE, 1, 1, 5], [ITEM.IRON_SWORD, 1, 1, 5], [ITEM.IRON_CHESTPLATE, 1, 1, 5], [ITEM.IRON_HELMET, 1, 1, 5],
    [ITEM.IRON_LEGGINGS, 1, 1, 5], [ITEM.IRON_BOOTS, 1, 1, 5], [BLOCK.OBSIDIAN, 3, 7, 5], [BLOCK.OAK_SAPLING, 3, 7, 5], [ITEM.SADDLE, 1, 1, 3],
  ] },
  [LOOT.outpost]: { rolls: [2, 4], items: [
    [ITEM.CROSSBOW, 1, 1, 30, true], [ITEM.WHEAT, 3, 5, 7], [ITEM.POTATO, 2, 5, 5], [ITEM.CARROT, 3, 5, 5], [ITEM.ARROW, 2, 7, 10],
    [ITEM.IRON_INGOT, 1, 3, 5], [ITEM.STRING, 1, 6, 5], [ITEM.EMERALD, 1, 3, 4],
  ], always: [[ITEM.CROSSBOW, 1]] },
  [LOOT.mansion]: { rolls: [3, 6], items: [
    [ITEM.LEAD ?? ITEM.STRING, 1, 3, 20], [ITEM.GOLDEN_APPLE, 1, 1, 15], [ITEM.BREAD, 1, 3, 20], [ITEM.REDSTONE ?? ITEM.GUNPOWDER, 1, 4, 15],
    [ITEM.DIAMOND_HOE, 1, 1, 3, true], [ITEM.DIAMOND_CHESTPLATE, 1, 1, 2, true], [ITEM.IRON_INGOT, 1, 4, 10], [ITEM.GOLD_INGOT, 1, 4, 5],
    [ITEM.BUCKET, 1, 1, 10], [ITEM.EMERALD, 1, 4, 8], [ITEM.BOOK, 1, 3, 10], [ITEM.TOTEM_OF_UNDYING, 1, 1, 1],
  ] },
  [LOOT.witch]: { rolls: [2, 5], items: [
    [ITEM.GLASS_BOTTLE, 1, 3, 20], [ITEM.SPIDER_EYE, 1, 3, 15], [ITEM.SUGAR, 1, 4, 15], [ITEM.GLOWSTONE_DUST, 1, 4, 10],
    [ITEM.NETHER_WART, 1, 4, 10], [ITEM.GUNPOWDER, 1, 3, 10], [ITEM.REDSTONE ?? ITEM.GLOWSTONE_DUST, 1, 4, 5],
  ] },
  [LOOT.end_city]: { rolls: [2, 6], items: [
    [ITEM.DIAMOND, 2, 7, 5], [ITEM.IRON_INGOT, 4, 8, 10], [ITEM.GOLD_INGOT, 2, 7, 15], [ITEM.EMERALD, 2, 6, 2], [ITEM.SADDLE, 1, 1, 3],
    [ITEM.DIAMOND_SWORD, 1, 1, 3, true], [ITEM.DIAMOND_PICKAXE, 1, 1, 3, true], [ITEM.DIAMOND_CHESTPLATE, 1, 1, 3, true], [ITEM.DIAMOND_BOOTS, 1, 1, 3, true],
    [ITEM.IRON_SWORD, 1, 1, 3, true], [ITEM.IRON_HELMET, 1, 1, 3, true], [ITEM.SHULKER_SHELL, 1, 2, 4],
  ] },
  [LOOT.end_ship]: { rolls: [2, 5], items: [
    [ITEM.DIAMOND, 2, 5, 5], [ITEM.GOLD_INGOT, 2, 6, 10], [ITEM.EMERALD, 2, 4, 5], [ITEM.DIAMOND_LEGGINGS, 1, 1, 3, true], [ITEM.FIREWORK_ROCKET, 8, 16, 10],
  ], always: [[ITEM.ELYTRA, 1], [ITEM.FIREWORK_ROCKET, 32]] },
  [LOOT.monument]: { rolls: [2, 4], items: [
    [ITEM.PRISMARINE_SHARD, 2, 6, 10], [ITEM.PRISMARINE_CRYSTALS, 2, 6, 10], [ITEM.GOLD_INGOT, 2, 5, 5], [ITEM.RAW_COD, 1, 4, 10],
  ] },
};

function rng(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// The slots of a freshly opened loot chest ([CHEST_SLOTS] of stacks or null), or null for none.
export function rollLoot(table, worldSeed, x, y, z) {
  const t = TABLES[table];
  if (!t) return null;
  const rand = rng((worldSeed ^ Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791) ^ table * 2654435761) >>> 0);
  const slots = new Array(CHEST_SLOTS).fill(null);
  const put = (s) => {
    for (let k = 0; k < 20; k++) {
      const i = Math.floor(rand() * CHEST_SLOTS);
      if (!slots[i]) { slots[i] = s; return; }
    }
    const i = slots.indexOf(null);
    if (i >= 0) slots[i] = s;
  };
  for (const [id, n] of t.always || []) if (itemDef(id)) put({ id, count: n, wear: 0 });
  const total = t.items.reduce((a, it) => a + it[3], 0);
  const rolls = t.rolls[0] + Math.floor(rand() * (t.rolls[1] - t.rolls[0] + 1));
  for (let r = 0; r < rolls; r++) {
    let v = rand() * total, pick = t.items[0];
    for (const it of t.items) { v -= it[3]; if (v <= 0) { pick = it; break; } }
    const [id, lo, hi, , ench] = pick;
    const d = itemDef(id);
    if (!d) continue;
    const stack = { id, count: Math.min(d.stack, lo + Math.floor(rand() * (hi - lo + 1))), wear: 0 };
    if (ench) {
      const offers = enchantOffers(d, 15, Math.floor(rand() * 4294967296));
      if (offers.length && Object.keys(offers[2].ench).length) stack.ench = offers[2].ench;
    }
    put(stack);
  }
  // a splash of potions in the witch's chest
  if (table === LOOT.witch) put({ id: POTION_ITEMS[['healing', 'swiftness', 'fire_resistance', 'night_vision'][Math.floor(rand() * 4)]], count: 1, wear: 0 });
  return slots;
}
