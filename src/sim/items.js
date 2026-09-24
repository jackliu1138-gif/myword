// Items: every block is an item (id < 256); tools, weapons, food and materials follow from 256.
// Pure data, shared by the game, the simulation and (later) the multiplayer server.

import { BLOCK, BLOCKS } from '../world/blocks.js';

export const ITEM_BASE = 256;
const defs = [];
export const ITEM = {};

function item(key, props) {
  const id = ITEM_BASE + defs.length;
  const d = {
    id, key, kind: 'material', stack: 64,
    name: props.name || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    zh: props.zh || '',
    ...props,
  };
  defs.push(d);
  ITEM[key.toUpperCase()] = id;
  return id;
}

// materials
item('stick', { zh: '木棍' });
item('coal', { zh: '煤炭' });
item('iron_ingot', { zh: '铁锭' });
item('gold_ingot', { zh: '金锭' });
item('diamond', { zh: '钻石' });
item('flint', { zh: '燧石' });
item('feather', { zh: '羽毛' });
item('bone', { zh: '骨头' });
item('gunpowder', { zh: '火药' });
item('string', { zh: '线' });
item('leather', { zh: '皮革' });
item('wheat', { zh: '小麦' });
item('wheat_seeds', { name: 'Seeds', zh: '小麦种子' });
item('emerald', { zh: '绿宝石' });
// weapons and tools (tier: 1 wood, 2 stone, 3 iron, 4 diamond)
item('wooden_sword', { zh: '木剑', kind: 'sword', stack: 1, damage: 4, durability: 60, tier: 1 });
item('stone_sword', { zh: '石剑', kind: 'sword', stack: 1, damage: 5, durability: 132, tier: 2 });
item('iron_sword', { zh: '铁剑', kind: 'sword', stack: 1, damage: 6, durability: 251, tier: 3 });
item('diamond_sword', { zh: '钻石剑', kind: 'sword', stack: 1, damage: 7, durability: 1562, tier: 4 });
item('wooden_pickaxe', { zh: '木镐', kind: 'pickaxe', stack: 1, damage: 2, durability: 60, tier: 1, speed: 2 });
item('stone_pickaxe', { zh: '石镐', kind: 'pickaxe', stack: 1, damage: 3, durability: 132, tier: 2, speed: 4 });
item('iron_pickaxe', { zh: '铁镐', kind: 'pickaxe', stack: 1, damage: 4, durability: 251, tier: 3, speed: 6 });
item('diamond_pickaxe', { zh: '钻石镐', kind: 'pickaxe', stack: 1, damage: 5, durability: 1562, tier: 4, speed: 8 });
item('wooden_axe', { zh: '木斧', kind: 'axe', stack: 1, damage: 3, durability: 60, tier: 1, speed: 2 });
item('stone_axe', { zh: '石斧', kind: 'axe', stack: 1, damage: 4, durability: 132, tier: 2, speed: 4 });
item('iron_axe', { zh: '铁斧', kind: 'axe', stack: 1, damage: 5, durability: 251, tier: 3, speed: 6 });
item('wooden_shovel', { zh: '木锹', kind: 'shovel', stack: 1, damage: 2, durability: 60, tier: 1, speed: 2 });
item('stone_shovel', { zh: '石锹', kind: 'shovel', stack: 1, damage: 2, durability: 132, tier: 2, speed: 4 });
item('iron_shovel', { zh: '铁锹', kind: 'shovel', stack: 1, damage: 3, durability: 251, tier: 3, speed: 6 });
item('bow', { zh: '弓', kind: 'bow', stack: 1, durability: 385 });
item('arrow', { zh: '箭', kind: 'arrow' });
// food: heal = health restored (half hearts)
item('apple', { zh: '苹果', kind: 'food', heal: 4 });
item('bread', { zh: '面包', kind: 'food', heal: 5 });
item('raw_beef', { zh: '生牛肉', kind: 'food', heal: 3 });
item('raw_porkchop', { zh: '生猪排', kind: 'food', heal: 3 });
item('raw_chicken', { zh: '生鸡肉', kind: 'food', heal: 2 });
item('raw_mutton', { zh: '生羊肉', kind: 'food', heal: 2 });
item('cooked_beef', { name: 'Steak', zh: '牛排', kind: 'food', heal: 8 });
item('cooked_porkchop', { zh: '熟猪排', kind: 'food', heal: 8 });
item('cooked_chicken', { zh: '熟鸡肉', kind: 'food', heal: 6 });
item('cooked_mutton', { zh: '熟羊肉', kind: 'food', heal: 6 });
item('rotten_flesh', { zh: '腐肉', kind: 'food', heal: 1 });

export const ITEMS = defs;

const blockItem = new Map();
export function itemDef(id) {
  if (id === null || id === undefined) return null;
  if (id < ITEM_BASE) {
    const b = BLOCKS[id];
    if (!b) return null;
    let d = blockItem.get(id);
    if (!d) {
      d = { id, key: b.key, kind: 'block', stack: 64, name: b.name, zh: b.zh, block: id };
      blockItem.set(id, d);
    }
    return d;
  }
  return defs[id - ITEM_BASE] || null;
}

export const isBlockItem = (id) => id > 0 && id < ITEM_BASE;

// What a broken block leaves behind in survival: [itemId, count] pairs (random ranges allowed).
export function blockDrops(block, rnd = Math.random) {
  switch (block) {
    case BLOCK.STONE: return [[BLOCK.COBBLESTONE, 1]];
    case BLOCK.GRASS: case BLOCK.SNOWY_GRASS: return [[BLOCK.DIRT, 1]];
    case BLOCK.COAL_ORE: return [[ITEM.COAL, 1]];
    case BLOCK.IRON_ORE: return [[ITEM.IRON_INGOT, 1]];
    case BLOCK.GOLD_ORE: return [[ITEM.GOLD_INGOT, 1]];
    case BLOCK.DIAMOND_ORE: return [[ITEM.DIAMOND, 1]];
    case BLOCK.GRAVEL: return rnd() < 0.15 ? [[ITEM.FLINT, 1]] : [[BLOCK.GRAVEL, 1]];
    case BLOCK.OAK_LEAVES: return rnd() < 0.06 ? [[ITEM.APPLE, 1]] : [];
    case BLOCK.BIRCH_LEAVES: case BLOCK.SPRUCE_LEAVES: return [];
    case BLOCK.TALL_GRASS: case BLOCK.FERN: return rnd() < 0.12 ? [[ITEM.WHEAT_SEEDS, 1]] : [];
    case BLOCK.GLASS: case BLOCK.ICE: return [];
    case BLOCK.GLOWSTONE: return [[BLOCK.GLOWSTONE, 1]];
    case BLOCK.BOOKSHELF: return [[BLOCK.OAK_PLANKS, 3]];
    case BLOCK.BEDROCK: case BLOCK.WATER: case BLOCK.LAVA: return [];
    default: return block ? [[block, 1]] : [];
  }
}

// Breaking time in seconds by hand; tools divide it by their speed when they suit the block.
// tool: the kind of tool that speeds it up; tier: minimum pickaxe tier needed to get a drop.
const HARD = {};
const setHard = (keys, t, tool, tier = 0) => { for (const k of keys) HARD[BLOCK[k.toUpperCase()]] = { t, tool, tier }; };
setHard(['dirt', 'grass', 'snowy_grass', 'sand', 'gravel', 'clay', 'snow'], 0.6, 'shovel');
setHard(['oak_log', 'birch_log', 'spruce_log', 'oak_planks', 'birch_planks', 'spruce_planks', 'crafting_table', 'bookshelf', 'pumpkin', 'jack_o_lantern'], 2.0, 'axe');
setHard(['stone', 'cobblestone', 'mossy_cobblestone', 'stone_bricks', 'bricks', 'smooth_stone', 'sandstone', 'terracotta', 'quartz_block'], 3.0, 'pickaxe', 1);
setHard(['coal_ore'], 3.2, 'pickaxe', 1);
setHard(['iron_ore', 'gold_ore'], 3.6, 'pickaxe', 2);
setHard(['diamond_ore', 'gold_block', 'iron_block', 'diamond_block'], 4.2, 'pickaxe', 3);
setHard(['obsidian'], 15, 'pickaxe', 4);
setHard(['oak_leaves', 'birch_leaves', 'spruce_leaves'], 0.3, 'none');
setHard(['glass', 'ice', 'glowstone', 'sea_lantern'], 0.45, 'none');
setHard(['tall_grass', 'fern', 'poppy', 'dandelion', 'cornflower', 'dead_bush', 'torch'], 0.0, 'none');
setHard(['cactus'], 0.6, 'none');

export function breakInfo(block, heldId) {
  const h = HARD[block] || { t: 0.8, tool: 'none', tier: 0 };
  const held = itemDef(heldId);
  let time = h.t;
  let drops = true;
  if (h.tool === 'pickaxe') {
    const ok = held && held.kind === 'pickaxe' && held.tier >= h.tier;
    if (held && held.kind === 'pickaxe') time /= held.speed;
    else time *= 1.6;
    if (!ok) drops = false;
  } else if (h.tool !== 'none' && held && held.kind === h.tool) time /= held.speed;
  if (block === BLOCK.BEDROCK) time = Infinity;
  return { time, drops };
}

// Crafting: the recipe book lists everything; a recipe is craftable when the inventory holds
// its ingredients. [output id, count, [[ingredient id, count], ...]]
const P = [BLOCK.OAK_PLANKS, BLOCK.BIRCH_PLANKS, BLOCK.SPRUCE_PLANKS];
export const RECIPES = [
  [BLOCK.OAK_PLANKS, 4, [[BLOCK.OAK_LOG, 1]]],
  [BLOCK.BIRCH_PLANKS, 4, [[BLOCK.BIRCH_LOG, 1]]],
  [BLOCK.SPRUCE_PLANKS, 4, [[BLOCK.SPRUCE_LOG, 1]]],
  [ITEM.STICK, 4, [['planks', 2]]],
  [BLOCK.TORCH, 4, [[ITEM.COAL, 1], [ITEM.STICK, 1]]],
  [BLOCK.CRAFTING_TABLE, 1, [['planks', 4]]],
  [ITEM.WOODEN_SWORD, 1, [['planks', 2], [ITEM.STICK, 1]]],
  [ITEM.WOODEN_PICKAXE, 1, [['planks', 3], [ITEM.STICK, 2]]],
  [ITEM.WOODEN_AXE, 1, [['planks', 3], [ITEM.STICK, 2]]],
  [ITEM.WOODEN_SHOVEL, 1, [['planks', 1], [ITEM.STICK, 2]]],
  [ITEM.STONE_SWORD, 1, [[BLOCK.COBBLESTONE, 2], [ITEM.STICK, 1]]],
  [ITEM.STONE_PICKAXE, 1, [[BLOCK.COBBLESTONE, 3], [ITEM.STICK, 2]]],
  [ITEM.STONE_AXE, 1, [[BLOCK.COBBLESTONE, 3], [ITEM.STICK, 2]]],
  [ITEM.STONE_SHOVEL, 1, [[BLOCK.COBBLESTONE, 1], [ITEM.STICK, 2]]],
  [ITEM.IRON_SWORD, 1, [[ITEM.IRON_INGOT, 2], [ITEM.STICK, 1]]],
  [ITEM.IRON_PICKAXE, 1, [[ITEM.IRON_INGOT, 3], [ITEM.STICK, 2]]],
  [ITEM.IRON_AXE, 1, [[ITEM.IRON_INGOT, 3], [ITEM.STICK, 2]]],
  [ITEM.IRON_SHOVEL, 1, [[ITEM.IRON_INGOT, 1], [ITEM.STICK, 2]]],
  [ITEM.DIAMOND_SWORD, 1, [[ITEM.DIAMOND, 2], [ITEM.STICK, 1]]],
  [ITEM.DIAMOND_PICKAXE, 1, [[ITEM.DIAMOND, 3], [ITEM.STICK, 2]]],
  [ITEM.BOW, 1, [[ITEM.STICK, 3], [ITEM.STRING, 3]]],
  [ITEM.ARROW, 4, [[ITEM.FLINT, 1], [ITEM.STICK, 1], [ITEM.FEATHER, 1]]],
  [ITEM.STRING, 2, [[BLOCK.WHITE_WOOL, 1]]],
  [ITEM.BREAD, 1, [[ITEM.WHEAT, 3]]],
  // a campfire's worth of cooking without a furnace: meat plus a piece of coal
  [ITEM.COOKED_BEEF, 1, [[ITEM.RAW_BEEF, 1], [ITEM.COAL, 1]]],
  [ITEM.COOKED_PORKCHOP, 1, [[ITEM.RAW_PORKCHOP, 1], [ITEM.COAL, 1]]],
  [ITEM.COOKED_CHICKEN, 1, [[ITEM.RAW_CHICKEN, 1], [ITEM.COAL, 1]]],
  [ITEM.COOKED_MUTTON, 1, [[ITEM.RAW_MUTTON, 1], [ITEM.COAL, 1]]],
  [BLOCK.STONE_BRICKS, 4, [[BLOCK.STONE, 4]]],
  [BLOCK.SANDSTONE, 1, [[BLOCK.SAND, 4]]],
  [BLOCK.STONE, 1, [[BLOCK.COBBLESTONE, 1], [ITEM.COAL, 1]]],
  [BLOCK.GLASS, 1, [[BLOCK.SAND, 1], [ITEM.COAL, 1]]],
  [BLOCK.BRICKS, 1, [[BLOCK.CLAY, 1], [ITEM.COAL, 1]]],
  [BLOCK.JACK_O_LANTERN, 1, [[BLOCK.PUMPKIN, 1], [BLOCK.TORCH, 1]]],
  [BLOCK.GOLD_BLOCK, 1, [[ITEM.GOLD_INGOT, 9]]],
  [BLOCK.IRON_BLOCK, 1, [[ITEM.IRON_INGOT, 9]]],
  [BLOCK.DIAMOND_BLOCK, 1, [[ITEM.DIAMOND, 9]]],
];
export const PLANKS = P;
