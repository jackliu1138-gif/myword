// Travelling between dimensions: nether portals (an obsidian frame lit with flint and steel; stand
// in it and you arrive in the other world, 8 blocks there for every block here, at a portal that
// is found or built for you), the end portal in a stronghold's portal room (all twelve frames need
// an eye of ender), and the way home from the End once its dragon is dead. Also runs the End's
// boss fight. Installed as methods on Game.prototype.

import { BLOCK, IS_SOLID, IS_LIQUID } from '../world/blocks.js';
import { World } from '../world/world.js';
import { DIM, DIM_NAMES, END_PLATFORM, END_SURFACE } from '../world/dimensions.js';
import { t } from '../ui/i18n.js';

const PORTAL_IDS = new Set([BLOCK.NETHER_PORTAL_X, BLOCK.NETHER_PORTAL_Z]);
const PORTAL_WAIT = { creative: 0.5, survival: 3.2 };
export const DRAGON_MAX = 200;

export function newEndState() {
  return { dragonDead: false, dragonHp: DRAGON_MAX, crystals: new Array(10).fill(true), portalOpen: false };
}

export function installTravel(Game) {
  const P = Game.prototype;

  // ---------------------------------------------------------------- worlds
  P.createWorld = function createWorld(seed, dimension, edits) {
    const workers = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    const w = new World(seed, {
      renderDistance: this.settings.renderDistance, workers, edits, dimension,
      meshOptions: { fancyLeaves: this.settings.fancyLeaves !== false },
    });
    w.onChunkUnload = (c) => this.renderer.freeChunk(c);
    w.onBlockChanged = (x, y, z, id) => this.onBlockChanged(x, y, z, id);
    if (this.mp) w.onEdit = (x, y, z, id) => { if (this.mp) this.mp.edits.push([x, y, z, id]); };
    return w;
  };

  // Swap the loaded world for another dimension's (its edits are kept per dimension).
  P.switchWorld = function switchWorld(dim) {
    if (this.mp) this.flushEdits();
    const old = this.world;
    this.dimEdits[this.dimension] = old.edits;
    // dropped items stay where they were, for when we come back
    this.dimItems = this.dimItems || {};
    this.dimItems[this.dimension] = [...this.sim.entities.values()].filter((e) => e.kind === 'item' && !e.removed);
    for (const c of old.chunks.values()) this.renderer.freeChunk(c);
    old.dispose();
    this.dimension = dim;
    this.world = this.createWorld(old.seed, dim, this.dimEdits[dim] || new Map());
    this.player.world = this.world;
    this.particles.world = this.world;
    this.particles.list.length = 0;
    const sim = this.sim;
    sim.world = this.world;
    sim.dimension = dim;
    sim.fortressesNear = dim === DIM.NETHER ? (x, z) => this.world.generator.fortressesNear(x, z, 40) : null;
    sim.entities.clear();
    for (const e of this.dimItems[dim] || []) { e.body.world = this.world; sim.entities.set(e.id, e); }
    this.dimItems[dim] = [];
    this.dragon = null;
    if (this.mp) { this.mp.ghosts.clear(); this.mp.ghostIds.clear(); }
    this.crops = new Map();
    this.fires = new Map();
    this.scanWorldBlocks();
    this.renderer.resetHistory();
    this.renderer.exposureReset = true;
    this.loadingDone = false;
    this.breaking = null;
    this.portalTime = 0;
    this.ui.setPortal(0);
    this.ui.setBoss(null);
    if (this.sleeping) this.wakeUp();
  };

  // how: 'portal' (a nether portal), 'endPortal' (into the End), 'home' (back to the overworld
  // from the End, or respawning)
  P.travelTo = function travelTo(dim, how) {
    const from = this.player.pos.slice();
    let target;
    if (how === 'portal') {
      const k = dim === DIM.NETHER ? 1 / 8 : 8;
      target = [Math.floor(from[0] * k), Math.max(dim === DIM.NETHER ? 34 : 50, Math.min(dim === DIM.NETHER ? 100 : 120, Math.floor(from[1]))), Math.floor(from[2] * k)];
    } else if (how === 'endPortal') target = END_PLATFORM.slice();
    else target = null;
    this.switchWorld(dim);
    if (!target) {
      const sp = this.spawnPoint || this.world.generator.findSpawn();
      target = [Math.floor(sp[0]), Math.floor(sp[1]), Math.floor(sp[2])];
    }
    this.arrival = { how, target };
    this.player.pos = [target[0] + 0.5, target[1] + 0.5, target[2] + 0.5];
    this.player.vel = [0, 0, 0];
    if (!this.isCreative()) this.player.flying = false;
    this.audio.sfx('travel', 0.7, 0);
    this.ui.toast(t('dim.enter.' + DIM_NAMES[dim]), 2600);
  };

  P.chunksReadyAround = function chunksReadyAround(x, z, r = 1) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (!this.world.isChunkReady(x + dx * 16, z + dz * 16)) return false;
    return true;
  };

  // Once the chunks around the arrival point exist: find or build the portal, the platform or
  // the ground to stand on.
  P.finishArrival = function finishArrival() {
    const a = this.arrival;
    const [x, y, z] = a.target;
    if (!this.chunksReadyAround(x, z, 1)) return false;
    let spot;
    if (a.how === 'portal') {
      spot = this.findPortalNear(x, y, z, this.dimension === DIM.NETHER ? 20 : 40) || this.buildPortal(x, y, z);
      this.inPortalLock = true; // step out before it can take you back
    } else if (a.how === 'endPortal') {
      spot = this.buildEndPlatform();
    } else {
      spot = this.findStandingSpot(x, z);
    }
    this.player.pos = [spot[0] + 0.5, spot[1] + 0.02, spot[2] + 0.5];
    this.player.vel = [0, 0, 0];
    this.arrival = null;
    return true;
  };

  // ---------------------------------------------------------------- nether portals
  // The inside of an obsidian frame around (x, y, z) in one plane: axis 'x' spans X (at this z),
  // 'z' spans Z. Portal blocks already there count as inside. 2-21 wide, 3-21 tall.
  P.portalFrame = function portalFrame(x, y, z, axis, portalId = 0) {
    const w = this.world;
    const get = axis === 'x' ? (a, yy) => w.getBlock(a, yy, z) : (a, yy) => w.getBlock(x, yy, a);
    const along = axis === 'x' ? x : z;
    const inside = (b) => b === 0 || b === BLOCK.FIRE || (portalId && b === portalId);
    const OBS = BLOCK.OBSIDIAN;
    if (!inside(get(along, y))) return null;
    let y0 = y;
    while (y0 > y - 22 && inside(get(along, y0 - 1))) y0--;
    if (get(along, y0 - 1) !== OBS) return null;
    let a0 = along, a1 = along;
    while (a0 > along - 22 && inside(get(a0 - 1, y0))) a0--;
    while (a1 < along + 22 && inside(get(a1 + 1, y0))) a1++;
    if (get(a0 - 1, y0) !== OBS || get(a1 + 1, y0) !== OBS) return null;
    if (a1 - a0 + 1 < 2 || a1 - a0 + 1 > 21) return null;
    for (let a = a0; a <= a1; a++) if (get(a, y0 - 1) !== OBS) return null;
    let y1 = null;
    for (let yy = y0; yy <= y0 + 21; yy++) {
      let allObs = true, allIn = true;
      for (let a = a0; a <= a1; a++) {
        const b = get(a, yy);
        if (b !== OBS) allObs = false;
        if (!inside(b)) allIn = false;
      }
      if (allObs && yy > y0) { y1 = yy - 1; break; }
      if (!allIn || get(a0 - 1, yy) !== OBS || get(a1 + 1, yy) !== OBS) return null;
    }
    if (y1 === null || y1 - y0 + 1 < 3) return null;
    return { axis, a0, a1, y0, y1, x, z };
  };

  P.fillPortal = function fillPortal(f, id) {
    for (let yy = f.y0; yy <= f.y1; yy++) {
      for (let a = f.a0; a <= f.a1; a++) {
        if (f.axis === 'x') this.world.setBlock(a, yy, f.z, id);
        else this.world.setBlock(f.x, yy, a, id);
      }
    }
  };

  // Flint and steel inside a frame lights the portal.
  P.lightPortal = function lightPortal(x, y, z) {
    for (const axis of ['x', 'z']) {
      const f = this.portalFrame(x, y, z, axis);
      if (!f) continue;
      this.fillPortal(f, axis === 'x' ? BLOCK.NETHER_PORTAL_X : BLOCK.NETHER_PORTAL_Z);
      this.audio.sfx('portalOpen', 0.8, 0);
      return true;
    }
    return false;
  };

  // A block changed next to a portal: if its frame is no longer whole, the portal goes out.
  P.checkPortalsAround = function checkPortalsAround(x, y, z) {
    const w = this.world;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const b = w.getBlock(x + dx, y + dy, z + dz);
      if (!PORTAL_IDS.has(b)) continue;
      const axis = b === BLOCK.NETHER_PORTAL_X ? 'x' : 'z';
      if (this.portalFrame(x + dx, y + dy, z + dz, axis, b)) continue;
      // flood out the whole sheet
      const stack = [[x + dx, y + dy, z + dz]];
      let n = 0;
      while (stack.length && n < 512) {
        const [px, py, pz] = stack.pop();
        if (w.getBlock(px, py, pz) !== b) continue;
        w.setBlock(px, py, pz, 0);
        n++;
        const side = axis === 'x' ? [[1, 0, 0], [-1, 0, 0]] : [[0, 0, 1], [0, 0, -1]];
        for (const [ex, ey, ez] of [...side, [0, 1, 0], [0, -1, 0]]) stack.push([px + ex, py + ey, pz + ez]);
      }
    }
  };

  // The lowest portal block of the closest portal within r (loaded chunks only), or null.
  P.findPortalNear = function findPortalNear(x, y, z, r) {
    const w = this.world;
    let best = null, bd = Infinity;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = x + dx, pz = z + dz;
        if (!w.isChunkReady(px, pz)) continue;
        for (let py = 1; py < 126; py++) {
          if (!PORTAL_IDS.has(w.getBlock(px, py, pz)) || PORTAL_IDS.has(w.getBlock(px, py - 1, pz))) continue;
          const d = dx * dx + dz * dz + (py - y) * (py - y) * 0.25;
          if (d < bd) { bd = d; best = [px, py, pz]; }
        }
      }
    }
    return best;
  };

  // A new 4 x 5 portal near (x, y, z), with a little floor on both sides of it.
  P.buildPortal = function buildPortal(x, y, z) {
    const w = this.world;
    let by = null;
    const clear = (bx, byy) => {
      for (let a = -1; a <= 2; a++) for (let k = 0; k < 4; k++) for (let s = -1; s <= 1; s++) {
        const b = w.getBlock(bx + a, byy + k, z + s);
        if (IS_SOLID[b] || IS_LIQUID[b]) return false;
      }
      for (let a = 0; a <= 1; a++) { const b = w.getBlock(bx + a, byy - 1, z); if (!IS_SOLID[b]) return false; }
      return true;
    };
    if (this.dimension === DIM.OVERWORLD) {
      by = Math.max(52, w.surfaceHeight(x, z) + 1);
    } else {
      for (let d = 0; d < 40 && by === null; d++) {
        for (const yy of [y - d, y + d]) if (yy > 33 && yy < 118 && clear(x, yy)) { by = yy; break; }
      }
      if (by === null) by = Math.max(34, Math.min(100, y));
    }
    const OBS = BLOCK.OBSIDIAN;
    // room around it, and a floor to step out onto
    for (let a = -2; a <= 3; a++) for (let s = -1; s <= 1; s++) {
      for (let k = 0; k < 4; k++) if (w.getBlock(x + a, by + k, z + s) !== 0) w.setBlock(x + a, by + k, z + s, 0);
      if (!IS_SOLID[w.getBlock(x + a, by - 1, z + s)] && Math.abs(a - 0.5) < 2.6) w.setBlock(x + a, by - 1, z + s, OBS);
    }
    for (let a = -1; a <= 2; a++) { w.setBlock(x + a, by - 1, z, OBS); w.setBlock(x + a, by + 3, z, OBS); }
    for (let k = 0; k < 3; k++) { w.setBlock(x - 1, by + k, z, OBS); w.setBlock(x + 2, by + k, z, OBS); }
    for (let k = 0; k < 3; k++) for (let a = 0; a <= 1; a++) w.setBlock(x + a, by + k, z, BLOCK.NETHER_PORTAL_X);
    return [x, by, z];
  };

  // ---------------------------------------------------------------- the end portal
  // Twelve frames with eyes in a ring around a 3 x 3 hole open the portal.
  P.checkEndPortal = function checkEndPortal(x, y, z) {
    const w = this.world;
    for (let cz = z - 2; cz <= z + 2; cz++) {
      for (let cx = x - 2; cx <= x + 2; cx++) {
        let ok = true;
        for (let i = -1; i <= 1 && ok; i++) {
          for (const [fx, fz] of [[cx + i, cz - 2], [cx + i, cz + 2], [cx - 2, cz + i], [cx + 2, cz + i]]) {
            if (w.getBlock(fx, y, fz) !== BLOCK.END_PORTAL_FRAME_EYE) { ok = false; break; }
          }
        }
        if (!ok) continue;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) w.setBlock(cx + dx, y, cz + dz, BLOCK.END_PORTAL);
        this.audio.sfx('portalOpen', 1, 0);
        this.ui.toast(t('dim.endPortalOpen'), 3500);
        return true;
      }
    }
    return false;
  };

  P.buildEndPlatform = function buildEndPlatform() {
    const w = this.world;
    const [px, py, pz] = END_PLATFORM;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (w.getBlock(px + dx, py - 1, pz + dz) !== BLOCK.OBSIDIAN) w.setBlock(px + dx, py - 1, pz + dz, BLOCK.OBSIDIAN);
      for (let k = 0; k < 3; k++) if (w.getBlock(px + dx, py + k, pz + dz) !== 0) w.setBlock(px + dx, py + k, pz + dz, 0);
    }
    return [px, py, pz];
  };

  // ---------------------------------------------------------------- per frame
  P.updateTravel = function updateTravel(dt) {
    if (this.arrival) { this.finishArrival(); return; }
    if (this.state !== 'playing' || this.spawnPending) return;
    const w = this.world, p = this.player.pos;
    const fx = Math.floor(p[0]), fy = Math.floor(p[1]), fz = Math.floor(p[2]);
    const feet = w.getBlock(fx, fy, fz), body = w.getBlock(fx, fy + 1, fz);
    const inPortal = PORTAL_IDS.has(feet) || PORTAL_IDS.has(body);
    if (inPortal && this.dimension !== DIM.END) {
      if (!this.inPortalLock) {
        this.portalTime = (this.portalTime || 0) + dt;
        const need = PORTAL_WAIT[this.isCreative() ? 'creative' : 'survival'];
        this.ui.setPortal(Math.min(1, this.portalTime / need));
        if (this.portalTime >= need) {
          this.portalTime = 0;
          this.travelTo(this.dimension === DIM.NETHER ? DIM.OVERWORLD : DIM.NETHER, 'portal');
          return;
        }
      }
    } else {
      this.inPortalLock = false;
      if (this.portalTime > 0) {
        this.portalTime = Math.max(0, this.portalTime - dt * 2);
        this.ui.setPortal(this.portalTime / PORTAL_WAIT.survival);
      }
    }
    if (feet === BLOCK.END_PORTAL && p[1] - fy < 0.8) {
      if (this.dimension === DIM.OVERWORLD) this.travelTo(DIM.END, 'endPortal');
      else if (this.dimension === DIM.END) {
        this.travelTo(DIM.OVERWORLD, 'home');
        if (this.endState && this.endState.dragonDead && !this.endState.creditsShown) {
          this.endState.creditsShown = true;
          this.ui.toast(t('dim.victory'), 6000);
        }
      }
    }
    // falling out of the End's islands
    if (this.dimension === DIM.END && p[1] < -30 && this.isCreative()) this.player.pos[1] = END_SURFACE + 20;
  };

  // ---------------------------------------------------------------- the End's dragon
  P.endHost = function endHost() {
    return !this.mp || this.mp.endHost === this.mp.id;
  };

  P.updateEnd = function updateEnd(dt) {
    if (this.dimension !== DIM.END || !this.sim) { return; }
    const es = this.endState || (this.endState = newEndState());
    const host = this.endHost();
    const gen = this.world.generator;
    if (this.dragon && !this.sim.entities.has(this.dragon.id)) this.dragon.removed = true;
    // a dying dragon is dead as far as the fight goes (no new one takes its place)
    if (this.dragon && this.dragon.deathTime > 0) es.dragonDead = true;
    // the exit portal opens once the dragon is gone and the fountain is loaded (by whoever is here)
    if (es.dragonDead && !es.portalOpen && !(this.dragon && !this.dragon.removed) && this.chunksReadyAround(0, 0, 1)) this.openExitPortal();
    if (host && !es.dragonDead && this.loadingDone) {
      if (!this.dragon || this.dragon.removed) {
        this.dragon = this.sim.spawnDragon(0.5, 92, 60.5, es.dragonHp);
        this.audio.sfx('dragon', 1, 0);
      }
      // crystals on the pillars that still have one
      gen.pillars().forEach(([px, pz, , top], i) => {
        if (!es.crystals[i] || !this.world.isChunkReady(px, pz)) return;
        for (const e of this.sim.entities.values()) if (e.type === 'end_crystal' && e.variant === i && !e.removed) return;
        this.sim.spawnCrystal(px + 0.5, top + 2, pz + 0.5, i);
      });
      es.dragonHp = Math.max(0, this.dragon.health);
    }
    // the boss bar: our own dragon's health, or what the host last reported
    let hp = null;
    if (!es.dragonDead) {
      if (host && this.dragon && !this.dragon.removed) hp = this.dragon.health;
      else if (!host) for (const e of this.sim.entities.values()) if (e.type === 'ender_dragon') { hp = es.dragonHp; break; }
    }
    this.ui.setBoss(hp === null ? null : { name: t('boss.dragon'), frac: Math.max(0, hp / DRAGON_MAX) });
    if (this.mp && host) {
      this.endSendTimer = (this.endSendTimer || 0) - dt;
      if (this.endSendTimer <= 0) { this.endSendTimer = 2; this.mp.net.send({ t: 'end', s: es }); }
    }
    // now and then, a roar
    this.roarTimer = (this.roarTimer || 8) - dt;
    if (this.roarTimer <= 0 && hp !== null) { this.roarTimer = 14 + Math.random() * 12; this.audio.sfx('dragon', 0.6, 0); }
  };

  P.handleEndEvent = function handleEndEvent(e) {
    const es = this.endState || (this.endState = newEndState());
    if (e.type === 'crystalDeath') {
      if (e.index >= 0 && e.index < es.crystals.length) es.crystals[e.index] = false;
      if (this.mp) this.mp.net.send({ t: 'end', s: es });
    } else if (e.type === 'bossDeath') {
      es.dragonDead = true;
      es.dragonHp = 0;
      this.ui.toast(t('boss.slain'), 5000);
      this.audio.sfx('dragon', 1, 0);
      if (this.mp) this.mp.net.send({ t: 'end', s: es, slain: true });
    } else if (e.type === 'dragonGone') {
      this.openExitPortal();
      for (let i = 0; i < 12; i++) this.particles.burst(Math.floor(e.pos[0] + (Math.random() - 0.5) * 6), Math.floor(e.pos[1] + Math.random() * 3), Math.floor(e.pos[2] + (Math.random() - 0.5) * 6), BLOCK.PURPLE_WOOL, 1, 1);
    }
  };

  // The fountain fills with portal and the egg appears on its pillar.
  P.openExitPortal = function openExitPortal() {
    const es = this.endState || (this.endState = newEndState());
    if (this.dimension !== DIM.END || !this.chunksReadyAround(0, 0, 1)) return; // updateEnd retries
    const w = this.world, y0 = END_SURFACE + 1;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const d = Math.hypot(dx, dz);
      if (d <= 2.5 && (dx || dz) && w.getBlock(dx, y0, dz) === 0) w.setBlock(dx, y0, dz, BLOCK.END_PORTAL);
    }
    if (!es.portalOpen && w.getBlock(0, y0 + 4, 0) === 0) w.setBlock(0, y0 + 4, 0, BLOCK.DRAGON_EGG);
    es.portalOpen = true;
    if (this.mp) this.mp.net.send({ t: 'end', s: es });
  };
}
