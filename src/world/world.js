// Chunk storage, streaming around the player, and the generation/meshing worker pool.

import { CHUNK_SIZE, WORLD_HEIGHT, BLOCK, IS_SOLID, IS_LIQUID, BLOCKS, COLLIDE_KIND, TALL_COLLIDE, collisionBoxes, layerTop } from './blocks.js';
import { ChunkMesher } from './mesher.js';
import { createGenerator, generate } from './dimensions.js';
import { Fluids } from './fluids.js';

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
  constructor(seed, count, onResult, dimension = 0, genVersion = 1) {
    this.dimension = dimension;
    this.genVersion = genVersion;
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
        w.postMessage({ type: 'init', seed, dimension, gen: genVersion });
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
    const gen = createGenerator(seed, this.dimension, this.genVersion);
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
        this.onResult({ id: msg.id, type: 'gen', cx: msg.cx, cz: msg.cz, ...generate(this.fallback.gen, msg.cx, msg.cz) });
      } else if (msg.type === 'mesh') {
        const m = this.fallback.mesher.mesh(msg.cx, msg.cz, msg.chunks, msg.options, msg.states);
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
    this.states = null; // block states (facing, open, liquid level...), made when the first one is set
    this.top = H - 1; // the highest layer with anything in it
    this.features = null; // from its generator: creatures that live there, monster spawners
    this.genRequested = false;
    this.version = 0; // bumps on every block change
    this.meshedVersion = -1;
    this.meshInFlight = false;
    this.urgent = false;
    this.gpu = null; // owned by the chunk renderer
  }
}

export class World {
  // dimension: 0 the overworld, 1 the nether, 2 the end (see dimensions.js)
  // genVersion: which terrain generator the world was made with (see dimensions.js)
  constructor(seed, { renderDistance = 8, workers = 3, edits = null, meshOptions = null, dimension = 0, genVersion = 1 } = {}) {
    this.seed = seed;
    this.dimension = dimension;
    this.genVersion = genVersion;
    this.meshOptions = meshOptions || { fancyLeaves: true };
    this.generator = createGenerator(seed, dimension, genVersion);
    this.chunks = new Map();
    // chunkKey -> Map(index -> id | state << 8): every block changed since generation
    this.edits = edits || new Map();
    this.renderDistance = renderDistance;
    this.meshQueue = []; // results waiting for upload
    this.pool = new WorkerPool(seed, workers, (r) => this.onResult(r), dimension, genVersion);
    this.jobId = 0;
    this.lastCx = null;
    this.lastCz = null;
    this.onChunkUnload = null;
    this.onFeatures = null; // (chunk, features) when a chunk comes from its generator
    this.onEdit = null; // (x, y, z, id | state << 8) for edits made here (multiplayer sends them on)
    this.onBlockChanged = null; // (x, y, z, id, state) for every change, here or from another player
    this.stats = { generated: 0, meshed: 0 };
    this._last = null;
    this.fluids = new Fluids(this);
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

  // The state byte of a block (0 for most).
  getState(x, y, z) {
    if (y < 0 || y >= H) return 0;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    let c = this._last;
    if (!c || c.cx !== cx || c.cz !== cz) {
      c = this.chunks.get(chunkKey(cx, cz));
      if (!c) return 0;
      this._last = c;
    }
    if (!c.states) return 0;
    return c.states[(y << 8) | ((z - cz * CS) << 4) | (x - cx * CS)];
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

  // Does a box (world units) overlap anything creatures can't walk through? Unloaded chunks are
  // solid. Slabs, stairs, fences, doors and the like use their own boxes.
  boxCollides(x0, y0, z0, x1, y1, z1) {
    const bx0 = Math.floor(x0), bx1 = Math.floor(x1), bz0 = Math.floor(z0), bz1 = Math.floor(z1);
    const by0 = Math.floor(y0), by1 = Math.floor(y1);
    for (let y = by0 - 1; y <= by1; y++) {
      for (let z = bz0; z <= bz1; z++) {
        for (let x = bx0; x <= bx1; x++) {
          if (y < 0) { if (y >= by0) return true; continue; }
          if (y >= H) continue;
          const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
          let c = this._last;
          if (!c || c.cx !== cx || c.cz !== cz) {
            c = this.chunks.get(chunkKey(cx, cz));
            if (c) this._last = c;
          }
          if (!c || !c.blocks) { if (y >= by0) return true; continue; }
          const i = (y << 8) | ((z - cz * CS) << 4) | (x - cx * CS);
          const b = c.blocks[i];
          const kind = COLLIDE_KIND[b];
          if (kind === 0) continue;
          if (y < by0 && !TALL_COLLIDE[b]) continue; // only fences reach up into the next cell
          if (kind === 1) return true;
          const s = c.states ? c.states[i] : 0;
          const boxes = collisionBoxes(b, s, (dx, dy, dz) => this.getBlock(x + dx, y + dy, z + dz), (dx, dy, dz) => this.getState(x + dx, y + dy, z + dz));
          for (const bb of boxes) {
            if (x + bb[0] < x1 && x + bb[3] > x0 && y + bb[1] < y1 && y + bb[4] > y0 && z + bb[2] < z1 && z + bb[5] > z0) return true;
          }
        }
      }
    }
    return false;
  }

  isChunkReady(x, z) {
    const c = this.getChunk(Math.floor(x / CS), Math.floor(z / CS));
    return !!(c && c.blocks && c.gpu);
  }

  // state: the block's state byte (facing, open, liquid level...; 0 for most blocks).
  setBlock(x, y, z, id, { state = 0, record = true, remote = false } = {}) {
    if (y < 0 || y >= H) return false;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.getChunk(cx, cz);
    if (!c || !c.blocks) return false;
    const lx = x - cx * CS, lz = z - cz * CS;
    const i = (y << 8) | (lz << 4) | lx;
    state &= 255;
    const oldState = c.states ? c.states[i] : 0;
    if (c.blocks[i] === id && oldState === state) return false;
    c.blocks[i] = id;
    if (state && !c.states) c.states = new Uint8Array(CS * CS * H);
    if (c.states) c.states[i] = state;
    if (id && y > c.top) c.top = y;
    if (record) {
      let e = this.edits.get(c.key);
      if (!e) { e = new Map(); this.edits.set(c.key, e); }
      e.set(i, id | (state << 8));
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
    if (!remote) {
      // liquids around a change made here flow (another player's game runs the flow of theirs)
      this.fluids.changed(x, y, z);
      if (this.onEdit) this.onEdit(x, y, z, id | (state << 8));
    }
    if (this.onBlockChanged) this.onBlockChanged(x, y, z, id, state);
    return true;
  }

  // An edit made by another player (value = id | state << 8): recorded for chunks that are not
  // loaded yet, applied now to those that are.
  applyRemoteEdit(x, y, z, value) {
    if (y < 0 || y >= H) return;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const key = chunkKey(cx, cz);
    let e = this.edits.get(key);
    if (!e) { e = new Map(); this.edits.set(key, e); }
    e.set((y << 8) | ((z - cz * CS) << 4) | (x - cx * CS), value);
    const c = this.chunks.get(key);
    if (c && c.blocks) this.setBlock(x, y, z, value & 255, { state: value >> 8, record: false, remote: true });
  }

  onResult(r) {
    if (r.type === 'gen') {
      const c = this.getChunk(r.cx, r.cz);
      if (!c) return; // unloaded meanwhile
      c.blocks = r.blocks;
      c.states = r.states || null;
      c.top = r.top ?? layerTop(r.blocks);
      const e = this.edits.get(c.key);
      if (e) {
        for (const [i, v] of e) {
          c.blocks[i] = v & 255;
          if (v > 255) {
            if (!c.states) c.states = new Uint8Array(CS * CS * H);
            c.states[i] = v >> 8;
          } else if (c.states) c.states[i] = 0;
          if (v & 255 && i >> 8 > c.top) c.top = i >> 8;
        }
      }
      if (r.features) {
        c.features = r.features;
        if (this.onFeatures) this.onFeatures(c, r.features);
      }
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

  // Mesh options changed (e.g. fancy leaves): rebuild every loaded chunk's mesh.
  setMeshOptions(opts) {
    this.meshOptions = { ...this.meshOptions, ...opts };
    for (const c of this.chunks.values()) if (c.blocks) c.version++;
  }

  requestMesh(c) {
    const chunks = [];
    const states = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.getChunk(c.cx + dx, c.cz + dz);
        // only up to the highest layer anything is in (and one of sky over it)
        const end = Math.min(H, n.top + 2) << 8;
        chunks.push(n.blocks.slice(0, end));
        states.push(n.states ? n.states.slice(0, end) : null);
      }
    }
    c.meshInFlight = true;
    c.urgent = false;
    const transfer = chunks.map((a) => a.buffer);
    for (const s of states) if (s) transfer.push(s.buffer);
    this.pool.submit({ type: 'mesh', id: ++this.jobId, cx: c.cx, cz: c.cz, version: c.version, chunks, states, options: this.meshOptions }, transfer);
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
  }

  // Flowing liquids: called once per frame with the frame time.
  updateFluids(dt) {
    this.fluids.update(dt);
  }

  // Serialisable edits for saving
  serializeEdits() {
    return World.serializeEditMap(this.edits);
  }

  static serializeEditMap(edits) {
    const out = {};
    for (const [k, m] of edits) out[k] = Array.from(m.entries()).flat();
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

  // Is there a ladder (or something else to climb) in the cell?
  climbableAt(x, y, z) {
    return BLOCKS[this.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))].climbable === true;
  }

  // The top of the first solid block at or below (x, y, z), within 40 blocks (or y - 40).
  surfaceBelow(x, y, z) {
    const bx = Math.floor(x), bz = Math.floor(z);
    for (let yy = Math.floor(y); yy > Math.max(0, y - 40); yy--) if (IS_SOLID[this.getBlock(bx, yy, bz)] || IS_LIQUID[this.getBlock(bx, yy, bz)]) return yy + 1;
    return y - 40;
  }

  // The highest layer anything is in around (x, z): nothing above it but sky.
  columnTop(x, z) {
    const c = this.getChunk(Math.floor(x / CS), Math.floor(z / CS));
    return c && c.blocks ? Math.min(H - 1, c.top + 1) : H - 1;
  }

  // Height of the highest solid (or liquid) block in a column, ignoring tree canopies.
  surfaceHeight(x, z, { skipFoliage = true } = {}) {
    for (let y = this.columnTop(x, z); y > 0; y--) {
      const b = this.getBlock(x, y, z);
      if (skipFoliage && (BLOCKS[b].wave === 1 || BLOCKS[b].key.endsWith('_log'))) continue;
      if (IS_SOLID[b] || IS_LIQUID[b]) return y;
    }
    return 0;
  }
}

export { BLOCK, BLOCKS };
