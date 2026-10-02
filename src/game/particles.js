// Block-break particles with gravity and ground collision, and leaves that drift down from trees.

import { FACE_TEX, BLOCKS } from '../world/blocks.js';

export class Particles {
  constructor(world) {
    this.world = world;
    this.list = [];
    this.count = 0;
    this.leaves = 0;
  }

  burst(x, y, z, block, sky, blockLight, n = 22) {
    const def = BLOCKS[block];
    if (!def || !def.tex) return;
    const layer = FACE_TEX[block * 4 + 2];
    for (let i = 0; i < n; i++) {
      const px = x + 0.15 + Math.random() * 0.7, py = y + 0.15 + Math.random() * 0.7, pz = z + 0.15 + Math.random() * 0.7;
      this.list.push({
        x: px, y: py, z: pz,
        vx: (px - x - 0.5) * 4 + (Math.random() - 0.5), vy: 1.5 + Math.random() * 2.5, vz: (pz - z - 0.5) * 4 + (Math.random() - 0.5),
        life: 0.6 + Math.random() * 0.6,
        size: 0.045 + Math.random() * 0.04,
        u: Math.floor(Math.random() * 3) * 0.25, v: Math.floor(Math.random() * 3) * 0.25,
        layer, sky, block: blockLight, tint: null, angle: 0, spin: 0,
      });
    }
    if (this.list.length > 1500) this.list.splice(0, this.list.length - 1500);
  }

  // A single leaf fluttering down; tint is the canopy colour.
  leaf(x, y, z, layer, tint, sky, blockLight) {
    if (this.leaves >= 90) return;
    this.list.push({
      kind: 'leaf', x, y, z,
      vx: 0, vy: -0.4, vz: 0,
      life: 7 + Math.random() * 5, landed: 0,
      size: 0.07 + Math.random() * 0.05,
      u: Math.random() * 0.75, v: Math.random() * 0.75,
      layer, sky, block: blockLight, tint,
      angle: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 5,
      phase: Math.random() * 100,
    });
  }

  // A glowing spark (fireworks, elytra trails, potion swirls, enchanting): additive, lit by itself.
  // color: linear-ish rgb 0..1 (more than 1 blooms); gravity and drag in blocks/s.
  spark(x, y, z, vx, vy, vz, color, { life = 1, size = 0.06, gravity = 0, drag = 0, twinkle = false, fade = true } = {}) {
    if (this.list.length > 2400) return;
    this.list.push({ kind: 'spark', x, y, z, vx, vy, vz, life, max: life, size, color, gravity, drag, twinkle, fade, sky: 1, block: 1, layer: 0, u: 0, v: 0, angle: 0, spin: 0 });
  }

  // A puff of smoke or dust: soft, spreading as it slows and rises, fading away (blended over the
  // scene, not glowing). color: rgb 0..1 (lit by the sky where it is); glow: lit from below by a
  // fire as well, this much (fading as it drifts off).
  smoke(x, y, z, vx, vy, vz, color, { life = 2.5, size = 0.8, rise = 0.6, drag = 1.8, glow = 0 } = {}) {
    if (this.list.length > 2400) return;
    this.list.push({ kind: 'smoke', x, y, z, vx, vy, vz, life, max: life, size, grow: size * 1.6, color, rise, drag, sky: 1, block: 0, glow, layer: 0, u: 0, v: 0, angle: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.6 });
  }

  // A firework's burst: a ball of stars in its colours that fall and fade, with a few crackles.
  fireworkBurst(pos, colors) {
    const n = 110;
    for (let i = 0; i < n; i++) {
      const c = colors[i % colors.length];
      const col = [c[0] / 255 * 5, c[1] / 255 * 5, c[2] / 255 * 5];
      // points on a sphere, a little uneven
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const sp = 7 + Math.random() * 2.5;
      this.spark(pos[0], pos[1], pos[2], r * Math.cos(th) * sp, u * sp, r * Math.sin(th) * sp, col, { life: 1.3 + Math.random() * 0.9, size: 0.09, gravity: 3, drag: 1.6, twinkle: Math.random() < 0.4 });
    }
    // a white flash at the heart of it
    for (let i = 0; i < 10; i++) this.spark(pos[0], pos[1], pos[2], (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, [8, 8, 7], { life: 0.25, size: 0.5, drag: 3 });
  }

  update(dt, wind = [1.2, 0.4], time = 0) {
    const w = this.world;
    const out = [];
    let leaves = 0;
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) continue;
      if (p.kind === 'smoke') {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k; p.vz *= k;
        p.vy = p.vy * k + p.rise * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.angle += p.spin * dt;
        out.push(p);
        continue;
      }
      if (p.kind === 'spark') {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k; p.vy *= k; p.vz *= k;
        p.vy -= p.gravity * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        out.push(p);
        continue;
      }
      if (p.kind === 'leaf') {
        leaves++;
        if (p.landed > 0) { p.landed += dt; out.push(p); continue; }
        // slow, swaying descent carried by the wind, spinning as it goes
        const sway = Math.sin(time * 2.1 + p.phase);
        p.vx += ((wind[0] * 0.6 + sway * 0.9) - p.vx) * Math.min(1, dt * 2);
        p.vz += ((wind[1] * 0.6 + Math.cos(time * 1.7 + p.phase) * 0.9) - p.vz) * Math.min(1, dt * 2);
        p.vy = -0.55 - Math.abs(sway) * 0.35;
        p.angle += p.spin * dt;
        const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
        if (w.isSolidAt(Math.floor(nx), Math.floor(ny - 0.02), Math.floor(nz))) {
          p.landed = 0.001;
          p.y = Math.floor(ny - 0.02) + 1.02;
          p.life = Math.min(p.life, 4);
        } else { p.x = nx; p.y = ny; p.z = nz; }
        out.push(p);
        continue;
      }
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
    this.leaves = leaves;
  }
}
