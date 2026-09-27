// Creatures on the player's side: feeding and breeding animals, taming wolves, cats and horses,
// telling pets to sit, shearing sheep, saddling horses, trading with villagers; the villagers,
// golems and the rest a structure is built with (spawned once, the first time its chunk is ever
// made); summoning iron golems and the wither; and keeping the creatures that stay (villagers,
// pets, what was bred) in the save. Installed as methods on Game.prototype.

import { ITEM, itemDef, EGG_ITEMS } from '../sim/items.js';
import { BLOCK, BLOCKS, IS_SOLID } from '../world/blocks.js';
import { JOB_LIST, CAT_LOOKS } from '../sim/looks.js';
import { tradesFor } from '../sim/trades.js';
import { MOBS } from '../sim/entities.js';
import { t } from '../ui/i18n.js';

// what each animal eats (and so follows, and breeds with)
export const BREED_FOOD = {
  cow: [ITEM.WHEAT], sheep: [ITEM.WHEAT], pig: [ITEM.CARROT, ITEM.POTATO, ITEM.BEETROOT].filter(Boolean), chicken: [ITEM.WHEAT_SEEDS],
  wolf: [ITEM.RAW_BEEF, ITEM.COOKED_BEEF, ITEM.RAW_PORKCHOP, ITEM.COOKED_PORKCHOP, ITEM.RAW_CHICKEN, ITEM.COOKED_CHICKEN, ITEM.RAW_MUTTON, ITEM.COOKED_MUTTON, ITEM.ROTTEN_FLESH],
  cat: [ITEM.RAW_COD, ITEM.RAW_SALMON], horse: [ITEM.GOLDEN_CARROT, ITEM.GOLDEN_APPLE],
};
const PERSIST_FIELDS = ['tamed', 'sitting', 'saddled', 'sheared', 'growth', 'home', 'trades', 'tradeSeed', 'tradeDay', 'stats', 'temper', 'size', 'persistent', 'love'];

export function installCreaturePlay(Game) {
  const P = Game.prototype;

  // ---------------------------------------------------------------- right click on a creature
  P.useOnMob = function useOnMob(mob, def) {
    if (mob.deathTime > 0 || mob.ghost) return false;
    const me = this.me();
    const creative = this.isCreative();
    const owner = (me && (me.name || me.id)) || 'local';
    const use = (n = 1) => { if (!creative) this.inventory.consume(this.selected, n); };
    const hearts = (m) => { for (let i = 0; i < 3; i++) this.particles.burst(Math.floor(m.pos[0]), Math.floor(m.pos[1] + m.def.h + 0.3), Math.floor(m.pos[2]), BLOCK.RED_WOOL, 1, 1, 2); };
    const type = mob.type;
    this.swing = 1;
    // riding: boats, minecarts, horses (and a saddle on a tamed horse)
    if (mob.def.vehicle && !mob.rider) { this.mount(mob); return true; }
    if (type === 'horse') {
      if (def && def.kind === 'saddle' && mob.tamed && !mob.saddled && !mob.baby) { mob.saddled = true; use(); this.audio.sfx('saddle', 0.8, 0); return true; }
      if (def && BREED_FOOD.horse.includes(def.id)) return this.feed(mob, def, use, hearts);
      if (!mob.baby && !mob.rider) { this.mount(mob); return true; }
      return false;
    }
    if (type === 'villager') {
      if (mob.baby) return false;
      this.openTrading(mob);
      return true;
    }
    if (type === 'iron_golem' && def && def.id === ITEM.IRON_INGOT && mob.health < mob.def.health) {
      mob.health = Math.min(mob.def.health, mob.health + 25);
      use();
      this.audio.sfx('golem', 0.6, 0);
      return true;
    }
    // milk from a cow, wool from a sheep
    if (type === 'cow' && def && def.kind === 'bucket' && !def.holds && !mob.baby) {
      this.fillHeldBucket(ITEM.MILK_BUCKET);
      this.audio.sfx('bucketFill', 0.7, 0);
      this.audio.sfx('cow', 0.5, 0);
      return true;
    }
    if (type === 'sheep' && def && def.kind === 'shears' && !mob.sheared && !mob.baby) {
      mob.sheared = true;
      const n = 1 + Math.floor(Math.random() * 3);
      this.sim.dropItem(mob.variant || BLOCK.WHITE_WOOL, n, mob.pos[0], mob.pos[1] + 1, mob.pos[2]);
      this.audio.sfx('shear', 0.8, 0);
      this.wearHeld(def, 1);
      return true;
    }
    // taming
    if (type === 'wolf' && !mob.tamed && def && def.id === ITEM.BONE) {
      use();
      if (Math.random() < 0.33) this.tame(mob, owner); else this.smoke(mob);
      return true;
    }
    if (type === 'cat' && !mob.tamed && def && BREED_FOOD.cat.includes(def.id)) {
      use();
      if (Math.random() < 0.33) this.tame(mob, owner); else this.smoke(mob);
      return true;
    }
    // pets: food heals and breeds them; anything else tells them to sit or get up
    if ((type === 'wolf' || type === 'cat') && mob.tamed === owner) {
      if (def && BREED_FOOD[type].includes(def.id) && (mob.health < mob.maxHealth || !(mob.breedCooldown > 0))) {
        if (mob.health < mob.maxHealth) { mob.health = Math.min(mob.maxHealth, mob.health + 4); use(); hearts(mob); return true; }
        return this.feed(mob, def, use, hearts);
      }
      mob.sitting = !mob.sitting;
      mob.path = null;
      this.audio.sfx(type, 0.5, 0);
      return true;
    }
    // breeding the farm animals
    if (def && BREED_FOOD[type] && BREED_FOOD[type].includes(def.id)) return this.feed(mob, def, use, hearts);
    return false;
  };

  // Feeding: babies grow faster, grown-ups fall in love (and find another in love to breed with).
  P.feed = function feed(mob, def, use, hearts) {
    if (mob.baby) { mob.growth = Math.min(0, mob.growth * 0.9 + 30); use(); hearts(mob); return true; }
    if (mob.breedCooldown > 0 || mob.love > 0) return false;
    if (mob.type === 'horse' && !mob.tamed) { mob.temper = Math.min(100, (mob.temper || 0) + 10); use(); return true; }
    mob.love = 30;
    mob.breeder = 'local';
    use();
    hearts(mob);
    this.audio.sfx('heart', 0.5, 0);
    return true;
  };

  P.tame = function tame(mob, owner) {
    mob.tamed = owner;
    mob.persistent = true;
    mob.angryAt = null;
    mob.target = null;
    mob.sitting = true;
    if (mob.type === 'wolf') mob.health = 20;
    for (let i = 0; i < 5; i++) this.particles.burst(Math.floor(mob.pos[0]), Math.floor(mob.pos[1] + 1), Math.floor(mob.pos[2]), BLOCK.RED_WOOL, 1, 1, 2);
    this.audio.sfx(mob.type === 'cat' ? 'purr' : 'wolf', 0.7, 0);
    this.ui.toast(t('toast.tamed', { name: t('mob.' + mob.type) }), 2200);
  };

  P.smoke = function smoke(mob) {
    this.particles.burst(Math.floor(mob.pos[0]), Math.floor(mob.pos[1] + 1), Math.floor(mob.pos[2]), BLOCK.GRAY_WOOL, 1, 0.5, 3);
  };

  // A villager's offers, restocked once a day.
  P.tradesOf = function tradesOf(m) {
    if (!m.tradeSeed) m.tradeSeed = (Math.random() * 2 ** 31) | 0;
    const job = JOB_LIST[m.variant | 0] || 'none';
    const offers = tradesFor(job, m.tradeSeed);
    const today = this.dayCount || 0;
    if (m.tradeDay !== today) { m.trades = null; m.tradeDay = today; }
    if (Array.isArray(m.trades)) offers.forEach((o, i) => { o.uses = m.trades[i] | 0; });
    return offers;
  };

  // Animals follow whoever holds their food.
  P.updateLures = function updateLures(dt) {
    this.lureTimer = (this.lureTimer || 0) - dt;
    if (this.lureTimer > 0 || !this.sim) return;
    this.lureTimer = 0.5;
    const held = this.heldId();
    const me = this.me();
    for (const e of this.sim.entities.values()) {
      if (e.kind !== 'mob' || e.ghost) continue;
      const food = BREED_FOOD[e.type];
      const near = me && !me.dead && Math.hypot(me.pos[0] - e.body.pos[0], me.pos[2] - e.body.pos[2]) < 8;
      e.lure = food && held && food.includes(held) && near && !e.tamed ? me : null;
    }
  };

  // ---------------------------------------------------------------- creatures that come with structures
  // A chunk from its generator told us who lives there: spawned the first time it is ever made
  // (on a server: by whoever gets there first).
  P.onChunkFeatures = function onChunkFeatures(chunk, features) {
    const mobs = features.filter((f) => f.kind === 'mob');
    if (!mobs.length) return;
    const dim = this.dimension || 0;
    const done = this.spawnedChunks[dim] || (this.spawnedChunks[dim] = new Set());
    if (done.has(chunk.key)) return;
    done.add(chunk.key);
    if (this.mp) { this.mp.net.send({ t: 'claim', k: chunk.key, d: dim }); this.mp.claims.set(dim + ':' + chunk.key, mobs); return; }
    this.spawnFeatureMobs(mobs);
  };

  P.spawnFeatureMobs = function spawnFeatureMobs(mobs) {
    for (const f of mobs) {
      if (!MOBS[f.type]) continue;
      const m = this.sim.spawnMob(f.type, f.x, f.y, f.z);
      m.persistent = true;
      m.home = [f.x, f.y, f.z];
      const d = f.data || {};
      if (f.type === 'villager') m.variant = Math.max(0, JOB_LIST.indexOf(d.job || 'none'));
      if (f.type === 'cat') m.variant = d.color ? Math.max(0, CAT_LOOKS.indexOf(d.color)) : Math.floor(Math.random() * CAT_LOOKS.length);
      if (f.type === 'shulker') m.body.gravity = 0;
    }
  };

  // ---------------------------------------------------------------- summoning
  // Placing the last block of a pattern brings it to life: a pumpkin on a T of iron blocks makes
  // an iron golem; three wither skeleton skulls on a T of soul sand, the wither.
  P.checkSummon = function checkSummon(x, y, z, id) {
    const w = this.world;
    const pumpkin = id === BLOCK.PUMPKIN || id === BLOCK.JACK_O_LANTERN;
    const skull = id === BLOCK.WITHER_SKELETON_SKULL;
    if (!pumpkin && !skull) return;
    const body = pumpkin ? BLOCK.IRON_BLOCK : BLOCK.SOUL_SAND;
    // the head (or middle skull) sits on top of the T's middle
    const tryAt = (hx, hy, hz, ax) => {
      const [dx, dz] = ax;
      if (w.getBlock(hx, hy - 1, hz) !== body || w.getBlock(hx, hy - 2, hz) !== body) return false;
      if (w.getBlock(hx + dx, hy - 1, hz + dz) !== body || w.getBlock(hx - dx, hy - 1, hz - dz) !== body) return false;
      if (skull && (w.getBlock(hx + dx, hy, hz + dz) !== BLOCK.WITHER_SKELETON_SKULL || w.getBlock(hx - dx, hy, hz - dz) !== BLOCK.WITHER_SKELETON_SKULL)) return false;
      const cells = [[hx, hy, hz], [hx, hy - 1, hz], [hx, hy - 2, hz], [hx + dx, hy - 1, hz + dz], [hx - dx, hy - 1, hz - dz]];
      if (skull) cells.push([hx + dx, hy, hz + dz], [hx - dx, hy, hz - dz]);
      for (const [cx, cy, cz] of cells) { w.setBlock(cx, cy, cz, 0); this.particles.burst(cx, cy, cz, BLOCKS[body] ? body : BLOCK.STONE, 1, 0.3); }
      const m = this.sim.spawnMob(pumpkin ? 'iron_golem' : 'wither', hx + 0.5, hy - 2, hz + 0.5);
      m.persistent = true;
      if (skull) { m.charge = 10; m.health = 30; this.ui.toast(t('toast.wither'), 4000); this.audio.sfx('witherSpawn', 1, 0); }
      return true;
    };
    for (const ax of [[1, 0], [0, 1]]) {
      if (tryAt(x, y, z, ax)) return;
      if (skull) { if (tryAt(x + ax[0], y, z + ax[1], ax) || tryAt(x - ax[0], y, z - ax[1], ax)) return; }
    }
  };

  // ---------------------------------------------------------------- creatures that stay
  P.serializeCreature = function serializeCreature(e) {
    const o = { type: e.type, p: e.body.pos.map((v) => Math.round(v * 100) / 100), yaw: Math.round(e.yaw * 100) / 100, hp: Math.round(e.health * 10) / 10, v: e.variant || 0 };
    for (const k of PERSIST_FIELDS) if (e[k] !== undefined && e[k] !== null && e[k] !== false) o[k] = e[k];
    return o;
  };

  P.loadCreature = function loadCreature(o) {
    if (!o || !MOBS[o.type] || !Array.isArray(o.p)) return null;
    const m = this.sim.spawnMob(o.type, o.p[0], o.p[1], o.p[2]);
    m.yaw = m.headYaw = m.prevYaw = Number(o.yaw) || 0;
    m.variant = o.v | 0;
    for (const k of PERSIST_FIELDS) if (o[k] !== undefined) m[k] = o[k];
    if (o.type === 'slime' && o.size) m.setSize(o.size);
    if (typeof o.hp === 'number') m.health = Math.max(1, o.hp);
    if (m.growth < 0) m.renderScale = 0.55;
    m.persistent = true;
    return m;
  };

  // the creatures of the dimension we are in that should outlive being far away
  P.keptCreatures = function keptCreatures() {
    const out = [];
    for (const e of this.sim.entities.values()) {
      if (e.kind !== 'mob' || e.ghost || e.removed || e.deathTime > 0) continue;
      if (e.type === 'end_crystal' || e.type === 'ender_dragon' || e.type === 'tnt' || e.type === 'evoker_fangs') continue;
      if (e.persistent || e.tamed || e.def.persistent || e.def.vehicle) out.push(this.serializeCreature(e));
    }
    return out;
  };

  P.setupCreatures = function setupCreatures(data) {
    const sc = (data && data.spawnedChunks) || {};
    this.spawnedChunks = { 0: new Set(sc[0] || []), 1: new Set(sc[1] || []), 2: new Set(sc[2] || []) };
    this.dimCreatures = (data && data.creatures) || {};
    this.restoreCreatures();
  };

  P.restoreCreatures = function restoreCreatures() {
    const list = (this.dimCreatures && this.dimCreatures[this.dimension || 0]) || [];
    if (this.mp) return; // on a server the creatures that stay live with the server
    for (const o of list) this.loadCreature(o);
  };

  P.stashCreatures = function stashCreatures() {
    if (!this.dimCreatures) this.dimCreatures = {};
    this.dimCreatures[this.dimension || 0] = this.keptCreatures();
  };

  P.serializeCreatures = function serializeCreatures() {
    const creatures = { ...(this.dimCreatures || {}) };
    creatures[this.dimension || 0] = this.keptCreatures();
    const spawnedChunks = {};
    for (const d of [0, 1, 2]) spawnedChunks[d] = [...(this.spawnedChunks && this.spawnedChunks[d] ? this.spawnedChunks[d] : [])];
    return { creatures, spawnedChunks };
  };

  void EGG_ITEMS; void itemDef; void IS_SOLID;
}
