// Building blocks and the things kept in them: blocks that face a way (stairs, chests, furnaces,
// ladders...), slabs that stack into a full block, doors, fence gates and trapdoors that open,
// chests and furnaces (block entities: what they hold lives beside the world, per dimension),
// signs you write on, buckets of water and lava, and saplings that grow into trees (bone meal
// helps). Installed as methods on Game.prototype.

import {
  BLOCK, BLOCKS, IS_SOLID, IS_OPAQUE, IS_LIQUID, IS_RAIL, SHAPE, SHAPE_OF, MODEL_OF, MODELS_BY_NAME, FACING, facingOf, opposite, COLLIDE_KIND, WORLD_HEIGHT,
} from '../world/blocks.js';
import { ITEM, blockDrops } from '../sim/items.js';
import { newEntity, entityKey, parseKey, tickFurnace, furnaceLit, tickBrewing, contentsOf, serializeEntity, loadEntity, loadEntities, serializeEntities } from '../sim/containers.js';
import { TerrainGenerator2 } from '../world/generator2.js';
import { GROUND_DIMS } from '../world/dimensions.js';
import { rollLoot } from '../sim/loot.js';
import { mulberry32, hash3 } from '../world/noise.js';
import { raycast } from './player.js';
import { t } from '../ui/i18n.js';

const M = MODELS_BY_NAME;
const SOIL = new Set([BLOCK.GRASS, BLOCK.DIRT, BLOCK.SNOWY_GRASS, BLOCK.FARMLAND]);
const LEAVES = new Set(BLOCKS.filter((d) => d.key.endsWith('_leaves')).map((d) => d.id));
const SAPLINGS = new Set(BLOCKS.filter((d) => d.sapling).map((d) => d.id));
const DOOR_ITEM = { [BLOCK.OAK_DOOR]: ITEM.OAK_DOOR, [BLOCK.BIRCH_DOOR]: ITEM.BIRCH_DOOR, [BLOCK.SPRUCE_DOOR]: ITEM.SPRUCE_DOOR, [BLOCK.IRON_DOOR]: ITEM.IRON_DOOR };
// crops bone meal hurries along: [first stage, last stage]
const BONE_CROPS = [[BLOCK.WHEAT_0, BLOCK.WHEAT_3], [BLOCK.CARROTS_0, BLOCK.CARROTS_3], [BLOCK.POTATOES_0, BLOCK.POTATOES_3]];
const SAPLING_GROWTH = 0.12; // chance per crop tick (48 a day)

// which block entity a block keeps
export function entityKindOf(id) {
  const d = BLOCKS[id];
  if (!d) return null;
  if (d.container) return d.container;
  if (d.sign) return 'sign';
  return null;
}

export function installBuilding(Game) {
  const P = Game.prototype;

  // ---------------------------------------------------------------- block entities
  P.setupBlockEntities = function setupBlockEntities(data) {
    const saved = (data && data.blockEntities) || {};
    // (every dimension with ground: the overworld, the Nether, the End, the Moon and Mars)
    this.bents = {};
    for (const d of GROUND_DIMS) this.bents[d] = loadEntities(saved[d]);
    this.openBlock = null;
    this.signLayers = new Map();
  };

  P.serializeBlockEntities = function serializeBlockEntities() {
    const out = {};
    for (const d of GROUND_DIMS) out[d] = serializeEntities(this.bents && this.bents[d]);
    return out;
  };

  P.entitiesHere = function entitiesHere() {
    const d = this.dimension || 0;
    if (!this.bents) this.setupBlockEntities(null);
    return this.bents[d] || (this.bents[d] = new Map());
  };

  P.blockEntity = function blockEntity(x, y, z, create = false) {
    const m = this.entitiesHere();
    const k = entityKey(x, y, z);
    let e = m.get(k);
    if (!e && create) {
      const kind = entityKindOf(this.world.getBlock(x, y, z));
      if (kind) { e = newEntity(kind); m.set(k, e); }
    }
    return e || null;
  };

  // A block changed (here or by another player): an entity whose block is gone goes with it,
  // spilling what it held (in multiplayer the server does the spilling, for everyone).
  P.blockEntityChanged = function blockEntityChanged(x, y, z, id) {
    const m = this.bents && this.bents[this.dimension || 0];
    if (!m) return;
    const k = entityKey(x, y, z);
    const e = m.get(k);
    if (!e || entityKindOf(id) === e.kind) return;
    m.delete(k);
    if (this.openBlock && this.openBlock.key === k) this.closeInventory();
    if (!this.mp) for (const [item, n, wear, ench] of contentsOf(e)) this.sim.dropItem(item, n, x + 0.5, y + 0.5, z + 0.5, null, wear, { ench });
  };

  // ---------------------------------------------------------------- chests and furnaces
  P.openContainer = function openContainer(x, y, z) {
    const w = this.world;
    const b = w.getBlock(x, y, z);
    const kind = entityKindOf(b);
    if (kind === 'enchant') { this.swing = 1; return this.openEnchanting(x, y, z); }
    if (kind !== 'chest' && kind !== 'furnace' && kind !== 'brewing') return false;
    const key = entityKey(x, y, z);
    this.swing = 1;
    // a chest a structure left behind: what is in it is decided the first time it is opened
    const st = w.getState(x, y, z);
    const loot = kind === 'chest' ? st >> 4 : 0;
    if (loot) w.setBlock(x, y, z, b, { state: st & 15 });
    if (this.mp) {
      // the server lends it to one player at a time (and fills a loot chest, once)
      if (loot) this.flushEdits();
      this.mp.net.send({ t: 'open', k: key, d: this.dimension || 0, ...(loot ? { loot } : {}) });
      this.mp.opening = { key, x, y, z, kind, at: performance.now() };
      return true;
    }
    let e = this.blockEntity(x, y, z, false);
    if (!e) {
      e = this.blockEntity(x, y, z, true);
      const slots = loot && e ? rollLoot(loot, w.seed, x, y, z) : null;
      if (slots) e.slots = slots;
      w.dirtyEdits = true;
    }
    this.showContainer({ key, x, y, z, kind }, e);
    return true;
  };

  P.showContainer = function showContainer(ob, e) {
    if (!e) return;
    this.openBlock = { ...ob, dim: this.dimension || 0 };
    this.inventory.container = e;
    this.inventory.onContainerChange = () => this.containerChanged();
    this.audio.sfx(ob.kind === 'furnace' ? 'furnace' : 'chestOpen', ob.kind === 'brewing' ? 0.35 : 0.7, 0);
    this.openInventory();
  };

  // multiplayer: the server's answer to 'open'
  P.onContainerReply = function onContainerReply(m) {
    const op = this.mp && this.mp.opening;
    if (!op || op.key !== m.k) return;
    this.mp.opening = null;
    if (m.busy) { this.ui.toast(t('cont.busy', { name: m.busy }), 2500); return; }
    if (this.state !== 'playing') { this.mp.net.send({ t: 'close', k: op.key, d: this.dimension || 0, c: m.c || null }); return; }
    const e = loadEntity(m.c) || newEntity(op.kind);
    this.showContainer(op, e);
  };

  P.containerChanged = function containerChanged() {
    const ob = this.openBlock;
    if (!ob) return;
    if (this.mp) { this.mp.contDirty = true; return; }
    this.world.dirtyEdits = true;
  };

  // Called when the inventory screen closes.
  P.closeContainer = function closeContainer() {
    const ob = this.openBlock;
    if (!ob) return;
    const e = this.inventory.container;
    this.openBlock = null;
    this.inventory.container = null;
    this.inventory.onContainerChange = null;
    if (ob.temp) {
      // an enchanting table keeps nothing: what was left on it comes back; a villager is free again
      if (e && e.kind === 'enchant') {
        for (const s of e.slots) {
          if (!s) continue;
          const left = this.inventory.add(s.id, s.count, s.wear || 0, s.ench || null);
          if (left > 0) this.throwStack({ ...s, count: left });
        }
      }
      if (e && e.kind === 'trade' && e.villager) e.villager.trading = null;
      return;
    }
    if (ob.kind === 'chest') this.audio.sfx('chestClose', 0.6, 0);
    if (this.mp) this.mp.net.send({ t: 'close', k: ob.key, d: ob.dim, c: serializeEntity(e) });
  };

  // Furnaces cook in loaded chunks (on a server, the server runs the ones nobody has open; the
  // one we have open runs here and is sent back).
  P.updateFurnaces = function updateFurnaces(dt) {
    if (!this.world || !this.bents) return;
    const mp = this.mp;
    const box = this.openBlock && this.inventory.container;
    if (box && box.kind === 'furnace' && this.state === 'inventory') this.ui.renderFurnaceProgress(box);
    if (box && box.kind === 'brewing' && this.state === 'inventory') this.ui.renderBrewingProgress(box);
    if (mp) {
      const ob = this.openBlock;
      if (ob && (ob.kind === 'furnace' || ob.kind === 'brewing') && this.inventory.container) this.runFurnace(ob.x, ob.y, ob.z, this.inventory.container, dt);
      if (ob && mp.contDirty) {
        mp.contTimer = (mp.contTimer || 0) - dt;
        if (mp.contTimer <= 0) {
          mp.contTimer = 0.25;
          mp.contDirty = false;
          mp.net.send({ t: 'cput', k: ob.key, d: ob.dim, c: serializeEntity(this.inventory.container) });
        }
      }
      return;
    }
    this.furnaceTimer = (this.furnaceTimer || 0) + dt;
    if (this.furnaceTimer < 0.1) return;
    const step = this.furnaceTimer;
    this.furnaceTimer = 0;
    for (const [k, e] of this.entitiesHere()) {
      if (e.kind !== 'furnace' && e.kind !== 'brewing') continue;
      const [x, y, z] = parseKey(k);
      if (!this.world.isChunkReady(x, z)) continue;
      this.runFurnace(x, y, z, e, step);
    }
  };

  P.runFurnace = function runFurnace(x, y, z, e, dt) {
    if (e.kind === 'brewing') {
      const before = e.brew;
      if (!tickBrewing(e, dt)) return;
      if (before > 0 && e.brew === 0 && this.openBlock && this.inventory.container === e) this.audio.sfx('fizz', 0.4, 0);
      if (this.openBlock && this.inventory.container === e) { this.refreshInventoryUI(); this.containerChanged(); }
      else if (!this.mp) this.world.dirtyEdits = true;
      return;
    }
    const wasLit = furnaceLit(e);
    const changed = tickFurnace(e, dt);
    const lit = furnaceLit(e);
    if (lit !== wasLit) {
      const b = this.world.getBlock(x, y, z);
      if (b === BLOCK.FURNACE || b === BLOCK.LIT_FURNACE) this.world.setBlock(x, y, z, lit ? BLOCK.LIT_FURNACE : BLOCK.FURNACE, { state: this.world.getState(x, y, z) });
    }
    if (changed) {
      if (this.openBlock && this.inventory.container === e) { this.refreshInventoryUI(); this.containerChanged(); }
      else if (!this.mp) this.world.dirtyEdits = true;
    }
  };

  // ---------------------------------------------------------------- placing
  // The block (and state) that goes at (x, y, z) when `id` is placed against `hit`, or null when
  // it can't go there.
  P.placementFor = function placementFor(id, hit, x, y, z) {
    const w = this.world;
    const d = BLOCKS[id];
    const f = this.player.forward();
    const look = facingOf(f[0], f[2]);
    const n = hit.normal;
    const upper = n[1] === -1 || (n[1] === 0 && hit.point && hit.point[1] - Math.floor(hit.point[1]) > 0.5);
    const below = w.getBlock(x, y - 1, z);
    if (SAPLINGS.has(id)) return SOIL.has(below) ? { id, state: 0 } : null;
    if (d.container || d.facing && d.shape === SHAPE.CUBE) return { id, state: opposite(look) };
    switch (MODEL_OF[id]) {
      case M.slab: return { id, state: upper ? 1 : 0 };
      case M.stairs: return { id, state: look | (upper ? 4 : 0) };
      case M.gate: return { id, state: look };
      case M.trapdoor: return { id, state: look | (upper ? 8 : 0) };
      case M.ladder: {
        if (n[1] !== 0) return null;
        const wall = facingOf(-n[0], -n[2]);
        const [dx, dz] = FACING[wall];
        return IS_OPAQUE[w.getBlock(x + dx, y, z + dz)] ? { id, state: wall } : null;
      }
      case M.vine: {
        if (n[1] !== 0) return null;
        const wall = facingOf(-n[0], -n[2]);
        const [dx, dz] = FACING[wall];
        const on = w.getBlock(x + dx, y, z + dz);
        return IS_SOLID[on] || LEAVES.has(on) ? { id, state: wall } : null;
      }
      case M.plate: return COLLIDE_KIND[below] === 1 ? { id, state: 0 } : null;
      default:
        if (IS_RAIL[id]) return COLLIDE_KIND[below] === 1 ? { id, state: this.railShapeAt(x, y, z, look) } : null;
        return { id, state: 0 };
    }
  };

  // A slab put on a slab of the same kind (from above onto a bottom one, from below onto a top
  // one, or into a cell holding one) makes the full block.
  P.slabMerge = function slabMerge(id, hit) {
    const w = this.world;
    const d = BLOCKS[id];
    const tryAt = (x, y, z, needTop) => {
      if (w.getBlock(x, y, z) !== id) return false;
      const top = w.getState(x, y, z) & 1;
      if (needTop !== null && !!top !== needTop) return false;
      if (this.player.intersectsBlock(x, y, z)) return false;
      w.setBlock(x, y, z, d.full);
      return true;
    };
    if (hit.block === id && hit.normal[1] === 1 && tryAt(hit.x, hit.y, hit.z, false)) return true;
    if (hit.block === id && hit.normal[1] === -1 && tryAt(hit.x, hit.y, hit.z, true)) return true;
    const x = hit.x + hit.normal[0], y = hit.y + hit.normal[1], z = hit.z + hit.normal[2];
    return tryAt(x, y, z, null);
  };

  // Things that stand on or hang from a block drop when it goes: plants, torches, doors, signs,
  // ladders and wall signs.
  P.breakAttached = function breakAttached(x, y, z, drops) {
    const w = this.world;
    const pop = (ax, ay, az) => {
      const b = w.getBlock(ax, ay, az);
      if (!b) return;
      if (MODEL_OF[b] === M.door) { this.breakDoor(ax, ay, az, b, drops); return; }
      w.setBlock(ax, ay, az, 0);
      if (drops && !this.isCreative()) for (const [id, n] of blockDrops(b)) this.sim.dropItem(id, n, ax + 0.5, ay + 0.3, az + 0.5);
    };
    const above = w.getBlock(x, y + 1, z);
    const shape = SHAPE_OF[above];
    if (shape === SHAPE.CROSS || shape === SHAPE.TORCH || MODEL_OF[above] === M.sign || (MODEL_OF[above] === M.door && !(w.getState(x, y + 1, z) & 8))) pop(x, y + 1, z);
    for (let k = 0; k < 4; k++) {
      const [dx, dz] = FACING[k];
      const b = w.getBlock(x + dx, y, z + dz);
      const m = MODEL_OF[b];
      // a ladder or wall sign facing its wall (this block) back the other way
      if ((m === M.ladder || m === M.wall_sign) && (w.getState(x + dx, y, z + dz) & 3) === opposite(k)) pop(x + dx, y, z + dz);
    }
  };

  // ---------------------------------------------------------------- doors, gates, trapdoors
  P.placeDoor = function placeDoor(hit, def) {
    const w = this.world;
    let { x, y, z } = hit;
    if (!BLOCKS[hit.block].replaceable) { x += hit.normal[0]; y += hit.normal[1]; z += hit.normal[2]; }
    const free = (ax, ay, az) => BLOCKS[w.getBlock(ax, ay, az)].replaceable && !this.player.intersectsBlock(ax, ay, az);
    if (!free(x, y, z) || !free(x, y + 1, z) || COLLIDE_KIND[w.getBlock(x, y - 1, z)] !== 1) return true;
    const f = this.player.forward();
    const look = facingOf(f[0], f[2]);
    // a door beside another of its kind hinges on the far side: a double door
    const [lx, lz] = FACING[(look + 3) & 3];
    const left = w.getBlock(x + lx, y, z + lz);
    const hinge = left === def.block && !(w.getState(x + lx, y, z + lz) & 16) ? 16 : 0;
    w.setBlock(x, y, z, def.block, { state: look | hinge });
    w.setBlock(x, y + 1, z, def.block, { state: look | hinge | 8 });
    this.audio.play('place', BLOCKS[def.block].ironDoor ? 'metal' : 'wood');
    this.swing = 1;
    if (!this.isCreative()) this.inventory.consume(this.selected);
    return true;
  };

  P.breakDoor = function breakDoor(x, y, z, b, drops) {
    const w = this.world;
    const upper = w.getState(x, y, z) & 8;
    // (either half: whichever is still here)
    const oy = upper ? y - 1 : y + 1;
    if (w.getBlock(x, oy, z) === b) w.setBlock(x, oy, z, 0);
    if (w.getBlock(x, y, z) === b) w.setBlock(x, y, z, 0);
    if (drops && !this.isCreative() && DOOR_ITEM[b]) this.sim.dropItem(DOOR_ITEM[b], 1, x + 0.5, y + 0.4, z + 0.5);
  };

  P.toggleDoor = function toggleDoor(x, y, z, b) {
    const w = this.world;
    const s = w.getState(x, y, z);
    const oy = s & 8 ? y - 1 : y + 1;
    const open = !(s & 4);
    const flip = (v) => (open ? v | 4 : v & ~4);
    w.setBlock(x, y, z, b, { state: flip(s) });
    if (w.getBlock(x, oy, z) === b) w.setBlock(x, oy, z, b, { state: flip(w.getState(x, oy, z)) });
    this.audio.sfx(open ? 'doorOpen' : 'doorClose', 0.8, 0);
    this.swing = 1;
  };

  // gates swing away from whoever opens them
  P.toggleGate = function toggleGate(x, y, z, b) {
    const w = this.world;
    let s = w.getState(x, y, z);
    const open = !(s & 4);
    if (open) {
      const f = this.player.forward();
      const look = facingOf(f[0], f[2]);
      if ((look & 1) === (s & 1)) s = (s & ~3) | look;
    }
    w.setBlock(x, y, z, b, { state: open ? s | 4 : s & ~4 });
    this.audio.sfx(open ? 'doorOpen' : 'doorClose', 0.7, 0);
    this.swing = 1;
  };

  P.toggleTrapdoor = function toggleTrapdoor(x, y, z, b) {
    const s = this.world.getState(x, y, z);
    const open = !(s & 4);
    this.world.setBlock(x, y, z, b, { state: open ? s | 4 : s & ~4 });
    this.audio.sfx(open ? 'doorOpen' : 'doorClose', 0.7, 0);
    this.swing = 1;
  };

  // Right click on a block that does something by itself (not while sneaking: then the held
  // block is placed against it). Returns true when it did.
  P.useBlock = function useBlock(hit) {
    const { x, y, z, block: b } = hit;
    const m = MODEL_OF[b];
    if (m === M.door) { if (BLOCKS[b].ironDoor) return false; this.toggleDoor(x, y, z, b); return true; } // iron doors only open for plates
    if (m === M.gate) { this.toggleGate(x, y, z, b); return true; }
    if (m === M.trapdoor) { this.toggleTrapdoor(x, y, z, b); return true; }
    if (BLOCKS[b].container) return this.openContainer(x, y, z);
    if (BLOCKS[b].sign) { this.openSignEditor(x, y, z); return true; }
    return false;
  };

  // ---------------------------------------------------------------- signs
  P.placeSign = function placeSign(hit) {
    const w = this.world;
    const n = hit.normal;
    if (n[1] === -1) return true;
    let { x, y, z } = hit;
    if (!BLOCKS[hit.block].replaceable) { x += n[0]; y += n[1]; z += n[2]; }
    if (!BLOCKS[w.getBlock(x, y, z)].replaceable) return true;
    const f = this.player.forward();
    if (n[1] === 1) {
      if (!IS_SOLID[w.getBlock(x, y - 1, z)]) return true;
      w.setBlock(x, y, z, BLOCK.OAK_SIGN, { state: opposite(facingOf(f[0], f[2])) });
    } else {
      w.setBlock(x, y, z, BLOCK.OAK_WALL_SIGN, { state: facingOf(-n[0], -n[2]) });
    }
    this.audio.play('place', 'wood');
    this.swing = 1;
    if (!this.isCreative()) this.inventory.consume(this.selected);
    this.blockEntity(x, y, z, true);
    this.openSignEditor(x, y, z);
    return true;
  };

  P.openSignEditor = function openSignEditor(x, y, z) {
    const e = this.blockEntity(x, y, z, true);
    if (!e) return;
    this.editingSign = { x, y, z, key: entityKey(x, y, z) };
    this.state = 'sign';
    this.input.enabled = false;
    this.input.keys.clear();
    this.input.buttons.clear();
    this.input.exitLock();
    if (this.touch) this.touch.show(false);
    this.ui.openSignEditor(e.lines);
  };

  P.finishSign = function finishSign(lines) {
    const s = this.editingSign;
    this.editingSign = null;
    if (s) {
      const e = this.blockEntity(s.x, s.y, s.z, true);
      if (e && e.kind === 'sign') {
        const clean = loadEntity({ kind: 'sign', lines });
        e.lines = clean.lines;
        this.signLayers.delete(s.key); // drawn again with the new words
        if (this.mp) this.mp.net.send({ t: 'bent', k: s.key, d: this.dimension || 0, e: serializeEntity(e) });
        else this.world.dirtyEdits = true;
      }
    }
    this.ui.closeSignEditor();
    if (this.state === 'sign') this.play();
  };

  // Signs near the camera, for the entity renderer: where their words go and which sign-texture
  // layer holds them (drawn into the texture when new or changed).
  P.visibleSigns = function visibleSigns(cam) {
    if (!this.bents || !this.renderer.signTextures) return null;
    const out = [];
    const w = this.world;
    for (const [k, e] of this.entitiesHere()) {
      if (e.kind !== 'sign' || !e.lines.some((l) => l)) continue;
      const [x, y, z] = parseKey(k);
      const dx = x + 0.5 - cam[0], dy = y + 0.5 - cam[1], dz = z + 0.5 - cam[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 24 * 24) continue;
      const b = w.getBlock(x, y, z);
      if (!BLOCKS[b].sign) continue;
      const s = w.getState(x, y, z) & 3;
      let nrm, center;
      if (b === BLOCK.OAK_SIGN) {
        const [fx, fz] = FACING[s];
        nrm = [fx, 0, fz];
        center = [x + 0.5 + fx * (1 / 16 + 0.004), y + 0.75, z + 0.5 + fz * (1 / 16 + 0.004)];
      } else {
        const [fx, fz] = FACING[s];
        nrm = [-fx, 0, -fz];
        center = [x + 0.5 + fx * (6 / 16 - 0.004), y + 0.5, z + 0.5 + fz * (6 / 16 - 0.004)];
      }
      // only from the front
      if ((cam[0] - center[0]) * nrm[0] + (cam[2] - center[2]) * nrm[2] <= 0) continue;
      out.push({ key: k, e, d2, center, nrm });
    }
    out.sort((a, b) => a.d2 - b.d2);
    const list = out.slice(0, this.renderer.signTextures.layers);
    // each sign in view keeps a texture layer; those out of view give theirs up
    const inView = new Set(list.map((s) => s.key));
    const taken = new Set();
    for (const [k, l] of this.signLayers) { if (inView.has(k)) taken.add(l.layer); else this.signLayers.delete(k); }
    let next = 0;
    for (const s of list) {
      let l = this.signLayers.get(s.key);
      if (!l) {
        while (taken.has(next)) next++;
        l = { layer: next, text: null };
        taken.add(next);
        this.signLayers.set(s.key, l);
      }
      const text = s.e.lines.join('\n');
      if (l.text !== text) { l.text = text; this.renderer.drawSign(l.layer, s.e.lines); }
      s.layer = l.layer;
      const [sl, bl] = w.getLight(...parseKey(s.key));
      s.light = [sl / 15, bl / 15];
    }
    return list;
  };

  // ---------------------------------------------------------------- buckets and milk
  // Returns true when the click was used.
  P.useBucket = function useBucket(def) {
    const p = this.player;
    const w = this.world;
    const reach = this.isCreative() ? 6 : 4.8;
    if (!def.holds) {
      const hit = raycast(w, p.eye, p.forward(), reach, { liquids: true });
      if (!hit || !hit.liquid) return false;
      w.setBlock(hit.x, hit.y, hit.z, 0);
      this.fillHeldBucket(hit.block === BLOCK.WATER ? ITEM.WATER_BUCKET : ITEM.LAVA_BUCKET);
      this.audio.sfx('bucketFill', 0.8, 0);
      this.swing = 1;
      return true;
    }
    const hit = raycast(w, p.eye, p.forward(), reach);
    if (!hit) return false;
    let { x, y, z } = hit;
    const at = w.getBlock(x, y, z);
    if (!BLOCKS[at].replaceable || (IS_LIQUID[at] && w.getState(x, y, z) === 0)) { x += hit.normal[0]; y += hit.normal[1]; z += hit.normal[2]; }
    const cur = w.getBlock(x, y, z);
    if (!BLOCKS[cur].replaceable || (cur === def.holds && w.getState(x, y, z) === 0)) return true;
    this.swing = 1;
    if (def.holds === BLOCK.WATER && this.dimension === 1) {
      // water boils away in the Nether
      this.audio.sfx('fizz', 0.8, 0);
      for (let i = 0; i < 3; i++) this.particles.burst(x, y, z, BLOCK.WHITE_WOOL, 1, 0.3, 6);
    } else {
      w.setBlock(x, y, z, def.holds);
      this.audio.sfx('bucketEmpty', 0.8, 0);
    }
    if (!this.isCreative()) { const s = this.heldSlot(); if (s) { s.id = ITEM.BUCKET; s.wear = 0; this.inventory.changed(); } }
    return true;
  };

  // The held empty bucket becomes a full one (one of a stack: the full one goes elsewhere).
  P.fillHeldBucket = function fillHeldBucket(full) {
    if (this.isCreative()) return;
    const s = this.heldSlot();
    if (!s) return;
    if (s.count <= 1) { s.id = full; s.wear = 0; this.inventory.changed(); return; }
    this.inventory.consume(this.selected);
    const left = this.inventory.add(full, 1);
    if (left) this.throwStack({ id: full, count: 1, wear: 0 });
  };

  // Water washing away a torch or a plant leaves the item behind.
  P.onFluidEvent = function onFluidEvent(type, x, y, z, id) {
    if (type === 'fizz') {
      const e = this.camera ? this.camera.pos : this.player.pos;
      const d = Math.hypot(x - e[0], y - e[1], z - e[2]);
      this.audio.sfx('fizz', Math.max(0, 1 - d / 20) * 0.6, 0);
      this.particles.burst(x, y, z, BLOCK.WHITE_WOOL, 1, 0.3, 5);
    } else if (type === 'wash' && !this.isCreative()) {
      for (const [item, n] of blockDrops(id)) this.sim.dropItem(item, n, x + 0.5, y + 0.3, z + 0.5);
    }
  };

  // ---------------------------------------------------------------- saplings and bone meal
  P.growTree = function growTree(x, y, z, sapling) {
    const w = this.world;
    const gen = this.treeGen || (this.treeGen = new TerrainGenerator2(this.world.seed));
    const kind = BLOCKS[sapling].sapling;
    // four saplings in a square grow a big tree (dark oaks only grow that way)
    let big = null;
    if (kind === 'jungle' || kind === 'dark_oak') {
      for (const [ox, oz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
        let all = true;
        for (let dz = 0; dz < 2 && all; dz++) for (let dx = 0; dx < 2; dx++) if (w.getBlock(x + ox + dx, y, z + oz + dz) !== sapling) { all = false; break; }
        if (all) { big = [x + ox, z + oz]; break; }
      }
      if (kind === 'dark_oak' && !big) return false;
    }
    const cells = big ? [[big[0], big[1]], [big[0] + 1, big[1]], [big[0], big[1] + 1], [big[0] + 1, big[1] + 1]] : [[x, z]];
    // room to grow: a clear trunk
    for (const [cx, cz] of cells) {
      for (let k = 1; k <= 5; k++) {
        const b = w.getBlock(cx, y + k, cz);
        if (b && !BLOCKS[b].replaceable && !LEAVES.has(b)) return false;
      }
    }
    const rnd = mulberry32((hash3(x, y, z, 777) * 4294967296) >>> 0);
    // trees only grow into air, plants and leaves (and their trunk through the sapling and the soil)
    const set = (wx, wy, wz, b, replaceSolid = false, state = 0) => {
      if (wy < 1 || wy > WORLD_HEIGHT - 2) return;
      const cur = w.getBlock(wx, wy, wz);
      const soft = cur === 0 || (BLOCKS[cur].replaceable && !IS_LIQUID[cur]) || LEAVES.has(cur) || SAPLINGS.has(cur);
      if (soft || (replaceSolid && SOIL.has(cur))) w.setBlock(wx, wy, wz, b, state ? { state } : undefined);
    };
    for (const [cx, cz] of cells) w.setBlock(cx, y, cz, 0);
    const [bx, bz] = big || [x, z];
    switch (kind) {
      case 'spruce': gen.spruce(set, x, y, z, rnd); break;
      case 'birch': gen.oak(set, x, y, z, rnd, BLOCK.BIRCH_LOG, BLOCK.BIRCH_LEAVES, 5 + Math.floor(rnd() * 2)); break;
      case 'jungle': if (big) gen.megaJungle(set, bx, y, bz, rnd); else gen.jungleTree(set, x, y, z, rnd); break;
      case 'acacia': gen.acacia(set, x, y, z, rnd); break;
      case 'dark_oak': gen.darkOak(set, bx, y, bz, rnd); break;
      case 'cherry': gen.cherryTree(set, x, y, z, rnd); break;
      default: gen.oak(set, x, y, z, rnd, BLOCK.OAK_LOG, BLOCK.OAK_LEAVES, 4 + Math.floor(rnd() * 2));
    }
    for (const [cx, cz] of cells) if (w.getBlock(cx, y, cz) === 0) w.setBlock(cx, y, cz, sapling); // nothing grew after all
    return true;
  };

  // Bone meal: crops grow a stage or more, saplings may shoot up, grass sprouts flowers.
  P.useBoneMeal = function useBoneMeal(hit) {
    const w = this.world;
    const { x, y, z, block: b } = hit;
    let used = false;
    const crop = BONE_CROPS.find(([lo, hi]) => b >= lo && b < hi);
    if (crop) {
      w.setBlock(x, y, z, Math.min(crop[1], b + 1 + Math.floor(Math.random() * 2)));
      used = true;
    } else if (SAPLINGS.has(b)) {
      if (Math.random() < 0.45) this.growTree(x, y, z, b);
      used = true;
    } else if (b === BLOCK.GRASS && w.getBlock(x, y + 1, z) === 0) {
      for (let i = 0; i < 12; i++) {
        const ax = x + Math.round((Math.random() - 0.5) * 6), az = z + Math.round((Math.random() - 0.5) * 6);
        for (let ay = y + 1; ay >= y - 1; ay--) {
          if (w.getBlock(ax, ay - 1, az) === BLOCK.GRASS && w.getBlock(ax, ay, az) === 0) {
            const r = Math.random();
            w.setBlock(ax, ay, az, r < 0.75 ? BLOCK.TALL_GRASS : r < 0.88 ? BLOCK.POPPY : BLOCK.DANDELION);
            break;
          }
        }
      }
      used = true;
    }
    if (!used) return false;
    this.audio.sfx('grow', 0.7, 0);
    for (let i = 0; i < 2; i++) this.particles.burst(x, y + 1, z, BLOCK.LIME_WOOL, 1, 0.6, 5);
    this.swing = 1;
    if (!this.isCreative()) this.inventory.consume(this.selected);
    return true;
  };

  P.saplingTick = function saplingTick(x, y, z, b, tick) {
    if (hash3(x, y, z, tick * 7 + 3) >= SAPLING_GROWTH) return;
    this.growTree(x, y, z, b);
  };
}

export { SAPLINGS };
