// Builds the triangles for every creature, dropped item and arrow each frame, interpolating
// between simulation ticks so movement stays smooth at any frame rate.

import { emitModel, emitBlockCube, emitSprite, emitArrow, modelVertexCount, ENTITY_FLOATS } from './models.js';
import { isBlockItem } from '../sim/items.js';

const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export class EntityMesh {
  constructor(skins, sprites) {
    this.skins = skins;
    this.sprites = sprites;
    this.data = new Float32Array(ENTITY_FLOATS * 6 * 4096);
    this.count = 0;
  }

  ensure(floats) {
    if (floats <= this.data.length) return;
    let n = this.data.length * 2;
    while (n < floats) n *= 2;
    const d = new Float32Array(n);
    d.set(this.data);
    this.data = d;
  }

  build(sim, cam, alpha, world, t, maxDist = 96) {
    let o = 0;
    const p = [0, 0, 0];
    for (const e of sim.entities.values()) {
      const b = e.body;
      p[0] = lerp(e.prevPos[0], b.pos[0], alpha);
      p[1] = lerp(e.prevPos[1], b.pos[1], alpha);
      p[2] = lerp(e.prevPos[2], b.pos[2], alpha);
      const dx = p[0] - cam[0], dy = p[1] - cam[1], dz = p[2] - cam[2];
      if (dx * dx + dy * dy + dz * dz > maxDist * maxDist) continue;
      const [sl, bl] = world.getLight(Math.floor(p[0]), Math.floor(p[1] + b.h * 0.6), Math.floor(p[2]));
      const light = [sl / 15, bl / 15];
      if (e.kind === 'mob') {
        this.ensure(o + modelVertexCount(e.type) * ENTITY_FLOATS);
        let tint = [0, 0, 0, 0];
        if (e.hurtTime > 0.2 || e.deathTime > 0) tint = [1, 0.18, 0.12, 0.55];
        else if (e.type === 'creeper' && e.fuse > 0 && Math.sin(e.fuse * 18) > 0.2) tint = [1, 1, 1, 0.55];
        if (e.burning > 0 && e.deathTime === 0) tint = [1, 0.55, 0.2, Math.max(tint[3], 0.25 + 0.2 * Math.sin(t * 20))];
        const yaw = lerpAngle(e.prevYaw, e.yaw, alpha);
        const skin = e.type === 'sheep' && e.variant ? 'sheep:' + e.variant : e.type;
        o = emitModel(this.data, o, e, e.type, p, yaw, cam, light, this.skins, t, tint, skin);
      } else if (e.kind === 'item') {
        this.ensure(o + 36 * ENTITY_FLOATS);
        const bob = Math.sin(e.age * 2.4) * 0.05 + 0.12;
        const q = [p[0], p[1] + bob, p[2]];
        if (isBlockItem(e.item)) o = emitBlockCube(this.data, o, e.item, [q[0], q[1] + 0.1, q[2]], e.spin, 0.25, cam, light);
        else o = emitSprite(this.data, o, this.sprites.index.get(e.item) || 0, q, e.spin, 0.42, cam, light);
      } else if (e.kind === 'arrow') {
        this.ensure(o + 108 * ENTITY_FLOATS);
        o = emitArrow(this.data, o, p, e.dir || b.vel, cam, light, this.skins);
      }
    }
    this.count = o / ENTITY_FLOATS;
    return this;
  }
}
