// Terrain for the other two dimensions, and the generator a world uses for its dimension.
//  - The Nether: netherrack caverns between a bedrock floor and ceiling, a lava sea, soul sand and
//    gravel shores, glowstone hanging from the roof, quartz and ancient debris in the rock, and
//    nether brick fortresses whose bridges cross the caverns (blazes live there).
//  - The End: one big end stone island floating in the void, ten obsidian pillars around its
//    centre, the bedrock exit fountain in the middle, an obsidian landing platform off its edge,
//    and small islands far out.

import { Simplex, hash2, hash3, mulberry32 } from './noise.js';
import { BLOCK, CHUNK_SIZE, WORLD_HEIGHT } from './blocks.js';
import { TerrainGenerator, BIOME } from './generator.js';

export const DIM = { OVERWORLD: 0, NETHER: 1, END: 2 };
export const DIM_NAMES = ['overworld', 'nether', 'end'];

const H = WORLD_HEIGHT;
const CS = CHUNK_SIZE;
const B = BLOCK;
const idx = (x, y, z) => (y << 8) | (z << 4) | x;
const smooth = (e0, e1, x) => { let t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

export function createGenerator(seed, dimension = 0) {
  if (dimension === DIM.NETHER) return new NetherGenerator(seed);
  if (dimension === DIM.END) return new EndGenerator(seed);
  return new TerrainGenerator(seed);
}

// Writes blocks of a structure that may cross chunk borders: only the part inside this chunk.
function chunkWriter(blocks, cx, cz) {
  const x0 = cx * CS, z0 = cz * CS;
  return (wx, y, wz, b) => {
    const x = wx - x0, z = wz - z0;
    if (x < 0 || x >= CS || z < 0 || z >= CS || y < 1 || y >= H - 1) return;
    blocks[idx(x, y, z)] = b;
  };
}

// ---------------------------------------------------------------------------------- the Nether
export const NETHER_LAVA = 31;
const FORTRESS_CELL = 176;
const FORTRESS_Y = 66;

export class NetherGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    this.dimension = DIM.NETHER;
    const s = this.seed ^ 0x3e7;
    this.n1 = new Simplex(s ^ 0x1111);
    this.n2 = new Simplex(s ^ 0x2222);
    this.n3 = new Simplex(s ^ 0x3333);
    this.nPatch = new Simplex(s ^ 0x4444);
  }

  climate() { return [1.2, -1]; }
  tintClimate() { return [255, 0]; }
  column() { return { height: 64, hf: 64, biome: BIOME.DESERT, temp: 2, hum: -1, mountain: 0, river: 0, cont: 0 }; }
  caveEntrance() { return false; }

  // fortress centre for a grid cell, or null
  fortressIn(gx, gz) {
    if (hash2(gx, gz, this.seed ^ 0xf07) > 0.55) return null;
    const x = gx * FORTRESS_CELL + 40 + Math.floor(hash2(gx, gz, this.seed ^ 0xf08) * (FORTRESS_CELL - 80));
    const z = gz * FORTRESS_CELL + 40 + Math.floor(hash2(gx, gz, this.seed ^ 0xf09) * (FORTRESS_CELL - 80));
    return { x, y: FORTRESS_Y, z, arm: 36 + Math.floor(hash2(gx, gz, this.seed ^ 0xf0a) * 20) };
  }

  // fortresses whose bridges come within `r` of (x, z)
  fortressesNear(x, z, r = 64) {
    const out = [];
    const g0x = Math.floor((x - r - 60) / FORTRESS_CELL), g1x = Math.floor((x + r + 60) / FORTRESS_CELL);
    const g0z = Math.floor((z - r - 60) / FORTRESS_CELL), g1z = Math.floor((z + r + 60) / FORTRESS_CELL);
    for (let gz = g0z; gz <= g1z; gz++) for (let gx = g0x; gx <= g1x; gx++) {
      const f = this.fortressIn(gx, gz);
      if (!f) continue;
      const dx = Math.max(0, Math.abs(x - f.x) - (Math.abs(z - f.z) < 4 ? f.arm : 5));
      const dz = Math.max(0, Math.abs(z - f.z) - (Math.abs(x - f.x) < 4 ? f.arm : 5));
      if (Math.min(Math.hypot(x - f.x, z - f.z), Math.hypot(dx, dz)) < r + f.arm) out.push(f);
    }
    return out;
  }

  generateChunk(cx, cz) {
    const blocks = new Uint8Array(CS * CS * H);
    const x0 = cx * CS, z0 = cz * CS;
    // density on a coarse 4 x 8 x 4 grid, interpolated
    const GX = 5, GY = (H >> 3) + 1, GZ = 5;
    const grid = new Float32Array(GX * GY * GZ);
    for (let gy = 0; gy < GY; gy++) {
      const y = gy * 8;
      // solid near the floor and the roof, open caverns between
      const shape = 1.25 * (1 - smooth(8, 34, y)) + 1.3 * smooth(98, 124, y) - 0.34;
      for (let gz = 0; gz < GZ; gz++) {
        for (let gx = 0; gx < GX; gx++) {
          const wx = x0 + gx * 4, wz = z0 + gz * 4;
          const n = this.n1.noise3(wx * 0.013, y * 0.022, wz * 0.013) * 0.72 + this.n2.noise3(wx * 0.04, y * 0.06, wz * 0.04) * 0.3;
          grid[(gy * GZ + gz) * GX + gx] = n + shape;
        }
      }
    }
    const dens = (x, y, z) => {
      const fx = x / 4, fy = y / 8, fz = z / 4;
      const ix = Math.min(GX - 2, fx | 0), iy = Math.min(GY - 2, fy | 0), iz = Math.min(GZ - 2, fz | 0);
      const tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const g = (a, b, c) => grid[((iy + b) * GZ + (iz + c)) * GX + (ix + a)];
      const c00 = g(0, 0, 0) + (g(1, 0, 0) - g(0, 0, 0)) * tx, c10 = g(0, 1, 0) + (g(1, 1, 0) - g(0, 1, 0)) * tx;
      const c01 = g(0, 0, 1) + (g(1, 0, 1) - g(0, 0, 1)) * tx, c11 = g(0, 1, 1) + (g(1, 1, 1) - g(0, 1, 1)) * tx;
      const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty;
      return c0 + (c1 - c0) * tz;
    };
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const wx = x0 + x, wz = z0 + z;
        const floor = 1 + Math.floor(hash2(wx, wz, this.seed ^ 0xb1) * 4);
        const roof = H - 2 - Math.floor(hash2(wx, wz, this.seed ^ 0xb2) * 4);
        for (let y = 0; y < H; y++) {
          let b;
          if (y <= floor || y >= roof) b = B.BEDROCK;
          else b = dens(x, y, z) > 0 ? B.NETHERRACK : y <= NETHER_LAVA ? B.LAVA : 0;
          blocks[idx(x, y, z)] = b;
        }
      }
    }
    this.decorate(blocks, cx, cz);
    // fortresses last, so their bridges cut through the rock
    for (const f of this.fortressesNear(x0 + 8, z0 + 8, 16)) this.fortress(blocks, cx, cz, f);
    return blocks;
  }

  decorate(blocks, cx, cz) {
    const x0 = cx * CS, z0 = cz * CS;
    const rand = mulberry32(hash2(cx, cz, this.seed ^ 0x9e7) * 4294967296);
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const wx = x0 + x, wz = z0 + z;
        const patch = this.nPatch.noise2(wx * 0.03, wz * 0.03);
        for (let y = 2; y < H - 6; y++) {
          const i = idx(x, y, z);
          const b = blocks[i];
          if (b !== B.NETHERRACK) continue;
          const above = blocks[i + 256], below = blocks[i - 256];
          // shores of the lava sea: soul sand and gravel; magma along the lava
          if (above === 0 && y >= NETHER_LAVA - 2 && y <= NETHER_LAVA + 12) {
            if (patch > 0.35) { blocks[i] = B.SOUL_SAND; if (blocks[i - 256] === B.NETHERRACK) blocks[i - 256] = B.SOUL_SAND; }
            else if (patch < -0.5) blocks[i] = B.GRAVEL;
          }
          if ((above === B.LAVA || below === B.LAVA) && hash3(wx, y, wz, this.seed) < 0.18) blocks[i] = B.MAGMA_BLOCK;
          // eternal fires dotting the cavern floors
          if (above === 0 && blocks[i + 512] === 0 && hash3(wx, y, wz, this.seed ^ 0xf1) < 0.004) blocks[i + 256] = B.FIRE;
          // glowstone hanging from the roof
          if (below === 0 && y > 60 && hash3(wx, y, wz, this.seed ^ 0x610) < 0.012) {
            const n = 2 + Math.floor(hash3(wx, y, wz, this.seed ^ 0x611) * 5);
            for (let k = 1; k <= n; k++) {
              const j = i - 256 * k;
              if (blocks[j] !== 0) break;
              blocks[j] = B.GLOWSTONE;
              for (const d of [1, -1, 16, -16]) {
                const lx = x + (d === 1 ? 1 : d === -1 ? -1 : 0), lz = z + (d === 16 ? 1 : d === -16 ? -1 : 0);
                if (lx >= 0 && lx < CS && lz >= 0 && lz < CS && blocks[j + d] === 0 && rand() < 0.45) blocks[j + d] = B.GLOWSTONE;
              }
            }
          }
        }
      }
    }
    // quartz veins and ancient debris
    const vein = (block, count, size, minY, maxY) => {
      for (let v = 0; v < count; v++) {
        let x = rand() * CS, y = minY + rand() * (maxY - minY), z = rand() * CS;
        for (let k = 0; k < size; k++) {
          const ix = x | 0, iy = y | 0, iz = z | 0;
          if (ix >= 0 && ix < CS && iz >= 0 && iz < CS && iy > 0 && iy < H) {
            const i = idx(ix, iy, iz);
            if (blocks[i] === B.NETHERRACK) blocks[i] = block;
          }
          x += rand() * 2 - 1; y += rand() * 2 - 1; z += rand() * 2 - 1;
        }
      }
    };
    vein(B.NETHER_QUARTZ_ORE, 12, 6, 10, 118);
    vein(B.ANCIENT_DEBRIS, 1, 2, 8, 24);
    if (rand() < 0.5) vein(B.ANCIENT_DEBRIS, 1, 1, 8, 110);
  }

  // A fortress: two long bridges of nether brick crossing at a walled courtyard, on pillars.
  fortress(blocks, cx, cz, f) {
    const set = chunkWriter(blocks, cx, cz);
    const y = f.y;
    const deck = (x, z) => {
      set(x, y, z, B.NETHER_BRICKS);
      set(x, y - 1, z, B.NETHER_BRICKS);
      for (let k = 1; k <= 4; k++) set(x, y + k, z, 0);
    };
    for (let a = -f.arm; a <= f.arm; a++) {
      for (let w = -2; w <= 2; w++) { deck(f.x + a, f.z + w); deck(f.x + w, f.z + a); }
      // railings
      for (const w of [-3, 3]) {
        set(f.x + a, y, f.z + w, B.NETHER_BRICKS); set(f.x + a, y + 1, f.z + w, B.NETHER_BRICKS);
        set(f.x + w, y, f.z + a, B.NETHER_BRICKS); set(f.x + w, y + 1, f.z + a, B.NETHER_BRICKS);
      }
      // pillars down to the rock every 9 blocks
      if (a % 9 === 0 && Math.abs(a) > 6) {
        for (const [px, pz] of [[f.x + a, f.z], [f.x, f.z + a]]) {
          for (let yy = y - 2; yy > 4; yy--) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) set(px + dx, yy, pz + dz, B.NETHER_BRICKS);
        }
      }
    }
    // the courtyard in the middle: a walled room with windows
    for (let dx = -7; dx <= 7; dx++) {
      for (let dz = -7; dz <= 7; dz++) {
        const edge = Math.abs(dx) === 7 || Math.abs(dz) === 7;
        set(f.x + dx, y, f.z + dz, B.NETHER_BRICKS);
        set(f.x + dx, y - 1, f.z + dz, B.NETHER_BRICKS);
        for (let k = 1; k <= 6; k++) {
          const door = Math.abs(dx) <= 1 || Math.abs(dz) <= 1;
          set(f.x + dx, y + k, f.z + dz, edge && !(door && k <= 3) && !(k === 3 && (dx + dz) % 3 === 0) ? B.NETHER_BRICKS : 0);
        }
        set(f.x + dx, y + 7, f.z + dz, B.NETHER_BRICKS);
      }
    }
    for (let yy = y - 2; yy > 4; yy--) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) set(f.x + dx, yy, f.z + dz, B.NETHER_BRICKS);
    // light
    for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) set(f.x + dx, y + 1, f.z + dz, B.GLOWSTONE);
  }

  findSpawn() { return [0.5, 64, 0.5]; }
}

// ---------------------------------------------------------------------------------- the End
export const END_SURFACE = 60;
export const END_PLATFORM = [100, 49, 0];
export const END_PILLARS = 10;

export class EndGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    this.dimension = DIM.END;
    const s = this.seed ^ 0xe7d;
    this.n1 = new Simplex(s ^ 0x1234);
    this.n2 = new Simplex(s ^ 0x5678);
    this.pillarList = null;
  }

  climate() { return [0, 0]; }
  tintClimate() { return [128, 128]; }
  column() { return { height: END_SURFACE, hf: END_SURFACE, biome: BIOME.PLAINS, temp: 0.5, hum: 0, mountain: 0, river: 0, cont: 0 }; }
  caveEntrance() { return false; }

  // the island's edge distance at an angle, and its top height at (x, z)
  radiusAt(ang) {
    return 78 + this.n1.noise2(Math.cos(ang) * 1.6, Math.sin(ang) * 1.6) * 12;
  }

  // the ten obsidian pillars: [x, z, radius, top y]
  pillars() {
    if (this.pillarList) return this.pillarList;
    const rand = mulberry32((this.seed ^ 0x9111) >>> 0);
    const heights = [];
    for (let i = 0; i < END_PILLARS; i++) heights.push(76 + i * 3);
    for (let i = heights.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [heights[i], heights[j]] = [heights[j], heights[i]]; }
    this.pillarList = heights.map((top, i) => {
      const a = (i / END_PILLARS) * Math.PI * 2;
      return [Math.round(Math.cos(a) * 42), Math.round(Math.sin(a) * 42), 2 + ((top - 76) / 3 | 0) % 3, top];
    });
    return this.pillarList;
  }

  // where the dragon perches and the exit portal opens
  fountainTop() { return END_SURFACE + 1; }

  generateChunk(cx, cz) {
    const blocks = new Uint8Array(CS * CS * H);
    const x0 = cx * CS, z0 = cz * CS;
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const wx = x0 + x, wz = z0 + z;
        const d = Math.hypot(wx, wz);
        const R = this.radiusAt(Math.atan2(wz, wx));
        if (d < R) {
          // a flat top, a deep rounded underside
          const top = END_SURFACE + Math.round(this.n2.noise2(wx * 0.03, wz * 0.03) * 1.5 * smooth(R, R * 0.6, d));
          const depth = Math.sqrt(Math.max(0, 1 - (d / R) ** 2)) * 46 + this.n1.noise2(wx * 0.08, wz * 0.08) * 3;
          for (let y = Math.max(1, Math.floor(top - depth)); y <= top; y++) blocks[idx(x, y, z)] = B.END_STONE;
        } else if (d > 260) {
          // far islands on a coarse grid
          const gx = Math.floor(wx / 96), gz = Math.floor(wz / 96);
          if (hash2(gx, gz, this.seed ^ 0x15) < 0.35) {
            const ix = gx * 96 + 20 + hash2(gx, gz, this.seed ^ 0x16) * 56, iz = gz * 96 + 20 + hash2(gx, gz, this.seed ^ 0x17) * 56;
            const ir = 7 + hash2(gx, gz, this.seed ^ 0x18) * 12, iy = 50 + Math.floor(hash2(gx, gz, this.seed ^ 0x19) * 20);
            const dd = Math.hypot(wx - ix, wz - iz);
            if (dd < ir) {
              const depth = Math.sqrt(1 - (dd / ir) ** 2) * ir * 0.7;
              for (let y = Math.floor(iy - depth); y <= iy; y++) blocks[idx(x, y, z)] = B.END_STONE;
            }
          }
        }
      }
    }
    const set = chunkWriter(blocks, cx, cz);
    // obsidian pillars with a bedrock cap where the end crystal sits
    for (const [px, pz, r, top] of this.pillars()) {
      if (px + r < x0 || px - r > x0 + CS || pz + r < z0 || pz - r > z0 + CS) continue;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r + r) continue;
        for (let y = END_SURFACE - 12; y <= top; y++) set(px + dx, y, pz + dz, B.OBSIDIAN);
      }
      set(px, top + 1, pz, B.BEDROCK);
    }
    // the exit fountain: a bedrock bowl around a bedrock pillar
    if (Math.abs(x0 + 8) < 24 && Math.abs(z0 + 8) < 24) {
      const y0 = END_SURFACE;
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.hypot(dx, dz);
        if (d > 3.6) continue;
        set(dx, y0, dz, B.BEDROCK);
        set(dx, y0 + 1, dz, d > 2.5 ? B.BEDROCK : 0);
        for (let k = 2; k <= 5; k++) set(dx, y0 + k, dz, 0);
      }
      for (let k = 1; k <= 4; k++) set(0, y0 + k, 0, B.BEDROCK);
    }
    // the landing platform off the island's edge
    const [px, py, pz] = END_PLATFORM;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      set(px + dx, py - 1, pz + dz, B.OBSIDIAN);
      for (let k = 0; k < 3; k++) set(px + dx, py + k, pz + dz, 0);
    }
    return blocks;
  }

  findSpawn() { return [END_PLATFORM[0] + 0.5, END_PLATFORM[1], END_PLATFORM[2] + 0.5]; }
}
