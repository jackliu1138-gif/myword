// Items: every block is an item (id < 256); tools, weapons, food and materials follow from 256.
// Pure data, shared by the game, the simulation and (later) the multiplayer server.

import { BLOCK, BLOCKS, DYES, BED_BLOCKS } from '../world/blocks.js';
import { POTIONS } from './effects.js';

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

// ---- appended with chests, furnaces and building blocks
// doors and signs are placed from an item, like beds (a door is two blocks, a sign goes on a post or a wall)
for (const [w, zh] of [['oak', '橡木'], ['birch', '白桦木'], ['spruce', '云杉木']]) item(w + '_door', { zh: zh + '门', kind: 'door', block: BLOCK[(w + '_door').toUpperCase()] });
item('oak_sign', { name: 'Sign', zh: '告示牌', kind: 'sign', stack: 16 });
// buckets: `holds` is the liquid block a full one pours out
item('bucket', { zh: '桶', kind: 'bucket', stack: 16 });
item('water_bucket', { zh: '水桶', kind: 'bucket', stack: 1, holds: BLOCK.WATER });
item('lava_bucket', { zh: '熔岩桶', kind: 'bucket', stack: 1, holds: BLOCK.LAVA });
item('milk_bucket', { zh: '奶桶', kind: 'milk', stack: 1 });
// what the furnace makes
item('charcoal', { zh: '木炭' });
item('raw_iron', { zh: '粗铁' });
item('raw_gold', { zh: '粗金' });
item('clay_ball', { zh: '黏土球' });
item('brick', { zh: '红砖' });
item('nether_brick', { name: 'Nether Brick', zh: '下界砖' });
item('bone_meal', { zh: '骨粉', kind: 'fertilizer' });

// ---- appended with hunger, experience, enchanting, potions, creatures and transport
// food: points of hunger (food) and saturation (sat) it gives back; `effect` a chance of an effect
item('raw_cod', { zh: '生鳕鱼', kind: 'food', food: 2, sat: 0.4 });
item('cooked_cod', { zh: '熟鳕鱼', kind: 'food', food: 5, sat: 6 });
item('raw_salmon', { zh: '生鲑鱼', kind: 'food', food: 2, sat: 0.4 });
item('cooked_salmon', { zh: '熟鲑鱼', kind: 'food', food: 6, sat: 9.6 });
item('tropical_fish', { zh: '热带鱼', kind: 'food', food: 1, sat: 0.2 });
item('pufferfish', { zh: '河豚', kind: 'food', food: 1, sat: 0.2, effects: [['poison', 60, 1, 1], ['hunger', 15, 2, 1]] });
item('carrot', { zh: '胡萝卜', kind: 'food', food: 3, sat: 3.6, plant: 'carrots' });
item('potato', { zh: '马铃薯', kind: 'food', food: 1, sat: 0.6, plant: 'potatoes' });
item('baked_potato', { zh: '烤马铃薯', kind: 'food', food: 5, sat: 6 });
item('melon_slice', { zh: '西瓜片', kind: 'food', food: 2, sat: 1.2 });
item('golden_carrot', { zh: '金胡萝卜', kind: 'food', food: 6, sat: 14.4 });
item('golden_apple', { zh: '金苹果', kind: 'food', food: 4, sat: 9.6, always: true, effects: [['regeneration', 5, 1, 1], ['absorption', 120, 0, 1]] });
item('spider_eye', { zh: '蜘蛛眼', kind: 'food', food: 2, sat: 3.2, effects: [['poison', 5, 0, 1]] });
item('cookie', { zh: '曲奇', kind: 'food', food: 2, sat: 0.4 });
item('pumpkin_pie', { zh: '南瓜派', kind: 'food', food: 8, sat: 4.8 });
item('nether_wart', { zh: '下界疣', plant: 'nether_wart' });
item('paper', { zh: '纸' });
item('book', { zh: '书' });
item('sugar', { zh: '糖' });
item('ink_sac', { zh: '墨囊' });
item('slime_ball', { zh: '黏液球' });
item('magma_cream', { zh: '岩浆膏' });
item('ghast_tear', { zh: '恶魂之泪' });
item('glowstone_dust', { zh: '荧石粉' });
item('fermented_spider_eye', { zh: '发酵蛛眼' });
item('glistering_melon_slice', { zh: '闪烁的西瓜片' });
item('glass_bottle', { zh: '玻璃瓶', kind: 'bottle' });
item('lapis_lazuli', { zh: '青金石' });
item('prismarine_shard', { zh: '海晶碎片' });
item('prismarine_crystals', { zh: '海晶砂粒' });
item('phantom_membrane', { zh: '幻翼膜' });
item('shulker_shell', { zh: '潜影壳' });
item('nether_star', { zh: '下界之星' });
item('totem_of_undying', { zh: '不死图腾', kind: 'totem', stack: 1 });
item('saddle', { zh: '鞍', kind: 'saddle', stack: 1 });
// tools and gear
item('shears', { zh: '剪刀', kind: 'shears', stack: 1, durability: 238 });
item('fishing_rod', { zh: '钓鱼竿', kind: 'fishing_rod', stack: 1, durability: 64 });
item('crossbow', { zh: '弩', kind: 'crossbow', stack: 1, durability: 465 });
item('shield', { zh: '盾牌', kind: 'shield', stack: 1, durability: 336 });
item('elytra', { zh: '鞘翅', kind: 'armor', slot: 1, material: 'elytra', armor: 0, toughness: 0, durability: 432, stack: 1, elytra: true });
item('firework_rocket', { zh: '烟花火箭', kind: 'firework' });
item('oak_boat', { name: 'Boat', zh: '船', kind: 'boat', stack: 1 });
item('minecart', { zh: '矿车', kind: 'minecart', stack: 1 });
item('iron_door', { zh: '铁门', kind: 'door', block: BLOCK.IRON_DOOR });
// potions: a drinkable one and a splash one of each (the potion's key in `potion`)
export const POTION_ITEMS = {};
export const SPLASH_ITEMS = {};
for (const [k, p] of Object.entries(POTIONS)) {
  POTION_ITEMS[k] = item(k === 'water' ? 'water_bottle' : k === 'awkward' ? 'awkward_potion' : 'potion_of_' + k, { name: p.en, zh: p.zh, kind: 'potion', stack: 1, potion: k, color: p.color });
  if (k === 'awkward') continue;
  SPLASH_ITEMS[k] = item('splash_' + (k === 'water' ? 'water_bottle' : 'potion_of_' + k), {
    name: 'Splash ' + p.en, zh: '喷溅型' + p.zh, kind: 'splash', stack: 1, potion: k, color: p.color,
  });
}
// spawn eggs (for creative): the creature and its two colours
export const EGG_MOBS = {
  zombie: [0x00afaf, 0x799c65, '僵尸'], skeleton: [0xc1c1c1, 0x494949, '骷髅'], creeper: [0x0da70b, 0x000000, '苦力怕'], spider: [0x342d27, 0xa80e0e, '蜘蛛'],
  cow: [0x443626, 0xa1a1a1, '牛'], pig: [0xf0a5a2, 0xdb635f, '猪'], sheep: [0xe7e7e7, 0xffb5b5, '羊'], chicken: [0xa1a1a1, 0xff0000, '鸡'],
  zombified_piglin: [0xea9393, 0x4c7129, '僵尸猪灵'], blaze: [0xf6b201, 0xfff87e, '烈焰人'], ghast: [0xf9f9f9, 0xbcbcbc, '恶魂'], enderman: [0x161616, 0x000000, '末影人'],
  villager: [0x563c33, 0xbd8b72, '村民'], iron_golem: [0xdbcdc1, 0x74a332, '铁傀儡'], wolf: [0xd7d3d3, 0xceaf96, '狼'], cat: [0xefc88e, 0x957256, '猫'],
  cod: [0xc1a76a, 0xe5c48b, '鳕鱼'], salmon: [0xa00f10, 0x0e8474, '鲑鱼'], tropical_fish: [0xef6915, 0xfff9ef, '热带鱼'], pufferfish: [0xf6b201, 0x37c3f2, '河豚'],
  squid: [0x223b4d, 0x708899, '鱿鱼'], witch: [0x340000, 0x51a03e, '女巫'], slime: [0x51a03e, 0x7ebf6e, '史莱姆'], phantom: [0x43518a, 0x88ff00, '幻翼'],
  pillager: [0x532f36, 0x959b9b, '掠夺者'], vindicator: [0x959b9b, 0x275e61, '卫道士'], evoker: [0x959b9b, 0x1e1c1a, '唤魔者'], wither_skeleton: [0x141414, 0x474d4d, '凋灵骷髅'],
  guardian: [0x5a8272, 0xf17d30, '守卫者'], elder_guardian: [0xceccba, 0x747693, '远古守卫者'], shulker: [0x946794, 0x4d3852, '潜影贝'], cave_spider: [0x0c424e, 0xa80e0e, '洞穴蜘蛛'],
  horse: [0xc09e7d, 0xeee500, '马'],
};
export const EGG_ITEMS = {};
for (const [type, [c1, c2, zh]] of Object.entries(EGG_MOBS)) {
  EGG_ITEMS[type] = item(type + '_spawn_egg', { zh: zh + '刷怪蛋', kind: 'egg', mob: type, colors: [c1, c2] });
}

export const ITEMS = defs;

// hunger and saturation of the older foods (they used to heal straight away)
const FOOD_VALUES = {
  apple: [4, 2.4], bread: [5, 6], raw_beef: [3, 1.8], raw_porkchop: [3, 1.8], raw_chicken: [2, 1.2, [['hunger', 30, 0, 0.3]]], raw_mutton: [2, 1.2],
  cooked_beef: [8, 12.8], cooked_porkchop: [8, 12.8], cooked_chicken: [6, 7.2], cooked_mutton: [6, 9.6], rotten_flesh: [4, 0.8, [['hunger', 30, 0, 0.8]]],
};
for (const [k, [food, sat, effects]] of Object.entries(FOOD_VALUES)) {
  const d = defs[ITEM[k.toUpperCase()] - ITEM_BASE];
  d.food = food; d.sat = sat;
  if (effects) d.effects = effects;
}

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
    case BLOCK.IRON_ORE: return [[ITEM.RAW_IRON, 1]];
    case BLOCK.GOLD_ORE: return [[ITEM.RAW_GOLD, 1]];
    case BLOCK.CLAY: return [[ITEM.CLAY_BALL, 4]];
    case BLOCK.DIAMOND_ORE: return [[ITEM.DIAMOND, 1]];
    case BLOCK.GRAVEL: return rnd() < 0.15 ? [[ITEM.FLINT, 1]] : [[BLOCK.GRAVEL, 1]];
    case BLOCK.OAK_LEAVES: { const r = rnd(); return r < 0.05 ? [[BLOCK.OAK_SAPLING, 1]] : r < 0.11 ? [[ITEM.APPLE, 1]] : []; }
    case BLOCK.BIRCH_LEAVES: return rnd() < 0.05 ? [[BLOCK.BIRCH_SAPLING, 1]] : [];
    case BLOCK.SPRUCE_LEAVES: return rnd() < 0.05 ? [[BLOCK.SPRUCE_SAPLING, 1]] : [];
    case BLOCK.LIT_FURNACE: return [[BLOCK.FURNACE, 1]];
    case BLOCK.GLASS_PANE: return [];
    case BLOCK.OAK_SIGN: case BLOCK.OAK_WALL_SIGN: return [[ITEM.OAK_SIGN, 1]];
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
    case BLOCK.JUNGLE_LEAVES: return rnd() < 0.025 ? [[BLOCK.JUNGLE_SAPLING, 1]] : [];
    case BLOCK.ACACIA_LEAVES: return rnd() < 0.05 ? [[BLOCK.ACACIA_SAPLING, 1]] : [];
    case BLOCK.DARK_OAK_LEAVES: { const r = rnd(); return r < 0.05 ? [[BLOCK.DARK_OAK_SAPLING, 1]] : r < 0.1 ? [[ITEM.APPLE, 1]] : []; }
    case BLOCK.CHERRY_LEAVES: return rnd() < 0.05 ? [[BLOCK.CHERRY_SAPLING, 1]] : [];
    case BLOCK.MELON: return [[ITEM.MELON_SLICE, 3 + Math.floor(rnd() * 5)]];
    case BLOCK.LAPIS_ORE: return [[ITEM.LAPIS_LAZULI, 4 + Math.floor(rnd() * 5)]];
    case BLOCK.EMERALD_ORE: return [[ITEM.EMERALD, 1]];
    case BLOCK.GLOWSTONE: return [[ITEM.GLOWSTONE_DUST, 2 + Math.floor(rnd() * 3)]];
    case BLOCK.CARROTS_0: case BLOCK.CARROTS_1: case BLOCK.CARROTS_2: return [[ITEM.CARROT, 1]];
    case BLOCK.CARROTS_3: return [[ITEM.CARROT, 2 + Math.floor(rnd() * 3)]];
    case BLOCK.POTATOES_0: case BLOCK.POTATOES_1: case BLOCK.POTATOES_2: return [[ITEM.POTATO, 1]];
    case BLOCK.POTATOES_3: return [[ITEM.POTATO, 2 + Math.floor(rnd() * 3)]];
    case BLOCK.NETHER_WART_0: case BLOCK.NETHER_WART_1: return [[ITEM.NETHER_WART, 1]];
    case BLOCK.NETHER_WART_2: return [[ITEM.NETHER_WART, 2 + Math.floor(rnd() * 3)]];
    case BLOCK.VINE: case BLOCK.SPAWNER: case BLOCK.END_GATEWAY: return [];
    case BLOCK.COBWEB: return [[ITEM.STRING, 1]];
    case BLOCK.DIRT_PATH: return [[BLOCK.DIRT, 1]];
    default:
      if (BLOCKS[block] && BLOCKS[block].bed) return []; // the bed item drops once, see breakBed()
      if (BLOCKS[block] && BLOCKS[block].model === 'door') return []; // likewise the door, see breakDoor()
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
setHard(['chest'], 2.5, 'axe');
setHard(['furnace', 'lit_furnace'], 3.5, 'pickaxe', 1);
setHard(['oak_sapling', 'birch_sapling', 'spruce_sapling'], 0, 'none');
setHard(['oak_door', 'birch_door', 'spruce_door', 'oak_trapdoor'], 3.0, 'axe');
setHard(['oak_fence', 'birch_fence', 'spruce_fence', 'oak_fence_gate', 'birch_fence_gate', 'spruce_fence_gate'], 2.0, 'axe');
setHard(['nether_brick_fence'], 3.0, 'pickaxe', 1);
setHard(['ladder'], 0.4, 'axe');
setHard(['glass_pane'], 0.3, 'none');
setHard(['iron_bars'], 5.0, 'pickaxe', 1);
setHard(['oak_sign', 'oak_wall_sign'], 1.0, 'axe');
setHard(['jungle_log', 'acacia_log', 'dark_oak_log', 'cherry_log', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'cherry_planks'], 2.0, 'axe');
setHard(['jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'cherry_leaves', 'vine'], 0.3, 'none');
setHard(['jungle_sapling', 'acacia_sapling', 'dark_oak_sapling', 'cherry_sapling', 'lily_pad', 'sugar_cane', 'pink_petals', 'tnt', 'end_rod',
  'carrots_0', 'carrots_1', 'carrots_2', 'carrots_3', 'potatoes_0', 'potatoes_1', 'potatoes_2', 'potatoes_3', 'nether_wart_0', 'nether_wart_1', 'nether_wart_2'], 0, 'none');
setHard(['red_sand', 'dirt_path'], 0.6, 'shovel');
setHard(['white_terracotta', 'orange_terracotta', 'yellow_terracotta', 'brown_terracotta', 'red_terracotta', 'light_gray_terracotta'], 1.8, 'pickaxe', 1);
setHard(['melon'], 1.0, 'axe');
setHard(['hay_bale', 'wither_skeleton_skull'], 0.6, 'none');
setHard(['lantern', 'iron_door', 'enchanting_table'], 5.0, 'pickaxe', 1);
setHard(['rail', 'powered_rail'], 0.7, 'none');
setHard(['oak_pressure_plate'], 0.5, 'axe');
setHard(['stone_pressure_plate'], 0.5, 'pickaxe', 1);
setHard(['cobweb'], 4.0, 'sword');
setHard(['spawner'], 5.0, 'pickaxe', 1);
setHard(['prismarine', 'prismarine_bricks', 'dark_prismarine', 'purpur_block', 'purpur_pillar'], 1.5, 'pickaxe', 1);
setHard(['brewing_stand'], 0.5, 'pickaxe', 1);
setHard(['lapis_ore', 'lapis_block'], 3.0, 'pickaxe', 2);
setHard(['emerald_ore'], 3.0, 'pickaxe', 3);
// slabs and stairs are as hard as what they are made of
for (const b of BLOCKS) {
  const base = b.full ?? b.base;
  if (base !== undefined && HARD[base]) HARD[b.id] = HARD[base];
}

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
  } else if (h.tool === 'sword' && held && (held.kind === 'sword' || held.kind === 'shears')) time /= 15; // cobwebs
  else if (h.tool !== 'none' && held && held.kind === h.tool) time /= held.speed;
  if (block === BLOCK.BEDROCK || block === BLOCK.END_PORTAL_FRAME || block === BLOCK.END_PORTAL_FRAME_EYE || block === BLOCK.END_GATEWAY) time = Infinity;
  return { time, drops };
}

// Crafting: the recipe book lists everything; a recipe is craftable when the inventory holds
// its ingredients. [output id, count, [[ingredient id, count], ...]]
const P = [BLOCK.OAK_PLANKS, BLOCK.BIRCH_PLANKS, BLOCK.SPRUCE_PLANKS, BLOCK.JUNGLE_PLANKS, BLOCK.ACACIA_PLANKS, BLOCK.DARK_OAK_PLANKS, BLOCK.CHERRY_PLANKS];
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
  [BLOCK.STONE_BRICKS, 4, [[BLOCK.STONE, 4]]],
  [BLOCK.SANDSTONE, 1, [[BLOCK.SAND, 4]]],
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
  // netherite: debris smelts into scrap (in a furnace), alloyed with gold, then diamond gear takes an ingot
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
  RECIPES.push([BLOCK.NETHER_BRICKS, 1, [[ITEM.NETHER_BRICK, 4]]]);
  RECIPES.push([BLOCK.QUARTZ_BLOCK, 1, [[ITEM.QUARTZ, 4]]]);
  RECIPES.push([BLOCK.END_STONE_BRICKS, 4, [[BLOCK.END_STONE, 4]]]);
  RECIPES.push([BLOCK.LIGHT_GRAY_WOOL, 1, [[BLOCK.GRAY_WOOL, 1], [BLOCK.WHITE_WOOL, 1]]]);
  // storage, smelting and building
  RECIPES.push([BLOCK.CHEST, 1, [['planks', 8]]]);
  RECIPES.push([BLOCK.FURNACE, 1, [[BLOCK.COBBLESTONE, 8]]]);
  RECIPES.push([BLOCK.TORCH, 4, [[ITEM.CHARCOAL, 1], [ITEM.STICK, 1]]]);
  RECIPES.push([BLOCK.CLAY, 1, [[ITEM.CLAY_BALL, 4]]]);
  RECIPES.push([BLOCK.BRICKS, 1, [[ITEM.BRICK, 4]]]);
  RECIPES.push([ITEM.BUCKET, 1, [[ITEM.IRON_INGOT, 3]]]);
  RECIPES.push([ITEM.BONE_MEAL, 3, [[ITEM.BONE, 1]]]);
  for (const b of BLOCKS) {
    if (b.model === 'slab') RECIPES.push([b.id, 6, [[b.full, 3]]]);
    else if (b.model === 'stairs') RECIPES.push([b.id, 4, [[b.base, 6]]]);
  }
  for (const w of ['oak', 'birch', 'spruce']) {
    const planks = BLOCK[(w + '_planks').toUpperCase()];
    RECIPES.push([ITEM[(w + '_door').toUpperCase()], 3, [[planks, 6]]]);
    RECIPES.push([BLOCK[(w + '_fence').toUpperCase()], 3, [[planks, 4], [ITEM.STICK, 2]]]);
    RECIPES.push([BLOCK[(w + '_fence_gate').toUpperCase()], 1, [[planks, 2], [ITEM.STICK, 4]]]);
  }
  RECIPES.push([BLOCK.NETHER_BRICK_FENCE, 6, [[BLOCK.NETHER_BRICKS, 4], [ITEM.NETHER_BRICK, 2]]]);
  RECIPES.push([BLOCK.OAK_TRAPDOOR, 2, [['planks', 6]]]);
  RECIPES.push([BLOCK.LADDER, 3, [[ITEM.STICK, 7]]]);
  RECIPES.push([ITEM.OAK_SIGN, 3, [['planks', 6], [ITEM.STICK, 1]]]);
  RECIPES.push([BLOCK.GLASS_PANE, 16, [[BLOCK.GLASS, 6]]]);
  RECIPES.push([BLOCK.IRON_BARS, 16, [[ITEM.IRON_INGOT, 6]]]);
  // the newer woods
  for (const w of ['jungle', 'acacia', 'dark_oak', 'cherry']) RECIPES.push([BLOCK[(w + '_planks').toUpperCase()], 4, [[BLOCK[(w + '_log').toUpperCase()], 1]]]);
  // paper and books, enchanting and brewing
  RECIPES.push([ITEM.PAPER, 3, [[BLOCK.SUGAR_CANE, 3]]]);
  RECIPES.push([ITEM.SUGAR, 1, [[BLOCK.SUGAR_CANE, 1]]]);
  RECIPES.push([ITEM.BOOK, 1, [[ITEM.PAPER, 3], [ITEM.LEATHER, 1]]]);
  RECIPES.push([BLOCK.BOOKSHELF, 1, [['planks', 6], [ITEM.BOOK, 3]]]);
  RECIPES.push([BLOCK.ENCHANTING_TABLE, 1, [[ITEM.BOOK, 1], [ITEM.DIAMOND, 2], [BLOCK.OBSIDIAN, 4]]]);
  RECIPES.push([BLOCK.BREWING_STAND, 1, [[ITEM.BLAZE_ROD, 1], [BLOCK.COBBLESTONE, 3]]]);
  RECIPES.push([ITEM.GLASS_BOTTLE, 3, [[BLOCK.GLASS, 3]]]);
  RECIPES.push([ITEM.MAGMA_CREAM, 1, [[ITEM.SLIME_BALL, 1], [ITEM.BLAZE_POWDER, 1]]]);
  RECIPES.push([ITEM.FERMENTED_SPIDER_EYE, 1, [[ITEM.SPIDER_EYE, 1], [ITEM.SUGAR, 1]]]);
  RECIPES.push([ITEM.GLISTERING_MELON_SLICE, 1, [[ITEM.MELON_SLICE, 1], [ITEM.GOLD_NUGGET, 8]]]);
  RECIPES.push([ITEM.GOLDEN_CARROT, 1, [[ITEM.CARROT, 1], [ITEM.GOLD_NUGGET, 8]]]);
  RECIPES.push([ITEM.GOLDEN_APPLE, 1, [[ITEM.APPLE, 1], [ITEM.GOLD_INGOT, 8]]]);
  RECIPES.push([ITEM.COOKIE, 8, [[ITEM.WHEAT, 2]]]);
  RECIPES.push([ITEM.PUMPKIN_PIE, 1, [[BLOCK.PUMPKIN, 1], [ITEM.SUGAR, 1]]]);
  RECIPES.push([BLOCK.LAPIS_BLOCK, 1, [[ITEM.LAPIS_LAZULI, 9]]]);
  RECIPES.push([ITEM.LAPIS_LAZULI, 9, [[BLOCK.LAPIS_BLOCK, 1]]]);
  RECIPES.push([BLOCK.GLOWSTONE, 1, [[ITEM.GLOWSTONE_DUST, 4]]]);
  RECIPES.push([BLOCK.MELON, 1, [[ITEM.MELON_SLICE, 9]]]);
  RECIPES.push([BLOCK.HAY_BALE, 1, [[ITEM.WHEAT, 9]]]);
  RECIPES.push([ITEM.WHEAT, 9, [[BLOCK.HAY_BALE, 1]]]);
  // tools and gear
  RECIPES.push([ITEM.SHEARS, 1, [[ITEM.IRON_INGOT, 2]]]);
  RECIPES.push([ITEM.FISHING_ROD, 1, [[ITEM.STICK, 3], [ITEM.STRING, 2]]]);
  RECIPES.push([ITEM.CROSSBOW, 1, [[ITEM.STICK, 3], [ITEM.STRING, 2], [ITEM.IRON_INGOT, 1]]]);
  RECIPES.push([ITEM.SHIELD, 1, [['planks', 6], [ITEM.IRON_INGOT, 1]]]);
  RECIPES.push([ITEM.FIREWORK_ROCKET, 3, [[ITEM.PAPER, 1], [ITEM.GUNPOWDER, 1]]]);
  RECIPES.push([BLOCK.TNT, 1, [[ITEM.GUNPOWDER, 5], [BLOCK.SAND, 4]]]);
  RECIPES.push([BLOCK.LANTERN, 1, [[BLOCK.TORCH, 1], [ITEM.IRON_INGOT, 1]]]);
  // getting about
  RECIPES.push([ITEM.OAK_BOAT, 1, [['planks', 5]]]);
  RECIPES.push([ITEM.MINECART, 1, [[ITEM.IRON_INGOT, 5]]]);
  RECIPES.push([BLOCK.RAIL, 16, [[ITEM.IRON_INGOT, 6], [ITEM.STICK, 1]]]);
  RECIPES.push([BLOCK.POWERED_RAIL, 6, [[ITEM.GOLD_INGOT, 6], [ITEM.STICK, 1]]]);
  RECIPES.push([ITEM.SADDLE, 1, [[ITEM.LEATHER, 5], [ITEM.IRON_INGOT, 1]]]);
  RECIPES.push([BLOCK.OAK_PRESSURE_PLATE, 1, [['planks', 2]]]);
  RECIPES.push([BLOCK.STONE_PRESSURE_PLATE, 1, [[BLOCK.STONE, 2]]]);
  RECIPES.push([ITEM.IRON_DOOR, 3, [[ITEM.IRON_INGOT, 6]]]);
  // from the sea
  RECIPES.push([BLOCK.PRISMARINE, 1, [[ITEM.PRISMARINE_SHARD, 4]]]);
  RECIPES.push([BLOCK.PRISMARINE_BRICKS, 1, [[ITEM.PRISMARINE_SHARD, 9]]]);
  RECIPES.push([BLOCK.DARK_PRISMARINE, 1, [[ITEM.PRISMARINE_SHARD, 8], [ITEM.INK_SAC, 1]]]);
  RECIPES.push([BLOCK.SEA_LANTERN, 1, [[ITEM.PRISMARINE_SHARD, 4], [ITEM.PRISMARINE_CRYSTALS, 5]]]);
}

// ---------------------------------------------------------------- the furnace
// What smelts into what: input id -> [output id, count]. Each item takes COOK_TIME seconds.
export const COOK_TIME = 10;
export const SMELTING = new Map([
  [ITEM.RAW_IRON, [ITEM.IRON_INGOT, 1]], [ITEM.RAW_GOLD, [ITEM.GOLD_INGOT, 1]],
  [BLOCK.IRON_ORE, [ITEM.IRON_INGOT, 1]], [BLOCK.GOLD_ORE, [ITEM.GOLD_INGOT, 1]], [BLOCK.DIAMOND_ORE, [ITEM.DIAMOND, 1]],
  [BLOCK.COAL_ORE, [ITEM.COAL, 1]], [BLOCK.NETHER_QUARTZ_ORE, [ITEM.QUARTZ, 1]], [BLOCK.ANCIENT_DEBRIS, [ITEM.NETHERITE_SCRAP, 1]],
  [BLOCK.SAND, [BLOCK.GLASS, 1]], [BLOCK.COBBLESTONE, [BLOCK.STONE, 1]], [BLOCK.STONE, [BLOCK.SMOOTH_STONE, 1]],
  [ITEM.CLAY_BALL, [ITEM.BRICK, 1]], [BLOCK.CLAY, [BLOCK.TERRACOTTA, 1]], [BLOCK.NETHERRACK, [ITEM.NETHER_BRICK, 1]],
  [BLOCK.STONE_BRICKS, [BLOCK.CRACKED_STONE_BRICKS, 1]],
  [ITEM.RAW_BEEF, [ITEM.COOKED_BEEF, 1]], [ITEM.RAW_PORKCHOP, [ITEM.COOKED_PORKCHOP, 1]],
  [ITEM.RAW_CHICKEN, [ITEM.COOKED_CHICKEN, 1]], [ITEM.RAW_MUTTON, [ITEM.COOKED_MUTTON, 1]],
  [BLOCK.OAK_LOG, [ITEM.CHARCOAL, 1]], [BLOCK.BIRCH_LOG, [ITEM.CHARCOAL, 1]], [BLOCK.SPRUCE_LOG, [ITEM.CHARCOAL, 1]],
  [BLOCK.JUNGLE_LOG, [ITEM.CHARCOAL, 1]], [BLOCK.ACACIA_LOG, [ITEM.CHARCOAL, 1]], [BLOCK.DARK_OAK_LOG, [ITEM.CHARCOAL, 1]], [BLOCK.CHERRY_LOG, [ITEM.CHARCOAL, 1]],
  [ITEM.RAW_COD, [ITEM.COOKED_COD, 1]], [ITEM.RAW_SALMON, [ITEM.COOKED_SALMON, 1]], [ITEM.POTATO, [ITEM.BAKED_POTATO, 1]],
  [BLOCK.RED_SAND, [BLOCK.GLASS, 1]], [BLOCK.LAPIS_ORE, [ITEM.LAPIS_LAZULI, 1]], [BLOCK.EMERALD_ORE, [ITEM.EMERALD, 1]],
]);
// experience a smelted item gives
export const SMELT_XP = new Map([[ITEM.IRON_INGOT, 0.7], [ITEM.GOLD_INGOT, 1], [ITEM.DIAMOND, 1], [ITEM.EMERALD, 1], [ITEM.NETHERITE_SCRAP, 2]]);

// How long a fuel burns, in seconds (lava leaves its bucket behind).
export function fuelTime(id) {
  if (id === ITEM.COAL || id === ITEM.CHARCOAL) return 80;
  if (id === ITEM.LAVA_BUCKET) return 1000;
  if (id === ITEM.BLAZE_ROD) return 120;
  if (id === ITEM.STICK) return 5;
  const b = id < ITEM_BASE ? BLOCKS[id] : null;
  if (b) {
    if (b.sapling) return 5;
    if (/^(oak|birch|spruce|jungle|acacia|dark_oak|cherry)_(planks|log|slab|stairs|fence|fence_gate|trapdoor|pressure_plate)$/.test(b.key) || ['crafting_table', 'bookshelf', 'chest', 'ladder'].includes(b.key)) return 15;
    return 0;
  }
  const d = itemDef(id);
  if (d && d.material === 'wooden') return 10;
  if (d && (d.kind === 'door' || d.kind === 'sign')) return 10;
  if (id === ITEM.BOW || id === ITEM.CROSSBOW || id === ITEM.FISHING_ROD) return 15;
  if (d && (d.kind === 'boat' || d.kind === 'shield')) return 60;
  return 0;
}
export const PLANKS = P;
