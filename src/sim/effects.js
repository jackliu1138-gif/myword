// Rules for the deeper survival game, shared by the game and the server: status effects (from
// potions, food and creatures), the potions and how they are brewed, enchantments and the
// enchanting table's offers, experience levels, and hunger.

// ---------------------------------------------------------------- status effects
// color: of the swirls around whoever has it; good: shown in blue instead of red
export const EFFECTS = {
  speed: { zh: '迅捷', en: 'Speed', color: [124, 175, 198], good: true },
  slowness: { zh: '缓慢', en: 'Slowness', color: [90, 108, 129] },
  strength: { zh: '力量', en: 'Strength', color: [147, 36, 35], good: true },
  weakness: { zh: '虚弱', en: 'Weakness', color: [72, 77, 72] },
  regeneration: { zh: '生命恢复', en: 'Regeneration', color: [205, 92, 171], good: true },
  poison: { zh: '中毒', en: 'Poison', color: [78, 147, 49] },
  wither: { zh: '凋零', en: 'Wither', color: [53, 42, 39] },
  fire_resistance: { zh: '抗火', en: 'Fire Resistance', color: [228, 154, 58], good: true },
  water_breathing: { zh: '水下呼吸', en: 'Water Breathing', color: [46, 82, 153], good: true },
  night_vision: { zh: '夜视', en: 'Night Vision', color: [31, 31, 161], good: true },
  invisibility: { zh: '隐身', en: 'Invisibility', color: [127, 131, 146], good: true },
  jump_boost: { zh: '跳跃提升', en: 'Jump Boost', color: [34, 255, 76], good: true },
  slow_falling: { zh: '缓降', en: 'Slow Falling', color: [247, 248, 224], good: true },
  hunger: { zh: '饥饿', en: 'Hunger', color: [88, 118, 83] },
  levitation: { zh: '飘浮', en: 'Levitation', color: [206, 255, 255] },
  mining_fatigue: { zh: '挖掘疲劳', en: 'Mining Fatigue', color: [74, 66, 23] },
  absorption: { zh: '伤害吸收', en: 'Absorption', color: [37, 82, 165], good: true },
  resistance: { zh: '抗性提升', en: 'Resistance', color: [153, 69, 58], good: true },
};
export const EFFECT_KEYS = Object.keys(EFFECTS);

// Adds an effect to an effects map ({ key: { t: seconds left, amp } }): a stronger or longer one
// replaces what is there.
export function addEffect(effects, key, seconds, amp = 0) {
  if (!EFFECTS[key]) return;
  const cur = effects[key];
  if (!cur || amp > cur.amp || (amp === cur.amp && seconds > cur.t)) effects[key] = { t: seconds, amp, max: seconds };
}

export const hasEffect = (effects, key) => !!(effects && effects[key] && effects[key].t > 0);
export const effectAmp = (effects, key) => (hasEffect(effects, key) ? effects[key].amp : -1);

// ---------------------------------------------------------------- potions
// Each potion is an item (a drinkable one and a splash one). effect: [key, seconds, amp]; instant:
// health (+) or damage (-) at once.
export const POTIONS = {
  water: { zh: '水瓶', en: 'Water Bottle', color: [56, 93, 198] },
  awkward: { zh: '粗制的药水', en: 'Awkward Potion', color: [56, 93, 198] },
  healing: { zh: '治疗药水', en: 'Potion of Healing', color: [248, 36, 35], instant: 6 },
  harming: { zh: '伤害药水', en: 'Potion of Harming', color: [67, 10, 9], instant: -6 },
  regeneration: { zh: '再生药水', en: 'Potion of Regeneration', color: [205, 92, 171], effect: ['regeneration', 45, 0] },
  strength: { zh: '力量药水', en: 'Potion of Strength', color: [147, 36, 35], effect: ['strength', 180, 0] },
  swiftness: { zh: '迅捷药水', en: 'Potion of Swiftness', color: [124, 175, 198], effect: ['speed', 180, 0] },
  fire_resistance: { zh: '抗火药水', en: 'Potion of Fire Resistance', color: [228, 154, 58], effect: ['fire_resistance', 180, 0] },
  night_vision: { zh: '夜视药水', en: 'Potion of Night Vision', color: [31, 31, 161], effect: ['night_vision', 180, 0] },
  water_breathing: { zh: '水肺药水', en: 'Potion of Water Breathing', color: [46, 82, 153], effect: ['water_breathing', 180, 0] },
  invisibility: { zh: '隐身药水', en: 'Potion of Invisibility', color: [127, 131, 146], effect: ['invisibility', 180, 0] },
  leaping: { zh: '跳跃药水', en: 'Potion of Leaping', color: [34, 255, 76], effect: ['jump_boost', 180, 0] },
  slow_falling: { zh: '缓降药水', en: 'Potion of Slow Falling', color: [247, 248, 224], effect: ['slow_falling', 90, 0] },
  slowness: { zh: '迟缓药水', en: 'Potion of Slowness', color: [90, 108, 129], effect: ['slowness', 90, 0] },
  poison: { zh: '剧毒药水', en: 'Potion of Poison', color: [78, 147, 49], effect: ['poison', 45, 0] },
  weakness: { zh: '虚弱药水', en: 'Potion of Weakness', color: [72, 77, 72], effect: ['weakness', 90, 0] },
};
export const POTION_KEYS = Object.keys(POTIONS);

// What a potion does to whoever drinks it (or is splashed; `k` scales a splash by distance).
// Returns { heal, damage, effects: [[key, seconds, amp]] }.
export function potionOutcome(key, k = 1) {
  const p = POTIONS[key];
  const out = { heal: 0, damage: 0, effects: [] };
  if (!p) return out;
  if (p.instant > 0) out.heal = Math.round(p.instant * k);
  if (p.instant < 0) out.damage = Math.round(-p.instant * k);
  if (p.effect) out.effects.push([p.effect[0], Math.max(1, Math.round(p.effect[1] * (k < 1 ? 0.75 * k : 1))), p.effect[2]]);
  return out;
}

// Brewing: [base potion, ingredient key, result]. Gunpowder turns any potion into its splash form.
// Ingredients are item keys (resolved to ids by items.js).
export const BREWS = [
  ['water', 'nether_wart', 'awkward'],
  ['awkward', 'glistering_melon_slice', 'healing'],
  ['awkward', 'ghast_tear', 'regeneration'],
  ['awkward', 'blaze_powder', 'strength'],
  ['awkward', 'sugar', 'swiftness'],
  ['awkward', 'magma_cream', 'fire_resistance'],
  ['awkward', 'golden_carrot', 'night_vision'],
  ['awkward', 'pufferfish', 'water_breathing'],
  ['awkward', 'spider_eye', 'poison'],
  ['awkward', 'phantom_membrane', 'slow_falling'],
  ['awkward', 'slime_ball', 'leaping'],
  ['water', 'fermented_spider_eye', 'weakness'],
  ['healing', 'fermented_spider_eye', 'harming'],
  ['poison', 'fermented_spider_eye', 'harming'],
  ['night_vision', 'fermented_spider_eye', 'invisibility'],
  ['swiftness', 'fermented_spider_eye', 'slowness'],
  ['leaping', 'fermented_spider_eye', 'slowness'],
  ['strength', 'fermented_spider_eye', 'weakness'],
  ['regeneration', 'fermented_spider_eye', 'weakness'],
];
export const BREW_TIME = 20; // seconds
export const BLAZE_FUEL = 20; // brews per blaze powder

// ---------------------------------------------------------------- enchantments
// kinds: which items take it (tool kinds, 'armor', or 'armor:<slot>'); weight: how often the table offers it
const TOOLS = ['pickaxe', 'axe', 'shovel', 'hoe'];
const DURABLE = ['sword', 'pickaxe', 'axe', 'shovel', 'hoe', 'bow', 'crossbow', 'armor', 'fishing_rod', 'shield', 'shears', 'elytra', 'igniter'];
export const ENCHANTS = {
  sharpness: { zh: '锋利', en: 'Sharpness', max: 5, kinds: ['sword', 'axe'], weight: 10 },
  smite: { zh: '亡灵杀手', en: 'Smite', max: 5, kinds: ['sword', 'axe'], weight: 5 },
  knockback: { zh: '击退', en: 'Knockback', max: 2, kinds: ['sword'], weight: 5 },
  fire_aspect: { zh: '火焰附加', en: 'Fire Aspect', max: 2, kinds: ['sword'], weight: 2 },
  looting: { zh: '抢夺', en: 'Looting', max: 3, kinds: ['sword'], weight: 2 },
  efficiency: { zh: '效率', en: 'Efficiency', max: 5, kinds: TOOLS, weight: 10 },
  silk_touch: { zh: '精准采集', en: 'Silk Touch', max: 1, kinds: TOOLS, weight: 1, not: ['fortune'] },
  fortune: { zh: '时运', en: 'Fortune', max: 3, kinds: TOOLS, weight: 2, not: ['silk_touch'] },
  unbreaking: { zh: '耐久', en: 'Unbreaking', max: 3, kinds: DURABLE, weight: 5 },
  protection: { zh: '保护', en: 'Protection', max: 4, kinds: ['armor'], weight: 10 },
  feather_falling: { zh: '摔落保护', en: 'Feather Falling', max: 4, kinds: ['armor:3'], weight: 5 },
  respiration: { zh: '水下呼吸', en: 'Respiration', max: 3, kinds: ['armor:0'], weight: 2 },
  power: { zh: '力量', en: 'Power', max: 5, kinds: ['bow'], weight: 10 },
  punch: { zh: '冲击', en: 'Punch', max: 2, kinds: ['bow'], weight: 2 },
  flame: { zh: '火矢', en: 'Flame', max: 1, kinds: ['bow'], weight: 2 },
  infinity: { zh: '无限', en: 'Infinity', max: 1, kinds: ['bow'], weight: 1 },
  quick_charge: { zh: '快速装填', en: 'Quick Charge', max: 3, kinds: ['crossbow'], weight: 5 },
  multishot: { zh: '多重射击', en: 'Multishot', max: 1, kinds: ['crossbow'], weight: 2, not: ['piercing'] },
  piercing: { zh: '穿透', en: 'Piercing', max: 4, kinds: ['crossbow'], weight: 10, not: ['multishot'] },
  luck_of_the_sea: { zh: '海之眷顾', en: 'Luck of the Sea', max: 3, kinds: ['fishing_rod'], weight: 2 },
  lure: { zh: '饵钓', en: 'Lure', max: 3, kinds: ['fishing_rod'], weight: 2 },
  mending: { zh: '经验修补', en: 'Mending', max: 1, kinds: DURABLE, weight: 2, treasure: true },
};
export const ENCHANT_KEYS = Object.keys(ENCHANTS);
export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

// Can an item (its definition) take this enchantment?
export function enchantFits(def, key) {
  const e = ENCHANTS[key];
  if (!e || !def) return false;
  return e.kinds.some((k) => k === def.kind || (k === 'armor' && def.kind === 'armor') || (k === 'armor:' + def.slot && def.kind === 'armor'));
}
export const enchantable = (def) => !!def && ENCHANT_KEYS.some((k) => !ENCHANTS[k].treasure && enchantFits(def, k));

// Enchantments on a stack: { key: level } (or undefined).
export const enchLevel = (stack, key) => (stack && stack.ench && stack.ench[key]) || 0;

// The table's three offers for an item, from the bookshelves around it (0-15) and a seed that
// changes each time something is enchanted: [{ cost (levels needed), lapis, ench: { key: level } }]
export function enchantOffers(def, shelves, seed) {
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  if (!enchantable(def)) return [];
  const b = Math.min(15, shelves);
  const base = 1 + Math.floor(rnd() * 8) + Math.floor(b / 2) + Math.floor(rnd() * (b + 1));
  const costs = [Math.max(1, Math.floor(base / 3)), Math.floor((base * 2) / 3) + 1, Math.max(base, b * 2)];
  return costs.map((cost, i) => {
    // the stronger the offer, the higher its levels, and the more enchantments it may carry
    const power = cost + 1 + Math.floor(rnd() * 5);
    const pool = ENCHANT_KEYS.filter((k) => !ENCHANTS[k].treasure && enchantFits(def, k));
    const ench = {};
    let n = 0;
    let chance = 1;
    while (pool.length && rnd() < chance && n < 3) {
      const total = pool.reduce((a, k) => a + ENCHANTS[k].weight, 0);
      let v = rnd() * total, pick = pool[0];
      for (const k of pool) { v -= ENCHANTS[k].weight; if (v <= 0) { pick = k; break; } }
      const e = ENCHANTS[pick];
      ench[pick] = Math.max(1, Math.min(e.max, Math.round((power / 30) * e.max + rnd() * 0.6)));
      n++;
      for (let j = pool.length - 1; j >= 0; j--) if (pool[j] === pick || (e.not || []).includes(pool[j])) pool.splice(j, 1);
      chance = (power + 1) / 50;
    }
    return { cost, lapis: i + 1, ench };
  });
}

// ---------------------------------------------------------------- experience
// Points needed to go from a level to the next.
export function xpForLevel(level) {
  if (level < 16) return 2 * level + 7;
  if (level < 31) return 5 * level - 38;
  return 9 * level - 158;
}

// Adds points to { level, xp } (xp = points into the current level). Returns levels gained.
export function addXp(p, points) {
  let gained = 0;
  p.xp = (p.xp || 0) + points;
  p.level = p.level || 0;
  while (p.xp >= xpForLevel(p.level)) { p.xp -= xpForLevel(p.level); p.level++; gained++; }
  while (p.xp < 0 && p.level > 0) { p.level--; p.xp += xpForLevel(p.level); }
  if (p.xp < 0) p.xp = 0;
  return gained;
}

// Takes whole levels (the enchanting table's price).
export function spendLevels(p, n) {
  p.level = Math.max(0, (p.level || 0) - n);
  p.xp = Math.min(p.xp || 0, xpForLevel(p.level) - 1);
}

export const xpProgress = (p) => (p.xp || 0) / xpForLevel(p.level || 0);

// ---------------------------------------------------------------- hunger
export const MAX_FOOD = 20;
export const EXHAUST = { sprint: 0.1, jump: 0.05, sprintJump: 0.2, attack: 0.1, hurt: 0.1, heal: 6, swim: 0.01, mine: 0.005 };

// One tick of hunger for a player record { food, sat, exhaust, health }. Returns the change to
// health (+ healed, - starved) over `dt` seconds, using p.hungerClock for timing.
export function tickHunger(p, dt, { difficulty = 'normal', maxHealth = 20 } = {}) {
  if (p.food === undefined) { p.food = MAX_FOOD; p.sat = 5; p.exhaust = 0; }
  if (p.exhaust >= 4) {
    p.exhaust -= 4;
    if (p.sat > 0) p.sat = Math.max(0, p.sat - 1);
    else if (difficulty !== 'peaceful') p.food = Math.max(0, p.food - 1);
  }
  p.hungerClock = (p.hungerClock || 0) + dt;
  let dh = 0;
  if (difficulty === 'peaceful' && p.food < MAX_FOOD && p.hungerClock >= 0.5) { p.food++; p.hungerClock = 0; }
  if (p.health < maxHealth) {
    // full and fed: fast healing from saturation; well fed: slow healing
    if (p.food >= MAX_FOOD && p.sat > 0 && p.hungerClock >= 0.5) {
      const use = Math.min(p.sat, 1.5);
      dh = 1;
      p.exhaust += use * 4;
      p.hungerClock = 0;
    } else if (p.food >= 18 && p.hungerClock >= 4) {
      dh = 1;
      p.exhaust += EXHAUST.heal;
      p.hungerClock = 0;
    }
  }
  if (p.food <= 0 && p.hungerClock >= 4) {
    p.hungerClock = 0;
    const floor = difficulty === 'hard' ? 0 : difficulty === 'normal' ? 1 : 10;
    if (p.health > floor) dh = -1;
  }
  return dh;
}

// Eating: food points and saturation (capped by food).
export function eat(p, food, sat) {
  p.food = Math.min(MAX_FOOD, (p.food ?? MAX_FOOD) + food);
  p.sat = Math.min(p.food, (p.sat || 0) + sat);
}
