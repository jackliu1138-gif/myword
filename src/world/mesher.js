// Chunk lighting (flood-fill sky + block light) and mesh generation.
// Operates on a 48x48xH region made of the 3x3 chunk neighbourhood so that light and
// face culling across chunk borders are exact.

import {
  CHUNK_SIZE, WORLD_HEIGHT, SHAPE, LAYER, BLOCKS, BLOCK, WAVE,
  IS_OPAQUE, LIGHT_OPACITY, EMISSION, SHAPE_OF, LAYER_OF, CULL_SELF, FACE_TEX, BOX_SHAPES, IS_BED, BED_PARTNER,
} from './blocks.js';
import { hash2 } from './noise.js';

const CS = CHUNK_SIZE;
const H = WORLD_HEIGHT;
const RW = CS * 3; // region width (x and z)
const RSZ = RW; // z stride
const RSY = RW * RW; // y stride
const REGION = RSY * H;

export const VERTEX_BYTES = 16;
// Vertex positions are stored in 1/16 block units plus this bias (2 blocks), so geometry that
// reaches past a chunk's corner (leaf cards) still fits the unsigned format.
export const POS_BIAS = 32;
// Per grass block that can carry 3D grass blades: x, y, z, variant, temperature, humidity, sky, block light.
export const GRASS_BYTES = 8;
const MAX_GRASS = CS * CS * 6;

// Per-block lookups for the mesher
const TINT_OF = new Uint8Array(256);
const WAVE_OF = new Uint8Array(256);
const MAT_OF = new Uint8Array(256);
const IS_LEAVES = new Uint8Array(256);
for (const d of BLOCKS) {
  TINT_OF[d.id] = d.tint;
  WAVE_OF[d.id] = d.wave;
  MAT_OF[d.id] = d.mat;
  IS_LEAVES[d.id] = d.wave === WAVE.LEAVES ? 1 : 0;
}

// Faces: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z. Corners in CCW order seen from outside,
// with texture coordinates (u, v) where v=0 is the top of the image.
const FACES = [
  { n: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], uv: [[0, 1], [1, 1], [1, 0], [0, 0]], tex: 2 },
  { n: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], uv: [[0, 1], [1, 1], [1, 0], [0, 0]], tex: 2 },
  { n: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], uv: [[0, 1], [1, 1], [1, 0], [0, 0]], tex: 0 },
  { n: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: [[0, 1], [1, 1], [1, 0], [0, 0]], tex: 1 },
  { n: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], uv: [[0, 1], [1, 1], [1, 0], [0, 0]], tex: 2 },
  { n: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], uv: [[0, 1], [1, 1], [1, 0], [0, 0]], tex: 2 },
];

const roff = (dx, dy, dz) => dx + dz * RSZ + dy * RSY;
// For each face and vertex: region offsets of [outside, side1, side2, corner]
const FACE_OFFS = new Int32Array(6 * 4 * 4);
const FACE_NOFF = new Int32Array(6);
FACES.forEach((f, fi) => {
  const [nx, ny, nz] = f.n;
  FACE_NOFF[fi] = roff(nx, ny, nz);
  const axis = nx ? 0 : ny ? 1 : 2;
  const tangents = [0, 1, 2].filter((a) => a !== axis);
  f.corners.forEach((c, vi) => {
    const d1 = [0, 0, 0], d2 = [0, 0, 0];
    d1[tangents[0]] = c[tangents[0]] ? 1 : -1;
    d2[tangents[1]] = c[tangents[1]] ? 1 : -1;
    const base = (fi * 4 + vi) * 4;
    FACE_OFFS[base] = roff(nx, ny, nz);
    FACE_OFFS[base + 1] = roff(nx + d1[0], ny + d1[1], nz + d1[2]);
    FACE_OFFS[base + 2] = roff(nx + d2[0], ny + d2[1], nz + d2[2]);
    FACE_OFFS[base + 3] = roff(nx + d1[0] + d2[0], ny + d1[1] + d2[1], nz + d1[2] + d2[2]);
  });
});

// ---------- growable vertex buffers ----------
class VertexBuffer {
  constructor(bytes = 1 << 20) {
    this.buf = new ArrayBuffer(bytes);
    this.u8 = new Uint8Array(this.buf);
    this.u16 = new Uint16Array(this.buf);
    this.count = 0;
  }
  reset() { this.count = 0; }
  ensure(n) {
    const need = (this.count + n) * VERTEX_BYTES;
    if (need <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < need) size *= 2;
    const nb = new ArrayBuffer(size);
    new Uint8Array(nb).set(this.u8.subarray(0, this.count * VERTEX_BYTES));
    this.buf = nb;
    this.u8 = new Uint8Array(nb);
    this.u16 = new Uint16Array(nb);
  }
  // x,y,z in 1/16 block units relative to the chunk origin
  push(x, y, z, u, v, layer, faceFlags, aoFlags, sky, block, temp, hum) {
    const i = this.count++;
    const o16 = i * 8, o8 = i * 16;
    this.u16[o16] = x + POS_BIAS; this.u16[o16 + 1] = y + POS_BIAS; this.u16[o16 + 2] = z + POS_BIAS;
    const b = this.u8;
    b[o8 + 6] = u; b[o8 + 7] = v; b[o8 + 8] = layer; b[o8 + 9] = faceFlags;
    b[o8 + 10] = aoFlags; b[o8 + 11] = sky; b[o8 + 12] = block; b[o8 + 13] = temp;
    b[o8 + 14] = hum; b[o8 + 15] = 0;
  }
  take() {
    return this.buf.slice(0, this.count * VERTEX_BYTES);
  }
}

// ---------- the mesher ----------
export class ChunkMesher {
  constructor(generator) {
    this.gen = generator;
    this.blocks = new Uint8Array(REGION);
    this.sky = new Uint8Array(REGION);
    this.blk = new Uint8Array(REGION);
    this.queue = new Int32Array(1 << 19);
    this.buffers = [new VertexBuffer(1 << 21), new VertexBuffer(1 << 20), new VertexBuffer(1 << 18)];
    this.climate = new Uint8Array(CS * CS * 2);
    this.grass = new Uint8Array(MAX_GRASS * GRASS_BYTES);
    this.grassCount = 0;
    this.options = { fancyLeaves: true };
  }

  // chunks: array of 9 Uint8Arrays, index (dz+1)*3 + (dx+1)
  loadRegion(chunks) {
    const R = this.blocks;
    for (let n = 0; n < 9; n++) {
      const src = chunks[n];
      const ox = (n % 3) * CS, oz = Math.floor(n / 3) * CS;
      if (!src) {
        // missing neighbour: treat as solid below sea level, air above, so borders look sane
        for (let y = 0; y < H; y++) {
          const fill = y < 40 ? BLOCK.STONE : 0;
          for (let z = 0; z < CS; z++) R.fill(fill, ox + (oz + z) * RSZ + y * RSY, ox + (oz + z) * RSZ + y * RSY + CS);
        }
        continue;
      }
      for (let y = 0; y < H; y++) {
        for (let z = 0; z < CS; z++) {
          const s = (y << 8) | (z << 4);
          R.set(src.subarray(s, s + CS), ox + (oz + z) * RSZ + y * RSY);
        }
      }
    }
  }

  computeLight() {
    const R = this.blocks, sky = this.sky, blk = this.blk, q = this.queue;
    const QM = q.length - 1;
    sky.fill(0);
    blk.fill(0);
    let head = 0, tail = 0;

    // --- sky light: straight down, attenuated by semi-transparent blocks
    const topOpaque = new Int16Array(RW * RW);
    for (let z = 0; z < RW; z++) {
      for (let x = 0; x < RW; x++) {
        let level = 15;
        let top = -1;
        let i = x + z * RSZ + (H - 1) * RSY;
        for (let y = H - 1; y >= 0; y--, i -= RSY) {
          const op = LIGHT_OPACITY[R[i]];
          if (op) {
            if (top < 0) top = y;
            level = op >= 15 ? 0 : Math.max(0, level - op);
            if (level === 0) break;
          }
          sky[i] = level;
        }
        topOpaque[x + z * RW] = top;
      }
    }
    // seeds: lit cells next to columns that are taller than them
    for (let z = 0; z < RW; z++) {
      for (let x = 0; x < RW; x++) {
        let maxN = -1;
        if (x > 0) maxN = Math.max(maxN, topOpaque[x - 1 + z * RW]);
        if (x < RW - 1) maxN = Math.max(maxN, topOpaque[x + 1 + z * RW]);
        if (z > 0) maxN = Math.max(maxN, topOpaque[x + (z - 1) * RW]);
        if (z < RW - 1) maxN = Math.max(maxN, topOpaque[x + (z + 1) * RW]);
        const own = topOpaque[x + z * RW];
        const yMax = Math.min(H - 1, maxN);
        for (let y = Math.max(0, own - 15); y <= yMax; y++) {
          const i = x + z * RSZ + y * RSY;
          if (sky[i] > 1) { q[tail] = i; tail = (tail + 1) & QM; }
        }
      }
    }
    this.flood(sky, head, tail);

    // --- block light from emitters
    head = 0; tail = 0;
    for (let i = 0; i < REGION; i++) {
      const e = EMISSION[R[i]];
      if (e) { blk[i] = e; q[tail] = i; tail = (tail + 1) & QM; }
    }
    if (tail) this.flood(blk, head, tail);
  }

  flood(L, head, tail) {
    const R = this.blocks, q = this.queue, QM = q.length - 1;
    while (head !== tail) {
      const i = q[head]; head = (head + 1) & QM;
      const level = L[i];
      if (level <= 1) continue;
      const x = i % RW;
      const rest = (i - x) / RW;
      const z = rest % RW;
      const y = (rest - z) / RW;
      // 6 neighbours
      if (x > 0) { const j = i - 1; const op = LIGHT_OPACITY[R[j]]; if (op < 15) { const nl = level - (op || 1); if (nl > L[j]) { L[j] = nl; q[tail] = j; tail = (tail + 1) & QM; } } }
      if (x < RW - 1) { const j = i + 1; const op = LIGHT_OPACITY[R[j]]; if (op < 15) { const nl = level - (op || 1); if (nl > L[j]) { L[j] = nl; q[tail] = j; tail = (tail + 1) & QM; } } }
      if (z > 0) { const j = i - RSZ; const op = LIGHT_OPACITY[R[j]]; if (op < 15) { const nl = level - (op || 1); if (nl > L[j]) { L[j] = nl; q[tail] = j; tail = (tail + 1) & QM; } } }
      if (z < RW - 1) { const j = i + RSZ; const op = LIGHT_OPACITY[R[j]]; if (op < 15) { const nl = level - (op || 1); if (nl > L[j]) { L[j] = nl; q[tail] = j; tail = (tail + 1) & QM; } } }
      if (y > 0) { const j = i - RSY; const op = LIGHT_OPACITY[R[j]]; if (op < 15) { const nl = level - (op || 1); if (nl > L[j]) { L[j] = nl; q[tail] = j; tail = (tail + 1) & QM; } } }
      if (y < H - 1) { const j = i + RSY; const op = LIGHT_OPACITY[R[j]]; if (op < 15) { const nl = level - (op || 1); if (nl > L[j]) { L[j] = nl; q[tail] = j; tail = (tail + 1) & QM; } } }
    }
  }

  computeClimate(cx, cz) {
    const R = this.blocks;
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const wx = cx * CS + x, wz = cz * CS + z;
        let t = 0.3, h = 0.3;
        if (this.gen) {
          [t, h] = this.gen.climate(wx, wz);
          // altitude cools things down (use the column's top)
          let y = H - 1;
          const base = x + CS + (z + CS) * RSZ;
          while (y > 0 && !IS_OPAQUE[R[base + y * RSY]]) y--;
          t -= Math.max(0, y - 70) * 0.012;
        }
        this.climate[(z * CS + x) * 2] = Math.round(Math.max(0, Math.min(1, t * 0.5 + 0.5)) * 255);
        this.climate[(z * CS + x) * 2 + 1] = Math.round(Math.max(0, Math.min(1, h * 0.5 + 0.5)) * 255);
      }
    }
  }

  // Build meshes for the centre chunk. Returns transferable buffers.
  // options.fancyLeaves adds leaf cards that break up the cube outline of tree canopies.
  mesh(cx, cz, chunks, options) {
    if (options) this.options = { ...this.options, ...options };
    this.loadRegion(chunks);
    this.computeLight();
    this.computeClimate(cx, cz);
    const R = this.blocks;
    for (const b of this.buffers) b.reset();
    this.grassCount = 0;
    let minY = H, maxY = 0;

    for (let y = 0; y < H; y++) {
      for (let z = 0; z < CS; z++) {
        for (let x = 0; x < CS; x++) {
          const ri = (x + CS) + (z + CS) * RSZ + y * RSY;
          const b = R[ri];
          if (b === 0) continue;
          const shape = SHAPE_OF[b];
          const ci = (z * CS + x) * 2;
          const temp = this.climate[ci], hum = this.climate[ci + 1];
          let emitted = false;
          if (shape === SHAPE.CUBE || shape === SHAPE.CACTUS) {
            emitted = this.cube(ri, b, x, y, z, temp, hum, shape === SHAPE.CACTUS);
            if (b === BLOCK.GRASS && y < H - 1) this.grassSpot(ri, x, y, z, temp, hum);
          } else if (shape === SHAPE.LIQUID) {
            emitted = this.liquid(ri, b, x, y, z, temp, hum);
          } else if (shape === SHAPE.CROSS) {
            this.cross(ri, b, x, y, z, temp, hum);
            emitted = true;
          } else if (shape === SHAPE.TORCH) {
            this.torch(ri, b, x, y, z);
            emitted = true;
          } else if (shape === SHAPE.BOXES) {
            const boxes = BOX_SHAPES[b];
            for (const bx of boxes) this.box(ri, b, x, y, z, bx.b, bx.top, bx.bottom, bx.side, bx.faces, false, temp, hum);
            emitted = true;
          } else if (shape === SHAPE.BED) {
            this.bed(ri, b, x, y, z, temp, hum);
            emitted = true;
          }
          if (emitted) {
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
    }
    // packed light of the centre chunk (sky << 4 | block) for gameplay queries on the main thread
    const light = new Uint8Array(CS * CS * H);
    for (let y = 0; y < H; y++) {
      for (let z = 0; z < CS; z++) {
        const ro = CS + (z + CS) * RSZ + y * RSY;
        const lo = (y << 8) | (z << 4);
        for (let x = 0; x < CS; x++) light[lo | x] = (this.sky[ro + x] << 4) | this.blk[ro + x];
      }
    }
    return {
      cx, cz, light,
      opaque: this.buffers[0].take(),
      cutout: this.buffers[1].take(),
      translucent: this.buffers[2].take(),
      grass: this.grass.slice(0, this.grassCount * GRASS_BYTES).buffer,
      grassCount: this.grassCount,
      minY: minY === H ? 0 : minY,
      maxY: minY === H ? 0 : maxY + 1,
    };
  }

  cube(ri, b, x, y, z, temp, hum, isCactus) {
    const R = this.blocks, sky = this.sky, blk = this.blk;
    const layer = LAYER_OF[b];
    const buf = this.buffers[layer];
    const opaque = IS_OPAQUE[b];
    const leaves = IS_LEAVES[b];
    const tint = TINT_OF[b], wave = WAVE_OF[b], mat = MAT_OF[b];
    let any = false;
    for (let f = 0; f < 6; f++) {
      if (f === 3 && y === 0) continue;
      let n;
      if (f === 2 && y === H - 1) n = 0;
      else n = R[ri + FACE_NOFF[f]];
      if (IS_OPAQUE[n]) continue;
      if (n === b && CULL_SELF[b]) continue;
      if (opaque === 0 && !leaves && n === b) continue;
      if (isCactus && (f === 2 || f === 3) && n === b) continue;
      any = true;
      const face = FACES[f];
      const tex = FACE_TEX[b * 4 + face.tex];
      buf.ensure(4);
      const ao = [0, 0, 0, 0];
      const sl = [0, 0, 0, 0];
      const bl = [0, 0, 0, 0];
      for (let v = 0; v < 4; v++) {
        const base = (f * 4 + v) * 4;
        const o = ri + FACE_OFFS[base];
        if (f === 2 && y === H - 1) { ao[v] = 3; sl[v] = 255; bl[v] = 0; continue; }
        const s1 = ri + FACE_OFFS[base + 1], s2 = ri + FACE_OFFS[base + 2], cc = ri + FACE_OFFS[base + 3];
        const o1 = IS_OPAQUE[R[s1]], o2 = IS_OPAQUE[R[s2]], oc = IS_OPAQUE[R[cc]];
        ao[v] = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
        let s = sky[o], k = blk[o], cnt = 1;
        if (!o1) { s += sky[s1]; k += blk[s1]; cnt++; }
        if (!o2) { s += sky[s2]; k += blk[s2]; cnt++; }
        if (!oc && (!o1 || !o2)) { s += sky[cc]; k += blk[cc]; cnt++; }
        // light of the block itself for non-opaque blocks (leaves/glass)
        if (!opaque) { s = Math.max(s, sky[ri] * cnt); k = Math.max(k, blk[ri] * cnt); }
        sl[v] = Math.round((s / cnt) * 17);
        bl[v] = Math.round((k / cnt) * 17);
      }
      const flip = ao[0] + ao[2] > ao[1] + ao[3];
      const faceFlags = f | (wave << 3) | (tint << 5);
      for (let k = 0; k < 4; k++) {
        const v = flip ? (k + 1) & 3 : k;
        const c = face.corners[v];
        const uv = face.uv[v];
        let px = (x + c[0]) * 16, py = (y + c[1]) * 16, pz = (z + c[2]) * 16;
        if (isCactus) {
          if (f === 0) px -= 1; else if (f === 1) px += 1;
          else if (f === 4) pz -= 1; else if (f === 5) pz += 1;
        }
        buf.push(px, py, pz, uv[0] * 16, uv[1] * 16, tex, faceFlags, ao[v] | (c[1] ? 4 : 0) | (mat << 3), sl[v], bl[v], temp, hum);
      }
    }
    if (leaves && this.options.fancyLeaves && this.exposedToAir(ri)) this.leafCards(ri, b, x, y, z, temp, hum);
    return any;
  }

  exposedToAir(ri) {
    const R = this.blocks;
    for (let f = 0; f < 6; f++) if (R[ri + FACE_NOFF[f]] === 0) return true;
    return false;
  }

  // A grass block open to the sky above (or under a plant) gets a patch of 3D blades.
  grassSpot(ri, x, y, z, temp, hum) {
    const above = this.blocks[ri + RSY];
    if (above !== 0 && SHAPE_OF[above] !== SHAPE.CROSS) return;
    if (this.grassCount >= MAX_GRASS) return;
    const o = this.grassCount++ * GRASS_BYTES;
    const g = this.grass;
    g[o] = x; g[o + 1] = y; g[o + 2] = z;
    g[o + 3] = above ? 1 : 0; // a flower or fern here: fewer blades
    g[o + 4] = temp; g[o + 5] = hum;
    // light levels 0..15 scaled to bytes like the vertex light
    g[o + 6] = this.sky[ri + RSY] * 17; g[o + 7] = this.blk[ri + RSY] * 17;
  }

  // Two crossed, slightly tilted cards per exposed leaf block, reaching past the block so canopies
  // read as foliage rather than cubes.
  leafCards(ri, b, x, y, z, temp, hum) {
    const buf = this.buffers[LAYER.CUTOUT];
    const tex = FACE_TEX[b * 4 + 2];
    const s = Math.round(this.sky[ri] * 17), k = Math.round(this.blk[ri] * 17);
    const tint = TINT_OF[b], wave = WAVE_OF[b], mat = MAT_OF[b];
    const faceFlags = 2 | (wave << 3) | (tint << 5);
    const h1 = hash2(x * 31 + y * 7, z * 17 - y * 3, 99), h2 = hash2(z * 23 + y, x * 13 + y * 5, 77), h3 = hash2(x + z * 5, y * 11, 55);
    const cxp = x * 16 + 8 + (h1 - 0.5) * 4, cyp = y * 16 + 8 + (h3 - 0.5) * 3, czp = z * 16 + 8 + (h2 - 0.5) * 4;
    const yaw = h1 * Math.PI;
    const half = 11.5, halfH = 10.5;
    buf.ensure(16);
    for (let p = 0; p < 2; p++) {
      const a = yaw + p * Math.PI / 2;
      const dx = Math.cos(a) * half, dz = Math.sin(a) * half;
      // tilt the card a little around its horizontal axis
      const tilt = (p ? h2 : h3) - 0.5;
      const tx = -Math.sin(a) * tilt * 6, tz = Math.cos(a) * tilt * 6;
      const q = [
        [cxp - dx - tx, cyp - halfH, czp - dz - tz, 0, 16], [cxp + dx - tx, cyp - halfH, czp + dz - tz, 16, 16],
        [cxp + dx + tx, cyp + halfH, czp + dz + tz, 16, 0], [cxp - dx + tx, cyp + halfH, czp - dz + tz, 0, 0],
      ];
      // both windings so back-face culling can stay on
      for (const order of [[0, 1, 2, 3], [1, 0, 3, 2]]) {
        for (const vi of order) {
          const v = q[vi];
          buf.push(Math.round(v[0]), Math.round(v[1]), Math.round(v[2]), v[3], v[4], tex, faceFlags, 3 | (vi >= 2 ? 4 : 0) | (mat << 3), s, k, temp, hum);
        }
      }
    }
  }

  liquid(ri, b, x, y, z, temp, hum) {
    const R = this.blocks, sky = this.sky, blk = this.blk;
    const layer = LAYER_OF[b];
    const buf = this.buffers[layer];
    const above = y < H - 1 ? R[ri + RSY] : 0;
    const topH = above === b ? 16 : 14;
    const wave = WAVE_OF[b], tint = TINT_OF[b], mat = MAT_OF[b];
    let any = false;
    for (let f = 0; f < 6; f++) {
      if (f === 3 && y === 0) continue;
      const n = f === 2 && y === H - 1 ? 0 : R[ri + FACE_NOFF[f]];
      if (n === b) continue;
      if (IS_OPAQUE[n]) continue;
      any = true;
      const face = FACES[f];
      const tex = FACE_TEX[b * 4 + face.tex];
      buf.ensure(4);
      const o = ri + FACE_NOFF[f];
      const s = Math.round(Math.max(sky[o], sky[ri]) * 17);
      const k = Math.round(Math.max(blk[o], blk[ri]) * 17);
      const faceFlags = f | (wave << 3) | (tint << 5);
      for (let v = 0; v < 4; v++) {
        const c = face.corners[v];
        const uv = face.uv[v];
        const top = c[1] === 1;
        const py = y * 16 + (top ? topH : 0);
        const tv = f === 2 || f === 3 ? uv[1] * 16 : top ? 16 - topH : 16;
        buf.push((x + c[0]) * 16, py, (z + c[2]) * 16, uv[0] * 16, tv, tex,
          faceFlags, 3 | (top && topH < 16 ? 4 : 0) | (mat << 3), s, k, temp, hum);
      }
    }
    return any;
  }

  cross(ri, b, x, y, z, temp, hum) {
    const buf = this.buffers[LAYER.CUTOUT];
    const tex = FACE_TEX[b * 4 + 2];
    const s = Math.round(this.sky[ri] * 17), k = Math.round(this.blk[ri] * 17);
    const wx = x, wz = z;
    // deterministic jitter so fields of grass look natural
    const hx = hash2(wx * 7 + y, wz * 13 - y, 1234);
    const hz = hash2(wz * 5 + y, wx * 11 + y, 4321);
    const ox = Math.round((hx - 0.5) * 6), oz = Math.round((hz - 0.5) * 6);
    const tint = TINT_OF[b], wave = WAVE_OF[b], mat = MAT_OF[b];
    const faceFlags = 2 | (wave << 3) | (tint << 5); // lit as if facing up
    const x0 = x * 16 + ox, z0 = z * 16 + oz, y0 = y * 16;
    const lo = 2, hi = 14;
    buf.ensure(16);
    // two crossed planes, each emitted with both windings so back-face culling can stay on
    const quads = [
      [[lo, lo], [hi, hi]], [[hi, hi], [lo, lo]],
      [[lo, hi], [hi, lo]], [[hi, lo], [lo, hi]],
    ];
    for (let q = 0; q < 4; q++) {
      const [[ax, az], [bx, bz]] = quads[q];
      const u0 = q & 1 ? 16 : 0, u1 = 16 - u0;
      buf.push(x0 + ax, y0, z0 + az, u0, 16, tex, faceFlags, 2 | (mat << 3), s, k, temp, hum);
      buf.push(x0 + bx, y0, z0 + bz, u1, 16, tex, faceFlags, 2 | (mat << 3), s, k, temp, hum);
      buf.push(x0 + bx, y0 + 16, z0 + bz, u1, 0, tex, faceFlags, 3 | 4 | (mat << 3), s, k, temp, hum);
      buf.push(x0 + ax, y0 + 16, z0 + az, u0, 0, tex, faceFlags, 3 | 4 | (mat << 3), s, k, temp, hum);
    }
  }

  // One axis-aligned box inside the cell, bounds in 1/16 block units. Faces on the cell's boundary
  // are skipped against opaque neighbours (and against the same block when it culls itself, or the
  // other half of a bed for mattresses: joined).
  box(ri, b, x, y, z, bb, texTop, texBottom, texSide, faces, joined, temp, hum) {
    const R = this.blocks, sky = this.sky, blk = this.blk;
    const buf = this.buffers[LAYER_OF[b]];
    const tint = TINT_OF[b], wave = WAVE_OF[b], mat = MAT_OF[b];
    const [x0, y0, z0, x1, y1, z1] = bb;
    const lo = [x0, y0, z0], hi = [x1, y1, z1];
    for (let f = 0; f < 6; f++) {
      if (!(faces & (1 << f))) continue;
      const face = FACES[f];
      const axis = face.n[0] ? 0 : face.n[1] ? 1 : 2;
      const pos = face.n[axis] > 0 ? hi[axis] === 16 : lo[axis] === 0;
      const o = ri + FACE_NOFF[f];
      if (pos) {
        if (f === 3 && y === 0) continue;
        const n = f === 2 && y === H - 1 ? 0 : R[o];
        if (IS_OPAQUE[n]) continue;
        if (n === b && CULL_SELF[b]) continue;
        if (joined && IS_BED[n]) continue;
      }
      const tex = f === 2 ? texTop : f === 3 ? texBottom : texSide;
      const s = Math.round(Math.max(sky[o], sky[ri]) * 17);
      const k = Math.round(Math.max(blk[o], blk[ri]) * 17);
      const faceFlags = f | (wave << 3) | (tint << 5);
      buf.ensure(4);
      for (let v = 0; v < 4; v++) {
        const c = face.corners[v];
        const px = c[0] ? x1 : x0, py = c[1] ? y1 : y0, pz = c[2] ? z1 : z0;
        // texture coordinates from the position on the face, so partial boxes show part of the texture
        let u, w;
        if (f === 0) { u = 16 - pz; w = 16 - py; } else if (f === 1) { u = pz; w = 16 - py; }
        else if (f === 2) { u = px; w = pz; } else if (f === 3) { u = px; w = 16 - pz; }
        else if (f === 4) { u = px; w = 16 - py; } else { u = 16 - px; w = 16 - py; }
        buf.push(x * 16 + px, y * 16 + py, z * 16 + pz, u, w, tex, faceFlags, 3 | (c[1] ? 4 : 0) | (mat << 3), s, k, temp, hum);
      }
    }
  }

  // A bed half: a mattress on short legs, with a pillow on the head half. It finds its other half
  // among its four neighbours to know which way it points.
  bed(ri, b, x, y, z, temp, hum) {
    const R = this.blocks;
    const partner = BED_PARTNER[b];
    const head = BLOCKS[b].bed.head;
    // direction from this half towards the head end
    let dx = 0, dz = -1;
    for (const [ox, oz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      if (R[ri + ox + oz * RSZ] === partner) { dx = head ? -ox : ox; dz = head ? -oz : oz; break; }
    }
    // canonical boxes point their head end towards -Z; turn them to (dx, dz)
    const turn = (bb) => {
      const pts = [[bb[0], bb[2]], [bb[3], bb[5]]].map(([px, pz]) => {
        if (dx === 1) return [16 - pz, px];
        if (dx === -1) return [pz, 16 - px];
        if (dz === 1) return [16 - px, 16 - pz];
        return [px, pz];
      });
      return [Math.min(pts[0][0], pts[1][0]), bb[1], Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), bb[4], Math.max(pts[0][1], pts[1][1])];
    };
    const wool = FACE_TEX[b * 4];
    const plank = FACE_TEX[BLOCK.OAK_PLANKS * 4];
    const white = FACE_TEX[BLOCK.WHITE_WOOL * 4];
    this.box(ri, b, x, y, z, turn([0, 3, 0, 16, 9, 16]), wool, plank, wool, 63, true, temp, hum);
    const legs = head ? [[0, 0, 0, 3, 3, 3], [13, 0, 0, 16, 3, 3]] : [[0, 0, 13, 3, 3, 16], [13, 0, 13, 16, 3, 16]];
    for (const l of legs) this.box(ri, b, x, y, z, turn(l), plank, plank, plank, 63 & ~(1 << 2), false, temp, hum);
    if (head) this.box(ri, b, x, y, z, turn([2, 9, 1, 14, 11, 7]), white, white, white, 63 & ~(1 << 3), false, temp, hum);
  }

  torch(ri, b, x, y, z) {
    const buf = this.buffers[LAYER.CUTOUT];
    const tex = FACE_TEX[b * 4 + 2];
    const s = Math.round(this.sky[ri] * 17), k = Math.round(this.blk[ri] * 17);
    const mat = MAT_OF[b];
    const X = x * 16, Y = y * 16, Z = z * 16;
    const x0 = X + 7, x1 = X + 9, z0 = Z + 7, z1 = Z + 9, y1 = Y + 10;
    buf.ensure(48);
    const push = (px, py, pz, u, v, f) => buf.push(px, py, pz, u, v, tex, f, 3 | (mat << 3), s, k, 128, 128);
    // four sides of the stick (texture columns 7..9, rows 6..16)
    // +X
    push(x1, Y, z1, 7, 16, 0); push(x1, Y, z0, 9, 16, 0); push(x1, y1, z0, 9, 6, 0); push(x1, y1, z1, 7, 6, 0);
    // -X
    push(x0, Y, z0, 7, 16, 1); push(x0, Y, z1, 9, 16, 1); push(x0, y1, z1, 9, 6, 1); push(x0, y1, z0, 7, 6, 1);
    // +Z
    push(x0, Y, z1, 7, 16, 4); push(x1, Y, z1, 9, 16, 4); push(x1, y1, z1, 9, 6, 4); push(x0, y1, z1, 7, 6, 4);
    // -Z
    push(x1, Y, z0, 7, 16, 5); push(x0, Y, z0, 9, 16, 5); push(x0, y1, z0, 9, 6, 5); push(x1, y1, z0, 7, 6, 5);
    // top cap (flame base colour)
    push(x0, y1, z1, 7, 7, 2); push(x1, y1, z1, 9, 7, 2); push(x1, y1, z0, 9, 6, 2); push(x0, y1, z0, 7, 6, 2);
    // flame: two crossed quads from y 10/16 to 14/16 using texture rows 2..6, columns 6..10
    const fy0 = Y + 9, fy1 = Y + 14;
    const c = X + 8, d = Z + 8;
    push(c - 2, fy0, d - 2, 6, 7, 2); push(c + 2, fy0, d + 2, 10, 7, 2); push(c + 2, fy1, d + 2, 10, 2, 2); push(c - 2, fy1, d - 2, 6, 2, 2);
    push(c + 2, fy0, d + 2, 10, 7, 2); push(c - 2, fy0, d - 2, 6, 7, 2); push(c - 2, fy1, d - 2, 6, 2, 2); push(c + 2, fy1, d + 2, 10, 2, 2);
    push(c - 2, fy0, d + 2, 6, 7, 2); push(c + 2, fy0, d - 2, 10, 7, 2); push(c + 2, fy1, d - 2, 10, 2, 2); push(c - 2, fy1, d + 2, 6, 2, 2);
    push(c + 2, fy0, d - 2, 10, 7, 2); push(c - 2, fy0, d + 2, 6, 7, 2); push(c - 2, fy1, d + 2, 6, 2, 2); push(c + 2, fy1, d - 2, 10, 2, 2);
  }
}

export const REGION_WIDTH = RW;
