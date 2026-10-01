// Box models, skins and poses for the creatures that came with villages and the deeper survival
// game (villagers and illagers, golems, pets, fish, the wither...) and for things that are ridden
// (boats, minecarts, horses). Merged into models.js's tables; the same conventions: parts are
// [name, pivot, box [x0, y0, z0, w, h, d], (armour parent), (parent part)] in pixels, facing -Z.

import { hash2 } from '../world/noise.js';

const FACES = ['front', 'back', 'right', 'left', 'top', 'bottom'];
const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const jitter = (c, k, x, y, seed) => {
  const n = (hash2(x, y, seed) - 0.5) * k;
  return [c[0] * (1 + n), c[1] * (1 + n), c[2] * (1 + n)];
};
const fi = (face) => FACES.indexOf(face);

// ---------------------------------------------------------------- skins
// villager robes and trims by profession
export const VILLAGER_JOBS = {
  none: [0x6f4f3a, 0x5a3e2c], farmer: [0x8a6a3c, 0xc8a050], fisherman: [0x6a5a40, 0x3a7ab0], shepherd: [0x6a4a30, 0xe8e8e0],
  fletcher: [0x6a4a30, 0x5a8a3a], librarian: [0x6a4a30, 0xd0d0c8], cartographer: [0x6a4a30, 0xd8c070], cleric: [0x5a2a6a, 0xd8b040],
  armorer: [0x4a4a4e, 0x9a9aa0], weaponsmith: [0x3a3a3e, 0x8a2a2a], toolsmith: [0x4a4a4e, 0x6a5040], butcher: [0x6a4a30, 0xe8e0d8],
  leatherworker: [0x7a4a2a, 0x9a5a30], mason: [0x6a4a30, 0x707070], nitwit: [0x3a7a3a, 0x2a5a2a],
};
export const CAT_COLORS = { tabby: [0xb0885a, 0x6a4a2a], black: [0x1e1e22, 0x2e2e34], white: [0xf0f0ea, 0xd8d0c8], siamese: [0xe8dcc8, 0x5a4034], ginger: [0xe89040, 0xc06020] };
export const HORSE_COLORS = { white: [0xe8e4dc, 0xc8c4bc], creamy: [0xd8b078, 0xb89058], chestnut: [0xa8683a, 0x7a4a26], brown: [0x7a5030, 0x5a3820], black: [0x2a2622, 0x1a1614], gray: [0x8a8680, 0x6a6660], dark_brown: [0x4a3020, 0x3a2418] };
export const FISH_COLORS = { orange: [0xf07020, 0xfff8f0], blue: [0x3a70e0, 0xffe040], yellow: [0xf0d020, 0x3a3aa0], red: [0xe03a3a, 0xf0f0f0] };

function humanFace(u, v, skin, eyes = [255, 255, 255], pupil = [40, 110, 50]) {
  if (v === 4 && (u === 1 || u === 6)) return eyes;
  if (v === 4 && (u === 2 || u === 5)) return pupil;
  if (v === 3 && u >= 1 && u <= 6) return [skin[0] * 0.6, skin[1] * 0.5, skin[2] * 0.45];
  return null;
}

export const NEW_SKINS = {
  villager(part, face, u, v, w, h, variant = 'none') {
    const [robe, trim] = (VILLAGER_JOBS[variant] || VILLAGER_JOBS.none).map(rgb);
    const skin = rgb(0xbd8b72);
    if (part === 'head') {
      if (face === 'front') { const f = humanFace(u, v, skin); if (f) return f; }
      if (variant === 'farmer' && v < 2 && face !== 'bottom') return jitter(rgb(0xd8c070), 0.12, u, v, 3); // straw hat brim
      if (variant === 'librarian' && face === 'top') return trim;
      if (face === 'top' || (v < 2 && face !== 'front' && face !== 'bottom')) return jitter(rgb(0x5a3e2c), 0.15, u, v + fi(face) * 9, 2);
      return jitter(skin, 0.06, u, v + fi(face) * 9, 1);
    }
    if (part === 'nose') return jitter(rgb(0xa87460), 0.08, u, v, 4);
    if (part === 'robe') {
      if (face === 'front' && u >= w / 2 - 2 && u <= w / 2 + 1 && v > 2) return jitter(trim, 0.1, u, v, 5); // apron / sash
      if (v === 0 || v === h - 1) return jitter(trim, 0.1, u, v, 6);
      return jitter(robe, 0.14, u, v + fi(face) * 13, 7);
    }
    if (part === 'arms') return v === 0 || u === 0 ? skin : jitter(robe, 0.12, u, v, 8);
    return v > 9 ? rgb(0x3a2a20) : jitter(robe, 0.12, u, v + fi(face) * 5, 9);
  },
  witch(part, face, u, v, w, h) {
    const skin = rgb(0xbd8b72), robe = rgb(0x3a2a4a), hat = rgb(0x2a2a30);
    if (part.startsWith('hat')) return v === h - 1 && part === 'hat1' ? rgb(0x4a8a3a) : jitter(hat, 0.2, u, v + part.length, 11);
    if (part === 'head') {
      if (face === 'front') { const f = humanFace(u, v, skin, [240, 240, 240], [140, 30, 160]); if (f) return f; }
      return jitter(skin, 0.1, u, v + fi(face) * 9, 12);
    }
    if (part === 'nose') return v === h - 1 && u === 0 ? rgb(0x4a8a3a) : jitter(rgb(0xa87460), 0.08, u, v, 13);
    if (part === 'robe') return (u + v) % 7 === 0 ? rgb(0x4a8a3a) : jitter(robe, 0.2, u, v + fi(face) * 7, 14);
    if (part === 'arms') return jitter(robe, 0.14, u, v, 15);
    return jitter(robe, 0.14, u, v, 16);
  },
  // illagers: grey skin, a dark jacket (the variant is which one)
  illager(part, face, u, v, w, h, variant = 'pillager') {
    const skin = rgb(0x959b9b);
    const coat = rgb(variant === 'vindicator' ? 0x3a3a44 : variant === 'evoker' ? 0x1e1c1a : 0x5a3a2a);
    const trim = rgb(variant === 'vindicator' ? 0x275e61 : variant === 'evoker' ? 0xd0b040 : 0x2a4a3a);
    if (part === 'head') {
      if (face === 'front') {
        if (v === 3 && u >= 1 && u <= 6) return [40, 40, 44]; // the unibrow
        if (v === 4 && (u === 1 || u === 6)) return [230, 230, 230];
        if (v === 4 && (u === 2 || u === 5)) return [30, 90, 40];
      }
      if (face === 'top' || v < 2) return jitter(rgb(0x2a2a2e), 0.2, u, v + fi(face) * 9, 21);
      return jitter(skin, 0.06, u, v + fi(face) * 9, 22);
    }
    if (part === 'nose') return jitter(skin, 0.08, u, v, 23);
    if (part === 'body' || part === 'robe') return face === 'front' && (u === Math.floor(w / 2) || u === Math.floor(w / 2) - 1) ? trim : jitter(coat, 0.14, u, v + fi(face) * 13, 24);
    if (part.endsWith('Arm')) return v > 8 ? skin : jitter(coat, 0.12, u, v, 25);
    return v > 9 ? rgb(0x2a2420) : jitter(rgb(0x3a3a44), 0.12, u, v + fi(face) * 5, 26);
  },
  iron_golem(part, face, u, v, w, h) {
    const iron = rgb(0xd8ccc0), dark = rgb(0x9a8e84), vine = rgb(0x4a8a2a);
    if (part === 'head' && face === 'front') {
      if (v === 2 && (u === 1 || u === 2)) return [160, 40, 30];
      if (v >= 1 && v <= 2 && u >= 0 && u <= 3) return [120, 110, 100];
    }
    if (part === 'nose') return dark;
    if ((part === 'body' || part.endsWith('Arm')) && hash2(u + fi(face) * 11, v, part.length * 7) > 0.86) return vine;
    return jitter(hash2(u, v, fi(face) + part.length) > 0.8 ? dark : iron, 0.1, u, v, 31);
  },
  wolf(part, face, u, v, w, h, variant = 'wild') {
    const fur = rgb(0xd8d4d0), dark = rgb(0xa89e96);
    if (part === 'head' && face === 'front') {
      if (v === 1 && (u === 1 || u === 4)) return variant === 'angry' ? [200, 30, 30] : [30, 30, 30];
    }
    if (part === 'snout') return face === 'front' && v === 0 && u === 1 ? [30, 30, 30] : jitter(rgb(0xb8aca0), 0.1, u, v, 32);
    if (part === 'mane' && variant === 'tame' && (face === 'front' || v === h - 2)) return v >= h - 2 ? [200, 40, 40] : jitter(fur, 0.12, u, v, 33); // collar
    if (part === 'tail' && v > h - 3) return dark;
    return jitter(hash2(u, v, fi(face) + part.length) > 0.75 ? dark : fur, 0.1, u, v, 34);
  },
  cat(part, face, u, v, w, h, variant = 'tabby') {
    const [c1, c2] = (CAT_COLORS[variant] || CAT_COLORS.tabby).map(rgb);
    if (part === 'head' && face === 'front') {
      if (v === 1 && (u === 1 || u === 3)) return [60, 200, 60];
      if (v === 3 && u === 2) return [230, 140, 150];
    }
    if (part === 'nose') return variant === 'siamese' ? c2 : jitter(c1, 0.1, u, v, 41);
    const stripe = variant === 'tabby' || variant === 'ginger' ? (v + u * 0) % 3 === 0 : false;
    if (variant === 'siamese' && (part === 'tail' || part === 'tail2' || part.startsWith('leg') || part.startsWith('ear'))) return c2;
    return jitter(stripe ? c2 : c1, 0.1, u, v + fi(face) * 5, 42);
  },
  cod(part, face, u, v) {
    if (part === 'body' && face === 'right' && v === 1 && u === 1) return [20, 20, 20];
    if (part === 'body' && face === 'left' && v === 1 && u === 6) return [20, 20, 20];
    return jitter(v > 2 && part === 'body' ? rgb(0xe0d0a0) : rgb(0xb09060), 0.15, u, v + fi(face) * 5, 51);
  },
  salmon(part, face, u, v) {
    if (part === 'body' && (face === 'right' || face === 'left') && v === 1 && (u === 1 || u === 8)) return [20, 20, 20];
    return jitter(v > 2 && part === 'body' ? rgb(0xe89a80) : part === 'body' ? rgb(0xa02a24) : rgb(0x3a6a5a), 0.12, u, v + fi(face) * 5, 52);
  },
  tropical_fish(part, face, u, v, w, h, variant = 'orange') {
    const [a, b] = (FISH_COLORS[variant] || FISH_COLORS.orange).map(rgb);
    if (part === 'body' && (face === 'right' || face === 'left') && v === 1 && (u === 1 || u === w - 2)) return [20, 20, 20];
    return (u % 3 === 1 && part === 'body') ? b : jitter(a, 0.1, u, v, 53);
  },
  pufferfish(part, face, u, v, w, h) {
    if (part === 'body' && face === 'front' && v === 1 && (u === 0 || u === w - 1)) return [20, 20, 20];
    if (part.startsWith('spike')) return rgb(0xf0f0e0);
    return jitter(v > h / 2 ? rgb(0xf0e8c0) : rgb(0xe8c030), 0.1, u, v + fi(face) * 3, 54);
  },
  squid(part, face, u, v, w, h) {
    if (part === 'body' && face === 'front' && v === h - 4 && (u === 2 || u === w - 3)) return [230, 230, 230];
    return jitter(hash2(u, v, fi(face) + part.length) > 0.7 ? rgb(0x2a4a60) : rgb(0x3a6a8a), 0.12, u, v, 55);
  },
  slime(part, face, u, v, w, h) {
    if (part === 'eyeR' || part === 'eyeL' || part === 'mouth') return [20, 40, 20];
    if (part === 'inner') return jitter(rgb(0x5aa048), 0.1, u, v, 56);
    return (u === 0 || v === 0 || u === w - 1 || v === h - 1) ? rgb(0x70c060) : jitter(rgb(0x88d878), 0.05, u, v, 57);
  },
  phantom(part, face, u, v, w, h) {
    if (part === 'head' && face === 'front' && v === 1 && (u === 1 || u === w - 2)) return [120, 255, 40];
    if (part.startsWith('wing')) return (u + v) % 4 === 0 ? rgb(0x9a9a8a) : jitter(rgb(0x43518a), 0.15, u, v, 58);
    return jitter(rgb(0x3a4478), 0.15, u, v + fi(face) * 7, 59);
  },
  wither(part, face, u, v, w, h) {
    const bone = rgb(0x2a2a2e), lit = rgb(0x4a4a50);
    if (part.startsWith('head') && face === 'front') {
      if (v === Math.floor(h / 2) - 1 && (u === 1 || u === w - 2 || u === 2 || u === w - 3)) return [220, 220, 220];
      if (v === h - 2 && u > 1 && u < w - 2) return u % 2 ? [200, 200, 200] : [20, 20, 20];
    }
    return jitter(hash2(u, v, fi(face) + part.length) > 0.75 ? lit : bone, 0.2, u, v, 61);
  },
  wither_skeleton(part, face, u, v, w, h) {
    const bone = rgb(0x2e2e30), dark = rgb(0x121212);
    if (part === 'head' && face === 'front') {
      if (v >= 3 && v <= 4 && (u === 1 || u === 2 || u === 5 || u === 6)) return [8, 8, 8];
      if (v === 6 && u >= 2 && u <= 5) return u % 2 ? [60, 60, 60] : bone;
    }
    if (part === 'body' && (face === 'front' || face === 'back')) return v % 3 === 2 ? null : (u === 3 || u === 4) ? bone : v < 10 ? jitter(bone, 0.2, u, v, 3) : null;
    return jitter(v % 5 === 4 ? dark : bone, 0.2, u, v, 62);
  },
  guardian(part, face, u, v, w, h, variant = 'guardian') {
    const elder = variant === 'elder';
    const body = rgb(elder ? 0xcfc9b8 : 0x5a8a7a), fin = rgb(elder ? 0x9a8a9a : 0xe07a30);
    if (part === 'eye') return face === 'front' ? (u === 0 && v === 0 ? [255, 255, 255] : [240, 120, 40]) : [240, 240, 230];
    if (part.startsWith('spike')) return rgb(0xe8e0d0);
    if (part.startsWith('tail')) return jitter(fin, 0.15, u, v, 63);
    return jitter((u + v) % 5 === 0 ? fin : body, 0.12, u, v + fi(face) * 7, 64);
  },
  shulker(part, face, u, v, w, h) {
    const shell = rgb(0x946794), dark = rgb(0x6a4a6a);
    if (part === 'head') return face === 'front' && v === 2 && (u === 1 || u === 4) ? [30, 30, 30] : jitter(rgb(0xe8d8b0), 0.08, u, v, 65);
    return jitter((u === 0 || v === 0 || u === w - 1 || v === h - 1) ? dark : shell, 0.08, u, v + fi(face) * 7, 66);
  },
  cave_spider(part, face, u, v) {
    if (part === 'head' && face === 'front') {
      if (v === 3 && (u === 1 || u === 6)) return [230, 30, 30];
      if (v === 2 && (u === 2 || u === 5)) return [200, 20, 20];
    }
    return jitter(hash2(u, v, part.length + fi(face)) > 0.7 ? rgb(0x0e5a66) : rgb(0x0c323a), 0.2, u, v, 67);
  },
  horse(part, face, u, v, w, h, variant = 'brown') {
    const [coat, mane] = (HORSE_COLORS[variant] || HORSE_COLORS.brown).map(rgb);
    if (part === 'saddle') return v === 0 ? rgb(0x7a4a26) : rgb(0x5a3418);
    if (part === 'head' && (face === 'right' || face === 'left') && v === 1 && u === 2) return [20, 20, 20];
    if (part === 'mane' || part === 'tail') return jitter(variant === 'white' ? rgb(0xb0aca4) : rgb(0x2a1a12), 0.2, u, v, 71);
    if (part.startsWith('leg') && v > h - 3) return rgb(0x3a3430);
    return jitter(hash2(u, v, fi(face) + part.length) > 0.8 ? mane : coat, 0.08, u, v, 72);
  },
  boat(part, face, u, v, w, h) {
    const plank = rgb(0xb08850), dark = rgb(0x7a5a30);
    if (part.startsWith('oar')) return jitter(rgb(0x9a7440), 0.1, u, v, 73);
    return jitter(v % 4 === 0 ? dark : plank, 0.1, u + fi(face) * 17, v, 74);
  },
  minecart(part, face, u, v, w, h) {
    const iron = rgb(0x8a8a90), dark = rgb(0x5a5a60);
    return jitter(u === 0 || v === 0 || u === w - 1 || v === h - 1 ? dark : iron, 0.08, u, v + fi(face) * 5, 75);
  },
  tnt(part, face, u, v, w, h) {
    if (face === 'top' || face === 'bottom') return (u + v) % 3 === 0 ? [60, 60, 60] : [200, 60, 40];
    if (v >= 3 && v <= 4) {
      const tnt = ['........', '.TTT.N.N', '..T..NN.', '..T..N.N'];
      void tnt;
      return (u === 1 || u === 6) ? [30, 30, 30] : [236, 236, 230];
    }
    return u % 2 ? [200, 50, 36] : [176, 40, 28];
  },
  // worn and held gear drawn on players
  elytra(part, face, u, v, w, h) {
    const edge = u === 0 || u === w - 1 || v === h - 1;
    const vein = (u + Math.floor(v / 3)) % 4 === 0;
    return edge ? rgb(0x6a6a80) : vein ? rgb(0x9a9ab0) : jitter(rgb(0xc4c4d4), 0.08, u, v, 77);
  },
  shield(part, face, u, v, w, h) {
    if (face !== 'front' && face !== 'back') return rgb(0x8a8a90);
    if (u === 0 || v === 0 || u === w - 1 || v === h - 1) return rgb(0x9a9aa0);
    if (face === 'back') return jitter(rgb(0x8a6a40), 0.1, u, v, 78);
    return (Math.abs(u - w / 2 + 0.5) < 1.2 || Math.abs(v - h / 2 + 0.5) < 1.2) ? rgb(0x7a7a80) : jitter(rgb(0xa8804a), 0.1, u, v, 79);
  },
  evoker_fangs(part, face, u, v) {
    if (part !== 'base' && v === 0) return [240, 240, 230];
    return jitter(rgb(0x6a6a5a), 0.2, u, v, 76);
  },
};

// variant skins: layer 'type:variant'
export const SKIN_VARIANTS = {
  villager: Object.keys(VILLAGER_JOBS),
  illager: ['pillager', 'vindicator', 'evoker'],
  cat: Object.keys(CAT_COLORS),
  horse: Object.keys(HORSE_COLORS),
  tropical_fish: Object.keys(FISH_COLORS),
  wolf: ['wild', 'tame', 'angry'],
  guardian: ['guardian', 'elder'],
};

// ---------------------------------------------------------------- models
const HUMANOID = (armW = 4) => [
  ['body', [0, 12, 0], [-4, 0, -2, 8, 12, 4]],
  ['head', [0, 24, 0], [-4, 0, -4, 8, 8, 8]],
  ['rightArm', [-(4 + armW / 2), 22, 0], [-armW / 2, -12, -armW / 2, armW, 12, armW]],
  ['leftArm', [4 + armW / 2, 22, 0], [-armW / 2, -12, -armW / 2, armW, 12, armW]],
  ['rightLeg', [-2, 12, 0], [-armW / 2, -12, -armW / 2, armW, 12, armW]],
  ['leftLeg', [2, 12, 0], [-armW / 2, -12, -armW / 2, armW, 12, armW]],
];
const VILLAGER_PARTS = [
  ['robe', [0, 12, 0], [-4.2, -6, -3, 8.4, 18, 6]],
  ['head', [0, 24, 0], [-4, 0, -4, 8, 10, 8]],
  ['nose', [0, 0, 0], [-1, 1, -6, 2, 4, 2], null, 'head'],
  ['arms', [0, 21, -1], [-4, -6, -2, 8, 4, 4]], // (the folded forearms, angled up in front of the belly)
  ['rightLeg', [-2, 6, 0], [-2, -6, -2, 4, 6, 4]],
  ['leftLeg', [2, 6, 0], [-2, -6, -2, 4, 6, 4]],
];
const quad = (y, fz, bz, lw = 2, lh = 7) => [
  ['legFR', [-1.5, y, fz], [-lw / 2, -lh, -lw / 2, lw, lh, lw]], ['legFL', [1.5, y, fz], [-lw / 2, -lh, -lw / 2, lw, lh, lw]],
  ['legBR', [-1.5, y, bz], [-lw / 2, -lh, -lw / 2, lw, lh, lw]], ['legBL', [1.5, y, bz], [-lw / 2, -lh, -lw / 2, lw, lh, lw]],
];
const FISH = (len, tall, thick = 2) => [
  ['body', [0, 1, 0], [-thick / 2, 0, -len / 2, thick, tall, len]],
  ['tail', [0, 1 + tall / 2, len / 2], [-0.4, -tall / 2, 0, 0.8, tall, len * 0.45]],
  ['fin', [0, 1 + tall, -len * 0.1], [-0.3, 0, -1, 0.6, Math.max(1, tall * 0.35), len * 0.35]],
];

export const NEW_MODELS = {
  villager: { parts: VILLAGER_PARTS },
  witch: {
    parts: [
      ...VILLAGER_PARTS,
      ['hat1', [0, 9.5, 0], [-5, 0, -5, 10, 2, 10], null, 'head'],
      ['hat2', [0, 11.5, 0], [-3.5, 0, -3.5, 7, 4, 7], null, 'head'],
      ['hat3', [0, 15.5, 0.5], [-2, 0, -2, 4, 4, 4], null, 'head'],
    ],
  },
  pillager: { skin: 'illager', parts: [...HUMANOID(4), ['nose', [0, 0, 0], [-1, 1, -6, 2, 4, 2], null, 'head']] },
  vindicator: { skin: 'illager', parts: [...HUMANOID(4), ['nose', [0, 0, 0], [-1, 1, -6, 2, 4, 2], null, 'head']] },
  evoker: { skin: 'illager', parts: [...HUMANOID(4), ['robe', [0, 12, 0], [-4.4, -8, -2.4, 8.8, 20, 4.8]], ['nose', [0, 0, 0], [-1, 1, -6, 2, 4, 2], null, 'head']] },
  iron_golem: {
    texScale: 0.5,
    parts: [
      ['body', [0, 21, 0], [-9, 0, -6, 18, 12, 11]],
      ['waist', [0, 16, 0], [-4.5, 0, -3, 9, 5, 6]],
      ['head', [0, 33, -2], [-4, 0, -5, 8, 10, 8]],
      ['nose', [0, 0, 0], [-1, 2, -7, 2, 4, 2], null, 'head'],
      ['rightArm', [-11, 32, 0], [-2, -30, -3, 4, 30, 6]],
      ['leftArm', [11, 32, 0], [-2, -30, -3, 4, 30, 6]],
      ['rightLeg', [-4.5, 16, 0], [-3, -16, -2.5, 6, 16, 5]],
      ['leftLeg', [4.5, 16, 0], [-3, -16, -2.5, 6, 16, 5]],
    ],
  },
  wolf: {
    parts: [
      ['body', [0, 10, 2], [-3, -3, -3, 6, 6, 9]],
      ['mane', [0, 10, -2], [-4, -3.5, -3, 8, 7, 6]],
      ['head', [0, 10.5, -5], [-3, -3, -4, 6, 6, 4]],
      ['snout', [0, 0, 0], [-1.5, -3, -7, 3, 3, 3], null, 'head'],
      ['earR', [0, 0, 0], [-3, 3, -2, 2, 2, 1], null, 'head'],
      ['earL', [0, 0, 0], [1, 3, -2, 2, 2, 1], null, 'head'],
      ['tail', [0, 12, 10.5], [-1, -8, -1, 2, 8, 2]],
      ...quad(7, -2.5, 8.5),
    ],
  },
  cat: {
    parts: [
      ['body', [0, 7, 1], [-2, -2, -6, 4, 4, 12]],
      ['head', [0, 8.5, -5.5], [-2.5, -2, -4, 5, 4, 5]],
      ['nose', [0, 0, 0], [-1.5, -2, -5, 3, 2, 1], null, 'head'],
      ['earR', [0, 0, 0], [-2, 2, -1, 1, 1, 2], null, 'head'],
      ['earL', [0, 0, 0], [1, 2, -1, 1, 1, 2], null, 'head'],
      ['tail', [0, 8, 7], [-0.5, 0, 0, 1, 1, 7]],
      ['tail2', [0, 0.5, 7], [-0.5, -0.5, 0, 1, 1, 5], null, 'tail'],
      ...quad(5, -3.5, 5.5, 2, 5),
    ],
  },
  cod: { parts: FISH(8, 4) },
  salmon: { parts: FISH(12, 5) },
  tropical_fish: { parts: FISH(6, 5, 2) },
  pufferfish: {
    parts: [
      ['body', [0, 0, 0], [-1.5, 0, -1.5, 3, 3, 3]],
      ...[0, 1, 2, 3].map((i) => ['spike' + i, [0, 1.5, 0], [i < 2 ? (i ? 1.5 : -2) : -0.25, -0.25, i >= 2 ? (i === 2 ? 1.5 : -2) : -0.25, i < 2 ? 0.5 : 0.5, 0.5, 0.5]]),
      ['tail', [0, 1.5, 1.5], [-0.25, -1, 0, 0.5, 2, 1.5]],
    ],
  },
  squid: {
    texScale: 0.5,
    parts: [
      ['body', [0, 8, 0], [-6, 0, -6, 12, 16, 12]],
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ['tent' + i, [Math.round(Math.cos((i / 8) * Math.PI * 2) * 5), 8, Math.round(Math.sin((i / 8) * Math.PI * 2) * 5)], [-1, -16, -1, 2, 16, 2]]),
    ],
  },
  slime: {
    parts: [
      ['outer', [0, 0, 0], [-4, 0, -4, 8, 8, 8]],
      ['inner', [0, 0, 0], [-3, 1, -3, 6, 6, 6]],
      ['eyeR', [0, 0, 0], [-3.3, 4, -4.1, 2, 2, 1]],
      ['eyeL', [0, 0, 0], [1.3, 4, -4.1, 2, 2, 1]],
      ['mouth', [0, 0, 0], [0, 2, -4.1, 1, 1, 1]],
    ],
  },
  phantom: {
    parts: [
      ['body', [0, 3, 0], [-2.5, -1.5, -4.5, 5, 3, 9]],
      ['head', [0, 3, -4.5], [-3.5, -1.5, -5, 7, 3, 5]],
      ['wingR', [-2.5, 4, -2.5], [-6, -1, 0, 6, 2, 8]],
      ['wingR2', [-6, 0, 0], [-12, -0.5, 0, 12, 1, 8], null, 'wingR'],
      ['wingL', [2.5, 4, -2.5], [0, -1, 0, 6, 2, 8]],
      ['wingL2', [6, 0, 0], [0, -0.5, 0, 12, 1, 8], null, 'wingL'],
      ['tail', [0, 3, 4.5], [-1.5, -1, 0, 3, 2, 6]],
      ['tail2', [0, 0, 6], [-0.5, -0.5, 0, 1, 1, 6], null, 'tail'],
    ],
  },
  wither: {
    scale: 1.3,
    parts: [
      ['shoulders', [0, 32, 0], [-10, 0, -1.5, 20, 3, 3]],
      ['spine', [0, 32, 0], [-1.5, -12, -1, 3, 12, 3]],
      ['rib1', [0, 28, 0], [-4.5, 0, -1.5, 9, 1.5, 3]],
      ['rib2', [0, 25.5, 0], [-4.5, 0, -1.5, 9, 1.5, 3]],
      ['rib3', [0, 23, 0], [-4, 0, -1.5, 8, 1.5, 3]],
      ['tail', [0, 20, 0.5], [-1.5, -12, -1.5, 3, 12, 3]],
      ['head', [0, 35, 0], [-4, 0, -4, 8, 8, 8]],
      ['headR', [-9, 32, 0], [-3, 0, -3, 6, 6, 6]],
      ['headL', [9, 32, 0], [-3, 0, -3, 6, 6, 6]],
    ],
  },
  wither_skeleton: { scale: 1.2, parts: HUMANOID(2) },
  guardian: {
    parts: [
      ['body', [0, 8, 0], [-6, -6, -8, 12, 12, 16]],
      ['eye', [0, 8, -8], [-1, -1, -0.6, 2, 2, 1]],
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const a = (i / 8) * Math.PI * 2;
        return ['spike' + i, [Math.round(Math.cos(a) * 6.5), 8 + Math.round(Math.sin(a) * 6.5), (i % 2) * 6 - 3], [-0.5, -0.5, -0.5, 1, 1, 1]];
      }),
      ['tail', [0, 8, 8], [-2, -2, 0, 4, 4, 7]],
      ['tail2', [0, 0, 7], [-1.5, -1.5, 0, 3, 3, 6], null, 'tail'],
      ['tail3', [0, 0, 6], [-1, -1, 0, 2, 2, 5], null, 'tail2'],
    ],
  },
  shulker: {
    texScale: 0.5,
    parts: [
      ['base', [0, 0, 0], [-8, 0, -8, 16, 8, 16]],
      ['lid', [0, 8, 8], [-8, 0, -16, 16, 8, 16]],
      ['head', [0, 7, 0], [-3, 0, -3, 6, 6, 6]],
    ],
  },
  cave_spider: { scale: 0.7, model: 'spider' },
  horse: {
    texScale: 0.5,
    parts: [
      ['body', [0, 16, 0], [-5, -5, -11, 10, 10, 22]],
      ['neck', [0, 19, -10], [-2.5, 0, -3, 5, 11, 6]],
      ['mane', [0, 0, 0], [-1, 1, 3, 2, 10, 2], null, 'neck'],
      ['head', [0, 10, 0], [-3, -1, -10, 6, 5, 11], null, 'neck'],
      ['earR', [0, 0, 0], [-2.5, 4, -1, 1.5, 3, 1], null, 'head'],
      ['earL', [0, 0, 0], [1, 4, -1, 1.5, 3, 1], null, 'head'],
      ['tail', [0, 20, 11], [-1.5, -13, 0, 3, 13, 3]],
      ['saddle', [0, 16, 0], [-5.4, 4.8, -5, 10.8, 1.5, 9]],
      ['legFR', [-3.5, 11, -8], [-1.5, -11, -1.5, 3, 11, 3]], ['legFL', [3.5, 11, -8], [-1.5, -11, -1.5, 3, 11, 3]],
      ['legBR', [-3.5, 11, 8.5], [-1.5, -11, -1.5, 3, 11, 3]], ['legBL', [3.5, 11, 8.5], [-1.5, -11, -1.5, 3, 11, 3]],
    ],
  },
  boat: {
    texScale: 0.5,
    parts: [
      ['floor', [0, 1, 0], [-7, 0, -13, 14, 2, 26]],
      ['sideR', [0, 1, 0], [-8, 0, -13, 2, 7, 26]],
      ['sideL', [0, 1, 0], [6, 0, -13, 2, 7, 26]],
      ['front', [0, 1, 0], [-6, 0, -15, 12, 7, 2]],
      ['back', [0, 1, 0], [-6, 0, 13, 12, 7, 2]],
      ['oarR', [-8, 7, -1], [-12, -0.5, -0.5, 12, 1, 1]],
      ['oarL', [8, 7, -1], [0, -0.5, -0.5, 12, 1, 1]],
    ],
  },
  minecart: {
    texScale: 0.5,
    parts: [
      ['bottom', [0, 2, 0], [-8, 0, -10, 16, 2, 20]],
      ['sideR', [0, 2, 0], [-8, 2, -10, 2, 8, 20]],
      ['sideL', [0, 2, 0], [6, 2, -10, 2, 8, 20]],
      ['front', [0, 2, 0], [-6, 2, -10, 12, 8, 2]],
      ['back', [0, 2, 0], [-6, 2, 8, 12, 8, 2]],
    ],
  },
  tnt: { texScale: 0.5, parts: [['block', [0, 0, 0], [-8, 0, -8, 16, 16, 16]]] },
  elytra: { parts: [['wingR', [-1, 11, 2], [-10, -20, 0, 10, 20, 1.5]], ['wingL', [1, 11, 2], [0, -20, 0, 10, 20, 1.5]]] },
  shield: { parts: [['plate', [0, 0, 0], [-5, -6, -0.75, 10, 12, 1.5]]] },
  evoker_fangs: {
    parts: [
      ['base', [0, 0, 0], [-2.5, 0, -2.5, 5, 2, 5]],
      ['jawR', [-1, 2, 0], [-3, 0, -2, 3, 11, 4]],
      ['jawL', [1, 2, 0], [0, 0, -2, 3, 11, 4]],
    ],
  },
};

// ---------------------------------------------------------------- poses
// r: the rotations being built; k: { sw (walk swing), walk, amt, headYaw, headPitch }
export function newPose(r, e, type, t, k) {
  const { sw, walk, amt, headYaw, headPitch } = k;
  const hide = new Set();
  switch (type) {
    case 'villager': case 'witch': {
      r.head = [headPitch, headYaw, 0]; // (the nose turns with it: it hangs off the head)
      // speaking: the head bobs a little with the words (talkUntil: performance.now() seconds)
      if (e.talkUntil && t < e.talkUntil) r.head[0] += Math.sin(t * 11 + e.id) * 0.07 + 0.03;
      // arms folded in front, the hands raised a little (a potion up to the mouth, drinking)
      r.arms = [0.75 + Math.sin(t * 1.1 + e.id) * 0.03, 0, 0];
      r.rightLeg = [sw, 0, 0];
      r.leftLeg = [-sw, 0, 0];
      if (type === 'witch' && e.mode === 'drink') r.arms = [1.35, 0, 0];
      break;
    }
    case 'pillager': case 'vindicator': case 'evoker': {
      r.head = [headPitch, headYaw, 0];
      r.rightLeg = [sw, 0, 0];
      r.leftLeg = [-sw, 0, 0];
      const chase = e.mode === 'chase';
      if (type === 'pillager' && chase) {
        r.rightArm = [Math.PI / 2 + headPitch, -0.3, 0];
        r.leftArm = [Math.PI / 2 + headPitch, 0.5, 0];
      } else if (type === 'vindicator' && chase) {
        const s = e.swing > 0 ? Math.sin((e.swing / 0.4) * Math.PI) * 1.4 : 0;
        r.rightArm = [2.6 - s * 1.6, 0, 0.1];
        r.leftArm = [-sw * 0.8, 0, -0.05];
      } else if (type === 'evoker' && e.casting > 0) {
        r.rightArm = [Math.PI, 0, 0.6 + Math.sin(t * 12) * 0.2];
        r.leftArm = [Math.PI, 0, -0.6 - Math.sin(t * 12) * 0.2];
      } else {
        r.rightArm = [-sw * 0.8, 0, 0.05];
        r.leftArm = [sw * 0.8, 0, -0.05];
      }
      break;
    }
    case 'iron_golem': {
      r.head = [headPitch * 0.6, headYaw, 0];
      r.rightLeg = [sw * 0.6, 0, 0];
      r.leftLeg = [-sw * 0.6, 0, 0];
      const s = e.swing > 0 ? Math.sin((e.swing / 0.4) * Math.PI) * 1.8 : 0;
      r.rightArm = [-sw * 0.5 + s, 0, 0];
      r.leftArm = [sw * 0.5 + s, 0, 0];
      break;
    }
    case 'wolf': case 'cat': {
      const sit = e.flags & 256;
      const tamed = e.flags & 128;
      r.head = [headPitch, headYaw, 0]; // (snout, nose and ears hang off the head)
      // the wolf's tail hangs down behind a wild one, sticks out behind a tame one (lower as it
      // gets hurt) and stands straight out when it is angry
      const hp = Math.min(1, (e.health || 20) / (tamed ? 20 : e.def ? e.def.health : 8));
      const wolfTail = e.mode === 'chase' || e.flags & 512 ? -1.54 : tamed ? -(1.0 + 0.73 * hp) : -0.63;
      if (sit && type === 'wolf') {
        // sitting: the chest up, the rear on the ground, hind legs folded under, tail behind
        r.body = [0.8, 0, 0, 0, -3, -1.5];
        r.mane = [0.3, 0, 0, 0, -0.5, -0.5];
        r.legFR = r.legFL = [0.35, 0, 0, 0, -0.5, 0];
        r.legBR = r.legBL = [Math.PI / 2, 0, 0, 0, -5.5, -5];
        r.tail = [-1.45, Math.sin(t * (tamed ? 10 : 3)) * (tamed ? 0.35 : 0.1), 0, 0, -8.5, -4.5];
      } else if (sit) {
        r.body = [0.5, 0, 0, 0, -2, 0.5];
        r.head = [headPitch, headYaw, 0, 0, 2, 1.5];
        r.legFR = r.legFL = [0.1, 0, 0];
        r.legBR = r.legBL = [Math.PI / 2, 0, 0, 0, -3.8, -2];
        r.tail = [0.05, Math.sin(t * 1.5 + e.id) * 0.25, 0, 0, -6.5, -1];
        r.tail2 = [-0.3, 0, 0];
      } else {
        r.legFR = r.legBL = [sw, 0, 0];
        r.legFL = r.legBR = [-sw, 0, 0];
        const wag = type === 'wolf' ? Math.sin(t * (tamed ? 14 : 4)) * (tamed ? 0.5 : 0.15) : Math.sin(t * 2 + e.id) * 0.3;
        // (a cat's tail goes down and back, its tip curling up)
        r.tail = type === 'wolf' ? [wolfTail, wag, 0] : [0.6, wag, 0];
        if (type === 'cat') r.tail2 = [-0.9, 0, 0];
      }
      break;
    }
    case 'cod': case 'salmon': case 'tropical_fish': {
      const flop = e.inWater === false ? 1 : 0;
      r.tail = [0, Math.sin(t * (flop ? 14 : 7) + e.id) * 0.5, 0];
      if (flop) r.body = r.fin = [0, 0, Math.PI / 2];
      break;
    }
    case 'pufferfish':
      r.tail = [0, Math.sin(t * 8) * 0.4, 0];
      break;
    case 'squid':
      // the tentacles open out from under the body and close again as it swims
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const open = 0.35 + Math.sin(t * 2 + e.id) * 0.3;
        r['tent' + i] = [-Math.sin(a) * open, 0, Math.cos(a) * open];
      }
      break;
    case 'slime': {
      const squash = e.onGround === false ? 0.08 : 0;
      r.outer = r.inner = r.eyeR = r.eyeL = r.mouth = [squash, 0, 0];
      break;
    }
    case 'phantom': {
      const flap = Math.sin(t * 5 + e.id);
      r.wingR = [0, 0, 0.1 + flap * 0.4];
      r.wingR2 = [0, 0, flap * 0.3];
      r.wingL = [0, 0, -0.1 - flap * 0.4];
      r.wingL2 = [0, 0, -flap * 0.3];
      r.tail = [Math.sin(t * 3) * 0.12, 0, 0];
      r.body = r.head = [headPitch * 0.5, 0, 0];
      break;
    }
    case 'wither': {
      r.head = [headPitch, headYaw, 0];
      r.headR = [headPitch, headYaw + Math.sin(t * 0.7) * 0.3, 0];
      r.headL = [headPitch, headYaw - Math.sin(t * 0.9) * 0.3, 0];
      // the spine leans back a little, the tail below it curls away behind
      r.tail = [-(0.35 + Math.sin(t * 1.5) * 0.1), 0, 0];
      r.spine = [-0.15, 0, 0];
      break;
    }
    case 'wither_skeleton': {
      r.head = [headPitch, headYaw, 0];
      r.rightLeg = [sw, 0, 0];
      r.leftLeg = [-sw, 0, 0];
      const s = e.swing > 0 ? Math.sin((e.swing / 0.4) * Math.PI) * 1.2 : 0;
      r.rightArm = [-sw * 0.8 + (e.mode === 'chase' ? 0.4 : 0) + s, 0, 0.05];
      r.leftArm = [sw * 0.8, 0, -0.05];
      break;
    }
    case 'guardian': {
      r.eye = [headPitch * 0.5, headYaw * 0.5, 0];
      r.tail = [0, Math.sin(t * 3 + e.id) * 0.3, 0];
      r.tail2 = [0, Math.sin(t * 3 + e.id + 0.8) * 0.35, 0];
      r.tail3 = [0, Math.sin(t * 3 + e.id + 1.6) * 0.4, 0];
      break;
    }
    case 'shulker': {
      const open = e.flags & 64 ? 0.55 + Math.sin(t * 3) * 0.05 : 0;
      r.lid = [open, 0, 0];
      if (!open) hide.add('head');
      r.head = [headPitch, headYaw, 0];
      break;
    }
    case 'horse': {
      r.legFR = r.legBL = [sw * 0.8, 0, 0];
      r.legFL = r.legBR = [-sw * 0.8, 0, 0];
      const graze = amt < 0.1 && e.mode === 'idle' && !(e.flags & 1024) ? Math.max(0, Math.sin(t * 0.5 + e.id * 1.7)) * 1.1 : 0;
      r.neck = [-0.5 - graze * 0.9 + headPitch * 0.3, headYaw * 0.6, 0];
      r.head = [0.5 + graze * 0.4, 0, 0];
      r.mane = [0, 0, 0];
      // (the tail hangs down behind, and streams out further at a run)
      r.tail = [-(0.45 + Math.sin(t * 1.3 + e.id) * 0.08 + amt * 0.3), Math.sin(t * 0.9) * 0.1, 0];
      if (!(e.flags & 64)) hide.add('saddle');
      break;
    }
    case 'boat': {
      const row = e.rowPhase || 0;
      // the oars sweep back and forth: blades deep in the water as they pull back, lifted as they
      // swing forwards again
      r.oarR = [0, Math.sin(row) * 0.5, 0.3 + Math.cos(row) * 0.25];
      r.oarL = [0, -Math.sin(row) * 0.5, -(0.3 + Math.cos(row) * 0.25)];
      break;
    }
    case 'evoker_fangs': {
      const bite = Math.max(0, Math.min(1, (e.age - 0.35) / 0.25));
      const open = bite < 1 ? 0.9 * Math.sin(bite * Math.PI) : 0;
      r.jawR = [0, 0, -open];
      r.jawL = [0, 0, open];
      break;
    }
    default: break;
  }
  if (hide.size) r.__hide = hide;
  return r;
}
