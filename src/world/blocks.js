// Block registry. Pure data so it can be shared by the main thread and workers.

export const CHUNK_SIZE = 16;
// Blocks are stored 384 high (as in Minecraft today). Worlds made before that keep the terrain
// they were generated with (128 high, sea at 50); newer worlds are generated to the full height.
export const WORLD_HEIGHT = 384;
// The highest layer of a chunk's blocks with anything in it (0 when empty): everything above is
// open sky, which the mesher and the chunk transfers leave out.
export function layerTop(blocks) {
  const w = new Uint32Array(blocks.buffer, blocks.byteOffset, blocks.length >> 2);
  for (let y = (blocks.length >> 8) - 1; y > 0; y--) {
    for (let k = y << 6, e = k + 64; k < e; k++) if (w[k]) return y;
  }
  return 0;
}
export const SEA_LEVEL = 50; // the first generator's sea level (see generator2.js for the newer one)

// BOXES: a few axis-aligned boxes inside the cell (farmland, portal frames, the end portal, the
// nether portal's pane, the dragon egg); BED: a bed half, turned to face its other half; MODEL:
// boxes that depend on the block's state and its neighbours (slabs, stairs, doors, fences...).
export const SHAPE = { NONE: 0, CUBE: 1, CROSS: 2, LIQUID: 3, TORCH: 4, CACTUS: 5, BOXES: 6, BED: 7, MODEL: 8, RAIL: 9 };
export const LAYER = { OPAQUE: 0, CUTOUT: 1, TRANSLUCENT: 2 };
export const TINT = { NONE: 0, GRASS: 1, FOLIAGE: 2, BIRCH: 3, SPRUCE: 4, WATER: 5 };
export const WAVE = { NONE: 0, LEAVES: 1, PLANT: 2, LIQUID: 3 };

// Material ids written to the G-buffer; the lighting shader switches on these.
export const MAT = {
  DEFAULT: 0,
  FOLIAGE: 1, // leaves: subsurface scattering, waving
  PLANT: 2, // grass / flowers: subsurface, two sided
  EMISSIVE: 3, // glowstone, torches, lava
  METAL: 4, // metal blocks: albedo tinted specular
  GLOSSY: 5, // polished / wet looking stone, quartz, ice
  WATER: 6,
  ORE: 7, // sparkly ore flecks
  SAND: 8,
  SNOW: 9,
  PORTAL: 10, // nether portal: an animated purple swirl (the G-buffer pass writes it as emissive)
  END_PORTAL: 11, // end portal: a parallax starfield (likewise)
};


// Simplified Chinese block names (the interface language can be switched in Settings).
const ZH_NAMES = {
  stone: '石头', grass: '草方块', dirt: '泥土', cobblestone: '圆石', oak_planks: '橡木木板', oak_log: '橡木原木',
  oak_leaves: '橡树树叶', sand: '沙子', gravel: '沙砾', water: '水', bedrock: '基岩', coal_ore: '煤矿石',
  iron_ore: '铁矿石', gold_ore: '金矿石', diamond_ore: '钻石矿石', glass: '玻璃', bricks: '砖块', stone_bricks: '石砖',
  snow: '雪块', snowy_grass: '雪地草方块', ice: '冰', cactus: '仙人掌', birch_log: '白桦原木', birch_leaves: '白桦树叶',
  spruce_log: '云杉原木', spruce_leaves: '云杉树叶', tall_grass: '草丛', fern: '蕨', poppy: '虞美人', dandelion: '蒲公英',
  cornflower: '矢车菊', dead_bush: '枯萎的灌木', torch: '火把', glowstone: '荧石', sandstone: '砂岩', clay: '黏土块',
  mossy_cobblestone: '苔石', obsidian: '黑曜石', bookshelf: '书架', crafting_table: '工作台', lava: '熔岩',
  smooth_stone: '平滑石头', gold_block: '金块', iron_block: '铁块', diamond_block: '钻石块', quartz_block: '石英块',
  sea_lantern: '海晶灯', birch_planks: '白桦木板', spruce_planks: '云杉木板', terracotta: '陶瓦', pumpkin: '南瓜',
  jack_o_lantern: '南瓜灯',
  white_wool: '白色羊毛', orange_wool: '橙色羊毛', magenta_wool: '品红色羊毛', light_blue_wool: '淡蓝色羊毛',
  yellow_wool: '黄色羊毛', lime_wool: '黄绿色羊毛', pink_wool: '粉红色羊毛', gray_wool: '灰色羊毛', cyan_wool: '青色羊毛',
  purple_wool: '紫色羊毛', blue_wool: '蓝色羊毛', brown_wool: '棕色羊毛', green_wool: '绿色羊毛', red_wool: '红色羊毛',
  black_wool: '黑色羊毛', light_gray_wool: '淡灰色羊毛',
  farmland: '耕地', wheat_0: '小麦', wheat_1: '小麦', wheat_2: '小麦', wheat_3: '小麦',
  netherrack: '下界岩', soul_sand: '灵魂沙', nether_quartz_ore: '下界石英矿石', nether_bricks: '下界砖块',
  magma_block: '岩浆块', ancient_debris: '远古残骸', nether_portal_x: '下界传送门', nether_portal_z: '下界传送门',
  netherite_block: '下界合金块', fire: '火', end_stone: '末地石', end_stone_bricks: '末地石砖',
  end_portal_frame: '末地传送门框架', end_portal_frame_eye: '末地传送门框架', end_portal: '末地传送门', dragon_egg: '龙蛋',
  mossy_stone_bricks: '苔石砖', cracked_stone_bricks: '裂纹石砖',
  chest: '箱子', furnace: '熔炉', lit_furnace: '熔炉', oak_sapling: '橡树树苗', birch_sapling: '白桦树苗', spruce_sapling: '云杉树苗',
  oak_slab: '橡木台阶', birch_slab: '白桦木台阶', spruce_slab: '云杉木台阶', cobblestone_slab: '圆石台阶', stone_slab: '石台阶',
  stone_brick_slab: '石砖台阶', brick_slab: '砖台阶', sandstone_slab: '砂岩台阶', smooth_stone_slab: '平滑石台阶', quartz_slab: '石英台阶',
  oak_stairs: '橡木楼梯', birch_stairs: '白桦木楼梯', spruce_stairs: '云杉木楼梯', cobblestone_stairs: '圆石楼梯', stone_stairs: '石楼梯',
  stone_brick_stairs: '石砖楼梯', brick_stairs: '砖楼梯', sandstone_stairs: '砂岩楼梯', quartz_stairs: '石英楼梯', nether_brick_stairs: '下界砖楼梯',
  oak_door: '橡木门', birch_door: '白桦木门', spruce_door: '云杉木门',
  oak_fence: '橡木栅栏', birch_fence: '白桦木栅栏', spruce_fence: '云杉木栅栏', nether_brick_fence: '下界砖栅栏',
  oak_fence_gate: '橡木栅栏门', birch_fence_gate: '白桦木栅栏门', spruce_fence_gate: '云杉木栅栏门',
  ladder: '梯子', glass_pane: '玻璃板', iron_bars: '铁栏杆', oak_sign: '橡木告示牌', oak_wall_sign: '橡木告示牌', oak_trapdoor: '橡木活板门',
};

// The sixteen dye colours in their usual order, with their Chinese names (beds and wool).
export const DYES = [
  ['white', '白色'], ['orange', '橙色'], ['magenta', '品红色'], ['light_blue', '淡蓝色'], ['yellow', '黄色'], ['lime', '黄绿色'],
  ['pink', '粉红色'], ['gray', '灰色'], ['light_gray', '淡灰色'], ['cyan', '青色'], ['purple', '紫色'], ['blue', '蓝色'],
  ['brown', '棕色'], ['green', '绿色'], ['red', '红色'], ['black', '黑色'],
];

const defs = [];
export const BLOCK = {};

function def(name, props) {
  const id = defs.length;
  const d = {
    id,
    key: name,
    name: props.name || name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    zh: props.zh || ZH_NAMES[name] || '',
    shape: SHAPE.CUBE,
    solid: true,
    opaque: true,
    layer: LAYER.OPAQUE,
    lightOpacity: 15,
    emission: 0,
    tint: TINT.NONE,
    wave: WAVE.NONE,
    mat: MAT.DEFAULT,
    sound: 'stone',
    selectable: true,
    replaceable: false,
    inventory: true,
    cullSelf: false,
    ...props,
  };
  if (props.tex) {
    const t = props.tex;
    d.tex = typeof t === 'string'
      ? { top: t, bottom: t, side: t }
      : { top: t.top || t.side, bottom: t.bottom || t.top || t.side, side: t.side, front: t.front || t.side };
  }
  defs.push(d);
  BLOCK[name.toUpperCase()] = id;
  return id;
}

const transparentCube = { opaque: false, layer: LAYER.CUTOUT, lightOpacity: 0 };
const plant = {
  shape: SHAPE.CROSS, solid: false, opaque: false, layer: LAYER.CUTOUT, lightOpacity: 0,
  wave: WAVE.PLANT, mat: MAT.PLANT, sound: 'grass', replaceable: true,
};

def('air', { shape: SHAPE.NONE, solid: false, opaque: false, lightOpacity: 0, selectable: false, inventory: false, replaceable: true });
def('stone', { tex: 'stone' });
def('grass', { name: 'Grass Block', tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, tint: TINT.GRASS, sound: 'grass' });
def('dirt', { tex: 'dirt', sound: 'gravel' });
def('cobblestone', { tex: 'cobblestone' });
def('oak_planks', { tex: 'oak_planks', sound: 'wood' });
def('oak_log', { tex: { top: 'oak_log_top', side: 'oak_log' }, sound: 'wood' });
def('oak_leaves', { tex: 'oak_leaves', ...transparentCube, lightOpacity: 1, tint: TINT.FOLIAGE, wave: WAVE.LEAVES, mat: MAT.FOLIAGE, sound: 'grass' });
def('sand', { tex: 'sand', sound: 'sand', mat: MAT.SAND });
def('gravel', { tex: 'gravel', sound: 'gravel' });
def('water', {
  tex: 'water', shape: SHAPE.LIQUID, solid: false, opaque: false, layer: LAYER.TRANSLUCENT, lightOpacity: 2,
  wave: WAVE.LIQUID, mat: MAT.WATER, selectable: false, replaceable: true, cullSelf: true, sound: 'water', tint: TINT.WATER,
});
def('bedrock', { tex: 'bedrock', inventory: false });
def('coal_ore', { tex: 'coal_ore', mat: MAT.ORE });
def('iron_ore', { tex: 'iron_ore', mat: MAT.ORE });
def('gold_ore', { tex: 'gold_ore', mat: MAT.ORE });
def('diamond_ore', { tex: 'diamond_ore', mat: MAT.ORE });
def('glass', { tex: 'glass', ...transparentCube, cullSelf: true, mat: MAT.GLOSSY, sound: 'glass' });
def('bricks', { tex: 'bricks' });
def('stone_bricks', { tex: 'stone_bricks' });
def('snow', { name: 'Snow Block', tex: 'snow', sound: 'snow', mat: MAT.SNOW });
def('snowy_grass', { name: 'Snowy Grass', tex: { top: 'snow', bottom: 'dirt', side: 'grass_snow_side' }, sound: 'snow', mat: MAT.SNOW, inventory: false });
def('ice', { tex: 'ice', opaque: false, layer: LAYER.TRANSLUCENT, lightOpacity: 2, cullSelf: true, mat: MAT.GLOSSY, sound: 'glass' });
def('cactus', { tex: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' }, shape: SHAPE.CACTUS, opaque: false, layer: LAYER.CUTOUT, lightOpacity: 0, sound: 'cloth', mat: MAT.PLANT });
def('birch_log', { tex: { top: 'birch_log_top', side: 'birch_log' }, sound: 'wood' });
def('birch_leaves', { tex: 'oak_leaves', ...transparentCube, lightOpacity: 1, tint: TINT.BIRCH, wave: WAVE.LEAVES, mat: MAT.FOLIAGE, sound: 'grass' });
def('spruce_log', { tex: { top: 'spruce_log_top', side: 'spruce_log' }, sound: 'wood' });
def('spruce_leaves', { tex: 'spruce_leaves', ...transparentCube, lightOpacity: 1, tint: TINT.SPRUCE, wave: WAVE.LEAVES, mat: MAT.FOLIAGE, sound: 'grass' });
def('tall_grass', { tex: 'tall_grass', ...plant, tint: TINT.GRASS });
def('fern', { tex: 'fern', ...plant, tint: TINT.GRASS });
def('poppy', { tex: 'poppy', ...plant });
def('dandelion', { tex: 'dandelion', ...plant });
def('cornflower', { tex: 'cornflower', ...plant });
def('dead_bush', { tex: 'dead_bush', ...plant, wave: WAVE.NONE });
def('torch', {
  tex: 'torch', shape: SHAPE.TORCH, solid: false, opaque: false, layer: LAYER.CUTOUT, lightOpacity: 0,
  emission: 14, mat: MAT.EMISSIVE, sound: 'wood',
});
def('glowstone', { tex: 'glowstone', emission: 15, mat: MAT.EMISSIVE, sound: 'glass' });
def('sandstone', { tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone' }, mat: MAT.SAND });
def('clay', { tex: 'clay', sound: 'gravel' });
def('mossy_cobblestone', { tex: 'mossy_cobblestone' });
def('obsidian', { tex: 'obsidian', mat: MAT.GLOSSY });
def('bookshelf', { tex: { top: 'oak_planks', side: 'bookshelf' }, sound: 'wood' });
def('crafting_table', { tex: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side' }, sound: 'wood' });
def('lava', {
  tex: 'lava', shape: SHAPE.LIQUID, solid: false, opaque: false, layer: LAYER.OPAQUE, lightOpacity: 15,
  emission: 15, mat: MAT.EMISSIVE, selectable: false, replaceable: true, cullSelf: true, wave: WAVE.NONE, sound: 'water',
});
def('smooth_stone', { tex: 'smooth_stone', mat: MAT.GLOSSY });
def('gold_block', { tex: 'gold_block', mat: MAT.METAL, sound: 'metal' });
def('iron_block', { tex: 'iron_block', mat: MAT.METAL, sound: 'metal' });
def('diamond_block', { tex: 'diamond_block', mat: MAT.GLOSSY, sound: 'metal' });
def('quartz_block', { tex: 'quartz', mat: MAT.GLOSSY });
def('sea_lantern', { tex: 'sea_lantern', emission: 15, mat: MAT.EMISSIVE, sound: 'glass' });
def('birch_planks', { tex: 'birch_planks', sound: 'wood' });
def('spruce_planks', { tex: 'spruce_planks', sound: 'wood' });
def('terracotta', { tex: 'terracotta' });
def('pumpkin', { tex: { top: 'pumpkin_top', side: 'pumpkin_side' }, sound: 'wood' });
def('jack_o_lantern', { name: "Jack o'Lantern", tex: { top: 'pumpkin_top', side: 'jack_o_lantern' }, emission: 15, mat: MAT.EMISSIVE, sound: 'wood' });

export const WOOL_COLORS = [
  ['white', '#e9ecec'], ['orange', '#f07613'], ['magenta', '#bd44b3'], ['light_blue', '#3aafd9'],
  ['yellow', '#f8c527'], ['lime', '#70b919'], ['pink', '#ed8dac'], ['gray', '#3e4447'],
  ['cyan', '#158991'], ['purple', '#792aac'], ['blue', '#35399d'], ['brown', '#724728'],
  ['green', '#546d1b'], ['red', '#a12722'], ['black', '#141519'],
  // appended later, so the ids of the wools before it stay the same in old saves
  ['light_gray', '#8e8e86'],
];
for (const [c] of WOOL_COLORS) def(c + '_wool', { tex: c + '_wool', sound: 'cloth' });

// ---- added with beds, farming, the Nether and the End (appended: block ids are saved) ----
const box = (x0, y0, z0, x1, y1, z1, tex = null, faces = 63) => ({ b: [x0, y0, z0, x1, y1, z1], tex, faces });
// beds: a foot and a head block per colour; each half finds the other among its neighbours
for (const [c] of DYES) {
  for (const part of ['foot', 'head']) {
    def(c + '_bed_' + part, {
      name: c.replace(/_/g, ' ').replace(/\b\w/g, (k) => k.toUpperCase()) + ' Bed',
      zh: DYES.find((d) => d[0] === c)[1] + '床',
      tex: c + '_wool', shape: SHAPE.BED, opaque: false, lightOpacity: 0, sound: 'cloth', inventory: false,
      bed: { color: c, head: part === 'head' }, collideH: 9 / 16,
    });
  }
}
def('farmland', {
  tex: { top: 'farmland', side: 'dirt', bottom: 'dirt' }, shape: SHAPE.BOXES, boxes: [box(0, 0, 0, 16, 15, 16)],
  sound: 'gravel', inventory: false,
});
for (let i = 0; i < 4; i++) def('wheat_' + i, { name: 'Wheat', tex: 'wheat_stage_' + i, ...plant, replaceable: false, inventory: false, crop: i });
def('netherrack', { tex: 'netherrack' });
def('soul_sand', { tex: 'soul_sand', sound: 'sand', mat: MAT.SAND });
def('nether_quartz_ore', { tex: 'nether_quartz_ore', mat: MAT.ORE });
def('nether_bricks', { tex: 'nether_bricks' });
def('magma_block', { tex: 'magma', emission: 3, mat: MAT.EMISSIVE });
def('ancient_debris', { tex: { top: 'ancient_debris_top', side: 'ancient_debris_side' }, mat: MAT.ORE });
const portal = {
  name: 'Nether Portal', tex: 'nether_portal', shape: SHAPE.BOXES, solid: false, opaque: false, lightOpacity: 0,
  emission: 11, mat: MAT.PORTAL, selectable: false, inventory: false, cullSelf: true, sound: 'glass',
};
def('nether_portal_x', { ...portal, boxes: [box(0, 0, 6, 16, 16, 10)] }); // spans the X axis
def('nether_portal_z', { ...portal, boxes: [box(6, 0, 0, 10, 16, 16)] }); // spans the Z axis
def('netherite_block', { tex: 'netherite_block', mat: MAT.METAL, sound: 'metal' });
def('fire', {
  tex: 'fire', shape: SHAPE.CROSS, solid: false, opaque: false, layer: LAYER.CUTOUT, lightOpacity: 0, emission: 15,
  mat: MAT.EMISSIVE, selectable: false, replaceable: true, inventory: false, sound: 'wood',
});
def('end_stone', { tex: 'end_stone', mat: MAT.SAND });
def('end_stone_bricks', { tex: 'end_stone_bricks' });
const frame = { top: 'end_portal_frame_top', side: 'end_portal_frame_side', bottom: 'end_stone' };
def('end_portal_frame', { name: 'End Portal Frame', tex: frame, shape: SHAPE.BOXES, boxes: [box(0, 0, 0, 16, 13, 16)], mat: MAT.GLOSSY });
def('end_portal_frame_eye', {
  name: 'End Portal Frame', tex: frame, shape: SHAPE.BOXES, mat: MAT.GLOSSY, inventory: false, emission: 1,
  boxes: [box(0, 0, 0, 16, 13, 16), box(4, 13, 4, 12, 16, 12, 'end_portal_eye')],
});
def('end_portal', {
  tex: 'end_portal', shape: SHAPE.BOXES, boxes: [box(0, 0, 0, 16, 12, 16, null, 1 << 2)], solid: false, opaque: false,
  lightOpacity: 0, emission: 15, mat: MAT.END_PORTAL, selectable: false, inventory: false, cullSelf: true, sound: 'glass',
});
def('dragon_egg', {
  tex: 'dragon_egg', shape: SHAPE.BOXES, opaque: false, lightOpacity: 0, mat: MAT.GLOSSY, emission: 1,
  boxes: [box(4, 0, 4, 12, 1, 12), box(2, 1, 2, 14, 3, 14), box(1, 3, 1, 15, 9, 15), box(2, 9, 2, 14, 12, 14), box(3, 12, 3, 13, 14, 13), box(5, 14, 5, 11, 15, 11), box(6, 15, 6, 10, 16, 10)],
});
def('mossy_stone_bricks', { tex: 'mossy_stone_bricks' });
def('cracked_stone_bricks', { tex: 'cracked_stone_bricks' });

// ---- added with chests, furnaces and building blocks (appended: block ids are saved) ----
// These keep a state byte beside their id (see world.js): which way they face, whether they are
// open, the upper half of a door... `model` names the box builder in blockBoxes() below.
const woodFx = { sound: 'wood' };
def('chest', {
  tex: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', front: 'chest_front' }, shape: SHAPE.MODEL, model: 'chest',
  opaque: false, lightOpacity: 0, container: 'chest', facing: true, ...woodFx,
});
const furnaceTex = { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' };
def('furnace', { tex: furnaceTex, container: 'furnace', facing: true });
def('lit_furnace', { name: 'Furnace', tex: { ...furnaceTex, front: 'furnace_front_on' }, container: 'furnace', facing: true, emission: 13, inventory: false });
for (const w of ['oak', 'birch', 'spruce']) def(w + '_sapling', { tex: w + '_sapling', ...plant, replaceable: false, sapling: w });
// slabs: the bottom or top half of a block (state 1 = top); a second slab of the same kind makes
// the full block
const texOf = (key) => defs.find((d) => d.key === key).tex;
const SLAB_KINDS = [
  ['oak', 'oak_planks'], ['birch', 'birch_planks'], ['spruce', 'spruce_planks'], ['cobblestone', 'cobblestone'], ['stone', 'stone'],
  ['stone_brick', 'stone_bricks'], ['brick', 'bricks'], ['sandstone', 'sandstone'], ['smooth_stone', 'smooth_stone'], ['quartz', 'quartz_block'],
];
const partial = { shape: SHAPE.MODEL, opaque: false, lightOpacity: 15, neighbourLight: true };
for (const [k, base] of SLAB_KINDS) {
  const b = defs.find((d) => d.key === base);
  def(k + '_slab', { tex: texOf(base), ...partial, model: 'slab', full: b.id, sound: b.sound, mat: b.mat });
}
// stairs (straight): state bits 0-1 = the way up (0 north, 1 east, 2 south, 3 west), bit 2 = upside down
const STAIR_KINDS = [
  ['oak', 'oak_planks'], ['birch', 'birch_planks'], ['spruce', 'spruce_planks'], ['cobblestone', 'cobblestone'], ['stone', 'stone'],
  ['stone_brick', 'stone_bricks'], ['brick', 'bricks'], ['sandstone', 'sandstone'], ['quartz', 'quartz_block'], ['nether_brick', 'nether_bricks'],
];
for (const [k, base] of STAIR_KINDS) {
  const b = defs.find((d) => d.key === base);
  def(k + '_stairs', { tex: texOf(base), ...partial, model: 'stairs', base: b.id, facing: true, sound: b.sound, mat: b.mat });
}
// doors: two blocks tall, each half with the full state: bits 0-1 facing, 2 open, 3 upper half, 4 hinge on the right
const thin = { shape: SHAPE.MODEL, opaque: false, lightOpacity: 0, layer: LAYER.CUTOUT };
for (const w of ['oak', 'birch', 'spruce']) {
  def(w + '_door', { tex: { top: w + '_door_top', bottom: w + '_door_bottom', side: w + '_door_bottom' }, ...thin, model: 'door', facing: true, inventory: false, ...woodFx });
}
// fences join up with their own kind, fence gates and solid blocks; they are 1.5 blocks tall to jump over
for (const [k, base] of [['oak', 'oak_planks'], ['birch', 'birch_planks'], ['spruce', 'spruce_planks'], ['nether_brick', 'nether_bricks']]) {
  def(k + '_fence', { tex: texOf(base), ...thin, layer: LAYER.OPAQUE, model: 'fence', family: k === 'nether_brick' ? 2 : 1, sound: k === 'nether_brick' ? 'stone' : 'wood' });
}
for (const w of ['oak', 'birch', 'spruce']) def(w + '_fence_gate', { tex: texOf(w + '_planks'), ...thin, layer: LAYER.OPAQUE, model: 'gate', facing: true, ...woodFx });
def('ladder', { tex: 'ladder', ...thin, model: 'ladder', facing: true, climbable: true, ...woodFx });
def('glass_pane', { tex: 'glass', ...thin, model: 'pane', mat: MAT.GLOSSY, sound: 'glass', cullSelf: true });
def('iron_bars', { tex: 'iron_bars', ...thin, model: 'pane', mat: MAT.METAL, sound: 'metal' });
// signs: a board on a post (state = facing) or on a wall (state = the wall's side); the text is a
// block entity, drawn by the entity renderer
def('oak_sign', { tex: 'oak_sign', ...thin, layer: LAYER.OPAQUE, solid: false, model: 'sign', facing: true, inventory: false, sign: true, ...woodFx });
def('oak_wall_sign', { tex: 'oak_sign', ...thin, layer: LAYER.OPAQUE, solid: false, model: 'wall_sign', facing: true, inventory: false, sign: true, ...woodFx });
// trapdoors: state bits 0-1 facing, 2 open, 3 in the top half of the cell
def('oak_trapdoor', { tex: 'oak_trapdoor', ...thin, model: 'trapdoor', facing: true, ...woodFx });

// ---- added with the 384-high world (appended: block ids are saved): four more woods, badlands
// terracotta, jungle and swamp plants, carrots, potatoes and nether wart, rails, pressure plates,
// and the blocks of villages, temples, mines, dungeons, ocean monuments and end cities
export const WOODS2 = [['jungle', '丛林'], ['acacia', '金合欢'], ['dark_oak', '深色橡木'], ['cherry', '樱花']];
for (const [w, zh] of WOODS2) {
  def(w + '_log', { zh: zh + '原木', tex: { top: w + '_log_top', side: w + '_log' }, sound: 'wood' });
  def(w + '_planks', { zh: zh + '木板', tex: w + '_planks', sound: 'wood' });
  def(w + '_leaves', {
    zh: zh + '树叶', tex: w + '_leaves', ...transparentCube, lightOpacity: 1, tint: w === 'cherry' ? TINT.NONE : TINT.FOLIAGE,
    wave: WAVE.LEAVES, mat: MAT.FOLIAGE, sound: 'grass',
  });
  def(w + '_sapling', { zh: zh + '树苗', tex: w + '_sapling', ...plant, replaceable: false, sapling: w });
}
def('red_sand', { zh: '红沙', tex: 'red_sand', sound: 'sand', mat: MAT.SAND });
export const TERRACOTTA_COLORS = [['white', '白色'], ['orange', '橙色'], ['yellow', '黄色'], ['brown', '棕色'], ['red', '红色'], ['light_gray', '淡灰色']];
for (const [c, zh] of TERRACOTTA_COLORS) def(c + '_terracotta', { zh: zh + '陶瓦', tex: c + '_terracotta' });
// vines hang on the side of a block (state = the side they cling to) and can be climbed
def('vine', {
  zh: '藤蔓', tex: 'vine', shape: SHAPE.MODEL, model: 'vine', solid: false, opaque: false, layer: LAYER.CUTOUT, lightOpacity: 0,
  tint: TINT.FOLIAGE, wave: WAVE.LEAVES, mat: MAT.FOLIAGE, replaceable: true, climbable: true, facing: true, sound: 'grass',
});
def('lily_pad', {
  zh: '睡莲', tex: 'lily_pad', shape: SHAPE.BOXES, boxes: [box(0, 0, 0, 16, 1, 16, null, 1 << 2)], opaque: false, layer: LAYER.CUTOUT,
  lightOpacity: 0, tint: TINT.FOLIAGE, mat: MAT.PLANT, collideH: 1 / 16, sound: 'grass',
});
def('sugar_cane', { zh: '甘蔗', tex: 'sugar_cane', ...plant, wave: WAVE.NONE, replaceable: false });
def('melon', { zh: '西瓜', tex: { top: 'melon_top', side: 'melon_side' }, sound: 'wood' });
def('pink_petals', {
  zh: '粉红色花簇', tex: 'pink_petals', shape: SHAPE.BOXES, boxes: [box(0, 0, 0, 16, 1, 16, null, 1 << 2)], solid: false, opaque: false,
  layer: LAYER.CUTOUT, lightOpacity: 0, mat: MAT.PLANT, replaceable: true, sound: 'grass',
});
for (let i = 0; i < 4; i++) def('carrots_' + i, { name: 'Carrots', zh: '胡萝卜', tex: 'carrots_stage_' + i, ...plant, replaceable: false, inventory: false, crop: i });
for (let i = 0; i < 4; i++) def('potatoes_' + i, { name: 'Potatoes', zh: '马铃薯', tex: 'potatoes_stage_' + i, ...plant, replaceable: false, inventory: false, crop: i });
for (let i = 0; i < 3; i++) def('nether_wart_' + i, { name: 'Nether Wart', zh: '下界疣', tex: 'nether_wart_stage_' + i, ...plant, wave: WAVE.NONE, replaceable: false, inventory: false, crop: i });
// villages
def('dirt_path', {
  zh: '土径', tex: { top: 'dirt_path_top', side: 'dirt_path_side', bottom: 'dirt' }, shape: SHAPE.BOXES, boxes: [box(0, 0, 0, 16, 15, 16)],
  sound: 'gravel', opaque: false, lightOpacity: 15, neighbourLight: true,
});
def('hay_bale', { zh: '干草块', tex: { top: 'hay_top', side: 'hay_side' }, sound: 'grass' });
def('lantern', {
  zh: '灯笼', tex: 'lantern', shape: SHAPE.BOXES, boxes: [box(5, 0, 5, 11, 7, 11), box(6, 7, 6, 10, 9, 10)], opaque: false, lightOpacity: 0,
  layer: LAYER.CUTOUT, emission: 15, mat: MAT.EMISSIVE, sound: 'metal',
});
// rails: the state is their shape (see RAIL_SHAPES); powered rails speed carts up
def('rail', { zh: '铁轨', tex: { top: 'rail', side: 'rail', front: 'rail_corner' }, shape: SHAPE.RAIL, solid: false, opaque: false, layer: LAYER.CUTOUT, lightOpacity: 0, sound: 'metal', rail: 1 });
def('powered_rail', { zh: '动力铁轨', tex: { top: 'powered_rail', side: 'powered_rail' }, shape: SHAPE.RAIL, solid: false, opaque: false, layer: LAYER.CUTOUT, lightOpacity: 0, sound: 'metal', rail: 2, emission: 3 });
// pressure plates open the doors next to them while something stands on them (state 1 = pressed)
def('oak_pressure_plate', { zh: '橡木压力板', tex: 'oak_planks', ...thin, layer: LAYER.OPAQUE, solid: false, model: 'plate', plate: 'wood', ...woodFx });
def('stone_pressure_plate', { zh: '石质压力板', tex: 'stone', ...thin, layer: LAYER.OPAQUE, solid: false, model: 'plate', plate: 'stone' });
def('iron_door', { zh: '铁门', tex: { top: 'iron_door_top', bottom: 'iron_door_bottom', side: 'iron_door_bottom' }, ...thin, model: 'door', facing: true, inventory: false, mat: MAT.METAL, sound: 'metal', ironDoor: true });
def('tnt', { zh: 'TNT', name: 'TNT', tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' }, sound: 'grass' });
def('cobweb', { zh: '蜘蛛网', tex: 'cobweb', ...plant, wave: WAVE.NONE, tint: TINT.NONE, replaceable: false, sticky: true, sound: 'cloth' });
def('spawner', { zh: '刷怪笼', name: 'Monster Spawner', tex: 'spawner', ...transparentCube, mat: MAT.METAL, container: 'spawner', inventory: false, sound: 'metal' });
def('prismarine', { zh: '海晶石', tex: 'prismarine', mat: MAT.GLOSSY });
def('prismarine_bricks', { zh: '海晶石砖', tex: 'prismarine_bricks', mat: MAT.GLOSSY });
def('dark_prismarine', { zh: '暗海晶石', tex: 'dark_prismarine', mat: MAT.GLOSSY });
def('purpur_block', { zh: '紫珀块', tex: 'purpur_block' });
def('purpur_pillar', { zh: '紫珀柱', tex: { top: 'purpur_pillar_top', side: 'purpur_pillar' } });
def('end_rod', {
  zh: '末地烛', tex: 'end_rod', shape: SHAPE.BOXES, boxes: [box(6, 0, 6, 10, 1, 10), box(7, 1, 7, 9, 16, 9)], opaque: false, lightOpacity: 0,
  emission: 14, mat: MAT.EMISSIVE, sound: 'glass',
});
def('enchanting_table', {
  zh: '附魔台', tex: { top: 'enchanting_table_top', side: 'enchanting_table_side', bottom: 'obsidian' }, shape: SHAPE.BOXES,
  boxes: [box(0, 0, 0, 16, 12, 16)], opaque: false, lightOpacity: 0, emission: 7, container: 'enchant', mat: MAT.GLOSSY,
});
def('brewing_stand', {
  zh: '酿造台', tex: { top: 'brewing_stand', side: 'brewing_stand', bottom: 'brewing_stand_base' }, shape: SHAPE.BOXES,
  boxes: [box(7, 0, 7, 9, 14, 9), box(2, 0, 2, 14, 2, 14, 'brewing_stand_base')], opaque: false, lightOpacity: 0, layer: LAYER.CUTOUT,
  emission: 1, container: 'brewing', mat: MAT.METAL, sound: 'metal',
});
def('lapis_ore', { zh: '青金石矿石', tex: 'lapis_ore', mat: MAT.ORE });
def('lapis_block', { zh: '青金石块', tex: 'lapis_block', mat: MAT.GLOSSY });
def('emerald_ore', { zh: '绿宝石矿石', tex: 'emerald_ore', mat: MAT.ORE });
def('wither_skeleton_skull', {
  zh: '凋灵骷髅头颅', tex: { top: 'wither_skull_top', side: 'wither_skull', front: 'wither_skull_face' }, shape: SHAPE.BOXES, boxes: [box(4, 0, 4, 12, 8, 12)],
  opaque: false, lightOpacity: 0, sound: 'stone',
});
// the End's gateways: step in to be thrown to the outer islands (or back)
def('end_gateway', {
  zh: '末地折跃门', tex: 'end_portal', shape: SHAPE.BOXES, boxes: [box(0, 0, 0, 16, 16, 16)], solid: false, opaque: false, lightOpacity: 0,
  emission: 15, mat: MAT.END_PORTAL, inventory: false, cullSelf: true, sound: 'glass',
});

// the Moon and Mars (dimensions 4 and 5): their dust and their rock
def('moon_regolith', { zh: '月壤', tex: 'moon_regolith', sound: 'sand', mat: MAT.SAND });
def('moon_rock', { zh: '月岩', tex: 'moon_rock' });
def('moon_basalt', { zh: '月海玄武岩', tex: 'moon_basalt' });
def('mars_sand', { zh: '火星沙', tex: 'mars_sand', sound: 'sand', mat: MAT.SAND });
def('mars_rock', { zh: '火星岩', tex: 'mars_rock' });

// bed halves by colour: { color: [footId, headId] }
export const BED_BLOCKS = {};
for (const [c] of DYES) BED_BLOCKS[c] = [BLOCK[(c + '_bed_foot').toUpperCase()], BLOCK[(c + '_bed_head').toUpperCase()]];

export const BLOCKS = defs;
export const BLOCK_COUNT = defs.length;

// Flat lookup tables (fast access in hot loops).
export const IS_OPAQUE = new Uint8Array(256);
export const IS_SOLID = new Uint8Array(256);
export const LIGHT_OPACITY = new Uint8Array(256);
export const EMISSION = new Uint8Array(256);
export const SHAPE_OF = new Uint8Array(256);
export const LAYER_OF = new Uint8Array(256);
export const CULL_SELF = new Uint8Array(256);
export const IS_LIQUID = new Uint8Array(256);
// collision height of solid blocks (beds are lower than a full block)
export const COLLIDE_H = new Float32Array(256).fill(1);
// what the crosshair can hit: [x0, y0, z0, x1, y1, z1] inside the cell, or null for the whole cell
export const SELECT_BOX = new Array(256).fill(null);
export const IS_BED = new Uint8Array(256);
// the other half of a bed: head id for a foot, foot id for a head
export const BED_PARTNER = new Uint8Array(256);
// state-shaped blocks (see blockBoxes): which box builder, and a few families
export const MODEL_OF = new Uint8Array(256);
export const MODELS_BY_NAME = { chest: 1, slab: 2, stairs: 3, door: 4, fence: 5, gate: 6, ladder: 7, pane: 8, sign: 9, wall_sign: 10, trapdoor: 11, vine: 12, plate: 13 };
export const HAS_FRONT = new Uint8Array(256); // cubes with a front face that follows the state (furnaces)
export const FENCE_FAMILY = new Uint8Array(256);
export const IS_CLIMBABLE = new Uint8Array(256);
// light for the cell itself taken from its neighbours (slabs and stairs block light but still show it)
export const NEIGHBOUR_LIGHT = new Uint8Array(256);
for (const d of defs) {
  IS_OPAQUE[d.id] = d.opaque ? 1 : 0;
  IS_SOLID[d.id] = d.solid ? 1 : 0;
  LIGHT_OPACITY[d.id] = d.lightOpacity;
  EMISSION[d.id] = d.emission;
  SHAPE_OF[d.id] = d.shape;
  LAYER_OF[d.id] = d.layer;
  CULL_SELF[d.id] = d.cullSelf ? 1 : 0;
  IS_LIQUID[d.id] = d.shape === SHAPE.LIQUID ? 1 : 0;
  if (d.collideH) COLLIDE_H[d.id] = d.collideH;
  if (d.shape === SHAPE.CROSS) SELECT_BOX[d.id] = [0.15, 0, 0.15, 0.85, 0.85, 0.85];
  else if (d.shape === SHAPE.TORCH) SELECT_BOX[d.id] = [0.375, 0, 0.375, 0.625, 0.65, 0.625];
  else if (d.shape === SHAPE.BED) SELECT_BOX[d.id] = [0, 0, 0, 1, 9 / 16, 1];
  else if (d.shape === SHAPE.RAIL) SELECT_BOX[d.id] = [0, 0, 0, 1, 2 / 16, 1];
  else if (d.shape === SHAPE.BOXES) {
    const bb = [16, 16, 16, 0, 0, 0];
    for (const { b } of d.boxes) for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], b[k]); bb[k + 3] = Math.max(bb[k + 3], b[k + 3]); }
    SELECT_BOX[d.id] = bb.map((v) => v / 16);
  }
  if (d.bed) {
    IS_BED[d.id] = 1;
    const [foot, head] = BED_BLOCKS[d.bed.color];
    BED_PARTNER[d.id] = d.bed.head ? foot : head;
  }
  if (d.model) MODEL_OF[d.id] = MODELS_BY_NAME[d.model];
  if (d.facing && d.shape === SHAPE.CUBE) HAS_FRONT[d.id] = 1;
  if (d.family) FENCE_FAMILY[d.id] = d.family;
  if (d.climbable) IS_CLIMBABLE[d.id] = 1;
  if (d.neighbourLight) NEIGHBOUR_LIGHT[d.id] = 1;
}

// ---------------------------------------------------------------- block states
// Horizontal directions used by facing states: 0 north (-Z), 1 east (+X), 2 south (+Z), 3 west (-X).
export const FACING = [[0, -1], [1, 0], [0, 1], [-1, 0]];
// the mesher's face index (0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z) looking out in each facing
export const FACING_FACE = [5, 0, 4, 1];
// A direction from a horizontal vector (the way something looks).
export function facingOf(dx, dz) {
  return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : dz > 0 ? 2 : 0;
}
export const opposite = (f) => (f + 2) & 3;

// Liquids keep their level in the state: 0 a source, 1-7 flowing further from it, +8 falling.
export const LIQUID_FALLING = 8;
// Surface height of a liquid cell in 1/16 block units.
export function liquidHeight(state, liquidAbove) {
  if (liquidAbove || state & LIQUID_FALLING) return 16;
  const level = state & 7;
  return level === 0 ? 14 : Math.max(2, Math.round(((8 - level) / 9) * 16));
}

// ---------------------------------------------------------------- state-shaped blocks
// The boxes of a MODEL block, in 1/16 block units inside its cell: [{ b: [x0,y0,z0,x1,y1,z1],
// tex: optional [6 texture layers by face], faces: bit mask }]. `nb(dx, dy, dz)` and `ns(...)`
// give a neighbour's id and state (fences and panes join up with the blocks around them).
// purpose: 'render' (what is drawn), 'collide' (what stops creatures: fences are 1.5 tall, open
// gates let them through) or 'select' (what the crosshair outlines).
const ALL = 63;
const rotBox = (bb, f) => {
  // canonical boxes are built facing north (-Z); turn them to face f
  const [x0, y0, z0, x1, y1, z1] = bb;
  if (f === 1) return [16 - z1, y0, x0, 16 - z0, y1, x1];
  if (f === 2) return [16 - x1, y0, 16 - z1, 16 - x0, y1, 16 - z0];
  if (f === 3) return [z0, y0, 16 - x1, z1, y1, 16 - x0];
  return [x0, y0, z0, x1, y1, z1];
};
// a thin panel against the cell's side f (0 north .. 3 west), `t` pixels thick
const sidePanel = (f, t, y0 = 0, y1 = 16) => rotBox([0, y0, 0, 16, y1, t], f);
const isFullSolid = (id) => IS_OPAQUE[id] === 1 && SHAPE_OF[id] === SHAPE.CUBE;

export function blockBoxes(id, state, nb, ns, purpose = 'render') {
  const m = MODEL_OF[id];
  const out = [];
  const add = (b, tex = null, faces = ALL) => out.push({ b, tex, faces });
  switch (m) {
    case 1: { // chest: a box a pixel in from the sides, its front the way it faces
      const f = state & 3;
      const tex = [0, 0, 0, 0, 0, 0].map((_, k) => FACE_TEX[id * 4 + (k === 2 || k === 3 ? (k === 2 ? 0 : 1) : k === FACING_FACE[f] ? 3 : 2)]);
      add([1, 0, 1, 15, 14, 15], tex);
      break;
    }
    case 2: // slab
      add(state & 1 ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16]);
      break;
    case 3: { // straight stairs: a half slab and a half-width step on the side they go up to
      const f = state & 3, down = state & 4;
      add(down ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16]);
      add(rotBox(down ? [0, 0, 0, 16, 8, 8] : [0, 8, 0, 16, 16, 8], f));
      break;
    }
    case 4: { // door: a 3 pixel panel; closed on the side nearest whoever put it there, open against the hinge side
      const f = state & 3, open = state & 4, upper = state & 8, right = state & 16;
      const side = open ? (right ? (f + 1) & 3 : (f + 3) & 3) : opposite(f);
      const layer = FACE_TEX[id * 4 + (upper ? 0 : 1)];
      add(sidePanel(side, 3), [layer, layer, layer, layer, layer, layer]);
      break;
    }
    case 5: { // fence: a post, and two rails towards each neighbour it joins
      const tall = purpose === 'collide';
      add([6, 0, 6, 10, tall ? 24 : 16, 10]);
      for (let f = 0; f < 4; f++) {
        const [dx, dz] = FACING[f];
        const n = nb(dx, 0, dz);
        const joins = (FENCE_FAMILY[n] && FENCE_FAMILY[n] === FENCE_FAMILY[id]) || isFullSolid(n) ||
          (MODEL_OF[n] === 6 && FENCE_FAMILY[id] === 1 && ((ns(dx, 0, dz) & 1) !== (f & 1)));
        if (!joins) continue;
        if (tall) add(rotBox([6, 0, 0, 10, 24, 6], f));
        else if (purpose === 'render') { add(rotBox([7, 12, 0, 9, 15, 6], f)); add(rotBox([7, 6, 0, 9, 9, 6], f)); }
        else add(rotBox([6, 6, 0, 10, 15, 6], f));
      }
      break;
    }
    case 6: { // fence gate: spans across the way it faces; open, it lets things through
      const f = state & 3, open = state & 4;
      if (purpose === 'collide') { if (!open) add(rotBox([0, 0, 6, 16, 24, 10], f)); break; }
      if (purpose === 'select') { add(rotBox([0, 5, 6, 16, 16, 10], f)); break; }
      add(rotBox([0, 5, 7, 2, 16, 9], f));
      add(rotBox([14, 5, 7, 16, 16, 9], f));
      if (!open) {
        add(rotBox([2, 6, 7, 14, 9, 9], f));
        add(rotBox([2, 12, 7, 14, 15, 9], f));
        add(rotBox([6, 9, 7, 10, 12, 9], f));
      } else {
        // the two leaves swung back towards the way it faces (towards -Z before turning)
        add(rotBox([0, 6, 1, 2, 9, 7], f)); add(rotBox([0, 12, 1, 2, 15, 7], f));
        add(rotBox([14, 6, 1, 16, 9, 7], f)); add(rotBox([14, 12, 1, 16, 15, 7], f));
      }
      break;
    }
    case 7: // ladder: against the wall on its facing side
      add(sidePanel(state & 3, purpose === 'collide' ? 3 : 1));
      break;
    case 8: { // glass pane and iron bars: a thin post, and a pane towards each neighbour it joins
      add([7, 0, 7, 9, 16, 9]);
      for (let f = 0; f < 4; f++) {
        const [dx, dz] = FACING[f];
        const n = nb(dx, 0, dz);
        if (MODEL_OF[n] === 8 || isFullSolid(n) || n === BLOCK.GLASS) add(rotBox([7, 0, 0, 9, 16, 7], f));
      }
      break;
    }
    case 9: // standing sign: a board on a post, turned to its facing
      if (purpose === 'collide') break;
      add(rotBox([7, 0, 7, 9, 8, 9], state & 3));
      add(rotBox([0, 8, 7, 16, 16, 9], state & 3));
      break;
    case 10: // wall sign: a board on the wall behind it
      if (purpose === 'collide') break;
      add(rotBox([0, 4, 0, 16, 12, 2], state & 3));
      break;
    case 11: { // trapdoor: a lid along the floor or ceiling of the cell; open, up against its hinge side
      const f = state & 3, open = state & 4, top = state & 8;
      add(open ? sidePanel(opposite(f), 3) : top ? [0, 13, 0, 16, 16, 16] : [0, 0, 0, 16, 3, 16]);
      break;
    }
    case 12: // vine: a sheet against the side it clings to
      add(sidePanel(state & 3, 1));
      break;
    case 13: // pressure plate, pressed down while something stands on it
      add(state & 1 ? [1, 0, 1, 15, 1, 15] : [1, 0, 1, 15, 2, 15]);
      break;
    default:
      add([0, 0, 0, 16, 16, 16]);
  }
  return out;
}

// Where the crosshair outlines a MODEL block: the bounds of its boxes, in block units.
export function modelSelectBox(id, state, nb, ns) {
  const boxes = blockBoxes(id, state, nb, ns, 'select');
  if (!boxes.length) return null;
  const bb = [16, 16, 16, 0, 0, 0];
  for (const { b } of boxes) for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], b[k]); bb[k + 3] = Math.max(bb[k + 3], b[k + 3]); }
  return bb.map((v) => v / 16);
}

// Rails: the state is the shape. 0 north-south, 1 east-west, 2-5 sloping up to the east, west,
// north and south, 6-9 curves joining south-east, south-west, north-west and north-east.
// For each: the two directions it joins (as FACING indices) and whether it slopes.
export const RAIL_SHAPES = [
  { ends: [0, 2] }, { ends: [1, 3] },
  { ends: [3, 1], up: 1 }, { ends: [1, 3], up: 3 }, { ends: [2, 0], up: 0 }, { ends: [0, 2], up: 2 },
  { ends: [2, 1] }, { ends: [2, 3] }, { ends: [0, 3] }, { ends: [0, 1] },
];
export const IS_RAIL = new Uint8Array(256);
for (const d of defs) if (d.rail) IS_RAIL[d.id] = d.rail;
// the rail shape joining two directions (level), or -1
export function railShapeFor(a, b) {
  for (let i = 0; i < RAIL_SHAPES.length; i++) {
    const r = RAIL_SHAPES[i];
    if (r.up !== undefined) continue;
    if ((r.ends[0] === a && r.ends[1] === b) || (r.ends[0] === b && r.ends[1] === a)) return i;
  }
  return -1;
}

// Collision: 0 nothing, 1 the whole cell, 2 the boxes of blockBoxes(.., 'collide') (or the
// COLLIDE_H height for beds and other low blocks).
export const COLLIDE_KIND = new Uint8Array(256);
for (const d of defs) {
  if (!d.solid) COLLIDE_KIND[d.id] = 0;
  else if (d.shape === SHAPE.MODEL) COLLIDE_KIND[d.id] = 2;
  else if (d.collideH && d.collideH < 1) COLLIDE_KIND[d.id] = 2;
  else if (d.shape === SHAPE.BOXES && d.boxes.every((bx) => bx.b[4] < 16)) COLLIDE_KIND[d.id] = 2;
  else COLLIDE_KIND[d.id] = 1;
}
// fences and closed gates reach half a block into the cell above
export const TALL_COLLIDE = new Uint8Array(256);
for (const d of defs) if (d.model === 'fence' || d.model === 'gate') TALL_COLLIDE[d.id] = 1;

// Collision boxes of a block in block units (inside its cell; fences reach above it).
export function collisionBoxes(id, state, nb, ns) {
  const d = defs[id];
  if (!d) return [];
  if (d.shape === SHAPE.MODEL) return blockBoxes(id, state, nb, ns, 'collide').map(({ b }) => b.map((v) => v / 16));
  if (d.collideH && d.collideH < 1) return [[0, 0, 0, 1, d.collideH, 1]];
  if (d.shape === SHAPE.BOXES) {
    let top = 0;
    for (const bx of d.boxes) top = Math.max(top, bx.b[4]);
    return [[0, 0, 0, 1, top / 16, 1]];
  }
  return [[0, 0, 0, 1, 1, 1]];
}

// Every texture name referenced by blocks, in a stable order. Index = texture array layer.
export function collectTextureNames() {
  const names = [];
  const seen = new Set();
  const add = (n) => {
    if (n && !seen.has(n)) { seen.add(n); names.push(n); }
  };
  for (const d of defs) {
    if (!d.tex) continue;
    add(d.tex.top); add(d.tex.side); add(d.tex.bottom); add(d.tex.front);
  }
  for (const d of defs) for (const bx of d.boxes || []) if (bx.tex) add(bx.tex);
  return names;
}

// Per block: [top, bottom, side, front] texture layer indices.
export function buildFaceTextureTable(names) {
  const index = new Map(names.map((n, i) => [n, i]));
  const table = new Uint8Array(256 * 4);
  for (const d of defs) {
    if (!d.tex) continue;
    table[d.id * 4] = index.get(d.tex.top);
    table[d.id * 4 + 1] = index.get(d.tex.bottom);
    table[d.id * 4 + 2] = index.get(d.tex.side);
    table[d.id * 4 + 3] = index.get(d.tex.front);
  }
  return table;
}

export const TEXTURE_NAMES = collectTextureNames();
export const FACE_TEX = buildFaceTextureTable(TEXTURE_NAMES);

// Box shapes resolved to texture layers for the mesher: per block, a list of
// { b: [x0, y0, z0, x1, y1, z1] (1/16 units), top, bottom, side (layers), faces (bit mask) }.
export const BOX_SHAPES = new Array(256).fill(null);
{
  const index = new Map(TEXTURE_NAMES.map((n, i) => [n, i]));
  for (const d of defs) {
    if (!d.boxes) continue;
    BOX_SHAPES[d.id] = d.boxes.map((bx) => {
      const own = bx.tex ? index.get(bx.tex) : null;
      return {
        b: bx.b, faces: bx.faces,
        top: own ?? FACE_TEX[d.id * 4], bottom: own ?? FACE_TEX[d.id * 4 + 1], side: own ?? FACE_TEX[d.id * 4 + 2],
      };
    });
  }
}
