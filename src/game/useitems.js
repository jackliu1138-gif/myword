// Using things on the world: sleeping in beds (and placing and breaking them), tilling soil and
// planting wheat (crops grow on the shared clock, so every player sees the same field), lighting
// fires and nether portals with flint and steel, throwing ender pearls and eyes of ender, and
// putting eyes into end portal frames. Installed as methods on Game.prototype.

import { BLOCK, BLOCKS, IS_BED, BED_PARTNER, IS_SOLID, IS_LIQUID } from '../world/blocks.js';
import { ITEM, itemDef, BED_ITEMS } from '../sim/items.js';
import { ARMOR_REF } from '../sim/inventory.js';
import { hash3 } from '../world/noise.js';
import { t, itemName } from '../ui/i18n.js';

const isNight = (tm) => tm > 0.52 && tm < 0.985;
const CROP_TICKS_PER_DAY = 48;
const NEIGHBOURS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export function installUse(Game) {
  const P = Game.prototype;

  // Right click on a block with whatever is held. Returns true when something happened (or the
  // click was used up), so the game doesn't also try to place a block.
  P.useOnBlock = function useOnBlock(hit, def) {
    const w = this.world, b = hit.block;
    const { x, y, z } = hit;
    if (IS_BED[b] && !this.player.sneaking) { this.useBed(x, y, z, b); return true; }
    if (!def) return false;
    if (def.kind === 'eye' && b === BLOCK.END_PORTAL_FRAME) return this.insertEye(x, y, z);
    if (def.kind === 'hoe' && (b === BLOCK.GRASS || b === BLOCK.DIRT || b === BLOCK.SNOWY_GRASS) && hit.normal[1] >= 0) {
      const above = w.getBlock(x, y + 1, z);
      if (above && !BLOCKS[above].replaceable) return false;
      if (above) w.setBlock(x, y + 1, z, 0); // tall grass comes off
      w.setBlock(x, y, z, BLOCK.FARMLAND);
      this.audio.play('place', 'gravel', 0.9);
      this.swing = 1;
      this.wearHeld(def, 1);
      return true;
    }
    if (def.key === 'wheat_seeds' && b === BLOCK.FARMLAND && hit.normal[1] === 1 && w.getBlock(x, y + 1, z) === 0) {
      w.setBlock(x, y + 1, z, BLOCK.WHEAT_0);
      this.audio.play('place', 'grass', 0.8);
      this.swing = 1;
      if (!this.isCreative()) this.inventory.consume(this.selected);
      return true;
    }
    if (def.kind === 'igniter') return this.useFlint(hit, def);
    if (def.kind === 'bed') return this.placeBed(hit, def);
    return false;
  };

  P.wearHeld = function wearHeld(def, n) {
    if (this.isCreative() || !def || !def.durability) return;
    if (this.inventory.wear(this.selected, n)) this.toolBroke(def);
  };

  // ---------------------------------------------------------------- beds
  // The other half of the bed at (x, y, z), or null.
  P.bedPartner = function bedPartner(x, y, z, b) {
    const want = BED_PARTNER[b];
    for (const [dx, dz] of NEIGHBOURS) if (this.world.getBlock(x + dx, y, z + dz) === want) return [x + dx, y, z + dz];
    return null;
  };

  // A bed goes down foot first, its head in the direction the player faces.
  P.placeBed = function placeBed(hit, def) {
    const w = this.world;
    let { x, y, z } = hit;
    if (!BLOCKS[hit.block].replaceable) { x += hit.normal[0]; y += hit.normal[1]; z += hit.normal[2]; }
    const f = this.player.forward();
    const [dx, dz] = Math.abs(f[0]) > Math.abs(f[2]) ? [Math.sign(f[0]), 0] : [0, Math.sign(f[2]) || 1];
    const free = (ax, ay, az) => {
      const c = w.getBlock(ax, ay, az);
      return BLOCKS[c].replaceable && !IS_LIQUID[c] && IS_SOLID[w.getBlock(ax, ay - 1, az)] && !this.player.intersectsBlock(ax, ay, az);
    };
    if (!free(x, y, z) || !free(x + dx, y, z + dz)) return true;
    w.setBlock(x, y, z, def.foot);
    w.setBlock(x + dx, y, z + dz, def.head);
    this.audio.play('place', 'cloth');
    this.swing = 1;
    if (!this.isCreative()) this.inventory.consume(this.selected);
    return true;
  };

  // Breaking either half takes the whole bed; one bed item drops.
  P.breakBed = function breakBed(x, y, z, b, drops) {
    const other = this.bedPartner(x, y, z, b);
    if (other) this.world.setBlock(other[0], other[1], other[2], 0);
    if (drops && !this.isCreative()) {
      const color = BLOCKS[b].bed.color;
      this.sim.dropItem(BED_ITEMS[color], 1, x + 0.5, y + 0.4, z + 0.5);
    }
    if (this.sleeping) this.wakeUp();
  };

  P.useBed = function useBed(x, y, z, b) {
    // beds explode anywhere but the overworld
    if (this.dimension !== 0) {
      const other = this.bedPartner(x, y, z, b);
      this.world.setBlock(x, y, z, 0);
      if (other) this.world.setBlock(other[0], other[1], other[2], 0);
      this.sim.explode(x + 0.5, y + 0.5, z + 0.5, 4.5, null);
      this.lastDamageSource = 'bed';
      return;
    }
    const spawn = [x + 0.5, y + 0.6, z + 0.5];
    const prev = this.spawnPoint;
    if (!prev || Math.floor(prev[0]) !== x || Math.floor(prev[2]) !== z) {
      this.spawnPoint = spawn;
      this.ui.toast(t('bed.spawnSet'), 2200);
    }
    if (!(isNight(this.dayTime) || this.weather.storm > 0.55)) { this.ui.toast(t('bed.day'), 2400); return; }
    for (const e of this.sim.entities.values()) {
      if (e.kind !== 'mob' || !e.hostile || e.deathTime > 0 || e.def.boss) continue;
      const q = e.body.pos;
      if (Math.abs(q[0] - x) < 8 && Math.abs(q[1] - y) < 5 && Math.abs(q[2] - z) < 8) { this.ui.toast(t('bed.monsters'), 2400); return; }
    }
    const head = BLOCKS[b].bed.head ? [x, y, z] : this.bedPartner(x, y, z, b) || [x, y, z];
    const foot = BLOCKS[b].bed.head ? this.bedPartner(x, y, z, b) || [x, y, z] : [x, y, z];
    this.sleeping = { x, y, z, t: 0, head, foot };
    this.breaking = null;
    this.bowDraw = 0;
    this.player.vel = [0, 0, 0];
    // lie along the bed, head on the pillow (other players see us there)
    this.player.yaw = Math.atan2(-(head[0] - foot[0]), -(head[2] - foot[2]));
    this.player.pos = [(head[0] + foot[0]) / 2 + 0.5, head[1] + 0.5625, (head[2] + foot[2]) / 2 + 0.5];
    if (this.mp) this.mp.net.send({ t: 'sleep', on: true });
    this.ui.setSleep({ fade: 0, sleepers: this.mpSleepers || null });
  };

  P.updateSleep = function updateSleep(dt) {
    const s = this.sleeping;
    if (!s) return;
    s.t += dt;
    const me = this.me();
    if (!IS_BED[this.world.getBlock(s.x, s.y, s.z)] || (me && (me.dead || me.hurtTime > 0.45))) { this.wakeUp(); return; }
    this.player.vel = [0, 0, 0];
    this.player.pos = [(s.head[0] + s.foot[0]) / 2 + 0.5, s.head[1] + 0.5625, (s.head[2] + s.foot[2]) / 2 + 0.5];
    this.ui.setSleep({ fade: Math.min(1, s.t / 2.2), sleepers: this.mp ? this.mpSleepers || null : null });
    // alone: a moment of darkness and it is morning; with others, the server decides
    if (!this.mp && s.t >= 2.6) {
      this.skipNight();
      this.wakeUp(true);
    }
  };

  P.skipNight = function skipNight() {
    if (this.dayTime > 0.3) this.dayCount = (this.dayCount || 0) + 1;
    this.dayTime = 0.002;
    // and the sky clears
    const w = this.weather;
    w.target = 0; w.stormTarget = 0; w.timer = 360 + Math.random() * 540;
  };

  P.wakeUp = function wakeUp(morning = false) {
    const s = this.sleeping;
    if (!s) return;
    this.sleeping = null;
    this.ui.setSleep(null);
    if (this.mp) this.mp.net.send({ t: 'sleep', on: false });
    // stand up beside the bed
    const w = this.world;
    for (const [dx, dz] of NEIGHBOURS) {
      for (const base of [s.foot, s.head]) {
        const x = base[0] + dx, y = base[1], z = base[2] + dz;
        if (!IS_SOLID[w.getBlock(x, y, z)] && !IS_SOLID[w.getBlock(x, y + 1, z)] && IS_SOLID[w.getBlock(x, y - 1, z)]) {
          this.player.pos = [x + 0.5, y + 0.02, z + 0.5];
          if (morning) this.ui.toast(t('bed.morning'), 2000);
          return;
        }
      }
    }
    this.player.pos = [s.head[0] + 0.5, s.head[1] + 1.05, s.head[2] + 0.5];
    if (morning) this.ui.toast(t('bed.morning'), 2000);
  };

  // ---------------------------------------------------------------- fire, portals, eyes
  P.useFlint = function useFlint(hit, def) {
    const w = this.world;
    const x = hit.x + hit.normal[0], y = hit.y + hit.normal[1], z = hit.z + hit.normal[2];
    if (w.getBlock(x, y, z) !== 0) return true;
    this.audio.sfx('ignite', 0.8, 0);
    this.swing = 1;
    this.wearHeld(def, 1);
    if (this.lightPortal(x, y, z)) return true;
    if (IS_SOLID[w.getBlock(x, y - 1, z)]) w.setBlock(x, y, z, BLOCK.FIRE);
    return true;
  };

  P.insertEye = function insertEye(x, y, z) {
    this.world.setBlock(x, y, z, BLOCK.END_PORTAL_FRAME_EYE);
    if (!this.isCreative()) this.inventory.consume(this.selected);
    this.audio.sfx('eyePlace', 0.9, 0);
    this.swing = 1;
    this.checkEndPortal(x, y, z);
    return true;
  };

  P.nearestStronghold = function nearestStronghold(pos) {
    const g = this.world.generator;
    if (!g.strongholds) return null;
    let best = null, bd = Infinity;
    for (const s of g.strongholds()) {
      const d = Math.hypot(s.x - pos[0], s.z - pos[2]);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };

  // Ender pearls fly off and take their thrower along; eyes of ender point the way.
  P.throwHeld = function throwHeld(def) {
    const p = this.player, e = p.eye, f = p.forward();
    const pos = [e[0] + f[0] * 0.4, e[1] - 0.1, e[2] + f[2] * 0.4];
    if (def.kind === 'pearl') this.sim.throwPearl('local', pos, f);
    else {
      const s = this.dimension === 0 ? this.nearestStronghold(p.pos) : null;
      this.sim.throwEye('local', pos, s ? [s.x + 0.5, s.z + 4.5] : null);
    }
    if (!this.isCreative()) this.inventory.consume(this.selected);
    this.swing = 1;
  };

  // Simulation events about thrown things and fire.
  P.handleUseEvent = function handleUseEvent(e) {
    switch (e.type) {
      case 'pearlLand':
        if (e.owner !== 'local' || !e.pos) break;
        {
          const p = this.player;
          const [x, y, z] = e.pos;
          // land on top of whatever the pearl hit
          let ty = Math.floor(y);
          while (ty < 127 && (IS_SOLID[this.world.getBlock(Math.floor(x), ty, Math.floor(z))] || IS_SOLID[this.world.getBlock(Math.floor(x), ty + 1, Math.floor(z))])) ty++;
          p.pos = [x, ty + 0.01, z];
          p.vel = [0, 0, 0];
          this.audio.sfx('teleport', 0.8, 0);
          this.sim.damagePlayer('local', 5, 'pearl');
          for (let i = 0; i < 3; i++) this.particles.burst(Math.floor(x), ty, Math.floor(z), BLOCK.PURPLE_WOOL, 1, 0.5);
        }
        break;
      case 'eyeTrail':
        this.particles.burst(Math.floor(e.pos[0]), Math.floor(e.pos[1]), Math.floor(e.pos[2]), BLOCK.PURPLE_WOOL, 1, 0.6, 2);
        break;
      case 'eyeDone':
        if (e.owner !== 'local') break;
        if (e.shatter) {
          this.audio.sfx('glassBreak', 0.7, 0);
          this.particles.burst(Math.floor(e.pos[0]), Math.floor(e.pos[1]), Math.floor(e.pos[2]), BLOCK.LIME_WOOL, 1, 0.6);
        } else if (!this.isCreative()) this.sim.dropItem(ITEM.EYE_OF_ENDER, 1, e.pos[0], e.pos[1], e.pos[2], [0, 0, 0]);
        break;
      case 'igniteAt': {
        const x = Math.floor(e.pos[0]), y = Math.floor(e.pos[1]), z = Math.floor(e.pos[2]);
        for (const [ax, ay, az] of [[x, y, z], [x, y + 1, z]]) {
          if (this.world.getBlock(ax, ay, az) === 0 && IS_SOLID[this.world.getBlock(ax, ay - 1, az)]) { this.world.setBlock(ax, ay, az, BLOCK.FIRE); break; }
        }
        break;
      }
      case 'armorHit':
        if (e.id !== 'local') break;
        {
          const inv = this.inventory;
          const n = Math.max(1, Math.floor(e.amount / 4));
          for (let k = 0; k < 4; k++) {
            const s = inv.armor[k];
            if (!s) continue;
            const d = itemDef(s.id);
            if (inv.wear(ARMOR_REF + k, n)) {
              this.audio.sfx('toolBreak', 0.8, 0);
              this.ui.toast(t('toast.toolBroke', { item: itemName(d) }), 2000);
            }
          }
        }
        break;
      default: break;
    }
  };

  // ---------------------------------------------------------------- crops and fire
  // Every changed block passes through here (ours and other players').
  P.onBlockChanged = function onBlockChanged(x, y, z, id) {
    const key = x + ',' + y + ',' + z;
    if (id >= BLOCK.WHEAT_0 && id < BLOCK.WHEAT_3) this.crops.set(key, [x, y, z]); else this.crops.delete(key);
    if (id === BLOCK.FIRE) this.fires.set(key, { x, y, z, until: performance.now() + 4000 + Math.random() * 5000 });
    else this.fires.delete(key);
    // a changed block can break a nether portal's frame
    if (id !== BLOCK.NETHER_PORTAL_X && id !== BLOCK.NETHER_PORTAL_Z && id !== BLOCK.FIRE) this.checkPortalsAround(x, y, z);
    if (this.sleeping && (x === this.sleeping.x && y === this.sleeping.y && z === this.sleeping.z) && !IS_BED[id]) this.wakeUp();
  };

  // Crops and fires recorded in the world's edits (after loading, or planted where we weren't).
  P.scanWorldBlocks = function scanWorldBlocks() {
    this.crops = this.crops || new Map();
    this.fires = this.fires || new Map();
    for (const [key, m] of this.world.edits) {
      const cx = Math.floor(key / 65536) - 32768, cz = (key % 65536) - 32768;
      for (const [i, id] of m) {
        if ((id >= BLOCK.WHEAT_0 && id < BLOCK.WHEAT_3) || id === BLOCK.FIRE) {
          const x = cx * 16 + (i & 15), z = cz * 16 + ((i >> 4) & 15), y = i >> 8;
          const k = x + ',' + y + ',' + z;
          if (id === BLOCK.FIRE) { if (!this.fires.has(k)) this.fires.set(k, { x, y, z, until: performance.now() + 3000 }); }
          else this.crops.set(k, [x, y, z]);
        }
      }
    }
  };

  P.updateBlocks = function updateBlocks(dt) {
    const w = this.world;
    if (!w || !this.crops) return;
    this.rescanTimer = (this.rescanTimer || 0) - dt;
    if (this.rescanTimer <= 0) { this.rescanTimer = 30; this.scanWorldBlocks(); }
    // crops: a chance to grow each 1/48 of a day, decided by the clock every player shares
    const tick = Math.floor(((this.dayCount || 0) + this.dayTime) * CROP_TICKS_PER_DAY);
    if (tick !== this.cropTick) {
      const first = this.cropTick === undefined;
      this.cropTick = tick;
      if (!first) {
        for (const [key, [x, y, z]] of this.crops) {
          if (!w.isChunkReady(x, z)) continue;
          const b = w.getBlock(x, y, z);
          if (b < BLOCK.WHEAT_0 || b >= BLOCK.WHEAT_3) { this.crops.delete(key); continue; }
          const [sl, bl] = w.getLight(x, y + 1, z);
          if (Math.max(sl, bl) < 9) continue;
          if (hash3(x, y, z, tick) < 0.42) w.setBlock(x, y, z, b + 1);
        }
      }
    }
    // fire burns out, except on netherrack and magma
    if (this.fires.size) {
      const now = performance.now();
      for (const [key, f] of this.fires) {
        if (now < f.until) continue;
        if (!w.isChunkReady(f.x, f.z)) continue;
        const below = w.getBlock(f.x, f.y - 1, f.z);
        if (below === BLOCK.NETHERRACK || below === BLOCK.MAGMA_BLOCK) { this.fires.delete(key); continue; }
        this.fires.delete(key);
        if (w.getBlock(f.x, f.y, f.z) === BLOCK.FIRE) w.setBlock(f.x, f.y, f.z, 0);
      }
    }
  };
}
