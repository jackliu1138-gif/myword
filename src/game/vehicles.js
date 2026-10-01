// Getting about: boats and minecarts (placed from their items, ridden, broken back into items),
// rails that join up with their neighbours as they are laid, horses, elytra with firework boosts
// (spark trails off both wings, a wider view, the rush of air), pressure plates that open the
// doors beside them while someone stands on them, TNT, and the End's gateways.
// Installed as methods on Game.prototype.

import { BLOCK, BLOCKS, IS_SOLID, IS_RAIL, RAIL_SHAPES, FACING, railShapeFor, MODEL_OF, MODELS_BY_NAME } from '../world/blocks.js';
import { ITEM, itemDef } from '../sim/items.js';
import { ARMOR_REF } from '../sim/inventory.js';
import { t } from '../ui/i18n.js';

const M = MODELS_BY_NAME;
const DIRS = FACING; // 0 north, 1 east, 2 south, 3 west
// the rail shape that slopes up towards each direction
const UP_SHAPE = [4, 2, 5, 3];

export function installVehicles(Game) {
  const P = Game.prototype;

  // ---------------------------------------------------------------- placing vehicles
  // A boat goes on water (or anywhere, if you like pushing it); a minecart on a rail.
  P.placeVehicle = function placeVehicle(hit, def) {
    if (!hit) return false;
    const w = this.world;
    const f = this.player.forward();
    let x = hit.x + 0.5, y = hit.y + 1, z = hit.z + 0.5;
    if (def.kind === 'minecart') {
      if (!IS_RAIL[hit.block]) return false;
      y = hit.y + 0.0625;
    } else if (hit.liquid) y = hit.y + 1;
    const m = this.sim.spawnMob(def.kind === 'boat' ? 'boat' : 'minecart', x, y, z);
    m.yaw = Math.atan2(-f[0], -f[2]);
    m.persistent = true;
    if (!this.isCreative()) this.inventory.consume(this.selected);
    this.audio.play('place', def.kind === 'boat' ? 'wood' : 'metal');
    this.swing = 1;
    void w;
    return true;
  };

  // ---------------------------------------------------------------- riding
  P.mount = function mount(m) {
    if (this.player.riding) this.dismount();
    const me = this.me();
    const name = (me && (me.name || me.id)) || 'local';
    m.rider = name;
    m.control = { forward: 0, strafe: 0, jump: false, yaw: m.yaw };
    this.player.riding = m;
    this.player.flying = false;
    this.player.gliding = false;
    this.ui.toast(t('toast.dismount'), 2500);
    this.audio.sfx(m.type === 'horse' ? 'horse' : m.type === 'minecart' ? 'minecart' : 'splash', 0.5, 0);
  };

  P.dismount = function dismount() {
    const p = this.player;
    const m = p.riding;
    if (!m) return;
    p.riding = null;
    m.rider = null;
    m.control = null;
    // step off beside it
    const w = this.world;
    const base = m.body.pos;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
      const x = Math.floor(base[0] + dx * (m.def.hw + 0.6)), z = Math.floor(base[2] + dz * (m.def.hw + 0.6));
      for (let y = Math.floor(base[1] + 1); y >= Math.floor(base[1] - 1); y--) {
        if (IS_SOLID[w.getBlock(x, y - 1, z)] && !IS_SOLID[w.getBlock(x, y, z)] && !IS_SOLID[w.getBlock(x, y + 1, z)]) {
          p.pos = [x + 0.5, y + 0.01, z + 0.5];
          p.vel = [0, 0, 0];
          return;
        }
      }
    }
    p.pos = [base[0], base[1] + m.def.h + 0.1, base[2]];
  };

  // Each frame while riding: the controls go to what we ride, and we sit in it.
  P.updateRiding = function updateRiding(ctl) {
    const p = this.player;
    const m = p.riding;
    if (!m) return;
    if (m.removed || m.deathTime > 0 || !this.sim.entities.has(m.id)) { p.riding = null; return; }
    if (ctl.sneak) { this.dismount(); return; }
    m.control = { forward: ctl.forward, strafe: ctl.strafe, jump: ctl.jump, yaw: p.yaw, sprint: ctl.sprint };
    const seat = m.type === 'horse' ? 1.0 : m.def.seat || 0.3;
    const b = m.body;
    const a = this.sim.alpha || 0;
    const q = [m.prevPos[0] + (b.pos[0] - m.prevPos[0]) * a, m.prevPos[1] + (b.pos[1] - m.prevPos[1]) * a, m.prevPos[2] + (b.pos[2] - m.prevPos[2]) * a];
    p.pos = [q[0], q[1] + seat - 0.35, q[2]];
    p.vel = [0, 0, 0];
  };

  // ---------------------------------------------------------------- rails
  // A new rail turns to join the rails next to it (and they turn to join it).
  P.railShapeAt = function railShapeAt(x, y, z, look) {
    const w = this.world;
    const ends = [];
    let up = -1;
    for (let f = 0; f < 4; f++) {
      const [dx, dz] = DIRS[f];
      if (IS_RAIL[w.getBlock(x + dx, y, z + dz)] || IS_RAIL[w.getBlock(x + dx, y - 1, z + dz)]) ends.push(f);
      else if (IS_RAIL[w.getBlock(x + dx, y + 1, z + dz)]) { ends.push(f); up = f; }
    }
    if (up >= 0) return UP_SHAPE[up]; // a slope up towards that rail
    if (ends.length >= 2) {
      const s = railShapeFor(ends[0], ends[1]);
      if (s >= 0) return s;
    }
    if (ends.length === 1) return ends[0] & 1 ? 1 : 0;
    return look & 1 ? 1 : 0;
  };

  P.afterRailPlaced = function afterRailPlaced(x, y, z) {
    const w = this.world;
    // neighbours with a free end turn towards the new rail
    for (let f = 0; f < 4; f++) {
      const [dx, dz] = DIRS[f];
      for (const dy of [0, -1, 1]) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        const b = w.getBlock(nx, ny, nz);
        if (!IS_RAIL[b]) continue;
        const shape = RAIL_SHAPES[w.getState(nx, ny, nz) & 15];
        const back = (f + 2) & 3;
        if (shape && shape.ends.includes(back)) continue;
        // how many of its ends already lead somewhere
        const linked = shape.ends.filter((e) => { const [ex, ez] = DIRS[e]; return IS_RAIL[w.getBlock(nx + ex, ny, nz + ez)] || IS_RAIL[w.getBlock(nx + ex, ny - 1, nz + ez)] || IS_RAIL[w.getBlock(nx + ex, ny + 1, nz + ez)]; });
        if (linked.length >= 2) continue;
        const keep = linked[0];
        let s = keep !== undefined && keep !== back ? railShapeFor(keep, back) : back & 1 ? 1 : 0;
        if (dy === -1) s = UP_SHAPE[back]; // the new rail is up a step: slope up to it
        if (s >= 0 && b === BLOCK.POWERED_RAIL && s >= 6) continue; // powered rails don't curve
        if (s >= 0) w.setBlock(nx, ny, nz, b, { state: s });
      }
    }
  };

  // ---------------------------------------------------------------- pressure plates and doors
  // Something standing on a plate presses it; it opens the doors around it (iron doors only open
  // this way) and lights TNT under it. Let go, and they close again a moment later.
  P.updatePlates = function updatePlates(dt) {
    const w = this.world;
    if (!w) return;
    this.plates = this.plates || new Map();
    const pressed = new Set();
    const onPlate = (pos, stone) => {
      const x = Math.floor(pos[0]), y = Math.floor(pos[1] + 0.05), z = Math.floor(pos[2]);
      const b = w.getBlock(x, y, z);
      if (b === BLOCK.OAK_PRESSURE_PLATE || (b === BLOCK.STONE_PRESSURE_PLATE && stone)) pressed.add(x + ',' + y + ',' + z);
    };
    const me = this.me();
    if (me && !me.dead && !this.player.riding) onPlate(this.player.pos, true);
    for (const e of this.sim.entities.values()) {
      if (e.removed || !e.body) continue;
      if (e.kind === 'mob' && !e.def.fixed) onPlate(e.body.pos, true);
      else if (e.kind === 'item' || e.kind === 'arrow') onPlate(e.body.pos, false);
    }
    // press the new ones
    for (const k of pressed) {
      const st = this.plates.get(k);
      if (st) { st.release = 1; continue; }
      const [x, y, z] = k.split(',').map(Number);
      this.plates.set(k, { x, y, z, release: 1 });
      w.setBlock(x, y, z, w.getBlock(x, y, z), { state: 1 });
      this.audio.sfx('plate', 0.5, 0);
      this.plateDoors(x, y, z, true);
      for (let dy = 1; dy <= 3; dy++) if (w.getBlock(x, y - dy, z) === BLOCK.TNT) { w.setBlock(x, y - dy, z, 0); this.sim.primeTnt(x, y - dy, z, 1.5); }
    }
    // let go of the others after a moment
    for (const [k, st] of this.plates) {
      if (pressed.has(k)) continue;
      st.release -= dt;
      if (st.release > 0) continue;
      this.plates.delete(k);
      const b = w.getBlock(st.x, st.y, st.z);
      if (b === BLOCK.OAK_PRESSURE_PLATE || b === BLOCK.STONE_PRESSURE_PLATE) w.setBlock(st.x, st.y, st.z, b, { state: 0 });
      this.audio.sfx('plate', 0.35, 0);
      this.plateDoors(st.x, st.y, st.z, false);
    }
  };

  P.plateDoors = function plateDoors(x, y, z, open) {
    const w = this.world;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) {
      const b = w.getBlock(x + dx, y + dy, z + dz);
      if (MODEL_OF[b] !== M.door && MODEL_OF[b] !== M.gate && MODEL_OF[b] !== M.trapdoor) continue;
      const s = w.getState(x + dx, y + dy, z + dz);
      if (!!(s & 4) === open) continue;
      if (MODEL_OF[b] === M.door) {
        if (s & 8) continue; // the lower half opens both
        this.setDoorOpen(x + dx, y + dy, z + dz, b, open);
      } else w.setBlock(x + dx, y + dy, z + dz, b, { state: open ? s | 4 : s & ~4 });
    }
  };

  P.setDoorOpen = function setDoorOpen(x, y, z, b, open) {
    const w = this.world;
    const s = w.getState(x, y, z);
    const flip = (v) => (open ? v | 4 : v & ~4);
    w.setBlock(x, y, z, b, { state: flip(s) });
    if (w.getBlock(x, y + 1, z) === b) w.setBlock(x, y + 1, z, b, { state: flip(w.getState(x, y + 1, z)) });
    this.audio.sfx(open ? 'doorOpen' : 'doorClose', 0.6, 0);
  };

  // ---------------------------------------------------------------- elytra and fireworks
  P.updateFlight = function updateFlight(dt) {
    const p = this.player;
    const chest = this.inventory.armor[1];
    const d = chest && itemDef(chest.id);
    const could = p.canGlide;
    // (no air to hold them up in space and on the Moon)
    p.canGlide = !!(d && d.elytra && (chest.wear || 0) < d.durability - 1) && this.dimension !== 3 && this.dimension !== 4;
    // the first time they go on: how to fly them
    if (p.canGlide && !could && !this.elytraHinted) { this.elytraHinted = true; this.ui.toast(t('toast.elytraOn'), 9000); }
    if (this.boost > 0) { p.boost = Math.max(p.boost, this.boost); this.boost = 0; }
    // the wings opening
    if (p.gliding && !this.wasGliding) this.audio.sfx('elytra', 0.7, 0);
    this.wasGliding = p.gliding;
    const speed = Math.hypot(p.vel[0], p.vel[1], p.vel[2]);
    this.audio.setWind(p.gliding ? Math.min(1, speed / 30) : 0);
    if (!p.gliding) { this.glideTime = 0; this.prevTips = null; this.wasBoosting = false; return; }
    // the elytra wear down as they are flown
    this.glideTime = (this.glideTime || 0) + dt;
    if (this.glideTime >= 1 && !this.isCreative()) { this.glideTime = 0; if (this.inventory.wear(ARMOR_REF + 1, 1)) this.toolBroke(d); }
    this.glideTrail(this, p.pos, p.yaw, p.forward(), speed, p.boost > 0, p.vel);
  };

  // The trail behind someone gliding, laid along the way they came since the last frame (so it
  // stays unbroken at any frame rate): faint streaks off the wingtips when fast, and while a
  // rocket pushes, a stream of colour-cycling sparks off both wings that twinkle and fall away,
  // with the rocket's own fire between them. st keeps the last wingtips.
  P.glideTrail = function glideTrail(st, pos, yaw, f, speed, boosting, vel) {
    const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const base = [pos[0], pos[1] + 0.5, pos[2]];
    const tips = [-1, 1].map((side) => [base[0] + right[0] * side * 0.95 - f[0] * 0.3, base[1] + 0.25, base[2] + right[2] * side * 0.95 - f[2] * 0.3]);
    tips.push([base[0] - f[0] * 0.7, base[1] - 0.35, base[2] - f[2] * 0.7]); // the rocket, at the feet
    const prev = st.prevTips;
    st.prevTips = tips;
    if (boosting && !st.wasBoosting) {
      // the kick: a ring of sparks blown out all around
      const up = [0, 1, 0];
      const side2 = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];
      const sl = Math.hypot(...side2) || 1;
      const s = side2.map((v) => v / sl);
      const u = [s[1] * f[2] - s[2] * f[1], s[2] * f[0] - s[0] * f[2], s[0] * f[1] - s[1] * f[0]];
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        const dir = [s[0] * Math.cos(a) + u[0] * Math.sin(a), s[1] * Math.cos(a) + u[1] * Math.sin(a), s[2] * Math.cos(a) + u[2] * Math.sin(a)];
        this.particles.spark(base[0] - f[0], base[1], base[2] - f[2], dir[0] * 7 + vel[0] * 0.3, dir[1] * 7 + vel[1] * 0.3, dir[2] * 7 + vel[2] * 0.3, hsv(i / 28, 0.6, 5), { life: 0.55, size: 0.06, drag: 3.5 });
      }
    }
    st.wasBoosting = boosting;
    if (!prev || (!boosting && speed <= 12)) return;
    const now = performance.now() / 1000;
    const travelled = Math.hypot(tips[0][0] - prev[0][0], tips[0][1] - prev[0][1], tips[0][2] - prev[0][2]);
    // one spark every so far along the way (closer together behind a rocket)
    const n = Math.max(1, Math.min(boosting ? 36 : 10, Math.round(travelled / (boosting ? 0.28 : 0.6))));
    for (let k = 0; k < 3; k++) {
      if (k === 2 && !boosting) break;
      const a = prev[k], b = tips[k];
      for (let i = 0; i < n; i++) {
        const q = (i + Math.random()) / n;
        const x = a[0] + (b[0] - a[0]) * q, y = a[1] + (b[1] - a[1]) * q, z = a[2] + (b[2] - a[2]) * q;
        const j = () => (Math.random() - 0.5) * 1.4;
        if (k === 2) {
          // the rocket's fire: hot white-gold, short-lived
          this.particles.spark(x, y, z, j() - f[0] * 3, j() - f[1] * 3, j() - f[2] * 3, [7, 5, 2.2], { life: 0.25 + Math.random() * 0.2, size: 0.07, drag: 2.5 });
        } else if (boosting) {
          const hue = (now * 0.9 + q * 0.05 + (k ? 0.5 : 0)) % 1;
          this.particles.spark(x, y, z, j() * 0.6, j() * 0.6 - 0.3, j() * 0.6, hsv(hue, 0.8, 5.5), { life: 0.7 + Math.random() * 0.7, size: 0.065, gravity: 1.8, drag: 1.4, twinkle: true });
        } else {
          this.particles.spark(x, y, z, 0, 0, 0, [0.85, 0.9, 1.05], { life: 0.35, size: 0.03, drag: 0 });
        }
      }
    }
  };

  // the other players gliding (their flags say so): the same trail behind them
  P.remoteTrails = function remoteTrails(dt) {
    const mp = this.mp;
    if (!mp) return;
    for (const r of mp.players.values()) {
      if (!r.pos || (r.dim | 0) !== (this.dimension | 0) || !(r.flags & 64)) { r.trail = null; continue; }
      const st = r.trail || (r.trail = { last: r.pos.slice() });
      const v = [(r.pos[0] - st.last[0]) / Math.max(dt, 1e-3), (r.pos[1] - st.last[1]) / Math.max(dt, 1e-3), (r.pos[2] - st.last[2]) / Math.max(dt, 1e-3)];
      st.last = r.pos.slice();
      const cp = Math.cos(r.pitch || 0);
      const f = [-Math.sin(r.yaw) * cp, Math.sin(r.pitch || 0), -Math.cos(r.yaw) * cp];
      this.glideTrail(st, r.pos, r.yaw, f, Math.hypot(...v), !!(r.flags & 512), v);
    }
  };

  P.onFireworkBurst = function onFireworkBurst(e) {
    this.particles.fireworkBurst(e.pos, e.colors);
    const ear = this.camera ? this.camera.pos : this.player.pos;
    const d = Math.hypot(e.pos[0] - ear[0], e.pos[1] - ear[1], e.pos[2] - ear[2]);
    this.audio.sfx('fireworkBlast', Math.max(0.15, 1 - d / 90), 0);
    setTimeout(() => this.audio.sfx('fireworkTwinkle', Math.max(0.1, 0.8 - d / 90), 0), 350);
  };

  P.onFireworkTrail = function onFireworkTrail(e) {
    for (let i = 0; i < 3; i++) this.particles.spark(e.pos[0], e.pos[1], e.pos[2], (Math.random() - 0.5) * 1.2, -1 - Math.random(), (Math.random() - 0.5) * 1.2, [5, 3.6, 1.6], { life: 0.5, size: 0.05, gravity: 2, drag: 1 });
  };

  // ---------------------------------------------------------------- the End's gateways
  // After the dragon: a gateway beside the exit portal throws you out to the far islands, where
  // the cities are; the one there brings you back.
  P.updateGateways = function updateGateways(dt) {
    if (this.dimension !== 2) return;
    const w = this.world;
    const es = this.endState;
    if (es && es.dragonDead && this.world.genVersion >= 2) {
      const gx = 0, gy = 75, gz = 90;
      if (w.isChunkReady(gx, gz) && w.getBlock(gx, gy, gz) !== BLOCK.END_GATEWAY) {
        w.setBlock(gx, gy, gz, BLOCK.END_GATEWAY);
        w.setBlock(gx, gy - 1, gz, BLOCK.BEDROCK);
        w.setBlock(gx, gy + 1, gz, BLOCK.BEDROCK);
      }
    }
    this.gatewayCooldown = Math.max(0, (this.gatewayCooldown || 0) - dt);
    if (this.gatewayCooldown > 0) return;
    const p = this.player.pos;
    const inGate = (y) => w.getBlock(Math.floor(p[0]), Math.floor(y), Math.floor(p[2])) === BLOCK.END_GATEWAY;
    if (!inGate(p[1] + 0.2) && !inGate(p[1] + 1.2)) return;
    this.gatewayCooldown = 3;
    const g = w.generator;
    let dest;
    if (Math.hypot(p[0], p[2]) < 200) {
      const a = Math.atan2(p[2], p[0]);
      const city = g.findCity && g.findCity(Math.cos(a) * 800, Math.sin(a) * 800, 900);
      if (!city) { this.ui.toast(t('toast.noCity'), 2500); return; }
      dest = [city.gate[0] + 0.5, city.gate[1] + 2, city.gate[2] - 2.5];
    } else dest = [0.5, 70, 86.5];
    this.player.pos = dest;
    this.player.vel = [0, 0, 0];
    this.player.gliding = false;
    this.arrival = { dim: 2, until: performance.now() + 15000 };
    this.audio.sfx('teleport', 0.8, 0);
  };

  // ---------------------------------------------------------------- the camera: first person, behind, in front
  P.cycleCamera = function cycleCamera() {
    this.camMode = ((this.camMode || 0) + 1) % 3;
    this.camDist = 0.4; // (it pulls back from the head, rather than jumping)
    this.ui.toast(t('toast.cam' + this.camMode), 1200);
    this.ui.setCameraMode(this.camMode);
  };

  // The camera behind (1) or in front of (2) the player: out to 4 blocks, closer when a wall is in
  // the way (at once), easing back out when it clears.
  P.thirdPerson = function thirdPerson(pos, fwd, dt = 0.016) {
    const mode = this.camMode || 0;
    if (!mode) return null;
    const back = mode === 1 ? -1 : 1;
    let room = 4;
    // stop short of walls (checked a little to each side too, so it doesn't peek through corners)
    const side = [-fwd[2], 0, fwd[0]];
    const sl = Math.hypot(side[0], side[2]) || 1;
    for (let d = 0.5; d <= 4.2 && room === 4; d += 0.2) {
      for (const o of [0, -0.25, 0.25]) {
        const x = pos[0] + fwd[0] * d * back + (side[0] / sl) * o, y = pos[1] + fwd[1] * d * back, z = pos[2] + fwd[2] * d * back + (side[2] / sl) * o;
        if (IS_SOLID[this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))]) { room = Math.max(0.3, d - 0.4); break; }
      }
    }
    const cur = this.camDist ?? room;
    this.camDist = room < cur ? room : cur + (room - cur) * (1 - Math.exp(-dt * 5));
    const dist = this.camDist;
    const cp = [pos[0] + fwd[0] * dist * back, pos[1] + fwd[1] * dist * back, pos[2] + fwd[2] * dist * back];
    return { pos: cp, forward: mode === 1 ? fwd : [-fwd[0], -fwd[1], -fwd[2]] };
  };

  // The local player as the renderer draws it in the third-person views.
  P.localPlayerModel = function localPlayerModel() {
    if (!this.camMode || !this.player) return null;
    // a wall right behind pulls the camera into our own head: then there is nothing to draw
    if ((this.camDist ?? 4) < 0.9) return null;
    const p = this.player;
    // (carried by someone: drawn in their arms)
    const by = this.carriedBy && this.mp && this.mp.players.get(this.carriedBy);
    const inv = this.inventory;
    const hs = Math.hypot(p.vel[0], p.vel[2]);
    this.selfWalk = (this.selfWalk || 0) + hs * 0.016 * 2.2;
    const chest = inv.armor[1];
    return {
      id: 'local', pos: p.pos.slice(), yaw: p.gliding ? Math.atan2(-p.vel[0], -p.vel[2]) : p.yaw, headYaw: p.yaw, headPitch: p.gliding ? 0 : p.pitch,
      skin: 'player:0', held: this.heldId(), armor: inv.armorIds(), walkPhase: this.selfWalk, walkAmount: p.onGround && !p.riding ? Math.min(1, hs / 4) : 0,
      swing: this.swing, hurtTime: 0, deathTime: 0, gliding: p.gliding, glidePitch: p.gliding ? -p.pitch * 0.6 : 0, sitting: !!p.riding,
      wings: !!(chest && itemDef(chest.id) && itemDef(chest.id).elytra), offhand: inv.offhand ? inv.offhand.id : 0, blocking: !!this.blocking,
      carrying: !!this.carrying,
      ...(by && by.pos ? { pos: by.pos.slice(), yaw: by.yaw, carried: 'arms', walkAmount: 0 } : null),
    };
  };

  void BLOCKS;
}

function hsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), tt = v * (1 - (1 - f) * s);
  return [[v, tt, p], [q, v, p], [p, v, tt], [p, q, v], [tt, p, v], [v, p, q]][i % 6];
}
