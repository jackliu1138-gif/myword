// A player's inventory: 45 slots (0-8 are the hotbar, 9-44 the bag), four armour slots and the
// stack held on the mouse cursor while items are moved around the inventory screen.
// A slot is null or { id, count, wear }. Slots are addressed by a reference: 0-44 for the hotbar
// and bag, ARMOR_REF + 0..3 for helmet, chestplate, leggings and boots.

import { itemDef, PLANKS } from './items.js';

export const HOTBAR = 9;
export const INV_SIZE = 45;
export const ARMOR_REF = 100;

const copy = (s) => (s ? { id: s.id, count: s.count, wear: s.wear || 0 } : null);

export class Inventory {
  constructor(size = INV_SIZE) {
    this.slots = new Array(size).fill(null);
    this.armor = [null, null, null, null];
    this.cursor = null;
    this.onChange = null;
  }

  changed() {
    if (this.onChange) this.onChange();
  }

  stackOf(id) {
    const d = itemDef(id);
    return d ? d.stack : 64;
  }

  get(ref) {
    return ref >= ARMOR_REF ? this.armor[ref - ARMOR_REF] || null : this.slots[ref] || null;
  }

  set(ref, s) {
    if (ref >= ARMOR_REF) this.armor[ref - ARMOR_REF] = s;
    else this.slots[ref] = s;
  }

  // Can this stack go in that slot? (armour slots take only their own piece)
  accepts(ref, s) {
    if (!s || ref < ARMOR_REF) return true;
    const d = itemDef(s.id);
    return !!d && d.kind === 'armor' && d.slot === ref - ARMOR_REF;
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
    if (!c) {
      const n = button === 2 ? Math.ceil(s.count / 2) : s.count;
      this.cursor = { id: s.id, count: n, wear: s.wear || 0 };
      s.count -= n;
      if (s.count <= 0) this.set(ref, null);
    } else if (!this.accepts(ref, c)) {
      return false;
    } else if (!s) {
      const n = button === 2 ? 1 : c.count;
      this.set(ref, { id: c.id, count: n, wear: c.wear || 0 });
      c.count -= n;
      if (c.count <= 0) this.cursor = null;
    } else if (s.id === c.id && !s.wear && !c.wear) {
      const room = this.stackOf(s.id) - s.count;
      const n = Math.min(room, button === 2 ? 1 : c.count);
      if (n <= 0) { this.set(ref, c); this.cursor = s; } // a full stack: swap
      else {
        s.count += n;
        c.count -= n;
        if (c.count <= 0) this.cursor = null;
      }
    } else {
      if (ref >= ARMOR_REF && c.count > 1) return false;
      this.set(ref, c);
      this.cursor = s;
    }
    this.changed();
    return true;
  }

  // Shift-click: armour onto the body (and back), hotbar <-> bag.
  quickMove(ref) {
    const s = this.get(ref);
    if (!s) return false;
    const d = itemDef(s.id);
    let targets;
    if (ref >= ARMOR_REF) targets = [...this.slots.keys()].slice(HOTBAR).concat([...this.slots.keys()].slice(0, HOTBAR));
    else if (d && d.kind === 'armor' && !this.armor[d.slot]) targets = [ARMOR_REF + d.slot];
    else if (ref < HOTBAR) targets = [...this.slots.keys()].slice(HOTBAR);
    else targets = [...this.slots.keys()].slice(0, HOTBAR);
    const max = this.stackOf(s.id);
    // top up matching stacks first, then empty slots
    for (const t of targets) {
      const o = this.get(t);
      if (!o || o.id !== s.id || o.wear || s.wear || o.count >= max) continue;
      const n = Math.min(max - o.count, s.count);
      o.count += n;
      s.count -= n;
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
    if (s.count <= 0) this.set(ref, null);
    this.changed();
    return true;
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
    const left = this.add(c.id, c.count, c.wear);
    this.changed();
    return left > 0 ? { id: c.id, count: left, wear: c.wear } : null;
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
    this.cursor = null;
    this.changed();
  }

  // [...slots, ...armour] as [id, count, wear] or null
  serialize() {
    return this.slots.concat(this.armor).map((s) => (s ? [s.id, s.count, s.wear || 0] : null));
  }

  load(data) {
    this.slots.fill(null);
    this.armor.fill(null);
    this.cursor = null;
    if (Array.isArray(data)) {
      // older saves hold 36 slots; the armour follows the 45 slots in newer ones
      const n = this.slots.length;
      data.forEach((s, i) => {
        if (!s || !itemDef(s[0])) return;
        const st = { id: s[0], count: s[1], wear: s[2] || 0 };
        if (i < n) this.slots[i] = st;
        else if (data.length > n && i - n < 4 && this.accepts(ARMOR_REF + i - n, st)) this.armor[i - n] = st;
      });
    }
    this.changed();
  }

  snapshot() {
    return { slots: this.slots.map(copy), armor: this.armor.map(copy), cursor: copy(this.cursor) };
  }
}

// Damage left after armour: points soak up to 80% of a hit, less against big hits unless the
// armour is tough (the usual formula).
export function armorReduce(damage, points, toughness) {
  if (points <= 0 || damage <= 0) return damage;
  const eff = Math.min(20, Math.max(points / 5, points - damage / (2 + toughness / 4)));
  return damage * (1 - eff / 25);
}
