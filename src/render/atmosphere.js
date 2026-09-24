// CPU port of the atmosphere model: sun/moon colour at the ground and sky irradiance.
// Mirrors the GLSL in shaders/common.js so ambient light matches the rendered sky.

const PLANET_R = 6360e3;
const ATMOS_R = 6460e3;
const RAY = [5.802e-6, 13.558e-6, 33.1e-6];
const MIE = 3.996e-6;
const MIE_EXT = 4.44e-6;
const OZONE = [0.65e-6, 1.881e-6, 0.085e-6];
const RAY_H = 8000;
const MIE_H = 1200;

function raySphere(ox, oy, oz, dx, dy, dz, r) {
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const d = b * b - c;
  if (d < 0) return null;
  const s = Math.sqrt(d);
  return [-b - s, -b + s];
}

function density(h) {
  return [Math.exp(-h / RAY_H), Math.exp(-h / MIE_H), Math.max(0, 1 - Math.abs(h - 25000) / 15000)];
}

export function transmittance(px, py, pz, lx, ly, lz, steps = 8) {
  const g = raySphere(px, py, pz, lx, ly, lz, PLANET_R);
  if (g && g[0] > 0) return [0, 0, 0];
  const t = raySphere(px, py, pz, lx, ly, lz, ATMOS_R);
  if (!t) return [1, 1, 1];
  const dt = t[1] / steps;
  let r = 0, m = 0, o = 0;
  for (let i = 0; i < steps; i++) {
    const s = (i + 0.5) * dt;
    const x = px + lx * s, y = py + ly * s, z = pz + lz * s;
    const d = density(Math.hypot(x, y, z) - PLANET_R);
    r += d[0] * dt; m += d[1] * dt; o += d[2] * dt;
  }
  return [0, 1, 2].map((c) => Math.exp(-(RAY[c] * r + MIE_EXT * m + OZONE[c] * o)));
}

// Scattered radiance for unit illuminance (same model as the GLSL, fewer steps).
export function scatter(dx, dy, dz, lx, ly, lz, alt, steps = 12) {
  const ox = 0, oy = PLANET_R + alt, oz = 0;
  const ta = raySphere(ox, oy, oz, dx, dy, dz, ATMOS_R);
  const tg = raySphere(ox, oy, oz, dx, dy, dz, PLANET_R);
  let tMax = ta[1];
  if (tg && tg[0] > 0) tMax = Math.min(tMax, tg[0]);
  tMax = Math.min(tMax, 120e3); // same cap as the GLSL model
  const dt = tMax / steps;
  const mu = dx * lx + dy * ly + dz * lz;
  const phR = 3 / (16 * Math.PI) * (1 + mu * mu);
  const g = 0.8;
  const phM = 3 / (8 * Math.PI) * ((1 - g * g) * (1 + mu * mu)) / ((2 + g * g) * Math.pow(Math.max(1 + g * g - 2 * g * mu, 1e-4), 1.5));
  const sum = [0, 0, 0];
  let odr = 0, odm = 0, odo = 0;
  for (let i = 0; i < steps; i++) {
    const s = (i + 0.5) * dt;
    const x = ox + dx * s, y = oy + dy * s, z = oz + dz * s;
    const d = density(Math.hypot(x, y, z) - PLANET_R);
    odr += d[0] * dt; odm += d[1] * dt; odo += d[2] * dt;
    const ts = transmittance(x, y, z, lx, ly, lz, 6);
    for (let c = 0; c < 3; c++) {
      const tv = Math.exp(-(RAY[c] * odr + MIE_EXT * odm + OZONE[c] * odo));
      const sr = RAY[c] * d[0], sm = MIE * d[1];
      sum[c] += tv * ts[c] * (sr * (phR + 0.11) + sm * (phM + 0.05)) * dt;
    }
  }
  return sum;
}

const DIRS = [];
{
  // elevation bands (degrees) with a sample direction at their centre; weight = solid angle
  const bands = [[0, 8], [8, 18], [18, 32], [32, 50], [50, 72], [72, 90]];
  for (const [e0, e1] of bands) {
    const n = e1 >= 90 ? 3 : 8;
    const em = ((e0 + e1) / 2) * Math.PI / 180;
    const band = 2 * Math.PI * (Math.sin(e1 * Math.PI / 180) - Math.sin(e0 * Math.PI / 180));
    for (let a = 0; a < n; a++) {
      const az = (a / n) * Math.PI * 2 + e0 * 0.05;
      DIRS.push({ d: [Math.cos(em) * Math.cos(az), Math.sin(em), Math.cos(em) * Math.sin(az)], w: band / n });
    }
  }
}

// Irradiance on an up-facing and on a vertical surface (averaged over azimuth) from the sky.
export function skyIrradiance(l, alt, intensity) {
  const up = [0, 0, 0], side = [0, 0, 0];
  for (const { d, w } of DIRS) {
    const L = scatter(d[0], d[1], d[2], l[0], l[1], l[2], alt);
    const cosUp = d[1];
    const cosSide = Math.sqrt(1 - d[1] * d[1]) / Math.PI;
    for (let c = 0; c < 3; c++) {
      up[c] += L[c] * cosUp * w * intensity;
      side[c] += L[c] * cosSide * w * intensity;
    }
  }
  return { up, side };
}

export const PLANET_RADIUS = PLANET_R;
