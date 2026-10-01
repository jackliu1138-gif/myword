// The maps of the planets as seen from space (world/planetmap.js), made by a worker of their own
// and handed to the renderer: the whole Earth (kept between visits: it takes some seconds), a
// finer square of the ground around the player and a wider one once they are high enough to see
// it, the Moon and Mars.

import { createWorker } from '../world/world.js';
import { loadCached, saveCached } from './save.js';

const NEAR = { span: 4096, n: 512 }; // 8 blocks a texel
const MID = { span: 32768, n: 512 }; // 64 blocks a texel
const EARTH = { w: 2048, h: 1024 };
const BODY = { w: 1024, h: 512 };
const CACHE_VERSION = 2;

export class PlanetMaps {
  constructor(renderer) {
    this.renderer = renderer;
    this.worker = null;
    this.world = null;
    this.pending = new Map(); // kind -> request
    this.have = { near: null, mid: null };
    this.nextId = 1;
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    try {
      this.worker = createWorker();
      this.worker.onmessage = (e) => this.onResult(e.data);
      this.worker.onerror = () => { this.worker = null; };
    } catch (e) {
      this.worker = null;
    }
    return this.worker;
  }

  // A world was loaded (or another one): its seed, generator version and sea level.
  setWorld(seed, gen, sea) {
    const key = seed + ':' + gen;
    if (this.world && this.world.key === key) return;
    this.world = { key, seed, gen, sea };
    this.pending.clear();
    this.have = { near: null, mid: null };
    this.renderer.clearPlanetMaps();
    this.renderer.makeCloudField(seed >>> 0);
    const w = this.world;
    // the whole Earth: from the cache when it was made before, else made now in the background
    loadCached(`planet:${CACHE_VERSION}:earth:${key}`).then((m) => {
      if (this.world !== w) return;
      if (m && m.rgba && m.w === EARTH.w) this.renderer.setPlanetMap('earth', m);
      else this.request('earth', { w: EARTH.w, h: EARTH.h });
      this.request('moon', { w: BODY.w, h: BODY.h });
      this.request('mars', { w: BODY.w, h: BODY.h });
    });
  }

  request(kind, opts) {
    const w = this.world;
    if (!w || this.pending.has(kind) || !this.ensureWorker()) return;
    const id = this.nextId++;
    this.pending.set(kind, { id, ...opts });
    this.worker.postMessage({ type: 'planet', id, kind, key: w.key, seed: w.seed, gen: w.gen, sea: w.sea, ...opts });
  }

  onResult(r) {
    if (r.type !== 'planet') return;
    const p = this.pending.get(r.kind);
    if (!p || p.id !== r.id) return;
    this.pending.delete(r.kind);
    if (!this.world || r.key !== this.world.key) return;
    this.renderer.setPlanetMap(r.kind, r);
    if (r.kind === 'near' || r.kind === 'mid') this.have[r.kind] = { cx: r.cx, cz: r.cz, body: r.body };
    if (r.kind === 'earth') saveCached(`planet:${CACHE_VERSION}:earth:${r.key}`, { rgba: r.rgba, lights: r.lights, w: r.w, h: r.h });
  }

  // Each frame: the place on a body's map under the player (world x, z of its dimension) and
  // how high they are above it; squares of the ground follow them once they are high enough to
  // see far (on the Moon and Mars, the near one always: their horizons are close and clear).
  update(x, z, alt, body = 'earth') {
    if (!this.world) return;
    const kinds = body === 'earth' ? [['near', NEAR, 150], ['mid', MID, 600]] : [['near', NEAR, -1e9]];
    for (const [kind, L, from] of kinds) {
      if (alt < from) continue;
      const h = this.have[kind];
      const cx = Math.round(x / 64) * 64, cz = Math.round(z / 64) * 64;
      if (h && h.body === body && Math.abs(h.cx - x) < L.span / 5 && Math.abs(h.cz - z) < L.span / 5) continue;
      if (this.pending.has(kind)) continue;
      this.request(kind, { cx, cz, span: L.span, n: L.n, body });
    }
  }

  dispose() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
  }
}
