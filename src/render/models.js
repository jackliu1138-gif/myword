// Box models for creatures, in the blocky style of the terrain: parts are boxes measured in pixels
// (1/16 block) around a pivot, painted into one 64x64 skin layer per creature, and animated
// procedurally (walk cycles, head turns, zombie arms, creeper swelling, flapping wings).

import { BLOCKS, FACE_TEX, TINT, LAYER } from '../world/blocks.js';
import { hash2 } from '../world/noise.js';

const SKIN = 64;
const FACES = ['front', 'back', 'right', 'left', 'top', 'bottom'];

const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const jitter = (c, k, x, y, seed) => {
  const n = (hash2(x, y, seed) - 0.5) * k;
  return [c[0] * (1 + n), c[1] * (1 + n), c[2] * (1 + n)];
};

// ---------- painters: (part, face, u, v, w, h) -> [r, g, b] or null for transparent ----------
function eyes(u, v, w, h, color, row, x0, x1) {
  return v === row && (u === x0 || u === x1) ? color : null;
}

const SKINS = {
  zombie(part, face, u, v, w, h) {
    const skin = rgb(0x5a8a44), shirt = rgb(0x2a8c8c), pants = rgb(0x3a3d8e);
    if (part === 'head') {
      if (face === 'front') {
        if (v === 3 && (u === 1 || u === 2 || u === 5 || u === 6)) return u === 2 || u === 5 ? [18, 24, 16] : [34, 52, 30];
        if (v === 6 && u >= 2 && u <= 5) return [44, 64, 36];
      }
      if (face === 'top' || (v < 2 && face !== 'bottom')) return jitter(rgb(0x3c5c2c), 0.3, u, v + FACES.indexOf(face) * 9, 11);
      return jitter(skin, 0.18, u, v + FACES.indexOf(face) * 9, 3);
    }
    if (part === 'body') return jitter(v > 9 ? pants : shirt, 0.15, u, v, 5);
    if (part.endsWith('Arm')) return jitter(v < 4 ? shirt : skin, 0.16, u, v, 7);
    return jitter(v > 9 ? rgb(0x3a3a3a) : pants, 0.15, u, v, 9);
  },
  skeleton(part, face, u, v, w, h) {
    const bone = rgb(0xc8c6bc), dark = rgb(0x5a5850);
    if (part === 'head') {
      if (face === 'front') {
        if (v >= 3 && v <= 4 && (u === 1 || u === 2 || u === 5 || u === 6)) return [24, 22, 20];
        if (v === 6 && u >= 2 && u <= 5) return u % 2 ? [40, 38, 34] : bone;
      }
      return jitter(bone, 0.1, u, v + FACES.indexOf(face) * 9, 21);
    }
    if (part === 'body') {
      // ribs with gaps
      if (face === 'front' || face === 'back') return v % 3 === 2 ? null : (u === 3 || u === 4) ? bone : v < 10 ? jitter(bone, 0.1, u, v, 3) : null;
      return jitter(bone, 0.12, u, v, 4);
    }
    return jitter(v % 5 === 4 ? dark : bone, 0.1, u, v, 8);
  },
  creeper(part, face, u, v, w, h) {
    const g = [[91, 186, 78], [70, 150, 60], [120, 200, 100], [46, 110, 40], [150, 220, 130]];
    const mottled = (sx, sy) => {
      const n = hash2(sx, sy, 404);
      return g[n < 0.4 ? 0 : n < 0.62 ? 1 : n < 0.8 ? 2 : n < 0.92 ? 3 : 4];
    };
    if (part === 'head' && face === 'front') {
      const face8 = ['........', '........', '.##..##.', '.##..##.', '...##...', '..####..', '..####..', '..#..#..'];
      if (face8[v][u] === '#') return [16, 20, 16];
    }
    return mottled(u + FACES.indexOf(face) * 17 + part.length * 31, v);
  },
  spider(part, face, u, v, w, h) {
    const body = rgb(0x3a3230), hair = rgb(0x524640);
    if (part === 'head' && face === 'front') {
      if (v === 3 && (u === 1 || u === 6)) return [230, 30, 30];
      if (v === 2 && (u === 2 || u === 5)) return [200, 20, 20];
      if (v === 4 && (u === 3 || u === 4)) return [180, 20, 20];
    }
    return jitter(hash2(u, v, part.length + FACES.indexOf(face)) > 0.7 ? hair : body, 0.25, u, v, 13);
  },
  cow(part, face, u, v, w, h) {
    const black = rgb(0x2c2826), white = rgb(0xece8e0);
    if (part === 'horns') return rgb(0xd8d4c8);
    if (part === 'head') {
      if (face === 'front') {
        if (v >= 5 && u >= 2 && u <= 5) return v === 6 && (u === 2 || u === 5) ? [90, 60, 60] : jitter(rgb(0xc89a8c), 0.08, u, v, 1);
        if (v === 2 && (u === 1 || u === 6)) return [20, 20, 20];
        if (v === 2 && (u === 0 || u === 7)) return white;
      }
      return jitter(u < 4 && v < 5 ? white : black, 0.08, u, v, 2);
    }
    if (part === 'udder') return rgb(0xe8a8a0);
    const patch = hash2(Math.floor((u + FACES.indexOf(face) * 13) / 4), Math.floor(v / 4), 55) > 0.55;
    if (part.startsWith('leg')) return v > 9 ? rgb(0x3a3430) : patch ? white : black;
    return jitter(patch ? white : black, 0.07, u, v, 3);
  },
  pig(part, face, u, v, w, h) {
    const pink = rgb(0xeea6a0), dark = rgb(0xd88880);
    if (part === 'snout') return face === 'front' && v === 1 && (u === 0 || u === 3) ? [120, 60, 60] : dark;
    if (part === 'head' && face === 'front' && v === 2 && (u === 1 || u === 6)) return [30, 20, 20];
    if (part.startsWith('leg') && v > 4) return rgb(0xb07070);
    return jitter(pink, 0.08, u, v + part.length, 7);
  },
  sheep(part, face, u, v, w, h, variant) {
    const wool = variant || [236, 236, 232];
    const skin = rgb(0xd8c8b0);
    if (part === 'head') {
      if (face === 'front') {
        if (v === 3 && (u === 0 || u === 5)) return [30, 30, 30];
        if (v >= 4) return jitter(skin, 0.1, u, v, 3);
      }
      return v < 2 ? jitter(wool, 0.12, u, v, 4) : jitter(skin, 0.1, u, v, 5);
    }
    if (part === 'wool' || part === 'headWool') return jitter(wool, 0.16, u, v + FACES.indexOf(face) * 7, 6);
    if (part.startsWith('leg')) return v < 3 ? jitter(wool, 0.12, u, v, 8) : jitter(skin, 0.1, u, v, 9);
    return jitter(skin, 0.1, u, v, 10);
  },
  chicken(part, face, u, v, w, h) {
    if (part === 'beak') return rgb(0xf0b030);
    if (part === 'wattle') return rgb(0xd83020);
    if (part.startsWith('leg')) return rgb(0xe0a020);
    if (part === 'head' && face !== 'back' && face !== 'top' && face !== 'bottom' && v === 1 && (u === 0 || u === w - 1)) return [20, 20, 20];
    return jitter(rgb(0xf4f4f0), 0.06, u, v + part.length, 12);
  },
  arrow(part, face, u, v) {
    if (part === 'tip') return rgb(0x9a9aa0);
    if (part === 'fletch') return rgb(0xeeeeea);
    return jitter(rgb(0x8a6436), 0.1, u, v, 3);
  },
};

// ---------- model definitions: part = [name, pivot [x,y,z], box [x0,y0,z0,w,h,d], parent] ----------
const HUMANOID = (armW = 4) => [
  ['body', [0, 12, 0], [-4, 0, -2, 8, 12, 4]],
  ['head', [0, 24, 0], [-4, 0, -4, 8, 8, 8]],
  ['rightArm', [-(4 + armW / 2), 22, 0], [-armW / 2, -12, -armW / 2, armW, 12, armW]],
  ['leftArm', [4 + armW / 2, 22, 0], [-armW / 2, -12, -armW / 2, armW, 12, armW]],
  ['rightLeg', [-2, 12, 0], [-armW / 2, -12, -armW / 2, armW, 12, armW]],
  ['leftLeg', [2, 12, 0], [-armW / 2, -12, -armW / 2, armW, 12, armW]],
];

export const MODELS = {
  zombie: { parts: HUMANOID(4) },
  skeleton: { parts: HUMANOID(2) },
  creeper: {
    parts: [
      ['body', [0, 6, 0], [-4, 0, -2, 8, 12, 4]],
      ['head', [0, 18, 0], [-4, 0, -4, 8, 8, 8]],
      ['legFR', [-2, 6, -4], [-2, -6, -2, 4, 6, 4]],
      ['legFL', [2, 6, -4], [-2, -6, -2, 4, 6, 4]],
      ['legBR', [-2, 6, 4], [-2, -6, -2, 4, 6, 4]],
      ['legBL', [2, 6, 4], [-2, -6, -2, 4, 6, 4]],
    ],
  },
  spider: {
    parts: [
      ['body', [0, 9, 3], [-5, -4, 0, 10, 8, 12]],
      ['neck', [0, 9, 0], [-3, -3, -3, 6, 6, 6]],
      ['head', [0, 9, -3], [-4, -4, -8, 8, 8, 8]],
      ...[0, 1, 2, 3].flatMap((i) => [
        ['legR' + i, [-3, 9, -1 + i * 1.6], [-15, -1, -1, 15, 2, 2]],
        ['legL' + i, [3, 9, -1 + i * 1.6], [0, -1, -1, 15, 2, 2]],
      ]),
    ],
  },
  cow: {
    parts: [
      ['body', [0, 12, 0], [-6, 0, -9, 12, 10, 18]],
      ['head', [0, 18, -9], [-4, -4, -6, 8, 8, 6]],
      ['horns', [0, 18, -9], [-5, 3, -4, 10, 2, 1]],
      ['udder', [0, 12, 4], [-2, -1, 0, 4, 1, 5]],
      ['legFR', [-4, 12, -6], [-2, -12, -2, 4, 12, 4]],
      ['legFL', [4, 12, -6], [-2, -12, -2, 4, 12, 4]],
      ['legBR', [-4, 12, 7], [-2, -12, -2, 4, 12, 4]],
      ['legBL', [4, 12, 7], [-2, -12, -2, 4, 12, 4]],
    ],
  },
  pig: {
    parts: [
      ['body', [0, 6, 0], [-5, 0, -8, 10, 8, 16]],
      ['head', [0, 12, -8], [-4, -4, -8, 8, 8, 8]],
      ['snout', [0, 12, -16], [-2, -3, -1, 4, 3, 1]],
      ['legFR', [-3, 6, -5], [-2, -6, -2, 4, 6, 4]],
      ['legFL', [3, 6, -5], [-2, -6, -2, 4, 6, 4]],
      ['legBR', [-3, 6, 6], [-2, -6, -2, 4, 6, 4]],
      ['legBL', [3, 6, 6], [-2, -6, -2, 4, 6, 4]],
    ],
  },
  sheep: {
    parts: [
      ['body', [0, 12, 0], [-4, 0, -8, 8, 6, 16]],
      ['wool', [0, 12, 0], [-5.5, -1.5, -9.5, 11, 9, 19]],
      ['head', [0, 18, -8], [-3, -4, -7, 6, 6, 8]],
      ['headWool', [0, 18, -8], [-3.6, 0.5, -6.5, 7.2, 2.5, 6]],
      ['legFR', [-3, 12, -5], [-2, -12, -2, 4, 12, 4]],
      ['legFL', [3, 12, -5], [-2, -12, -2, 4, 12, 4]],
      ['legBR', [-3, 12, 6], [-2, -12, -2, 4, 12, 4]],
      ['legBL', [3, 12, 6], [-2, -12, -2, 4, 12, 4]],
    ],
  },
  chicken: {
    parts: [
      ['body', [0, 5, 0], [-3, 0, -4, 6, 6, 8]],
      ['head', [0, 9, -4], [-2, 0, -3, 4, 6, 3]],
      ['beak', [0, 9, -4], [-2, 2, -5, 4, 2, 2]],
      ['wattle', [0, 9, -4], [-1, 0, -4, 2, 2, 2]],
      ['wingR', [-3, 10, 0], [-1, -4, -3, 1, 4, 6]],
      ['wingL', [3, 10, 0], [0, -4, -3, 1, 4, 6]],
      ['legR', [-1.5, 5, 1], [-0.5, -5, -0.5, 1, 5, 1]],
      ['legL', [1.5, 5, 1], [-0.5, -5, -0.5, 1, 5, 1]],
    ],
  },
  arrow: {
    parts: [
      ['shaft', [0, 0, 0], [-0.5, -0.5, -7, 1, 1, 14]],
      ['tip', [0, 0, 0], [-1, -1, -9, 2, 2, 2]],
      ['fletch', [0, 0, 0], [-1.5, -1.5, 5, 3, 3, 2]],
    ],
  },
};

// ---------- skin atlas: every face of every part gets its own rect ----------
export function buildSkins(woolColors = {}) {
  const types = Object.keys(MODELS);
  const layers = [];
  const layerOf = {};
  for (const type of types) {
    const model = MODELS[type];
    const px = new Uint8Array(SKIN * SKIN * 4);
    let cx = 0, cy = 0, rowH = 0;
    model.rects = {};
    for (const [name, , box] of model.parts) {
      const [, , , w, h, d] = box;
      const dims = { front: [w, h], back: [w, h], right: [d, h], left: [d, h], top: [w, d], bottom: [w, d] };
      const r = {};
      for (const f of FACES) {
        const fw = Math.max(1, Math.ceil(dims[f][0])), fh = Math.max(1, Math.ceil(dims[f][1]));
        if (cx + fw > SKIN) { cx = 0; cy += rowH; rowH = 0; }
        r[f] = [cx, cy, fw, fh];
        for (let v = 0; v < fh; v++) {
          for (let u = 0; u < fw; u++) {
            const c = SKINS[type](name, f, u, v, fw, fh);
            const o = ((cy + v) * SKIN + cx + u) * 4;
            if (!c) continue;
            px[o] = Math.max(0, Math.min(255, c[0])); px[o + 1] = Math.max(0, Math.min(255, c[1])); px[o + 2] = Math.max(0, Math.min(255, c[2])); px[o + 3] = 255;
          }
        }
        cx += fw;
        rowH = Math.max(rowH, fh);
      }
      model.rects[name] = r;
    }
    layerOf[type] = layers.length;
    layers.push(px);
  }
  // coloured sheep: the same skin with the wool repainted
  for (const [key, color] of Object.entries(woolColors)) {
    const model = MODELS.sheep;
    const px = layers[layerOf.sheep].slice();
    for (const name of ['wool', 'headWool', 'legFR', 'legFL', 'legBR', 'legBL', 'head']) {
      for (const f of FACES) {
        const [cx, cy, fw, fh] = model.rects[name][f];
        for (let v = 0; v < fh; v++) for (let u = 0; u < fw; u++) {
          const c = SKINS.sheep(name, f, u, v, fw, fh, color);
          const o = ((cy + v) * SKIN + cx + u) * 4;
          px[o] = Math.max(0, Math.min(255, c[0])); px[o + 1] = Math.max(0, Math.min(255, c[1])); px[o + 2] = Math.max(0, Math.min(255, c[2]));
        }
      }
    }
    layerOf['sheep:' + key] = layers.length;
    layers.push(px);
  }
  return { size: SKIN, layers, layerOf };
}

// ---------- geometry ----------
// corners per face as [x, y, z] choosers (0 = min, 1 = max) in TL, TR, BR, BL order
const CORNERS = {
  front: [[1, 1, 0], [0, 1, 0], [0, 0, 0], [1, 0, 0]],
  back: [[0, 1, 1], [1, 1, 1], [1, 0, 1], [0, 0, 1]],
  right: [[1, 1, 1], [1, 1, 0], [1, 0, 0], [1, 0, 1]],
  left: [[0, 1, 0], [0, 1, 1], [0, 0, 1], [0, 0, 0]],
  top: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]],
  bottom: [[0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]],
};
const NORMALS = { front: [0, 0, -1], back: [0, 0, 1], right: [1, 0, 0], left: [-1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0] };
const QUAD = [0, 1, 2, 0, 2, 3];

// 3x4 affine matrices as arrays [m00 m01 m02 tx; m10 ...]
function mat(rx = 0, ry = 0, rz = 0, tx = 0, ty = 0, tz = 0, s = 1) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Ry * Rx * Rz
  const r00 = cy * cz + sy * sx * sz, r01 = -cy * sz + sy * sx * cz, r02 = sy * cx;
  const r10 = cx * sz, r11 = cx * cz, r12 = -sx;
  const r20 = -sy * cz + cy * sx * sz, r21 = sy * sz + cy * sx * cz, r22 = cy * cx;
  return [r00 * s, r01 * s, r02 * s, tx, r10 * s, r11 * s, r12 * s, ty, r20 * s, r21 * s, r22 * s, tz];
}
function mul(a, b) {
  const o = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
    o[r * 4 + 3] = a[r * 4] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3];
  }
  return o;
}
const apply = (m, x, y, z) => [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
const applyN = (m, x, y, z) => { const v = [m[0] * x + m[1] * y + m[2] * z, m[4] * x + m[5] * y + m[6] * z, m[8] * x + m[9] * y + m[10] * z]; const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// Part rotations for the current pose: returns { name: [rx, ry, rz] }
function pose(e, type, t) {
  const r = {};
  const walk = e.walkPhase || 0, amt = e.walkAmount || 0;
  const sw = Math.sin(walk * 2.2) * 0.9 * amt;
  const headYaw = Math.atan2(Math.sin((e.headYaw ?? e.yaw) - e.yaw), Math.cos((e.headYaw ?? e.yaw) - e.yaw));
  const headPitch = -(e.headPitch || 0);
  if (type === 'zombie' || type === 'skeleton') {
    r.head = [headPitch, headYaw, 0];
    r.rightLeg = [sw, 0, 0];
    r.leftLeg = [-sw, 0, 0];
    const idle = Math.sin(t * 1.3 + e.id) * 0.05;
    if (type === 'zombie') {
      const swing = e.swing > 0 ? Math.sin((e.swing / 0.4) * Math.PI) * 0.5 : 0;
      r.rightArm = [-Math.PI / 2 + idle - swing, 0, 0.05];
      r.leftArm = [-Math.PI / 2 - idle - swing, 0, -0.05];
    } else if (e.mode === 'chase') {
      // bow drawn: arms forward, turned inwards
      r.rightArm = [-Math.PI / 2 + headPitch, -0.1, 0];
      r.leftArm = [-Math.PI / 2 + headPitch, 0.4, 0];
    } else {
      r.rightArm = [-sw * 0.8 + idle, 0, 0.05];
      r.leftArm = [sw * 0.8 - idle, 0, -0.05];
    }
  } else if (type === 'creeper') {
    r.head = [headPitch * 0.5, headYaw, 0];
    r.legFR = r.legBL = [sw, 0, 0];
    r.legFL = r.legBR = [-sw, 0, 0];
  } else if (type === 'spider') {
    r.head = [headPitch * 0.5, headYaw * 0.6, 0];
    for (let i = 0; i < 4; i++) {
      const ph = walk * 3 + i * Math.PI / 2;
      const lift = Math.max(0, Math.sin(ph)) * 0.5 * amt;
      const spreadY = (i - 1.5) * 0.35 + Math.cos(ph) * 0.35 * amt;
      r['legR' + i] = [0, spreadY, -0.5 - lift];
      r['legL' + i] = [0, -spreadY, 0.5 + lift];
    }
  } else if (type === 'cow' || type === 'pig' || type === 'sheep') {
    r.legFR = r.legBL = [sw, 0, 0];
    r.legFL = r.legBR = [-sw, 0, 0];
    // grazing: head dips while standing still
    const graze = amt < 0.1 && e.mode === 'idle' ? Math.max(0, Math.sin(t * 0.7 + e.id * 1.7)) * 0.9 : 0;
    r.head = [headPitch + graze, headYaw, 0];
    r.horns = r.snout = r.headWool = r.head;
  } else if (type === 'chicken') {
    r.head = [headPitch, headYaw, 0];
    r.beak = r.wattle = r.head;
    r.legR = [sw * 1.2, 0, 0];
    r.legL = [-sw * 1.2, 0, 0];
    const flap = e.onGround === false ? Math.abs(Math.sin(t * 22)) * 1.1 : 0;
    r.wingR = [0, 0, -flap];
    r.wingL = [0, 0, flap];
  }
  return r;
}

// Writes the triangles of one creature into `out` starting at float offset o. Vertex layout:
// pos3 (camera relative), normal3, uv2, layer, sky, block, mode, tint rgba -> 16 floats.
export const ENTITY_FLOATS = 16;

export function emitModel(out, o, e, type, pos, yaw, cam, light, skins, t, tint, skinKey = type) {
  const model = MODELS[type];
  if (!model || !model.rects) return o;
  const layer = skins.layerOf[skinKey] ?? skins.layerOf[type];
  const rots = pose(e, type, t);
  let scale = 1 / 16;
  let root = mat(0, yaw, 0, pos[0] - cam[0], pos[1] - cam[1], pos[2] - cam[2]);
  if (e.deathTime > 0) {
    // topple over sideways
    const k = Math.min(1, e.deathTime / 0.45);
    root = mul(root, mat(0, 0, k * Math.PI / 2, 0, k * 0.2, 0));
  }
  let swell = 1;
  if (type === 'creeper' && e.fuse > 0) swell = 1 + (e.fuse / 1.5) * 0.25 + Math.sin(e.fuse * 40) * 0.02;
  const byName = {};
  for (const part of model.parts) {
    const [name, pivot, box] = part;
    const rot = rots[name] || [0, 0, 0];
    let m = mul(root, mat(rot[0], rot[1], rot[2], pivot[0] * scale * swell, pivot[1] * scale * swell, pivot[2] * scale * swell, scale * swell));
    byName[name] = m;
    const [x0, y0, z0, w, h, d] = box;
    const X = [x0, x0 + w], Y = [y0, y0 + h], Z = [z0, z0 + d];
    const rects = model.rects[name];
    for (const f of ['front', 'back', 'right', 'left', 'top', 'bottom']) {
      const [rx, ry, rw, rh] = rects[f];
      const nrm = applyN(m, ...NORMALS[f]);
      const corners = CORNERS[f];
      const uv = [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]];
      for (const qi of QUAD) {
        const c = corners[qi];
        const p = apply(m, X[c[0]], Y[c[1]], Z[c[2]]);
        out[o++] = p[0]; out[o++] = p[1]; out[o++] = p[2];
        out[o++] = nrm[0]; out[o++] = nrm[1]; out[o++] = nrm[2];
        out[o++] = uv[qi][0] / SKIN; out[o++] = uv[qi][1] / SKIN;
        out[o++] = layer; out[o++] = light[0]; out[o++] = light[1]; out[o++] = 0;
        out[o++] = tint[0]; out[o++] = tint[1]; out[o++] = tint[2]; out[o++] = tint[3];
      }
    }
  }
  return o;
}

export function modelVertexCount(type) {
  const m = MODELS[type];
  return m ? m.parts.length * 36 : 0;
}

// A small textured cube for dropped blocks (mode 1 = block texture array).
export function emitBlockCube(out, o, blockId, pos, spin, size, cam, light) {
  const tex = FACE_TEX;
  const layers = { top: tex[blockId * 4], bottom: tex[blockId * 4 + 1] };
  const side = tex[blockId * 4 + 2];
  const d = BLOCKS[blockId];
  const tinted = d && d.tint && d.tint !== TINT.WATER;
  const tint = tinted ? (d.tint === TINT.GRASS ? [0.5, 0.76, 0.33] : d.tint === TINT.SPRUCE ? [0.4, 0.58, 0.4] : [0.42, 0.7, 0.27]) : [1, 1, 1];
  const cutout = d && d.layer === LAYER.CUTOUT;
  // tint flags understood by the entity shader
  const flag = cutout ? (tinted ? -3 : -2) : tinted ? -1 : 0;
  const m = mat(0, spin, 0, pos[0] - cam[0], pos[1] - cam[1], pos[2] - cam[2], size);
  const X = [-0.5, 0.5];
  for (const f of ['front', 'back', 'right', 'left', 'top', 'bottom']) {
    const nrm = applyN(m, ...NORMALS[f]);
    const layer = layers[f] ?? side;
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const qi of QUAD) {
      const c = CORNERS[f][qi];
      const p = apply(m, X[c[0]], X[c[1]], X[c[2]]);
      out[o++] = p[0]; out[o++] = p[1]; out[o++] = p[2];
      out[o++] = nrm[0]; out[o++] = nrm[1]; out[o++] = nrm[2];
      out[o++] = uv[qi][0]; out[o++] = uv[qi][1];
      out[o++] = layer; out[o++] = light[0]; out[o++] = light[1]; out[o++] = 1;
      out[o++] = tint[0]; out[o++] = tint[1]; out[o++] = tint[2]; out[o++] = flag;
    }
  }
  return o;
}

// A flat, double-sided item sprite (mode 2 = item sprite array) standing upright and spinning.
export function emitSprite(out, o, layer, pos, spin, size, cam, light) {
  const m = mat(0, spin, 0, pos[0] - cam[0], pos[1] - cam[1], pos[2] - cam[2], size);
  const pts = [[-0.5, 1, 0], [0.5, 1, 0], [0.5, 0, 0], [-0.5, 0, 0]];
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const nrm = applyN(m, 0, 0, 1);
  for (const qi of QUAD) {
    const p = apply(m, ...pts[qi]);
    out[o++] = p[0]; out[o++] = p[1]; out[o++] = p[2];
    out[o++] = nrm[0]; out[o++] = nrm[1]; out[o++] = nrm[2];
    out[o++] = uv[qi][0]; out[o++] = uv[qi][1];
    out[o++] = layer; out[o++] = light[0]; out[o++] = light[1]; out[o++] = 2;
    out[o++] = 1; out[o++] = 1; out[o++] = 1; out[o++] = 0;
  }
  return o;
}

// An arrow in flight or stuck in a block, pointing along its direction.
export function emitArrow(out, o, pos, dir, cam, light, skins) {
  const yaw = Math.atan2(-dir[0], -dir[2]);
  const pitch = Math.atan2(dir[1], Math.hypot(dir[0], dir[2]));
  const e = { id: 0 };
  void e;
  const model = MODELS.arrow;
  const layer = skins.layerOf.arrow;
  const root = mul(mat(0, yaw, 0, pos[0] - cam[0], pos[1] - cam[1], pos[2] - cam[2]), mat(-pitch, 0, 0, 0, 0, 0, 1 / 16));
  for (const [name, , box] of model.parts) {
    const [x0, y0, z0, w, h, d] = box;
    const X = [x0, x0 + w], Y = [y0, y0 + h], Z = [z0, z0 + d];
    const rects = model.rects[name];
    for (const f of ['front', 'back', 'right', 'left', 'top', 'bottom']) {
      const [rx, ry, rw, rh] = rects[f];
      const nrm = applyN(root, ...NORMALS[f]);
      const uv = [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]];
      for (const qi of QUAD) {
        const c = CORNERS[f][qi];
        const p = apply(root, X[c[0]], Y[c[1]], Z[c[2]]);
        out[o++] = p[0]; out[o++] = p[1]; out[o++] = p[2];
        out[o++] = nrm[0]; out[o++] = nrm[1]; out[o++] = nrm[2];
        out[o++] = uv[qi][0] / SKIN; out[o++] = uv[qi][1] / SKIN;
        out[o++] = layer; out[o++] = light[0]; out[o++] = light[1]; out[o++] = 0;
        out[o++] = 1; out[o++] = 1; out[o++] = 1; out[o++] = 0;
      }
    }
  }
  return o;
}
