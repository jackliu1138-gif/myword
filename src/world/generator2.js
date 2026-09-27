// Terrain for worlds made since the world grew to 384 blocks: the continents, rivers and caves of
// the first generator, but taller (peaks past 250 with snow above ~175) around a sea at 63, and six
// more biomes: jungle, savanna, swamp, badlands (striped terracotta mesas), cherry grove and dark
// forest. Villages, temples, mineshafts and the rest come from structures.js.

import { Simplex, hash2, hash3, mulberry32 } from './noise.js';
import { BLOCK, CHUNK_SIZE, WORLD_HEIGHT, IS_SOLID } from './blocks.js';
import { TerrainGenerator } from './generator.js';
import { SEA2, BIOME2, BIOME2_NAMES } from './biomes.js';
import { Structures, ChunkCtx } from './structures.js';

export { SEA2, BIOME2, BIOME2_NAMES };

const H = WORLD_HEIGHT;
const SEA = SEA2;
const CS = CHUNK_SIZE;
const B = BLOCK;
const BI = BIOME2;
const idx = (x, y, z) => (y << 8) | (z << 4) | x;

function smooth(e0, e1, x) {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
function spline(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1], [x1, y1] = points[i];
      const t = (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t * t * (3 - 2 * t);
    }
  }
  return points[points.length - 1][1];
}

// continentalness -> base height: deep ocean floor, shelves, coasts, lowlands and high plains
const CONT_SPLINE = [
  [-1.0, 20], [-0.62, 32], [-0.44, 44], [-0.32, 54], [-0.24, 60], [-0.18, 62.5], [-0.04, 67], [0.22, 76], [0.6, 90], [1.0, 104],
];
const TREE_CELL = 5;
// by biome: chance of a tree in each 5x5 cell, and of a bush
const TREE_DENSITY = [0, 0, 0.05, 0.85, 0.8, 0.72, 0.38, 0.14, 0.06, 0, 0.97, 0.12, 0.42, 0.08, 0.5, 0.97];
const BUSH_DENSITY = [0, 0, 0.06, 0.1, 0.08, 0.08, 0, 0, 0.03, 0, 0.02, 0.02, 0.03, 0, 0.04, 0.02];

const LEAVES = new Uint8Array(256);
for (const k of ['OAK', 'BIRCH', 'SPRUCE', 'JUNGLE', 'ACACIA', 'DARK_OAK', 'CHERRY']) LEAVES[B[k + '_LEAVES']] = 1;
const REPLACEABLE = new Uint8Array(256);
for (const b of [0, B.TALL_GRASS, B.FERN, B.POPPY, B.DANDELION, B.CORNFLOWER, B.PINK_PETALS, B.DEAD_BUSH, B.VINE]) REPLACEABLE[b] = 1;

// the colours of the badlands' layers, bottom to top, repeating every 64 blocks
const BAND_COLORS = [B.ORANGE_TERRACOTTA, B.TERRACOTTA, B.YELLOW_TERRACOTTA, B.BROWN_TERRACOTTA, B.RED_TERRACOTTA, B.WHITE_TERRACOTTA, B.LIGHT_GRAY_TERRACOTTA];

export class TerrainGenerator2 extends TerrainGenerator {
  constructor(seed) {
    super(seed);
    this.version = 2;
    this.sea = SEA;
    const s = this.seed;
    this.nWeird = new Simplex(s ^ 0x3c3c);
    this.nMesa = new Simplex(s ^ 0x4d4d);
    this.nCherry = new Simplex(s ^ 0x5e5e);
    // the badlands' strata
    const rand = mulberry32((s ^ 0xba2d) >>> 0);
    this.bands = new Uint8Array(64);
    for (let y = 0; y < 64;) {
      const n = 1 + Math.floor(rand() * 3);
      const c = rand() < 0.35 ? B.TERRACOTTA : BAND_COLORS[Math.floor(rand() * BAND_COLORS.length)];
      for (let k = 0; k < n && y < 64; k++) this.bands[y++] = c;
    }
    this.tintCache = new Map();
    this.structures = new Structures(this);
  }

  // biomes are a little smaller than in the first generator, so more of them are near
  climate(x, z) {
    const t = this.nTemp.fbm2(x * 0.0011, z * 0.0011, 3) * 1.3;
    const h = this.nHum.fbm2(x * 0.0013 + 71.3, z * 0.0013 - 33.1, 3) * 1.3;
    return [t, h];
  }

  column(x, z, out = this.col) {
    const warpX = this.nDetail.noise2(x * 0.004, z * 0.004) * 40;
    const warpZ = this.nDetail.noise2(x * 0.004 + 50, z * 0.004 - 50) * 40;
    const wx = x + warpX, wz = z + warpZ;
    const cont = this.nCont.fbm2(wx * 0.0011, wz * 0.0011, 5) * 1.35;
    const ero = this.nEro.fbm2(wx * 0.0018 + 40.1, wz * 0.0018 - 7.7, 4) * 1.3;
    const peaks = this.nPeak.ridged2(wx * 0.0034, wz * 0.0034, 5);
    const hills = this.nHill.fbm2(x * 0.008, z * 0.008, 4);
    const detail = this.nDetail.fbm2(x * 0.045, z * 0.045, 2);
    const [t0, hum] = this.climate(x, z);
    const weird = this.nWeird.noise2(x * 0.0024, z * 0.0024);

    let h = spline(CONT_SPLINE, cont);
    const inland = smooth(-0.22, 0.2, cont);
    const mountain = smooth(-0.12, 0.38, cont) * smooth(0.42, -0.32, ero);
    const hillAmp = (4 + 13 * smooth(-0.6, 0.6, -ero)) * (0.3 + 0.7 * inland);
    h += hills * hillAmp;
    h += mountain * Math.pow(peaks, 1.3) * 150;
    h += detail * 1.2;

    // badlands: hot, dry country rises into flat-topped mesas with stepped sides
    const bad = smooth(0.32, 0.5, t0) * smooth(-0.05, -0.3, hum) * smooth(-0.05, 0.2, weird) * inland * (1 - mountain);
    if (bad > 0.001) {
      const raise = smooth(0.0, 0.45, this.nMesa.noise2(x * 0.011, z * 0.011)) * 34 + this.nMesa.noise2(x * 0.05, z * 0.05) * 3;
      let hb = h + raise;
      const step = 6, f = hb / step, fl = Math.floor(f);
      hb = (fl + smooth(0.6, 0.95, f - fl)) * step;
      h += (hb - h) * smooth(0, 0.35, bad);
    }
    // swamps: warm, wet lowlands flatten out around the sea's level into pools and mud banks
    const swamp = smooth(0.0, 0.2, t0) * smooth(0.3, 0.5, hum) * smooth(0.25, -0.1, cont) * smooth(-0.3, -0.18, cont) * (1 - mountain);
    if (swamp > 0.001) {
      const target = SEA + detail * 1.6 + hills * 1.4 + 0.2;
      h += (target - h) * smooth(0, 0.6, swamp) * smooth(SEA + 18, SEA + 5, h);
    }

    // rivers carve valleys through land
    const rv = Math.abs(this.nRiver.fbm2(x * 0.0017 + 11.1, z * 0.0017 + 5.3, 3));
    const riverW = 0.028 + 0.012 * this.nRiver.noise2(x * 0.01, z * 0.01);
    let river = 1 - smooth(riverW * 0.5, riverW * 2.2, rv);
    river *= smooth(-0.3, -0.14, cont) * (1 - mountain * 0.85) * (1 - bad * 0.7);
    if (river > 0 && h > SEA - 3) {
      const bed = SEA - 3 - 2 * river;
      h = h + (bed - h) * smooth(0.0, 0.85, river);
    }

    if (h > 200) h = 200 + (h - 200) * 0.6;
    if (h > H - 40) h = H - 40;
    if (h < 8) h = 8;
    const temp = t0 - Math.max(0, h - SEA - 30) * 0.007;
    const height = Math.floor(h);
    const cherry = smooth(-0.1, 0.05, t0) * smooth(0.32, 0.18, t0) * smooth(-0.05, 0.12, hum) * smooth(0.06, 0.2, mountain) *
      smooth(0.2, 0.4, this.nCherry.noise2(x * 0.0035 + 900, z * 0.0035 + 900));

    let biome;
    if (height < SEA - 1) biome = river > 0.3 ? BI.RIVER : swamp > 0.45 && height > SEA - 6 ? BI.SWAMP : BI.OCEAN;
    else if (river > 0.45 && height <= SEA + 1) biome = BI.RIVER;
    else if (swamp > 0.45 && height <= SEA + 5) biome = BI.SWAMP;
    else if (bad > 0.4) biome = BI.BADLANDS;
    else if (height <= SEA + 2 && cont < -0.12 && river < 0.2) biome = temp > 0.45 ? BI.DESERT : BI.BEACH;
    else if (cherry > 0.5 && height > SEA + 8 && height < SEA + 110) biome = BI.CHERRY;
    else if (mountain > 0.45 && height > SEA + 50) biome = BI.MOUNTAINS;
    else if (temp < -0.45) biome = BI.SNOWY;
    else if (temp < -0.15) biome = BI.TAIGA;
    else if (temp > 0.45) biome = hum < -0.05 ? BI.DESERT : hum < 0.3 ? BI.SAVANNA : BI.JUNGLE;
    else if (temp > 0.2) biome = hum < -0.1 ? BI.SAVANNA : hum > 0.35 ? BI.JUNGLE : hum > 0.12 ? BI.FOREST : BI.PLAINS;
    else biome = hum > 0.38 ? BI.DARK_FOREST : hum > 0.18 ? BI.FOREST : hum > 0.0 && temp < 0.05 ? BI.BIRCH_FOREST : BI.PLAINS;

    out.height = height;
    out.hf = h;
    out.biome = biome;
    out.temp = temp;
    out.hum = hum;
    out.mountain = mountain;
    out.river = river;
    out.cont = cont;
    out.bad = bad;
    return out;
  }

  // Grass and leaf colours for the mesher, per column (0..1 temperature and humidity). Swamps and
  // badlands use the ends of the range, which the shaders paint murky green and dusty olive.
  tintChunk(cx, cz) {
    const key = cx * 65536 + cz;
    let t = this.tintCache.get(key);
    if (t) return t;
    t = new Float32Array(CS * CS * 2);
    const c = {};
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        this.column(cx * CS + x, cz * CS + z, c);
        let tt = Math.max(0, Math.min(0.9, c.temp * 0.5 + 0.5)), hh = Math.max(0, Math.min(0.88, c.hum * 0.5 + 0.5));
        switch (c.biome) {
          case BI.SWAMP: tt = 0.6; hh = 1; break;
          case BI.BADLANDS: tt = 1; hh = 0; break;
          case BI.JUNGLE: tt = Math.max(tt, 0.72); hh = Math.max(hh, 0.8); break;
          case BI.SAVANNA: tt = Math.max(tt, 0.82); hh = Math.min(hh, 0.35); break;
          case BI.DESERT: tt = 0.9; hh = Math.min(hh, 0.2); break;
          case BI.DARK_FOREST: tt = Math.max(tt, 0.5); hh = Math.max(hh, 0.84); break;
          case BI.CHERRY: tt = 0.52; hh = 0.62; break;
          default: break;
        }
        t[(z * CS + x) * 2] = tt;
        t[(z * CS + x) * 2 + 1] = hh;
      }
    }
    this.tintCache.set(key, t);
    if (this.tintCache.size > 600) this.tintCache.delete(this.tintCache.keys().next().value);
    return t;
  }

  tintClimate(x, z) {
    const t = this.tintChunk(Math.floor(x / CS), Math.floor(z / CS));
    const i = ((z - Math.floor(z / CS) * CS) * CS + (x - Math.floor(x / CS) * CS)) * 2;
    return [Math.round(t[i] * 255), Math.round(t[i + 1] * 255)];
  }

  // What falls from the sky: nothing over dry land, snow in the cold and high up.
  precipitation(col, y) {
    if (col.biome === BI.DESERT || col.biome === BI.SAVANNA || col.biome === BI.BADLANDS) return 'none';
    if (col.biome === BI.SNOWY || col.temp < -0.45 || y > 172) return 'snow';
    return 'rain';
  }

  generateChunk(cx, cz) {
    const blocks = new Uint8Array(CS * CS * H);
    const ctx = new ChunkCtx(blocks, cx, cz, this);
    const x0 = cx * CS, z0 = cz * CS;
    const R = CS + 2;
    const heights = new Int16Array(R * R);
    const colBiome = new Uint8Array(CS * CS);
    const colTemp = new Float32Array(CS * CS);
    const colMount = new Float32Array(CS * CS);
    const colRiver = new Float32Array(CS * CS);
    const c = {};
    let maxH = 0;
    for (let dz = -1; dz <= CS; dz++) {
      for (let dx = -1; dx <= CS; dx++) {
        this.column(x0 + dx, z0 + dz, c);
        heights[(dz + 1) * R + (dx + 1)] = c.height;
        if (dx >= 0 && dz >= 0 && dx < CS && dz < CS) {
          const ci = dz * CS + dx;
          colBiome[ci] = c.biome;
          colTemp[ci] = c.temp;
          colMount[ci] = c.mountain;
          colRiver[ci] = c.river;
          if (c.height > maxH) maxH = c.height;
        }
      }
    }
    ctx.maxH = maxH;

    // ---- 1. rock, with cliffs and overhangs on the mountains
    const top = new Int16Array(CS * CS);
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const ci = z * CS + x;
        const h = heights[(z + 1) * R + (x + 1)];
        const m = colMount[ci];
        const wx = x0 + x, wz = z0 + z;
        blocks[idx(x, 0, z)] = B.BEDROCK;
        for (let y = 1; y <= h; y++) {
          blocks[idx(x, y, z)] = y < 4 && hash3(wx, y, wz, this.seed) < 0.55 - y * 0.12 ? B.BEDROCK : B.STONE;
        }
        let colTop = h;
        if (m > 0.2) {
          const amp = (m - 0.2) * 1.8;
          const lo = Math.max(2, h - 18), hi = Math.min(H - 20, h + 16);
          for (let y = lo; y <= hi; y++) {
            const n = this.nOver.noise3(wx * 0.03, y * 0.045, wz * 0.03) + this.nOver.noise3(wx * 0.075, y * 0.09, wz * 0.075) * 0.35;
            const dens = (h - y) / 11 + n * amp;
            if (dens > 0) {
              blocks[idx(x, y, z)] = B.STONE;
              if (y > colTop) colTop = y;
            } else if (y <= h) blocks[idx(x, y, z)] = 0;
          }
        }
        top[ci] = colTop;
        if (colTop > maxH) maxH = colTop;
      }
    }
    ctx.maxH = maxH;

    // ---- 2. soil and sand; the badlands' stripes
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const ci = z * CS + x;
        const biome = colBiome[ci];
        const hc = heights[(z + 1) * R + (x + 1)];
        const slope = Math.max(
          Math.abs(heights[(z + 1) * R + x] - heights[(z + 1) * R + x + 2]),
          Math.abs(heights[z * R + x + 1] - heights[(z + 2) * R + x + 1]),
        );
        const wx = x0 + x, wz = z0 + z;
        const patch = this.nPatch.noise2(wx * 0.05, wz * 0.05);
        let depth = 0, sandy = false;
        for (let y = top[ci]; y > 0; y--) {
          const i = idx(x, y, z);
          const b = blocks[i];
          if (b === 0) { depth = 0; continue; }
          if (b !== B.STONE) continue;
          const exposedAbove = y === top[ci] || blocks[idx(x, y + 1, z)] === 0;
          if (exposedAbove) depth = 0;
          if (biome === BI.BADLANDS) {
            // red sand on the low, flat ground; everything else striped down to below the sea
            if (y < SEA - 6) { depth++; continue; }
            if (depth === 0) sandy = y < SEA + 16 && slope < 3;
            blocks[i] = depth < 2 && sandy ? B.RED_SAND : this.bands[(y + 640) & 63];
            depth++;
            continue;
          }
          if (depth > 5) { depth++; continue; }
          const under = y < SEA;
          let surf = B.GRASS, fill = B.DIRT, fillDepth = 3 + (hash2(wx, wz, this.seed) < 0.5 ? 1 : 0);
          switch (biome) {
            case BI.OCEAN:
              surf = hc < SEA - 14 ? B.GRAVEL : patch > 0.45 ? B.CLAY : B.SAND;
              fill = B.SAND;
              break;
            case BI.RIVER:
              surf = patch > 0.3 ? B.GRAVEL : patch < -0.5 ? B.CLAY : B.SAND;
              fill = B.SAND;
              break;
            case BI.BEACH: case BI.DESERT:
              surf = B.SAND; fill = B.SAND; fillDepth = 4;
              break;
            case BI.SNOWY:
              surf = B.SNOWY_GRASS;
              break;
            case BI.SWAMP:
              if (under) surf = patch > 0.1 ? B.CLAY : B.DIRT;
              break;
            case BI.MOUNTAINS:
              surf = y > 178 ? B.SNOW : y > 150 ? (slope >= 3 ? B.STONE : B.SNOW) : slope >= 3 ? B.STONE : y > 128 ? (patch > 0 ? B.STONE : B.GRAVEL) : B.GRASS;
              if (surf === B.SNOW) fill = B.SNOW;
              break;
            default:
              break;
          }
          if (y > 176 && surf === B.GRASS) { surf = B.SNOW; fill = B.SNOW; }
          if (slope >= 4 && biome !== BI.OCEAN && biome !== BI.RIVER && biome !== BI.DESERT && biome !== BI.BEACH) {
            surf = y > 176 ? B.SNOW : slope >= 6 || patch > 0.2 ? B.STONE : B.GRAVEL;
            fill = surf === B.STONE ? B.STONE : B.DIRT;
          }
          if (under && (surf === B.GRASS || surf === B.SNOWY_GRASS)) surf = patch > 0.3 ? B.GRAVEL : B.DIRT;
          if (under && biome !== BI.OCEAN && biome !== BI.RIVER && biome !== BI.SWAMP && y >= SEA - 3) surf = patch > 0.25 ? B.GRAVEL : B.SAND;
          if (!under && y <= SEA + 1 && biome !== BI.SNOWY && biome !== BI.MOUNTAINS && biome !== BI.SWAMP && colRiver[ci] > 0.05) surf = B.SAND;

          if (depth === 0) blocks[i] = surf;
          else if (depth < fillDepth) blocks[i] = fill === B.GRASS ? B.DIRT : fill;
          else if (depth < fillDepth + 3 && (biome === BI.DESERT || biome === BI.BEACH) && fill === B.SAND) blocks[i] = B.SANDSTONE;
          depth++;
        }
      }
    }

    // ---- 3. caves
    this.carveCaves2(blocks, x0, z0, heights, R, maxH);

    // ---- 4. the sea, frozen where it is cold
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const ci = z * CS + x;
        const frozen = colBiome[ci] === BI.SNOWY || colTemp[ci] < -0.5;
        for (let y = SEA; y > 0; y--) {
          const i = idx(x, y, z);
          if (blocks[i] !== 0) break;
          blocks[i] = y === SEA && frozen ? B.ICE : B.WATER;
        }
      }
    }

    // ---- 5. ores
    this.placeOres2(blocks, cx, cz, colBiome);

    // ---- 6. strongholds deep down (their portal room leads to the End)
    for (const sh of this.strongholds()) {
      if (Math.abs(sh.x - (x0 + 8)) < 48 && Math.abs(sh.z - (z0 + 8)) < 48) this.stronghold(blocks, cx, cz, sh);
    }

    // ---- 7. trees and plants, then villages, temples and the rest on top
    this.decorate2(ctx, colBiome);
    this.structures.build(ctx);
    return ctx.result();
  }

  carveCaves2(blocks, x0, z0, heights, R, maxH) {
    const GX = 5, GY = Math.min(H >> 2, (maxH >> 2) + 2) + 1, GZ = 5;
    const grid = new Float32Array(GX * GY * GZ * 2);
    for (let gy = 0; gy < GY; gy++) {
      for (let gz = 0; gz < GZ; gz++) {
        for (let gx = 0; gx < GX; gx++) {
          const wx = x0 + gx * 4, wy = gy * 4, wz = z0 + gz * 4;
          const a = this.nCave.noise3(wx * 0.016, wy * 0.026, wz * 0.016);
          const b = this.nCave2.noise3(wx * 0.016, wy * 0.026, wz * 0.016);
          const gi = ((gy * GZ + gz) * GX + gx) * 2;
          grid[gi] = a * a + b * b;
          grid[gi + 1] = this.nCheese.noise3(wx * 0.011, wy * 0.02, wz * 0.011) + this.nCheese.noise3(wx * 0.03, wy * 0.05, wz * 0.03) * 0.3;
        }
      }
    }
    const sample = (x, y, z, ch) => {
      const fx = x / 4, fy = y / 4, fz = z / 4;
      const ix = Math.min(GX - 2, fx | 0), iy = Math.min(GY - 2, fy | 0), iz = Math.min(GZ - 2, fz | 0);
      const tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const g = (a, b, c) => grid[(((iy + b) * GZ + (iz + c)) * GX + (ix + a)) * 2 + ch];
      const c00 = g(0, 0, 0) + (g(1, 0, 0) - g(0, 0, 0)) * tx;
      const c10 = g(0, 1, 0) + (g(1, 1, 0) - g(0, 1, 0)) * tx;
      const c01 = g(0, 0, 1) + (g(1, 0, 1) - g(0, 0, 1)) * tx;
      const c11 = g(0, 1, 1) + (g(1, 1, 1) - g(0, 1, 1)) * tx;
      const c0 = c00 + (c10 - c00) * ty;
      const c1 = c01 + (c11 - c01) * ty;
      return c0 + (c1 - c0) * tz;
    };
    const CHEESE_TOP = SEA - 6;
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const h = heights[(z + 1) * R + (x + 1)];
        const wx = x0 + x, wz = z0 + z;
        const underwater = h < SEA + 1;
        const entrance = !underwater && this.caveEntrance(wx, wz);
        const crust = underwater ? 6 : entrance ? -2 : 5;
        const maxY = Math.min(h - crust, (GY - 1) * 4 - 1);
        for (let y = 2; y <= maxY; y++) {
          const i = idx(x, y, z);
          const b = blocks[i];
          if (b === 0 || b === B.BEDROCK || b === B.WATER) continue;
          const tunnel = sample(x, y, z, 0);
          let carve = tunnel < 0.0075 + (y < 14 ? 0.004 : 0);
          if (!carve && y < CHEESE_TOP) carve = sample(x, y, z, 1) > 0.56 + (CHEESE_TOP - y) * -0.0018;
          if (carve) blocks[i] = y <= 9 ? B.LAVA : 0;
        }
      }
    }
  }

  placeOres2(blocks, cx, cz, colBiome) {
    const rand = mulberry32(hash2(cx, cz, this.seed ^ 0x51ee) * 4294967296);
    const vein = (block, count, size, minY, maxY) => {
      for (let v = 0; v < count; v++) {
        let x = rand() * CS, y = minY + rand() * (maxY - minY), z = rand() * CS;
        for (let k = 0; k < size; k++) {
          const ix = x | 0, iy = y | 0, iz = z | 0;
          if (ix >= 0 && ix < CS && iz >= 0 && iz < CS && iy > 0 && iy < H) {
            const i = idx(ix, iy, iz);
            if (blocks[i] === B.STONE) blocks[i] = block;
          }
          x += rand() * 2 - 1; y += rand() * 2 - 1; z += rand() * 2 - 1;
        }
      }
    };
    let mountain = 0, badlands = 0;
    for (let i = 0; i < CS * CS; i += 17) { if (colBiome[i] === BI.MOUNTAINS) mountain++; if (colBiome[i] === BI.BADLANDS) badlands++; }
    vein(B.COAL_ORE, 18, 10, 6, 170);
    vein(B.IRON_ORE, 10, 7, 4, 72);
    if (mountain) vein(B.IRON_ORE, 6, 8, 90, 230);
    vein(B.GOLD_ORE, 3, 6, 4, 36);
    if (badlands) vein(B.GOLD_ORE, 6, 6, 36, 90);
    vein(B.LAPIS_ORE, 2, 5, 4, 40);
    vein(B.DIAMOND_ORE, rand() < 0.35 ? 2 : 1, 5, 3, 18);
    if (mountain) vein(B.EMERALD_ORE, 3, 2, 80, 240);
    vein(B.GRAVEL, 3, 14, 5, 110);
    vein(B.DIRT, 3, 14, 5, 110);
  }

  // Trees (which may reach into this chunk from next door), then what grows on the ground.
  decorate2(ctx, colBiome) {
    const blocks = ctx.blocks;
    const x0 = ctx.x0, z0 = ctx.z0;
    const set = (wx, y, wz, b, replaceSolid = false, state = 0) => {
      const x = wx - x0, z = wz - z0;
      if (x < 0 || x >= CS || z < 0 || z >= CS || y < 1 || y >= H) return;
      const i = idx(x, y, z);
      const cur = blocks[i];
      if (REPLACEABLE[cur] || (replaceSolid && cur !== B.BEDROCK) || (LEAVES[cur] && !LEAVES[b] && b !== B.VINE)) {
        blocks[i] = b;
        ctx.setState(i, state);
      }
    };
    const c = {}, c2 = {};
    const margin = 9;
    const cx0 = Math.floor((x0 - margin) / TREE_CELL), cx1 = Math.floor((x0 + CS + margin) / TREE_CELL);
    const cz0 = Math.floor((z0 - margin) / TREE_CELL), cz1 = Math.floor((z0 + CS + margin) / TREE_CELL);
    for (let tcz = cz0; tcz <= cz1; tcz++) {
      for (let tcx = cx0; tcx <= cx1; tcx++) {
        const r0 = hash2(tcx, tcz, this.seed ^ 0x7ee);
        const wx = tcx * TREE_CELL + Math.floor(hash2(tcx, tcz, this.seed ^ 0x7ef) * TREE_CELL);
        const wz = tcz * TREE_CELL + Math.floor(hash2(tcx, tcz, this.seed ^ 0x7f0) * TREE_CELL);
        this.column(wx, wz, c);
        if (c.height <= SEA || this.caveEntrance(wx, wz)) continue;
        if (c.biome === BI.MOUNTAINS && c.height > SEA + 85) continue;
        if (c.height > 176) continue;
        const dens = TREE_DENSITY[c.biome], bushDens = BUSH_DENSITY[c.biome];
        if (r0 >= dens + bushDens) continue;
        if (!this.structures.treeFree(wx, wz)) continue;
        const bush = r0 >= dens;
        const hx = this.column(wx + 2, wz, c2).height, hz = this.column(wx, wz + 2, c2).height;
        if (Math.abs(hx - c.height) > 3 || Math.abs(hz - c.height) > 3) continue;
        const rnd = mulberry32(hash2(wx, wz, this.seed ^ 0xa11) * 4294967296);
        const y = c.height + 1;
        if (bush) {
          const spruce = c.biome === BI.TAIGA;
          const log = spruce ? B.SPRUCE_LOG : c.biome === BI.JUNGLE ? B.JUNGLE_LOG : c.biome === BI.SAVANNA ? B.ACACIA_LOG : B.OAK_LOG;
          const leaves = spruce ? B.SPRUCE_LEAVES : c.biome === BI.SAVANNA ? B.ACACIA_LEAVES : B.OAK_LEAVES;
          this.bush(set, wx, y, wz, rnd, log, leaves);
          continue;
        }
        switch (c.biome) {
          case BI.DESERT:
            this.cactus(set, wx, y, wz, rnd);
            break;
          case BI.BADLANDS:
            if (rnd() < 0.7) this.cactus(set, wx, y, wz, rnd);
            break;
          case BI.TAIGA:
            if (rnd() < 0.14 && this.flatFor(wx, wz, c.height, 2)) this.megaSpruce(set, wx, y, wz, rnd);
            else this.spruce(set, wx, y, wz, rnd);
            break;
          case BI.SNOWY: case BI.MOUNTAINS:
            this.spruce(set, wx, y, wz, rnd);
            break;
          case BI.BIRCH_FOREST:
            if (rnd() < 0.85) this.oak(set, wx, y, wz, rnd, B.BIRCH_LOG, B.BIRCH_LEAVES, 5 + Math.floor(rnd() * 3));
            else this.oak(set, wx, y, wz, rnd, B.OAK_LOG, B.OAK_LEAVES, 4 + Math.floor(rnd() * 2));
            break;
          case BI.FOREST: {
            const r = rnd();
            if (r < 0.14) this.bigOak(set, wx, y, wz, rnd);
            else if (r < 0.34) this.oak(set, wx, y, wz, rnd, B.BIRCH_LOG, B.BIRCH_LEAVES, 5 + Math.floor(rnd() * 3));
            else this.oak(set, wx, y, wz, rnd, B.OAK_LOG, B.OAK_LEAVES, 4 + Math.floor(rnd() * 3));
            break;
          }
          case BI.JUNGLE: {
            const r = rnd();
            if (r < 0.14 && this.flatFor(wx, wz, c.height, 2)) this.megaJungle(set, wx, y, wz, rnd);
            else if (r < 0.55) this.jungleTree(set, wx, y, wz, rnd);
            else if (r < 0.85) this.bush(set, wx, y, wz, rnd, B.JUNGLE_LOG, B.OAK_LEAVES);
            else this.oak(set, wx, y, wz, rnd, B.OAK_LOG, B.OAK_LEAVES, 4 + Math.floor(rnd() * 3));
            break;
          }
          case BI.SAVANNA:
            if (rnd() < 0.8) this.acacia(set, wx, y, wz, rnd);
            else this.oak(set, wx, y, wz, rnd, B.OAK_LOG, B.OAK_LEAVES, 4 + Math.floor(rnd() * 2));
            break;
          case BI.SWAMP:
            this.swampOak(set, wx, y, wz, rnd);
            break;
          case BI.CHERRY:
            this.cherryTree(set, wx, y, wz, rnd);
            break;
          case BI.DARK_FOREST: {
            const r = rnd();
            if (r < 0.72 && this.flatFor(wx, wz, c.height, 2)) this.darkOak(set, wx, y, wz, rnd);
            else if (r < 0.84) this.bigOak(set, wx, y, wz, rnd);
            else if (r < 0.92) this.oak(set, wx, y, wz, rnd, B.BIRCH_LOG, B.BIRCH_LEAVES, 5 + Math.floor(rnd() * 3));
            else this.oak(set, wx, y, wz, rnd, B.OAK_LOG, B.OAK_LEAVES, 4 + Math.floor(rnd() * 3));
            break;
          }
          default:
            if (rnd() < 0.12) this.bigOak(set, wx, y, wz, rnd);
            else this.oak(set, wx, y, wz, rnd, B.OAK_LOG, B.OAK_LEAVES, 4 + Math.floor(rnd() * 3));
        }
      }
    }

    // on the ground in this chunk
    const scanTop = Math.min(H - 2, ctx.maxH + 36);
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const wx = x0 + x, wz = z0 + z;
        let y = scanTop;
        while (y > 0 && blocks[idx(x, y, z)] === 0) y--;
        const ground = blocks[idx(x, y, z)];
        if (y >= H - 3 || blocks[idx(x, y + 1, z)] !== 0) continue;
        const r = hash2(wx, wz, this.seed ^ 0x9a55);
        const biome = colBiome[z * CS + x];
        const above = idx(x, y + 1, z);
        if (ground === B.WATER) {
          if (biome === BI.SWAMP && y === SEA && r < 0.07) blocks[above] = B.LILY_PAD;
          continue;
        }
        // sugar cane on the banks
        if ((ground === B.GRASS || ground === B.SAND || ground === B.RED_SAND || ground === B.DIRT) && y === SEA && r > (biome === BI.SWAMP ? 0.92 : 0.84)) {
          let wet = false;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, nz = z + dz;
            if (nx >= 0 && nx < CS && nz >= 0 && nz < CS && blocks[idx(nx, y, nz)] === B.WATER) wet = true;
          }
          if (wet) {
            const n = 1 + Math.floor(hash2(wx, wz, this.seed ^ 0x5c) * 3);
            for (let k = 1; k <= n; k++) blocks[idx(x, y + k, z)] = B.SUGAR_CANE;
            continue;
          }
        }
        if (ground === B.GRASS) {
          const fl = this.nPatch.noise2(wx * 0.03, wz * 0.03);
          let grassP = 0.18, flowerP = 0.01, fernP = 0;
          switch (biome) {
            case BI.PLAINS: grassP = 0.34; flowerP = fl > 0.25 ? 0.16 : 0.03; break;
            case BI.FOREST: case BI.BIRCH_FOREST: grassP = 0.2; flowerP = fl > 0.4 ? 0.07 : 0.012; fernP = 0.04; break;
            case BI.TAIGA: grassP = 0.08; fernP = 0.16; flowerP = 0.003; break;
            case BI.MOUNTAINS: grassP = 0.12; break;
            case BI.JUNGLE: grassP = 0.3; fernP = 0.2; flowerP = 0.004; break;
            case BI.SAVANNA: grassP = 0.45; flowerP = 0.004; break;
            case BI.SWAMP: grassP = 0.14; flowerP = 0.004; break;
            case BI.DARK_FOREST: grassP = 0.07; fernP = 0.03; flowerP = 0.004; break;
            case BI.CHERRY: grassP = 0.1; flowerP = 0; break;
            default: break;
          }
          if (biome === BI.CHERRY && r < (fl > -0.2 ? 0.22 : 0.06)) blocks[above] = B.PINK_PETALS;
          else if (r < flowerP) {
            const kind = hash2(Math.floor(wx / 6), Math.floor(wz / 6), this.seed ^ 0xf10);
            blocks[above] = kind < 0.45 ? B.POPPY : kind < 0.85 ? B.DANDELION : B.CORNFLOWER;
          } else if (r < flowerP + fernP) blocks[above] = B.FERN;
          else if (r < flowerP + fernP + grassP) blocks[above] = B.TALL_GRASS;
          else if (r > 0.9993 && biome === BI.PLAINS) blocks[above] = B.PUMPKIN;
          else if (r > 0.994 && biome === BI.JUNGLE) blocks[above] = B.MELON;
        } else if (ground === B.SAND || ground === B.RED_SAND) {
          if ((biome === BI.DESERT && r < 0.012) || (biome === BI.BADLANDS && r < 0.02)) blocks[above] = B.DEAD_BUSH;
        } else if (ground === B.SNOWY_GRASS) {
          if (r < 0.03) blocks[above] = B.FERN;
        } else if (biome === BI.BADLANDS && ground !== B.CACTUS && IS_SOLID[ground] && r < 0.006) blocks[above] = B.DEAD_BUSH;
      }
    }
  }

  // ------------------------------------------------------------------ the new trees
  // vines down from (x, y, z) on the side `f` of whatever they hang from (state = that side)
  hangVine(set, x, y, z, f, len) {
    for (let k = 0; k < len; k++) set(x, y - k, z, B.VINE, false, f);
  }

  // leaves over a trunk; vines trail from the canopy's edge and cling to the trunk
  jungleTree(set, x, y, z, rnd) {
    const height = 6 + Math.floor(rnd() * 7);
    set(x, y - 1, z, B.DIRT, true);
    for (let k = 0; k < height; k++) set(x, y + k, z, B.JUNGLE_LOG, true);
    const topY = y + height - 1;
    this.blob(set, x, topY, z, 2.6 + rnd() * 0.6, 1.8, 2.6 + rnd() * 0.6, B.JUNGLE_LEAVES, rnd);
    this.blob(set, x, topY + 1.5, z, 1.6, 1.2, 1.6, B.JUNGLE_LEAVES, rnd);
    for (let k = 1; k < height - 2; k++) {
      for (let f = 0; f < 4; f++) {
        if (rnd() > 0.28) continue;
        const [dx, dz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][f];
        set(x + dx, y + k, z + dz, B.VINE, false, (f + 2) & 3);
      }
    }
    for (let i = 0; i < 5; i++) {
      const a = rnd() * Math.PI * 2, r = 3;
      const vx = Math.round(x + Math.cos(a) * r), vz = Math.round(z + Math.sin(a) * r);
      this.hangVine(set, vx, topY - 1, vz, rnd() < 0.5 ? 0 : 2, 2 + Math.floor(rnd() * 4));
    }
  }

  // a giant: a 2x2 trunk, side branches with their own clumps, a wide crown and vines all over
  megaJungle(set, x, y, z, rnd) {
    const height = 18 + Math.floor(rnd() * 12);
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
      set(x + dx, y - 1, z + dz, B.DIRT, true);
      for (let k = 0; k < height; k++) set(x + dx, y + k, z + dz, B.JUNGLE_LOG, true);
    }
    const topY = y + height;
    this.blob(set, x + 0.5, topY - 1, z + 0.5, 4.4 + rnd(), 2.2, 4.4 + rnd(), B.JUNGLE_LEAVES, rnd);
    this.blob(set, x + 0.5, topY + 1, z + 0.5, 2.8, 1.4, 2.8, B.JUNGLE_LEAVES, rnd);
    const branches = 2 + Math.floor(rnd() * 3);
    for (let b = 0; b < branches; b++) {
      const ang = rnd() * Math.PI * 2;
      const by = y + Math.floor(height * (0.45 + rnd() * 0.35));
      let bx = x, bz = z;
      for (let s = 1; s <= 4; s++) {
        bx = Math.round(x + 0.5 + Math.cos(ang) * s);
        bz = Math.round(z + 0.5 + Math.sin(ang) * s);
        set(bx, by + (s >> 1), bz, B.JUNGLE_LOG, true);
      }
      this.blob(set, bx, by + 3, bz, 2.4, 1.5, 2.4, B.JUNGLE_LEAVES, rnd);
    }
    // vines on the trunk's four faces
    for (let k = 0; k < height - 3; k++) {
      for (let s = 0; s < 2; s++) {
        if (rnd() < 0.4) set(x + s, y + k, z - 1, B.VINE, false, 2);
        if (rnd() < 0.4) set(x + s, y + k, z + 2, B.VINE, false, 0);
        if (rnd() < 0.4) set(x - 1, y + k, z + s, B.VINE, false, 1);
        if (rnd() < 0.4) set(x + 2, y + k, z + s, B.VINE, false, 3);
      }
    }
    for (let i = 0; i < 10; i++) {
      const a = rnd() * Math.PI * 2, r = 4.5 + rnd();
      const vx = Math.round(x + 0.5 + Math.cos(a) * r), vz = Math.round(z + 0.5 + Math.sin(a) * r);
      this.hangVine(set, vx, topY - 2, vz, Math.floor(rnd() * 4), 3 + Math.floor(rnd() * 8));
    }
  }

  // acacia: a trunk that leans off to one side and ends in flat, wide canopies
  acacia(set, x, y, z, rnd) {
    set(x, y - 1, z, B.DIRT, true);
    const straight = 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < straight; k++) set(x, y + k, z, B.ACACIA_LOG, true);
    const crowns = [];
    const lean = (ang, len, fromY) => {
      let bx = x, bz = z, by = fromY;
      for (let s = 1; s <= len; s++) {
        bx = Math.round(x + Math.cos(ang) * s);
        bz = Math.round(z + Math.sin(ang) * s);
        by++;
        set(bx, by, bz, B.ACACIA_LOG, true);
      }
      set(bx, by + 1, bz, B.ACACIA_LOG, true);
      crowns.push([bx, by + 2, bz]);
    };
    const a0 = rnd() * Math.PI * 2;
    lean(a0, 2 + Math.floor(rnd() * 2), y + straight - 1);
    if (rnd() < 0.6) lean(a0 + Math.PI * (0.7 + rnd() * 0.6), 1 + Math.floor(rnd() * 2), y + straight - 2);
    for (const [cx, cy, cz] of crowns) {
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const d = Math.abs(dx) + Math.abs(dz);
        if (d <= 4 && !(Math.abs(dx) === 3 && Math.abs(dz) === 3)) set(cx + dx, cy, cz + dz, B.ACACIA_LEAVES);
        if (d <= 2) set(cx + dx, cy + 1, cz + dz, B.ACACIA_LEAVES);
      }
    }
  }

  // dark oak: a thick, short 2x2 trunk under a dense, flat, overlapping canopy
  darkOak(set, x, y, z, rnd) {
    const height = 5 + Math.floor(rnd() * 3);
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
      set(x + dx, y - 1, z + dz, B.DIRT, true);
      for (let k = 0; k < height; k++) set(x + dx, y + k, z + dz, B.DARK_OAK_LOG, true);
    }
    const topY = y + height;
    const cx = x + 0.5, cz = z + 0.5;
    for (let dy = -2; dy <= 1; dy++) {
      const r = dy === -2 ? 3.6 : dy === -1 ? 4.4 : dy === 0 ? 3.8 : 2.2;
      const ir = Math.ceil(r) + 1;
      for (let dz = -ir; dz <= ir + 1; dz++) for (let dx = -ir; dx <= ir + 1; dx++) {
        const d = Math.hypot(x + dx - cx, z + dz - cz);
        if (d < r - rnd() * 0.5) set(x + dx, topY + dy, z + dz, B.DARK_OAK_LEAVES);
      }
    }
    // a few stubby branches poking out of the canopy's underside
    for (let i = 0; i < 3; i++) {
      const a = rnd() * Math.PI * 2;
      const bx = Math.round(cx + Math.cos(a) * 2), bz = Math.round(cz + Math.sin(a) * 2);
      set(bx, topY - 2, bz, B.DARK_OAK_LOG, true);
      set(bx, topY - 1, bz, B.DARK_OAK_LOG, true);
    }
  }

  // cherry: a slender, bending trunk that forks into branches under round pink clouds
  cherryTree(set, x, y, z, rnd) {
    set(x, y - 1, z, B.DIRT, true);
    const height = 4 + Math.floor(rnd() * 3);
    for (let k = 0; k < height; k++) set(x, y + k, z, B.CHERRY_LOG, true);
    const forks = 2 + Math.floor(rnd() * 2);
    const a0 = rnd() * Math.PI * 2;
    for (let f = 0; f < forks; f++) {
      const ang = a0 + (f / forks) * Math.PI * 2 + rnd() * 0.6;
      const len = 2 + Math.floor(rnd() * 3);
      let bx = x, bz = z, by = y + height - 1 - Math.floor(rnd() * 2);
      for (let s = 1; s <= len; s++) {
        bx = Math.round(x + Math.cos(ang) * s);
        bz = Math.round(z + Math.sin(ang) * s);
        if (s > 1 || rnd() < 0.5) by++;
        set(bx, by, bz, B.CHERRY_LOG, true);
      }
      this.blob(set, bx, by + 1.5, bz, 3.0 + rnd() * 0.6, 1.9, 3.0 + rnd() * 0.6, B.CHERRY_LEAVES, rnd);
      // blossom hanging below the canopy's rim
      for (let i = 0; i < 4; i++) {
        const a = rnd() * Math.PI * 2;
        set(Math.round(bx + Math.cos(a) * 2.5), by, Math.round(bz + Math.sin(a) * 2.5), B.CHERRY_LEAVES);
      }
    }
  }

  // swamp oak: a broad, low crown with vines hanging off its edges
  swampOak(set, x, y, z, rnd) {
    const height = 5 + Math.floor(rnd() * 3);
    set(x, y - 1, z, B.DIRT, true);
    for (let k = 0; k < height; k++) set(x, y + k, z, B.OAK_LOG, true);
    const topY = y + height - 1;
    for (let dy = -1; dy <= 1; dy++) {
      const r = dy === 1 ? 2.2 : 3.4;
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
        if (Math.hypot(dx, dz) < r - rnd() * 0.4) set(x + dx, topY + dy, z + dz, B.OAK_LEAVES);
      }
    }
    for (let f = 0; f < 4; f++) {
      const [dx, dz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][f];
      for (let s = -2; s <= 2; s++) {
        if (rnd() > 0.45) continue;
        // the cell just outside the crown's edge, clinging back towards it
        const vx = x + dx * 4 + (dz !== 0 ? s : 0), vz = z + dz * 4 + (dx !== 0 ? s : 0);
        this.hangVine(set, vx, topY, vz, (f + 2) & 3, 2 + Math.floor(rnd() * 4));
      }
    }
  }

  // Somewhere good to start: next to the nearest village if there is one close by, else on open
  // land near the origin.
  findSpawn() {
    const v = this.structures.nearestVillage(0, 0, 900);
    if (v) {
      const c = {};
      for (let r = 0; r < 60; r += 3) {
        for (let a = 0; a < 8; a++) {
          const x = Math.round(v.x + Math.cos(a * Math.PI / 4) * (24 + r)), z = Math.round(v.z + Math.sin(a * Math.PI / 4) * (24 + r));
          this.column(x, z, c);
          if (c.height > SEA && c.biome !== BI.RIVER && c.biome !== BI.OCEAN && this.structures.treeFree(x, z)) return [x + 0.5, c.height + 1, z + 0.5];
        }
      }
    }
    const c = {};
    const good = new Set([BI.PLAINS, BI.FOREST, BI.BIRCH_FOREST, BI.CHERRY, BI.SAVANNA]);
    for (let r = 0; r < 4000; r += 16) {
      for (let a = 0; a < 8; a++) {
        const x = Math.round(Math.cos(a * Math.PI / 4) * r);
        const z = Math.round(Math.sin(a * Math.PI / 4) * r);
        this.column(x, z, c);
        if (c.height > SEA + 2 && c.height < SEA + 45 && good.has(c.biome)) return [x + 0.5, c.height + 1, z + 0.5];
      }
    }
    this.column(0, 0, c);
    return [0.5, Math.max(c.height, SEA) + 2, 0.5];
  }
}
