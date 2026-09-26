// Block registry. Pure data so it can be shared by the main thread and workers.

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 128;
export const SEA_LEVEL = 50;

// BOXES: a few axis-aligned boxes inside the cell (farmland, portal frames, the end portal, the
// nether portal's pane, the dragon egg); BED: a bed half, turned to face its other half.
export const SHAPE = { NONE: 0, CUBE: 1, CROSS: 2, LIQUID: 3, TORCH: 4, CACTUS: 5, BOXES: 6, BED: 7 };
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
