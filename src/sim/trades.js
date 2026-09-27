// What villagers trade, by job. Each villager offers a handful of these (the same ones for as long
// as it lives, from its own seed); each offer can be taken a dozen times a day.

import { ITEM } from './items.js';
import { BLOCK } from '../world/blocks.js';
import { POTION_ITEMS } from './items.js';

const E = ITEM.EMERALD;
// [cost: [[id, n], ...], give: [id, n, enchant?]]
const SELL = (id, n, emeralds) => [[[id, n]], [E, emeralds]];
const BUY = (emeralds, id, n, ench = null) => [[[E, emeralds]], [id, n, ench]];
const POOLS = {
  farmer: [SELL(ITEM.WHEAT, 20, 1), SELL(ITEM.POTATO, 26, 1), SELL(ITEM.CARROT, 22, 1), BUY(1, ITEM.BREAD, 6), BUY(1, ITEM.PUMPKIN_PIE, 4),
    BUY(3, ITEM.GOLDEN_CARROT, 3), BUY(1, ITEM.COOKIE, 18), SELL(BLOCK.PUMPKIN, 6, 1), SELL(BLOCK.MELON, 4, 1), BUY(1, ITEM.APPLE, 4)],
  fisherman: [SELL(ITEM.STRING, 20, 1), SELL(ITEM.COAL, 10, 1), [[[E, 1], [ITEM.RAW_COD, 6]], [ITEM.COOKED_COD, 6]], SELL(ITEM.RAW_COD, 15, 1),
    SELL(ITEM.RAW_SALMON, 13, 1), BUY(3, ITEM.FISHING_ROD, 1, { lure: 2, unbreaking: 1 }), BUY(2, ITEM.OAK_BOAT, 1), SELL(ITEM.TROPICAL_FISH, 6, 1)],
  shepherd: [SELL(BLOCK.WHITE_WOOL, 18, 1), SELL(BLOCK.BLACK_WOOL, 18, 1), BUY(2, ITEM.SHEARS, 1), BUY(1, BLOCK.RED_WOOL, 1), BUY(1, BLOCK.LIGHT_BLUE_WOOL, 1),
    BUY(3, ITEM.WHITE_BED, 1), BUY(1, BLOCK.YELLOW_WOOL, 1)],
  fletcher: [SELL(ITEM.STICK, 32, 1), BUY(1, ITEM.ARROW, 16), [[[E, 1], [BLOCK.GRAVEL, 10]], [ITEM.FLINT, 10]], BUY(2, ITEM.BOW, 1), BUY(3, ITEM.CROSSBOW, 1),
    SELL(ITEM.FEATHER, 24, 1), BUY(7, ITEM.BOW, 1, { power: 3 }), BUY(8, ITEM.CROSSBOW, 1, { quick_charge: 2 })],
  librarian: [SELL(ITEM.PAPER, 24, 1), SELL(ITEM.BOOK, 4, 1), BUY(9, BLOCK.BOOKSHELF, 1), BUY(1, BLOCK.GLASS, 4), BUY(1, BLOCK.LANTERN, 1),
    [[[E, 14], [ITEM.IRON_PICKAXE, 1]], [ITEM.IRON_PICKAXE, 1, { efficiency: 3, unbreaking: 2 }]], [[[E, 18], [ITEM.IRON_SWORD, 1]], [ITEM.IRON_SWORD, 1, { sharpness: 3 }]],
    BUY(28, ITEM.DIAMOND_PICKAXE, 1, { mending: 1, efficiency: 2 })],
  cartographer: [SELL(ITEM.PAPER, 24, 1), SELL(BLOCK.GLASS_PANE, 11, 1), BUY(1, BLOCK.GLASS_PANE, 8), BUY(7, ITEM.EYE_OF_ENDER, 1)],
  cleric: [SELL(ITEM.ROTTEN_FLESH, 32, 1), SELL(ITEM.GOLD_INGOT, 3, 1), BUY(1, ITEM.LAPIS_LAZULI, 2), BUY(4, BLOCK.GLOWSTONE, 1), BUY(5, ITEM.ENDER_PEARL, 1),
    BUY(3, POTION_ITEMS.healing, 1), SELL(ITEM.NETHER_WART, 22, 1), BUY(2, ITEM.GLASS_BOTTLE, 6)],
  armorer: [SELL(ITEM.COAL, 15, 1), BUY(5, ITEM.IRON_HELMET, 1), BUY(9, ITEM.IRON_CHESTPLATE, 1), BUY(7, ITEM.IRON_LEGGINGS, 1), BUY(4, ITEM.IRON_BOOTS, 1),
    SELL(ITEM.IRON_INGOT, 4, 1), BUY(5, ITEM.SHIELD, 1), BUY(20, ITEM.DIAMOND_CHESTPLATE, 1, { protection: 2 }), BUY(12, ITEM.DIAMOND_BOOTS, 1, { feather_falling: 3 })],
  weaponsmith: [SELL(ITEM.COAL, 15, 1), BUY(3, ITEM.IRON_AXE, 1), BUY(4, ITEM.IRON_SWORD, 1, { sharpness: 1 }), SELL(ITEM.IRON_INGOT, 4, 1), SELL(ITEM.FLINT, 24, 1),
    BUY(17, ITEM.DIAMOND_AXE, 1), BUY(13, ITEM.DIAMOND_SWORD, 1, { sharpness: 2, looting: 1 })],
  toolsmith: [SELL(ITEM.COAL, 15, 1), BUY(1, ITEM.STONE_AXE, 1), BUY(1, ITEM.STONE_PICKAXE, 1), BUY(1, ITEM.STONE_SHOVEL, 1), SELL(ITEM.IRON_INGOT, 4, 1),
    BUY(4, ITEM.IRON_PICKAXE, 1), BUY(17, ITEM.DIAMOND_PICKAXE, 1), BUY(7, ITEM.DIAMOND_SHOVEL, 1, { efficiency: 2 })],
  butcher: [SELL(ITEM.RAW_CHICKEN, 14, 1), SELL(ITEM.RAW_PORKCHOP, 7, 1), SELL(ITEM.RAW_BEEF, 10, 1), SELL(ITEM.RAW_MUTTON, 7, 1), BUY(1, ITEM.COOKED_PORKCHOP, 5),
    BUY(1, ITEM.COOKED_CHICKEN, 8), SELL(ITEM.COAL, 15, 1)],
  leatherworker: [SELL(ITEM.LEATHER, 6, 1), BUY(3, ITEM.LEATHER_LEGGINGS, 1), BUY(5, ITEM.LEATHER_CHESTPLATE, 1), BUY(5, ITEM.LEATHER_HELMET, 1),
    BUY(6, ITEM.SADDLE, 1), SELL(ITEM.FLINT, 26, 1)],
  mason: [SELL(ITEM.CLAY_BALL, 10, 1), BUY(1, BLOCK.BRICKS, 10), SELL(BLOCK.STONE, 20, 1), BUY(1, BLOCK.STONE_BRICKS, 4), BUY(1, BLOCK.ORANGE_TERRACOTTA, 1),
    BUY(1, BLOCK.QUARTZ_BLOCK, 1), BUY(1, BLOCK.POLISHED ?? BLOCK.SMOOTH_STONE, 4)],
};

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

// The offers of a villager with this job and seed: [{ cost, give, uses, max }]
export function tradesFor(job, seed) {
  const pool = POOLS[job];
  if (!pool) return [];
  const rand = rng(seed);
  const idx = pool.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const n = Math.min(pool.length, 5 + Math.floor(rand() * 3));
  return idx.slice(0, n).sort((a, b) => a - b).map((i) => {
    const [cost, give] = pool[i];
    return { cost: cost.map((c) => c.slice()), give: give.slice(), uses: 0, max: 12 };
  });
}
