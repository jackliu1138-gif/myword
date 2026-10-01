// Web worker: terrain generation and chunk meshing off the main thread.

import { ChunkMesher } from './mesher.js';
import { createGenerator, generate } from './dimensions.js';
import { buildEarthMap, buildLocalMap, buildBodyMap, buildBodyLocalMap } from './planetmap.js';

let generator = null;
let mesher = null;
// generators for the maps of planets seen from space (a worker of their own makes those)
const mapGens = new Map();
function mapGenerator(seed, dim, gen) {
  const key = seed + ':' + dim + ':' + gen;
  let g = mapGens.get(key);
  if (!g) { g = createGenerator(seed, dim, gen); mapGens.set(key, g); }
  return g;
}

function handle(msg) {
  switch (msg.type) {
    case 'init':
      generator = createGenerator(msg.seed, msg.dimension || 0, msg.gen || 1);
      mesher = new ChunkMesher(generator);
      return null;
    case 'gen': {
      const g = generate(generator, msg.cx, msg.cz);
      const transfer = [g.blocks.buffer];
      if (g.states) transfer.push(g.states.buffer);
      return { result: { id: msg.id, type: 'gen', cx: msg.cx, cz: msg.cz, ...g }, transfer };
    }
    case 'planet': {
      // kind 'earth' (the whole planet), 'near' / 'mid' (squares of the world around a point),
      // 'moon', 'mars'
      // (the squares of ground near the player: of the Earth, or body 'moon' / 'mars')
      const body = msg.body || (msg.kind === 'moon' || msg.kind === 'mars' ? msg.kind : 'earth');
      const dim = body === 'moon' ? 4 : body === 'mars' ? 5 : 0;
      const g = mapGenerator(msg.seed, dim, msg.gen || 1);
      let m;
      if (msg.kind === 'earth') m = buildEarthMap(g, msg.sea, msg.w, msg.h);
      else if ((msg.kind === 'near' || msg.kind === 'mid') && body !== 'earth') m = buildBodyLocalMap(g, msg.cx, msg.cz, msg.span, msg.n);
      else if (msg.kind === 'near' || msg.kind === 'mid') m = buildLocalMap(g, msg.sea, msg.cx, msg.cz, msg.span, msg.n, msg.kind === 'mid');
      else m = buildBodyMap(g, msg.w, msg.h, msg.kind);
      m.body = body;
      const transfer = [m.rgba.buffer];
      if (m.lights) transfer.push(m.lights.buffer);
      return { result: { type: 'planet', id: msg.id, kind: msg.kind, key: msg.key, ...m }, transfer };
    }
    case 'mesh': {
      const m = mesher.mesh(msg.cx, msg.cz, msg.chunks, msg.options, msg.states);
      m.id = msg.id;
      m.type = 'mesh';
      m.version = msg.version;
      return { result: m, transfer: [m.opaque, m.cutout, m.translucent, m.grass, m.light.buffer] };
    }
    default:
      return null;
  }
}

self.onmessage = (e) => {
  const out = handle(e.data);
  if (out) self.postMessage(out.result, out.transfer);
};
