// A* path finding over the voxel grid for walking creatures: steps up one block, drops up to
// three, swims, never cuts corners and avoids lava and cacti. Positions are feet blocks.

import { BLOCK, IS_LIQUID } from '../world/blocks.js';

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= n.f) break;
      a[i] = a[p]; a[p] = n; i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        const t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top;
  }
}

const key = (x, y, z) => ((x & 0x3ff) << 20) | ((z & 0x3ff) << 8) | (y & 0xff);

export function makeWalker(world, height = 2) {
  const solid = (x, y, z) => world.isSolidAt(x, y, z);
  const bad = (b) => b === BLOCK.LAVA || b === BLOCK.CACTUS;
  // standing with feet in (x, y, z)
  return function walkable(x, y, z) {
    if (y < 1 || y > 126) return 0;
    const feet = world.getBlock(x, y, z);
    if (solid(x, y, z) || bad(feet)) return 0;
    if (height > 1 && (solid(x, y + 1, z) || bad(world.getBlock(x, y + 1, z)))) return 0;
    if (IS_LIQUID[feet] && feet === BLOCK.WATER) return 2; // swimming: allowed, costs more
    const below = world.getBlock(x, y - 1, z);
    if (bad(below)) return 0;
    return solid(x, y - 1, z) ? 1 : IS_LIQUID[below] ? 2 : 0;
  };
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Returns [[x, y, z], ...] from start (exclusive) to goal, or to the closest reachable node when
// the goal can't be reached within the node budget. null when nothing useful was found.
export function findPath(world, start, goal, { height = 2, maxNodes = 500, walkable = null } = {}) {
  const walk = walkable || makeWalker(world, height);
  const [sx, sy, sz] = start;
  const [gx, gy, gz] = goal;
  const h = (x, y, z) => {
    const dx = Math.abs(x - gx), dz = Math.abs(z - gz);
    return Math.max(dx, dz) + 0.41 * Math.min(dx, dz) + Math.abs(y - gy) * 0.5;
  };
  const open = new Heap();
  const nodes = new Map();
  const startNode = { x: sx, y: sy, z: sz, g: 0, f: h(sx, sy, sz), parent: null, closed: false };
  nodes.set(key(sx, sy, sz), startNode);
  open.push(startNode);
  let best = startNode, bestH = startNode.f;
  let expanded = 0;
  while (open.size && expanded < maxNodes) {
    const n = open.pop();
    if (n.closed) continue;
    n.closed = true;
    expanded++;
    const nh = h(n.x, n.y, n.z);
    if (nh < bestH) { best = n; bestH = nh; }
    if (n.x === gx && n.z === gz && Math.abs(n.y - gy) <= 1) { best = n; break; }
    for (let d = 0; d < 8; d++) {
      const [dx, dz] = DIRS[d];
      const x = n.x + dx, z = n.z + dz;
      const diag = d >= 4;
      for (const dy of [0, 1, -1, -2, -3]) {
        const y = n.y + dy;
        const w = walk(x, y, z);
        if (!w) continue;
        if (dy === 1 && world.isSolidAt(n.x, n.y + height, n.z)) continue; // no head room to jump
        if (dy < 0) {
          // the column we drop through must be open
          let clear = true;
          for (let k = n.y; k > y; k--) if (world.isSolidAt(x, k, z)) { clear = false; break; }
          if (!clear) continue;
        }
        if (diag && (!walk(n.x + dx, n.y, n.z) || !walk(n.x, n.y, n.z + dz))) continue;
        const cost = (diag ? 1.414 : 1) * (w === 2 ? 2.5 : 1) + (dy > 0 ? 0.6 : dy < 0 ? 0.2 * -dy : 0);
        const g = n.g + cost;
        const k = key(x, y, z);
        let m = nodes.get(k);
        if (!m) { m = { x, y, z, g: Infinity, f: 0, parent: null, closed: false }; nodes.set(k, m); }
        if (m.closed || g >= m.g) continue;
        m.g = g;
        m.f = g + h(x, y, z);
        m.parent = n;
        open.push(m);
        break; // take the first (highest) valid height for this direction
      }
    }
  }
  if (best === startNode) return null;
  const out = [];
  for (let n = best; n && n !== startNode; n = n.parent) out.push([n.x, n.y, n.z]);
  return out.reverse();
}
