// A player's inventory: 45 slots (0-8 are the hotbar, 9-44 the bag), four armour slots and the
// stack held on the mouse cursor while items are moved around the inventory screen, plus the
// slots of whatever chest or furnace is open.
// A slot is null or { id, count, wear, ench } (ench: { enchantment: level }, on enchanted gear).
// Slots are addressed by a reference: 0-44 for the hotbar and bag, ARMOR_REF + 0..3 for helmet,
// chestplate, leggings and boots, OFFHAND_REF for the other hand (a shield, a torch...),
// CONTAINER_REF + i for the open container's slots (a furnace's are input, fuel and output).

import { itemDef, PLANKS, SMELTING, fuelTime, ITEM } from './items.js';
import { ENCHANTS, enchantable } from './effects.js';
import { isBottle, isBrewIngredient } from './containers.js';

export const HOTBAR = 9;
export const INV_SIZE = 45;
export const ARMOR_REF = 100;
export const OFFHAND_REF = 104;
export const CONTAINER_REF = 200;
export const FURNACE_INPUT = CONTAINER_REF, FURNACE_FUEL = CONTAINER_REF + 1, FURNACE_OUTPUT = CONTAINER_REF + 2;

const copy = (s) => (s ? withEnch({ id: s.id, count: s.count, wear: s.wear || 0 }, s.ench) : null);
function withEnch(s, ench) {
  if (ench && Object.keys(ench).length) s.ench = { ...ench };
  return s;
}
// can two stacks share a slot?
const same = (a, b) => a.id === b.id && !a.wear && !b.wear && !a.ench && !b.ench;
export { withEnch };

export class Inventory {
  constructor(size = INV_SIZE) {
    this.slots = new Array(size).fill(null);
    this.armor = [null, null, null, null];
    this.offhand = null;
    this.cursor = null;
    this.onChange = null;
    this.container = null; // the open chest or furnace: { kind, slots, ... } (see containers.js)
    this.onContainerChange = null;
  }

  changed() {
    if (this.onChange) this.onChange();
  }

  stackOf(id) {
    const d = itemDef(id);
    return d ? d.stack : 64;
  }

  get(ref) {
    if (ref >= CONTAINER_REF) return (this.container && this.container.slots[ref - CONTAINER_REF]) || null;
    if (ref === OFFHAND_REF) return this.offhand || null;
    return ref >= ARMOR_REF ? this.armor[ref - ARMOR_REF] || null : this.slots[ref] || null;
  }

  set(ref, s) {
    if (ref >= CONTAINER_REF) {
      if (!this.container) return;
      this.container.slots[ref - CONTAINER_REF] = s;
      if (this.onContainerChange) this.onContainerChange();
    } else if (ref === OFFHAND_REF) this.offhand = s;
    else if (ref >= ARMOR_REF) this.armor[ref - ARMOR_REF] = s;
    else this.slots[ref] = s;
  }

  // Can this stack go in that slot? (armour slots take only their own piece; a furnace's fuel
  // slot takes fuel, and nothing goes into its output)
  accepts(ref, s) {
    if (!s || ref < ARMOR_REF || ref === OFFHAND_REF) return true;
    if (ref >= CONTAINER_REF) {
      if (!this.container) return false;
      if (this.container.kind === 'furnace') {
        if (ref === FURNACE_OUTPUT) return false;
        if (ref === FURNACE_FUEL) return fuelTime(s.id) > 0;
      }
      const i = ref - CONTAINER_REF;
      if (this.container.kind === 'brewing') return i < 3 ? isBottle(s.id) && s.count === 1 : i === 3 ? isBrewIngredient(s.id) : i === 4 ? s.id === ITEM.BLAZE_POWDER : false;
      if (this.container.kind === 'enchant') return i === 0 ? s.count === 1 && enchantable(itemDef(s.id)) && !s.ench : i === 1 ? s.id === ITEM.LAPIS_LAZULI : false;
      return ref - CONTAINER_REF < this.container.slots.length;
    }
    const d = itemDef(s.id);
    return !!d && d.kind === 'armor' && d.slot === ref - ARMOR_REF;
  }

  takeOnly(ref) {
    if (!this.container || ref < CONTAINER_REF) return false;
    if (this.container.takeOnly) return this.container.takeOnly(ref - CONTAINER_REF);
    return ref === FURNACE_OUTPUT && this.container.kind === 'furnace';
  }

  // Adds items, filling matching stacks first (hotbar first). Returns what didn't fit.
  add(id, count = 1, wear = 0, ench = null) {
    const max = this.stackOf(id);
    let left = count;
    if (max > 1 && !ench && !wear) {
      for (const s of this.slots) {
        if (left <= 0) break;
        if (s && s.id === id && !s.ench && !s.wear && s.count < max) {
          const n = Math.min(max - s.count, left);
          s.count += n;
          left -= n;
        }
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (this.slots[i]) continue;
      const n = Math.min(max, left);
      this.slots[i] = withEnch({ id, count: n, wear }, ench);
      left -= n;
    }
    if (left !== count) this.changed();
    return left;
  }

  // Whole-inventory count of an item; 'planks' counts every kind of plank.
  count(id) {
    let n = 0;
    for (const s of this.slots) {
      if (!s) continue;
      if (id === 'planks' ? PLANKS.includes(s.id) : s.id === id) n += s.count;
    }
    return n;
  }

  has(id, n = 1) {
    return this.count(id) >= n;
  }

  // Removes n of an item from anywhere (hotbar last). Returns how many were removed.
  take(id, n = 1) {
    let left = n;
    const order = [...this.slots.keys()].slice(HOTBAR).concat([...this.slots.keys()].slice(0, HOTBAR));
    for (const i of order) {
      const s = this.slots[i];
      if (!s || left <= 0) continue;
      if (id === 'planks' ? !PLANKS.includes(s.id) : s.id !== id) continue;
      const k = Math.min(s.count, left);
      s.count -= k;
      left -= k;
      if (s.count <= 0) this.slots[i] = null;
    }
    if (left !== n) this.changed();
    return n - left;
  }

  // Uses one of the item in a slot (placing a block, eating, shooting an arrow).
  consume(slot, n = 1) {
    const s = this.slots[slot];
    if (!s) return false;
    s.count -= n;
    if (s.count <= 0) this.slots[slot] = null;
    this.changed();
    return true;
  }

  // Wears a tool (or a piece of armour, by reference) down; it breaks when its durability runs out.
  // Returns true if it broke.
  wear(ref, amount = 1) {
    const s = this.get(ref);
    const d = s && itemDef(s.id);
    if (!d || !d.durability) return false;
    // unbreaking: most of the wear passes it by (armour a little less so)
    const ub = s.ench && s.ench.unbreaking;
    if (ub) {
      let n = 0;
      for (let k = 0; k < amount; k++) if (d.kind === 'armor' ? Math.random() < 0.6 + 0.4 / (ub + 1) : Math.random() < 1 / (ub + 1)) n++;
      amount = n;
      if (!amount) return false;
    }
    s.wear = (s.wear || 0) + amount;
    const broke = s.wear >= d.durability;
    if (broke) this.set(ref, null);
    this.changed();
    return broke;
  }

  swap(a, b) {
    const t = this.get(a);
    this.set(a, this.get(b));
    this.set(b, t);
    this.changed();
  }

  // ------------------------------------------------------------ the inventory screen
  // A click on a slot with whatever is on the cursor. button 0: pick the stack up, put the cursor
  // down, merge it into a matching stack or swap the two; button 2: pick up half, or put one down.
  click(ref, button = 0) {
    const s = this.get(ref);
    const c = this.cursor;
    if (!c && !s) return false;
    if (c && this.takeOnly(ref)) {
      // a furnace's output: what is held takes more of the same
      if (!s || !same(s, c)) return false;
      const n = Math.min(s.count, this.stackOf(c.id) - c.count);
      if (n <= 0) return false;
      c.count += n;
      s.count -= n;
      this.set(ref, s.count > 0 ? s : null);
      this.changed();
      return true;
    }
    if (!c) {
      const n = button === 2 ? Math.ceil(s.count / 2) : s.count;
      this.cursor = withEnch({ id: s.id, count: n, wear: s.wear || 0 }, s.ench);
      s.count -= n;
      this.set(ref, s.count <= 0 ? null : s);
    } else if (!this.accepts(ref, c)) {
      return false;
    } else if (!s) {
      const n = button === 2 ? 1 : c.count;
      this.set(ref, withEnch({ id: c.id, count: n, wear: c.wear || 0 }, c.ench));
      c.count -= n;
      if (c.count <= 0) this.cursor = null;
    } else if (same(s, c)) {
      const room = this.stackOf(s.id) - s.count;
      const n = Math.min(room, button === 2 ? 1 : c.count);
      if (n <= 0) { this.set(ref, c); this.cursor = s; } // a full stack: swap
      else {
        s.count += n;
        c.count -= n;
        if (c.count <= 0) this.cursor = null;
        this.set(ref, s);
      }
    } else {
      if (ref >= ARMOR_REF && ref < CONTAINER_REF && c.count > 1) return false;
      this.set(ref, c);
      this.cursor = s;
    }
    this.changed();
    return true;
  }

  // Shift-click: between an open chest or furnace and the inventory, armour onto the body (and
  // back), hotbar <-> bag.
  quickMove(ref) {
    const s = this.get(ref);
    if (!s) return false;
    const d = itemDef(s.id);
    let targets;
    const box = this.container;
    const bagFirst = () => [...this.slots.keys()].slice(HOTBAR).concat([...this.slots.keys()].slice(0, HOTBAR));
    if (ref >= CONTAINER_REF) targets = bagFirst();
    else if (box && ref < ARMOR_REF && box.kind === 'chest') targets = box.slots.map((_, i) => CONTAINER_REF + i);
    else if (box && ref < ARMOR_REF && box.kind === 'furnace' && SMELTING.has(s.id)) targets = [FURNACE_INPUT];
    else if (box && ref < ARMOR_REF && box.kind === 'furnace' && fuelTime(s.id) > 0) targets = [FURNACE_FUEL];
    else if (box && ref < ARMOR_REF && box.kind === 'brewing') targets = (isBottle(s.id) ? [0, 1, 2] : s.id === ITEM.BLAZE_POWDER ? [4, 3] : isBrewIngredient(s.id) ? [3] : []).map((i) => CONTAINER_REF + i);
    else if (box && ref < ARMOR_REF && box.kind === 'enchant') targets = (s.id === ITEM.LAPIS_LAZULI ? [1] : [0]).map((i) => CONTAINER_REF + i);
    else if (ref >= ARMOR_REF) targets = bagFirst();
    else if (d && d.kind === 'armor' && !this.armor[d.slot]) targets = [ARMOR_REF + d.slot];
    else if (ref < HOTBAR) targets = [...this.slots.keys()].slice(HOTBAR);
    else targets = [...this.slots.keys()].slice(0, HOTBAR);
    const max = this.stackOf(s.id);
    const before = s.count;
    // top up matching stacks first, then empty slots
    for (const t of targets) {
      const o = this.get(t);
      if (!o || !same(o, s) || o.count >= max) continue;
      const n = Math.min(max - o.count, s.count);
      o.count += n;
      s.count -= n;
      this.set(t, o);
      if (s.count <= 0) break;
    }
    if (s.count > 0) {
      for (const t of targets) {
        if (this.get(t) || !this.accepts(t, s)) continue;
        this.set(t, s);
        this.set(ref, null);
        this.changed();
        return true;
      }
    }
    this.set(ref, s.count <= 0 ? null : s);
    this.changed();
    return s.count !== before;
  }

  // Put a whole stack on the cursor (the creative palette); the cursor's own stack is replaced.
  holdNew(id, count) {
    this.cursor = { id, count: Math.min(count, this.stackOf(id)), wear: 0 };
    this.changed();
  }

  // Closing the screen: whatever is on the cursor goes back into the inventory. Returns what
  // didn't fit ({ id, count, wear } or null) for the caller to drop.
  returnCursor() {
    const c = this.cursor;
    if (!c) return null;
    this.cursor = null;
    const left = this.add(c.id, c.count, c.wear, c.ench);
    this.changed();
    return left > 0 ? withEnch({ id: c.id, count: left, wear: c.wear }, c.ench) : null;
  }

  // Armour points and toughness of what is worn.
  armorValues() {
    let points = 0, toughness = 0;
    for (const s of this.armor) {
      const d = s && itemDef(s.id);
      if (d && d.kind === 'armor') { points += d.armor; toughness += d.toughness; }
    }
    return { points, toughness };
  }

  armorIds() {
    return this.armor.map((s) => (s ? s.id : 0));
  }

  clear() {
    this.slots.fill(null);
    this.armor.fill(null);
    this.offhand = null;
    this.cursor = null;
    this.changed();
  }

  // [...slots, ...armour, offhand] as [id, count, wear, ench?] or null
  serialize() {
    return this.slots.concat(this.armor, [this.offhand]).map(stackOut);
  }

  load(data) {
    this.slots.fill(null);
    this.armor.fill(null);
    this.offhand = null;
    this.cursor = null;
    if (Array.isArray(data)) {
      // older saves hold 36 slots; the armour follows the 45 slots in newer ones, then the offhand
      const n = this.slots.length;
      data.forEach((s, i) => {
        const st = stackIn(s);
        if (!st) return;
        if (i < n) this.slots[i] = st;
        else if (data.length > n && i - n < 4 && this.accepts(ARMOR_REF + i - n, st)) this.armor[i - n] = st;
        else if (i === n + 4) this.offhand = st;
      });
    }
    this.changed();
  }

  snapshot() {
    return { slots: this.slots.map(copy), armor: this.armor.map(copy), offhand: copy(this.offhand), cursor: copy(this.cursor) };
  }
}

// A stack for saving or sending: [id, count, wear] (and its enchantments, if any).
export function stackOut(s) {
  if (!s) return null;
  const a = [s.id, s.count, s.wear || 0];
  if (s.ench && Object.keys(s.ench).length) a.push(s.ench);
  return a;
}

// ... and back, checking everything (bad data gives null).
export function stackIn(a) {
  if (!Array.isArray(a) || !Number.isInteger(a[0]) || !itemDef(a[0]) || !Number.isInteger(a[1]) || a[1] <= 0) return null;
  const d = itemDef(a[0]);
  const s = { id: a[0], count: Math.min(a[1], d.stack || 64), wear: Number.isInteger(a[2]) && a[2] > 0 ? a[2] : 0 };
  if (a[3] && typeof a[3] === 'object' && !Array.isArray(a[3])) {
    const ench = {};
    for (const [k, v] of Object.entries(a[3])) if (ENCHANTS[k] && Number.isInteger(v) && v > 0) ench[k] = Math.min(v, ENCHANTS[k].max);
    if (Object.keys(ench).length) s.ench = ench;
  }
  return s;
}

// Damage left after armour: points soak up to 80% of a hit, less against big hits unless the
// armour is tough (the usual formula).
export function armorReduce(damage, points, toughness) {
  if (points <= 0 || damage <= 0) return damage;
  const eff = Math.min(20, Math.max(points / 5, points - damage / (2 + toughness / 4)));
  return damage * (1 - eff / 25);
}
