// Survival and creative play on top of the Game: the inventory, the living world (creatures,
// items, arrows), breaking and placing, fighting, eating, bows, damage, death and respawning.
// Installed as methods on Game.prototype so game.js stays about the frame loop and the UI.

import { Simulation, MAX_HEALTH, MAX_AIR } from '../sim/simulation.js';
import { Inventory, ARMOR_REF } from '../sim/inventory.js';
import { ITEM, itemDef, isBlockItem, blockDrops, breakInfo, RECIPES, SMELT_XP } from '../sim/items.js';
import { raycast } from './player.js';
import { materialOf } from './audio.js';
import { EntityMesh } from '../render/entitymesh.js';
import { buildSkins } from '../render/models.js';
import { buildItemSprites } from '../world/itemsprites.js';
import { BLOCK, BLOCKS, SHAPE, SHAPE_OF, FACE_TEX, IS_SOLID, IS_BED, TINT, MAT, WOOL_COLORS, MODEL_OF, MODELS_BY_NAME, COLLIDE_KIND, IS_RAIL } from '../world/blocks.js';
import { newEndState } from './travel.js';
import { t, itemName } from '../ui/i18n.js';
import { PAD } from './gamepad.js';
import { mat4 } from '../engine/math.js';

const REACH_BLOCK = { creative: 6, survival: 4.8 };
// what silk touch keeps whole, and the ores fortune multiplies
const SILK = new Set([BLOCK.GRASS, BLOCK.SNOWY_GRASS, BLOCK.GLASS, BLOCK.GLASS_PANE, BLOCK.ICE, BLOCK.STONE, BLOCK.COAL_ORE, BLOCK.IRON_ORE, BLOCK.GOLD_ORE, BLOCK.DIAMOND_ORE,
  BLOCK.LAPIS_ORE, BLOCK.EMERALD_ORE, BLOCK.NETHER_QUARTZ_ORE, BLOCK.GLOWSTONE, BLOCK.MELON, BLOCK.BOOKSHELF, BLOCK.GRAVEL, BLOCK.CLAY, BLOCK.OAK_LEAVES, BLOCK.BIRCH_LEAVES,
  BLOCK.SPRUCE_LEAVES, BLOCK.JUNGLE_LEAVES, BLOCK.ACACIA_LEAVES, BLOCK.DARK_OAK_LEAVES, BLOCK.CHERRY_LEAVES, BLOCK.COBWEB, BLOCK.VINE]);
const FORTUNE = new Set([BLOCK.COAL_ORE, BLOCK.DIAMOND_ORE, BLOCK.LAPIS_ORE, BLOCK.EMERALD_ORE, BLOCK.NETHER_QUARTZ_ORE, BLOCK.IRON_ORE, BLOCK.GOLD_ORE, BLOCK.GLOWSTONE, BLOCK.MELON]);
const REACH_HIT = 3.6;
const DEFAULT_CREATIVE = [BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE_BRICKS, BLOCK.OAK_PLANKS, BLOCK.OAK_LOG, BLOCK.GLASS, BLOCK.TORCH, ITEM.DIAMOND_SWORD, ITEM.BOW];
// a new survival world starts with the basics, so the first night is survivable
const STARTER_KIT = [[ITEM.WOODEN_SWORD, 1], [ITEM.WOODEN_PICKAXE, 1], [ITEM.WOODEN_AXE, 1], [ITEM.BREAD, 5], [BLOCK.TORCH, 8]];
const TINT_RGB = {
  [TINT.GRASS]: [0.5, 0.76, 0.33], [TINT.FOLIAGE]: [0.42, 0.7, 0.27], [TINT.BIRCH]: [0.52, 0.68, 0.36], [TINT.SPRUCE]: [0.4, 0.58, 0.4],
};
const MOB_SOUND = {
  zombie: 'zombie', skeleton: 'skeleton', spider: 'spider', cow: 'cow', pig: 'pig', sheep: 'sheep', chicken: 'chicken',
  zombified_piglin: 'zombified_piglin', ghast: 'ghast', blaze: 'blaze', enderman: 'enderman', ender_dragon: 'dragon', end_crystal: 'crystal',
  villager: 'villager', iron_golem: 'golem', wolf: 'wolf', cat: 'cat', horse: 'horse', witch: 'witch', slime: 'slime', phantom: 'phantom',
  pillager: 'pillager', vindicator: 'vindicator', evoker: 'evoker', wither: 'wither', wither_skeleton: 'skeleton', guardian: 'guardian',
  elder_guardian: 'guardian', shulker: 'shulker', cave_spider: 'spider',
};

export function installPlay(Game) {
  const P = Game.prototype;

  // ---------------------------------------------------------------- setup
  P.setupPlay = function setupPlay() {
    const woolColors = {};
    for (const [name, hex] of WOOL_COLORS) {
      const v = parseInt(hex.slice(1), 16);
      woolColors[BLOCK[name.toUpperCase() + '_WOOL']] = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    }
    this.skins = buildSkins(woolColors);
    this.itemSprites = buildItemSprites();
    this.renderer.setEntityTextures(this.skins, this.itemSprites);
    this.entityMesh = new EntityMesh(this.skins, this.itemSprites);
  };

  // Called by loadWorld: the world's rules, the inventory and the simulation.
  P.setupWorldPlay = function setupWorldPlay(data) {
    this.mode = data ? data.mode || 'creative' : this.newWorldMode || 'survival';
    this.difficulty = data ? data.difficulty || 'normal' : this.newWorldDifficulty || 'normal';
    this.inventory = new Inventory();
    if (data && Array.isArray(data.inventory)) this.inventory.load(data.inventory);
    else if (data && Array.isArray(data.hotbar)) data.hotbar.forEach((id, i) => { if (id) this.inventory.slots[i] = { id, count: 1, wear: 0 }; });
    else if (this.mode === 'creative') DEFAULT_CREATIVE.forEach((id, i) => { this.inventory.slots[i] = { id, count: 1, wear: 0 }; });
    else STARTER_KIT.forEach(([id, n]) => this.inventory.add(id, n));
    this.settings.gameMode = this.mode;
    this.settings.difficulty = this.difficulty;
    this.inventory.onChange = () => this.refreshInventoryUI();
    this.sim = new Simulation(this.world, { difficulty: this.difficulty, dimension: this.dimension || 0 });
    if (this.dimension === 1) this.sim.fortressesNear = (x, z) => this.world.generator.fortressesNear(x, z, 40);
    this.endState = data && data.endState && Array.isArray(data.endState.crystals) ? data.endState : newEndState();
    this.sleeping = null;
    this.arrival = null;
    this.portalTime = 0;
    this.dragon = null;
    this.crops = new Map();
    this.fires = new Map();
    this.setupBlockEntities(data);
    this.scanWorldBlocks();
    this.sim.pickup = (id, itemId, count, wear, ench) => this.pickupItem(itemId, count, wear, ench);
    const me = this.sim.addPlayer('local', { mode: this.mode });
    if (data && data.player && typeof data.player.health === 'number') { me.health = data.player.health; me.air = data.player.air ?? MAX_AIR; }
    this.sim.pickupXp = (id, pts) => { if (id === 'local') this.gainXp(pts); };
    this.sim.dayCount = this.dayCount || 0;
    this.setupSurvival(data);
    this.setupCreatures(data);
    this.setupVillagers(data);
    this.loadSaucer(data);
    this.player.onWallHit = (lost) => { const d = Math.floor(lost / 2 - 3); if (d > 0 && !this.isCreative()) this.sim.damagePlayer('local', d, 'wall'); };
    this.spawnPoint = data && data.spawn ? data.spawn : null;
    this.breaking = null;
    this.attackCooldown = 0;
    this.useCooldown = 0;
    this.bowDraw = 0;
    this.deathShown = false;
    this.shake = 0;
    this.hurtFlash = 0;
    if (this.mode !== 'creative') this.player.flying = false;
    this.refreshInventoryUI();
  };

  P.isCreative = function isCreative() { return this.mode === 'creative'; };
  P.me = function me() { return this.sim && this.sim.player('local'); };
  P.heldSlot = function heldSlot() { return this.inventory.slots[this.selected] || null; };
  P.heldId = function heldId() { const s = this.heldSlot(); return s ? s.id : 0; };

  P.refreshInventoryUI = function refreshInventoryUI() {
    if (!this.inventory) return;
    if (this.touch) this.touch.setFlyVisible(this.isCreative());
    this.ui.renderHotbar(this.inventory.slots.slice(0, 9), this.selected, !this.isCreative());
    if (this.state === 'inventory') this.ui.renderInventory(this.inventory, this.selected, this.isCreative(), (r) => this.canCraft(r), { level: this.xp ? this.xp.level : 0 });
    const me = this.me();
    if (me) this.ui.setVitals(this.vitals(me));
  };

  P.vitals = function vitals(me) {
    if (this.isCreative()) return null;
    return { health: me.health, max: MAX_HEALTH, air: me.air, maxAir: MAX_AIR, underwater: this.player.headInWater, armor: this.inventory.armorValues().points, ...this.survivalVitals(me) };
  };

  P.pickupItem = function pickupItem(itemId, count, wear, ench) {
    const left = this.inventory.add(itemId, count, wear, ench);
    if (left === count) {
      const now = performance.now();
      if (!this.fullToastAt || now - this.fullToastAt > 8000) { this.fullToastAt = now; this.ui.toast(t('inv.full')); }
    }
    return count - left;
  };

  // Pick block (middle click) in creative: put an item in the selected hotbar slot.
  P.pickItem = function pickItem(id) {
    if (this.isCreative()) {
      const d = itemDef(id);
      this.inventory.slots[this.selected] = { id, count: d ? d.stack : 1, wear: 0 };
      this.inventory.changed();
    }
    this.ui.showBlockName(itemName(itemDef(id)));
    this.audio.play('pop');
  };

  // ---- the inventory screen (see Inventory.click and ui.renderInventory)
  P.inventoryClick = function inventoryClick(ref, button) {
    const out = this.furnaceOutput();
    if (this.inventory.click(ref, button)) this.audio.play('pop');
    this.smeltXp(out);
  };

  P.inventoryQuick = function inventoryQuick(ref) {
    const out = this.furnaceOutput();
    if (this.inventory.quickMove(ref)) this.audio.play('pop');
    this.smeltXp(out);
  };

  // Taking what a furnace made out of it gives experience (a little for most things, more for
  // metals and gems).
  P.furnaceOutput = function furnaceOutput() {
    const box = this.inventory.container;
    const s = box && box.kind === 'furnace' ? box.slots[2] : null;
    return s ? { id: s.id, count: s.count } : null;
  };

  P.smeltXp = function smeltXp(before) {
    if (!before || this.isCreative()) return;
    const box = this.inventory.container;
    const s = box && box.kind === 'furnace' ? box.slots[2] : null;
    const taken = before.count - (s && s.id === before.id ? s.count : 0);
    if (taken <= 0) return;
    const d = itemDef(before.id);
    const rate = SMELT_XP.get(before.id) ?? (d && d.kind === 'food' ? 0.35 : 0.1);
    const pts = taken * rate;
    const whole = Math.floor(pts) + (Math.random() < pts - Math.floor(pts) ? 1 : 0);
    if (whole > 0) this.gainXp(whole);
  };

  // A number key over a slot: swap it with that hotbar slot (armour only takes its own piece).
  P.inventorySwap = function inventorySwap(ref, hot) {
    const inv = this.inventory;
    if (ref === hot) return;
    if (ref >= ARMOR_REF && inv.slots[hot] && !inv.accepts(ref, inv.slots[hot])) return;
    inv.swap(ref, hot);
    this.audio.play('pop');
  };

  // Let go of the held stack outside the window: thrown in front of the player.
  P.inventoryOutside = function inventoryOutside() {
    const inv = this.inventory;
    const c = inv.cursor;
    if (!c) return;
    inv.cursor = null;
    this.throwStack(c);
    inv.changed();
  };

  P.inventoryTrash = function inventoryTrash() {
    if (!this.inventory.cursor) return;
    this.inventory.cursor = null;
    this.inventory.changed();
    this.audio.play('pop');
  };

  // The creative palette: a click takes a full stack (right click: one) on the cursor; shift-click
  // puts a stack straight into the inventory; clicking it while holding something deletes that.
  P.palettePick = function palettePick(id, button, shift) {
    if (!this.isCreative()) return;
    const inv = this.inventory;
    const d = itemDef(id);
    if (!d) return;
    if (inv.cursor) { inv.cursor = null; inv.changed(); return; }
    if (shift) inv.add(id, d.stack);
    else inv.holdNew(id, button === 2 ? 1 : d.stack);
    this.ui.showBlockName(itemName(d));
    this.audio.play('pop');
  };

  // Thrown items fly a few blocks and wait two seconds before anyone (the thrower too) can pick them up.
  P.throwStack = function throwStack(s) {
    const p = this.player, e = p.eye, f = p.forward();
    this.sim.dropItem(s.id, s.count, e[0] + f[0] * 0.5, e[1] - 0.3, e[2] + f[2] * 0.5, [f[0] * 5, 2.5 + f[1] * 4, f[2] * 5], s.wear, { delay: 2, ench: s.ench });
  };

  // Closing the screen: the held stack goes back into the inventory (what doesn't fit is dropped).
  P.returnCursorStack = function returnCursorStack() {
    if (!this.inventory) return;
    const left = this.inventory.returnCursor();
    if (left) this.throwStack(left);
  };

  P.canCraft = function canCraft(recipe) {
    return recipe[2].every(([id, n]) => this.inventory.has(id, n));
  };

  P.craft = function craft(index) {
    const r = RECIPES[index];
    if (!r || !this.canCraft(r)) return;
    for (const [id, n] of r[2]) this.inventory.take(id, n);
    const left = this.inventory.add(r[0], r[1]);
    if (left > 0) this.sim.dropItem(r[0], left, this.player.pos[0], this.player.pos[1] + 1.2, this.player.pos[2]);
    this.audio.play('place', 'wood', 0.6);
    this.ui.toast(t('inv.crafted', { item: itemName(itemDef(r[0])) + (r[1] > 1 ? ' ×' + r[1] : '') }), 1400);
  };

  P.selectSlot = function selectSlot(i) {
    if (i === this.selected) return;
    this.selected = i;
    this.bowDraw = 0;
    this.breaking = null;
    this.refreshInventoryUI();
    const d = itemDef(this.heldId());
    if (d) this.ui.showBlockName(itemName(d));
  };

  // ---------------------------------------------------------------- per frame
  P.syncPlayerToSim = function syncPlayerToSim() {
    const me = this.me();
    if (!me) return;
    const p = this.player;
    me.pos = p.pos.slice();
    me.vel = p.vel.slice();
    me.eyeHeight = p.eyeHeight;
    me.inWater = p.inWater;
    me.headInWater = p.headInWater;
    const feet = this.world.getBlock(Math.floor(p.pos[0]), Math.floor(p.pos[1] + 0.1), Math.floor(p.pos[2]));
    const waist = this.world.getBlock(Math.floor(p.pos[0]), Math.floor(p.pos[1] + 0.8), Math.floor(p.pos[2]));
    me.inLava = feet === BLOCK.LAVA || waist === BLOCK.LAVA;
    me.inFire = feet === BLOCK.FIRE || waist === BLOCK.FIRE;
    me.onMagma = p.onGround && this.world.getBlock(Math.floor(p.pos[0]), Math.floor(p.pos[1] - 0.2), Math.floor(p.pos[2])) === BLOCK.MAGMA_BLOCK;
    me.sneaking = p.sneaking;
    me.armor = this.inventory.armorValues();
    me.mode = this.mode;
    me.sheltered = !!(this.ride || this.passengerOf); // (in or on a flying saucer nothing can hurt you)
  };

  P.updatePlay = function updatePlay(dt) {
    if (!this.sim) return;
    const playing = this.state === 'playing';
    this.syncPlayerToSim();
    if (this.mp || (this.state !== 'paused' && this.state !== 'title')) this.sim.update(dt, { dayTime: this.dayTime, storm: this.villageWeather() });
    this.handleSimEvents();
    const me = this.me();
    if (me && me.dead && !this.deathShown && this.mode !== 'creative') this.onDeath();
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.useCooldown > 0) this.useCooldown -= dt;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    if (this.hurtFlash > 0) { this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2); this.ui.setHurt(this.hurtFlash); }
    // vitals change slowly: refresh a few times a second
    this.vitalsTimer = (this.vitalsTimer || 0) - dt;
    if (this.vitalsTimer <= 0) {
      this.vitalsTimer = 0.1;
      if (me) {
        this.ui.setVitals(this.vitals(me));
        this.ui.setEffects(Object.entries(me.effects || {}).map(([key, e]) => ({ key, t: e.t, amp: e.amp })));
      }
    }
    if (playing) this.ambientCreatures(dt);
    this.sim.dayCount = this.dayCount || 0;
    this.updateSurvival(dt);
    this.updateLures(dt);
    this.updatePlates(dt);
    this.updateFlight(dt);
    this.remoteTrails(dt);
    this.updateGateways(dt);
    this.updateCreatureFx(dt);
    this.updateSleep(dt);
    this.updateBlocks(dt);
    this.updateFurnaces(dt);
    this.updateEnd(dt);
    // a warning as the sun goes down, once a day
    if (!this.isCreative() && this.difficulty !== 'peaceful' && playing) {
      const dusk = this.dayTime > 0.455 && this.dayTime < 0.5;
      if (dusk && !this.duskShown) { this.duskShown = true; this.ui.toast(t('toast.dusk'), 4500); }
      if (!dusk) this.duskShown = false;
    }
  };

  P.handleSimEvents = function handleSimEvents() {
    const ear = this.camera ? this.camera.pos : this.player.pos;
    const yaw = this.player.yaw;
    const spatial = (pos, range = 24) => {
      const dx = pos[0] - ear[0], dy = pos[1] - ear[1], dz = pos[2] - ear[2];
      const d = Math.hypot(dx, dy, dz);
      const vol = Math.max(0, 1 - d / range);
      // listener right vector
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const pan = d > 0.5 ? (dx * rx + dz * rz) / d : 0;
      return [vol * vol, pan];
    };
    for (const e of this.sim.drainEvents()) {
      if (this.mp) this.forwardSimEvent(e);
      switch (e.type) {
        case 'pearlLand': case 'eyeTrail': case 'eyeDone': case 'igniteAt': case 'armorHit':
          this.handleUseEvent(e);
          break;
        case 'crystalDeath': case 'bossDeath': case 'dragonGone':
          this.handleEndEvent(e);
          break;
        case 'sound': {
          const [v, pan] = spatial(e.pos);
          const name = e.name.endsWith('Attack') ? 'hit' : e.name;
          this.audio.sfx(name, v, pan);
          break;
        }
        case 'hurt': {
          const [v, pan] = spatial(e.pos, 20);
          this.audio.sfx(e.crit ? 'crit' : 'hit', v, pan);
          const snd = MOB_SOUND[e.entity.type];
          if (snd) this.audio.sfx(snd, v * 0.8, pan);
          this.particles.burst(Math.floor(e.pos[0]), Math.floor(e.pos[1] + 0.5), Math.floor(e.pos[2]), BLOCK.RED_WOOL, 1, 0);
          break;
        }
        case 'death': {
          const [v, pan] = spatial(e.pos, 20);
          this.audio.sfx('death', v, pan);
          this.particles.burst(Math.floor(e.pos[0]), Math.floor(e.pos[1] + 0.3), Math.floor(e.pos[2]), BLOCK.WHITE_WOOL, 1, 0);
          if (e.entity.lastAttacker === 'local') this.villagersSeeKill(e.entity); // (a cheer if villagers saw it)
          break;
        }
        case 'explosion': {
          const [v, pan] = spatial(e.pos, 60);
          this.audio.sfx('explosion', Math.max(v, 0.15), pan);
          const d = Math.hypot(e.pos[0] - ear[0], e.pos[1] - ear[1], e.pos[2] - ear[2]);
          this.shake = Math.max(this.shake, Math.max(0, 1.4 - d / 16));
          for (let i = 0; i < 6; i++) {
            this.particles.burst(Math.floor(e.pos[0] + (Math.random() - 0.5) * 4), Math.floor(e.pos[1] + (Math.random() - 0.5) * 3), Math.floor(e.pos[2] + (Math.random() - 0.5) * 4), i % 2 ? BLOCK.GRAY_WOOL : BLOCK.COBBLESTONE, 0.9, 0.8);
          }
          break;
        }
        case 'playerHurt':
          if (e.id !== 'local') break;
          this.audio.sfx('playerHurt', 1, 0);
          this.hurtFlash = Math.min(1, 0.45 + e.amount * 0.08);
          this.ui.setHurt(this.hurtFlash);
          this.shake = Math.max(this.shake, 0.25);
          if (this.touch) this.touch.vibrate(40);
          if (this.settings.padVibration && this.pads.connected) this.pads.rumble(0.7, 0.5, 180);
          break;
        case 'knock':
          if (e.id !== 'local') break;
          {
            const p = this.player;
            const dx = p.pos[0] - e.from[0], dz = p.pos[2] - e.from[2];
            const l = Math.hypot(dx, dz) || 1;
            p.vel[0] += (dx / l) * 6 * e.strength;
            p.vel[2] += (dz / l) * 6 * e.strength;
            p.vel[1] = Math.max(p.vel[1], 4 * Math.min(e.strength, 1.5));
          }
          break;
        case 'pickup':
          if (e.id === 'local') this.audio.sfx('pickup', 0.6, 0);
          break;
        case 'playerDeath':
          if (e.id === 'local') { this.deathCause = e.source; this.addRumor('death', String(e.source || '')); }
          break;
        case 'fireworkBurst': this.onFireworkBurst(e); break;
        case 'fireworkTrail': this.onFireworkTrail(e); break;
        case 'fireworkEnd': break;
        case 'potionSplash': {
          const c = e.color.map((v) => (v / 255) * 3);
          for (let i = 0; i < 40; i++) {
            const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3;
            this.particles.spark(e.pos[0], e.pos[1] + 0.2, e.pos[2], Math.cos(a) * sp, 1 + Math.random() * 2, Math.sin(a) * sp, c, { life: 0.8 + Math.random() * 0.6, size: 0.06, gravity: 3, drag: 1.5 });
          }
          break;
        }
        case 'xp': break;
        case 'shieldBlock': if (e.id === 'local') this.shieldBlocked(e); break;
        case 'totem': if (e.id === 'local') this.onTotem(); break;
        case 'launch': if (e.id === 'local') this.player.vel[1] = Math.max(this.player.vel[1], e.v); break;
        case 'bite': if (e.owner === 'local') { this.audio.sfx('bite', 0.8, 0); this.particles.burst(Math.floor(e.pos[0]), Math.floor(e.pos[1]), Math.floor(e.pos[2]), BLOCK.WHITE_WOOL, 1, 0.4, 6); } break;
        case 'tamed': this.audio.sfx('horse', 0.8, 0); this.ui.toast(t('toast.tamed', { name: t('mob.' + e.entity.type) }), 2200); break;
        case 'buck': if (this.player.riding === e.entity) { this.dismount(); this.player.vel[1] = 5; this.audio.sfx('horse', 0.9, 0); } break;
        case 'bred': for (let i = 0; i < 6; i++) this.particles.burst(Math.floor(e.pos[0]), Math.floor(e.pos[1]), Math.floor(e.pos[2]), BLOCK.RED_WOOL, 1, 1, 2); this.audio.sfx('heart', 0.6, 0); break;
        case 'elderCurse': if (e.id === 'local') { this.ui.toast(t('toast.elderCurse'), 3000); this.audio.sfx('guardian', 0.9, 0); } break;
        case 'patrol': break;
        case 'spawnerFx': for (let i = 0; i < 6; i++) this.particles.spark(e.pos[0] + (Math.random() - 0.5), e.pos[1] + (Math.random() - 0.5), e.pos[2] + (Math.random() - 0.5), 0, 0.8, 0, [3, 1, 0.3], { life: 0.6, size: 0.06 }); break;
        case 'petDied': if (e.owner === ((this.me() && (this.me().name || this.me().id)) || 'local')) this.ui.toast(t('toast.petDied', { name: t('mob.' + e.entity.type) }), 3500); break;
        case 'graze': this.world.setBlock(e.pos[0], e.pos[1], e.pos[2], BLOCK.DIRT); break;
        case 'bulletPop': this.particles.burst(Math.floor(e.pos[0]), Math.floor(e.pos[1]), Math.floor(e.pos[2]), BLOCK.WHITE_WOOL, 1, 1, 6); break;
        case 'effect': case 'effectEnd': this.vitalsTimer = 0; break;
        default: break;
      }
    }
  };

  // Creatures make their noises now and then; a creeper about to blow hisses.
  P.ambientCreatures = function ambientCreatures(dt) {
    this.creatureTimer = (this.creatureTimer || 0) - dt;
    const ear = this.camera ? this.camera.pos : this.player.pos;
    for (const e of this.sim.entities.values()) {
      if (e.kind !== 'mob' || e.deathTime > 0) continue;
      if (e.type === 'creeper') {
        if (e.fuse > 0 && !e.hissing) {
          e.hissing = true;
          const d = Math.hypot(e.pos[0] - ear[0], e.pos[2] - ear[2]);
          this.audio.sfx('creeperFuse', Math.max(0, 1 - d / 20), 0);
        } else if (e.fuse === 0) e.hissing = false;
      }
    }
    if (this.creatureTimer > 0) return;
    this.creatureTimer = 1.5 + Math.random() * 2;
    let best = null, bd = 16 * 16;
    for (const e of this.sim.entities.values()) {
      if (e.kind !== 'mob' || !MOB_SOUND[e.type] || e.deathTime > 0 || Math.random() < 0.5) continue;
      const d = (e.pos[0] - ear[0]) ** 2 + (e.pos[1] - ear[1]) ** 2 + (e.pos[2] - ear[2]) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    if (best) this.audio.sfx(MOB_SOUND[best.type], Math.max(0, 1 - Math.sqrt(bd) / 16) * 0.8, 0);
  };

  P.onDeath = function onDeath() {
    this.deathShown = true;
    if (this.state === 'inventory') { this.returnCursorStack(); this.closeContainer(); }
    if (this.state === 'sign') this.finishSign(this.ui.signLines());
    this.audio.sfx('playerDeath', 1, 0);
    // everything carried spills on the ground
    const p = this.player.pos;
    if (this.sleeping) this.wakeUp();
    const spill = (s) => {
      const v = [(Math.random() - 0.5) * 4, 3 + Math.random() * 2, (Math.random() - 0.5) * 4];
      this.sim.dropItem(s.id, s.count, p[0], p[1] + 1, p[2], v, s.wear, { ench: s.ench });
    };
    const inv = this.inventory;
    inv.slots.forEach((s, i) => { if (s) { spill(s); inv.slots[i] = null; } });
    inv.armor.forEach((s, i) => { if (s) { spill(s); inv.armor[i] = null; } });
    if (inv.offhand) { spill(inv.offhand); inv.offhand = null; }
    this.onDeathSurvival();
    if (inv.cursor) { spill(inv.cursor); inv.cursor = null; }
    inv.changed();
    this.input.exitLock();
    this.state = 'dead';
    this.input.enabled = false;
    this.input.keys.clear();
    this.input.buttons.clear();
    this.breaking = null;
    this.bowDraw = 0;
    if (this.touch) this.touch.show(false);
    this.ui.showDeath(this.deathCause || 'other');
    this.ui.show('death');
  };

  P.respawn = function respawn() {
    if (this.dimension !== 0) {
      // back to the overworld: the bed, or the world's spawn
      this.travelTo(0, 'home');
      this.sim.respawnPlayer('local', this.player.pos);
      this.player.flying = false;
      this.deathShown = false;
      this.deathCause = null;
      this.hurtFlash = 0;
      this.ui.setHurt(0);
      this.play();
      return;
    }
    // a bed that has been broken no longer works
    if (this.spawnPoint && this.world.isChunkReady(this.spawnPoint[0], this.spawnPoint[2])) {
      const [bx, by, bz] = this.spawnPoint.map(Math.floor);
      if (!IS_BED[this.world.getBlock(bx, by, bz)]) { this.spawnPoint = null; this.ui.toast(t('bed.missing'), 3000); }
    }
    const spawn = this.spawnPoint || this.world.generator.findSpawn();
    const spot = this.findStandingSpot(Math.floor(spawn[0]), Math.floor(spawn[2]));
    this.player.pos = [spot[0] + 0.5, spot[1] + 0.02, spot[2] + 0.5];
    this.player.vel = [0, 0, 0];
    this.sim.respawnPlayer('local', this.player.pos);
    this.player.flying = false;
    this.deathShown = false;
    this.deathCause = null;
    this.hurtFlash = 0;
    this.ui.setHurt(0);
    this.play();
  };

  // Fall damage in survival: speed at landing -> blocks fallen.
  P.onLandDamage = function onLandDamage(speed) {
    // (coming down from space the suit's thrusters set you down gently)
    if (this.suit || this.dimension >= 4) { this.suit = false; return; }
    if (this.isCreative() || this.player.inWater) return;
    const fall = (speed * speed) / (2 * 28);
    const dmg = Math.floor(fall - 3.2);
    if (dmg > 0) this.sim.damagePlayer('local', dmg, 'fall');
  };

  // ---------------------------------------------------------------- interaction
  P.interact = function interact(dt) {
    // (in a flying saucer: nothing to dig or put down from inside it)
    if (this.ride) { this.aimMob = null; this.selection = null; this.breaking = null; return; }
    const p = this.player;
    const eye = p.eye;
    const dir = p.forward();
    const creative = this.isCreative();
    const reach = REACH_BLOCK[creative ? 'creative' : 'survival'];
    const hit = raycast(this.world, eye, dir, reach);
    const mobHit = this.sim.pickEntity(eye, dir, REACH_HIT);
    const aimMob = mobHit && (!hit || mobHit.t < hit.t) ? mobHit.entity : null;
    this.aimMob = aimMob; // (a villager looked at shows its name)
    this.selection = hit && !aimMob ? { min: [hit.box[0], hit.box[1], hit.box[2]], max: [hit.box[3], hit.box[4], hit.box[5]], progress: this.breaking ? this.breaking.progress : 0 } : null;
    const input = this.input;
    const tc = input.touch;
    const pad = this.pads;
    const attackHeld = input.buttons.has(0) || input.clicked.has(0) || tc.breakHeld || tc.breakBtn || (pad.connected && pad.down(PAD.RT));
    const attackPressed = input.clicked.has(0) || (pad.connected && pad.pressed(PAD.RT)) || (tc.breakBtn && !this.prevBreakBtn) || (tc.breakHeld && !this.prevBreakHeld);
    this.prevBreakBtn = tc.breakBtn;
    this.prevBreakHeld = tc.breakHeld;
    const useHeld = input.buttons.has(2) || (pad.connected && pad.down(PAD.LT));
    const usePressed = input.clicked.has(2) || (pad.connected && pad.pressed(PAD.LT)) || tc.tap;
    const held = this.heldSlot();
    const def = itemDef(held ? held.id : 0);
    // aboard someone's flying saucer: nothing to do from up there
    if (this.passengerOf) { this.breaking = null; this.selection = null; tc.tap = false; return; }
    // another player's flying saucer (landed): ask to come aboard
    if (this.mp && usePressed && !aimMob) {
      const pilot = this.aimedSaucer(eye, dir, 7, hit ? hit.t : Infinity);
      if (pilot) { tc.tap = false; this.askToBoard(pilot); return; }
    }
    // carrying something (or someone), or carried ourselves: our hands are full
    if (this.carrying || this.carriedBy) {
      this.breaking = null;
      this.selection = null;
      if (this.carrying && (input.clicked.has(2) || (pad.connected && pad.pressed(PAD.LT)))) this.putDown();
      tc.tap = false;
      return;
    }

    // ---- attack / break
    if (aimMob) {
      this.breaking = null;
      if ((attackPressed || attackHeld) && this.attackCooldown <= 0) this.attack(aimMob, def);
    } else if (attackHeld && hit) {
      if (creative) {
        this.breakTimer -= dt;
        if (attackPressed) this.breakTimer = 0;
        if (this.breakTimer <= 0) { this.breakTimer = 0.24; this.breakBlock(hit, true); }
      } else this.mineBlock(hit, dt, def);
    } else {
      this.breaking = null;
      if (attackPressed && this.attackCooldown <= 0) { this.swing = 1; this.attackCooldown = 0.25; this.audio.sfx('swing', 0.5, 0); }
    }

    this.updateShield(useHeld, def);
    // ---- use: creatures first (milking), buckets, then things done to a block (doors, chests,
    // sleeping, tilling, planting, fire, eyes, beds), then bows, food, thrown things and placing blocks
    if (usePressed && aimMob && this.useOnMob(aimMob, def)) {
      tc.tap = false;
    } else if (usePressed && def && def.kind === 'bucket' && !aimMob && this.useBucket(def)) {
      tc.tap = false;
      this.placeTimer = 0.24;
    } else if (usePressed && hit && !aimMob && this.useOnBlock(hit, def)) {
      tc.tap = false;
      this.placeTimer = 0.24;
    } else if (def && (def.kind === 'pearl' || def.kind === 'eye')) {
      if (usePressed && this.useCooldown <= 0) { this.useCooldown = 0.45; this.throwHeld(def); }
      tc.tap = false;
    } else if (def && def.kind === 'bow') {
      const canShoot = creative || this.inventory.has(ITEM.ARROW);
      if (useHeld && canShoot) this.bowDraw = Math.min(1, this.bowDraw + dt / 0.9);
      else if (this.bowDraw > 0.1 || (tc.tap && canShoot)) {
        this.shootBow(tc.tap ? 0.85 : this.bowDraw);
        this.bowDraw = 0;
      } else this.bowDraw = 0;
      tc.tap = false;
    } else if (def && def.kind === 'saucer') {
      if (usePressed || tc.tap) { tc.tap = false; if (aimMob && aimMob.type === 'saucer') this.useSaucer(aimMob, def); else this.placeSaucer(hit); }
    } else if (def && (def.kind === 'boat' || def.kind === 'minecart')) {
      if (usePressed || tc.tap) {
        tc.tap = false;
        const vh = def.kind === 'boat' ? raycast(this.world, eye, dir, reach, { liquids: true }) || hit : hit;
        this.placeVehicle(vh, def);
      }
    } else if (def && this.useHeld(def, { hit, aimMob, useHeld, usePressed, dt, tc })) {
      // (food, potions, crossbows, rods, fireworks, spawn eggs...)
    } else {
      this.placeTimer -= dt;
      if (input.clicked.has(2)) this.placeTimer = 0;
      if (pad.connected && pad.pressed(PAD.LT)) this.placeTimer = 0;
      if ((useHeld && this.placeTimer <= 0) || tc.tap) {
        tc.tap = false;
        if (hit && !aimMob) {
          this.placeTimer = 0.24;
          this.placeBlock(hit);
        }
      }
    }

    // ---- pick block (middle click / right stick)
    if ((input.clicked.has(1) || (pad.connected && pad.pressed(PAD.RS))) && hit) this.pickFromWorld(hit.block);
    // drop the held item (Q: one of it; Ctrl+Q: the whole stack)
    if (input.wasPressed('KeyQ') && held) {
      const all = input.down('ControlLeft') || input.down('ControlRight');
      const n = all ? held.count : 1;
      this.throwStack({ id: held.id, count: n, wear: held.wear });
      this.inventory.consume(this.selected, n);
    }
  };

  P.attack = function attack(mob, def) {
    const p = this.player;
    const held = this.heldSlot();
    let base = def && def.damage ? def.damage : 1;
    // sharpness on anything; smite against the undead
    const sharp = held && held.ench ? held.ench.sharpness || 0 : 0, smite = held && held.ench ? held.ench.smite || 0 : 0;
    if (sharp) base += 0.5 * sharp + 0.5;
    if (smite && mob.def && mob.def.undead) base += 2.5 * smite;
    const me = this.me();
    const fx = (me && me.effects) || {};
    if (fx.strength) base += 3 * (fx.strength.amp + 1);
    if (fx.weakness) base = Math.max(0, base - 4);
    const crit = !p.onGround && p.vel[1] < -0.5 && !p.inWater;
    const dmg = this.isCreative() ? Math.max(base, 20) : base;
    this.sim.playerAttack('local', mob, dmg, crit);
    if (mob.type === 'villager') this.villagerHit(mob); // (they remember)
    this.swing = 1;
    this.attackCooldown = def && def.kind === 'sword' ? 0.5 : 0.4;
    if (!this.isCreative() && def && def.durability) {
      if (this.inventory.wear(this.selected, def.kind === 'sword' ? 1 : 2)) this.toolBroke(def);
    }
    if (this.touch) this.touch.vibrate(20);
    if (this.settings.padVibration && this.pads.connected) this.pads.rumble(0.3, 0.6, 70);
  };

  P.toolBroke = function toolBroke(def) {
    this.audio.sfx('toolBreak', 0.8, 0);
    this.ui.toast(t('toast.toolBroke', { item: itemName(def) }), 2000);
  };

  P.shootBow = function shootBow(charge) {
    if (charge < 0.1) return;
    const creative = this.isCreative();
    const bowStack = this.heldSlot();
    const ench = (bowStack && bowStack.ench) || {};
    const infinite = creative || (ench.infinity && this.inventory.has(ITEM.ARROW));
    if (!infinite && this.inventory.take(ITEM.ARROW, 1) < 1) return;
    const p = this.player;
    const e = p.eye, f = p.forward();
    const speed = 12 + 30 * charge;
    let dmg = 1 + 8 * charge * charge;
    if (ench.power) dmg *= 1 + 0.25 * (ench.power + 1);
    const arrow = this.sim.shootArrow('local', [e[0] + f[0] * 0.4, e[1] - 0.1, e[2] + f[2] * 0.4], f, speed, dmg, !infinite);
    arrow.punch = ench.punch || 0;
    arrow.flame = !!ench.flame;
    const bow = this.heldSlot();
    if (!creative && bow && this.inventory.wear(this.selected, 1)) this.toolBroke(itemDef(bow.id) || itemDef(ITEM.BOW));
    this.swing = 0.6;
  };

  // Survival mining: hold on a block until it cracks through; the right tool makes it faster.
  P.mineBlock = function mineBlock(hit, dt, def) {
    const b = this.breaking;
    if (!b || b.x !== hit.x || b.y !== hit.y || b.z !== hit.z) {
      const info = breakInfo(hit.block, def ? def.id : 0);
      let time = info.time;
      const held = this.heldSlot();
      const eff = held && held.ench ? held.ench.efficiency || 0 : 0;
      if (eff && def && def.speed) time /= 1 + (eff * eff + 1) / def.speed;
      const me = this.me();
      if (me && me.effects && me.effects.mining_fatigue) time *= [3.3, 11, 90, 300][Math.min(3, me.effects.mining_fatigue.amp)];
      if (this.player.inWater && !(this.inventory.armor[0] && this.inventory.armor[0].ench && this.inventory.armor[0].ench.aqua_affinity)) time *= this.player.headInWater ? 5 : 1;
      if (!this.player.onGround && !this.player.inWater && !this.player.flying && !this.player.riding) time *= 5;
      this.breaking = { x: hit.x, y: hit.y, z: hit.z, block: hit.block, progress: 0, time, drops: info.drops, tick: 0 };
    }
    const br = this.breaking;
    if (!Number.isFinite(br.time)) return;
    br.progress += br.time <= 0 ? 1 : dt / br.time;
    br.tick -= dt;
    this.swing = Math.max(this.swing, 0.6);
    if (br.tick <= 0 && br.progress < 1) {
      br.tick = 0.22;
      this.audio.play('step', materialOf(BLOCKS[br.block]), 0.9);
    }
    if (br.progress >= 1) {
      this.breakBlock(hit, br.drops);
      if (def && def.durability && !this.isCreative()) {
        if (this.inventory.wear(this.selected, 1)) this.toolBroke(def);
      }
      this.breaking = null;
    }
  };

  P.breakBlock = function breakBlock(hit, drops) {
    const { x, y, z, block } = hit;
    if (block === BLOCK.BEDROCK && y <= 0) return;
    if (MODEL_OF[block] === MODELS_BY_NAME.door) this.breakDoor(x, y, z, block, drops);
    else if (!this.world.setBlock(x, y, z, 0)) return;
    if (IS_BED[block]) this.breakBed(x, y, z, block, drops);
    // what stood on it or hung from it comes off too
    this.breakAttached(x, y, z, drops);
    this.villagersSeeBreak(x, y, z, block); // (a villager's house: it minds)
    const [sl, bl] = this.world.getLight(x + hit.normal[0], y + hit.normal[1], z + hit.normal[2]);
    this.particles.burst(x, y, z, block, sl / 15, bl / 15);
    this.audio.play('break', materialOf(BLOCKS[block]));
    this.swing = 1;
    if (this.touch) this.touch.vibrate(14);
    if (this.settings.padVibration && this.pads.connected) this.pads.rumble(0.25, 0.4, 60);
    if (!this.isCreative() && drops) {
      const held = this.heldSlot();
      const silk = held && held.ench && held.ench.silk_touch;
      const fortune = held && held.ench ? held.ench.fortune || 0 : 0;
      if (silk && SILK.has(block)) this.sim.dropItem(block, 1, x + 0.5, y + 0.4, z + 0.5);
      else {
        for (const [id, n] of blockDrops(block)) {
          // fortune: ores give more
          const extra = fortune && FORTUNE.has(block) ? Math.max(0, Math.floor(Math.random() * (fortune + 2)) - 1) : 0;
          this.sim.dropItem(id, n * (1 + extra), x + 0.5, y + 0.4, z + 0.5);
        }
        this.oreXp(block, x, y, z);
      }
      const me = this.me();
      if (me) me.exhaust = (me.exhaust || 0) + 0.005;
    }
  };

  P.placeBlock = function placeBlock(hit) {
    const held = this.heldSlot();
    if (!held || !isBlockItem(held.id)) return;
    const id = held.id;
    const placed = () => {
      this.audio.play('place', materialOf(BLOCKS[id]));
      this.swing = 1;
      if (!this.isCreative()) this.inventory.consume(this.selected);
      if (this.touch) this.touch.vibrate(8);
      if (this.settings.padVibration && this.pads.connected) this.pads.rumble(0, 0.3, 35);
    };
    // a slab on its kind of slab makes the full block
    if (MODEL_OF[id] === MODELS_BY_NAME.slab && this.slabMerge(id, hit)) { placed(); return; }
    let x = hit.x, y = hit.y, z = hit.z;
    if (!BLOCKS[hit.block].replaceable) { x += hit.normal[0]; y += hit.normal[1]; z += hit.normal[2]; }
    const cur = this.world.getBlock(x, y, z);
    if (!BLOCKS[cur].replaceable || cur === id) return;
    if (COLLIDE_KIND[id] && this.player.intersectsBlock(x, y, z)) return;
    // no placing blocks inside creatures
    if (COLLIDE_KIND[id]) {
      for (const e of this.sim.entities.values()) {
        if (e.kind !== 'mob') continue;
        const b = e.body;
        if (b.pos[0] + b.hw > x && b.pos[0] - b.hw < x + 1 && b.pos[1] + b.h > y && b.pos[1] < y + 1 && b.pos[2] + b.hw > z && b.pos[2] - b.hw < z + 1) return;
      }
    }
    const shape = SHAPE_OF[id];
    if ((shape === SHAPE.CROSS || shape === SHAPE.TORCH || id === BLOCK.CACTUS) && !IS_SOLID[this.world.getBlock(x, y - 1, z)]) return;
    const place = this.placementFor(id, hit, x, y, z);
    if (!place) return;
    if (this.world.setBlock(x, y, z, place.id, { state: place.state })) {
      placed();
      this.notePlaced(x, y, z); // (ours to take down again: no villager minds)
      if (IS_RAIL[place.id]) this.afterRailPlaced(x, y, z);
      this.checkSummon(x, y, z, place.id);
    }
  };

  P.pickFromWorld = function pickFromWorld(block) {
    // the item a block comes from: doors and signs are placed from items, a lit furnace is a furnace
    const item = { [BLOCK.OAK_DOOR]: ITEM.OAK_DOOR, [BLOCK.BIRCH_DOOR]: ITEM.BIRCH_DOOR, [BLOCK.SPRUCE_DOOR]: ITEM.SPRUCE_DOOR,
      [BLOCK.OAK_SIGN]: ITEM.OAK_SIGN, [BLOCK.OAK_WALL_SIGN]: ITEM.OAK_SIGN, [BLOCK.LIT_FURNACE]: BLOCK.FURNACE }[block] ?? block;
    const inv = this.inventory;
    for (let i = 0; i < 9; i++) if (inv.slots[i] && inv.slots[i].id === item) { this.selectSlot(i); return; }
    if (this.isCreative() && (item >= 256 || BLOCKS[item].inventory)) this.pickItem(item);
  };

  // ---------------------------------------------------------------- rendering
  P.buildEntities = function buildEntities() {
    if (!this.sim || !this.entityMesh) return null;
    const players = this.mp ? this.remotePlayerModels() : [];
    const self = this.state !== 'title' && this.state !== 'boot' ? this.localPlayerModel() : null;
    if (self) players.push(self);
    const saucers = this.saucerModels();
    // (how much a saucer's fire is dimmed for an eye set for the dark: see Renderer.bindPointLights)
    this.entityMesh.eye = this.renderer && this.renderer.eyeScale !== undefined ? this.renderer.eyeScale : 1;
    return this.entityMesh.build(this.sim, this.camera.pos, this.sim.alpha || 0, this.world, performance.now() / 1000, 96, players.length ? players : null, this.visibleSigns(this.camera.pos), this.rodTip(), saucers.length ? saucers : null);
  };

  // Where our fishing line leaves the rod: out in front and to the right of the view, or from the
  // hand of our model in the third-person views.
  P.rodTip = function rodTip() {
    const b = this.bobber;
    if (!b || b.removed || !this.camera) return null;
    const p = this.player;
    const f = p.forward();
    const right = [Math.cos(p.yaw), 0, -Math.sin(p.yaw)];
    if (this.camMode) return [p.pos[0] + right[0] * 0.4 + f[0] * 1.1, p.pos[1] + 1.35 + f[1] * 1.1, p.pos[2] + right[2] * 0.4 + f[2] * 1.1];
    const e = this.camera.pos;
    return [e[0] + f[0] * 0.9 + right[0] * 0.42, e[1] + f[1] * 0.9 + 0.02, e[2] + f[2] * 0.9 + right[2] * 0.42];
  };

  P.handState = function handState() {
    const held = this.heldSlot();
    if (!held || this.state !== 'playing' || this.hudHidden || this.sleeping || this.camMode || this.carrying || this.carriedBy || this.ride || this.passengerOf) return null;
    const id = held.id;
    const p = this.player;
    const bob = this.settings.viewBobbing ? p.bobAmount : 0;
    const bx = Math.cos(p.bobPhase) * 0.035 * bob;
    const by = -Math.abs(Math.sin(p.bobPhase)) * 0.04 * bob;
    const sw = Math.sin(this.swing * Math.PI);
    const e = p.eye;
    const [sl, bl] = this.world.getLight(Math.floor(e[0]), Math.floor(e[1]), Math.floor(e[2]));
    if (!isBlockItem(id)) {
      // tools and food: a flat sprite held at an angle; the bow is pulled back while drawing
      const draw = this.bowDraw || 0;
      const tx = 0.52 + bx - sw * 0.18 - draw * 0.1, ty = -0.42 + by - sw * 0.12, tz = -0.8 + sw * 0.15 + draw * 0.12;
      mat4.fromTRS(this.handModel, tx, ty, tz, -0.35 - sw * 1.1, -0.2 + draw * 0.4, 0.5, 0.55, 0.55, 0.03);
      const layer = this.itemSprites.index.get(id) || 0;
      return { visible: true, model: this.handModel, sprite: true, layers: [layer, layer, layer, 1], sky: sl / 15, block: bl / 15, tint: 0, tintColor: [1, 1, 1], mat: MAT.DEFAULT };
    }
    const d = BLOCKS[id];
    if (!d || !d.tex) return null;
    const flat = d.shape === SHAPE.CROSS || d.shape === SHAPE.TORCH || MODEL_OF[id] === MODELS_BY_NAME.ladder || MODEL_OF[id] === MODELS_BY_NAME.pane;
    const tx = 0.56 + bx - sw * 0.12, ty = -0.52 + by - sw * 0.18, tz = -0.95 + sw * 0.1;
    if (flat) mat4.fromTRS(this.handModel, tx, ty + 0.05, tz, -0.1 - sw * 0.6, -0.35, 0.1, 0.5, 0.5, 0.04);
    else mat4.fromTRS(this.handModel, tx, ty, tz, 0.3 - sw * 0.9, 0.78, 0.0, 0.36);
    const tex = FACE_TEX;
    const side = tex[id * 4 + 2];
    return {
      visible: true,
      model: this.handModel,
      layers: flat ? [side, side, side, 1] : [tex[id * 4], tex[id * 4 + 1], side, d.layer === 1 ? 1 : 0],
      sky: sl / 15,
      block: Math.max(bl, d.emission) / 15,
      tint: d.tint && d.tint !== TINT.WATER ? 1 : 0,
      tintColor: TINT_RGB[d.tint] || [1, 1, 1],
      mat: d.mat === MAT.WATER ? MAT.GLOSSY : d.mat,
    };
  };

  P.serializePlay = function serializePlay() {
    return {
      mode: this.mode,
      difficulty: this.difficulty,
      inventory: this.inventory ? this.inventory.serialize() : [],
      spawn: this.spawnPoint,
      blockEntities: this.serializeBlockEntities(),
      survival: this.serializeSurvival(),
      ...this.serializeCreatures(),
      ...this.serializeVillagers(),
      ...this.serializeSaucer(),
    };
  };

  P.setDifficulty = function setDifficulty(d) {
    this.difficulty = d;
    this.settings.difficulty = d;
    if (this.sim) {
      this.sim.difficulty = d;
      // peaceful sends every monster away at once
      if (d === 'peaceful') for (const e of this.sim.entities.values()) if (e.kind === 'mob' && e.hostile) e.removed = true;
    }
  };

  P.setMode = function setMode(m) {
    this.mode = m;
    this.settings.gameMode = m;
    this.breaking = null;
    if (m !== 'creative') this.player.flying = false;
    const me = this.me();
    if (me) me.mode = m;
    this.refreshInventoryUI();
    this.ui.toast(t(m === 'creative' ? 'toast.creative' : 'toast.survival'));
  };
}
