// Block entities: what a chest holds, a furnace's slots and fire, the words on a sign. Pure data
// and rules, shared by the game and the multiplayer server (which runs everyone's furnaces).
// Kept per dimension in a Map keyed "x,y,z"; saved as plain objects (see serializeEntity).

import { SMELTING, COOK_TIME, fuelTime, itemDef, ITEM, POTION_ITEMS, SPLASH_ITEMS } from './items.js';
import { BREWS, BREW_TIME, BLAZE_FUEL } from './effects.js';
import { stackOut, stackIn } from './inventory.js';

export const CHEST_SLOTS = 27;
export const SIGN_LINES = 4;
export const SIGN_CHARS = 18;

export const entityKey = (x, y, z) => x + ',' + y + ',' + z;
export const parseKey = (k) => k.split(',').map(Number);

export function newEntity(kind) {
  if (kind === 'chest') return { kind, slots: new Array(CHEST_SLOTS).fill(null) };
  if (kind === 'furnace') return { kind, slots: [null, null, null], burn: 0, burnMax: 0, cook: 0 };
  if (kind === 'brewing') return { kind, slots: [null, null, null, null, null], brew: 0, fuel: 0 };
  if (kind === 'sign') return { kind, lines: new Array(SIGN_LINES).fill('') };
  return null;
}

// ---------------------------------------------------------------- the brewing stand
// Slots: three bottles, the ingredient, blaze powder for fuel. A brew takes BREW_TIME seconds and
// uses the ingredient up; each blaze powder is good for BLAZE_FUEL brews.
export const BREW_BOTTLES = 3, BREW_INGREDIENT = 3, BREW_FUEL = 4;
const potionItem = (key) => POTION_ITEMS[key];
const splashItem = (key) => SPLASH_ITEMS[key];
// what brewing the ingredient into the bottle's potion gives (an item id), or 0
export function brewResult(bottleId, ingredientId) {
  const b = itemDef(bottleId), ing = itemDef(ingredientId);
  if (!b || !ing || (b.kind !== 'potion' && b.kind !== 'splash')) return 0;
  if (ing.key === 'gunpowder') return b.kind === 'potion' && b.potion !== 'awkward' ? splashItem(b.potion) || 0 : 0;
  for (const [from, key, to] of BREWS) {
    if (from === b.potion && key === ing.key) return b.kind === 'splash' ? splashItem(to) || 0 : potionItem(to) || 0;
  }
  return 0;
}
export const isBrewIngredient = (id) => { const d = itemDef(id); return !!d && (d.key === 'gunpowder' || BREWS.some((r) => r[1] === d.key)); };
export const isBottle = (id) => { const d = itemDef(id); return !!d && (d.kind === 'potion' || d.kind === 'splash'); };

export function canBrew(e) {
  const ing = e.slots[BREW_INGREDIENT];
  if (!ing) return false;
  for (let i = 0; i < BREW_BOTTLES; i++) if (e.slots[i] && brewResult(e.slots[i].id, ing.id)) return true;
  return false;
}

// Returns true when the slots changed.
export function tickBrewing(e, dt) {
  let changed = false;
  if (!canBrew(e)) { if (e.brew > 0) { e.brew = 0; changed = true; } return changed; }
  if (e.fuel <= 0 && e.brew <= 0) {
    const f = e.slots[BREW_FUEL];
    if (!f || f.id !== ITEM.BLAZE_POWDER) return false;
    if (--f.count <= 0) e.slots[BREW_FUEL] = null;
    e.fuel = BLAZE_FUEL;
    changed = true;
  }
  if (e.brew <= 0) { e.brew = BREW_TIME; e.fuel--; changed = true; }
  e.brew -= dt;
  if (e.brew <= 0) {
    e.brew = 0;
    const ing = e.slots[BREW_INGREDIENT];
    for (let i = 0; i < BREW_BOTTLES; i++) {
      const s = e.slots[i];
      const r = s && brewResult(s.id, ing.id);
      if (r) e.slots[i] = { id: r, count: 1, wear: 0 };
    }
    if (--ing.count <= 0) e.slots[BREW_INGREDIENT] = null;
    changed = true;
  }
  return changed;
}

const stackOf = (id) => { const d = itemDef(id); return d ? d.stack : 64; };

// ---------------------------------------------------------------- the furnace
// A furnace cooks while it burns: each piece of fuel burns for its time whether or not there is
// anything left to cook; the next piece is only lit when there is. Returns true when its slots
// changed (an item cooked, a fuel was used).
export function canCook(f) {
  const input = f.slots[0], out = f.slots[2];
  const r = input && SMELTING.get(input.id);
  if (!r) return false;
  return !out || (out.id === r[0] && !out.wear && out.count + r[1] <= stackOf(out.id));
}

export function tickFurnace(f, dt) {
  let changed = false;
  if (f.burn > 0) f.burn = Math.max(0, f.burn - dt);
  const cookable = canCook(f);
  if (f.burn <= 0 && cookable) {
    const fuel = f.slots[1];
    const t = fuel ? fuelTime(fuel.id) : 0;
    if (t > 0) {
      f.burn = f.burnMax = t;
      if (fuel.id === ITEM.LAVA_BUCKET) f.slots[1] = { id: ITEM.BUCKET, count: 1, wear: 0 };
      else if (--fuel.count <= 0) f.slots[1] = null;
      changed = true;
    }
  }
  if (f.burn > 0 && cookable) {
    f.cook += dt;
    if (f.cook >= COOK_TIME) {
      f.cook = 0;
      const [out, n] = SMELTING.get(f.slots[0].id);
      if (--f.slots[0].count <= 0) f.slots[0] = null;
      if (f.slots[2]) f.slots[2].count += n;
      else f.slots[2] = { id: out, count: n, wear: 0 };
      changed = true;
    }
  } else if (f.cook > 0) f.cook = Math.max(0, f.cook - dt * 2); // it cools down without fire
  return changed;
}

export const furnaceLit = (f) => f.burn > 0;

// ---------------------------------------------------------------- saving and the network
const slotOut = stackOut;
const slotIn = stackIn;

export function serializeEntity(e) {
  if (!e) return null;
  if (e.kind === 'sign') return { kind: 'sign', lines: e.lines.slice(0, SIGN_LINES) };
  const out = { kind: e.kind, slots: e.slots.map(slotOut) };
  if (e.kind === 'furnace') { out.burn = Math.round(e.burn * 100) / 100; out.burnMax = e.burnMax; out.cook = Math.round(e.cook * 100) / 100; }
  if (e.kind === 'brewing') { out.brew = Math.round(e.brew * 100) / 100; out.fuel = e.fuel; }
  return out;
}

// Reads a saved (or received) entity, checking everything: bad data gives null.
export function loadEntity(o) {
  if (!o || typeof o !== 'object') return null;
  const e = newEntity(o.kind);
  if (!e) return null;
  if (e.kind === 'sign') {
    const lines = Array.isArray(o.lines) ? o.lines : [];
    e.lines = e.lines.map((_, i) => String(lines[i] ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, SIGN_CHARS));
    return e;
  }
  const slots = Array.isArray(o.slots) ? o.slots : [];
  e.slots = e.slots.map((_, i) => slotIn(slots[i]));
  const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0);
  if (e.kind === 'furnace') {
    e.burnMax = num(o.burnMax, 1000);
    e.burn = Math.min(num(o.burn, 1000), e.burnMax);
    e.cook = num(o.cook, COOK_TIME);
  }
  if (e.kind === 'brewing') { e.brew = num(o.brew, BREW_TIME); e.fuel = Math.round(num(o.fuel, BLAZE_FUEL)); }
  return e;
}

// { "x,y,z": entity } <-> Map
export function serializeEntities(map) {
  const out = {};
  if (map) for (const [k, e] of map) { const s = serializeEntity(e); if (s) out[k] = s; }
  return out;
}

export function loadEntities(obj) {
  const m = new Map();
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      if (!/^-?\d+,-?\d+,-?\d+$/.test(k)) continue;
      const e = loadEntity(obj[k]);
      if (e) m.set(k, e);
    }
  }
  return m;
}

// Everything a broken chest or furnace spills: [[id, count, wear], ...]
export function contentsOf(e) {
  if (!e || !e.slots) return [];
  return e.slots.filter(Boolean).map(stackOut);
}
