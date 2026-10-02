// The F-22 Raptor's shape, shared by its model (render/jet.js), its flight and weapons
// (game/jet.js) and what the crosshair picks. Its real proportions, a block to the metre: 18.9 long,
// 13.56 across the wings, 5.08 high on its wheels. Wings swept 42 degrees at the leading edge and
// -17 at the trailing edge, the tails and stabilators aligned with them; two tails canted outwards;
// caret intakes on the shoulders; two flat thrust-vectoring nozzles; the M61A2 cannon in the right
// wing root; the missiles in a bay under the middle and one at each side.
//
// The jet's own frame: x to the right, y up, -z forward; the origin its centre of mass on the line
// of its chines. On its wheels that is GEAR_H above the ground.

export const LENGTH = 18.9;
export const SPAN = 13.56;
export const NOSE_Z = -10.4;
export const TAIL_Z = 8.7; // the nozzles' ends
export const GEAR_H = 1.95; // the centre above the ground, on its wheels
export const WING = {
  rootX: 2.3, tipX: SPAN / 2, // where the wing leaves the body, and its tip
  rootLE: -3.0, rootTE: 4.1, tipLE: 1.03, tipTE: 2.73, // leading and trailing edges (z) at root and tip
  rootY: 0.1, tipY: -0.15, // (a little anhedral)
  rootT: 0.34, tipT: 0.08, // thickness
};
export const STAB = { rootX: 1.95, tipX: 4.42, rootLE: 4.7, rootTE: 8.4, tipLE: 6.92, tipTE: 7.64, y: -0.12, rootT: 0.18, tipT: 0.05, pivotZ: 6.3 };
export const FIN = { rootX: 1.72, rootY: 0.48, span: 3.0, cant: (28 * Math.PI) / 180, rootLE: 2.2, rootTE: 7.2, tipLE: 4.72, tipTE: 6.28, rootT: 0.2, tipT: 0.06 };
export const COCKPIT = [0, 0.78, -5.35]; // the pilot's seat (the eye a little over it)
export const EYE = [0, 1.22, -5.1];
export const GUN = [1.62, 0.52, -2.6]; // the M61's muzzle, in the right wing root
// the missiles' stations: six in the main bay (AIM-120), one in each side bay (AIM-9)
export const BAY_MAIN = { z0: -2.7, z1: 1.5, x: 0.9, y: -0.82 };
export const SIDE_BAYS = [[-1.92, -0.45, -1.2], [1.92, -0.45, -1.2]];
export const MISSILE_STATIONS = [
  [-0.55, -0.95, -0.7], [0.55, -0.95, -0.7], [-0.25, -1.05, -0.4], [0.25, -1.05, -0.4], [-0.75, -1.0, -0.2], [0.75, -1.0, -0.2],
  [-2.15, -0.6, -1.2], [2.15, -0.6, -1.2],
];
export const NOZZLES = [[-0.78, -0.1, 8.7], [0.78, -0.1, 8.7]];
// the wheels' contact points, gear down
export const WHEELS = [[0, -GEAR_H, -6.6], [-1.55, -GEAR_H, 0.6], [1.55, -GEAR_H, 0.6]];

// Points round its outline, checked against the world as it flies: the nose, the canopy, the
// tails' and wings' tips and edges, the belly and the nozzles (and, gear down, the wheels).
export const HULL_PTS = [
  [0, -0.05, NOSE_Z + 0.1], [0, 0.4, -8.4], [0, 1.38, -5.6], [0, 0.85, -2.5], [0, 0.7, 2.5],
  [0, -0.55, -7.5], [0, -0.8, -2.5], [0, -0.8, 2.0], [0, -0.6, 6.5],
  [-2.3, 0.1, -2.6], [2.3, 0.1, -2.6], [-2.3, 0.0, 3.8], [2.3, 0.0, 3.8],
  [-4.5, -0.02, -0.4], [4.5, -0.02, -0.4], [-6.7, -0.15, 1.9], [6.7, -0.15, 1.9], [-4.2, 0.0, 3.4], [4.2, 0.0, 3.4],
  [-4.4, -0.12, 7.3], [4.4, -0.12, 7.3], [-2.4, -0.12, 6.0], [2.4, -0.12, 6.0],
  [-3.1, 3.1, 5.5], [3.1, 3.1, 5.5], [-2.4, 1.8, 4.5], [2.4, 1.8, 4.5],
  [-0.8, -0.1, 8.6], [0.8, -0.1, 8.6],
];

// How far its outline reaches from the centre (for the crosshair and broad checks).
export const RADIUS = 10.6;

// A point of the jet in the world: rot is its 3x3 rotation (row-major, columns its x, y, z axes).
export function toWorld(pos, rot, p) {
  return [
    pos[0] + rot[0] * p[0] + rot[1] * p[1] + rot[2] * p[2],
    pos[1] + rot[3] * p[0] + rot[4] * p[1] + rot[5] * p[2],
    pos[2] + rot[6] * p[0] + rot[7] * p[1] + rot[8] * p[2],
  ];
}

// The rotation of a quaternion [x, y, z, w] (row-major 3x3).
export function quatToMat(q) {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

// A quaternion turned by yaw about y, then pitch about x, then roll about z (all in radians).
export function quatFromEuler(yaw, pitch, roll) {
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2), cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  // q = qy * qp * qr
  const qy = [0, sy, 0, cy], qp = [sp, 0, 0, cp], qr = [0, 0, sr, cr];
  return quatMul(quatMul(qy, qp), qr);
}

export function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function quatNorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

// Turned by an angular velocity w (in the jet's own frame, radians a second) for dt.
export function quatTurn(q, w, dt) {
  const a = Math.hypot(w[0], w[1], w[2]) * dt;
  if (a < 1e-9) return q;
  const s = Math.sin(a / 2) / (a / dt);
  return quatNorm(quatMul(q, [w[0] * s, w[1] * s, w[2] * s, Math.cos(a / 2)]));
}

// Its heading, pitch and bank (radians) from a rotation: yaw of the nose, its climb, and how far
// it is rolled.
export function attitude(rot) {
  const fx = -rot[2], fy = -rot[5], fz = -rot[8];
  const yaw = Math.atan2(-fx, -fz);
  const pitch = Math.asin(Math.max(-1, Math.min(1, fy)));
  // bank: the right wing's height against the horizon
  const rx = rot[0], ry = rot[3], rz = rot[6];
  const ux = rot[1], uy = rot[4], uz = rot[7];
  const roll = Math.atan2(-ry, uy);
  void rx; void rz; void ux; void uz;
  return { yaw, pitch, roll };
}

// Boxes round its parts (its own frame), for what the crosshair or a shot meets.
const PART_BOXES = [
  [-1.65, -0.95, NOSE_Z, 1.65, 1.45, TAIL_Z], // fuselage and canopy
  [-SPAN / 2, -0.32, -3.0, SPAN / 2, 0.42, 4.1], // wings
  [-4.45, -0.3, 4.7, 4.45, 0.12, 8.4], // stabilators
  [-3.3, 0.4, 2.2, -1.5, 3.2, 7.2], [1.5, 0.4, 2.2, 3.3, 3.2, 7.2], // tails
  [-0.35, -GEAR_H, -7.0, 0.35, -0.8, -6.2], [-1.85, -GEAR_H, 0.2, -1.25, -0.8, 1.0], [1.25, -GEAR_H, 0.2, 1.85, -0.8, 1.0], // wheels
];

// Where a ray (origin o, unit direction d) first meets a parked jet whose wheels stand at `feet`,
// turned `yaw`: its distance, or null (not within maxT).
export function rayHit(o, d, feet, yaw, maxT) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // (into its own frame: turned back by its yaw about y, from its centre)
  const rx = o[0] - feet[0], ry = o[1] - feet[1] - GEAR_H, rz = o[2] - feet[2];
  const lo = [c * rx - s * rz, ry, s * rx + c * rz];
  const ld = [c * d[0] - s * d[2], d[1], s * d[0] + c * d[2]];
  let best = null;
  for (const b of PART_BOXES) {
    let t0 = 0, t1 = maxT;
    let ok = true;
    for (let i = 0; i < 3 && ok; i++) {
      if (Math.abs(ld[i]) < 1e-9) { if (lo[i] < b[i] || lo[i] > b[i + 3]) ok = false; continue; }
      let a = (b[i] - lo[i]) / ld[i], e = (b[i + 3] - lo[i]) / ld[i];
      if (a > e) { const q = a; a = e; e = q; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, e);
      if (t0 > t1) ok = false;
    }
    if (ok && (best === null || t0 < best)) best = t0;
  }
  return best;
}
