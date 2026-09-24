// Chunk storage, streaming around the player, and the generation/meshing worker pool.

import { CHUNK_SIZE, WORLD_HEIGHT, BLOCK, IS_SOLID, IS_LIQUID, BLOCKS } from './blocks.js';
import { TerrainGenerator } from './generator.js';
import { ChunkMesher } from './mesher.js';

const CS = CHUNK_SIZE;
const H = WORLD_HEIGHT;

export const chunkKey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

function createWorker() {
  const src = globalThis.__LUMEN_WORKER_SRC__;
  if (src) {
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    return new Worker(url);
  }
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}

class WorkerPool {
  constructor(seed, count, onResult) {
    this.onResult = onResult;
    this.workers = [];
    this.inflight = [];
    this.fallback = null;
    this.localQueue = [];
    try {
      for (let i = 0; i < count; i++) {
        const w = createWorker();
        w.onmessage = (e) => {
          this.inflight[i]--;
          this.onResult(e.data);
        };
        w.onerror = (e) => {
          console.warn('Worker failed, falling back to main thread', e.message || e);
          this.useFallback(seed);
        };
        w.postMessage({ type: 'init', seed });
        this.workers.push(w);
        this.inflight.push(0);
      }
    } catch (err) {
      console.warn('Workers unavailable, generating on the main thread', err);
      this.useFallback(seed);
    }
    this.seed = seed;
  }

  useFallback(seed) {
    if (this.fallback) return;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.inflight = [];
    const gen = new TerrainGenerator(seed);
    this.fallback = { gen, mesher: new ChunkMesher(gen) };
    // anything that was in flight is lost; the world re-requests pending chunks
    this.lost = true;
  }

  get capacity() {
    if (this.fallback) return Math.max(0, 2 - this.localQueue.length);
    let free = 0;
    for (const n of this.inflight) free += Math.max(0, 2 - n);
    return free;
  }

  submit(msg, transfer) {
    if (this.fallback) {
      this.localQueue.push(msg);
      return;
    }
    let best = 0;
    for (let i = 1; i < this.workers.length; i++) if (this.inflight[i] < this.inflight[best]) best = i;
    this.inflight[best]++;
    this.workers[best].postMessage(msg, transfer);
  }

  // Main-thread fallback: process queued jobs within a time budget.
  pump(budgetMs) {
    if (!this.fallback) return;
    const t0 = performance.now();
    while (this.localQueue.length && performance.now() - t0 < budgetMs) {
      const msg = this.localQueue.shift();
      if (msg.type === 'gen') {
        this.onResult({ id: msg.id, type: 'gen', cx: msg.cx, cz: msg.cz, blocks: this.fallback.gen.generateChunk(msg.cx, msg.cz) });
      } else if (msg.type === 'mesh') {
        const m = this.fallback.mesher.mesh(msg.cx, msg.cz, msg.chunks);
        m.type = 'mesh';
        m.version = msg.version;
        this.onResult(m);
      }
    }
  }

  terminate() {
    for (const w of this.workers) w.terminate();
  }
}

class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.key = chunkKey(cx, cz);
    this.blocks = null;
    this.genRequested = false;
    this.version = 0; // bumps on every block change
    this.meshedVersion = -1;
    this.meshInFlight = false;
    this.urgent = false;
    this.gpu = null; // owned by the chunk renderer
  }
}

export class World {
  constructor(seed, { renderDistance = 8, workers = 3, edits = null } = {}) {
    this.seed = seed;
    this.generator = new TerrainGenerator(seed);
    this.chunks = new Map();
    this.edits = edits || new Map(); // chunkKey -> Map(index -> id)
    this.renderDistance = renderDistance;
    this.meshQueue = []; // results waiting for upload
    this.pool = new WorkerPool(seed, workers, (r) => this.onResult(r));
    this.jobId = 0;
    this.lastCx = null;
    this.lastCz = null;
    this.onChunkUnload = null;
    this.stats = { generated: 0, meshed: 0 };
    this._last = null;
    this.pendingFluids = [];
  }

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz));
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= H) return 0;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    let c = this._last;
    if (!c || c.cx !== cx || c.cz !== cz) {
      c = this.chunks.get(chunkKey(cx, cz));
      if (!c) return 0;
      this._last = c;
    }
    if (!c.blocks) return 0;
    return c.blocks[(y << 8) | ((z - cz * CS) << 4) | (x - cx * CS)];
  }

  // Sky light (0..15) and block light (0..15) at a position, from the last mesh of that chunk.
  getLight(x, y, z) {
    if (y >= H) return [15, 0];
    if (y < 0) return [0, 0];
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c || !c.light) return [15, 0];
    const v = c.light[(y << 8) | ((z - cz * CS) << 4) | (x - cx * CS)];
    return [v >> 4, v & 15];
  }

  // For collision: unloaded chunks count as solid so the player can't fall through the world.
  isSolidAt(x, y, z) {
    if (y < 0) return true;
    if (y >= H) return false;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c || !c.blocks) return true;
    return IS_SOLID[c.blocks[(y << 8) | ((z - cz * CS) << 4) | (x - cx * CS)]] === 1;
  }

  isChunkReady(x, z) {
    const c = this.getChunk(Math.floor(x / CS), Math.floor(z / CS));
    return !!(c && c.blocks && c.gpu);
  }

  setBlock(x, y, z, id, { record = true } = {}) {
    if (y < 0 || y >= H) return false;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.getChunk(cx, cz);
    if (!c || !c.blocks) return false;
    const lx = x - cx * CS, lz = z - cz * CS;
    const i = (y << 8) | (lz << 4) | lx;
    if (c.blocks[i] === id) return false;
    c.blocks[i] = id;
    if (record) {
      let e = this.edits.get(c.key);
      if (!e) { e = new Map(); this.edits.set(c.key, e); }
      e.set(i, id);
      this.dirtyEdits = true;
    }
    // Remesh this chunk urgently; neighbours too (light and face culling cross borders).
    c.version++;
    c.urgent = true;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const n = this.getChunk(cx + dx, cz + dz);
        if (!n || !n.blocks) continue;
        // only neighbours within light range of the change
        const near = (dx === -1 ? lx <= 14 : dx === 1 ? lx >= 1 : true) && (dz === -1 ? lz <= 14 : dz === 1 ? lz >= 1 : true);
        if (!near) continue;
        n.version++;
        if ((dx === -1 && lx === 0) || (dx === 1 && lx === CS - 1) || (dz === -1 && lz === 0) || (dz === 1 && lz === CS - 1)) n.urgent = true;
      }
    }
    if (id === 0) this.scheduleFluid(x, y, z);
    return true;
  }

  // When a block next to water is removed, water flows into the gap (one step, bounded).
  scheduleFluid(x, y, z) {
    const n = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
    for (const [dx, dy, dz] of n) {
      const b = this.getBlock(x + dx, y + dy, z + dz);
      if (IS_LIQUID[b]) {
        this.pendingFluids.push({ x, y, z, id: b, t: performance.now() + 250 });
        return;
      }
    }
  }

  updateFluids() {
    if (!this.pendingFluids.length) return;
    const now = performance.now();
    const keep = [];
    for (const f of this.pendingFluids) {
      if (f.t > now) { keep.push(f); continue; }
      if (this.getBlock(f.x, f.y, f.z) === 0) this.setBlock(f.x, f.y, f.z, f.id);
    }
    this.pendingFluids = keep;
  }

  onResult(r) {
    if (r.type === 'gen') {
      const c = this.getChunk(r.cx, r.cz);
      if (!c) return; // unloaded meanwhile
      c.blocks = r.blocks;
      const e = this.edits.get(c.key);
      if (e) for (const [i, id] of e) c.blocks[i] = id;
      this.stats.generated++;
    } else if (r.type === 'mesh') {
      const c = this.getChunk(r.cx, r.cz);
      if (!c || !c.blocks) return;
      c.meshInFlight = false;
      c.meshedVersion = r.version;
      if (r.light) c.light = r.light;
      this.meshQueue.push({ chunk: c, mesh: r });
      this.stats.meshed++;
    }
  }

  neighboursReady(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.getChunk(cx + dx, cz + dz);
        if (!n || !n.blocks) return false;
      }
    }
    return true;
  }

  requestMesh(c) {
    const chunks = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) chunks.push(this.getChunk(c.cx + dx, c.cz + dz).blocks.slice());
    }
    c.meshInFlight = true;
    c.urgent = false;
    this.pool.submit({ type: 'mesh', id: ++this.jobId, cx: c.cx, cz: c.cz, version: c.version, chunks }, chunks.map((a) => a.buffer));
  }

  // Stream chunks around (px, pz). viewDir is used to prioritise what's in front.
  update(px, pz, viewX = 0, viewZ = 1) {
    if (this.pool.lost) {
      this.pool.lost = false;
      for (const c of this.chunks.values()) {
        if (!c.blocks) c.genRequested = false;
        c.meshInFlight = false;
      }
    }
    const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS);
    const R = this.renderDistance;
    const genR = R + 1;

    // create chunk slots in range
    if (pcx !== this.lastCx || pcz !== this.lastCz || this.chunks.size === 0) {
      this.lastCx = pcx;
      this.lastCz = pcz;
      for (let dz = -genR; dz <= genR; dz++) {
        for (let dx = -genR; dx <= genR; dx++) {
          if (dx * dx + dz * dz > (genR + 0.5) * (genR + 0.5)) continue;
          const k = chunkKey(pcx + dx, pcz + dz);
          if (!this.chunks.has(k)) this.chunks.set(k, new Chunk(pcx + dx, pcz + dz));
        }
      }
      // unload far chunks
      const unloadR = genR + 2;
      for (const [k, c] of this.chunks) {
        const dx = c.cx - pcx, dz = c.cz - pcz;
        if (dx * dx + dz * dz > unloadR * unloadR) {
          if (this.onChunkUnload) this.onChunkUnload(c);
          this.chunks.delete(k);
          if (this._last === c) this._last = null;
        }
      }
    }

    let capacity = this.pool.capacity;
    const score = (c) => {
      const dx = c.cx + 0.5 - px / CS, dz = c.cz + 0.5 - pz / CS;
      const d = Math.sqrt(dx * dx + dz * dz);
      const facing = d > 0.5 ? (dx * viewX + dz * viewZ) / d : 1;
      return d - facing * 1.5;
    };

    // urgent remeshes first (player edits)
    if (capacity > 0) {
      for (const c of this.chunks.values()) {
        if (capacity <= 0) break;
        if (c.urgent && c.blocks && !c.meshInFlight && c.version !== c.meshedVersion && this.neighboursReady(c.cx, c.cz)) {
          this.requestMesh(c);
          capacity--;
        }
      }
    }
    if (capacity > 0) {
      const genList = [];
      const meshList = [];
      for (const c of this.chunks.values()) {
        const dx = c.cx - pcx, dz = c.cz - pcz;
        const d2 = dx * dx + dz * dz;
        if (!c.blocks) {
          if (!c.genRequested && d2 <= (genR + 0.5) * (genR + 0.5)) genList.push(c);
        } else if (!c.meshInFlight && c.version !== c.meshedVersion && d2 <= (R + 0.5) * (R + 0.5)) {
          meshList.push(c);
        }
      }
      meshList.sort((a, b) => score(a) - score(b));
      genList.sort((a, b) => score(a) - score(b));
      // interleave: meshes for ready chunks take priority over far generation
      let gi = 0, mi = 0;
      while (capacity > 0 && (gi < genList.length || mi < meshList.length)) {
        const m = meshList[mi];
        if (m && this.neighboursReady(m.cx, m.cz) && (gi >= genList.length || score(m) <= score(genList[gi]) + 1)) {
          this.requestMesh(m);
          mi++;
          capacity--;
          continue;
        }
        if (m && !this.neighboursReady(m.cx, m.cz)) { mi++; continue; }
        const g = genList[gi++];
        if (!g) continue;
        g.genRequested = true;
        this.pool.submit({ type: 'gen', id: ++this.jobId, cx: g.cx, cz: g.cz });
        capacity--;
      }
    }
    this.pool.pump(8);
    this.updateFluids();
  }

  // Serialisable edits for saving
  serializeEdits() {
    const out = {};
    for (const [k, m] of this.edits) out[k] = Array.from(m.entries()).flat();
    return out;
  }

  static deserializeEdits(obj) {
    const edits = new Map();
    if (!obj) return edits;
    for (const k of Object.keys(obj)) {
      const arr = obj[k];
      const m = new Map();
      for (let i = 0; i < arr.length; i += 2) m.set(arr[i], arr[i + 1]);
      edits.set(Number(k), m);
    }
    return edits;
  }

  dispose() {
    this.pool.terminate();
  }

  // Height of the highest solid (or liquid) block in a column, ignoring tree canopies.
  surfaceHeight(x, z, { skipFoliage = true } = {}) {
    for (let y = H - 1; y > 0; y--) {
      const b = this.getBlock(x, y, z);
      if (skipFoliage && (BLOCKS[b].wave === 1 || BLOCKS[b].key.endsWith('_log'))) continue;
      if (IS_SOLID[b] || IS_LIQUID[b]) return y;
    }
    return 0;
  }
}

export { BLOCK, BLOCKS };
