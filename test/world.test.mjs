// Run with: npm test   (node's built-in test runner, no browser needed)
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGenerator } from '../src/world/generator.js';
import { ChunkMesher, VERTEX_BYTES } from '../src/world/mesher.js';
import { BLOCK, WORLD_HEIGHT, SEA_LEVEL, TEXTURE_NAMES } from '../src/world/blocks.js';
import { World } from '../src/world/world.js';
import { raycast } from '../src/game/player.js';
import { Weather } from '../src/game/weather.js';
import { generateTextures, buildTextureArrays, TEX_SIZE } from '../src/world/textures.js';

const idx = (x, y, z) => (y << 8) | (z << 4) | x;

test('terrain generation is deterministic per seed and differs between seeds', () => {
  const a = new TerrainGenerator(42).generateChunk(3, -2);
  const b = new TerrainGenerator(42).generateChunk(3, -2);
  const c = new TerrainGenerator(43).generateChunk(3, -2);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(a.length, 16 * 16 * WORLD_HEIGHT);
});

test('every column has bedrock at the bottom and air at the top', () => {
  const blocks = new TerrainGenerator(7).generateChunk(0, 0);
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      assert.equal(blocks[idx(x, 0, z)], BLOCK.BEDROCK);
      assert.equal(blocks[idx(x, WORLD_HEIGHT - 1, z)], 0);
    }
  }
});

test('neighbouring chunks agree on trees that straddle their border', () => {
  // each chunk places the parts of nearby trees that fall inside it, so a canopy split across
  // the border must look the same whichever chunk is generated first
  const gen = new TerrainGenerator(12345);
  const first = [gen.generateChunk(0, 0), gen.generateChunk(1, 0)];
  const other = new TerrainGenerator(12345);
  const second = [other.generateChunk(1, 0), other.generateChunk(0, 0)].reverse();
  assert.deepEqual(first[0], second[0]);
  assert.deepEqual(first[1], second[1]);
});

test('findSpawn returns a dry position above sea level', () => {
  const gen = new TerrainGenerator(99);
  const [x, y, z] = gen.findSpawn();
  assert.ok(Number.isFinite(x) && Number.isFinite(z));
  assert.ok(y > SEA_LEVEL);
});

function flatChunks(fill) {
  // 3x3 neighbourhood of flat stone up to y = 40, with an optional modifier
  const chunks = [];
  for (let n = 0; n < 9; n++) {
    const c = new Uint8Array(16 * 16 * WORLD_HEIGHT);
    for (let y = 0; y <= 40; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) c[idx(x, y, z)] = BLOCK.STONE;
    if (fill) fill(c, n);
    chunks.push(c);
  }
  return chunks;
}

test('mesher emits only exposed faces of a flat world', () => {
  const m = new ChunkMesher(null).mesh(0, 0, flatChunks());
  const quads = m.opaque.byteLength / VERTEX_BYTES / 4;
  assert.equal(quads, 16 * 16, 'one top face per column');
  assert.equal(m.cutout.byteLength, 0);
  assert.equal(m.translucent.byteLength, 0);
});

test('sky light is full above ground, zero in a sealed cave, and torches light it', () => {
  const chunks = flatChunks((c, n) => {
    if (n === 4) {
      for (let y = 20; y < 24; y++) for (let z = 4; z < 12; z++) for (let x = 4; x < 12; x++) c[idx(x, y, z)] = 0;
      c[idx(5, 20, 5)] = BLOCK.TORCH;
    }
  });
  const m = new ChunkMesher(null).mesh(0, 0, chunks);
  const L = m.light;
  assert.equal(L[idx(8, 60, 8)] >> 4, 15, 'open sky');
  assert.equal(L[idx(10, 22, 10)] >> 4, 0, 'no sky light in the sealed cave');
  assert.equal(L[idx(5, 20, 5)] & 15, 14, 'torch emits 14');
  assert.equal(L[idx(6, 20, 5)] & 15, 13, 'light falls off by one per block');
});

test('raycast finds the first solid block and the face it entered through', () => {
  const world = new World(1, { workers: 0 });
  const blocks = new Uint8Array(16 * 16 * WORLD_HEIGHT);
  blocks[idx(5, 10, 5)] = BLOCK.STONE;
  world.chunks.set(0, null);
  world.getBlock = (x, y, z) => (x >= 0 && x < 16 && z >= 0 && z < 16 && y >= 0 && y < WORLD_HEIGHT ? blocks[idx(x, y, z)] : 0);
  const hit = raycast(world, [5.5, 13.5, 5.5], [0, -1, 0], 6);
  assert.ok(hit);
  assert.deepEqual([hit.x, hit.y, hit.z], [5, 10, 5]);
  assert.deepEqual(hit.normal, [0, 1, 0]);
  assert.equal(raycast(world, [5.5, 13.5, 5.5], [0, 1, 0], 6), null);
  world.dispose();
});

test('edits survive a serialise / deserialise round trip', () => {
  const world = new World(5, { workers: 0 });
  world.edits.set(123456, new Map([[10, BLOCK.GLASS], [4000, 0]]));
  const restored = World.deserializeEdits(JSON.parse(JSON.stringify(world.serializeEdits())));
  assert.deepEqual([...restored.get(123456).entries()], [[10, BLOCK.GLASS], [4000, 0]]);
  world.dispose();
});

test('weather ramps up to full rain in rain mode and dries out afterwards', () => {
  const w = new Weather();
  for (let i = 0; i < 600; i++) w.update(0.5, 'rain');
  assert.ok(w.rain > 0.95 && w.wetness > 0.9);
  for (let i = 0; i < 1200; i++) w.update(0.5, 'clear');
  assert.ok(w.rain < 0.01);
  assert.ok(w.wetness < 0.05);
});

test('every block texture is generated with a full mip chain', () => {
  const arrays = buildTextureArrays(generateTextures());
  assert.equal(arrays.count, TEXTURE_NAMES.length);
  assert.equal(arrays.levels.length, Math.log2(TEX_SIZE) + 1);
  assert.equal(arrays.levels[0].albedo.length, TEX_SIZE * TEX_SIZE * 4 * arrays.count);
});
