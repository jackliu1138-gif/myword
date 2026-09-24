// Block registry. Pure data so it can be shared by the main thread and workers.

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 128;
export const SEA_LEVEL = 50;

export const SHAPE = { NONE: 0, CUBE: 1, CROSS: 2, LIQUID: 3, TORCH: 4, CACTUS: 5 };
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
};

const defs = [];
export const BLOCK = {};

function def(name, props) {
  const id = defs.length;
  const d = {
    id,
    key: name,
    name: props.name || name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
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
];
for (const [c] of WOOL_COLORS) def(c + '_wool', { tex: c + '_wool', sound: 'cloth' });

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
for (const d of defs) {
  IS_OPAQUE[d.id] = d.opaque ? 1 : 0;
  IS_SOLID[d.id] = d.solid ? 1 : 0;
  LIGHT_OPACITY[d.id] = d.lightOpacity;
  EMISSION[d.id] = d.emission;
  SHAPE_OF[d.id] = d.shape;
  LAYER_OF[d.id] = d.layer;
  CULL_SELF[d.id] = d.cullSelf ? 1 : 0;
  IS_LIQUID[d.id] = d.shape === SHAPE.LIQUID ? 1 : 0;
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
