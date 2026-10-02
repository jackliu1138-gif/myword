// Builds the triangles for every creature, dropped item and arrow each frame, interpolating
// between simulation ticks so movement stays smooth at any frame rate.

import { emitModel, emitBlockCube, emitSprite, emitArrow, emitSignText, modelVertexCount, skinKeyOf, ENTITY_FLOATS, GEAR_VERTICES } from './models.js';
import { mobFlags } from '../sim/remote.js';
import { isBlockItem } from '../sim/items.js';
import { BLOCK } from '../world/blocks.js';
import { emitSaucer, saucerFloats } from './saucer.js';
import { DECK } from '../sim/saucerform.js';

const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const LINE_SEGMENTS = 14;

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

  // extras: players drawn as models ({ pos, yaw, headYaw, headPitch, skin, walkPhase, ... }: the
  // others in multiplayer, and ourselves in the third-person views); signs: the words on signs in
  // view ({ layer, center, nrm, light }, see Game.visibleSigns); rodTip: where our fishing line
  // starts; saucers: flying saucers being flown ({ pos, yaw, look }, see saucer.js)
  build(sim, cam, alpha, world, t, maxDist = 96, extras = null, signs = null, rodTip = null, saucers = null) {
    let o = 0;
    const p = [0, 0, 0];
    // (a saucer is big: seen from much further off than a creature)
    const farSaucer = Math.max(maxDist * 4, 360);
    if (saucers) {
      for (const s of saucers) {
        const q = s.pos;
        const dx = q[0] - cam[0], dy = q[1] - cam[1], dz = q[2] - cam[2];
        if (dx * dx + dy * dy + dz * dz > farSaucer * farSaucer) continue;
        this.ensure(o + saucerFloats());
        const [sl, bl] = world.getLight(Math.floor(q[0]), Math.floor(q[1] + DECK), Math.floor(q[2]));
        o = emitSaucer(this.data, o, q, s.yaw, cam, [Math.max(sl / 15, s.lit || 0), bl / 15], t, { ...s.look, eye: this.eye ?? 1 });
      }
    }
    if (signs) {
      this.ensure(o + signs.length * 6 * ENTITY_FLOATS);
      for (const s of signs) o = emitSignText(this.data, o, s.layer, s.center, s.nrm, cam, s.light);
    }
    if (extras) {
      for (const e of extras) {
        const q = e.pos;
        const dx = q[0] - cam[0], dy = q[1] - cam[1], dz = q[2] - cam[2];
        if (dx * dx + dy * dy + dz * dz > maxDist * maxDist) continue;
        this.ensure(o + (modelVertexCount('player') + GEAR_VERTICES + 3 * 36) * ENTITY_FLOATS);
        const [sl, bl] = world.getLight(Math.floor(q[0]), Math.floor(q[1] + 1.2), Math.floor(q[2]));
        const tint = e.hurtTime > 0.2 ? [1, 0.18, 0.12, 0.55] : [0, 0, 0, 0];
        const gear = { held: e.held, armor: e.armor, sprites: this.sprites, skins: this.skins, wings: e.wings, offhand: e.offhand };
        o = emitModel(this.data, o, e, 'player', q, e.yaw, cam, [sl / 15, bl / 15], this.skins, t, tint, e.skin, gear);
      }
    }
    for (const e of sim.entities.values()) {
      const b = e.body;
      p[0] = lerp(e.prevPos[0], b.pos[0], alpha);
      p[1] = lerp(e.prevPos[1], b.pos[1], alpha);
      p[2] = lerp(e.prevPos[2], b.pos[2], alpha);
      const dx = p[0] - cam[0], dy = p[1] - cam[1], dz = p[2] - cam[2];
      const isSaucer = e.kind === 'mob' && e.type === 'saucer';
      const reach = isSaucer ? farSaucer : maxDist;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
      if (isSaucer) {
        // a parked flying saucer, legs down to the ground under each foot
        this.ensure(o + saucerFloats());
        const [sl2, bl2] = world.getLight(Math.floor(p[0]), Math.floor(p[1] + DECK), Math.floor(p[2]));
        o = emitSaucer(this.data, o, p, lerpAngle(e.prevYaw, e.yaw, alpha), cam, [sl2 / 15, bl2 / 15], t, { legs: 1, engine: e.hurtTime > 0.2 ? 0.6 : 0, feet: Array.isArray(e.feet) ? e.feet : null, eye: this.eye ?? 1 });
        continue;
      }
      const [sl, bl] = world.getLight(Math.floor(p[0]), Math.floor(p[1] + b.h * 0.6), Math.floor(p[2]));
      const light = [sl / 15, bl / 15];
      if (e.kind === 'mob') {
        if (!e.ghost) e.flags = mobFlags(e);
        this.ensure(o + (modelVertexCount(e.type) + GEAR_VERTICES) * ENTITY_FLOATS);
        let tint = [0, 0, 0, 0];
        if (e.hurtTime > 0.2 || e.deathTime > 0) tint = [1, 0.18, 0.12, 0.55];
        else if ((e.type === 'creeper' || e.type === 'tnt') && e.fuse > 0 && Math.sin(e.fuse * 18) > 0.2) tint = [1, 1, 1, 0.55];
        else if (e.type === 'wither' && e.charge > 0) tint = [0.55, 0.65, 1, 0.25 + 0.2 * Math.sin(t * 8)];
        if (e.burning > 0 && e.deathTime === 0) tint = [1, 0.55, 0.2, Math.max(tint[3], 0.25 + 0.2 * Math.sin(t * 20))];
        const yaw = lerpAngle(e.prevYaw, e.yaw, alpha);
        const held = e.def && e.def.held;
        const gear = held || e.armor ? { held, armor: e.armor, sprites: this.sprites, skins: this.skins } : null;
        // the light of the glowing ones comes from themselves
        const lit = e.type === 'blaze' || e.type === 'end_crystal' || e.type === 'wither' ? [light[0], Math.max(light[1], 0.8)] : light;
        o = emitModel(this.data, o, e, e.type, p, yaw, cam, lit, this.skins, t, tint, skinKeyOf(e), gear);
      } else if (e.kind === 'item') {
        if (e.pending) continue; // being picked up (waiting for the server)
        this.ensure(o + 36 * ENTITY_FLOATS);
        const bob = Math.sin(e.age * 2.4) * 0.05 + 0.12;
        const q = [p[0], p[1] + bob, p[2]];
        if (isBlockItem(e.item)) o = emitBlockCube(this.data, o, e.item, [q[0], q[1] + 0.1, q[2]], e.spin, 0.25, cam, light);
        else o = emitSprite(this.data, o, this.sprites.index.get(e.item) || 0, q, e.spin, 0.42, cam, light);
      } else if (e.kind === 'thrown' || (e.kind === 'firework' && !e.attached)) {
        // pearls, eyes, potions and rockets: a small sprite turned to face the camera
        this.ensure(o + 6 * ENTITY_FLOATS);
        const face = Math.atan2(cam[0] - p[0], cam[2] - p[2]);
        o = emitSprite(this.data, o, this.sprites.index.get(e.item) || 0, [p[0], p[1] - 0.15, p[2]], face, 0.36, cam, [Math.max(light[0], 0.5), Math.max(light[1], 0.4)]);
      } else if (e.kind === 'fireball') {
        this.ensure(o + 36 * ENTITY_FLOATS);
        o = emitBlockCube(this.data, o, e.small ? BLOCK.MAGMA_BLOCK : BLOCK.GLOWSTONE, [p[0], p[1] + 0.15, p[2]], e.spin, e.small ? 0.3 : 0.75, cam, [0, 1]);
      } else if (e.kind === 'skull') {
        // the wither's skulls, turning as they fly
        this.ensure(o + 36 * ENTITY_FLOATS);
        o = emitBlockCube(this.data, o, BLOCK.WITHER_SKELETON_SKULL, [p[0], p[1], p[2]], e.age * 4, 0.34, cam, [light[0], Math.max(light[1], 0.35)]);
      } else if (e.kind === 'bullet') {
        this.ensure(o + 36 * ENTITY_FLOATS);
        o = emitBlockCube(this.data, o, BLOCK.SEA_LANTERN, [p[0], p[1], p[2]], e.age * 9, 0.2, cam, [0, 1]);
      } else if (e.kind === 'bobber') {
        this.ensure(o + (1 + LINE_SEGMENTS) * 36 * ENTITY_FLOATS);
        const bob = e.bite > 0 ? -0.12 : Math.sin(t * 3 + e.id) * 0.02;
        o = emitBlockCube(this.data, o, BLOCK.RED_WOOL, [p[0], p[1] + bob, p[2]], 0, 0.14, cam, light);
        // the line, sagging between the rod and the float
        const tip = e.owner === 'local' ? rodTip : null;
        if (tip) {
          const q = [p[0], p[1] + bob + 0.07, p[2]];
          const span = Math.hypot(q[0] - tip[0], q[2] - tip[2]);
          const sag = e.hooked || e.bite > 0 ? 0.05 : Math.min(1.5, span * 0.12);
          for (let i = 0; i < LINE_SEGMENTS; i++) {
            const k = (i + 0.5) / LINE_SEGMENTS;
            const pt = [lerp(tip[0], q[0], k), lerp(tip[1], q[1], k) - Math.sin(k * Math.PI) * sag, lerp(tip[2], q[2], k)];
            o = emitBlockCube(this.data, o, BLOCK.WHITE_WOOL, pt, 0, 0.02, cam, light);
          }
        }
      } else if (e.kind === 'arrow') {
        this.ensure(o + 108 * ENTITY_FLOATS);
        o = emitArrow(this.data, o, p, e.dir || b.vel, cam, light, this.skins);
      }
    }
    this.count = o / ENTITY_FLOATS;
    return this;
  }
}

