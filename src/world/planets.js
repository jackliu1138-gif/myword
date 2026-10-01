// The Moon and Mars (dimensions 4 and 5), the floating stations over the clouds of Jupiter and
// Saturn (6 and 7), and the empty generator of space (3).
//  - The Moon: grey dust over pale highland rock, dark lava plains (maria, mostly on the side that
//    faces the Earth) and craters of every size, the big ones with flat floors and central peaks.
//  - Mars: rust-red dust over dark rock; the smooth lowlands of the north and the cratered highlands
//    of the south, a few great shield volcanoes, a canyon along the equator and ice at the poles.
// Their maps seen from space (mapTexel) come from the same shapes.

import { Simplex, hash2, hash3 } from './noise.js';
import { BLOCK, CHUNK_SIZE, WORLD_HEIGHT } from './blocks.js';
import { BODIES, worldToLonLat, dirOf } from './space.js';
import { BIOME } from './generator.js';

const B = BLOCK;
const CS = CHUNK_SIZE;
const H = WORLD_HEIGHT;
const idx = (x, y, z) => (y << 8) | (z << 4) | x;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Craters on a grid: each layer's cells (blocks) hold at most one crater, of a radius up to 0.42 of
// the cell, within the middle of it (so the 3 x 3 cells around a point are all that can reach it).
// Bowls deepen with size up to `maxDepth`; big ones get flat floors and central peaks.
function craterField(seed, layers, x, z, density, opt) {
  let h = 0, fresh = 0;
  for (let li = 0; li < layers.length; li++) {
    const L = layers[li];
    const p = L.p * (L.cell >= opt.dense ? density : 1);
    const gx0 = Math.floor(x / L.cell), gz0 = Math.floor(z / L.cell);
    for (let gz = gz0 - 1; gz <= gz0 + 1; gz++) {
      for (let gx = gx0 - 1; gx <= gx0 + 1; gx++) {
        const s = seed ^ L.salt;
        if (hash2(gx, gz, s) >= p) continue;
        const r = L.cell * (0.1 + 0.32 * hash2(gx, gz, s ^ 0x5a));
        const cx = (gx + 0.22 + 0.56 * hash2(gx, gz, s ^ 0x6b)) * L.cell;
        const cz = (gz + 0.22 + 0.56 * hash2(gx, gz, s ^ 0x7c)) * L.cell;
        const dx = x - cx, dz = z - cz;
        const t = Math.sqrt(dx * dx + dz * dz) / r;
        if (t > 2.6) continue;
        const d = Math.min(r * 0.2, 3 + r * 0.045, opt.maxDepth);
        const rim = d * 0.24 * opt.rim;
        let v;
        if (t < 1) {
          const floor = r > 160 ? 0.42 : 0;
          const bowl = (1 - t * t) / (1 - floor * floor);
          v = -d * Math.min(1, bowl);
          if (r > 420) v += d * 0.42 * Math.exp(-((t / 0.12) ** 2)); // the central peak
        } else v = rim * 0.55 * Math.exp(-(t - 1) * 2.3); // ejecta
        v += rim * Math.exp(-(((t - 1) / 0.16) ** 2));
        h += v;
        // young craters (the hash) throw out bright rays and fresh dust
        if (r > 60 && t < 2.2 && hash2(gx, gz, s ^ 0x13) < 0.12) fresh = Math.max(fresh, (1 - t / 2.2) * 0.8);
      }
    }
  }
  return [h, fresh];
}

// the launch pad's deck reaches this far from the world's middle; the ground is levelled further out
export const PAD_R = 7.5;
const PAD_CLEAR = 9.5;

class PlanetGenerator {
  constructor(seed, body) {
    this.seed = seed | 0;
    this.version = 1;
    this.body = body;
    this.base = BODIES[body].base;
    this.sea = -1000; // no seas
    this.col = {};
  }

  climate() { return [1.0, 0]; }
  tintClimate() { return [200, 30]; }
  caveEntrance() { return false; }
  precipitation() { return 'none'; }

  // the column as the game asks for it (spawning, weather...)
  column(x, z, out = this.col) {
    const s = this.surface(x, z);
    out.height = Math.floor(s.h);
    out.hf = s.h;
    out.biome = BIOME.DESERT;
    out.temp = 2;
    out.hum = -1;
    out.mountain = 0;
    out.river = 0;
    out.cont = 0;
    return out;
  }

  findSpawn() {
    const s = this.surface(0, 0);
    return [0.5, Math.floor(s.h) + 1, 0.5];
  }

  // On the sphere, for the shapes thousands of blocks across: the direction of (x, z).
  sphere(x, z) {
    const [lon, lat] = worldToLonLat(this.body, x, z);
    return { lon, lat, d: dirOf(lon, lat) };
  }

  // The launch pad flying saucers set down on, at the world's middle: its deck's height.
  padHeight() {
    if (this.padY === undefined) this.padY = Math.max(8, Math.min(H - 40, Math.floor(this.surface(0, 0).h)));
    return this.padY;
  }

  // The pad: a round deck of smooth stone with a yellow ring and a glowing middle, lights round its
  // edge and four lamp posts, on ground levelled out round it.
  pad(blocks, x0, z0) {
    const py = this.padHeight();
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const wx = x0 + x, wz = z0 + z;
        const d = Math.hypot(wx, wz);
        if (d > PAD_CLEAR) continue;
        const l = this.layers(this.surface(wx, wz), 0);
        for (let y = py + 1; y <= py + 16; y++) blocks[idx(x, y, z)] = 0;
        for (let y = py - 4; y < py; y++) if (!blocks[idx(x, y, z)]) blocks[idx(x, y, z)] = l.rock;
        let top = l[0];
        if (d <= 1.5) top = B.SEA_LANTERN;
        else if (d > 5.5 && d <= 6.5) top = B.YELLOW_WOOL;
        else if (d <= PAD_R) top = B.SMOOTH_STONE;
        const ax = Math.abs(wx), az = Math.abs(wz);
        if ((ax === 7 && az === 0) || (ax === 0 && az === 7) || (ax === 5 && az === 5)) top = B.SEA_LANTERN;
        blocks[idx(x, py, z)] = top;
        if (ax === 6 && az === 6) {
          for (let y = py + 1; y <= py + 3; y++) blocks[idx(x, y, z)] = B.IRON_BARS;
          blocks[idx(x, py + 4, z)] = B.SEA_LANTERN;
        }
      }
    }
  }

  generateChunk(cx, cz) {
    const blocks = new Uint8Array(CS * CS * H);
    const x0 = cx * CS, z0 = cz * CS;
    const R = CS + 2;
    const hs = new Float32Array(R * R);
    const cols = [];
    for (let dz = -1; dz <= CS; dz++) {
      for (let dx = -1; dx <= CS; dx++) {
        const s = this.surface(x0 + dx, z0 + dz);
        hs[(dz + 1) * R + dx + 1] = s.h;
        if (dx >= 0 && dz >= 0 && dx < CS && dz < CS) cols[dz * CS + dx] = s;
      }
    }
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const s = cols[z * CS + x];
        const h = Math.max(4, Math.min(H - 24, Math.floor(s.h)));
        const slope = Math.max(
          Math.abs(hs[(z + 1) * R + x] - hs[(z + 1) * R + x + 2]),
          Math.abs(hs[z * R + x + 1] - hs[(z + 2) * R + x + 1]),
        );
        const wx = x0 + x, wz = z0 + z;
        const layers = this.layers(s, slope, wx, wz);
        for (let y = 0; y <= h; y++) {
          let b;
          if (y <= 1 || (y < 4 && hash3(wx, y, wz, this.seed) < 0.5 - y * 0.12)) b = B.BEDROCK;
          else {
            const depth = h - y;
            b = depth < layers.length ? layers[depth] : layers.rock;
            if (b === layers.rock && depth > 6 && hash3(wx, y, wz, this.seed ^ 0x1e0) < this.oreChance(y)) b = B.IRON_ORE;
          }
          blocks[idx(x, y, z)] = b;
        }
      }
    }
    if (x0 <= PAD_CLEAR && x0 + CS > -PAD_CLEAR - 1 && z0 <= PAD_CLEAR && z0 + CS > -PAD_CLEAR - 1) this.pad(blocks, x0, z0);
    return blocks;
  }

  oreChance() { return 0.004; }

  mapTexel(x, z) {
    const s = this.surface(x, z);
    const c = this.colourOf(s);
    return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), Math.round(clamp01((s.h - this.base + 48) / 248) * 255)];
  }
}

// ---------------------------------------------------------------------------------- the Moon
const MOON_CRATERS = [
  { cell: 9000, p: 0.45, salt: 0x1101 },
  { cell: 2600, p: 0.55, salt: 0x1102 },
  { cell: 820, p: 0.6, salt: 0x1103 },
  { cell: 250, p: 0.62, salt: 0x1104 },
  { cell: 76, p: 0.45, salt: 0x1105 },
  { cell: 24, p: 0.28, salt: 0x1106 },
];
const REGOLITH = [124, 123, 120], HIGHLAND = [152, 151, 147], MARE = [78, 78, 82];

export class MoonGenerator extends PlanetGenerator {
  constructor(seed) {
    super(seed, 'moon');
    this.dimension = 4;
    const s = this.seed ^ 0x6d6f6f6e;
    this.nMaria = new Simplex(s ^ 0x11);
    this.nRough = new Simplex(s ^ 0x22);
  }

  // { h height, mare 0..1, fresh 0..1 }
  surface(x, z) {
    const { lon, lat, d } = this.sphere(x, z);
    // maria: wide dark plains, most of them on the side that faces the Earth (around lon 0)
    const n = this.nMaria.fbm3(d[0] * 2.1 + 7, d[1] * 2.1, d[2] * 2.1, 4) + 0.2 * Math.cos(lon) * Math.cos(lat) - 0.12;
    const mare = smooth(0.0, 0.16, n);
    const rough = this.nRough.fbm2(x / 520, z / 520, 4) * 9 * (1 - mare * 0.75) + this.nRough.noise2(x / 90, z / 90) * 0.8;
    const [cr, fresh] = craterField(this.seed, MOON_CRATERS, x, z, 1 - mare * 0.7, { dense: 250, maxDepth: 68, rim: 1 });
    return { h: this.base + 16 * (1 - mare) - 12 * mare + rough + cr, mare, fresh };
  }

  // the blocks from the top down
  layers(s, slope) {
    const rock = s.mare > 0.5 ? B.MOON_BASALT : B.MOON_ROCK;
    const l = slope > 3 ? [rock, rock] : [B.MOON_REGOLITH, B.MOON_REGOLITH, B.MOON_REGOLITH, slope < 1.2 ? B.MOON_REGOLITH : rock];
    l.rock = rock;
    return l;
  }

  colourOf(s) {
    let c = mix(mix(REGOLITH, HIGHLAND, 0.35), mix(REGOLITH, MARE, 0.75), s.mare);
    c = mix(c, [206, 204, 198], s.fresh * 0.55);
    return c;
  }

  oreChance(y) { return y < 60 ? 0.006 : 0.002; }
}

// ---------------------------------------------------------------------------------- Mars
const MARS_CRATERS = [
  { cell: 7000, p: 0.35, salt: 0x2201 },
  { cell: 2100, p: 0.45, salt: 0x2202 },
  { cell: 640, p: 0.5, salt: 0x2203 },
  { cell: 190, p: 0.5, salt: 0x2204 },
  { cell: 56, p: 0.4, salt: 0x2205 },
];
const DUST = [186, 100, 58], DARK = [112, 62, 44], RUST_ROCK = [138, 72, 50], ICE = [232, 234, 238];

export class MarsGenerator extends PlanetGenerator {
  constructor(seed) {
    super(seed, 'mars');
    this.dimension = 5;
    const s = this.seed ^ 0x6d617273;
    this.nBig = new Simplex(s ^ 0x31);
    this.nRough = new Simplex(s ^ 0x32);
    this.nCanyon = new Simplex(s ^ 0x33);
    this.nDune = new Simplex(s ^ 0x34);
    // a few great shield volcanoes, most of them on a rise north of the equator
    this.volcanoes = [];
    for (let i = 0; i < 4; i++) {
      const lon = -2.4 + i * 1.25 + (hash2(i, 1, s) - 0.5) * 0.8;
      const lat = -0.15 + hash2(i, 2, s) * 0.55;
      const R = BODIES.mars.R;
      this.volcanoes.push({ x: lon * R, z: -lat * R, r: 2400 + hash2(i, 3, s) * 3600, h: 120 + hash2(i, 4, s) * 110 });
    }
  }

  surface(x, z) {
    const { lat, d } = this.sphere(x, z);
    // the great divide: high cratered south, low smooth north
    const divide = this.nBig.fbm3(d[0] * 1.6, d[1] * 1.6 + 4, d[2] * 1.6, 3) * 0.35 - lat * 0.9;
    const south = smooth(-0.2, 0.25, divide);
    let h = this.base - 14 + south * 34;
    h += this.nRough.fbm2(x / 700, z / 700, 4) * 10 * (0.4 + 0.6 * south);
    // volcanoes: wide gentle shields with a caldera on top
    let volcano = 0;
    for (const v of this.volcanoes) {
      const dx = x - v.x, dz = z - v.z;
      const t = Math.sqrt(dx * dx + dz * dz) / v.r;
      if (t >= 1) continue;
      volcano = Math.max(volcano, 1 - t);
      h += v.h * Math.pow(1 - t, 1.6) - 26 * smooth(0.07, 0.035, t);
    }
    // the canyon along the equator, with side branches
    const band = smooth(0.2, 0.08, Math.abs(lat + 0.06));
    let canyon = 0;
    if (band > 0) {
      const n = 1 - Math.abs(this.nCanyon.fbm2(x / 5200, z / 1300, 3));
      canyon = smooth(0.86, 0.95, n) * band;
      h -= canyon * 78;
    }
    const [cr, fresh] = craterField(this.seed, MARS_CRATERS, x, z, 0.35 + 0.65 * south, { dense: 190, maxDepth: 55, rim: 0.6 });
    h += cr * (1 - canyon);
    // dunes in the low dusty ground
    const duneAmt = smooth(this.base, this.base - 20, h) * (1 - volcano);
    if (duneAmt > 0) h += (Math.sin(x * 0.07 + z * 0.025 + this.nDune.noise2(x / 90, z / 90) * 4) * 0.5 + 0.5) * 2.2 * duneAmt;
    // dark ground (basalt sand) in wide patches
    const dark = smooth(0.18, 0.4, this.nBig.fbm3(d[0] * 3.2 - 9, d[1] * 3.2, d[2] * 3.2, 3)) * (1 - volcano * 0.5);
    const ice = smooth(1.3, 1.36, Math.abs(lat) + (lat > 0 ? 0.04 : 0) + this.nRough.noise2(x / 3000, z / 3000) * 0.05);
    return { h, south, dark, ice, canyon, fresh };
  }

  layers(s, slope) {
    const rock = B.MARS_ROCK;
    let l;
    if (s.ice > 0.5) l = [B.SNOW, B.SNOW, B.ICE, rock];
    else if (slope > 3 || s.canyon > 0.6) l = [rock, rock];
    else if (s.dark > 0.55) l = [rock, B.MARS_SAND, B.MARS_SAND];
    else l = [B.MARS_SAND, B.MARS_SAND, B.MARS_SAND];
    l.rock = rock;
    return l;
  }

  colourOf(s) {
    let c = mix(DUST, DARK, s.dark * 0.8);
    c = mix(c, RUST_ROCK, s.canyon * 0.6);
    c = mix(c, [204, 128, 82], s.fresh * 0.3);
    return mix(c, ICE, s.ice);
  }
}

// ---------------------------------------------------------------------------------- space
export class SpaceGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    this.version = 1;
    this.dimension = 3;
  }
  climate() { return [0.5, 0.5]; }
  tintClimate() { return [128, 128]; }
  caveEntrance() { return false; }
  precipitation() { return 'none'; }
  column(x, z, out = {}) { Object.assign(out, { height: 0, hf: 0, biome: BIOME.PLAINS, temp: 0.5, hum: 0, mountain: 0, river: 0, cont: 0 }); return out; }
  generateChunk() { return new Uint8Array(CS * CS * H); }
  findSpawn() { return [0.5, 100, 0.5]; }
}

// ------------------------------------------------------------------ the stations
// High over the clouds of Jupiter and of Saturn (which have no ground) floats a station: a round
// deck with a rail, a glass dome over a little garden, a landing pad, lamps and an antenna, and
// underneath, the glowing engines that keep it up. Nothing else: below it the clouds (drawn by
// the renderer), and falling off the suit's thrusters bring you back.
export const STATION_Y = 120; // the deck
export const STATION_R = 22;
export const STATION_PAD = [0, 12]; // the landing pad's middle (x, z)
const DOME = [0, -7], DOME_R = 9;

export function stationBlock(x, y, z) {
  const dy = y - STATION_Y;
  const fx = x + 0.5, fz = z + 0.5;
  const r = Math.hypot(fx, fz);
  if (r >= STATION_R || dy < -12 || dy > 17) return 0;
  const ddx = fx - DOME[0], ddz = fz - DOME[1];
  const dd = Math.hypot(ddx, ddz, Math.max(0, dy));
  // under the deck: a cone of hull narrowing to the engine, lit round its rim
  if (dy < 0) {
    const k = -dy / 12;
    const rr = (STATION_R - 0.5) * (1 - k * k * 0.85);
    if (r >= rr) return 0;
    if (dy === -1) return B.IRON_BLOCK;
    if (r > rr - 1.6) {
      const ring = dy === -3 && Math.abs(r - (rr - 0.8)) < 0.9 && ((Math.floor(Math.atan2(fz, fx) / (Math.PI / 8)) & 1) === 0);
      return ring ? B.SEA_LANTERN : B.IRON_BLOCK;
    }
    if (dy === -12 || (dy <= -10 && r < 2.2)) return B.SEA_LANTERN; // the engine's glow
    return 0;
  }
  // the deck
  if (dy === 0) {
    if (r >= STATION_R - 1.5) return B.QUARTZ_BLOCK;
    if (Math.hypot(ddx, ddz) < DOME_R - 0.5) return B.GRASS;
    const px = fx - STATION_PAD[0], pz = fz - STATION_PAD[1];
    if (Math.abs(px) < 5.5 && Math.abs(pz) < 5.5) {
      // the pad: a yellow ring on grey, lights at its corners
      if (Math.abs(px) > 4.5 && Math.abs(pz) > 4.5) return B.SEA_LANTERN;
      const pr = Math.hypot(px, pz);
      return pr > 2.6 && pr < 3.6 ? B.YELLOW_WOOL : B.LIGHT_GRAY_WOOL;
    }
    return B.SMOOTH_STONE;
  }
  // the rail round the edge
  if (dy === 1 && r >= STATION_R - 1.5) return B.IRON_BARS;
  // the dome (a door towards the pad) and its garden
  if (Math.abs(dd - DOME_R) < 0.55 && dy >= 1) {
    if (Math.abs(ddx) < 1.5 && ddz > 0 && dy <= 3) return 0;
    return B.GLASS;
  }
  if (dd < DOME_R - 0.5 && dy >= 1) {
    // a cherry tree, and flowers in the grass
    const tx = ddx + 2.5, tz = ddz + 1.5;
    if (Math.abs(tx) < 0.5 && Math.abs(tz) < 0.5 && dy <= 4) return B.CHERRY_LOG;
    if (dy >= 4 && dy <= 6 && Math.hypot(tx, tz, (dy - 5) * 1.3) < 2.9) return B.CHERRY_LEAVES;
    if (dy === 1) {
      const h = hash2(x, z, 0x51a7);
      if (h < 0.08) return B.POPPY;
      if (h < 0.14) return B.DANDELION;
      if (h < 0.3) return B.TALL_GRASS;
    }
    return 0;
  }
  // lamp posts round the deck
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) * Math.PI / 4;
    const lx = Math.round(Math.cos(a) * 17.5 - 0.5), lz = Math.round(Math.sin(a) * 17.5 - 0.5);
    if (x === lx && z === lz && Math.hypot(lx + 0.5 - STATION_PAD[0], lz + 0.5 - STATION_PAD[1]) > 7) {
      if (dy <= 2) return B.IRON_BARS;
      if (dy === 3) return B.LANTERN;
    }
  }
  // the antenna, a light at its tip
  if (x === 13 && z === -12) {
    if (dy <= 13) return B.IRON_BLOCK;
    if (dy === 14) return B.END_ROD;
    if (dy === 15) return B.SEA_LANTERN;
  }
  return 0;
}

export class StationGenerator {
  constructor(seed, body) {
    this.seed = seed | 0;
    this.version = 1;
    this.body = body;
    this.dimension = BODIES[body].dim;
    this.sea = -1000;
  }
  climate() { return [0.6, 0.3]; }
  tintClimate() { return [140, 90]; }
  caveEntrance() { return false; }
  precipitation() { return 'none'; }
  column(x, z, out = {}) {
    const on = Math.hypot(x + 0.5, z + 0.5) < STATION_R;
    Object.assign(out, { height: on ? STATION_Y : 0, hf: on ? STATION_Y : 0, biome: BIOME.PLAINS, temp: 0.6, hum: 0.3, mountain: 0, river: 0, cont: 0 });
    return out;
  }
  findSpawn() { return [STATION_PAD[0] + 0.5, STATION_Y + 1, STATION_PAD[1] + 0.5]; }
  generateChunk(cx, cz) {
    const blocks = new Uint8Array(CS * CS * H);
    const x0 = cx * CS, z0 = cz * CS;
    if (x0 > STATION_R || x0 + CS < -STATION_R || z0 > STATION_R || z0 + CS < -STATION_R) return blocks;
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      for (let y = STATION_Y - 12; y <= STATION_Y + 17; y++) {
        const b = stationBlock(x0 + lx, y, z0 + lz);
        if (b) blocks[idx(lx, y, lz)] = b;
      }
    }
    return blocks;
  }
}
