// The deeper survival game on the player's side: hunger (eating takes a moment; sprinting and
// jumping make you hungry), experience (orbs, levels, mending), status effects (potions, food,
// creatures' poison), the enchanting table, potions to drink and throw, the shield in the other
// hand, the crossbow, the fishing rod, fireworks, spawn eggs and the totem of undying.
// Installed as methods on Game.prototype.

import { ITEM, itemDef, isBlockItem, SPLASH_ITEMS, POTION_ITEMS, EGG_ITEMS } from '../sim/items.js';
import { OFFHAND_REF, CONTAINER_REF } from '../sim/inventory.js';
import {
  addEffect, hasEffect, effectAmp, potionOutcome, enchLevel, enchantOffers, addXp, spendLevels, xpForLevel, xpProgress, eat, EXHAUST, MAX_FOOD, EFFECTS,
} from '../sim/effects.js';
import { BLOCK, BLOCKS, IS_SOLID, IS_LIQUID } from '../world/blocks.js';
import { raycast } from './player.js';
import { t, itemName } from '../ui/i18n.js';

const EAT_TIME = 1.6;
const DRINK_TIME = 1.6;
// experience from ores, as they break
const ORE_XP = { [BLOCK.COAL_ORE]: [0, 2], [BLOCK.DIAMOND_ORE]: [3, 7], [BLOCK.EMERALD_ORE]: [3, 7], [BLOCK.LAPIS_ORE]: [2, 5], [BLOCK.NETHER_QUARTZ_ORE]: [2, 5], [BLOCK.SPAWNER]: [15, 43] };
// what the fishing rod brings up: [item, weight] (fish, then treasure and junk)
const CATCH_FISH = [[ITEM.RAW_COD, 60], [ITEM.RAW_SALMON, 25], [ITEM.TROPICAL_FISH, 2], [ITEM.PUFFERFISH, 13]];
const CATCH_TREASURE = [[ITEM.SADDLE, 1], [ITEM.BOW, 1], [ITEM.FISHING_ROD, 1], [ITEM.NAME_TAG ?? ITEM.GOLDEN_APPLE, 1], [BLOCK.LILY_PAD, 1], [ITEM.EMERALD, 1]];
const CATCH_JUNK = [[ITEM.BONE, 10], [ITEM.STRING, 5], [ITEM.STICK, 5], [ITEM.LEATHER, 10], [ITEM.ROTTEN_FLESH, 10], [ITEM.BOWL ?? ITEM.GLASS_BOTTLE, 10], [BLOCK.LILY_PAD, 17], [ITEM.INK_SAC, 1]];
const pick = (list) => { const tot = list.reduce((a, e) => a + e[1], 0); let v = Math.random() * tot; for (const e of list) { v -= e[1]; if (v <= 0) return e[0]; } return list[0][0]; };

export function installSurvival(Game) {
  const P = Game.prototype;

  // ---------------------------------------------------------------- saving
  P.setupSurvival = function setupSurvival(data) {
    const me = this.me();
    const s = (data && data.survival) || {};
    this.xp = { level: Number.isInteger(s.level) && s.level >= 0 ? s.level : 0, xp: typeof s.xp === 'number' && s.xp >= 0 ? s.xp : 0 };
    this.sinceRest = typeof s.sinceRest === 'number' ? s.sinceRest : 0;
    if (me) {
      me.food = typeof s.food === 'number' ? Math.max(0, Math.min(MAX_FOOD, s.food)) : MAX_FOOD;
      me.sat = typeof s.sat === 'number' ? Math.max(0, s.sat) : 5;
      me.exhaust = 0;
      me.effects = {};
      if (s.effects && typeof s.effects === 'object') {
        for (const [k, e] of Object.entries(s.effects)) if (EFFECTS[k] && e && e.t > 0) me.effects[k] = { t: e.t, amp: e.amp | 0, max: e.max || e.t };
      }
      me.absorb = typeof s.absorb === 'number' ? s.absorb : 0;
    }
    this.eating = null;
    this.crossbowLoad = 0;
    this.bobber = null;
    this.shieldCooldown = 0;
    this.enchantSeed = s.enchantSeed || (Math.random() * 2 ** 31) | 0;
  };

  P.serializeSurvival = function serializeSurvival() {
    const me = this.me();
    return {
      level: this.xp ? this.xp.level : 0, xp: this.xp ? Math.round(this.xp.xp * 100) / 100 : 0,
      food: me ? me.food : MAX_FOOD, sat: me ? Math.round(me.sat * 10) / 10 : 5, absorb: me ? me.absorb || 0 : 0,
      effects: me ? me.effects : {}, sinceRest: Math.round(this.sinceRest || 0), enchantSeed: this.enchantSeed,
    };
  };

  // ---------------------------------------------------------------- every frame
  P.updateSurvival = function updateSurvival(dt) {
    const me = this.me();
    if (!me || !this.player) return;
    const p = this.player;
    const creative = this.isCreative();
    // hunger from moving about
    if (!creative && !me.dead && this.state === 'playing') {
      const moved = Math.hypot(p.pos[0] - (this.lastPos ? this.lastPos[0] : p.pos[0]), p.pos[2] - (this.lastPos ? this.lastPos[2] : p.pos[2]));
      if (moved < 3) {
        if (p.sprinting && p.onGround) me.exhaust += EXHAUST.sprint * moved;
        else if (p.inWater) me.exhaust += EXHAUST.swim * moved;
      }
      if (p.jumped) { me.exhaust += p.sprinting ? EXHAUST.sprintJump : EXHAUST.jump; p.jumped = false; }
      // too hungry to run
      if (me.food <= 6 && p.sprinting) p.sprinting = false;
    }
    this.lastPos = p.pos.slice();
    // three days awake brings the phantoms
    if (!this.dimension) this.sinceRest = (this.sinceRest || 0) + dt;
    const dayLen = (this.mp ? this.mp.dayLength : this.settings.dayLength) * 60;
    me.insomnia = !creative && this.sinceRest > dayLen * 3;
    // what the player's effects do to how they move
    const fx = me.effects || {};
    p.fx = {
      speed: 1 + 0.2 * (effectAmp(fx, 'speed') + 1) - 0.15 * (effectAmp(fx, 'slowness') + 1) - (this.blocking ? 0.7 : 0) - (this.eating ? 0.65 : 0) - (this.bowDraw > 0 || this.crossbowLoad > 0 ? 0.65 : 0),
      jump: hasEffect(fx, 'jump_boost') ? 1 + 0.25 * (effectAmp(fx, 'jump_boost') + 1) : 1,
      levitate: hasEffect(fx, 'levitation') ? 0.9 * (effectAmp(fx, 'levitation') + 1) : 0,
      slowFall: hasEffect(fx, 'slow_falling'),
    };
    this.nightVision = hasEffect(fx, 'night_vision') ? Math.min(1, fx.night_vision.t / 10) : 0;
    // held things the simulation needs to know of: the shield, the totem, enchantments
    const held = this.heldSlot();
    const off = this.inventory.offhand;
    me.blocking = !!this.blocking;
    me.yaw = p.yaw;
    me.totem = !!((held && held.id === ITEM.TOTEM_OF_UNDYING) || (off && off.id === ITEM.TOTEM_OF_UNDYING));
    const armorEnch = { protection: 0, feather_falling: 0, respiration: 0 };
    for (const s of this.inventory.armor) if (s && s.ench) for (const k of Object.keys(armorEnch)) armorEnch[k] += s.ench[k] || 0;
    me.ench = armorEnch;
    me.looting = enchLevel(held, 'looting');
    me.knockback = enchLevel(held, 'knockback');
    me.fireAspect = enchLevel(held, 'fire_aspect');
    if (this.shieldCooldown > 0) this.shieldCooldown -= dt;
    // eating and drinking take a moment
    if (this.eating) {
      const e = this.eating;
      const s = this.inventory.slots[e.slot];
      if (!s || s.id !== e.id || this.selected !== e.slot) this.eating = null;
      else {
        e.t += dt;
        e.tick -= dt;
        if (e.tick <= 0) {
          e.tick = 0.22;
          this.audio.sfx(e.drink ? 'drink' : 'eat', 0.6, 0);
          if (!e.drink) this.particles.burst(Math.floor(p.eye[0] + p.forward()[0] * 0.6), Math.floor(p.eye[1] - 0.3), Math.floor(p.eye[2] + p.forward()[2] * 0.6), BLOCK.BROWN_WOOL, 1, 0.2, 2);
        }
        if (e.t >= (e.drink ? DRINK_TIME : EAT_TIME)) { this.eating = null; this.finishConsuming(e); }
      }
    }
  };

  // ---------------------------------------------------------------- what the HUD shows
  P.survivalVitals = function survivalVitals(me) {
    const fx = me.effects || {};
    return {
      food: me.food ?? MAX_FOOD, sat: me.sat || 0, absorb: me.absorb || 0, hungry: hasEffect(fx, 'hunger'), poisoned: hasEffect(fx, 'poison'), withered: hasEffect(fx, 'wither'),
      level: this.xp ? this.xp.level : 0, progress: this.xp ? xpProgress(this.xp) : 0,
      effects: Object.entries(fx).map(([k, e]) => ({ key: k, t: e.t, amp: e.amp })),
    };
  };

  // ---------------------------------------------------------------- using what is held
  // Called from interact() for the held item's use button. Returns true when it was used here.
  P.useHeld = function useHeld(def, { hit, aimMob, useHeld, usePressed, dt, tc }) {
    const creative = this.isCreative();
    const me = this.me();
    const held = this.heldSlot();
    if (!def) return false;
    switch (def.kind) {
      case 'food': {
        const hungry = me && (me.food < MAX_FOOD || def.always || creative);
        if ((usePressed || tc.tap) && hungry && !this.eating) this.eating = { slot: this.selected, id: def.id, t: creative ? EAT_TIME : 0, tick: 0, auto: !!tc.tap };
        else if (this.eating && !useHeld && !this.eating.auto) this.eating = null;
        tc.tap = false;
        return true;
      }
      case 'potion': {
        if ((usePressed || tc.tap) && !this.eating) this.eating = { slot: this.selected, id: def.id, t: 0, tick: 0, drink: true, auto: !!tc.tap };
        else if (this.eating && !useHeld && !this.eating.auto) this.eating = null;
        tc.tap = false;
        return true;
      }
      case 'splash':
        if ((usePressed || tc.tap) && this.useCooldown <= 0) {
          this.useCooldown = 0.5;
          const p = this.player, e = p.eye, f = p.forward();
          this.sim.throwPotion('local', [e[0] + f[0] * 0.4, e[1] - 0.1, e[2] + f[2] * 0.4], f, def.potion);
          if (!creative) this.inventory.consume(this.selected);
          this.swing = 1;
        }
        tc.tap = false;
        return true;
      case 'bottle': {
        // fill it at water
        if (!(usePressed || tc.tap)) return true;
        tc.tap = false;
        const p = this.player;
        const wh = raycast(this.world, p.eye, p.forward(), 5, { liquids: true });
        if (wh && wh.liquid && wh.block === BLOCK.WATER) {
          this.inventory.consume(this.selected);
          if (this.inventory.add(POTION_ITEMS.water, 1) > 0) this.sim.dropItem(POTION_ITEMS.water, 1, p.pos[0], p.pos[1] + 1, p.pos[2]);
          this.audio.sfx('bucketFill', 0.5, 0);
        }
        return true;
      }
      case 'crossbow': return this.useCrossbow(held, def, useHeld, usePressed, dt, tc);
      case 'fishing_rod':
        if (usePressed || tc.tap) { tc.tap = false; this.useRod(held, def); }
        return true;
      case 'firework':
        if ((usePressed || tc.tap) && this.useCooldown <= 0) {
          tc.tap = false;
          this.useCooldown = 0.3;
          this.useFirework(hit);
        }
        return true;
      case 'egg':
        if ((usePressed || tc.tap) && hit) {
          tc.tap = false;
          const x = hit.x + hit.normal[0], y = hit.y + hit.normal[1], z = hit.z + hit.normal[2];
          const m = this.spawnCreature(def.mob, x + 0.5, y, z + 0.5);
          if (m && !creative) this.inventory.consume(this.selected);
          this.swing = 1;
        }
        return true;
      case 'totem': case 'shield': case 'saddle':
        tc.tap = false;
        return true;
      default: return false;
    }
  };

  P.finishConsuming = function finishConsuming(e) {
    const def = itemDef(e.id);
    const me = this.me();
    if (!def || !me) return;
    const creative = this.isCreative();
    if (def.kind === 'food') {
      if (!creative) eat(me, def.food || def.heal || 1, def.sat || 1);
      for (const [key, secs, amp, chance] of def.effects || []) if (Math.random() < (chance ?? 1)) this.sim.effectPlayer('local', key, secs, amp);
      if (!creative) this.inventory.consume(this.selected);
      this.audio.sfx('burp', 0.5, 0);
    } else if (def.kind === 'potion') {
      this.sim.potionOnPlayer('local', def.potion, 1);
      if (!creative) {
        const s = this.inventory.slots[this.selected];
        if (s) { s.id = ITEM.GLASS_BOTTLE; this.inventory.changed(); }
      }
    }
    this.swing = 0.5;
  };

  // Milk: every effect gone.
  P.clearEffects = function clearEffects() {
    const me = this.me();
    if (me) { me.effects = {}; me.absorb = 0; }
  };

  // ---------------------------------------------------------------- the shield
  // Held up with the use button while it is in the other hand (and the main hand has nothing
  // better to do); an axe knocks it aside for a few seconds.
  P.updateShield = function updateShield(useHeld, def) {
    const off = this.inventory.offhand;
    const shield = off && itemDef(off.id) && itemDef(off.id).kind === 'shield';
    const busy = def && ['food', 'potion', 'bow', 'crossbow', 'fishing_rod', 'splash', 'pearl', 'eye', 'firework', 'bucket', 'egg', 'bottle'].includes(def.kind);
    const want = !!(shield && useHeld && !busy && !this.isCreative() && this.shieldCooldown <= 0 && !this.eating && !(this.selection && def && def.kind === 'block'));
    if (want !== !!this.blocking) this.blocking = want;
  };

  P.shieldBlocked = function shieldBlocked(e) {
    this.audio.sfx('shield', 0.8, 0);
    const off = this.inventory.offhand;
    if (off && !this.isCreative()) {
      const d = itemDef(off.id);
      if (this.inventory.wear(OFFHAND_REF, Math.max(1, Math.round(e.amount)))) this.toolBroke(d);
    }
    if (e.axe) { this.shieldCooldown = 5; this.blocking = false; this.audio.sfx('toolBreak', 0.4, 0); }
  };

  // ---------------------------------------------------------------- the crossbow
  // Hold to load (quick charge makes it faster), then use again to fire: an arrow, three with
  // multishot, or a firework rocket if one is in the other hand.
  P.useCrossbow = function useCrossbow(held, def, useHeld, usePressed, dt, tc) {
    const creative = this.isCreative();
    const loaded = held.loaded;
    if (loaded) {
      if (usePressed || tc.tap) { tc.tap = false; this.fireCrossbow(held, def); }
      return true;
    }
    const off = this.inventory.offhand;
    const ammo = creative || this.inventory.has(ITEM.ARROW) || (off && off.id === ITEM.FIREWORK_ROCKET);
    const charge = Math.max(0.3, 1.25 - 0.25 * enchLevel(held, 'quick_charge'));
    if ((useHeld || tc.tap) && ammo) {
      this.crossbowLoad = Math.min(1, this.crossbowLoad + dt / charge);
      if (tc.tap) this.crossbowLoad = 1;
      tc.tap = false;
      if (this.crossbowLoad >= 1) {
        this.crossbowLoad = 0;
        if (off && off.id === ITEM.FIREWORK_ROCKET) {
          held.loaded = 'firework';
          if (!creative && --off.count <= 0) this.inventory.offhand = null;
        } else {
          held.loaded = 'arrow';
          if (!creative) this.inventory.take(ITEM.ARROW, 1);
        }
        this.audio.sfx('crossbowLoad', 0.7, 0);
        this.inventory.changed();
      }
    } else this.crossbowLoad = 0;
    return true;
  };

  P.fireCrossbow = function fireCrossbow(held, def) {
    const p = this.player, e = p.eye, f = p.forward();
    const kind = held.loaded;
    held.loaded = null;
    const multi = enchLevel(held, 'multishot') > 0;
    const pierce = enchLevel(held, 'piercing');
    const yaws = multi ? [-0.17, 0, 0.17] : [0];
    for (const dy of yaws) {
      const c = Math.cos(dy), s = Math.sin(dy);
      const dir = [f[0] * c - f[2] * s, f[1], f[0] * s + f[2] * c];
      const pos = [e[0] + dir[0] * 0.4, e[1] - 0.1, e[2] + dir[2] * 0.4];
      if (kind === 'firework') this.sim.launchFirework('local', pos, dir.map((v) => v * 22), { armed: true, life: 1.8 });
      else {
        const a = this.sim.shootArrow('local', pos, dir, 45, 9, !this.isCreative() && dy === 0);
        a.pierce = pierce;
      }
    }
    this.swing = 0.6;
    this.audio.sfx('crossbowShoot', 0.8, 0);
    if (!this.isCreative() && this.inventory.wear(this.selected, multi ? 3 : 1)) this.toolBroke(def);
    this.inventory.changed();
  };

  // ---------------------------------------------------------------- the fishing rod
  P.useRod = function useRod(held, def) {
    const b = this.bobber;
    if (b && !b.removed) {
      this.reelIn(b, held, def);
      this.bobber = null;
      this.swing = 1;
      return;
    }
    const p = this.player, e = p.eye, f = p.forward();
    this.bobber = this.sim.castBobber('local', [e[0] + f[0] * 0.5, e[1] - 0.1, e[2] + f[2] * 0.5], [f[0] * 16, f[1] * 16 + 3, f[2] * 16],
      { lure: enchLevel(held, 'lure'), luck: enchLevel(held, 'luck_of_the_sea') });
    this.audio.sfx('throw', 0.6, 0);
    this.swing = 1;
  };

  P.reelIn = function reelIn(b, held, def) {
    const p = this.player;
    let wear = 1;
    if (b.hooked) {
      // drag the creature in
      const h = b.hooked, hp = h.body.pos;
      const dx = p.pos[0] - hp[0], dy = p.pos[1] - hp[1], dz = p.pos[2] - hp[2];
      const l = Math.hypot(dx, dy, dz) || 1;
      h.body.vel[0] += (dx / l) * Math.min(12, l * 1.2);
      h.body.vel[1] += 4 + Math.max(0, dy) * 0.5;
      h.body.vel[2] += (dz / l) * Math.min(12, l * 1.2);
      wear = 3;
      this.audio.sfx('reel', 0.7, 0);
    } else if (b.bite > 0) {
      // a catch: mostly fish; now and then treasure or junk (luck of the sea shifts it)
      const luck = b.luck || 0;
      const r = Math.random();
      const tr = 0.05 + luck * 0.021, junk = Math.max(0.01, 0.1 - luck * 0.025);
      const id = r < tr ? pick(CATCH_TREASURE) : r < tr + junk ? pick(CATCH_JUNK) : pick(CATCH_FISH);
      const bp = b.body.pos;
      const dx = p.pos[0] - bp[0], dz = p.pos[2] - bp[2], dy = p.pos[1] + 1 - bp[1];
      const d = Math.hypot(dx, dz) || 1;
      const drop = this.sim.dropItem(id, 1, bp[0], bp[1] + 0.3, bp[2], [dx * 1.1, dy * 1.1 + Math.sqrt(d) * 1.2, dz * 1.1], 0, { delay: 0 });
      void drop;
      this.sim.dropXp(p.pos[0], p.pos[1] + 0.5, p.pos[2], 1 + Math.floor(Math.random() * 6));
      this.audio.sfx('splash', 0.6, 0);
    } else if (b.stuck) wear = 2;
    b.removed = true;
    if (!this.isCreative() && held && this.inventory.wear(this.selected, wear)) this.toolBroke(def);
  };

  // ---------------------------------------------------------------- fireworks
  // Gliding: a burst of speed along the way you look. On the ground: a rocket into the sky.
  P.useFirework = function useFirework(hit) {
    const p = this.player;
    const creative = this.isCreative();
    if (p.gliding) {
      this.sim.launchFirework('local', [p.pos[0], p.pos[1] + 0.9, p.pos[2]], [0, 0, 0], { attached: true, life: 1.6 });
      this.boost = 1.6;
      this.audio.sfx('fireworkLaunch', 0.9, 0);
    } else {
      if (!hit) return;
      const x = hit.x + hit.normal[0] + 0.5, y = hit.y + hit.normal[1] + 0.1, z = hit.z + hit.normal[2] + 0.5;
      this.sim.launchFirework('local', [x, y, z], [(Math.random() - 0.5) * 0.6, 14, (Math.random() - 0.5) * 0.6], {});
    }
    if (!creative) this.inventory.consume(this.selected);
    this.swing = 1;
  };

  // ---------------------------------------------------------------- experience
  P.gainXp = function gainXp(points) {
    if (!this.xp) this.xp = { level: 0, xp: 0 };
    // mending: gear being worn or held soaks the orb up to mend itself
    const inv = this.inventory;
    const mend = [inv.slots[this.selected], inv.offhand, ...inv.armor].filter((s) => s && s.wear > 0 && enchLevel(s, 'mending'));
    if (mend.length) {
      const s = mend[Math.floor(Math.random() * mend.length)];
      const fix = Math.min(s.wear, points * 2);
      s.wear -= fix;
      points -= Math.ceil(fix / 2);
      inv.changed();
    }
    if (points <= 0) return;
    const before = this.xp.level;
    addXp(this.xp, points);
    if (this.xp.level > before) this.audio.sfx(this.xp.level % 5 === 0 ? 'levelBig' : 'levelUp', 0.7, 0);
    else this.audio.sfx('xp', 0.35, (Math.random() - 0.5) * 0.4);
  };

  P.oreXp = function oreXp(block, x, y, z) {
    const r = ORE_XP[block];
    if (!r || this.isCreative()) return;
    const n = r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1));
    if (n > 0) this.sim.dropXp(x + 0.5, y + 0.5, z + 0.5, n);
  };

  // Dying scatters some of what you knew; effects are gone.
  P.onDeathSurvival = function onDeathSurvival() {
    const me = this.me();
    const p = this.player.pos;
    if (this.xp && this.xp.level > 0 && !this.isCreative()) this.sim.dropXp(p[0], p[1] + 0.5, p[2], Math.min(100, this.xp.level * 7));
    this.xp = { level: 0, xp: 0 };
    if (me) { me.effects = {}; me.absorb = 0; }
    this.eating = null;
    this.blocking = false;
    if (this.bobber) { this.bobber.removed = true; this.bobber = null; }
    if (this.dismount) this.dismount();
  };

  P.onTotem = function onTotem() {
    const inv = this.inventory;
    if (inv.offhand && inv.offhand.id === ITEM.TOTEM_OF_UNDYING) inv.offhand = null;
    else if (inv.slots[this.selected] && inv.slots[this.selected].id === ITEM.TOTEM_OF_UNDYING) inv.slots[this.selected] = null;
    inv.changed();
    this.audio.sfx('totem', 1, 0);
    this.ui.toast(t('toast.totem'), 3000);
    this.totemFlash = 1.2;
    const p = this.player.pos;
    for (let i = 0; i < 8; i++) this.particles.burst(Math.floor(p[0] + (Math.random() - 0.5) * 2), Math.floor(p[1] + 1 + Math.random()), Math.floor(p[2] + (Math.random() - 0.5) * 2), i % 2 ? BLOCK.LIME_WOOL : BLOCK.YELLOW_WOOL, 1, 1, 3);
  };

  // ---------------------------------------------------------------- the enchanting table
  P.openEnchanting = function openEnchanting(x, y, z) {
    // bookshelves one block away around the table, up to fifteen, raise the offers
    let shelves = 0;
    const w = this.world;
    for (let dy = 0; dy <= 1; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== 2) continue;
      if (w.getBlock(x + dx, y + dy, z + dz) === BLOCK.BOOKSHELF) shelves++;
    }
    const box = { kind: 'enchant', slots: [null, null], shelves: Math.min(15, shelves), offers: [] };
    this.openBlock = { key: 'enchant:' + x + ',' + y + ',' + z, x, y, z, kind: 'enchant', dim: this.dimension || 0, temp: true };
    this.inventory.container = box;
    this.inventory.onContainerChange = () => this.refreshEnchantOffers();
    this.refreshEnchantOffers();
    this.audio.sfx('chestOpen', 0.4, 0);
    this.openInventory();
    return true;
  };

  P.refreshEnchantOffers = function refreshEnchantOffers() {
    const box = this.inventory.container;
    if (!box || box.kind !== 'enchant') return;
    const s = box.slots[0];
    box.offers = s ? enchantOffers(itemDef(s.id), box.shelves, this.enchantSeed ^ s.id) : [];
  };

  P.enchantPick = function enchantPick(i) {
    const box = this.inventory.container;
    if (!box || box.kind !== 'enchant') return;
    const o = box.offers[i];
    const item = box.slots[0];
    if (!o || !item || !Object.keys(o.ench).length) return;
    const creative = this.isCreative();
    const lapis = box.slots[1];
    if (!creative && ((this.xp.level < o.cost) || !lapis || lapis.count < o.lapis)) { this.audio.sfx('deny', 0.5, 0); return; }
    if (!creative) {
      spendLevels(this.xp, o.lapis);
      lapis.count -= o.lapis;
      if (lapis.count <= 0) box.slots[1] = null;
    }
    item.ench = { ...o.ench };
    this.enchantSeed = (Math.random() * 2 ** 31) | 0;
    this.refreshEnchantOffers();
    this.audio.sfx('enchant', 0.8, 0);
    this.inventory.changed();
  };

  // ---------------------------------------------------------------- trading
  P.openTrading = function openTrading(m) {
    const offers = this.tradesOf(m);
    if (!offers.length) { this.audio.sfx('villagerNo', 0.7, 0); this.ui.toast(t('trade.none'), 1800); return; }
    m.trading = 'local';
    this.inventory.container = { kind: 'trade', slots: [], offers, villager: m };
    this.inventory.onContainerChange = null;
    this.openBlock = { key: 'trade:' + m.id, kind: 'trade', dim: this.dimension || 0, temp: true };
    this.audio.sfx('villager', 0.8, 0);
    this.openInventory();
  };

  P.tradePick = function tradePick(i) {
    const box = this.inventory.container;
    if (!box || box.kind !== 'trade') return;
    const o = box.offers[i];
    const m = box.villager;
    if (!o || !m) return;
    if (o.uses >= o.max) { this.audio.sfx('villagerNo', 0.6, 0); return; }
    const inv = this.inventory;
    for (const [id, n] of o.cost) if (!inv.has(id, n)) { this.audio.sfx('villagerNo', 0.6, 0); return; }
    for (const [id, n] of o.cost) inv.take(id, n);
    const [id, n, ench] = o.give;
    const left = inv.add(id, n, 0, ench || null);
    if (left > 0) this.sim.dropItem(id, left, this.player.pos[0], this.player.pos[1] + 1, this.player.pos[2], null, 0, { ench });
    o.uses++;
    m.trades = box.offers.map((q) => q.uses);
    m.tradeDay = this.dayCount || 0;
    this.sim.dropXp(m.body.pos[0], m.body.pos[1] + 1, m.body.pos[2], 3 + Math.floor(Math.random() * 4));
    this.audio.sfx('villagerYes', 0.8, 0);
    inv.changed();
  };

  // ---------------------------------------------------------------- spawn eggs
  P.spawnCreature = function spawnCreature(type, x, y, z) {
    const m = this.sim.spawnMob(type, x, y, z);
    if (type === 'wither') m.charge = 10;
    if (type === 'slime') m.setSize(2);
    m.persistent = true;
    return m;
  };

  P.eggFor = (type) => EGG_ITEMS[type];
  void isBlockItem; void IS_SOLID; void IS_LIQUID; void BLOCKS; void SPLASH_ITEMS; void xpForLevel; void addEffect; void potionOutcome; void CONTAINER_REF; void itemName;
}
