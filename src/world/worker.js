// Web worker: terrain generation and chunk meshing off the main thread.

import { ChunkMesher } from './mesher.js';
import { createGenerator, generate } from './dimensions.js';

let generator = null;
let mesher = null;

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
