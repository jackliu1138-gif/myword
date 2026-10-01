// Flying saucers: a sci-fi saucer of iron, quartz and glass with a ring of lights.
//  - Put down from its item (creative has it; in survival it is crafted, and its tank takes coal,
//    blaze rods or lava), it stands on its legs. Right click it to climb in; holding fuel, right
//    click fills its tank instead.
//  - The flight panel: where to (the Earth, the Moon, Mars, the stations over Jupiter and Saturn)
//    and how long the trip should take (half a minute, a minute, three minutes, or as long as you
//    like, to watch the view). The autopilot does the rest: a countdown, fire, smoke and a roar
//    at lift-off, up out of the air, round the planet and across space, and down onto the fixed
//    launch pad there: on the Earth the place the saucer was set down (its own pad), on the Moon
//    and Mars the pad in the middle of their worlds, on the stations their landing pads.
//  - While it flies the camera swings freely round it (look about to turn it; the wheel, or the
//    buttons on the trip panel, bring it closer or take it further out).
//  - Landed, sneak to climb out (the saucer stays where it is), or right click for another trip.
// While flown, a saucer is part of its pilot: it goes where they go, between the worlds too.
// Parked, it is a creature that stays (sim/entities.js). Installed as methods on Game.prototype.

import {
  BODIES, DIM_BODY, bodyPos, positionOn, worldToLonLat, toBody, fromBody, v3, rotate, localFrame, nearestBody, placeOn, blendFrame,
} from '../world/space.js';
import { STATION_Y, STATION_PAD, MoonGenerator, MarsGenerator } from '../world/planets.js';
import { BLOCK, IS_SOLID, IS_LIQUID } from '../world/blocks.js';
import { ITEM, itemDef, saucerFuel, SAUCER_TANK } from '../sim/items.js';
import { SAUCER_LEG, SAUCER_SEAT, SAUCER_RIM } from '../render/saucer.js';
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
  const E = add(cD, scale(toward, RD + hD)), F = add(cT, scale(toward, -(RT + hT)));
  const k = (u - a) / (b - a);
  return add(E, scale(sub(F, E), 0.5 - 0.5 * Math.cos(Math.PI * k)));
}

export function installSaucer(Game) {
  const P = Game.prototype;

  // ---------------------------------------------------------------- placing and boarding
  P.placeSaucer = function placeSaucer(hit) {
    if (!hit) return false;
    if (this.dimension === 1 || this.dimension === 2) { this.ui.toast(t('saucer.noPlace'), 2600); return false; }
    const f = this.player.forward();
    const m = this.sim.spawnMob('saucer', hit.x + 0.5, hit.y + 1, hit.z + 0.5);
    m.yaw = m.prevYaw = Math.atan2(-f[0], -f[2]);
    m.persistent = true;
    // (on the Earth, where it is first set down is its own launch pad)
    if (!this.dimension) m.home = [hit.x + 0.5, hit.y + 1, hit.z + 0.5];
    m.fuel = this.isCreative() ? SAUCER_TANK : 0;
    if (!this.isCreative()) this.inventory.consume(this.selected);
    this.audio.play('place', 'metal');
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
    this.ride = {
      uid, fuel: this.isCreative() ? SAUCER_TANK : m.fuel || 0, home: Array.isArray(m.home) ? m.home.slice(0, 3) : null, hp: m.health,
      yaw: m.yaw, phase: 'landed', legs: 1, engine: 0, trip: null, camDist: 13, bank: [0, 0],
    };
    m.removed = true;
    this.sim.entities.delete(m.id);
    p.pos = m.body.pos.slice();
    p.vel = [0, 0, 0];
    p.flying = false;
    p.gliding = false;
    this.camMode = 0;
    this.audio.sfx('doorOpen', 0.5, 0);
    this.openSaucerPanel();
  };

  // Climbing out (landed only): the saucer stays parked where it is.
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
    if (Number.isFinite(r.hp)) m.health = Math.max(1, r.hp);
    this.ride = null;
    this.audio.setEngine(0, 0);
    // out beside it, on the ground
    const w = this.world;
    let spot = null;
    for (let k = 0; k < 8 && !spot; k++) {
      const a = r.yaw + Math.PI / 2 + (k * Math.PI) / 4;
      const x = Math.floor(at[0] - Math.sin(a) * (SAUCER_RIM + 1)), z = Math.floor(at[2] - Math.cos(a) * (SAUCER_RIM + 1));
      for (let y = Math.floor(at[1] + 2); y >= Math.floor(at[1] - 3); y--) {
        if (IS_SOLID[w.getBlock(x, y - 1, z)] && !IS_SOLID[w.getBlock(x, y, z)] && !IS_SOLID[w.getBlock(x, y + 1, z)]) { spot = [x + 0.5, y + 0.01, z + 0.5]; break; }
      }
    }
    p.pos = spot || [at[0], at[1] + 3, at[2]];
    p.vel = [0, 0, 0];
    this.audio.sfx('doorClose', 0.5, 0);
    return true;
  };

  // ---------------------------------------------------------------- the flight panel
  P.bodyHere = function bodyHere() {
    return DIM_BODY[this.dimension || 0] || null;
  };

  // The launch pad of a body: { x, y, z } (the saucer's foot on it), or null (the Earth, for a
  // saucer that has none).
  P.padOf = function padOf(body) {
    if (body === 'earth') { const h = this.ride && this.ride.home; return h ? { x: h[0], y: h[1], z: h[2] } : null; }
    if (body === 'jupiter' || body === 'saturn') return { x: STATION_PAD[0] + 0.5, y: STATION_Y + 1, z: STATION_PAD[1] + 0.5 };
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
      else if (body === here && !space && Math.hypot(pad.x - p[0], pad.z - p[2]) < 4 && Math.abs(pad.y - p[1]) < 4) why = 'here';
      else if (!creative && r.fuel < cost) why = 'fuel';
      return { body, cost, why, home: body === here };
    });
    return { fuel: creative ? null : r.fuel, max: SAUCER_TANK, dests, landed: r.phase === 'landed', flying: r.phase === 'manual', here };
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
    if (this.mp && !r.trip.hop && this.carrying && this.carrying.kind === 'mob') {
      const e = this.carrying.e;
      if (e.type === 'villager') this.askVillager(e, { event: 'trip', itemName: 'stay:' + dest });
      this.putDown(false);
    }
    // (already in the air: no countdown; already in space: straight across)
    if (this.dimension === 3) { r.trip.space = true; r.trip.elapsed = COUNTDOWN + dur * ASCENT; this.saucerCruiseFromHere(); }
    else if (airborne) { r.legs = 0; this.setPhase(r.trip.hop ? 'hopUp' : 'ascent', dur * (r.trip.hop ? 0.3 : ASCENT)); }
    else this.setPhase('countdown', COUNTDOWN);
    this.ui.toast(t(airborne || this.dimension === 3 ? 'saucer.launchAir' : 'saucer.launch', { place: t('saucer.dest.' + dest) }), 2600);
    return true;
  };

  // ---------------------------------------------------------------- a villager along for the ride
  // The one we carry (in our arms, in the dome) has something to say as the trip goes on (the
  // server's model, when there is one: it is told what is happening).
  P.saucerPassengerSay = function saucerPassengerSay(stage) {
    const c = this.carrying;
    const r = this.ride;
    if (!c || c.kind !== 'mob' || c.e.type !== 'villager' || !r || !r.trip) return;
    this.askVillager(c.e, { event: 'trip', itemName: stage + ':' + r.trip.to });
  };

  // ---------------------------------------------------------------- flying it yourself
  P.flySaucer = function flySaucer() {
    const r = this.ride;
    if (!r || (r.phase !== 'landed' && r.phase !== 'manual')) return;
    if (!this.isCreative() && r.fuel <= 0) { this.ui.toast(t('saucer.why.fuel'), 2400); return; }
    this.closeSaucerPanel();
    if (r.phase === 'landed') { r.phase = 'manual'; r.t = 0; r.burn = 0; this.player.vel = [0, 4, 0]; this.ui.toast(t('saucer.manualHint'), 6000); }
  };

  // Where a point of the saucer is (from its foot, its heading turned in), and whether it is in
  // something solid. The points: round the rim, round the bottom of the hull, the top of the dome,
  // and (legs down) the feet.
  const RIM_PTS = [], HULL_PTS = [], FEET = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; RIM_PTS.push([Math.cos(a) * 2.55, SAUCER_LEG + 0.64, Math.sin(a) * 2.55]); }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; HULL_PTS.push([Math.cos(a) * 1.5, SAUCER_LEG + 0.05, Math.sin(a) * 1.5]); }
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + Math.PI / 2; FEET.push([Math.cos(a) * 1.45, 0.02, Math.sin(a) * 1.45]); }
  const BODY_PTS = [...RIM_PTS, ...HULL_PTS, [0, SAUCER_LEG + 2.45, 0], [0, SAUCER_LEG - 0.15, 0]];

  P.saucerBlocked = function saucerBlocked(pos, legs) {
    const w = this.world;
    const pts = legs > 0.5 ? BODY_PTS.concat(FEET) : BODY_PTS;
    for (const q of pts) if (IS_SOLID[w.getBlock(Math.floor(pos[0] + q[0]), Math.floor(pos[1] + q[1]), Math.floor(pos[2] + q[2]))]) return true;
    return false;
  };

  // The ground under each foot (its top), or null where there is none close below.
  P.groundUnderFeet = function groundUnderFeet(pos) {
    const w = this.world;
    const out = [];
    for (const q of FEET.concat([[0, 0, 0]])) {
      const x = Math.floor(pos[0] + q[0]), z = Math.floor(pos[2] + q[2]);
      let top = null;
      for (let y = Math.floor(pos[1] + 0.5); y >= Math.floor(pos[1] - 6); y--) {
        const b = w.getBlock(x, y, z);
        if (IS_SOLID[b] || IS_LIQUID[b]) { top = y + 1; break; }
      }
      out.push(top);
    }
    return out;
  };

  // In place of the autopilot: forward, back and sideways from where the camera looks, up with
  // jump, down with sneak (faster with sprint, and faster still high up and in space). It lands
  // on flat ground when let down onto it slowly; anything it hits at speed bounces it off,
  // unharmed.
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
      vh = vv = Math.max(60, Math.min(6e7, (n ? n.alt : 1e4) * 0.9)) * boost;
      // (in space, forward is wherever the camera looks, up and down too)
      const f = p.forward();
      wx = f[0] * ctl.forward + rx * ctl.strafe; wz = f[2] * ctl.forward + rz * ctl.strafe;
      wy = wy + f[1] * ctl.forward;
    } else {
      // (high over the ground: faster; by a station, its deck counts as the ground)
      const here = DIM_BODY[dim] || 'earth';
      const floor = BODIES[here].station ? STATION_Y : this.bodyBase(here);
      const high = Math.max(1, Math.min(8, 1 + (p.pos[1] - floor - 250) / 220));
      vh = 26 * boost * high;
      vv = 14 * boost * high;
    }
    if (empty) { wx *= 0.25; wz *= 0.25; wy = Math.min(wy, 0) - 0.3; }
    const k = 1 - Math.exp(-dt * (space ? 1.8 : 2.4));
    const v = p.vel;
    v[0] += (wx * vh - v[0]) * k;
    v[2] += (wz * vh - v[2]) * k;
    v[1] += (wy * vv - v[1]) * k;
    r.engine = Math.min(1, 0.35 + Math.hypot(v[0], v[2]) / (vh * 1.5) + Math.max(0, v[1]) / (vv * 1.2));
    // the heading follows the way it goes; it tips into the motion
    const hs = Math.hypot(v[0], v[2]);
    if (hs > 1) r.yaw += Math.atan2(Math.sin(Math.atan2(-v[0], -v[2]) - r.yaw), Math.cos(Math.atan2(-v[0], -v[2]) - r.yaw)) * (1 - Math.exp(-dt * 1.5));
    const along = (-Math.sin(r.yaw) * v[0] - Math.cos(r.yaw) * v[2]) / Math.max(vh, 1);
    const side = (Math.cos(r.yaw) * v[0] - Math.sin(r.yaw) * v[2]) / Math.max(vh, 1);
    r.bank = [r.bank[0] + (-0.22 * along - r.bank[0]) * k, r.bank[1] + (-0.22 * side - r.bank[1]) * k];
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
    const near = ground.some((g) => g !== null && p.pos[1] - g < 6);
    r.legs += ((near ? 1 : 0) - r.legs) * (1 - Math.exp(-dt * 3));
    const below = ground.reduce((m, g) => (g === null ? m : Math.max(m, g)), -Infinity);
    if (!ctl.sprint && v[1] < 0 && below > -Infinity) v[1] = Math.max(v[1], -(2 + Math.max(0, p.pos[1] - below) * 1.5));
    // (the legs coming out onto the ground it sits on lift it onto them; with no room, they wait)
    if (r.legs > 0.5 && this.saucerBlocked(p.pos, 1) && !this.saucerBlocked(p.pos, 0)) {
      const feet = ground.slice(0, 3).filter((g) => g !== null);
      const top = feet.length ? Math.max(...feet) : null;
      if (top !== null && top > p.pos[1] && top - p.pos[1] < SAUCER_LEG + 0.2 && !this.saucerBlocked([p.pos[0], top, p.pos[2]], 1)) p.pos[1] = top;
      else r.legs = 0.5;
    }
    // move a way at a time; whatever it runs into stops it (or, fast, bounces it back). (Caught
    // in something already, leaves or a wall it was put down against: free to move out of it.)
    // (fast, in short steps: not through a thin wall)
    let bumped = 0;
    const caught = this.saucerBlocked(p.pos, r.legs);
    const steps = Math.min(16, Math.max(1, Math.ceil((Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])) * dt) / 0.8)));
    for (let i = 0; i < steps; i++) {
      for (const ax of [0, 2, 1]) {
        const step = (v[ax] * dt) / steps;
        if (!step) continue;
        const next = p.pos.slice();
        next[ax] += step;
        if ((caught && !(ax === 1 && step < 0)) || !this.saucerBlocked(next, r.legs)) { p.pos = next; continue; }
        const hit = Math.abs(v[ax]);
        // coming down slowly onto the ground with the legs out: landing, if it's flat
        if (ax === 1 && v[1] < 0 && hit < 7 && hs < 5) { if (this.saucerTryLand(i ? this.groundUnderFeet(p.pos) : ground)) return; }
        if (hit > 8) { bumped = Math.max(bumped, hit); v[ax] = -v[ax] * 0.45; } else v[ax] = 0;
      }
    }
    if (bumped) this.saucerBump(bumped);
    // up out of the air: into space, still flying ourselves
    const body = DIM_BODY[dim];
    if (body && p.pos[1] > this.bodyBase(body) + BODIES[body].top) { this.goToSpace(body); this.suit = false; }
  };

  // Set down on flat ground (the feet within a block of each other), or say why not.
  P.saucerTryLand = function saucerTryLand(ground) {
    const r = this.ride;
    const p = this.player;
    const feet = ground.slice(0, 3);
    if (feet.some((g) => g === null)) return false;
    const hi = Math.max(...feet), lo = Math.min(...feet);
    if (hi - lo > 1.01) {
      const tn = now();
      if (!(tn - r.unevenAt < 3)) { r.unevenAt = tn; this.ui.toast(t('saucer.uneven'), 2200); }
      return false;
    }
    p.pos[1] = hi;
    p.vel = [0, 0, 0];
    r.phase = 'landed';
    r.legs = 1;
    r.engine = 0;
    r.bank = [0, 0];
    r.waitRelease = true; // (the sneak that brought it down doesn't also climb out)
    this.saucerDust(p.pos, 24);
    this.audio.sfx('step', 0.6, 0);
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
    this.shake = Math.max(this.shake, Math.min(1.2, speed / 25));
    this.audio.sfx('hit', Math.min(1, speed / 20), 0);
    this.audio.play('step', 'metal', 1.5);
    if (!(tn - r.bumpAt < 4)) { r.bumpAt = tn; this.ui.toast(t('saucer.bump'), 2200); }
  };

  P.setPhase = function setPhase(phase, dur) {
    const r = this.ride;
    r.phase = phase;
    r.t = 0;
    r.dur = dur;
    const p = this.player;
    if (phase === 'ascent' || phase === 'hopUp') { r.y0 = p.pos[1]; r.x0 = p.pos[0]; r.z0 = p.pos[2]; }
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
        if (u >= 1) { this.setPhase(trip.hop ? 'hopUp' : 'ascent', trip.dur * (trip.hop ? 0.3 : ASCENT)); this.saucerPassengerSay('lift'); }
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
        const top = Math.max(r.y0, pad.y) + 90;
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
    // banking with the way it goes (and a slow wobble while it hovers)
    const tn = now();
    r.bank = [Math.sin(tn * 0.9) * 0.03 * r.engine, Math.sin(tn * 0.7 + 1) * 0.03 * r.engine];
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
    r.phase = 'landed';
    r.legs = 1;
    r.engine = 0;
    r.trip = null;
    r.speed = 0;
    this.saucerDust(p.pos, 46);
    this.shake = Math.max(this.shake, 0.35);
    this.audio.sfx('explosion', 0.15, 0);
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

  // ---------------------------------------------------------------- each frame
  // ctl: the controls as read this frame (sneak, jump...), while playing
  P.updateSaucer = function updateSaucer(dt, ctl = null) {
    const r = this.ride;
    if (!r && this.passengerOf) {
      // a passenger: the line saying whose saucer, and how to get off
      const pl = this.mp && this.mp.players.get(this.passengerOf.pilot);
      const show = this.state === 'playing' && !this.hudHidden;
      this.ui.setTrip(null, show ? 'aboard' : null, t('saucer.aboardHint', { name: pl ? pl.name : '' }));
      if (!this.tripShown) document.body.classList.add('in-saucer');
      this.tripShown = true;
      this.saucerFx(dt);
      return;
    }
    if (!r) {
      if (this.tripShown) { this.tripShown = false; this.ui.setTrip(null, null); this.audio.setEngine(0, 0); document.body.classList.remove('in-saucer'); }
      this.saucerFx(dt);
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
    this.audio.setEngine(r.engine * (this.dimension === 3 ? 0.35 : 1), r.phase === 'landed' ? 0.25 : 1);
    const how = this.touch ? 'Touch' : this.pads.connected ? 'Pad' : 'Keys';
    const hint = r.phase === 'landed' ? t('saucer.hint' + how) : r.phase === 'manual' ? t('saucer.fly' + how) : '';
    this.ui.setTrip(this.state === 'playing' && !this.hudHidden ? this.tripProgress() : null, this.state === 'playing' && !this.hudHidden ? r.phase : null, hint);
    this.tripShown = true;
  };

  // Fire and smoke under every saucer whose engine is going (ours and, on a server, others').
  P.saucerFx = function saucerFx(dt) {
    const list = this.saucerModels();
    this.fxLast = this.fxLast || new Map();
    const seen = new Set();
    for (const s of list) {
      const e = s.look.engine;
      const key = s.id || 'local';
      seen.add(key);
      const q = s.pos;
      const last = this.fxLast.get(key);
      this.fxLast.set(key, q.slice());
      if (e < 0.05) continue;
      const base = [q[0], q[1] + SAUCER_LEG - 0.15, q[2]];
      const space = this.dimension === 3;
      // (from where it was a moment ago to where it is: an unbroken plume at any speed; the
      // flames go with the saucer's own speed as well as out of the nozzles)
      const moved = last ? Math.hypot(q[0] - last[0], q[1] - last[1], q[2] - last[2]) : 0;
      const from = last && moved < 60 ? [last[0], last[1] + SAUCER_LEG - 0.15, last[2]] : base;
      const vel = last && moved < 60 && dt > 0 ? [(q[0] - last[0]) / dt, (q[1] - last[1]) / dt, (q[2] - last[2]) / dt] : [0, 0, 0];
      // flames: white-hot at the nozzles, then orange, then red, pouring down
      const n = Math.round((space ? 10 : 26) * e * Math.min(3, dt * 60));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * 1.3;
        const k = Math.random();
        const x = from[0] + (base[0] - from[0]) * k, y = from[1] + (base[1] - from[1]) * k, z = from[2] + (base[2] - from[2]) * k;
        const hot = Math.random();
        const col = hot < 0.3 ? [8, 7, 4.5] : hot < 0.75 ? [7, 3, 0.7] : [4.5, 1, 0.3];
        this.particles.spark(x + Math.cos(a) * rr, y, z + Math.sin(a) * rr, vel[0] + Math.cos(a) * 2 + (Math.random() - 0.5) * 2.5, vel[1] - (16 + Math.random() * 18) * e, vel[2] + Math.sin(a) * 2 + (Math.random() - 0.5) * 2.5, col, { life: 0.3 + Math.random() * 0.45, size: 0.35 + Math.random() * 0.55, drag: space || this.dimension === 4 ? 0.3 : 1.1 });
      }
      // the glow at the heart of the engine
      this.particles.spark(base[0], base[1] - 0.3, base[2], 0, -2, 0, [9 * e, 8 * e, 6 * e], { life: 0.12, size: 1.6, drag: 0 });
      // smoke billowing out over the ground near it
      if (!space && this.world.isChunkReady(q[0], q[2])) {
        const ground = this.world.surfaceHeight(Math.floor(q[0]), Math.floor(q[2])) + 1;
        const h = q[1] - ground;
        if (h < 30 && Math.random() < e * (1 - h / 30) * Math.min(1, dt * 40)) this.saucerDust([q[0], ground, q[2]], 3);
      }
    }
    for (const k of this.fxLast.keys()) if (!seen.has(k)) this.fxLast.delete(k);
    // the rumble while lifting off
    const r = this.ride;
    if (r && (r.phase === 'countdown' || r.phase === 'ascent' || r.phase === 'hopUp')) {
      const tr = r.phase === 'countdown' ? 0.25 + 0.35 * (r.t / r.dur) : Math.max(0, 0.9 - r.t * 0.35);
      this.shake = Math.max(this.shake, tr);
    }
  };

  // a ring of dust and smoke blown out along the ground (the ground's own colour; on the Moon,
  // with no air to hold it up, a thin spray that settles at once)
  P.saucerDust = function saucerDust(pos, n) {
    const dim = this.dimension || 0;
    const airless = dim === 4;
    const tint = dim === 4 ? [0.8, 0.8, 0.8] : dim === 5 ? [0.85, 0.5, 0.34] : dim >= 6 ? [0.86, 0.86, 0.9] : [0.72, 0.7, 0.66];
    if (airless) n = Math.ceil(n * 0.5);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (airless ? 6 : 3) + Math.random() * 6;
      const g = 0.85 + Math.random() * 0.25;
      this.particles.smoke(pos[0] + Math.cos(a) * 1.5, pos[1] + 0.3, pos[2] + Math.sin(a) * 1.5, Math.cos(a) * sp, 0.4 + Math.random() * 1.2, Math.sin(a) * sp, [tint[0] * g, tint[1] * g, tint[2] * g], { life: airless ? 0.9 + Math.random() * 0.6 : 2 + Math.random() * 2, size: 0.8 + Math.random() * 0.9, rise: airless ? -1.2 : 0.6 });
    }
  };

  // The saucers to draw: ours, and on a server the others' (their pilots' flags say so).
  P.saucerModels = function saucerModels() {
    const out = [];
    const r = this.ride;
    if (r) out.push({ pos: this.player.pos.slice(), yaw: r.yaw, look: { legs: r.legs, engine: r.engine, pitch: r.bank[0], roll: r.bank[1] }, lit: this.dimension === 3 ? 0.6 : 0 });
    if (this.mp) for (const pl of this.mp.players.values()) {
      if (!pl.pos || (pl.dim | 0) !== (this.dimension | 0) || !(pl.flags & SAUCER_FLAGS.SAUCER)) continue;
      out.push({ id: pl.id, pos: pl.pos.slice(), yaw: pl.yaw, look: { legs: pl.flags & SAUCER_FLAGS.LEGS ? 1 : 0, engine: pl.flags & SAUCER_FLAGS.THRUST ? 1 : 0 }, lit: this.dimension === 3 ? 0.6 : 0 });
    }
    return out;
  };

  // ---------------------------------------------------------------- the camera
  // Round the saucer, where the player looks from (yaw and pitch: the mouse, a finger, the stick).
  P.saucerCamera = function saucerCamera(dt) {
    const p = this.player;
    let r = this.ride, at = p.pos;
    if (!r) {
      // (a passenger: round the saucer we sit on)
      r = this.passengerCam;
      const pl = this.mp && this.passengerOf && this.mp.players.get(this.passengerOf.pilot);
      at = pl && pl.pos ? pl.pos : p.pos;
    }
    const centre = [at[0], at[1] + SAUCER_LEG + 0.9, at[2]];
    const f = p.forward();
    let dist = r.camDist;
    // (not into the ground, nor ever inside the saucer itself)
    const w = this.world;
    const least = SAUCER_RIM + 2.5;
    for (let d = least; d <= dist; d += 0.5) {
      const q = [centre[0] - f[0] * d, centre[1] - f[1] * d, centre[2] - f[2] * d];
      if (IS_SOLID[w.getBlock(Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2]))]) { dist = Math.max(least, d - 0.6); break; }
    }
    r.camNow = r.camNow === undefined ? dist : dist < r.camNow ? dist : r.camNow + (dist - r.camNow) * (1 - Math.exp(-dt * 4));
    const pos = [centre[0] - f[0] * r.camNow, centre[1] - f[1] * r.camNow, centre[2] - f[2] * r.camNow];
    if (this.shake > 0) {
      const k = this.shake * this.shake * 0.12, tm = now();
      pos[0] += Math.sin(tm * 53) * k; pos[1] += Math.sin(tm * 61 + 1) * k; pos[2] += Math.sin(tm * 47 + 2) * k;
    }
    // a wide view, wider at speed
    const fov = this.settings.fov * (1.08 + (r.phase === 'cruise' || this.dimension === 3 ? 0.1 : 0));
    this.fovCurrent += (fov - this.fovCurrent) * (1 - Math.exp(-dt * 3));
    return { pos, forward: f, fov: (this.fovCurrent * Math.PI) / 180 };
  };

  P.saucerZoom = function saucerZoom(steps) {
    const r = this.ride || this.passengerCam;
    if (!r) return;
    r.camDist = clamp(r.camDist * Math.pow(1.18, steps), SAUCER_RIM + 2.5, this.dimension === 3 ? 400 : 120);
  };

  // ---------------------------------------------------------------- saving
  P.serializeSaucer = function serializeSaucer() {
    const r = this.ride;
    if (!r) return {};
    const trip = r.trip ? { from: r.trip.from, to: r.trip.to, dur: r.trip.dur, pad: r.trip.pad } : null;
    return { saucer: { uid: r.uid, fuel: r.fuel === Infinity ? SAUCER_TANK : r.fuel, home: r.home, hp: r.hp, yaw: r.yaw, trip, flying: r.phase === 'manual' ? 1 : 0 } };
  };

  // Back in the saucer after a load: landed, or (mid-trip) carrying on to where it was going.
  P.loadSaucer = function loadSaucer(data) {
    const s = data && data.saucer;
    this.ride = null;
    if (!s || typeof s !== 'object') return;
    const okV = (v) => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(Number.isFinite);
    this.ride = {
      uid: typeof s.uid === 'string' ? s.uid : 'l.saucer.' + Date.now().toString(36), fuel: Number.isFinite(s.fuel) ? clamp(s.fuel, 0, SAUCER_TANK) : 0,
      home: okV(s.home) ? s.home.slice(0, 3) : null, hp: Number.isFinite(s.hp) ? s.hp : 16, yaw: Number.isFinite(s.yaw) ? s.yaw : 0,
      phase: 'landed', legs: 1, engine: 0, trip: null, camDist: 13, bank: [0, 0],
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
  // Seats on the deck round the dome: [sideways, forwards] from the saucer's middle; the
  // passenger's feet go there (sitting on the hull).
  const SEATS = [[-1.95, 0.2], [1.95, 0.2], [0, 1.95]];
  const seatAt = (pos, yaw, i) => {
    const [x, z] = SEATS[i % SEATS.length];
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    return [pos[0] + c * x + sn * z, pos[1] + SAUCER_LEG + 0.45, pos[2] - sn * x + c * z];
  };

  // Another player's saucer under the crosshair (a ray against its disc and dome): their id.
  P.aimedSaucer = function aimedSaucer(eye, dir, reach, blockT = Infinity) {
    const mp = this.mp;
    if (!mp) return null;
    let best = null, bt = Math.min(reach, blockT);
    for (const pl of mp.players.values()) {
      if (!pl.pos || (pl.dim | 0) !== (this.dimension | 0) || !(pl.flags & SAUCER_FLAGS.SAUCER)) continue;
      for (let k = 0.5; k < bt; k += 0.25) {
        const x = eye[0] + dir[0] * k - pl.pos[0], y = eye[1] + dir[1] * k - pl.pos[1], z = eye[2] + dir[2] * k - pl.pos[2];
        if (y > 0.4 && y < SAUCER_LEG + 2.6 && x * x + z * z < (y < SAUCER_LEG + 1.2 ? SAUCER_RIM * SAUCER_RIM : 1.6)) { bt = k; best = pl.id; break; }
      }
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
    else if ((r.passengers || []).length >= SEATS.length) why = 'full';
    if (why) { this.mp.net.send({ t: 'aboard', to: who, ok: 0, why }); return; }
    r.passengers = r.passengers || [];
    let seat = 0;
    while (r.passengers.some((q) => q.seat === seat)) seat++;
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
    this.passengerOf = { pilot, seat: Number(m.seat) | 0 };
    this.player.flying = false;
    this.player.gliding = false;
    const pl = this.mp.players.get(pilot);
    this.passengerCam = { camDist: 14, phase: 'aboard' };
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
    p.pos = seatAt(pl.pos, pl.yaw, pa.seat);
    p.vel = [0, 0, 0];
    p.onGround = false;
    p.flying = false;
    p.fallStart = null;
    this.passengerYaw = pl.yaw;
    // (in space, our frame turns to the ground below and the floating origin comes with us, as the
    // pilot's does)
    if (dim === 3 && this.spaceState) this.levelSpaceFrame(1 / 60);
    const landed = (pl.flags & SAUCER_FLAGS.LEGS) && !(pl.flags & SAUCER_FLAGS.THRUST);
    if (ctl.sneak && landed) this.leavePilot(false);
  };

  // Off the saucer: beside it on the ground (or, if it went without us in mid-air, coming down
  // gently in the suit).
  P.leavePilot = function leavePilot(dropped) {
    const pa = this.passengerOf;
    if (!pa) return;
    this.passengerOf = null;
    this.passengerCam = null;
    const pl = this.mp && this.mp.players.get(pa.pilot);
    if (this.mp && !dropped) this.mp.net.send({ t: 'board', to: pa.pilot, leave: 1 });
    const p = this.player;
    if (pl && pl.pos && (pl.dim | 0) === (this.dimension | 0) && !dropped) {
      const a = pl.yaw + Math.PI / 2 + pa.seat * 2;
      const w = this.world;
      const x = Math.floor(pl.pos[0] - Math.sin(a) * (SAUCER_RIM + 1)), z = Math.floor(pl.pos[2] - Math.cos(a) * (SAUCER_RIM + 1));
      for (let y = Math.floor(pl.pos[1] + 3); y >= Math.floor(pl.pos[1] - 4); y--) {
        if (IS_SOLID[w.getBlock(x, y - 1, z)] && !IS_SOLID[w.getBlock(x, y, z)] && !IS_SOLID[w.getBlock(x, y + 1, z)]) { p.pos = [x + 0.5, y + 0.01, z + 0.5]; break; }
      }
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
    if (me && Math.hypot(e.body.pos[0] - me.pos[0], e.body.pos[2] - me.pos[2]) < 12 && !this.ride) this.boardSaucer(e);
  };

  void itemDef; void BLOCK;
}

// the bits of a player's flags (multiplayer.js) that show a saucer: in one, its engine going,
// its legs down
export const SAUCER_FLAGS = { SAUCER: 2048, THRUST: 4096, LEGS: 8192 };
