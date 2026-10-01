// Maps of whole worlds as seen from space, made by the generators that make their blocks: the
// colour of the ground, its height (or the depth of the sea) and the lights of villages at night.
//
// A map is RGBA8: rgb the colour (sRGB, as the blocks look from far away), a the height of the
// ground: (height - sea + 48) / 248, so the sea's surface is at ELEV_SEA and below it is water.
// Lights are one byte a texel. Global maps are equirectangular (longitude across, north at the
// top); local maps cover a square of the world around a point, in blocks.

import { BIOME2 } from './biomes.js';
import { lonLatToWorld } from './space.js';

const BI = BIOME2;
export const ELEV_LOW = 48; // blocks below the sea at code 0
export const ELEV_RANGE = 248; // blocks across the codes
export const ELEV_SEA = ELEV_LOW / ELEV_RANGE; // the sea's surface, as a fraction

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const sc = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

// the shaders' grass and leaf tints (shaders/common.js TINTS)
function grassTint(t, h) {
  let c = mix([0.50, 0.70, 0.52], [0.50, 0.76, 0.33], smooth(0.15, 0.45, t));
  c = mix(c, [0.36, 0.72, 0.24], smooth(0.55, 0.8, h) * smooth(0.3, 0.6, t));
  c = mix(c, [0.78, 0.72, 0.36], smooth(0.62, 0.85, t) * (1 - smooth(0.4, 0.7, h)));
  c = mix(c, [0.40, 0.44, 0.22], smooth(0.9, 0.97, h));
  c = mix(c, [0.58, 0.52, 0.30], smooth(0.92, 0.98, t) * (1 - smooth(0.05, 0.12, h)));
  return c;
}
function foliageTint(t, h) {
  const c = grassTint(t, h);
  const g = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  return mul(mix([g, g, g], c, 0.82), [0.86, 0.9, 0.8]);
}

// the average colours of the blocks (sRGB 0..255, before any tint)
const GRASS = 152, LEAVES = 121;
const SAND = [213, 200, 155], RED_SAND = [185, 100, 41], SNOW = [236, 243, 248], STONE = [122, 122, 122];
const GRAVEL = [101, 94, 90], TERRACOTTA = [150, 86, 52], ICE = [206, 222, 236], DIRT = [120, 88, 62];
const CHERRY = [236, 166, 204], DARK_OAK = [62, 74, 46];

// The colour of the ground from far off (canopy, grass, sand...) for a generator's column.
// tt, hh: the column's tint climate (0..1), as the mesher's.
function landColour(col, sea) {
  let tt = Math.min(0.9, clamp01(col.temp * 0.5 + 0.5)), hh = Math.min(0.88, clamp01(col.hum * 0.5 + 0.5));
  const b = col.biome;
  switch (b) {
    case BI.SWAMP: tt = 0.6; hh = 1; break;
    case BI.BADLANDS: tt = 1; hh = 0; break;
    case BI.JUNGLE: tt = Math.max(tt, 0.72); hh = Math.max(hh, 0.8); break;
    case BI.SAVANNA: tt = Math.max(tt, 0.82); hh = Math.min(hh, 0.35); break;
    case BI.DESERT: tt = 0.9; hh = Math.min(hh, 0.2); break;
    case BI.DARK_FOREST: tt = Math.max(tt, 0.5); hh = Math.max(hh, 0.84); break;
    case BI.CHERRY: tt = 0.52; hh = 0.62; break;
    default: break;
  }
  const grass = sc(grassTint(tt, hh), GRASS);
  const leaves = sc(foliageTint(tt, hh), LEAVES * 0.85); // gaps in the canopy look darker
  const h = col.height;
  let c;
  switch (b) {
    case BI.BEACH: case BI.DESERT: c = SAND; break;
    case BI.BADLANDS: c = mix(TERRACOTTA, RED_SAND, smooth(sea + 14, sea + 2, h) * 0.7); break;
    case BI.PLAINS: c = mix(grass, leaves, 0.06); break;
    case BI.FOREST: c = mix(grass, leaves, 0.82); break;
    case BI.BIRCH_FOREST: c = mix(grass, sc([0.52, 0.68, 0.36], LEAVES * 0.9), 0.75); break;
    case BI.TAIGA: c = mix(grass, sc([0.40, 0.58, 0.40], LEAVES * 0.78), 0.72); break;
    case BI.SNOWY: c = mix(SNOW, sc([0.40, 0.58, 0.40], LEAVES * 0.7), 0.3); break;
    case BI.MOUNTAINS: c = mix(mix(grass, STONE, smooth(sea + 40, sea + 80, h)), GRAVEL, 0.15); break;
    case BI.JUNGLE: c = mix(grass, sc(foliageTint(tt, hh), LEAVES * 0.75), 0.95); break;
    case BI.SAVANNA: c = mix(grass, sc(foliageTint(tt, hh), LEAVES * 0.85), 0.12); break;
    case BI.SWAMP: c = mix(sc(grass, 0.8), [40, 58, 44], 0.35); break;
    case BI.CHERRY: c = mix(grass, CHERRY, 0.38); break;
    case BI.DARK_FOREST: c = mix(grass, DARK_OAK, 0.92); break;
    case BI.RIVER: c = SAND; break;
    default: c = grass;
  }
  // from far off, woods are darker than their leaves (the shade between the trees)
  const shade = { [BI.FOREST]: 0.72, [BI.BIRCH_FOREST]: 0.78, [BI.TAIGA]: 0.7, [BI.JUNGLE]: 0.66, [BI.DARK_FOREST]: 0.62, [BI.SWAMP]: 0.8, [BI.PLAINS]: 0.9, [BI.SAVANNA]: 0.9, [BI.CHERRY]: 0.85 }[b];
  if (shade) c = sc(c, shade);
  // snow on high ground (as the generator puts it above ~176)
  if (h > 168 && b !== BI.DESERT && b !== BI.BADLANDS) c = mix(c, SNOW, smooth(168, 184, h));
  else if (b === BI.MOUNTAINS && h > 150) c = mix(c, SNOW, 0.45);
  return c;
}

// The sea from above: shallows over sand, then deeper blues; ice where the generator freezes it.
function seaColour(col, sea) {
  const depth = sea + 1 - col.hf;
  if (col.biome === BI.SNOWY || col.temp < -0.5) return { c: ICE, ice: true };
  // (water looks dark from far off; only the shallowest shows the sand under it)
  const shallow = mix([62, 132, 140], [26, 74, 106], smooth(0.5, 5, depth));
  return { c: mix(shallow, [8, 26, 56], smooth(4, 30, depth)), ice: false };
}

function elevCode(hf, sea) {
  return Math.round(clamp01((hf - sea + ELEV_LOW) / ELEV_RANGE) * 255);
}

// A generator seen from far away: the noise that shapes its land keeps only its broad octaves
// (finer ones would only alias on a map hundreds of blocks a texel), and rivers too narrow to see
// are left out. Wraps the generator's own noise objects; returns a function that undoes it.
const COARSE = { nCont: 3, nEro: 3, nPeak: 3, nHill: 1, nDetail: 0, nTemp: 3, nHum: 3 };
export function coarsen(gen) {
  const undo = [];
  for (const [key, cap] of Object.entries(COARSE)) {
    const n = gen[key];
    if (!n || typeof n.fbm2 !== 'function') continue;
    const fbm2 = n.fbm2, ridged2 = n.ridged2;
    n.fbm2 = function (x, z, oct, lac = 2, gain = 0.5) {
      let sum = 0, amp = 1, norm = 0;
      for (let o = 0; o < oct; o++) {
        if (o < cap) sum += this.noise2(x, z) * amp;
        norm += amp; amp *= gain; x *= lac; z *= lac;
      }
      return sum / norm;
    };
    n.ridged2 = function (x, z, oct) { return ridged2.call(this, x, z, Math.min(oct, Math.max(1, cap))); };
    undo.push(() => { n.fbm2 = fbm2; n.ridged2 = ridged2; });
  }
  const river = gen.nRiver;
  if (river) {
    const f = river.fbm2;
    river.fbm2 = () => 1;
    undo.push(() => { river.fbm2 = f; });
  }
  return () => { for (const u of undo) u(); };
}

// One texel of the Earth: [r, g, b, a].
export function earthTexel(gen, x, z, sea, col) {
  gen.column(Math.round(x), Math.round(z), col);
  if (col.height < sea) {
    const s = seaColour(col, sea);
    // frozen sea counts as ground just at the sea's level
    return [...s.c.map(Math.round), s.ice ? elevCode(sea + 0.6, sea) : Math.min(elevCode(col.hf, sea), elevCode(sea - 0.6, sea))];
  }
  return [...landColour(col, sea).map(Math.round), Math.max(elevCode(col.hf, sea), elevCode(sea + 0.6, sea))];
}

// Villages: one may start in each region of the structure grid; where the ground suits one.
function villageAt(gen, rx, rz, sea, col) {
  const s = gen.structures;
  if (!s) return null;
  const st = s.start('village', rx, rz);
  gen.column(st.x, st.z, col);
  const b = col.biome;
  if (b !== BI.PLAINS && b !== BI.TAIGA && b !== BI.SNOWY && b !== BI.SAVANNA && b !== BI.DESERT) return null;
  if (col.height <= sea + 1 || col.height > sea + 60) return null;
  return [st.x, st.z];
}
const VILLAGE_SPAN = 26 * 16;
const VILLAGE_BIOMES = new Set([BI.PLAINS, BI.TAIGA, BI.SNOWY, BI.SAVANNA, BI.DESERT]);

// Lights a village makes at night: a soft dot (global maps) or a speckle of lit houses (local).
function stampLight(lights, w, h, fx, fy, radius, wrapX) {
  const r = Math.ceil(radius * 2);
  const ix = Math.floor(fx), iy = Math.floor(fy);
  for (let dy = -r; dy <= r; dy++) {
    const y = iy + dy;
    if (y < 0 || y >= h) continue;
    for (let dx = -r; dx <= r; dx++) {
      let x = ix + dx;
      if (wrapX) x = ((x % w) + w) % w;
      else if (x < 0 || x >= w) continue;
      const d = Math.hypot(x + 0.5 - fx, y + 0.5 - fy) / Math.max(radius, 0.5);
      if (d > 2) continue;
      const v = Math.round(255 * Math.exp(-d * d * 1.6) * (radius < 1 ? 0.55 + radius * 0.45 : 1));
      const i = y * w + x;
      if (v > lights[i]) lights[i] = v;
    }
  }
}

// A light [1 2 1] blur of an RGBA8 map (x wraps around).
function soften(rgba, w, h) {
  const src = rgba.slice();
  const at = (i, j, k) => src[(j * w + ((i + w) % w)) * 4 + k];
  for (let j = 0; j < h; j++) {
    const j0 = Math.max(0, j - 1), j1 = Math.min(h - 1, j + 1);
    for (let i = 0; i < w; i++) {
      for (let k = 0; k < 4; k++) {
        const v = 4 * at(i, j, k) + 2 * (at(i - 1, j, k) + at(i + 1, j, k) + at(i, j0, k) + at(i, j1, k)) +
          at(i - 1, j0, k) + at(i + 1, j0, k) + at(i - 1, j1, k) + at(i + 1, j1, k);
        rgba[(j * w + i) * 4 + k] = (v + 8) >> 4;
      }
    }
  }
}

// how bright a village's lights look from space: busier in some lands than others
function population(gen, x, z) {
  const n = gen.nMacro || gen.nTemp;
  const p = n.noise2(x * 0.000021 + 13.7, z * 0.000021 - 4.1) * 0.6 + n.noise2(x * 0.00009, z * 0.00009) * 0.4;
  return clamp01(0.35 + p * 0.9);
}

// The whole Earth: w x h equirectangular. Land within `fine` blocks of the world's middle (lakes
// and islands smaller than a texel) is sampled 2 x 2. onRow(fraction) reports progress.
export function buildEarthMap(gen, sea, w, h, onRow = null, fine = 66000) {
  const undo = coarsen(gen);
  const rgba = new Uint8Array(w * h * 4);
  const lights = new Uint8Array(w * h);
  const biomes = new Uint8Array(w * h), heights = new Int16Array(w * h);
  const col = {};
  const acc = [0, 0, 0, 0];
  const dLon = (2 * Math.PI) / w, dLat = Math.PI / h;
  for (let j = 0; j < h; j++) {
    const lat = Math.PI / 2 - ((j + 0.5) / h) * Math.PI;
    for (let i = 0; i < w; i++) {
      const lon = ((i + 0.5) / w) * 2 * Math.PI - Math.PI;
      const [x, z] = lonLatToWorld('earth', lon, lat);
      if (x * x + z * z < fine * fine) {
        acc[0] = acc[1] = acc[2] = acc[3] = 0;
        for (const [a, b] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
          const [sx, sz] = lonLatToWorld('earth', lon + a * dLon, lat + b * dLat);
          const t = earthTexel(gen, sx, sz, sea, col);
          for (let k = 0; k < 4; k++) acc[k] += t[k];
        }
        rgba.set(acc.map((v) => Math.round(v / 4)), (j * w + i) * 4);
      } else {
        rgba.set(earthTexel(gen, x, z, sea, col), (j * w + i) * 4);
      }
      biomes[j * w + i] = col.biome;
      heights[j * w + i] = col.height;
    }
    if (onRow && (j & 31) === 31) onRow(j / h);
  }
  undo();
  soften(rgba, w, h);
  if (gen.structures) {
    // every village region of the map (the world's x wraps around the planet)
    const [x0] = lonLatToWorld('earth', -Math.PI, 0);
    const [, zTop] = lonLatToWorld('earth', 0, Math.PI / 2);
    const [, zBot] = lonLatToWorld('earth', 0, -Math.PI / 2);
    const width = -2 * x0;
    // (the village's ground as the map has it: the texel it starts in)
    for (let rz = Math.floor(zTop / VILLAGE_SPAN); rz <= Math.ceil(zBot / VILLAGE_SPAN); rz++) {
      for (let rx = Math.floor(x0 / VILLAGE_SPAN); rx <= Math.ceil(-x0 / VILLAGE_SPAN); rx++) {
        const st = gen.structures.start('village', rx, rz);
        const fx = ((st.x - x0) / width) * w;
        const fy = ((st.z - zTop) / (zBot - zTop)) * h;
        const i = Math.floor(fx), j = Math.floor(fy);
        if (i < 0 || i >= w || j < 0 || j >= h) continue;
        if (!VILLAGE_BIOMES.has(biomes[j * w + i])) continue;
        const ht = heights[j * w + i];
        if (ht <= sea + 1 || ht > sea + 60) continue;
        stampLight(lights, w, h, fx, fy, 0.35 + 0.4 * population(gen, st.x, st.z), true);
      }
    }
  }
  return { rgba, lights, w, h };
}

// A square of the world around (cx, cz), `span` blocks across, n x n texels.
export function buildLocalMap(gen, sea, cx, cz, span, n, coarse = false) {
  const undo = coarse ? coarsen(gen) : null;
  const rgba = new Uint8Array(n * n * 4);
  const lights = new Uint8Array(n * n);
  const col = {};
  const step = span / n;
  const x0 = cx - span / 2, z0 = cz - span / 2;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const t = earthTexel(gen, x0 + (i + 0.5) * step, z0 + (j + 0.5) * step, sea, col);
      rgba.set(t, (j * n + i) * 4);
    }
  }
  if (undo) undo();
  if (gen.structures) {
    for (let rz = Math.floor(z0 / VILLAGE_SPAN) - 1; rz <= Math.ceil((z0 + span) / VILLAGE_SPAN); rz++) {
      for (let rx = Math.floor(x0 / VILLAGE_SPAN) - 1; rx <= Math.ceil((x0 + span) / VILLAGE_SPAN); rx++) {
        const v = villageAt(gen, rx, rz, sea, col);
        if (!v) continue;
        // a few lit houses around the well
        const s = gen.structures.start('village', rx, rz);
        let k = (s.cx * 73856093) ^ (s.cz * 19349663);
        for (let q = 0; q < 14; q++) {
          k = Math.imul(k ^ (k >>> 15), 2246822507) ^ q;
          const a = ((k >>> 8) & 1023) / 1023 * Math.PI * 2, r = (((k >>> 20) & 255) / 255) * 44;
          stampLight(lights, n, n, (v[0] + Math.cos(a) * r - x0) / step, (v[1] + Math.sin(a) * r - z0) / step, 0.55, false);
        }
        stampLight(lights, n, n, (v[0] - x0) / step, (v[1] - z0) / step, 1.0, false);
      }
    }
  }
  return { rgba, lights, n, span, cx, cz };
}

// The Moon and Mars: equirectangular maps from their generators' own texel colours.
export function buildBodyMap(gen, w, h, body) {
  const rgba = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    const lat = Math.PI / 2 - ((j + 0.5) / h) * Math.PI;
    for (let i = 0; i < w; i++) {
      const lon = ((i + 0.5) / w) * 2 * Math.PI - Math.PI;
      const [x, z] = lonLatToWorld(body, lon, lat);
      rgba.set(gen.mapTexel(x, z), (j * w + i) * 4);
    }
  }
  return { rgba, lights: null, w, h };
}

// A square of the Moon's or Mars's ground around (cx, cz), as buildLocalMap for the Earth.
export function buildBodyLocalMap(gen, cx, cz, span, n) {
  const rgba = new Uint8Array(n * n * 4);
  const step = span / n;
  const x0 = cx - span / 2, z0 = cz - span / 2;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) rgba.set(gen.mapTexel(x0 + (i + 0.5) * step, z0 + (j + 0.5) * step), (j * n + i) * 4);
  }
  return { rgba, lights: null, n, span, cx, cz };
}
