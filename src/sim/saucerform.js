// The flying saucer's shape, shared by its model (render/saucer.js), its flight, landing and
// seats (game/saucer.js) and what the crosshair picks (sim/simulation.js). A mothership 55 blocks
// across: a convex disc of plated hull with a band of lights round its rim, a deck under a great
// glass dome where the pilot and sixteen passengers sit, engines under it and six landing legs
// that reach down to uneven ground and fold away in flight.
//
// Distances are in blocks from the saucer's foot (the point on the ground under its middle, with
// its legs down); x right, y up, -z forward (the way it faces at yaw 0).

import { IS_SOLID, BLOCKS, WAVE } from '../world/blocks.js';

export const RIM = 27.5; // the rim's radius
export const HULL = 8.5; // the hull's underside at the middle (how far the legs hold it up)
export const DECK = HULL + 11.5; // the floor under the dome
export const DOME_R = 12.5; // the dome's radius at the deck
export const TOP = DECK + 10.5; // the top of the dome
export const FOOT_R = 18; // how far out from the middle the feet stand
export const LEGS = 6;
export const LEG_REACH = 5; // how much further down a leg can stretch, for uneven ground
export const ENGINE_R = 4.2; // the main engine under the middle
export const THRUSTERS = 8; // round it, smaller
export const THRUSTER_R = 21.5;

// The outline of the hull: [radius, height] going up. The underside from the engine out to the
// rim, the rim's band, and the top of the hull in to the deck; above, the dome (domeRadius).
export const LOWER = [[ENGINE_R, HULL - 0.6], [5, HULL], [10, HULL + 1], [15, HULL + 2.2], [20, HULL + 3.6], [24, HULL + 4.8], [26.5, HULL + 5.6], [RIM, HULL + 6]];
export const UPPER = [[RIM, HULL + 7], [26, HULL + 7.6], [22, HULL + 9], [17, HULL + 10.4], [13, HULL + 11.3], [DOME_R, DECK]];

export function domeRadius(y) {
  const k = (y - DECK) / (TOP - DECK);
  return k < 0 || k > 1 ? 0 : DOME_R * Math.sqrt(1 - k * k);
}

function along(profile, y) {
  for (let i = 1; i < profile.length; i++) {
    const [r0, y0] = profile[i - 1], [r1, y1] = profile[i];
    if (y <= y1) return y1 > y0 ? r0 + ((r1 - r0) * (y - y0)) / (y1 - y0) : Math.max(r0, r1);
  }
  return profile[profile.length - 1][0];
}

// How far out the saucer reaches at height y above its foot (0: not there).
export function radiusAt(y) {
  if (y < HULL - 0.6 || y > TOP) return 0;
  if (y <= HULL + 6) return along(LOWER, y);
  if (y <= HULL + 7) return RIM;
  if (y <= DECK) return along(UPPER, y);
  return domeRadius(y);
}

// Where its height-y slice of the hull's underside is at radius r (the lowest point of the hull
// over that ring), for legs, thrusters and lights.
export function undersideAt(r) {
  if (r <= ENGINE_R) return HULL - 0.6;
  for (let i = 1; i < LOWER.length; i++) {
    const [r0, y0] = LOWER[i - 1], [r1, y1] = LOWER[i];
    if (r <= r1) return y0 + ((y1 - y0) * (r - r0)) / Math.max(1e-6, r1 - r0);
  }
  return HULL + 6;
}

// ---------------------------------------------------------------- seats
// Sixteen for passengers round the deck (facing out through the glass), and the pilot's at the
// controls at the front. [x, z, facing yaw] in the saucer's own frame.
export const PILOT_SEAT = [0, -7.4, 0];
export const SEATS = [];
for (let i = 0; i < 10; i++) {
  const a = ((36 + i * 32) * Math.PI) / 180;
  SEATS.push([Math.sin(a) * 8.6, -Math.cos(a) * 8.6, -a]);
}
for (let i = 0; i < 6; i++) {
  const a = ((30 + i * 60) * Math.PI) / 180;
  SEATS.push([Math.sin(a) * 4.6, -Math.cos(a) * 4.6, -a]);
}
export const SEAT_H = 0.5; // the cushion's top over the deck

// A seat (or the pilot's) in the world: { pos (feet on the deck), yaw }, for a saucer at foot
// `pos` facing `yaw`.
export function seatAt(pos, yaw, seat) {
  const [x, z, f] = seat === 'pilot' ? PILOT_SEAT : SEATS[seat % SEATS.length];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { pos: [pos[0] + c * x + s * z, pos[1] + DECK, pos[2] - s * x + c * z], yaw: yaw + f };
}

// The feet, [x, z] in the saucer's frame.
export const FEET = [];
for (let i = 0; i < LEGS; i++) {
  const a = (i / LEGS) * Math.PI * 2 + Math.PI / 6;
  FEET.push([Math.cos(a) * FOOT_R, Math.sin(a) * FOOT_R]);
}
export function footAt(pos, yaw, i) {
  const [x, z] = FEET[i];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [pos[0] + c * x + s * z, pos[2] - s * x + c * z];
}

// ---------------------------------------------------------------- what it bumps into
// Leaves and plants it brushes through; anything else solid stops it.
export const SOFT = new Uint8Array(256);
for (const d of BLOCKS) if (d && (d.wave === WAVE.LEAVES || d.wave === WAVE.PLANT)) SOFT[d.id] = 1;
export const blocksSaucer = (b) => IS_SOLID[b] && !SOFT[b];

// Points over its surface (rings round the hull and the dome, closer than a block apart where it
// is widest), checked against the world as it moves.
export const BODY_PTS = [];
for (const y of [HULL - 0.5, HULL + 0.4, HULL + 1.6, HULL + 3, HULL + 4.5, HULL + 5.8, HULL + 6.5, HULL + 7.3, HULL + 9, HULL + 10.6, DECK + 1.5, DECK + 5, DECK + 8.5]) {
  const r = Math.max(0, radiusAt(y) - 0.15);
  const n = Math.max(6, Math.ceil((2 * Math.PI * r) / 0.95));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    BODY_PTS.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
}
BODY_PTS.push([0, HULL - 0.6, 0], [0, TOP - 0.1, 0]);
// each foot's pad: its middle and corners (legs down)
export const FOOT_PTS = [];
for (const [x, z] of FEET) for (const [dx, dz] of [[0, 0], [-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) FOOT_PTS.push([x + dx, 0.02, z + dz]);

// ---------------------------------------------------------------- the crosshair
// The first point along a ray (origin o, unit direction d) inside the saucer at foot `foot`, as a
// distance, or null by maxT.
export function rayHit(o, d, foot, maxT) {
  const ox = o[0] - foot[0], oy = o[1] - foot[1], oz = o[2] - foot[2];
  // (only where the ray crosses the cylinder it fits in)
  const a = d[0] * d[0] + d[2] * d[2];
  let t0 = 0, t1 = maxT;
  if (a > 1e-9) {
    const b = ox * d[0] + oz * d[2];
    const c = ox * ox + oz * oz - RIM * RIM;
    const disc = b * b - a * c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    t0 = Math.max(t0, (-b - s) / a);
    t1 = Math.min(t1, (-b + s) / a);
  } else if (ox * ox + oz * oz > RIM * RIM) return null;
  if (Math.abs(d[1]) > 1e-9) {
    const ya = (HULL - 0.6 - oy) / d[1], yb = (TOP - oy) / d[1];
    t0 = Math.max(t0, Math.min(ya, yb));
    t1 = Math.min(t1, Math.max(ya, yb));
  } else if (oy < HULL - 0.6 || oy > TOP) return null;
  for (let t = Math.max(0, t0); t <= t1; t += 0.2) {
    const x = ox + d[0] * t, y = oy + d[1] * t, z = oz + d[2] * t;
    const r = radiusAt(y);
    if (r > 0 && x * x + z * z <= r * r) return t;
  }
  return null;
}
