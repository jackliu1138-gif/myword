// Block entities: what a chest holds, a furnace's slots and fire, the words on a sign. Pure data
// and rules, shared by the game and the multiplayer server (which runs everyone's furnaces).
// Kept per dimension in a Map keyed "x,y,z"; saved as plain objects (see serializeEntity).

import { SMELTING, COOK_TIME, fuelTime, itemDef, ITEM } from './items.js';

export const CHEST_SLOTS = 27;
export const SIGN_LINES = 4;
export const SIGN_CHARS = 18;

export const entityKey = (x, y, z) => x + ',' + y + ',' + z;
export const parseKey = (k) => k.split(',').map(Number);

export function newEntity(kind) {
  if (kind === 'chest') return { kind, slots: new Array(CHEST_SLOTS).fill(null) };
  if (kind === 'furnace') return { kind, slots: [null, null, null], burn: 0, burnMax: 0, cook: 0 };
  if (kind === 'sign') return { kind, lines: new Array(SIGN_LINES).fill('') };
  return null;
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
const slotOut = (s) => (s ? [s.id, s.count, s.wear || 0] : null);
const slotIn = (a) => (Array.isArray(a) && Number.isInteger(a[0]) && itemDef(a[0]) && Number.isInteger(a[1]) && a[1] > 0
  ? { id: a[0], count: Math.min(a[1], stackOf(a[0])), wear: Number.isInteger(a[2]) && a[2] > 0 ? a[2] : 0 } : null);

export function serializeEntity(e) {
  if (!e) return null;
  if (e.kind === 'sign') return { kind: 'sign', lines: e.lines.slice(0, SIGN_LINES) };
  const out = { kind: e.kind, slots: e.slots.map(slotOut) };
  if (e.kind === 'furnace') { out.burn = Math.round(e.burn * 100) / 100; out.burnMax = e.burnMax; out.cook = Math.round(e.cook * 100) / 100; }
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
  if (e.kind === 'furnace') {
    const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0);
    e.burnMax = num(o.burnMax, 1000);
    e.burn = Math.min(num(o.burn, 1000), e.burnMax);
    e.cook = num(o.cook, COOK_TIME);
  }
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
  return e.slots.filter(Boolean).map((s) => [s.id, s.count, s.wear || 0]);
}
