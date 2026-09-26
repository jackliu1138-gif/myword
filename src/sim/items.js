// Items: every block is an item (id < 256); tools, weapons, food and materials follow from 256.
// Pure data, shared by the game, the simulation and (later) the multiplayer server.

import { BLOCK, BLOCKS, DYES, BED_BLOCKS } from '../world/blocks.js';

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

// ---- appended (item ids are saved): the rest of the tool sets, armour, beds, the Nether and the End
// tool materials. tier = mining level (gold digs fast but only what wood can); dmg = bonus damage
export const TOOL_MATERIALS = {
  wooden: { zh: '木', tier: 1, speed: 2, durability: 60, dmg: 0 },
  stone: { zh: '石', tier: 2, speed: 4, durability: 132, dmg: 1 },
  iron: { zh: '铁', tier: 3, speed: 6, durability: 251, dmg: 2 },
  golden: { zh: '金', tier: 1, speed: 12, durability: 33, dmg: 0 },
  diamond: { zh: '钻石', tier: 4, speed: 8, durability: 1562, dmg: 3 },
  netherite: { zh: '下界合金', tier: 5, speed: 9, durability: 2032, dmg: 4 },
};
const TOOL_KINDS = {
  sword: { zh: '剑', base: 4 }, pickaxe: { zh: '镐', base: 2 }, axe: { zh: '斧', base: 3 }, shovel: { zh: '锹', base: 2 }, hoe: { zh: '锄', base: 1 },
};
function tool(mat, kind) {
  const m = TOOL_MATERIALS[mat], k = TOOL_KINDS[kind];
  const damage = kind === 'shovel' ? k.base + Math.floor(m.dmg / 2) : kind === 'hoe' ? 1 : k.base + m.dmg;
  item(mat + '_' + kind, {
    zh: m.zh + k.zh, kind, stack: 1, damage, durability: m.durability, tier: m.tier, material: mat,
    ...(kind === 'sword' ? {} : { speed: m.speed }),
  });
}
for (const kind of ['hoe']) for (const mat of ['wooden', 'stone', 'iron']) tool(mat, kind);
for (const kind of ['axe', 'shovel', 'hoe']) tool('diamond', kind);
for (const mat of ['golden', 'netherite']) for (const kind of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe']) tool(mat, kind);

// armour: points per piece (head, chest, legs, feet), toughness, and durability = base x multiplier
export const ARMOR_MATERIALS = {
  leather: { zh: '皮革', points: [1, 3, 2, 1], toughness: 0, mult: 5, names: ['帽子', '外套', '裤子', '靴子'] },
  chainmail: { zh: '锁链', points: [2, 5, 4, 1], toughness: 0, mult: 15 },
  iron: { zh: '铁', points: [2, 6, 5, 2], toughness: 0, mult: 15 },
  golden: { zh: '金', points: [2, 5, 3, 1], toughness: 0, mult: 7 },
  diamond: { zh: '钻石', points: [3, 8, 6, 3], toughness: 2, mult: 33 },
  netherite: { zh: '下界合金', points: [3, 8, 6, 3], toughness: 3, mult: 37 },
};
export const ARMOR_PIECES = ['helmet', 'chestplate', 'leggings', 'boots'];
const ARMOR_BASE = [11, 16, 15, 13];
const ARMOR_ZH = ['头盔', '胸甲', '护腿', '靴子'];
for (const [mat, m] of Object.entries(ARMOR_MATERIALS)) {
  ARMOR_PIECES.forEach((piece, slot) => {
    item(mat + '_' + piece, {
      zh: m.zh + (m.names ? m.names[slot] : ARMOR_ZH[slot]), kind: 'armor', stack: 1, slot, material: mat,
      armor: m.points[slot], toughness: m.toughness, durability: ARMOR_BASE[slot] * m.mult,
    });
  });
}
item('flint_and_steel', { zh: '打火石', kind: 'igniter', stack: 1, durability: 65 });
item('netherite_scrap', { zh: '下界合金碎片' });
item('netherite_ingot', { zh: '下界合金锭' });
item('quartz', { name: 'Nether Quartz', zh: '下界石英' });
item('blaze_rod', { zh: '烈焰棒' });
item('blaze_powder', { zh: '烈焰粉' });
item('gold_nugget', { zh: '金粒' });
item('ender_pearl', { zh: '末影珍珠', kind: 'pearl', stack: 16 });
item('eye_of_ender', { name: 'Eye of Ender', zh: '末影之眼', kind: 'eye' });
export const BED_ITEMS = {};
for (const [c, zh] of DYES) {
  const [foot, head] = BED_BLOCKS[c];
  BED_ITEMS[c] = item(c + '_bed', { zh: zh + '床', kind: 'bed', stack: 1, foot, head, color: c });
}
// the tools made before the tables above existed learn their material too
for (const d of defs) if (!d.material && /^(wooden|stone|iron|diamond)_(sword|pickaxe|axe|shovel)$/.test(d.key)) d.material = d.key.split('_')[0];

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
    case BLOCK.NETHER_QUARTZ_ORE: return [[ITEM.QUARTZ, 1]];
    case BLOCK.FARMLAND: return [[BLOCK.DIRT, 1]];
    case BLOCK.WHEAT_0: case BLOCK.WHEAT_1: case BLOCK.WHEAT_2: return [[ITEM.WHEAT_SEEDS, 1]];
    case BLOCK.WHEAT_3: return [[ITEM.WHEAT, 1], [ITEM.WHEAT_SEEDS, 1 + Math.floor(rnd() * 3)]];
    case BLOCK.FIRE: case BLOCK.NETHER_PORTAL_X: case BLOCK.NETHER_PORTAL_Z: case BLOCK.END_PORTAL: return [];
    case BLOCK.END_PORTAL_FRAME: case BLOCK.END_PORTAL_FRAME_EYE: return [];
    case BLOCK.CRACKED_STONE_BRICKS: return [[BLOCK.CRACKED_STONE_BRICKS, 1]];
    default:
      if (BLOCKS[block] && BLOCKS[block].bed) return []; // the bed item drops once, see bedAt()
      return block ? [[block, 1]] : [];
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
setHard(['farmland', 'soul_sand'], 0.6, 'shovel');
setHard(['netherrack'], 0.6, 'pickaxe', 1);
setHard(['nether_quartz_ore', 'nether_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks'], 3.0, 'pickaxe', 1);
setHard(['magma_block'], 0.9, 'pickaxe', 1);
setHard(['end_stone', 'end_stone_bricks'], 4.0, 'pickaxe', 1);
setHard(['ancient_debris'], 24, 'pickaxe', 4);
setHard(['netherite_block'], 40, 'pickaxe', 4);
setHard(['dragon_egg'], 3.0, 'none');
setHard(['wheat_0', 'wheat_1', 'wheat_2', 'wheat_3', 'fire'], 0.0, 'none');
for (const b of BLOCKS) if (b.bed) HARD[b.id] = { t: 0.3, tool: 'none', tier: 0 };

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
  if (block === BLOCK.BEDROCK || block === BLOCK.END_PORTAL_FRAME || block === BLOCK.END_PORTAL_FRAME_EYE) time = Infinity;
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
{
  // every tool of every material: [material item, how many] + sticks
  const MAT_ITEM = { wooden: 'planks', stone: BLOCK.COBBLESTONE, iron: ITEM.IRON_INGOT, golden: ITEM.GOLD_INGOT, diamond: ITEM.DIAMOND };
  const SHAPES = { sword: [2, 1], pickaxe: [3, 2], axe: [3, 2], shovel: [1, 2], hoe: [2, 2] };
  const have = new Set(RECIPES.map((r) => r[0]));
  for (const [mat, src] of Object.entries(MAT_ITEM)) {
    for (const [kind, [n, sticks]] of Object.entries(SHAPES)) {
      const id = ITEM[(mat + '_' + kind).toUpperCase()];
      if (id && !have.has(id)) RECIPES.push([id, 1, [[src, n], [ITEM.STICK, sticks]]]);
    }
  }
  // armour: 5 for a helmet, 8 for a chestplate, 7 for leggings, 4 for boots
  const ARMOR_SRC = { leather: ITEM.LEATHER, iron: ITEM.IRON_INGOT, golden: ITEM.GOLD_INGOT, diamond: ITEM.DIAMOND };
  for (const [mat, src] of Object.entries(ARMOR_SRC)) {
    ARMOR_PIECES.forEach((piece, i) => RECIPES.push([ITEM[(mat + '_' + piece).toUpperCase()], 1, [[src, [5, 8, 7, 4][i]]]]));
  }
  // chainmail from iron and string (there is no chain item)
  ARMOR_PIECES.forEach((piece, i) => RECIPES.push([ITEM[('chainmail_' + piece).toUpperCase()], 1, [[ITEM.IRON_INGOT, [2, 4, 3, 2][i]], [ITEM.STRING, [3, 4, 4, 2][i]]]]));
  // netherite: smelt debris into scrap, alloy it with gold, then upgrade diamond gear with an ingot
  RECIPES.push([ITEM.NETHERITE_SCRAP, 1, [[BLOCK.ANCIENT_DEBRIS, 1], [ITEM.COAL, 1]]]);
  RECIPES.push([ITEM.NETHERITE_INGOT, 1, [[ITEM.NETHERITE_SCRAP, 4], [ITEM.GOLD_INGOT, 4]]]);
  for (const kind of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe']) RECIPES.push([ITEM['NETHERITE_' + kind.toUpperCase()], 1, [[ITEM['DIAMOND_' + kind.toUpperCase()], 1], [ITEM.NETHERITE_INGOT, 1]]]);
  for (const piece of ARMOR_PIECES) RECIPES.push([ITEM['NETHERITE_' + piece.toUpperCase()], 1, [[ITEM['DIAMOND_' + piece.toUpperCase()], 1], [ITEM.NETHERITE_INGOT, 1]]]);
  RECIPES.push([BLOCK.NETHERITE_BLOCK, 1, [[ITEM.NETHERITE_INGOT, 9]]]);
  // beds: three wool of one colour and three planks
  for (const [c] of DYES) RECIPES.push([BED_ITEMS[c], 1, [[BLOCK[(c + '_wool').toUpperCase()], 3], ['planks', 3]]]);
  RECIPES.push([ITEM.FLINT_AND_STEEL, 1, [[ITEM.IRON_INGOT, 1], [ITEM.FLINT, 1]]]);
  RECIPES.push([ITEM.BLAZE_POWDER, 2, [[ITEM.BLAZE_ROD, 1]]]);
  RECIPES.push([ITEM.EYE_OF_ENDER, 1, [[ITEM.ENDER_PEARL, 1], [ITEM.BLAZE_POWDER, 1]]]);
  RECIPES.push([ITEM.GOLD_INGOT, 1, [[ITEM.GOLD_NUGGET, 9]]]);
  RECIPES.push([BLOCK.NETHER_BRICKS, 2, [[BLOCK.NETHERRACK, 2], [ITEM.COAL, 1]]]);
  RECIPES.push([BLOCK.QUARTZ_BLOCK, 1, [[ITEM.QUARTZ, 4]]]);
  RECIPES.push([BLOCK.END_STONE_BRICKS, 4, [[BLOCK.END_STONE, 4]]]);
  RECIPES.push([BLOCK.LIGHT_GRAY_WOOL, 1, [[BLOCK.GRAY_WOOL, 1], [BLOCK.WHITE_WOOL, 1]]]);
}
export const PLANKS = P;
