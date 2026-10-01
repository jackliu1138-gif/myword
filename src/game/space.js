// Space: the sky as the planets really stand (world/space.js), the view from high up and from
// space (the renderer's space pass), and travelling there:
//  - fly high enough over the overworld (creative flight, or elytra and fireworks, which push
//    harder in the thin air) and above SPACE_ALT the air ends: you are in space (dimension 3);
//  - in space you fly freely, faster the further you are from everything, towards the Moon, Mars,
//    Jupiter or Saturn (markers show where they are);
//  - come down close to the Earth, the Moon or Mars and you are over its ground (dimensions 0, 4,
//    5), falling no faster than your suit's thrusters allow, landing unhurt;
//  - on the Moon and on Mars the suit's thrusters lift you (press jump again in the air and hold
//    it): high enough up, you are in space again.
// In space the player's position is kept in a local frame (x east, y up, z south of where its
// axes were last levelled) around a floating origin; positions shared with others are in C.
// Installed as methods on Game.prototype.

import {
  BODIES, BODY_NAMES, DIM_BODY, SPACE_ALT, EARTH_R, overworldFrame, earthFrameAt, earthFrameStd, spinEarth, bodyFrame,
  positionOn, worldToLonLat, lonLatToWorld, skyView, mat3Of, leaveSurface, reachSurface, nearestBody, localFrame,
  placeOn, blendFrame, toC, fromC, v3, bodyPos, toBody, fromBody, carryWeight, relFrame, orthonormal,
} from '../world/space.js';
import { SEA_LEVEL } from '../world/blocks.js';
import { STATION_Y, STATION_PAD } from '../world/planets.js';
import { PlanetMaps } from './planetmaps.js';
import { projectToScreen } from '../net/multiplayer.js';
import { t } from '../ui/i18n.js';

const { add, sub, scale, norm, len, dot } = v3;
const smooth = (e0, e1, x) => { const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };

// the view from on high fades in over this height (overworld y)
const VIEW_FROM = 260;
const VIEW_FULL = 900;
// coming down: where the ground's dimension takes over (below each body's top, so as not to bounce)
const LAND_MARGIN = 120;
const DIM_OF = { earth: 0, moon: 4, mars: 5, jupiter: 6, saturn: 7 };
// the dimensions with ground (or a station's deck) under a body's sky
const ON_BODY = (dim) => dim === 0 || dim >= 4;
// arriving over a station: this far above its deck, over the pad
const STATION_ARRIVE = 260;

// look direction <-> yaw and pitch (as Player.forward)
const yawPitch = (f) => [Math.atan2(-f[0], -f[2]), Math.asin(Math.max(-1, Math.min(1, f[1])))];

export function installSpace(Game) {
  const P = Game.prototype;

  P.setupSpace = function setupSpace() {
    if (!this.planetMaps) this.planetMaps = new PlanetMaps(this.renderer);
  };

  // The sea's level of the overworld (the Earth's surface in space.js terms is one above it: the
  // top of the water).
  P.seaLevel = function seaLevel() {
    return (this.genVersion || 1) >= 2 ? 63 : SEA_LEVEL;
  };
  P.bodyBase = function bodyBase(body) {
    return body === 'earth' ? this.seaLevel() + 1 : BODIES[body].base;
  };

  P.spaceWorldChanged = function spaceWorldChanged() {
    this.setupSpace();
    this.planetMaps.setWorld(this.world.seed, this.genVersion || 1, this.seaLevel());
  };

  // days since the world began: the clock of the planets
  P.spaceTime = function spaceTime() {
    return (this.dayCount || 0) + (this.dayTime || 0);
  };

  // The Earth's own frame now, as last seen from its ground (spun since), or as it stands for
  // the world's middle.
  P.earthFrameNow = function earthFrameNow(T = this.spaceTime()) {
    const e = this.spaceState && this.spaceState.earth;
    if (e) return spinEarth(e.f, T - e.T0);
    return earthFrameStd(T);
  };

  // In space: the player's (or any local point's) position in C.
  P.spacePosC = function spacePosC(local = this.player.pos) {
    const s = this.spaceState;
    return add(s.origin, toC(s.frame, local));
  };

  // In space: a position in C as one in our local frame (null when not in space).
  P.spaceLocalOf = function spaceLocalOf(posC) {
    const s = this.spaceState;
    if (this.dimension !== 3 || !s) return posC.slice();
    return fromC(s.frame, sub(posC, s.origin));
  };

  // A body's own frame now (the Earth's as we last saw it from its ground, turned since).
  P.bodyFrameNow = function bodyFrameNow(name, T = this.spaceTime()) {
    return name === 'earth' ? this.earthFrameNow(T) : bodyFrame(name, T);
  };

  // Where we are in space as the coordinates of the nearest body (what others are told: the
  // ground under us is the same for everyone, whatever their own frames), and such coordinates
  // back in our local frame.
  P.spaceBodyCoords = function spaceBodyCoords(posC = this.spacePosC()) {
    const T = this.spaceTime();
    const n = nearestBody(posC, T);
    return { body: n.name, q: toBody(n.name, posC, T, this.bodyFrameNow(n.name, T)) };
  };
  P.spaceLocalOfBody = function spaceLocalOfBody(name, q) {
    const T = this.spaceTime();
    return this.spaceLocalOf(fromBody(name, q, T, this.bodyFrameNow(name, T)));
  };

  // Each frame in space, once the clock has moved on (even with a menu open): carried along by
  // the nearest body as it turns and goes round (all the way close to it, less further out: see
  // carryWeight), the view and the way we move turning with its ground.
  P.carryInSpace = function carryInSpace() {
    const s = this.spaceState;
    const T = this.spaceTime();
    const T0 = s.lastT;
    s.lastT = T;
    if (T0 === undefined || T0 === T) return;
    const posC = this.spacePosC();
    const n = nearestBody(posC, T0);
    const w = carryWeight(n.name, n.dist);
    if (w <= 0) return;
    const f0 = this.bodyFrameNow(n.name, T0), f1 = this.bodyFrameNow(n.name, T);
    const moved = fromBody(n.name, toBody(n.name, posC, T0, f0), T, f1);
    const turn = (v) => toC(f1, fromC(f0, v));
    const turned = { x: turn(s.frame.x), y: turn(s.frame.y), z: turn(s.frame.z) };
    s.frame = w >= 1 ? turned : blendFrame(s.frame, turned, w);
    s.origin = add(posC, scale(sub(moved, posC), w));
    this.player.pos = [0, 0, 0];
  };

  // In space: the nearest body, how high above it, and for the Earth the world's x, z below.
  P.spaceNadir = function spaceNadir() {
    if (this.dimension !== 3 || !this.spaceState) return null;
    const T = this.spaceTime();
    const pos = this.spacePosC();
    const n = nearestBody(pos, T);
    const out = { body: n.name, alt: n.alt, dist: n.dist, pos };
    if (n.name === 'earth' || n.name === 'moon' || n.name === 'mars') {
      const f = n.name === 'earth' ? this.earthFrameNow(T) : bodyFrame(n.name, T);
      const p = placeOn(n.name, pos, T, f);
      const [x, z] = lonLatToWorld(n.name, p.lon, p.lat);
      Object.assign(out, { x, z, lon: p.lon, lat: p.lat });
    }
    return out;
  };

  // ---------------------------------------------------------------- the sky
  // What the renderer needs of the sky for a camera at cam: the sun's and the Moon's directions,
  // the stars' frame and, when the view from on high shows, every body around.
  P.skyState = function skyState(cam) {
    const dim = this.dimension || 0;
    if (dim === 1 || dim === 2) return null;
    const T = this.spaceTime();
    let pos, local, ef, mix, refXZ = null, alt;
    if (dim === 0) {
      const [x, y, z] = cam.pos;
      local = overworldFrame(T);
      ef = earthFrameAt(x, z, T);
      const [lon, lat] = worldToLonLat('earth', x, z);
      alt = y - this.bodyBase('earth');
      pos = positionOn('earth', lon, lat, alt, T, ef).pos;
      mix = smooth(VIEW_FROM, VIEW_FULL, y);
      refXZ = [x, alt, z];
    } else if (dim === 3) {
      if (!this.spaceState) return null;
      local = this.spaceState.frame;
      pos = this.spacePosC(cam.pos);
      ef = this.earthFrameNow(T);
      mix = 1;
      const n = this.spaceNadir();
      if (n && n.body === 'earth') refXZ = [n.x, n.alt, n.z];
    } else {
      const body = DIM_BODY[dim];
      const [x, y, z] = cam.pos;
      const bf = bodyFrame(body, T);
      const [lon, lat] = worldToLonLat(body, x, z);
      const pl = positionOn(body, lon, lat, y - this.bodyBase(body), T, bf);
      pos = pl.pos;
      local = pl.local;
      ef = this.earthFrameNow(T);
      mix = 1;
    }
    const view = skyView(pos, local, T, ef);
    const starRot = mat3Of(local);
    const sky = { sun: view.sun, moon: norm(view.bodies[1].centre), starRot, space: null };
    if (mix > 0) sky.space = this.spaceViewOf(view, mix, { 4: 1, 5: 2, 6: 3, 7: 4 }[dim] || 0, starRot, refXZ);
    if (dim >= 3) {
      // in the Earth's shadow?; the Earth's light on the Moon's night
      const e = view.bodies[0];
      const toE = norm(e.centre);
      sky.earthDir = toE;
      sky.earthshine = (1 + dot(view.sun, scale(toE, -1))) / 2 * Math.min(1, (EARTH_R * 40) / Math.max(len(e.centre), 1));
      const b = dot(e.centre, view.sun);
      const closest = len(sub(e.centre, scale(view.sun, b)));
      sky.sunlit = b > 0 && closest < EARTH_R ? smooth(EARTH_R * 0.98, EARTH_R * 1.01, closest) : 1;
    }
    return sky;
  };

  P.spaceViewOf = function spaceViewOf(view, mix, home, starRot, refXZ) {
    return {
      mix, home, starRot, refXZ,
      bodies: view.bodies.map((b) => ({ centre: b.centre, R: b.R, rot: mat3Of(b.rot) })),
    };
  };

  // Each frame: the maps of the ground follow the player once high enough to see them.
  P.updateSpaceView = function updateSpaceView() {
    if (!this.planetMaps || !this.camera) return;
    if ((this.dimension || 0) === 0) {
      const [x, y, z] = this.camera.pos;
      this.planetMaps.update(x, z, y - this.seaLevel());
    } else if (this.dimension === 3) {
      const n = this.spaceNadir();
      if (n && n.body === 'earth') this.planetMaps.update(n.x, n.z, n.alt);
    } else if (this.dimension === 4 || this.dimension === 5) {
      const body = DIM_BODY[this.dimension];
      // (the gas giants' stations: their clouds need no maps)
      const [x, y, z] = this.camera.pos;
      this.planetMaps.update(x, z, y - this.bodyBase(body), body);
    }
  };

  // ---------------------------------------------------------------- travelling
  // Each frame while playing: out into space, down onto a body, the suit's help on the way down.
  P.updateSpaceTravel = function updateSpaceTravel(dt) {
    const p = this.player;
    const dim = this.dimension || 0;
    // the air thins out: flying is faster high up, rockets push harder
    const y = p.pos[1];
    p.flyBoost = dim === 0 ? 1 + Math.max(0, y - 300) / 80 : dim >= 4 ? 1 + Math.max(0, y - 400) / 80 : 1;
    p.thinAir = dim === 0 ? 1 + Math.max(0, y - 300) / 150 : 1;
    p.gravity = dim >= 4 ? BODIES[DIM_BODY[dim]].g : 1;
    p.jetpack = dim >= 4 || (!!this.suit && dim === 0 && !p.onGround);
    // (the thrusters climb faster the higher above the ground you are)
    p.thrustFloor = dim >= 6 ? STATION_Y : dim >= 4 ? this.bodyBase(DIM_BODY[dim]) + 120 : 200;
    // (the server may have set the clock since the last frame)
    if (dim === 3 && this.spaceState) this.carryInSpace();
    // (a flying saucer's autopilot takes us between the worlds itself: saucer.js)
    if (this.ride || this.passengerOf) {
      if (dim === 3 && this.spaceState) this.updateSpaceHud();
      else if (this.spaceHudShown) { this.ui.setSpaceHud(null); this.spaceHudShown = false; }
      this.ui.setReentry(0);
      return;
    }
    if (this.state !== 'playing' || this.spawnPending || this.arrival || this.sleeping) return;
    if (dim === 0 && y > 450 && !this.thinAirHinted) { this.thinAirHinted = true; this.ui.toast(t('space.thinAir'), 4000); }
    if (ON_BODY(dim)) {
      const body = DIM_BODY[dim];
      if (y > this.bodyBase(body) + BODIES[body].top) { this.goToSpace(body); return; }
      // fallen off a station: the suit's thrusters bring you back up onto its deck
      if (dim >= 6 && y < STATION_Y - 70) { this.stationRescue(); return; }
      this.updateSuit(dt);
    } else if (dim === 3 && this.spaceState) {
      const n = this.spaceNadir();
      if (n && DIM_OF[n.body] !== undefined && n.alt < BODIES[n.body].top - LAND_MARGIN) this.landOn(n.body);
      this.updateSpaceHud();
    }
    if (dim !== 3 && this.spaceHudShown) { this.ui.setSpaceHud(null); this.spaceHudShown = false; }
  };

  // Out of the air above a body into space.
  P.goToSpace = function goToSpace(body) {
    const T = this.spaceTime();
    const p = this.player;
    const base = this.bodyBase(body);
    const left = leaveSurface(body, p.pos[0], p.pos[1], p.pos[2], base, T);
    const prev = this.spaceState;
    // the Earth's frame is kept from where you left it (so it looks as it did from below)
    const earth = body === 'earth' ? { f: left.bodyFrame, T0: T } : prev && prev.earth ? prev.earth : { f: earthFrameStd(T), T0: T };
    const vel = p.vel.slice();
    const [yaw, pitch] = [p.yaw, p.pitch];
    this.spaceState = { earth, origin: left.pos, frame: left.local, from: body, lastT: T };
    this.switchWorld(3);
    p.pos = [0, 0, 0];
    p.vel = vel;
    p.yaw = yaw; p.pitch = pitch;
    p.flying = true;
    p.gliding = false;
    this.suit = true;
    this.addRumor && this.addRumor('space');
    // (in a flying saucer it says where it is going instead)
    if (!this.ride && !this.passengerOf) this.ui.toast(t('space.enter'), 3200);
    this.audio.sfx('travel', 0.5, 0);
  };

  // Down from space onto a body's ground (its dimension), carrying on as you were going.
  P.landOn = function landOn(body) {
    const T = this.spaceTime();
    const p = this.player;
    const s = this.spaceState;
    const posC = this.spacePosC();
    const bf = body === 'earth' ? this.earthFrameNow(T) : bodyFrame(body, T);
    const r = reachSurface(body, posC, T, bf);
    r.alt = Math.max(80, Math.min(BODIES[body].top - LAND_MARGIN, r.alt));
    const station = !!BODIES[body].station;
    if (station) {
      // (no ground to come down to: the station's beacon guides you to it)
      const [lon, lat] = BODIES[body].station;
      Object.assign(r, { x: STATION_PAD[0] + 0.5, z: STATION_PAD[1] + 0.5, alt: STATION_Y + STATION_ARRIVE - this.bodyBase(body), local: localFrame(bf, lon, lat) });
    }
    const fwd = fromC(r.local, toC(s.frame, p.forward()));
    const vel = fromC(r.local, toC(s.frame, p.vel));
    const sp = len(vel);
    if (sp > 80) for (let i = 0; i < 3; i++) vel[i] *= 80 / sp;
    // on the Earth alone: the clock as the sun stands where you come down (one player's world)
    if (body === 'earth' && !this.mp) {
      const up = r.local.y;
      const a = Math.atan2(-up[2], up[0]) + Math.PI / 2; // local solar time, as overworldFrame
      let day = a / (2 * Math.PI);
      day -= Math.floor(day);
      let T2 = Math.floor(T) + day;
      if (T2 - T > 0.5) T2 -= 1; else if (T - T2 > 0.5) T2 += 1;
      this.dayCount = Math.max(0, Math.floor(T2));
      this.dayTime = T2 - Math.floor(T2);
    }
    this.switchWorld(DIM_OF[body]);
    if (body !== 'earth' && this.addRumor) this.addRumor(body);
    p.pos = [r.x, this.bodyBase(body) + r.alt, r.z];
    p.vel = vel;
    [p.yaw, p.pitch] = yawPitch(fwd);
    // on the Moon, Mars and the stations the suit's thrusters bring you down (fast, slowing for
    // the ground); on the Earth its air and gravity do
    this.descent = body !== 'earth';
    p.flying = this.isCreative() && p.flying && !this.descent;
    this.suit = true;
    if (!this.ride && !this.passengerOf) this.ui.toast(t('space.land.' + body), 3200);
    this.audio.sfx('travel', 0.4, 0);
  };

  // Coming down in the suit: falling no faster than its thrusters allow (slower near the ground),
  // and landing unhurt. Over once on the ground (on the Moon and Mars the thrusters stay on).
  P.updateSuit = function updateSuit(dt) {
    const p = this.player;
    const dim = this.dimension || 0;
    // (on the Moon, Mars and the stations the suit is always on)
    if (!this.suit && dim < 4) { p.maxFall = 60; this.ui.setReentry(0); return; }
    if (p.onGround || p.inWater || p.riding) { this.suit = false; this.descent = false; p.maxFall = 60; this.ui.setReentry(0); return; }
    if (p.flying || p.gliding) { this.descent = false; return; }
    const ground = this.world.isChunkReady(p.pos[0], p.pos[2]) ? this.world.surfaceHeight(Math.floor(p.pos[0]), Math.floor(p.pos[2])) : this.bodyBase(DIM_BODY[this.dimension || 0]);
    const h = Math.max(0, p.pos[1] - ground - 1);
    if (this.descent && p.thrusting) this.descent = false; // (thrusting up: you fly yourself)
    if (this.descent) {
      // coming down from space: the thrusters push you down fast and slow you for the ground,
      // eight seconds or so from the top whatever the gravity
      const want = -Math.min(300, 6 + h * 0.8);
      p.vel[1] += (want - p.vel[1]) * (1 - Math.exp(-dt * 5));
      p.maxFall = 320;
    } else {
      const vmax = 4 + h * 0.25;
      // (high up, falling faster than air would let you near the ground)
      p.maxFall = Math.max(60, Math.min(260, vmax));
      if (p.vel[1] < -vmax) p.vel[1] += (-vmax - p.vel[1]) * (1 - Math.exp(-dt * 4));
    }
    // glowing hot through the air on the way down from space
    const hot = dim === 0 || dim === 5 ? smooth(30, 90, -p.vel[1]) * smooth(250, 900, p.pos[1]) : 0;
    this.ui.setReentry(hot);
  };

  // Fallen off a station into the clouds: back onto its pad.
  P.stationRescue = function stationRescue() {
    const p = this.player;
    p.pos = [STATION_PAD[0] + 0.5, STATION_Y + 4, STATION_PAD[1] + 0.5];
    p.vel = [0, 0, 0];
    p.gliding = false;
    this.ui.toast(t('space.rescue'), 3500);
    this.audio.sfx('travel', 0.4, 0);
  };

  // ---------------------------------------------------------------- flying in space
  // In place of Player.update while in space: thrusters in the direction you look (and up and
  // down), the speed growing with the distance to the nearest body, no gravity.
  P.spaceFlight = function spaceFlight(dt, ctl) {
    const p = this.player;
    const n = this.spaceNadir();
    const vmax = Math.max(30, Math.min(6e7, (n ? n.alt : 1e4) * 0.9)) * (ctl.sprint ? 2.5 : 1);
    const f = p.forward();
    const right = [Math.cos(p.yaw), 0, -Math.sin(p.yaw)];
    let w = add(add(scale(f, ctl.forward), scale(right, ctl.strafe)), [0, (ctl.jump ? 1 : 0) - (ctl.sneak ? 1 : 0), 0]);
    const wl = len(w);
    if (wl > 1) w = scale(w, 1 / wl);
    const k = 1 - Math.exp(-dt * (wl > 0.01 ? 1.8 : 1.1));
    for (let i = 0; i < 3; i++) p.vel[i] += (w[i] * vmax - p.vel[i]) * k;
    // never faster than the distance to the nearest body allows (braking as you come in), and
    // never more than a fraction of it in one step
    const alt = n ? Math.max(n.alt, 1) : 1e4;
    const cap = Math.max(30, alt * 1.2) * (ctl.sprint ? 2.5 : 1);
    const sp = len(p.vel);
    if (sp > cap) p.vel = scale(p.vel, cap / sp);
    const step = len(p.vel) * dt;
    const f2 = step > alt * 0.3 ? (alt * 0.3) / step : 1;
    for (let i = 0; i < 3; i++) p.pos[i] += p.vel[i] * dt * f2;
    p.onGround = false;
    p.flying = true;
    p.gliding = false;
    p.eyeHeight += (1.62 - p.eyeHeight) * (1 - Math.exp(-dt * 10));
    this.levelSpaceFrame(dt);
  };

  // The local frame slowly turns to the nearest body's ground (so close to the Moon "up" is up
  // from the Moon), keeping where you are, how you move and where you look; the floating origin
  // follows you.
  P.levelSpaceFrame = function levelSpaceFrame(dt) {
    const s = this.spaceState;
    const p = this.player;
    const T = this.spaceTime();
    const posC = this.spacePosC();
    const n = nearestBody(posC, T);
    const near = smooth(n.dist > 0 ? BODIES[n.name].R * 40 : 1, BODIES[n.name].R * 1.5, n.dist);
    if (near > 0.001) {
      const f = n.name === 'earth' ? this.earthFrameNow(T) : bodyFrame(n.name, T);
      const pl = placeOn(n.name, posC, T, f);
      const target = localFrame(f, pl.lon, pl.lat);
      const fwdC = toC(s.frame, p.forward()), velC = toC(s.frame, p.vel);
      s.frame = blendFrame(s.frame, target, Math.min(1, dt * 0.8 * near));
      const fwd = fromC(s.frame, fwdC);
      [p.yaw, p.pitch] = yawPitch(fwd);
      p.vel = fromC(s.frame, velC);
      s.origin = posC;
      p.pos = [0, 0, 0];
    } else if (len(p.pos) > 4000) {
      s.origin = posC;
      p.pos = [0, 0, 0];
    }
  };

  // ---------------------------------------------------------------- the space HUD
  // Where the Earth, the Moon, Mars, Jupiter and Saturn are, how far, and how high you are.
  P.updateSpaceHud = function updateSpaceHud() {
    const cam = this.camera;
    if (!cam || !this.spaceState || this.hudHidden) { this.ui.setSpaceHud(null); return; }
    const T = this.spaceTime();
    const posC = this.spacePosC(cam.pos);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const marks = [];
    for (const name of BODY_NAMES) {
      const c = sub(this.spaceBodyPos(name, T), posC);
      const d = len(c) - BODIES[name].R;
      const dirL = norm(fromC(this.spaceState.frame, c));
      const at = projectToScreen(cam, add(cam.pos, scale(dirL, 1000)), w, h);
      marks.push({ name, at, dist: d });
    }
    const n = this.spaceNadir();
    this.ui.setSpaceHud({ marks, alt: n ? n.alt : 0, body: n ? n.body : 'earth', speed: len(this.player.vel) });
    this.spaceHudShown = true;
  };

  P.spaceBodyPos = function spaceBodyPos(name, T) {
    return bodyPos(name, T);
  };

  // ---------------------------------------------------------------- saving
  P.serializeSpace = function serializeSpace() {
    const s = this.spaceState;
    if (!s) return {};
    const out = { earth: { f: s.earth.f, T0: s.earth.T0 }, origin: s.origin, frame: s.frame, from: s.from };
    if (this.dimension === 3) {
      // where we are over the nearest body and which way we face there: on a server the world's
      // clock goes on without us, the body turning and moving on, and we come back over it
      const T = this.spaceTime();
      const posC = this.spacePosC();
      const n = nearestBody(posC, T);
      const f = this.bodyFrameNow(n.name, T);
      out.at = { body: n.name, q: toBody(n.name, posC, T, f), frame: relFrame(f, s.frame) };
    }
    return { space: out };
  };

  // (before the clock is set: the time is the save's)
  P.loadSpace = function loadSpace(data) {
    const s = data && data.space;
    const okV = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
    const okF = (f) => f && okV(f.x) && okV(f.y) && okV(f.z);
    this.spaceState = null;
    if (!(s && okF(s.frame) && okV(s.origin) && s.earth && okF(s.earth.f) && Number.isFinite(s.earth.T0))) return;
    const st = this.spaceState = { earth: { f: s.earth.f, T0: s.earth.T0 }, origin: s.origin, frame: s.frame, from: s.from || 'earth' };
    const at = s.at;
    if (data.dimension === 3 && at && BODY_NAMES.includes(at.body) && okV(at.q) && okF(at.frame)) {
      const T = (Number.isInteger(data.dayCount) ? data.dayCount : 0) + (Number.isFinite(data.dayTime) ? data.dayTime : 0);
      const f = at.body === 'earth' ? spinEarth(st.earth.f, T - st.earth.T0) : bodyFrame(at.body, T);
      st.origin = fromBody(at.body, at.q, T, f);
      st.frame = orthonormal({ x: toC(f, at.frame.x), y: toC(f, at.frame.y), z: toC(f, at.frame.z) });
      st.lastT = T;
      st.atOrigin = true; // (the player stands at the origin)
    }
  };
}

export { VIEW_FROM, VIEW_FULL };
