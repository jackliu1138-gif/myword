// Tiny block-break particles with gravity and ground collision.

import { FACE_TEX, BLOCKS } from '../world/blocks.js';

export class Particles {
  constructor(world) {
    this.world = world;
    this.list = [];
    this.count = 0;
  }

  burst(x, y, z, block, sky, blockLight) {
    const def = BLOCKS[block];
    if (!def || !def.tex) return;
    const layer = FACE_TEX[block * 4 + 2];
    const n = 22;
    for (let i = 0; i < n; i++) {
      const px = x + 0.15 + Math.random() * 0.7, py = y + 0.15 + Math.random() * 0.7, pz = z + 0.15 + Math.random() * 0.7;
      this.list.push({
        x: px, y: py, z: pz,
        vx: (px - x - 0.5) * 4 + (Math.random() - 0.5), vy: 1.5 + Math.random() * 2.5, vz: (pz - z - 0.5) * 4 + (Math.random() - 0.5),
        life: 0.6 + Math.random() * 0.6,
        size: 0.045 + Math.random() * 0.04,
        u: Math.floor(Math.random() * 3) * 0.25, v: Math.floor(Math.random() * 3) * 0.25,
        layer, sky, block: blockLight,
      });
    }
    if (this.list.length > 1500) this.list.splice(0, this.list.length - 1500);
  }

  update(dt) {
    const w = this.world;
    const out = [];
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= 18 * dt;
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      if (w.isSolidAt(Math.floor(nx), Math.floor(ny - p.size), Math.floor(nz))) {
        p.vy = 0;
        p.vx *= 0.7;
        p.vz *= 0.7;
        p.x = nx; p.z = nz;
      } else {
        p.x = nx; p.y = ny; p.z = nz;
      }
      out.push(p);
    }
    this.list = out;
    this.count = out.length;
  }
}
