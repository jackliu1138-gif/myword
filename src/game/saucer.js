// Flying saucers: a mothership 55 blocks across, of plated metal and glass with a band of lights
// round its rim (its shape: sim/saucerform.js; its model: render/saucer.js).
//  - Put down from its item (creative has it; in survival it is crafted, and its tank takes coal,
//    blaze rods or lava), it stands on six legs that reach down to uneven ground; it needs room
//    for itself. Right click it (from under it too) to climb in; holding fuel, right click fills
//    its tank instead.
//  - The flight panel: where to (the Earth, the Moon, Mars, the stations over Jupiter and Saturn)
//    and how long the trip should take (half a minute, a minute, three minutes, or as long as you
//    like, to watch the view). The autopilot does the rest: a countdown, a roar, fire, smoke and
//    a red glow lighting up the ground at lift-off, up out of the air, round the planet and
//    across space, and down onto the fixed launch pad there: on the Earth the place the saucer
//    was set down (its own pad), on the Moon and Mars the pad in the middle of their worlds, at
//    the stations their docking platforms.
//  - While it flies the camera swings freely round it (look about to turn it; the wheel, or the
//    buttons on the trip panel, bring it closer or take it further out); the camera key takes you
//    to the bridge under the dome, looking out from your seat.
//  - Sixteen seats under the dome: for other players on a server (right click a landed saucer to
//    ask to come aboard) and for villagers (the panel invites the ones near; carried aboard, one
//    sits down), who come along to other worlds and get off when told.
//  - Landed, sneak to climb out (the saucer stays where it is), or right click for another trip.
// While flown, a saucer is part of its pilot: it goes where they go, between the worlds too.
// Parked, it is a creature that stays (sim/entities.js). Installed as methods on Game.prototype.

import {
  BODIES, DIM_BODY, bodyPos, positionOn, worldToLonLat, toBody, fromBody, v3, rotate, localFrame, nearestBody, placeOn, blendFrame,
} from '../world/space.js';
import { STATION_Y, STATION_DOCK, MoonGenerator, MarsGenerator } from '../world/planets.js';
import { IS_LIQUID, WORLD_HEIGHT } from '../world/blocks.js';
import { ITEM, saucerFuel, SAUCER_TANK } from '../sim/items.js';
import * as F from '../sim/saucerform.js';
import { t } from '../ui/i18n.js';
import { PAD } from './gamepad.js';

const { add, sub, scale, norm, len, dot, cross } = v3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (e0, e1, x) => { const k = clamp((x - e0) / (e1 - e0), 0, 1); return k * k * (3 - 2 * k); };
const now = () => performance.now() / 1000;

export const SAUCER_DESTS = ['earth', 'moon', 'mars', 'jupiter', 'saturn'];
export const TRIP_TIMES = [30, 60, 180];
export const TRIP_MIN = 15, TRIP_MAX = 900;
const DIM_OF = { earth: 0, moon: 4, mars: 5, jupiter: 6, saturn: 7 };
const TIER = { earth: 0, moon: 1, mars: 2, jupiter: 3, saturn: 3 };
const COUNTDOWN = 3;
// a trip's time: up out of the air, across space, down onto the pad (fractions)
const ASCENT = 0.22, CRUISE = 0.48;
// (arriving from space a little below where a body's dimension takes over: see space.js)
const ARRIVE_BELOW_TOP = 170;
// how far the camera swings out round it at first, and the nearest it comes
const CAM_DIST = 120, CAM_LEAST = F.RIM + 6;
const INVITE_RANGE = 48; // villagers this near are asked aboard

// What a trip costs in fuel (a hop to the pad of the body you are on: a little).
export function tripCost(from, to) {
  return from === to ? 2 : 8 * Math.max(TIER[from], TIER[to]);
}

// The point a fraction k of the way round a body: from p0 (in C) to straight out from its centre
// c along `out` at height h1 over its radius R; climbing first, then swinging round.
function arcPoint(c, p0, out, R, h1, k) {
  const rel = sub(p0, c);
  const r0 = norm(rel);
  const h0 = len(rel) - R;
  const ang = Math.acos(clamp(dot(r0, out), -1, 1));
  let axis = cross(r0, out);
  if (len(axis) < 1e-9) axis = cross(r0, Math.abs(r0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  axis = norm(axis);
  const r = rotate(r0, axis, ang * smooth(0.12, 1, k));
  return add(c, scale(r, R + h0 + (h1 - h0) * smooth(0, 0.55, k)));
}

// From p0 round a body (centre c, radius R) to p1, a fraction k of the way: swinging round it
// (higher in the middle, the further round it goes), then straight down onto p1.
function aroundPoint(c, p0, p1, R, k) {
  const r0 = norm(sub(p0, c)), r1 = norm(sub(p1, c));
  const h0 = len(sub(p0, c)) - R, h1 = len(sub(p1, c)) - R;
  const ang = Math.acos(clamp(dot(r0, r1), -1, 1));
  let axis = cross(r0, r1);
  if (len(axis) < 1e-9) axis = cross(r0, Math.abs(r0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  axis = norm(axis);
  const turn = smooth(0, 0.85, k);
  const lift = R * 0.5 * (ang / Math.PI) * Math.sin(Math.PI * turn);
  return add(c, scale(rotate(r0, axis, ang * turn), R + h0 + (h1 - h0) * smooth(0.25, 1, k) + lift));
}

// A trip across space at time T, a fraction u of the way: round the departure body (out of its
// air and over to the side that faces the other), straight across, and round the other down to
// over its pad. Never through either body, whatever side of them the pads are on. (Setting off
// in space by the body it is going to: just round that one, to over its pad.)
export function cruisePoint(trip, u, T, frames) {
  const { from, to } = trip;
  const cD = bodyPos(from, T), cT = bodyPos(to, T);
  const RD = BODIES[from].R, RT = BODIES[to].R;
  const D0 = fromBody(from, trip.qD0, T, frames[from]);
  const A0 = positionOn(to, trip.lonT, trip.latT, trip.altT, T, frames[to]).pos;
  if (from === to) return aroundPoint(cT, D0, A0, RT, u);
  const toward = norm(sub(cT, cD));
  const hD = RD * 0.5, hT = RT * 0.5;
  const a = 0.3, b = 0.7;
  if (u <= a) return arcPoint(cD, D0, toward, RD, hD, u / a);
  if (u >= b) return arcPoint(cT, A0, scale(toward, -1), RT, hT, 1 - (u - b) / (1 - b));
  const E = add(cD, scale(toward, RD + hD)), Fp = add(cT, scale(toward, -(RT + hT)));
  const k = (u - a) / (b - a);
  return add(E, scale(sub(Fp, E), 0.5 - 0.5 * Math.cos(Math.PI * k)));
}

// The points it checks as it moves one way along an axis: only those on that side of it.
const LEAD = {};
for (const [ax, s] of [[0, 1], [0, -1], [2, 1], [2, -1], [1, 1], [1, -1]]) {
  const mid = ax === 1 ? F.HULL + 6.5 : 0;
  LEAD[ax * 2 + (s > 0 ? 1 : 0)] = F.BODY_PTS.filter((q) => (q[ax] - mid) * s > -0.6);
}

export function installSaucer(Game) {
  const P = Game.prototype;

  // ---------------------------------------------------------------- where it can stand
  // The top of the ground under (x, z) from height yTop down to yBottom: the first solid block (not
  // leaves or plants) or a liquid's surface; null if there is none.
  P.groundAt = function groundAt(x, z, yTop, yBottom) {
    const w = this.world;
    const bx = Math.floor(x), bz = Math.floor(z);
    for (let y = Math.min(WORLD_HEIGHT - 1, Math.floor(yTop)); y >= Math.max(0, Math.floor(yBottom)); y--) {
      const b = w.getBlock(bx, y, bz);
      if (F.blocksSaucer(b) || IS_LIQUID[b]) return y + 1;
    }
    return null;
  };

  // Where a saucer facing yaw with its middle over (x, z) can stand, starting from about height y:
  // { pos (its foot), feet: [how much further down each leg reaches] }, or { why: 'uneven' | 'room' }.
  P.saucerSpot = function saucerSpot(x, y, z, yaw) {
    const g = [];
    for (let i = 0; i < F.LEGS; i++) {
      const [fx, fz] = F.footAt([x, y, z], yaw, i);
      const h = this.groundAt(fx, fz, y + 6, y - F.LEG_REACH - 8);
      if (h === null) return { why: 'uneven' };
      g.push(h);
    }
    const top = Math.max(...g);
    if (top - Math.min(...g) > F.LEG_REACH + 1e-6) return { why: 'uneven' };
    const pos = [x, top, z];
    if (this.saucerBlocked(pos, 0, true)) return { why: 'room' };
    return { pos, feet: g.map((h) => top - h) };
  };

  // ---------------------------------------------------------------- placing and boarding
  P.placeSaucer = function placeSaucer(hit) {
    if (!hit) return false;
    if (this.dimension === 1 || this.dimension === 2 || this.dimension === 3) { this.ui.toast(t('saucer.noPlace'), 2600); return false; }
    const p = this.player;
    const f = p.forward();
    const yaw = Math.atan2(-f[0], -f[2]);
    // (put down in front of us, out of the way; or, if there is no room there, where we look)
    const hl = Math.hypot(f[0], f[2]) || 1;
    const ahead = F.RIM + 5;
    const tries = [[p.pos[0] + (f[0] / hl) * ahead, p.pos[1] + 2, p.pos[2] + (f[2] / hl) * ahead], [hit.x + 0.5, hit.y + 1, hit.z + 0.5]];
    let spot = null, why = 'room';
    for (const [x, y, z] of tries) {
      const s = this.saucerSpot(x, y, z, yaw);
      if (s.pos) { spot = s; break; }
      why = s.why;
    }
    if (!spot) { this.ui.toast(t('saucer.noRoom.' + why), 3200); return false; }
    const m = this.sim.spawnMob('saucer', spot.pos[0], spot.pos[1], spot.pos[2]);
    m.yaw = m.prevYaw = yaw;
    m.persistent = true;
    m.feet = spot.feet;
    // (on the Earth, where it is first set down is its own launch pad)
    if (!this.dimension) m.home = spot.pos.slice();
    m.fuel = this.isCreative() ? SAUCER_TANK : 0;
    if (!this.isCreative()) this.inventory.consume(this.selected);
    this.audio.play('place', 'metal');
    this.audio.saucerThud && this.audio.saucerThud(0.8);
    this.saucerDust(spot.pos, 60, 1);
    this.swing = 1;
    this.ui.toast(t('saucer.placed'), 3500);
    return true;
  };

  // Right click on a parked saucer: fuel into its tank, or climb in.
  P.useSaucer = function useSaucer(m, def) {
    if (m.ghost) { this.askForSaucer(m); return true; }
    const fuel = def ? saucerFuel(def.id) : 0;
    if (fuel && !this.isCreative()) {
      const room = SAUCER_TANK - (m.fuel || 0);
      if (room < fuel) { this.ui.toast(t('saucer.tankFull'), 2000); return true; }
      m.fuel = (m.fuel || 0) + fuel;
      this.useFuelItem(def);
      this.audio.sfx('pickup', 0.6, 0);
      this.ui.toast(t('saucer.fuel', { n: m.fuel, max: SAUCER_TANK }), 2000);
      return true;
    }
    this.boardSaucer(m);
    return true;
  };

  // one fuel item used up (a lava bucket leaves its bucket)
  P.useFuelItem = function useFuelItem(def) {
    if (def.id === ITEM.LAVA_BUCKET) { this.fillHeldBucket ? this.fillHeldBucket(ITEM.BUCKET) : this.inventory.consume(this.selected); return; }
    this.inventory.consume(this.selected);
  };

  P.boardSaucer = function boardSaucer(m) {
    if (this.ride || this.carriedBy) return;
    if (this.carrying && this.carrying.kind !== 'mob') this.putDown(false);
    const p = this.player;
    if (p.riding) this.dismount();
    const uid = m.uid || this.serializeCreature(m).uid;
    const from = p.pos.slice();
    this.ride = {
      uid, fuel: this.isCreative() ? SAUCER_TANK : m.fuel || 0, home: Array.isArray(m.home) ? m.home.slice(0, 3) : null, hp: m.health,
      yaw: m.yaw, phase: 'landed', legs: 1, engine: 0, trip: null, camDist: CAM_DIST, bank: [0, 0],
      feet: Array.isArray(m.feet) ? m.feet.slice(0, F.LEGS) : null, crew: Array.isArray(m.crew) ? m.crew : [], passengers: [],
    };
    m.crew = null;
    m.removed = true;
    this.sim.entities.delete(m.id);
    p.pos = m.body.pos.slice();
    p.vel = [0, 0, 0];
    p.flying = false;
    p.gliding = false;
    this.camMode = 0;
    // (beamed up through the hull: a column of light from where we stood)
    this.saucerBeam(from, add(p.pos, [0, F.HULL, 0]));
    this.audio.sfx('travel', 0.45, 0);
    // (a villager in our arms takes a seat)
    if (this.carrying && this.carrying.kind === 'mob' && this.carrying.e.type === 'villager') this.seatCarried();
    this.openSaucerPanel();
  };

  // Climbing out (landed only): the saucer stays parked where it is (with the villagers aboard).
  P.leaveSaucer = function leaveSaucer() {
    const r = this.ride;
    if (!r || r.phase !== 'landed') return false;
    // (our passengers get off too: their games see we've gone)
    const p = this.player;
    const at = p.pos.slice();
    const m = this.sim.spawnMob('saucer', at[0], at[1], at[2]);
    m.uid = r.uid;
    m.yaw = m.prevYaw = r.yaw;
    m.persistent = true;
    m.fuel = r.fuel === Infinity ? SAUCER_TANK : r.fuel;
    if (r.home) m.home = r.home;
    if (r.feet) m.feet = r.feet;
    if (r.crew && r.crew.length) m.crew = r.crew;
    if (Number.isFinite(r.hp)) m.health = Math.max(1, r.hp);
    this.ride = null;
    this.audio.setEngine(0, 0);
    // down on the ground under it, by the hatch
    const spot = this.groundUnder(at, r.yaw);
    this.saucerBeam(spot, add(at, [0, F.HULL, 0]));
    p.pos = spot;
    p.vel = [0, 0, 0];
    this.audio.sfx('travel', 0.35, 0);
    return true;
  };

  // A place to stand on the ground under a saucer at foot `at` (or beside it).
  P.groundUnder = function groundUnder(at, yaw) {
    const w = this.world;
    const free = (x, y, z) => !F.blocksSaucer(w.getBlock(x, y, z)) && !IS_LIQUID[w.getBlock(x, y, z)];
    for (const [r, n] of [[7, 8], [11, 10], [F.RIM + 3, 16]]) {
      for (let k = 0; k < n; k++) {
        const a = yaw + (k * Math.PI * 2) / n;
        const x = Math.floor(at[0] - Math.sin(a) * r), z = Math.floor(at[2] - Math.cos(a) * r);
        for (let y = Math.floor(at[1] + 3); y >= Math.floor(at[1] - F.LEG_REACH - 2); y--) {
          if (F.blocksSaucer(w.getBlock(x, y - 1, z)) && free(x, y, z) && free(x, y + 1, z)) return [x + 0.5, y + 0.01, z + 0.5];
        }
      }
    }
    return [at[0], at[1] + 0.5, at[2]];
  };

  // A column of light between two points (boarding, getting off).
  P.saucerBeam = function saucerBeam(a, b) {
    const n = 46;
    for (let i = 0; i < n; i++) {
      const k = Math.random();
      const ang = Math.random() * Math.PI * 2, rr = 0.2 + Math.random() * 0.9;
      this.particles.spark(a[0] + (b[0] - a[0]) * k + Math.cos(ang) * rr, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k + Math.sin(ang) * rr,
        0, 1.5 + Math.random() * 2, 0, [2.2, 4.2, 6], { life: 0.6 + Math.random() * 0.7, size: 0.18 + Math.random() * 0.25, drag: 0.5 });
    }
  };

  // ---------------------------------------------------------------- the flight panel
  P.bodyHere = function bodyHere() {
    return DIM_BODY[this.dimension || 0] || null;
  };

  // The launch pad of a body: { x, y, z } (the saucer's foot on it), or null (the Earth, for a
  // saucer that has none).
  P.padOf = function padOf(body) {
    if (body === 'earth') { const h = this.ride && this.ride.home; return h ? { x: h[0], y: h[1], z: h[2] } : null; }
    if (body === 'jupiter' || body === 'saturn') return { x: STATION_DOCK[0] + 0.5, y: STATION_Y + 1, z: STATION_DOCK[1] + 0.5 };
    this.padGens = this.padGens || {};
    const g = this.padGens[body] || (this.padGens[body] = body === 'moon' ? new MoonGenerator(this.world.seed) : new MarsGenerator(this.world.seed));
    return { x: 0.5, y: g.padHeight() + 1, z: 0.5 };
  };

  P.saucerPanelInfo = function saucerPanelInfo() {
    const r = this.ride;
    const space = this.dimension === 3 && this.spaceState;
    const here = this.bodyHere() || (space ? nearestBody(this.spacePosC(), this.spaceTime()).name : null);
    const creative = this.isCreative();
    const p = this.player.pos;
    const dests = SAUCER_DESTS.map((body) => {
      const pad = this.padOf(body);
      const cost = here ? tripCost(here, body) : 0;
      let why = '';
      if (!here) why = 'nowhere';
      else if (!pad) why = 'noPad';
      else if (body === here && !space && Math.hypot(pad.x - p[0], pad.z - p[2]) < 8 && Math.abs(pad.y - p[1]) < 6) why = 'here';
      else if (!creative && r.fuel < cost) why = 'fuel';
      return { body, cost, why, home: body === here };
    });
    const crew = (r.crew || []).length, players = (r.passengers || []).length;
    return {
      fuel: creative ? null : r.fuel, max: SAUCER_TANK, dests, landed: r.phase === 'landed', flying: r.phase === 'manual', here,
      crew, players, seats: F.SEATS.length, nearVillagers: r.phase === 'landed' ? this.villagersToInvite().length : 0,
    };
  };

  P.openSaucerPanel = function openSaucerPanel() {
    const r = this.ride;
    if (!r || (r.phase !== 'landed' && r.phase !== 'manual')) return;
    this.state = 'saucer';
    this.input.enabled = false;
    this.input.keys.clear();
    this.input.buttons.clear();
    this.input.exitLock();
    if (this.touch) this.touch.show(false);
    this.saucerChoice = this.saucerChoice || { dest: null, secs: 60 };
    this.ui.renderSaucer(this.saucerPanelInfo(), this.saucerChoice);
    this.ui.show('saucer');
  };

  P.closeSaucerPanel = function closeSaucerPanel() {
    if (this.state !== 'saucer') return;
    this.ui.show(null);
    this.state = 'playing';
    this.input.enabled = true;
    if (this.touch) this.touch.show(true);
    const padUser = this.pads.connected && performance.now() - this.pads.lastActive < 1500;
    if (!this.input.lockFailed && !this.touch && !padUser) this.input.requestLock();
  };

  // fuel from the inventory into the tank, as much as fits (the panel's button)
  P.saucerFuelUp = function saucerFuelUp() {
    const r = this.ride;
    if (!r || this.isCreative()) return;
    let added = 0;
    const inv = this.inventory;
    for (let i = 0; i < inv.slots.length && r.fuel < SAUCER_TANK; i++) {
      const s = inv.slots[i];
      if (!s) continue;
      const f = saucerFuel(s.id);
      if (!f) continue;
      while (inv.slots[i] && inv.slots[i].id === s.id && r.fuel + f <= SAUCER_TANK) {
        r.fuel += f;
        added += f;
        if (s.id === ITEM.LAVA_BUCKET) { inv.slots[i] = { id: ITEM.BUCKET, count: 1, wear: 0 }; break; }
        inv.consume(i, 1);
      }
    }
    inv.changed && inv.changed();
    this.audio.sfx(added ? 'pickup' : 'villagerNo', 0.6, 0);
    this.ui.toast(added ? t('saucer.fuel', { n: r.fuel, max: SAUCER_TANK }) : t('saucer.noFuel'), 2200);
    this.ui.renderSaucer(this.saucerPanelInfo(), this.saucerChoice);
  };

  // ---------------------------------------------------------------- the autopilot
  P.launchSaucer = function launchSaucer(dest, seconds) {
    const r = this.ride;
    if (!r || (r.phase !== 'landed' && r.phase !== 'manual') || !SAUCER_DESTS.includes(dest)) return false;
    const info = this.saucerPanelInfo().dests.find((d) => d.body === dest);
    if (!info || info.why) { this.ui.toast(t('saucer.why.' + (info ? info.why : 'nowhere')), 2600); return false; }
    const airborne = r.phase === 'manual';
    const from = this.bodyHere() || (this.dimension === 3 ? nearestBody(this.spacePosC(), this.spaceTime()).name : null);
    const dur = clamp(Math.round(Number(seconds) || 60), TRIP_MIN, TRIP_MAX);
    if (!this.isCreative()) r.fuel -= info.cost;
    const pad = this.padOf(dest);
    // (on the Earth a saucer remembers the pad it leaves from: that's where it comes back to)
    if (from === 'earth' && !r.home && !airborne) r.home = this.player.pos.slice();
    r.trip = { from, to: dest, dur, pad, hop: from === dest && this.dimension !== 3, started: now(), elapsed: airborne ? COUNTDOWN : 0 };
    r.vel = [0, 0, 0];
    this.player.vel = [0, 0, 0];
    this.closeSaucerPanel();
    // (a villager in our arms takes a seat for the trip)
    if (this.carrying && this.carrying.kind === 'mob' && this.carrying.e.type === 'villager') this.seatCarried();
    // (already in the air: no countdown; already in space: straight across)
    if (this.dimension === 3) { r.trip.space = true; r.trip.elapsed = COUNTDOWN + dur * ASCENT; this.saucerCruiseFromHere(); }
    else if (airborne) { r.legs = 0; this.setPhase(r.trip.hop ? 'hopUp' : 'ascent', dur * (r.trip.hop ? 0.3 : ASCENT)); }
    else { this.setPhase('countdown', COUNTDOWN); this.audio.saucerSpool && this.audio.saucerSpool(COUNTDOWN); }
    this.ui.toast(t(airborne || this.dimension === 3 ? 'saucer.launchAir' : 'saucer.launch', { place: t('saucer.dest.' + dest) }), 2600);
    return true;
  };

  // ---------------------------------------------------------------- flying it yourself
  P.flySaucer = function flySaucer() {
    const r = this.ride;
    if (!r || (r.phase !== 'landed' && r.phase !== 'manual')) return;
    if (!this.isCreative() && r.fuel <= 0) { this.ui.toast(t('saucer.why.fuel'), 2400); return; }
    this.closeSaucerPanel();
    if (r.phase === 'landed') {
      r.phase = 'manual'; r.t = 0; r.burn = 0;
      this.player.vel = [0, 5, 0];
      this.audio.saucerIgnite && this.audio.saucerIgnite(0.6);
      this.ui.toast(t('saucer.manualHint'), 6000);
    }
  };

  // The top of the highest layer anything is in, in the chunks under the saucer at pos: with
  // nothing that high under it, it can't be touching anything. (Unknown: the world's top.)
  P.saucerTerrainTop = function saucerTerrainTop(pos) {
    const w = this.world;
    if (!w || typeof w.columnTop !== 'function') return WORLD_HEIGHT;
    const R = F.RIM + 1;
    const cx0 = Math.floor((pos[0] - R) / 16), cx1 = Math.floor((pos[0] + R) / 16);
    const cz0 = Math.floor((pos[2] - R) / 16), cz1 = Math.floor((pos[2] + R) / 16);
    let top = 0;
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) top = Math.max(top, w.columnTop(cx * 16, cz * 16) + 1);
    return top;
  };

  // Whether the saucer (with its legs down, legs > 0.5) at foot pos runs into anything solid
  // (not leaves); lead: only the points on one side of it (moving that way along an axis).
  P.saucerBlocked = function saucerBlocked(pos, legs, full = false, lead = null) {
    const w = this.world;
    // (nothing under it as high as its feet or its hull: it touches nothing)
    const top = this.saucerTerrainTop(pos);
    const lowest = pos[1] + (legs > 0.5 ? 0 : F.HULL - 0.6);
    if (lowest > Math.min(top, WORLD_HEIGHT) + 0.1) return false;
    const pts = full || lead === null ? F.BODY_PTS : LEAD[lead];
    for (const q of pts) if (F.blocksSaucer(w.getBlock(Math.floor(pos[0] + q[0]), Math.floor(pos[1] + q[1]), Math.floor(pos[2] + q[2])))) return true;
    if (legs > 0.5 && (lead === null || lead === 2 || full)) {
      const c = Math.cos(this.ride ? this.ride.yaw : 0), s = Math.sin(this.ride ? this.ride.yaw : 0);
      for (const q of F.FOOT_PTS) {
        const x = pos[0] + c * q[0] + s * q[2], z = pos[2] - s * q[0] + c * q[2];
        if (F.blocksSaucer(w.getBlock(Math.floor(x), Math.floor(pos[1] + q[1]), Math.floor(z)))) return true;
      }
    }
    return false;
  };

  // The ground under each foot (its top), or null where there is none close below. (From as high
  // as its hull: resting on that, the ground is over where its feet would be.)
  P.groundUnderFeet = function groundUnderFeet(pos) {
    const yaw = this.ride ? this.ride.yaw : 0;
    const out = [];
    for (let i = 0; i < F.LEGS; i++) {
      const [x, z] = F.footAt(pos, yaw, i);
      out.push(this.groundAt(x, z, pos[1] + F.HULL - 0.7, pos[1] - 14));
    }
    return out;
  };

  // In place of the autopilot: forward, back and sideways from where the camera looks, up with
  // jump, down with sneak (faster with sprint, and faster still high up and in space). It lands
  // on flat enough ground when let down onto it slowly (its legs reach down to uneven ground);
  // anything it hits at speed bounces it off, unharmed.
  P.saucerManual = function saucerManual(dt, ctl) {
    const r = this.ride;
    const p = this.player;
    const dim = this.dimension || 0;
    const space = dim === 3;
    const creative = this.isCreative();
    const empty = !creative && r.fuel <= 0;
    // fuel: a unit every half minute in the air
    if (!creative && !empty) {
      r.burn = (r.burn || 0) + dt;
      if (r.burn >= 30) { r.burn -= 30; r.fuel = Math.max(0, r.fuel - 1); if (r.fuel === 0) this.ui.toast(t('saucer.outOfFuel'), 4000); }
    }
    const yaw = p.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let wx = fx * ctl.forward + rx * ctl.strafe, wz = fz * ctl.forward + rz * ctl.strafe;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    let wy = (ctl.jump ? 1 : 0) - (ctl.sneak ? 1 : 0);
    const boost = ctl.sprint ? 2.2 : 1;
    let vh, vv;
    if (space) {
      const n = this.spaceNadir();
      vh = vv = Math.max(80, Math.min(6e7, (n ? n.alt : 1e4) * 0.9)) * boost;
      // (in space, forward is wherever the camera looks, up and down too)
      const f = p.forward();
      wx = f[0] * ctl.forward + rx * ctl.strafe; wz = f[2] * ctl.forward + rz * ctl.strafe;
      wy = wy + f[1] * ctl.forward;
    } else {
      // (high over the ground: faster; by a station, its deck counts as the ground)
      const here = DIM_BODY[dim] || 'earth';
      const floor = BODIES[here].station ? STATION_Y : this.bodyBase(here);
      const high = Math.max(1, Math.min(8, 1 + (p.pos[1] - floor - 250) / 220));
      vh = 40 * boost * high;
      vv = 20 * boost * high;
    }
    if (empty) { wx *= 0.25; wz *= 0.25; wy = Math.min(wy, 0) - 0.3; }
    const k = 1 - Math.exp(-dt * (space ? 1.8 : 1.6));
    const v = p.vel;
    v[0] += (wx * vh - v[0]) * k;
    v[2] += (wz * vh - v[2]) * k;
    v[1] += (wy * vv - v[1]) * k;
    r.engine = Math.min(1, 0.35 + Math.hypot(v[0], v[2]) / (vh * 1.5) + Math.max(0, v[1]) / (vv * 1.2));
    // the heading follows the way it goes; it tips into the motion
    const hs = Math.hypot(v[0], v[2]);
    if (hs > 1) r.yaw += Math.atan2(Math.sin(Math.atan2(-v[0], -v[2]) - r.yaw), Math.cos(Math.atan2(-v[0], -v[2]) - r.yaw)) * (1 - Math.exp(-dt * 0.9));
    const along = (-Math.sin(r.yaw) * v[0] - Math.cos(r.yaw) * v[2]) / Math.max(vh, 1);
    const side = (Math.cos(r.yaw) * v[0] - Math.sin(r.yaw) * v[2]) / Math.max(vh, 1);
    r.bank = [r.bank[0] + (-0.14 * along - r.bank[0]) * k, r.bank[1] + (-0.14 * side - r.bank[1]) * k];
    if (space) {
      for (let i = 0; i < 3; i++) p.pos[i] += v[i] * dt;
      this.levelSpaceFrame(dt);
      r.legs = Math.max(0, r.legs - dt * 2);
      // close to a body: down into its world
      const n = this.spaceNadir();
      if (n && DIM_OF[n.body] !== undefined && n.alt < BODIES[n.body].top - 120) { this.landOn(n.body); this.suit = false; this.descent = false; }
      return;
    }
    // legs out near the ground; coming down onto it (not sprinting), it slows itself to land
    // softly (sprinting into it, it bounces)
    const ground = this.groundUnderFeet(p.pos);
    const below = ground.reduce((m, g) => (g === null ? m : Math.max(m, g)), -Infinity);
    const near = below > -Infinity && p.pos[1] - below < 14;
    r.legs += ((near ? 1 : 0) - r.legs) * (1 - Math.exp(-dt * 1.6));
    if (!ctl.sprint && v[1] < 0 && below > -Infinity) v[1] = Math.max(v[1], -(2.5 + Math.max(0, p.pos[1] - below) * 1.1));
    // (resting on its hull, the legs coming out onto the ground push it up onto them, a little at
    // a time, standing on the ground as they go; with no room over it, or coming down too fast
    // for them, they wait)
    r.rising = false;
    if (r.legs > 0.5 && this.saucerBlocked(p.pos, 1) && !this.saucerBlocked(p.pos, 0)) {
      const lift = below - p.pos[1];
      if (lift > 0 && lift <= F.HULL && v[1] > -9 && !this.saucerBlocked([p.pos[0], below, p.pos[2]], 1)) {
        p.pos[1] = Math.min(below, p.pos[1] + dt * 7);
        if (v[1] < 0) v[1] = 0;
        r.rising = p.pos[1] < below;
      } else r.legs = 0.5;
    }
    r.feet = r.rising ? ground.map((h) => (h === null ? 0 : p.pos[1] - h)) : null;
    // move a way at a time; whatever it runs into stops it (or, fast, bounces it back). (Caught
    // in something already, a hill it was put down against: free to move out of it.) Fast, in
    // short steps, so as not to pass through a thin wall.
    let bumped = 0;
    const caught = this.saucerBlocked(p.pos, r.legs);
    const steps = Math.min(16, Math.max(1, Math.ceil((Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])) * dt) / 0.8)));
    for (let i = 0; i < steps; i++) {
      for (const ax of [0, 2, 1]) {
        const step = (v[ax] * dt) / steps;
        if (!step) continue;
        const next = p.pos.slice();
        next[ax] += step;
        if ((caught && !(ax === 1 && step < 0)) || !this.saucerBlocked(next, r.legs, false, ax * 2 + (step > 0 ? 1 : 0))) { p.pos = next; continue; }
        const hit = Math.abs(v[ax]);
        // coming down slowly onto the ground with the legs out: landing, if it's flat enough
        if (ax === 1 && v[1] < 0 && hit < 9 && hs < 6 && r.legs > 0.5) { if (this.saucerTryLand()) return; }
        if (hit > 10) { bumped = Math.max(bumped, hit); v[ax] = -v[ax] * 0.45; } else v[ax] = 0;
      }
    }
    if (bumped) this.saucerBump(bumped);
    // up out of the air: into space, still flying ourselves
    const body = DIM_BODY[dim];
    if (body && p.pos[1] > this.bodyBase(body) + BODIES[body].top) { this.goToSpace(body); this.suit = false; }
  };

  // Set down where it is, its legs reaching down to the ground under each foot (or say why not:
  // too uneven, or no room for it).
  P.saucerTryLand = function saucerTryLand() {
    const r = this.ride;
    const p = this.player;
    const spot = this.saucerSpot(p.pos[0], p.pos[1] + 1.5, p.pos[2], r.yaw);
    if (!spot.pos || Math.abs(spot.pos[1] - p.pos[1]) > 2) {
      const tn = now();
      if (!(tn - r.unevenAt < 3)) { r.unevenAt = tn; this.ui.toast(t(spot.why === 'room' ? 'saucer.noRoom.room' : 'saucer.uneven'), 2200); }
      return false;
    }
    p.pos = spot.pos;
    p.vel = [0, 0, 0];
    r.feet = spot.feet;
    r.phase = 'landed';
    r.legs = 1;
    r.engine = 0;
    r.bank = [0, 0];
    r.waitRelease = true; // (the sneak that brought it down doesn't also climb out)
    this.saucerDust(p.pos, 70, 1);
    this.audio.saucerThud && this.audio.saucerThud(0.7);
    this.audio.play('step', 'metal', 1.2);
    this.ui.toast(t('saucer.touchdown'), 2500);
    // (a villager here sees it come down)
    this.villagersSeeArrival && this.villagersSeeArrival('saucer', p.pos);
    return true;
  };

  // Hit something: a bounce, a jolt and a clang, nothing broken.
  P.saucerBump = function saucerBump(speed) {
    const r = this.ride;
    const tn = now();
    if (tn - r.clangAt < 0.25) return; // (pushed on into a wall: one clang, not one a frame)
    r.clangAt = tn;
    this.shake = Math.max(this.shake, Math.min(1.4, speed / 22));
    this.audio.saucerThud ? this.audio.saucerThud(Math.min(1, speed / 25)) : this.audio.sfx('hit', Math.min(1, speed / 20), 0);
    this.audio.play('step', 'metal', 1.5);
    if (!(tn - r.bumpAt < 4)) { r.bumpAt = tn; this.ui.toast(t('saucer.bump'), 2200); }
  };

  P.setPhase = function setPhase(phase, dur) {
    const r = this.ride;
    r.phase = phase;
    r.t = 0;
    r.dur = dur;
    const p = this.player;
    if (phase === 'ascent' || phase === 'hopUp') { r.y0 = p.pos[1]; r.x0 = p.pos[0]; r.z0 = p.pos[2]; r.feet = null; }
  };

  // Where the trip stands: seconds left, and how far along (0..1).
  P.tripProgress = function tripProgress() {
    const r = this.ride;
    if (!r || !r.trip) return null;
    const total = r.trip.dur + COUNTDOWN;
    const done = Math.min(total, r.trip.elapsed || 0);
    return { left: Math.max(0, Math.ceil(total - done)), frac: done / total, to: r.trip.to, count: r.phase === 'countdown' ? r.dur - r.t : 0 };
  };

  // In place of Player.update while aboard: the saucer flies itself (or stands landed).
  P.saucerStep = function saucerStep(dt, ctl) {
    const r = this.ride;
    const p = this.player;
    p.onGround = r.phase === 'landed';
    p.flying = false;
    p.gliding = false;
    p.eyeHeight = 1.62;
    if (r.phase === 'manual') { this.saucerManual(dt, ctl); return; }
    p.vel = [0, 0, 0];
    if (r.phase === 'landed') return;
    r.t += dt;
    r.trip.elapsed = (r.trip.elapsed || 0) + dt;
    const u = clamp(r.t / Math.max(1e-3, r.dur), 0, 1);
    const trip = r.trip;
    const from = trip.from, to = trip.to;
    switch (r.phase) {
      case 'countdown':
        r.engine = 0.15 + 0.35 * u;
        if (u >= 1) {
          this.setPhase(trip.hop ? 'hopUp' : 'ascent', trip.dur * (trip.hop ? 0.3 : ASCENT));
          // ignition: a boom, the ground shaking, a ring of dust blown out over it
          this.audio.saucerIgnite && this.audio.saucerIgnite(1);
          this.shake = Math.max(this.shake, 1.3);
          this.saucerShockwave(p.pos);
          this.saucerPassengerSay('lift');
        }
        break;
      case 'ascent': {
        // straight up from the pad, faster and faster, out of the air
        const top = this.bodyBase(from) + BODIES[from].top + 6;
        p.pos = [r.x0, r.y0 + (top - r.y0) * Math.pow(u, 2.2), r.z0];
        r.engine = 1;
        r.legs = 1 - smooth(0, 0.12, u);
        if (u >= 1) this.saucerToSpace();
        break;
      }
      case 'cruise': {
        const T = this.spaceTime();
        const frames = { [from]: this.bodyFrameNow(from, T), [to]: this.bodyFrameNow(to, T) };
        const before = this.spacePosC();
        const posC = cruisePoint(trip, u, T, frames);
        const s = this.spaceState;
        s.origin = posC;
        p.pos = [0, 0, 0];
        this.saucerLevel(dt, posC, T);
        r.speed = len(sub(posC, before)) / Math.max(dt, 1e-3);
        r.engine = 0.75;
        if (u >= 1) this.saucerArrive();
        break;
      }
      case 'descent': {
        // down onto the pad, slowing all the way: legs out for the last of it
        const pad = trip.pad;
        const k = smooth(0, 0.5, u);
        p.pos = [r.x0 + (pad.x - r.x0) * k, pad.y + (r.y0 - pad.y) * Math.pow(1 - u, 3), r.z0 + (pad.z - r.z0) * k];
        r.legs = smooth(0.7, 0.95, u);
        r.engine = 0.55 + 0.45 * smooth(0.6, 0.85, u);
        if (u >= 1) this.saucerTouchdown();
        break;
      }
      case 'hopUp': {
        const pad = trip.pad;
        const top = Math.max(r.y0, pad.y) + 140;
        p.pos = [r.x0, r.y0 + (top - r.y0) * smooth(0, 1, u), r.z0];
        r.engine = 1;
        r.legs = 1 - smooth(0, 0.15, u);
        if (u >= 1) { r.yTop = top; this.setPhase('hopAcross', trip.dur * 0.4); r.x0 = p.pos[0]; r.z0 = p.pos[2]; }
        break;
      }
      case 'hopAcross': {
        const pad = trip.pad;
        const k = 0.5 - 0.5 * Math.cos(Math.PI * u);
        p.pos = [r.x0 + (pad.x - r.x0) * k, r.yTop, r.z0 + (pad.z - r.z0) * k];
        r.engine = 0.7;
        if (u >= 1) { this.setPhase('descent', trip.dur * 0.3); r.y0 = r.yTop; r.x0 = pad.x; r.z0 = pad.z; }
        break;
      }
      default: break;
    }
    // a slow wobble while it hovers (a big ship: gently)
    const tn = now();
    r.bank = [Math.sin(tn * 0.7) * 0.012 * r.engine, Math.sin(tn * 0.55 + 1) * 0.012 * r.engine];
    void ctl; void to;
  };

  // Out of the air: into space, the cruise ahead.
  P.saucerToSpace = function saucerToSpace() {
    const r = this.ride, trip = r.trip;
    const p = this.player;
    p.vel = [0, 0, 0];
    this.goToSpace(trip.from);
    p.vel = [0, 0, 0];
    this.suit = false;
    const T = this.spaceTime();
    trip.qD0 = toBody(trip.from, this.spacePosC(), T, this.bodyFrameNow(trip.from, T));
    // over the pad at the other end, a little below where its world takes over
    const ll = BODIES[trip.to].station || worldToLonLat(trip.to, trip.pad.x, trip.pad.z);
    trip.lonT = ll[0];
    trip.latT = ll[1];
    trip.altT = BODIES[trip.to].top - ARRIVE_BELOW_TOP;
    this.setPhase('cruise', trip.dur * CRUISE);
    this.lifeLater && this.lifeQueue && this.lifeLater(2.5, () => this.saucerPassengerSay('space'));
  };

  // Over the pad from space: down into its world.
  P.saucerArrive = function saucerArrive() {
    const r = this.ride, trip = r.trip;
    const p = this.player;
    p.vel = [0, 0, 0];
    this.landOn(trip.to);
    p.vel = [0, 0, 0];
    p.flying = false;
    this.suit = false;
    this.descent = false;
    this.setPhase('descent', trip.dur * (1 - ASCENT - CRUISE));
    r.y0 = p.pos[1]; r.x0 = p.pos[0]; r.z0 = p.pos[2];
  };

  P.saucerTouchdown = function saucerTouchdown() {
    const r = this.ride, trip = r.trip;
    const p = this.player;
    p.pos = [trip.pad.x, trip.pad.y, trip.pad.z];
    // (the legs find the ground under each foot: a pad is flat; the Earth's may not quite be)
    const spot = this.saucerSpot(p.pos[0], p.pos[1] + 1.5, p.pos[2], r.yaw);
    r.feet = spot.pos && Math.abs(spot.pos[1] - p.pos[1]) < 2 ? spot.feet : null;
    r.phase = 'landed';
    r.legs = 1;
    r.engine = 0;
    r.trip = null;
    r.speed = 0;
    this.saucerDust(p.pos, 110, 1.2);
    this.shake = Math.max(this.shake, 0.6);
    this.audio.saucerThud ? this.audio.saucerThud(1) : this.audio.sfx('explosion', 0.15, 0);
    this.ui.toast(t('saucer.arrived', { place: t('saucer.dest.' + trip.to) }) + ' ' + t('saucer.landedHint'), 5000);
    const far = trip.from !== trip.to || trip.space;
    if (trip.to !== 'earth' && far && this.addRumor) this.addRumor(trip.to);
    if (far) { r.trip = trip; this.saucerPassengerSay(trip.to === 'earth' ? 'home' : 'arrive'); r.trip = null; }
    this.villagersSeeArrival && this.villagersSeeArrival('saucer', p.pos);
  };

  // In space: the local frame turns to the nearest body's ground (so "up" for the camera and the
  // saucer is up from it), the way levelSpaceFrame does for someone flying in their suit.
  P.saucerLevel = function saucerLevel(dt, posC, T) {
    const s = this.spaceState;
    const n = nearestBody(posC, T);
    const R = BODIES[n.name].R;
    const near = smooth(R * 40, R * 1.5, n.dist);
    if (near <= 0.001) return;
    const f = this.bodyFrameNow(n.name, T);
    const pl = placeOn(n.name, posC, T, f);
    s.frame = blendFrame(s.frame, localFrame(f, pl.lon, pl.lat), Math.min(1, dt * 1.2 * near));
  };

  // ---------------------------------------------------------------- villagers aboard
  // ride.crew (and a parked saucer's crew): [{ seat, c }] (c: the villager as saved). While the
  // saucer is here, each is also a villager in the world sitting in its seat (crewEnts: uid ->
  // creature), out of the way of its usual life (`aboard`), so it can still talk and be seen.
  P.saucerSeatsUsed = function saucerSeatsUsed(holder) {
    const used = new Set();
    for (const q of holder.passengers || []) used.add(q.seat);
    for (const q of holder.crew || []) used.add(q.seat);
    return used;
  };
  P.saucerFreeSeat = function saucerFreeSeat(holder) {
    const used = this.saucerSeatsUsed(holder);
    for (let i = 0; i < F.SEATS.length; i++) if (!used.has(i)) return i;
    return -1;
  };

  // A villager takes a seat aboard our saucer (the one in our arms, or one invited).
  P.seatVillager = function seatVillager(e) {
    const r = this.ride;
    if (!r || !e || e.type !== 'villager' || e.ghost) return false;
    const seat = this.saucerFreeSeat(r);
    if (seat < 0) return false;
    r.crew = r.crew || [];
    const member = { seat, c: this.serializeCreature(e) };
    r.crew.push(member);
    this.crewEnts = this.crewEnts || new Map();
    this.crewEnts.set(member.c.uid, e);
    e.aboard = member;
    e.sitting = true;
    return true;
  };

  P.seatCarried = function seatCarried() {
    const c = this.carrying;
    if (!c || c.kind !== 'mob') return;
    const e = c.e;
    this.carrying = null;
    e.carriedBy = null;
    e.carried = null;
    if (!this.seatVillager(e)) this.ui.toast(t('saucer.noBoard.full'), 2200);
  };

  // The villagers of ours near the landed saucer, nearest first (not already aboard).
  P.villagersToInvite = function villagersToInvite() {
    const r = this.ride;
    if (!r || !this.sim) return [];
    const p = this.player.pos;
    const out = [];
    for (const e of this.sim.entities.values()) {
      if (e.type !== 'villager' || e.ghost || e.removed || e.deathTime > 0 || e.aboard || e.carriedBy) continue;
      const d = Math.hypot(e.body.pos[0] - p[0], e.body.pos[2] - p[2]);
      if (d < INVITE_RANGE && Math.abs(e.body.pos[1] - p[1]) < 24) out.push([d, e]);
    }
    return out.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  };

  // The panel's button: the villagers near are asked aboard; most come (friends always), some are
  // too scared. Beamed up into the free seats.
  P.inviteVillagers = function inviteVillagers() {
    const r = this.ride;
    if (!r || r.phase !== 'landed') return;
    const list = this.villagersToInvite();
    if (!list.length) { this.ui.toast(t('saucer.crew.none'), 2400); return; }
    let came = 0, scared = 0, spoke = 0;
    for (const e of list) {
      if (this.saucerFreeSeat(r) < 0) break;
      const soul = !this.mp && this.soulOf && e.uid ? this.soulOf(e.uid) : null;
      const friend = soul && soul.f >= 40;
      if (!friend && Math.random() < 0.22) {
        scared++;
        if (spoke < 2) { spoke++; this.askVillager(e, { event: 'trip', itemName: 'stay:moon' }); }
        continue;
      }
      const from = e.body.pos.slice();
      if (!this.seatVillager(e)) break;
      came++;
      this.saucerBeam(from, add(this.player.pos, [0, F.HULL, 0]));
      if (spoke < 2 && Math.random() < 0.7) { spoke++; this.lifeLater ? this.lifeLater(0.5 + came * 0.6, () => this.askVillager(e, { event: 'trip', itemName: 'board:moon' })) : this.askVillager(e, { event: 'trip', itemName: 'board:moon' }); }
    }
    this.audio.sfx('travel', 0.4, 0);
    this.ui.toast(t('saucer.crew.came', { n: came, scared }), 3200);
    this.ui.renderSaucer(this.saucerPanelInfo(), this.saucerChoice);
  };

  // The panel's other button: everyone aboard gets off, beamed down round the saucer, and lives
  // here now.
  P.releaseCrew = function releaseCrew(holder = this.ride, at = this.player.pos, yaw = this.ride ? this.ride.yaw : 0) {
    if (!holder || !holder.crew || !holder.crew.length) return 0;
    const list = holder.crew;
    holder.crew = [];
    const w = this.world;
    const free = (x, y, z) => !F.blocksSaucer(w.getBlock(x, y, z)) && !IS_LIQUID[w.getBlock(x, y, z)];
    const stands = (x, y, z) => F.blocksSaucer(w.getBlock(x, y - 1, z)) && free(x, y, z) && free(x, y + 1, z);
    let n = 0;
    for (const member of list) {
      let e = this.crewEnts && this.crewEnts.get(member.c.uid);
      if (!e || e.removed || !this.sim.entities.has(e.id)) e = this.loadCreature(member.c);
      if (!e) continue;
      if (this.crewEnts) this.crewEnts.delete(member.c.uid);
      e.aboard = null;
      e.sitting = false;
      // (in a ring just outside the rim, on the ground there)
      const a = yaw + (n / Math.max(1, list.length)) * Math.PI * 2;
      const out = F.RIM + 2.5 + (n % 2) * 2;
      const x = Math.floor(at[0] - Math.sin(a) * out), z = Math.floor(at[2] - Math.cos(a) * out);
      let spot = null;
      for (let y = Math.floor(at[1] + 6); y >= Math.floor(at[1] - 10) && !spot; y--) if (stands(x, y, z)) spot = [x + 0.5, y + 0.01, z + 0.5];
      spot = spot || this.groundUnder(at, a);
      this.saucerBeam(spot, add(at, [0, F.HULL, 0]));
      e.body.pos = spot.slice();
      e.prevPos = spot.slice();
      e.body.vel = [0, 0, 0];
      e.home = spot.slice(); // (it lives here now)
      if (n === 0) this.askVillager(e, { event: 'trip', itemName: 'off:' + (DIM_BODY[this.dimension || 0] || 'earth') });
      n++;
    }
    return n;
  };

  P.unloadVillagers = function unloadVillagers() {
    const r = this.ride;
    if (!r || r.phase !== 'landed') return;
    const n = this.releaseCrew();
    this.audio.sfx('travel', 0.4, 0);
    this.ui.toast(n ? t('saucer.crew.off', { n }) : t('saucer.crew.empty'), 2600);
    this.ui.renderSaucer(this.saucerPanelInfo(), this.saucerChoice);
  };

  // Each frame: every villager aboard (ours, or a parked saucer's here) sits in its seat, there
  // as a creature while the saucer is in this world.
  P.updateCrew = function updateCrew() {
    if (!this.sim) return;
    this.crewEnts = this.crewEnts || new Map();
    const live = new Set();
    const seatAll = (holder, foot, yaw) => {
      for (const member of holder.crew || []) {
        const uid = member.c && member.c.uid;
        if (!uid) continue;
        live.add(uid);
        let e = this.crewEnts.get(uid);
        if (!e || e.removed || !this.sim.entities.has(e.id)) {
          e = this.loadCreature(member.c);
          if (!e) continue;
          this.crewEnts.set(uid, e);
        }
        e.aboard = member;
        e.inRide = holder === this.ride;
        e.sitting = true;
        const s = F.seatAt(foot, yaw, member.seat);
        const y = s.pos[1] + F.SEAT_H - 0.375;
        e.body.pos = [s.pos[0], y, s.pos[2]];
        e.prevPos = e.body.pos.slice();
        e.body.vel = [0, 0, 0];
        e.yaw = e.prevYaw = e.headYaw = s.yaw;
      }
    };
    if (this.ride) seatAll(this.ride, this.player.pos, this.ride.yaw);
    for (const m of [...this.sim.entities.values()]) {
      if (m.type !== 'saucer' || m.ghost || m.removed) continue;
      if (m.deathTime > 0 && m.crew && m.crew.length) { this.releaseCrew(m, m.body.pos, m.yaw); continue; }
      if (m.crew && m.crew.length) seatAll(m, m.body.pos, m.yaw);
    }
    // (aboard a saucer that has gone: not here any more)
    for (const [uid, e] of this.crewEnts) {
      if (live.has(uid)) continue;
      this.crewEnts.delete(uid);
      if (e.aboard) { e.removed = true; this.sim.entities.delete(e.id); }
    }
  };

  // The villagers aboard leave this world with the saucer (see switchWorld): they come back as
  // creatures in the next one by updateCrew.
  P.saucerCrewOut = function saucerCrewOut() {
    if (!this.crewEnts || !this.sim) return;
    for (const e of this.crewEnts.values()) { e.removed = true; this.sim.entities.delete(e.id); }
    this.crewEnts.clear();
  };

  // A villager aboard has something to say as the trip goes on (the server's model, when there is
  // one: it is told what is happening). One of them at a time.
  P.saucerPassengerSay = function saucerPassengerSay(stage) {
    const r = this.ride;
    if (!r || !r.trip || !this.crewEnts || !this.crewEnts.size) return;
    const list = [...this.crewEnts.values()].filter((e) => e.aboard && !e.removed);
    if (!list.length) return;
    const e = list[Math.floor(Math.random() * list.length)];
    this.askVillager(e, { event: 'trip', itemName: stage + ':' + r.trip.to });
  };

  // ---------------------------------------------------------------- each frame
  // ctl: the controls as read this frame (sneak, jump...), while playing
  P.updateSaucer = function updateSaucer(dt, ctl = null) {
    const r = this.ride;
    this.updateCrew();
    if (!r && this.passengerOf) {
      // a passenger: the line saying whose saucer, and how to get off
      const pl = this.mp && this.mp.players.get(this.passengerOf.pilot);
      const show = this.state === 'playing' && !this.hudHidden;
      this.ui.setTrip(null, show ? 'aboard' : null, t('saucer.aboardHint', { name: pl ? pl.name : '' }));
      if (!this.tripShown) document.body.classList.add('in-saucer');
      this.tripShown = true;
      this.saucerFx(dt);
      this.saucerSound();
      return;
    }
    if (!r) {
      if (this.tripShown) { this.tripShown = false; this.ui.setTrip(null, null); document.body.classList.remove('in-saucer'); }
      this.saucerFx(dt);
      this.saucerSound();
      return;
    }
    if (r.resume && !this.spawnPending && this.loadingDone) this.resumeSaucer();
    if (!this.tripShown) document.body.classList.add('in-saucer');
    if (this.state === 'playing' && ctl) {
      const input = this.input, tc = input.touch;
      const panel = input.clicked.has(2) || input.wasPressed('Enter') || tc.tap || (this.pads.connected && this.pads.pressed(PAD.LT));
      // landed: sneak to climb out; right click, Enter, jump, a tap or LT for the flight panel
      if (r.phase === 'landed') {
        if (!ctl.sneak) r.waitRelease = false;
        if (ctl.sneak && !r.waitRelease) { this.leaveSaucer(); return; }
        if (panel || ctl.jumpPressed) { tc.tap = false; this.openSaucerPanel(); }
      } else if (r.phase === 'manual' && panel) {
        // (in the air: the panel, to call up the autopilot or carry on)
        tc.tap = false;
        this.openSaucerPanel();
      }
    }
    this.saucerFx(dt);
    this.saucerSound();
    const how = this.touch ? 'Touch' : this.pads.connected ? 'Pad' : 'Keys';
    const hint = r.phase === 'landed' ? t('saucer.hint' + how) : r.phase === 'manual' ? t('saucer.fly' + how) : '';
    this.ui.setTrip(this.state === 'playing' && !this.hudHidden ? this.tripProgress() : null, this.state === 'playing' && !this.hudHidden ? r.phase : null, hint);
    this.tripShown = true;
  };

  // The engines' sound: ours (we are in it, or on its deck), or the nearest other one flying.
  P.saucerSound = function saucerSound() {
    const a = this.audio;
    if (!a.setEngine) return;
    // (quiet while the game is paused or back at the title)
    if (this.state === 'paused' || this.state === 'title' || this.state === 'boot') { a.setEngine(0, 0); return; }
    const r = this.ride;
    const space = this.dimension === 3;
    if (r) { a.setEngine(r.engine, r.phase === 'landed' ? 0.25 : 1, { space, inside: true }); return; }
    let best = null, bd = Infinity;
    const cam = this.camera ? this.camera.pos : this.player.pos;
    for (const s of this.saucerModels()) {
      if (s.look.engine < 0.05) continue;
      const d = Math.hypot(s.pos[0] - cam[0], s.pos[1] + F.HULL - cam[1], s.pos[2] - cam[2]);
      if (d < bd) { bd = d; best = s; }
    }
    if (this.passengerOf) { a.setEngine(best ? best.look.engine : 0.1, 1, { space, inside: true }); return; }
    if (!best || bd > 600) { a.setEngine(0, 0); return; }
    // (another's: quieter with distance, and from where it is)
    const fade = Math.max(0, 1 - bd / 600);
    a.setEngine(best.look.engine * fade * fade, 0.6 * fade, { space, dist: bd });
  };

  // Fire, smoke and dust under every saucer whose engine is going (ours and, on a server, others').
  P.saucerFx = function saucerFx(dt) {
    const list = this.saucerModels();
    this.fxLast = this.fxLast || new Map();
    const seen = new Set();
    const space = this.dimension === 3;
    const thin = space || this.dimension === 4;
    for (const s of list) {
      const e = s.look.engine;
      const key = s.id || 'local';
      seen.add(key);
      const q = s.pos;
      const last = this.fxLast.get(key);
      this.fxLast.set(key, q.slice());
      if (e < 0.05) continue;
      // (from where it was a moment ago to where it is: an unbroken plume at any speed; the
      // flames go with the saucer's own speed as well as out of the nozzles)
      const moved = last ? Math.hypot(q[0] - last[0], q[1] - last[1], q[2] - last[2]) : 0;
      const prev = last && moved < 150 ? last : q;
      const vel = last && moved < 150 && dt > 0 ? [(q[0] - last[0]) / dt, (q[1] - last[1]) / dt, (q[2] - last[2]) / dt] : [0, 0, 0];
      const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
      // nozzles: the main engine and the eight round it
      const nozzles = [[0, 0, F.HULL - 1, 3.6, 1]];
      const ty = F.undersideAt(F.THRUSTER_R) - 2;
      for (let i = 0; i < F.THRUSTERS; i++) {
        const a = (i / F.THRUSTERS) * Math.PI * 2 + Math.PI / 8;
        const x = Math.cos(a) * F.THRUSTER_R, z = Math.sin(a) * F.THRUSTER_R;
        nozzles.push([cy * x + sy * z, -sy * x + cy * z, ty, 1.2, 0.3]);
      }
      const rate = Math.min(3, dt * 60);
      // (as bright to the eye at night as by day: see Renderer.bindPointLights)
      const eye = this.renderer && this.renderer.eyeScale !== undefined ? this.renderer.eyeScale : 1;
      for (const [nx, nz, ny, rad, share] of nozzles) {
        const n = Math.round((space ? 14 : 34) * e * share * rate);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * rad;
          const k = Math.random();
          const x = prev[0] + (q[0] - prev[0]) * k + nx, y = prev[1] + (q[1] - prev[1]) * k + ny, z = prev[2] + (q[2] - prev[2]) * k + nz;
          const hot = Math.random();
          const c0 = hot < 0.3 ? [9, 7.5, 4.5] : hot < 0.75 ? [8, 3.2, 0.7] : [5, 1.1, 0.3];
          const col = [c0[0] * eye, c0[1] * eye, c0[2] * eye];
          const down = (24 + Math.random() * 30) * e * (share > 0.5 ? 1.6 : 1);
          this.particles.spark(x + Math.cos(a) * rr, y, z + Math.sin(a) * rr, vel[0] + Math.cos(a) * 3 + (Math.random() - 0.5) * 4, vel[1] - down, vel[2] + Math.sin(a) * 3 + (Math.random() - 0.5) * 4, col,
            { life: 0.35 + Math.random() * 0.55, size: (share > 0.5 ? 1.1 : 0.6) + Math.random() * (share > 0.5 ? 1.6 : 0.8), drag: thin ? 0.3 : 1.1 });
        }
        // the glow at the heart of each
        this.particles.spark(q[0] + nx, q[1] + ny - 0.5, q[2] + nz, 0, -2, 0, [9 * e * eye, 7 * e * eye, 4.5 * e * eye], { life: 0.12, size: rad * 1.4, drag: 0 });
      }
      // smoke billowing out over the ground near it (a great ring of it, low down)
      if (!space && this.world.isChunkReady(q[0], q[2])) {
        const ground = this.world.surfaceHeight(Math.floor(q[0]), Math.floor(q[2])) + 1;
        const h = q[1] - ground;
        if (h < 70 && Math.random() < e * (1 - h / 70) * Math.min(1, dt * 50)) this.saucerDust([q[0], ground, q[2]], 5, 1 - h / 90, e * Math.pow(eye, 0.6) * (1 - h / 80));
      }
    }
    for (const k of this.fxLast.keys()) if (!seen.has(k)) this.fxLast.delete(k);
    // the rumble while lifting off
    const r = this.ride;
    if (r && (r.phase === 'countdown' || r.phase === 'ascent' || r.phase === 'hopUp')) {
      const tr = r.phase === 'countdown' ? 0.3 + 0.4 * (r.t / r.dur) : Math.max(0, 1.1 - r.t * 0.3);
      this.shake = Math.max(this.shake, tr);
    }
  };

  // A ring of dust and smoke blown out along the ground (the ground's own colour; on the Moon,
  // with no air to hold it up, a thin spray that settles at once). strength scales the ring.
  P.saucerDust = function saucerDust(pos, n, strength = 1, glow = 0) {
    const dim = this.dimension || 0;
    const airless = dim === 4;
    const tint = dim === 4 ? [0.8, 0.8, 0.8] : dim === 5 ? [0.85, 0.5, 0.34] : dim >= 6 ? [0.86, 0.86, 0.9] : [0.72, 0.7, 0.66];
    if (airless) n = Math.ceil(n * 0.5);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, rr = 6 + Math.random() * 18;
      const sp = ((airless ? 12 : 7) + Math.random() * 14) * (0.5 + strength * 0.5);
      const g = 0.85 + Math.random() * 0.25;
      this.particles.smoke(pos[0] + Math.cos(a) * rr, pos[1] + 0.5 + Math.random(), pos[2] + Math.sin(a) * rr, Math.cos(a) * sp, 0.4 + Math.random() * 1.6, Math.sin(a) * sp, [tint[0] * g, tint[1] * g, tint[2] * g],
        { life: airless ? 1.2 + Math.random() * 0.8 : 3 + Math.random() * 3.5, size: (2.2 + Math.random() * 2.8) * (0.6 + strength * 0.4), rise: airless ? -1.5 : 0.7, drag: airless ? 0.6 : 1.2, glow: glow * (1 - rr / 30) });
    }
  };

  // Ignition: a ring of dust thrown out fast over the ground all round.
  P.saucerShockwave = function saucerShockwave(pos) {
    if (this.dimension === 3) return;
    const ground = this.world.isChunkReady(pos[0], pos[2]) ? this.world.surfaceHeight(Math.floor(pos[0]), Math.floor(pos[2])) + 1 : pos[1];
    const eye = this.renderer && this.renderer.eyeScale !== undefined ? this.renderer.eyeScale : 1;
    this.saucerDust([pos[0], ground, pos[2]], 150, 2, Math.pow(eye, 0.6));
  };

  // The saucers to draw: ours, and on a server the others' (their pilots' flags say so).
  P.saucerModels = function saucerModels() {
    const out = [];
    const r = this.ride;
    const dest = r && r.trip ? r.trip.to : null;
    if (r) out.push({ pos: this.player.pos.slice(), yaw: r.yaw, look: { legs: r.legs, engine: r.engine, pitch: r.bank[0], roll: r.bank[1], feet: r.phase === 'landed' ? r.feet : null, dest }, lit: this.dimension === 3 ? 0.6 : 0 });
    if (this.mp) for (const pl of this.mp.players.values()) {
      if (!pl.pos || (pl.dim | 0) !== (this.dimension | 0) || !(pl.flags & SAUCER_FLAGS.SAUCER)) continue;
      out.push({ id: pl.id, pos: pl.pos.slice(), yaw: pl.yaw, look: { legs: pl.flags & SAUCER_FLAGS.LEGS ? 1 : 0, engine: pl.flags & SAUCER_FLAGS.THRUST ? 1 : 0.12 }, lit: this.dimension === 3 ? 0.6 : 0 });
    }
    return out;
  };

  // The light of their engines on the ground and in the air round them (the nearest four), and a
  // soft glow under the ones standing still.
  P.saucerLights = function saucerLights(cam) {
    const out = [];
    const dim = this.dimension || 0;
    // (the air the fire's glow hangs in: thin on Mars, none to speak of on the Moon)
    const air = dim === 3 || dim === 4 ? 0.02 : dim === 5 ? 0.18 : dim >= 6 ? 0.2 : 0.3;
    const tm = now();
    const add1 = (pos, engine, key) => {
      const flick = 0.85 + 0.15 * Math.sin(tm * 23 + key) * Math.sin(tm * 13.7 + key * 2);
      // (the light is under the hull: the hull, out to its rim, shades everything over it)
      if (engine > 0.04) {
        const k = (1.2 + 5 * engine) * flick;
        out.push({ pos: [pos[0], pos[1] + F.HULL - 5, pos[2]], color: [k, k * 0.24, k * 0.06], reach: 60 + 90 * engine, air, occ: [12, F.RIM, 0.5] });
      } else {
        out.push({ pos: [pos[0], pos[1] + F.HULL - 2, pos[2]], color: [0.22, 0.36, 0.5], reach: 34, air: air * 0.3, occ: [9, F.RIM, 0.25] });
      }
    };
    const list = this.saucerModels();
    list.forEach((s, i) => add1(s.pos, s.look.engine, i));
    if (this.sim) {
      for (const e of this.sim.entities.values()) if (e.type === 'saucer' && !e.removed) add1(e.body.pos, e.hurtTime > 0.2 ? 0.3 : 0, e.id);
    }
    const c = cam ? cam.pos : this.player.pos;
    out.sort((a, b) => Math.hypot(a.pos[0] - c[0], a.pos[1] - c[1], a.pos[2] - c[2]) - Math.hypot(b.pos[0] - c[0], b.pos[1] - c[1], b.pos[2] - c[2]));
    return out.slice(0, 4);
  };

  // ---------------------------------------------------------------- the camera
  // Round the saucer, where the player looks from (yaw and pitch: the mouse, a finger, the stick);
  // or (the camera key) from our seat on the bridge, under the dome.
  P.saucerCamera = function saucerCamera(dt) {
    const p = this.player;
    let r = this.ride, at = p.pos, yaw = r ? r.yaw : 0, seat = 'pilot';
    if (!r) {
      // (a passenger: round the saucer we sit on)
      r = this.passengerCam;
      const pl = this.mp && this.passengerOf && this.mp.players.get(this.passengerOf.pilot);
      at = pl && pl.pos ? pl.pos : p.pos;
      yaw = pl ? pl.yaw : 0;
      seat = this.passengerOf ? this.passengerOf.seat : 0;
    }
    const f = p.forward();
    const fovBase = this.settings.fov;
    if (this.camMode === 1) {
      // on the bridge: our eyes in our seat, looking out through the glass
      const s = F.seatAt(at, yaw, seat);
      const pos = [s.pos[0], s.pos[1] + F.SEAT_H + 1.15, s.pos[2]];
      this.fovCurrent += (fovBase * 1.05 - this.fovCurrent) * (1 - Math.exp(-dt * 3));
      return { pos, forward: f, fov: (this.fovCurrent * Math.PI) / 180 };
    }
    const centre = [at[0], at[1] + F.HULL + 6, at[2]];
    let dist = r.camDist;
    // (not into the ground, nor ever inside the saucer itself)
    const w = this.world;
    for (let d = CAM_LEAST; d <= dist; d += 1) {
      const q = [centre[0] - f[0] * d, centre[1] - f[1] * d, centre[2] - f[2] * d];
      if (F.blocksSaucer(w.getBlock(Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2])))) { dist = Math.max(CAM_LEAST, d - 1.2); break; }
    }
    r.camNow = r.camNow === undefined ? dist : dist < r.camNow ? dist : r.camNow + (dist - r.camNow) * (1 - Math.exp(-dt * 4));
    const pos = [centre[0] - f[0] * r.camNow, centre[1] - f[1] * r.camNow, centre[2] - f[2] * r.camNow];
    if (this.shake > 0) {
      const k = this.shake * this.shake * 0.35, tm = now();
      pos[0] += Math.sin(tm * 53) * k; pos[1] += Math.sin(tm * 61 + 1) * k; pos[2] += Math.sin(tm * 47 + 2) * k;
    }
    // a wide view, wider at speed
    const fov = fovBase * (1.08 + (r.phase === 'cruise' || this.dimension === 3 ? 0.1 : 0));
    this.fovCurrent += (fov - this.fovCurrent) * (1 - Math.exp(-dt * 3));
    return { pos, forward: f, fov: (this.fovCurrent * Math.PI) / 180 };
  };

  P.saucerZoom = function saucerZoom(steps) {
    const r = this.ride || this.passengerCam;
    if (!r) return;
    r.camDist = clamp((r.camDist || CAM_DIST) * Math.pow(1.18, steps), CAM_LEAST, this.dimension === 3 ? 4000 : 900);
  };

  // ---------------------------------------------------------------- saving
  P.serializeSaucer = function serializeSaucer() {
    const r = this.ride;
    if (!r) return {};
    const trip = r.trip ? { from: r.trip.from, to: r.trip.to, dur: r.trip.dur, pad: r.trip.pad } : null;
    const crew = (r.crew || []).map((m) => ({ seat: m.seat, c: m.c }));
    return { saucer: { uid: r.uid, fuel: r.fuel === Infinity ? SAUCER_TANK : r.fuel, home: r.home, hp: r.hp, yaw: r.yaw, trip, flying: r.phase === 'manual' ? 1 : 0, feet: r.feet || null, crew } };
  };

  // Back in the saucer after a load: landed, or (mid-trip) carrying on to where it was going.
  P.loadSaucer = function loadSaucer(data) {
    const s = data && data.saucer;
    this.ride = null;
    if (!s || typeof s !== 'object') return;
    const okV = (v) => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(Number.isFinite);
    const crew = (Array.isArray(s.crew) ? s.crew : []).filter((m) => m && Number.isInteger(m.seat) && m.seat >= 0 && m.seat < F.SEATS.length && m.c && m.c.type === 'villager' && typeof m.c.uid === 'string');
    this.ride = {
      uid: typeof s.uid === 'string' ? s.uid : 'l.saucer.' + Date.now().toString(36), fuel: Number.isFinite(s.fuel) ? clamp(s.fuel, 0, SAUCER_TANK) : 0,
      home: okV(s.home) ? s.home.slice(0, 3) : null, hp: Number.isFinite(s.hp) ? s.hp : 16, yaw: Number.isFinite(s.yaw) ? s.yaw : 0,
      phase: 'landed', legs: 1, engine: 0, trip: null, camDist: CAM_DIST, bank: [0, 0],
      feet: Array.isArray(s.feet) && s.feet.length === F.LEGS && s.feet.every((v) => Number.isFinite(v) && v >= 0 && v <= F.LEG_REACH + 0.01) ? s.feet.slice() : null,
      crew: crew.map((m) => ({ seat: m.seat, c: m.c })), passengers: [],
    };
    const tr = s.trip;
    if (tr && SAUCER_DESTS.includes(tr.to) && SAUCER_DESTS.includes(tr.from) && tr.pad && Number.isFinite(tr.pad.y)) this.ride.resume = { from: tr.from, to: tr.to, dur: clamp(tr.dur | 0, TRIP_MIN, TRIP_MAX), pad: tr.pad };
    // (flown by hand when saved: hovering where it was, to fly on or land)
    else if (s.flying) Object.assign(this.ride, { phase: 'manual', legs: 0, t: 0, burn: 0 });
  };

  // (once the world is there) a trip that was under way carries on from where it got to
  P.resumeSaucer = function resumeSaucer() {
    const r = this.ride;
    if (!r || !r.resume) return;
    const tr = r.resume;
    r.resume = null;
    const p = this.player;
    const dim = this.dimension || 0;
    r.trip = { from: tr.from, to: tr.to, dur: tr.dur, pad: tr.pad, hop: tr.from === tr.to, started: now(), elapsed: COUNTDOWN + tr.dur * (dim === DIM_OF[tr.to] ? 0.7 : dim === 3 ? ASCENT : 0) };
    if (dim === DIM_OF[tr.to]) {
      this.setPhase('descent', tr.dur * 0.3);
      r.y0 = p.pos[1]; r.x0 = p.pos[0]; r.z0 = p.pos[2];
    } else if (dim === 3 && this.spaceState) {
      // from here across: the nearest body is where we are coming from
      const T = this.spaceTime();
      const n = nearestBody(this.spacePosC(), T).name;
      r.trip.from = n;
      r.trip.hop = false;
      r.trip.space = true;
      this.saucerCruiseFromHere();
    } else {
      r.legs = 0;
      this.setPhase(r.trip.hop ? 'hopUp' : 'ascent', tr.dur * (r.trip.hop ? 0.3 : ASCENT));
    }
    r.engine = 0.6;
  };

  P.saucerCruiseFromHere = function saucerCruiseFromHere() {
    const r = this.ride, trip = r.trip;
    const T = this.spaceTime();
    trip.qD0 = toBody(trip.from, this.spacePosC(), T, this.bodyFrameNow(trip.from, T));
    const ll = BODIES[trip.to].station || worldToLonLat(trip.to, trip.pad.x, trip.pad.z);
    trip.lonT = ll[0];
    trip.latT = ll[1];
    trip.altT = BODIES[trip.to].top - ARRIVE_BELOW_TOP;
    this.setPhase('cruise', trip.dur * CRUISE);
  };

  // ---------------------------------------------------------------- passengers (on a server)
  // Another player's saucer under the crosshair: their id (from under it too: it beams us up).
  P.aimedSaucer = function aimedSaucer(eye, dir, reach, blockT = Infinity) {
    const mp = this.mp;
    if (!mp) return null;
    let best = null, bt = Math.min(reach, blockT);
    for (const pl of mp.players.values()) {
      if (!pl.pos || (pl.dim | 0) !== (this.dimension | 0) || !(pl.flags & SAUCER_FLAGS.SAUCER)) continue;
      const tt = F.rayHit(eye, dir, pl.pos, bt);
      if (tt !== null && tt < bt) { bt = tt; best = pl.id; }
    }
    return best;
  };

  P.askToBoard = function askToBoard(pilot) {
    if (this.ride || this.passengerOf || this.carriedBy) return;
    const tn = now();
    if (tn - this.boardAskedAt < 1.5) return; // (once is enough)
    this.boardAskedAt = tn;
    if (this.carrying) this.putDown(false);
    this.mp.net.send({ t: 'board', to: pilot });
    this.ui.toast(t('saucer.asking'), 2000);
  };

  // The pilot's side: someone asks to come aboard (or says they have got off).
  P.onBoardMessage = function onBoardMessage(m) {
    const r = this.ride;
    const who = String(m.from);
    if (m.leave) { if (r && r.passengers) r.passengers = r.passengers.filter((q) => q.id !== who); return; }
    // (asked twice: the same seat)
    const had = r && r.passengers && r.passengers.find((q) => q.id === who);
    if (had) { this.mp.net.send({ t: 'aboard', to: who, ok: 1, seat: had.seat }); return; }
    let why = '';
    if (!r) why = 'gone';
    else if (r.phase !== 'landed') why = 'flying';
    else if (this.saucerFreeSeat(r) < 0) why = 'full';
    if (why) { this.mp.net.send({ t: 'aboard', to: who, ok: 0, why }); return; }
    r.passengers = r.passengers || [];
    const seat = this.saucerFreeSeat(r);
    r.passengers.push({ id: who, seat });
    this.mp.net.send({ t: 'aboard', to: who, ok: 1, seat });
    const pl = this.mp.players.get(who);
    if (pl) this.ui.toast(t('saucer.boarded', { name: pl.name }), 2500);
  };

  // The passenger's side: the answer.
  P.onAboardMessage = function onAboardMessage(m) {
    const pilot = String(m.from);
    if (!m.ok) { this.ui.toast(t('saucer.noBoard.' + (['flying', 'full', 'gone'].includes(m.why) ? m.why : 'gone')), 2600); return; }
    if (this.ride || this.carriedBy) return;
    const from = this.player.pos.slice();
    this.passengerOf = { pilot, seat: clamp(Number(m.seat) | 0, 0, F.SEATS.length - 1) };
    this.player.flying = false;
    this.player.gliding = false;
    const pl = this.mp.players.get(pilot);
    this.passengerCam = { camDist: CAM_DIST, phase: 'aboard' };
    if (pl && pl.pos) this.saucerBeam(from, add(pl.pos, [0, F.HULL, 0]));
    this.audio.sfx('travel', 0.4, 0);
    this.ui.toast(t('saucer.aboard', { name: pl ? pl.name : '' }), 4000);
  };

  // In place of moving the player, aboard someone's saucer: in our seat on it (between the worlds
  // too, as it goes); sneak, once it has landed, to get off.
  P.followPilot = function followPilot(ctl) {
    const mp = this.mp;
    const pa = this.passengerOf;
    const pl = mp && mp.players.get(pa.pilot);
    const p = this.player;
    if (!pl || !pl.pos || !(pl.flags & SAUCER_FLAGS.SAUCER)) { this.leavePilot(true); return; }
    const dim = this.dimension || 0;
    const pdim = pl.dim | 0;
    // where the saucer is now, in our own coordinates: in space from its place over the body
    // below it (our frame turns, and our origin moves, as we go); in a world its latest place, if
    // the smoothed one hasn't caught up with a jump (into this world from another, say)
    if (dim === 3 && pl.goalB && this.spaceLocalOfBody) {
      const b = pl.atBody && pl.atBody.body === pl.goalB.body ? pl.atBody : pl.goalB;
      pl.pos = this.spaceLocalOfBody(b.body, b.q);
    } else if (!pl.goalB && pl.goal && Math.hypot(pl.goal[0] - pl.pos[0], pl.goal[1] - pl.pos[1], pl.goal[2] - pl.pos[2]) > 10) pl.pos = pl.goal.slice();
    if (pdim !== dim) {
      // the saucer has gone on into another world: after it
      if (pdim === 3) this.goToSpace(DIM_BODY[dim] || 'earth');
      else if (dim === 3) this.landOn(DIM_BODY[pdim] || 'earth');
      else this.goToSpace(DIM_BODY[dim] || 'earth');
      this.suit = false;
      this.descent = false;
      p.vel = [0, 0, 0];
      return;
    }
    const s = F.seatAt(pl.pos, pl.yaw, pa.seat);
    p.pos = s.pos;
    p.vel = [0, 0, 0];
    p.onGround = false;
    p.flying = false;
    p.fallStart = null;
    this.passengerYaw = s.yaw;
    // (in space, our frame turns to the ground below and the floating origin comes with us, as the
    // pilot's does)
    if (dim === 3 && this.spaceState) this.levelSpaceFrame(1 / 60);
    const landed = (pl.flags & SAUCER_FLAGS.LEGS) && !(pl.flags & SAUCER_FLAGS.THRUST);
    if (ctl.sneak && landed) this.leavePilot(false);
  };

  // Off the saucer: beamed down to the ground under it (or, if it went without us in mid-air,
  // coming down gently in the suit).
  P.leavePilot = function leavePilot(dropped) {
    const pa = this.passengerOf;
    if (!pa) return;
    this.passengerOf = null;
    this.passengerCam = null;
    if (this.camMode === 1) this.camMode = 0;
    const pl = this.mp && this.mp.players.get(pa.pilot);
    if (this.mp && !dropped) this.mp.net.send({ t: 'board', to: pa.pilot, leave: 1 });
    const p = this.player;
    if (pl && pl.pos && (pl.dim | 0) === (this.dimension | 0) && !dropped) {
      const spot = this.groundUnder(pl.pos, pl.yaw + pa.seat * 0.7);
      this.saucerBeam(spot, add(pl.pos, [0, F.HULL, 0]));
      p.pos = spot;
    } else this.suit = true;
    p.vel = [0, 0, 0];
  };

  // The pilot's passengers who left the server, or whose game let go of them.
  P.passengerGone = function passengerGone(id) {
    const r = this.ride;
    if (r && r.passengers) r.passengers = r.passengers.filter((q) => q.id !== id);
  };

  // ---------------------------------------------------------------- someone else's parked saucer
  // (on a server, the game that runs a parked saucer hands it over to whoever climbs in)
  P.askForSaucer = function askForSaucer(m) {
    if (!this.mp || !m.ghost) return;
    this.mp.net.send({ t: 'sgrab', to: m.owner, r: m.rid, u: typeof m.uid === 'string' ? m.uid : undefined });
  };

  P.onSaucerGrab = function onSaucerGrab(m) {
    const e = this.sim.entities.get(Number(m.r));
    if (!e || e.type !== 'saucer' || e.removed || e.deathTime > 0) { this.mp.net.send({ t: 'sgive', to: m.from, c: null }); return; }
    const c = this.serializeCreature(e);
    e.removed = true;
    this.sim.entities.delete(e.id);
    // (its villagers go with it: no longer ours to seat)
    this.updateCrew();
    this.mp.net.send({ t: 'sgive', to: m.from, c });
  };

  P.onSaucerGive = function onSaucerGive(m) {
    const c = m.c;
    if (!c || c.type !== 'saucer') { this.ui.toast(t('saucer.notYours'), 2500); return; }
    // (the copy we saw of it goes)
    for (const g of this.mp.ghosts.values()) if (g.uid === c.uid) g.removed = true;
    const e = this.loadCreature(c);
    if (!e) return;
    const me = this.me();
    if (me && Math.hypot(e.body.pos[0] - me.pos[0], e.body.pos[2] - me.pos[2]) < F.RIM + 14 && !this.ride) this.boardSaucer(e);
  };
}

// the bits of a player's flags (multiplayer.js) that show a saucer: in one, its engine going,
// its legs down
export const SAUCER_FLAGS = { SAUCER: 2048, THRUST: 4096, LEGS: 8192 };
