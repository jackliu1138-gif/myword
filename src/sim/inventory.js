// A player's inventory: 36 slots (0-8 are the hotbar). A slot is null or { id, count, wear }.

import { itemDef, PLANKS } from './items.js';

export const INV_SIZE = 36;

export class Inventory {
  constructor(size = INV_SIZE) {
    this.slots = new Array(size).fill(null);
    this.onChange = null;
  }

  changed() {
    if (this.onChange) this.onChange();
  }

  stackOf(id) {
    const d = itemDef(id);
    return d ? d.stack : 64;
  }

  // Adds items, filling matching stacks first (hotbar first). Returns what didn't fit.
  add(id, count = 1, wear = 0) {
    const max = this.stackOf(id);
    let left = count;
    if (max > 1) {
      for (const s of this.slots) {
        if (left <= 0) break;
        if (s && s.id === id && s.count < max) {
          const n = Math.min(max - s.count, left);
          s.count += n;
          left -= n;
        }
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (this.slots[i]) continue;
      const n = Math.min(max, left);
      this.slots[i] = { id, count: n, wear };
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
    const order = [...this.slots.keys()].slice(9).concat([...this.slots.keys()].slice(0, 9));
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

  // Wears a tool down; it breaks when its durability runs out. Returns true if it broke.
  wear(slot, amount = 1) {
    const s = this.slots[slot];
    const d = s && itemDef(s.id);
    if (!d || !d.durability) return false;
    s.wear = (s.wear || 0) + amount;
    const broke = s.wear >= d.durability;
    if (broke) this.slots[slot] = null;
    this.changed();
    return broke;
  }

  swap(a, b) {
    const t = this.slots[a];
    this.slots[a] = this.slots[b];
    this.slots[b] = t;
    this.changed();
  }

  clear() {
    this.slots.fill(null);
    this.changed();
  }

  serialize() {
    return this.slots.map((s) => (s ? [s.id, s.count, s.wear || 0] : null));
  }

  load(data) {
    this.slots.fill(null);
    if (Array.isArray(data)) {
      data.forEach((s, i) => {
        if (s && i < this.slots.length && itemDef(s[0])) this.slots[i] = { id: s[0], count: s[1], wear: s[2] || 0 };
      });
    }
    this.changed();
  }
}
