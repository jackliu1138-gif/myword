// Deterministic terrain generation: continents, mountains, rivers, biomes, caves, ores, trees.

import { Simplex, hash2, hash3, mulberry32 } from './noise.js';
import { BLOCK, CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from './blocks.js';

export const BIOME = {
  OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, BIRCH_FOREST: 4, TAIGA: 5, SNOWY: 6, DESERT: 7, MOUNTAINS: 8, RIVER: 9,
};
export const BIOME_NAMES = ['Ocean', 'Beach', 'Plains', 'Forest', 'Birch Forest', 'Taiga', 'Snowy Taiga', 'Desert', 'Mountains', 'River'];

const H = WORLD_HEIGHT;
const CS = CHUNK_SIZE;
const B = BLOCK;

const idx = (x, y, z) => (y << 8) | (z << 4) | x;

function smooth(e0, e1, x) {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

// piecewise linear spline
function spline(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1], [x1, y1] = points[i];
      const t = (x - x0) / (x1 - x0);
      const s = t * t * (3 - 2 * t);
      return y0 + (y1 - y0) * s;
    }
  }
  return points[points.length - 1][1];
}

const CONT_SPLINE = [
  [-1.0, 16], [-0.62, 26], [-0.44, 38], [-0.32, 46], [-0.24, 50], [-0.18, 52.5], [-0.04, 56], [0.22, 63], [0.6, 70], [1.0, 76],
];

const TREE_CELL = 5;

export class TerrainGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    const s = this.seed;
    this.nCont = new Simplex(s ^ 0x1234);
    this.nEro = new Simplex(s ^ 0x2345);
    this.nPeak = new Simplex(s ^ 0x3456);
    this.nHill = new Simplex(s ^ 0x4567);
    this.nTemp = new Simplex(s ^ 0x5678);
    this.nHum = new Simplex(s ^ 0x6789);
    this.nRiver = new Simplex(s ^ 0x789a);
    this.nCave = new Simplex(s ^ 0x89ab);
    this.nCave2 = new Simplex(s ^ 0x9abc);
    this.nCheese = new Simplex(s ^ 0xabcd);
    this.nOver = new Simplex(s ^ 0xbcde);
    this.nDetail = new Simplex(s ^ 0xcdef);
    this.nPatch = new Simplex(s ^ 0xdef0);
    this.col = {}; // scratch object reused by column()
  }

  climate(x, z) {
    const t = this.nTemp.fbm2(x * 0.00075, z * 0.00075, 3) * 1.25;
    const h = this.nHum.fbm2(x * 0.0009 + 71.3, z * 0.0009 - 33.1, 3) * 1.25;
    return [t, h];
  }

  // 2D column shape. Writes into and returns a scratch object.
  column(x, z, out = this.col) {
    const warpX = this.nDetail.noise2(x * 0.004, z * 0.004) * 40;
    const warpZ = this.nDetail.noise2(x * 0.004 + 50, z * 0.004 - 50) * 40;
    const wx = x + warpX, wz = z + warpZ;
    const cont = this.nCont.fbm2(wx * 0.0011, wz * 0.0011, 5) * 1.35;
    const ero = this.nEro.fbm2(wx * 0.0018 + 40.1, wz * 0.0018 - 7.7, 4) * 1.3;
    const peaks = this.nPeak.ridged2(wx * 0.0042, wz * 0.0042, 5);
    const hills = this.nHill.fbm2(x * 0.009, z * 0.009, 4);
    const detail = this.nDetail.fbm2(x * 0.045, z * 0.045, 2);

    let h = spline(CONT_SPLINE, cont);
    const inland = smooth(-0.22, 0.2, cont);
    const mountain = smooth(-0.12, 0.38, cont) * smooth(0.42, -0.32, ero);
    const hillAmp = (3 + 9 * smooth(-0.6, 0.6, -ero)) * (0.3 + 0.7 * inland);
    h += hills * hillAmp;
    h += mountain * Math.pow(peaks, 1.35) * 64;
    h += detail * 1.2;

    // rivers carve valleys through land
    const rv = Math.abs(this.nRiver.fbm2(x * 0.0017 + 11.1, z * 0.0017 + 5.3, 3));
    const riverW = 0.028 + 0.012 * this.nRiver.noise2(x * 0.01, z * 0.01);
    let river = 1 - smooth(riverW * 0.5, riverW * 2.2, rv);
    river *= smooth(-0.3, -0.14, cont) * (1 - mountain * 0.85);
    if (river > 0 && h > SEA_LEVEL - 3) {
      const bed = SEA_LEVEL - 3 - 2 * river;
      h = h + (bed - h) * smooth(0.0, 0.85, river);
    }

    if (h > 100) h = 100 + (h - 100) * 0.55;
    if (h > H - 8) h = H - 8;
    if (h < 6) h = 6;

    const [t0, hum] = this.climate(x, z);
    const temp = t0 - Math.max(0, h - SEA_LEVEL - 20) * 0.012;

    let biome;
    const height = Math.floor(h);
    if (height < SEA_LEVEL - 1) biome = river > 0.3 ? BIOME.RIVER : BIOME.OCEAN;
    else if (river > 0.45 && height <= SEA_LEVEL + 1) biome = BIOME.RIVER;
    else if (height <= SEA_LEVEL + 2 && cont < -0.12 && river < 0.2) biome = temp > 0.45 ? BIOME.DESERT : BIOME.BEACH;
    else if (mountain > 0.45 && height > 84) biome = BIOME.MOUNTAINS;
    else if (temp > 0.42 && hum < 0.1) biome = BIOME.DESERT;
    else if (temp < -0.42) biome = BIOME.SNOWY;
    else if (temp < -0.12) biome = BIOME.TAIGA;
    else if (hum > 0.22) biome = BIOME.FOREST;
    else if (hum > 0.02 && temp < 0.15) biome = BIOME.BIRCH_FOREST;
    else biome = BIOME.PLAINS;

    out.height = height;
    out.hf = h;
    out.biome = biome;
    out.temp = temp;
    out.hum = hum;
    out.mountain = mountain;
    out.river = river;
    out.cont = cont;
    return out;
  }

  // Climate bytes used by the mesher for biome tints (0..255).
  tintClimate(x, z) {
    const c = this.column(x, z);
    const t = Math.max(0, Math.min(1, c.temp * 0.5 + 0.5));
    const h = Math.max(0, Math.min(1, c.hum * 0.5 + 0.5));
    return [Math.round(t * 255), Math.round(h * 255)];
  }

  caveEntrance(x, z) {
    return this.nPatch.noise2(x * 0.012 + 300, z * 0.012 - 300) > 0.62;
  }

  generateChunk(cx, cz) {
    const blocks = new Uint8Array(CS * CS * H);
    const x0 = cx * CS, z0 = cz * CS;

    // Column data for chunk + 1 border (slopes)
    const R = CS + 2;
    const heights = new Int16Array(R * R);
    const colBiome = new Uint8Array(CS * CS);
    const colTemp = new Float32Array(CS * CS);
    const colMount = new Float32Array(CS * CS);
    const colRiver = new Float32Array(CS * CS);
    const c = {};
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
        }
      }
    }

    // ---- 1. base terrain + overhangs
    const top = new Int16Array(CS * CS);
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const ci = z * CS + x;
        const h = heights[(z + 1) * R + (x + 1)];
        const m = colMount[ci];
        const wx = x0 + x, wz = z0 + z;
        blocks[idx(x, 0, z)] = B.BEDROCK;
        for (let y = 1; y <= h; y++) {
          if (y < 4 && hash3(wx, y, wz, this.seed) < 0.55 - y * 0.12) blocks[idx(x, y, z)] = B.BEDROCK;
          else blocks[idx(x, y, z)] = B.STONE;
        }
        let colTop = h;
        if (m > 0.2) {
          // 3D noise for cliffs and overhangs around the surface
          const amp = (m - 0.2) * 1.6;
          const lo = Math.max(2, h - 14), hi = Math.min(H - 6, h + 12);
          for (let y = lo; y <= hi; y++) {
            const n = this.nOver.noise3(wx * 0.035, y * 0.05, wz * 0.035) + this.nOver.noise3(wx * 0.08, y * 0.1, wz * 0.08) * 0.35;
            const dens = (h - y) / 9 + n * amp;
            if (dens > 0) {
              blocks[idx(x, y, z)] = B.STONE;
              if (y > colTop) colTop = y;
            } else if (y <= h) blocks[idx(x, y, z)] = 0;
          }
        }
        top[ci] = colTop;
      }
    }

    // ---- 2. surface layers
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
        let depth = 0;
        for (let y = top[ci]; y > 0; y--) {
          const i = idx(x, y, z);
          const b = blocks[i];
          if (b === 0) { depth = 0; continue; }
          if (b !== B.STONE) continue;
          const exposedAbove = y === top[ci] || blocks[idx(x, y + 1, z)] === 0;
          if (exposedAbove) depth = 0;
          if (depth > 5) { depth++; continue; }
          const under = y < SEA_LEVEL; // surface under water
          let surf = B.GRASS, fill = B.DIRT, fillDepth = 3 + (hash2(wx, wz, this.seed) < 0.5 ? 1 : 0);
          switch (biome) {
            case BIOME.OCEAN:
              surf = hc < SEA_LEVEL - 12 ? B.GRAVEL : patch > 0.45 ? B.CLAY : B.SAND;
              fill = B.SAND;
              break;
            case BIOME.RIVER:
              surf = patch > 0.3 ? B.GRAVEL : patch < -0.5 ? B.CLAY : B.SAND;
              fill = B.SAND;
              break;
            case BIOME.BEACH:
              surf = B.SAND; fill = B.SAND; fillDepth = 4;
              break;
            case BIOME.DESERT:
              surf = B.SAND; fill = B.SAND; fillDepth = 4;
              break;
            case BIOME.SNOWY:
              surf = B.SNOWY_GRASS;
              break;
            case BIOME.MOUNTAINS:
              surf = y > 104 ? B.SNOW : slope >= 3 ? B.STONE : y > 96 ? (patch > 0 ? B.STONE : B.GRAVEL) : B.GRASS;
              if (surf === B.SNOW) fill = B.SNOW;
              break;
            default:
              break;
          }
          if (slope >= 4 && biome !== BIOME.OCEAN && biome !== BIOME.RIVER && biome !== BIOME.DESERT && biome !== BIOME.BEACH) {
            surf = y > 104 ? B.SNOW : slope >= 6 || patch > 0.2 ? B.STONE : B.GRAVEL;
            fill = surf === B.STONE ? B.STONE : B.DIRT;
          }
          if (under && (surf === B.GRASS || surf === B.SNOWY_GRASS)) surf = patch > 0.3 ? B.GRAVEL : B.DIRT;
          if (under && biome !== BIOME.OCEAN && biome !== BIOME.RIVER && y >= SEA_LEVEL - 3) surf = patch > 0.25 ? B.GRAVEL : B.SAND;
          if (!under && y <= SEA_LEVEL + 1 && biome !== BIOME.SNOWY && biome !== BIOME.MOUNTAINS && colRiver[ci] > 0.05) surf = B.SAND;

          if (depth === 0) blocks[i] = surf;
          else if (depth < fillDepth) blocks[i] = fill === B.GRASS ? B.DIRT : fill;
          else if (depth < fillDepth + 3 && (biome === BIOME.DESERT || biome === BIOME.BEACH) && fill === B.SAND) blocks[i] = B.SANDSTONE;
          depth++;
        }
      }
    }

    // ---- 3. caves (trilinear interpolated noise on a 4x4x4 grid)
    this.carveCaves(blocks, x0, z0, heights, R, colBiome);

    // ---- 4. water, ice, lava
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const ci = z * CS + x;
        const frozen = colBiome[ci] === BIOME.SNOWY || colTemp[ci] < -0.5;
        for (let y = SEA_LEVEL; y > 0; y--) {
          const i = idx(x, y, z);
          if (blocks[i] !== 0) break;
          blocks[i] = y === SEA_LEVEL && frozen ? B.ICE : B.WATER;
        }
      }
    }

    // ---- 5. ores
    this.placeOres(blocks, cx, cz);

    // ---- 6. trees & plants (may cross chunk borders)
    this.decorate(blocks, cx, cz, colBiome);

    return blocks;
  }

  carveCaves(blocks, x0, z0, heights, R, colBiome) {
    const GX = 5, GY = (H >> 2) + 1, GZ = 5;
    const grid = new Float32Array(GX * GY * GZ * 2);
    for (let gy = 0; gy < GY; gy++) {
      for (let gz = 0; gz < GZ; gz++) {
        for (let gx = 0; gx < GX; gx++) {
          const wx = x0 + gx * 4, wy = gy * 4, wz = z0 + gz * 4;
          const a = this.nCave.noise3(wx * 0.016, wy * 0.028, wz * 0.016);
          const b = this.nCave2.noise3(wx * 0.016, wy * 0.028, wz * 0.016);
          const tunnel = a * a + b * b;
          const cheese = this.nCheese.noise3(wx * 0.011, wy * 0.022, wz * 0.011) + this.nCheese.noise3(wx * 0.03, wy * 0.05, wz * 0.03) * 0.3;
          const gi = ((gy * GZ + gz) * GX + gx) * 2;
          grid[gi] = tunnel;
          grid[gi + 1] = cheese;
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
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const h = heights[(z + 1) * R + (x + 1)];
        const wx = x0 + x, wz = z0 + z;
        const underwater = h < SEA_LEVEL + 1;
        const entrance = !underwater && this.caveEntrance(wx, wz);
        const crust = underwater ? 6 : entrance ? -2 : 5;
        const maxY = Math.min(h - crust, H - 2);
        for (let y = 2; y <= maxY; y++) {
          const i = idx(x, y, z);
          const b = blocks[i];
          if (b === 0 || b === B.BEDROCK || b === B.WATER) continue;
          const tunnel = sample(x, y, z, 0);
          const depthFade = y < 12 ? 0.004 : 0;
          let carve = tunnel < 0.0075 + depthFade;
          if (!carve && y < 44) {
            const cheese = sample(x, y, z, 1);
            carve = cheese > 0.56 + (44 - y) * -0.002;
          }
          if (carve) blocks[i] = y <= 7 ? B.LAVA : 0;
        }
      }
    }
  }

  placeOres(blocks, cx, cz) {
    const rand = mulberry32(hash2(cx, cz, this.seed ^ 0x51ed) * 4294967296);
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
    vein(B.COAL_ORE, 14, 10, 6, 100);
    vein(B.IRON_ORE, 9, 7, 4, 64);
    vein(B.GOLD_ORE, 2, 6, 4, 32);
    vein(B.DIAMOND_ORE, 1, 5, 3, 16);
    vein(B.GRAVEL, 3, 14, 5, 90);
  }

  decorate(blocks, cx, cz, colBiome) {
    const x0 = cx * CS, z0 = cz * CS;
    const set = (wx, y, wz, b, replaceSolid = false) => {
      const x = wx - x0, z = wz - z0;
      if (x < 0 || x >= CS || z < 0 || z >= CS || y < 1 || y >= H) return;
      const i = idx(x, y, z);
      const cur = blocks[i];
      if (cur === 0 || cur === B.TALL_GRASS || cur === B.FERN || (replaceSolid && cur !== B.BEDROCK)) blocks[i] = b;
      else if (b !== B.OAK_LEAVES && b !== B.BIRCH_LEAVES && b !== B.SPRUCE_LEAVES && (cur === B.OAK_LEAVES || cur === B.BIRCH_LEAVES || cur === B.SPRUCE_LEAVES)) blocks[i] = b;
    };
    const c = {};
    // trees in cells overlapping the chunk plus margin
    const margin = 5;
    const cx0 = Math.floor((x0 - margin) / TREE_CELL), cx1 = Math.floor((x0 + CS + margin) / TREE_CELL);
    const cz0 = Math.floor((z0 - margin) / TREE_CELL), cz1 = Math.floor((z0 + CS + margin) / TREE_CELL);
    for (let tcz = cz0; tcz <= cz1; tcz++) {
      for (let tcx = cx0; tcx <= cx1; tcx++) {
        const r0 = hash2(tcx, tcz, this.seed ^ 0x7ee);
        const wx = tcx * TREE_CELL + Math.floor(hash2(tcx, tcz, this.seed ^ 0x7ef) * TREE_CELL);
        const wz = tcz * TREE_CELL + Math.floor(hash2(tcx, tcz, this.seed ^ 0x7f0) * TREE_CELL);
        this.column(wx, wz, c);
        if (c.height <= SEA_LEVEL || c.mountain > 0.3 || this.caveEntrance(wx, wz)) continue;
        const dens = [0, 0, 0.05, 0.85, 0.8, 0.72, 0.38, 0.14, 0.06, 0][c.biome];
        if (r0 >= dens) continue;
        // slope check (trees don't grow on cliffs)
        const hx = this.column(wx + 2, wz, {}).height, hz = this.column(wx, wz + 2, {}).height;
        if (Math.abs(hx - c.height) > 3 || Math.abs(hz - c.height) > 3) continue;
        const rnd = mulberry32(hash2(wx, wz, this.seed ^ 0xa11) * 4294967296);
        const y = c.height + 1;
        switch (c.biome) {
          case BIOME.DESERT:
            this.cactus(set, wx, y, wz, rnd);
            break;
          case BIOME.TAIGA:
          case BIOME.SNOWY:
            this.spruce(set, wx, y, wz, rnd);
            break;
          case BIOME.BIRCH_FOREST:
            if (rnd() < 0.85) this.oak(set, wx, y, wz, rnd, B.BIRCH_LOG, B.BIRCH_LEAVES, 5 + Math.floor(rnd() * 3));
            else this.oak(set, wx, y, wz, rnd, B.OAK_LOG, B.OAK_LEAVES, 4 + Math.floor(rnd() * 2));
            break;
          case BIOME.FOREST: {
            const r = rnd();
            if (r < 0.14) this.bigOak(set, wx, y, wz, rnd);
            else if (r < 0.34) this.oak(set, wx, y, wz, rnd, B.BIRCH_LOG, B.BIRCH_LEAVES, 5 + Math.floor(rnd() * 3));
            else this.oak(set, wx, y, wz, rnd, B.OAK_LOG, B.OAK_LEAVES, 4 + Math.floor(rnd() * 3));
            break;
          }
          case BIOME.MOUNTAINS:
            this.spruce(set, wx, y, wz, rnd);
            break;
          default:
            if (rnd() < 0.12) this.bigOak(set, wx, y, wz, rnd);
            else this.oak(set, wx, y, wz, rnd, B.OAK_LOG, B.OAK_LEAVES, 4 + Math.floor(rnd() * 3));
        }
      }
    }

    // ground plants inside this chunk
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const wx = x0 + x, wz = z0 + z;
        let y = H - 2;
        while (y > 0 && blocks[idx(x, y, z)] === 0) y--;
        const ground = blocks[idx(x, y, z)];
        if (y >= H - 2 || blocks[idx(x, y + 1, z)] !== 0) continue;
        const r = hash2(wx, wz, this.seed ^ 0x9a55);
        if (ground === B.GRASS) {
          c.biome = colBiome[z * CS + x];
          const fl = this.nPatch.noise2(wx * 0.03, wz * 0.03);
          let grassP = 0.18, flowerP = 0.01, fernP = 0;
          if (c.biome === BIOME.PLAINS) { grassP = 0.34; flowerP = fl > 0.25 ? 0.16 : 0.03; }
          else if (c.biome === BIOME.FOREST || c.biome === BIOME.BIRCH_FOREST) { grassP = 0.2; flowerP = fl > 0.4 ? 0.07 : 0.012; fernP = 0.04; }
          else if (c.biome === BIOME.TAIGA) { grassP = 0.08; fernP = 0.16; flowerP = 0.003; }
          else if (c.biome === BIOME.MOUNTAINS) { grassP = 0.12; }
          if (r < flowerP) {
            const kind = hash2(Math.floor(wx / 6), Math.floor(wz / 6), this.seed ^ 0xf10);
            blocks[idx(x, y + 1, z)] = kind < 0.45 ? B.POPPY : kind < 0.85 ? B.DANDELION : B.CORNFLOWER;
          } else if (r < flowerP + fernP) blocks[idx(x, y + 1, z)] = B.FERN;
          else if (r < flowerP + fernP + grassP) blocks[idx(x, y + 1, z)] = B.TALL_GRASS;
          else if (r > 0.9993 && c.biome === BIOME.PLAINS) blocks[idx(x, y + 1, z)] = B.PUMPKIN;
        } else if (ground === B.SAND) {
          c.biome = colBiome[z * CS + x];
          if (c.biome === BIOME.DESERT && r < 0.012) blocks[idx(x, y + 1, z)] = B.DEAD_BUSH;
        } else if (ground === B.SNOWY_GRASS) {
          if (r < 0.03) blocks[idx(x, y + 1, z)] = B.FERN;
        }
      }
    }
  }

  oak(set, x, y, z, rnd, log, leaves, height) {
    set(x, y - 1, z, B.DIRT, true);
    for (let k = 0; k < height; k++) set(x, y + k, z, log, true);
    const topY = y + height - 1;
    for (let dy = -2; dy <= 1; dy++) {
      const r = dy >= 0 ? 1 : 2;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const corner = Math.abs(dx) === r && Math.abs(dz) === r;
          if (corner && (dy === 1 || rnd() < 0.5)) continue;
          if (dy === 1 && r === 1 && corner) continue;
          set(x + dx, topY + dy, z + dz, leaves);
        }
      }
    }
    set(x, topY + 1, z, leaves);
  }

  bigOak(set, x, y, z, rnd) {
    const height = 7 + Math.floor(rnd() * 4);
    set(x, y - 1, z, B.DIRT, true);
    for (let k = 0; k < height; k++) set(x, y + k, z, B.OAK_LOG, true);
    const blobs = [[x, y + height, z, 3.2]];
    const branches = 2 + Math.floor(rnd() * 3);
    for (let b = 0; b < branches; b++) {
      const ang = rnd() * Math.PI * 2;
      const len = 2 + rnd() * 2;
      const by = y + height - 2 - Math.floor(rnd() * 3);
      let bx = x, bz = z;
      for (let s = 1; s <= len; s++) {
        bx = Math.round(x + Math.cos(ang) * s);
        bz = Math.round(z + Math.sin(ang) * s);
        set(bx, by + Math.floor(s / 2), bz, B.OAK_LOG, true);
      }
      blobs.push([bx, by + Math.floor(len / 2) + 1, bz, 2.3 + rnd() * 0.6]);
    }
    for (const [bx, by, bz, r] of blobs) {
      const ri = Math.ceil(r);
      for (let dy = -ri + 1; dy <= ri - 1; dy++) {
        for (let dz = -ri; dz <= ri; dz++) {
          for (let dx = -ri; dx <= ri; dx++) {
            const d = Math.sqrt(dx * dx + dy * dy * 1.7 + dz * dz);
            if (d < r - rnd() * 0.6) set(bx + dx, by + dy, bz + dz, B.OAK_LEAVES);
          }
        }
      }
    }
  }

  spruce(set, x, y, z, rnd) {
    const height = 7 + Math.floor(rnd() * 5);
    set(x, y - 1, z, B.DIRT, true);
    for (let k = 0; k < height - 1; k++) set(x, y + k, z, B.SPRUCE_LOG, true);
    const topY = y + height;
    set(x, topY, z, B.SPRUCE_LEAVES);
    set(x, topY - 1, z, B.SPRUCE_LEAVES);
    let r = 0;
    for (let yy = topY - 2; yy >= y + 2; yy--) {
      const layer = topY - 2 - yy;
      r = layer % 2 === 0 ? Math.min(1 + Math.floor(layer / 3), 3) : Math.max(1, Math.min(Math.floor(layer / 3), 2));
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) + Math.abs(dz) > r + (r > 1 ? 1 : 0)) continue;
          if (dx === 0 && dz === 0) continue;
          set(x + dx, yy, z + dz, B.SPRUCE_LEAVES);
        }
      }
    }
  }

  cactus(set, x, y, z, rnd) {
    const h = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < h; k++) set(x, y + k, z, B.CACTUS);
  }

  // Find a good spawn position near the origin: on land, not in water.
  findSpawn() {
    const c = {};
    for (let r = 0; r < 4000; r += 16) {
      for (let a = 0; a < 8; a++) {
        const x = Math.round(Math.cos(a * Math.PI / 4) * r);
        const z = Math.round(Math.sin(a * Math.PI / 4) * r);
        this.column(x, z, c);
        if (c.height > SEA_LEVEL + 2 && c.height < 90 && c.biome !== BIOME.OCEAN && c.biome !== BIOME.RIVER &&
            (c.biome === BIOME.PLAINS || c.biome === BIOME.FOREST || c.biome === BIOME.BIRCH_FOREST)) {
          return [x + 0.5, c.height + 1, z + 0.5];
        }
      }
    }
    this.column(0, 0, c);
    return [0.5, Math.max(c.height, SEA_LEVEL) + 2, 0.5];
  }
}
