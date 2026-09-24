// Draws the app icons (an isometric grass block at golden hour) and writes them as PNG files.
//   node tools/make-icons.mjs      -> icons/icon-180.png, icon-192.png, icon-512.png, icon-maskable-512.png
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// small deterministic hash for the pixel textures
function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

// 16x16 textures
function grassTop(u, v) {
  const n = hash(u, v, 1);
  const g = [0.36 + n * 0.14, 0.62 + n * 0.16, 0.22 + n * 0.08];
  return g;
}
function grassSide(u, v) {
  const n = hash(u, v, 2);
  const edge = 3 + Math.floor(hash(u, 0, 3) * 3);
  if (v < edge) return grassTop(u, v);
  const d = [0.47 + n * 0.12, 0.32 + n * 0.08, 0.2 + n * 0.06];
  if (hash(u, v, 4) > 0.86) return [d[0] * 0.8, d[1] * 0.8, d[2] * 0.8];
  return d;
}

function draw(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const S = size;
  const radius = maskable ? 0 : S * 0.22;
  // cube geometry in icon space
  const scale = maskable ? 0.25 : 0.3;
  const cx = S / 2, cy = S * 0.53;
  const a = S * scale; // half width of the cube's top diamond
  const hgt = a * 1.12; // side height
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      // rounded-square mask (not for maskable icons: the platform crops those)
      let alpha = 1;
      if (radius > 0) {
        const qx = Math.max(Math.abs(x + 0.5 - S / 2) - (S / 2 - radius), 0);
        const qy = Math.max(Math.abs(y + 0.5 - S / 2) - (S / 2 - radius), 0);
        alpha = clamp(radius - Math.hypot(qx, qy) + 0.5);
      }
      // golden-hour sky
      const ty = y / S;
      let col = [mix(0.99, 0.2, ty) , mix(0.72, 0.28, ty), mix(0.42, 0.42, ty)];
      const sun = Math.exp(-((Math.hypot(x - S * 0.72, y - S * 0.22) / (S * 0.1)) ** 2));
      col = col.map((c, k) => c + sun * [0.5, 0.35, 0.15][k]);
      // cube: top diamond, left and right faces
      const px = x + 0.5 - cx, py = y + 0.5 - cy;
      // top face: |px|/a + |py + a/2|/(a/2) <= 1
      const topU = (px / a + (py + a * 0.5) / (a * 0.5)) / 2; // 0..1 along one edge
      const topV = (-px / a + (py + a * 0.5) / (a * 0.5)) / 2;
      let face = null, u = 0, v = 0;
      if (topU >= 0 && topU <= 1 && topV >= 0 && topV <= 1) { face = 'top'; u = topU; v = topV; }
      else if (px <= 0 && px >= -a) {
        const edgeY = (px + a) / a * (a * 0.5); // 0 at the left corner, a/2 at the centre
        const vy = py - edgeY;
        if (vy >= 0 && vy <= hgt) { face = 'left'; u = (px + a) / a; v = vy / hgt; }
      } else if (px > 0 && px <= a) {
        const edgeY = (a - px) / a * (a * 0.5);
        const vy = py - edgeY;
        if (vy >= 0 && vy <= hgt) { face = 'right'; u = px / a; v = vy / hgt; }
      }
      if (face) {
        const tu = Math.min(15, Math.floor(u * 16)), tv = Math.min(15, Math.floor(v * 16));
        let c = face === 'top' ? grassTop(tu, tv) : grassSide(tu, tv);
        const shade = face === 'top' ? 1.08 : face === 'left' ? 0.78 : 0.6;
        // warm light from the upper right
        c = c.map((ch, k) => ch * shade * [1.08, 1.0, 0.9][k]);
        col = c;
      } else {
        // soft shadow under the cube
        const sh = Math.exp(-(((px / (a * 1.3)) ** 2) + (((py - hgt - a * 0.1) / (a * 0.35)) ** 2)));
        col = col.map((c) => c * (1 - sh * 0.35));
      }
      buf[i] = Math.round(clamp(col[0]) * 255);
      buf[i + 1] = Math.round(clamp(col[1]) * 255);
      buf[i + 2] = Math.round(clamp(col[2]) * 255);
      buf[i + 3] = Math.round(alpha * 255);
    }
  }
  return png(S, S, buf);
}

mkdirSync('icons', { recursive: true });
writeFileSync('icons/icon-180.png', draw(180));
writeFileSync('icons/icon-192.png', draw(192));
writeFileSync('icons/icon-512.png', draw(512));
writeFileSync('icons/icon-maskable-512.png', draw(512, { maskable: true }));
console.log('icons written');
