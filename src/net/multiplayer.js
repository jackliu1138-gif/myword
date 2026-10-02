// Multiplayer on top of the Game: joining a server, the other players (models, name tags, and
// positions the local creature simulation can see), shared block edits, chat, voice, and creatures
// that live on the machine of whoever they spawned near (each game simulates its own and sends
// snapshots; hits, damage and loot travel as messages). Installed as methods on Game.prototype.

import { NetClient, serverUrl } from './net.js';
import { SAUCER_FLAGS } from '../game/saucer.js';
import { JET_FLAGS } from '../game/jet.js';
import { FORCE_SOURCES } from '../sim/simulation.js';
import { seatAt, SEAT_H } from '../sim/saucerform.js';
import { Voice } from './voice.js';
import { RemoteMob, MOB_TYPES, mobSnapshot } from '../sim/remote.js';
import { loadEntity } from '../sim/containers.js';
import { itemDef } from '../sim/items.js';
import { WORLD_HEIGHT } from '../world/blocks.js';
import { GROUND_DIMS } from '../world/dimensions.js';
import { BODY_NAMES } from '../world/space.js';
import { PLAYER_VARIANTS } from '../render/models.js';
import { t } from '../ui/i18n.js';

const STATE_INTERVAL = 1 / 12;
const MOB_INTERVAL = 1 / 8;
const SHARE_RADIUS = 72; // our creatures within this distance of another player are sent to them
// (2048, 4096 and 8192: in a flying saucer, its engine going, its legs down; see game/saucer.js;
// 16384 to 262144: flying an F-22, its afterburner lit, its gear down, hovering, its cannon firing,
// see game/jet.js)
const FLAG = { SNEAK: 1, DEAD: 2, CREATIVE: 4, FLY: 8, SWING: 16, SLEEP: 32, GLIDE: 64, BLOCK: 128, RIDE: 256, BOOST: 512, CARRY: 1024, ...SAUCER_FLAGS, ...JET_FLAGS };
const PMOB_INTERVAL = 5; // how often the server hears of the creatures that stay
const MP_KEY = 'lumencraft.multiplayer';

const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
const round2 = (v) => Math.round(v * 100) / 100;

function variantOf(name) {
  let h = 7;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % PLAYER_VARIANTS;
}

// Where a world position lands on screen for a camera { pos, forward, fov (vertical, radians) }:
// [x, y] in pixels, or null when it is behind the camera or well outside the view.
export function projectToScreen(cam, point, w, h) {
  const f = cam.forward;
  let rx = -f[2], rz = f[0];
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; rz /= rl;
  const ux = -rz * f[1], uy = rz * f[0] - rx * f[2], uz = rx * f[1];
  const x = point[0] - cam.pos[0], y = point[1] - cam.pos[1], z = point[2] - cam.pos[2];
  const depth = x * f[0] + y * f[1] + z * f[2];
  if (depth < 0.3) return null;
  const th = Math.tan(cam.fov / 2), aspect = w / Math.max(1, h);
  const sx = (x * rx + z * rz) / (depth * th * aspect);
  const sy = (x * ux + y * uy + z * uz) / (depth * th);
  if (Math.abs(sx) > 1.2 || Math.abs(sy) > 1.2) return null;
  return [(sx * 0.5 + 0.5) * w, (0.5 - sy * 0.5) * h];
}

export function loadMultiplayerPrefs() {
  try { return JSON.parse(localStorage.getItem(MP_KEY)) || {}; } catch (e) { return {}; }
}

function saveMultiplayerPrefs(p) {
  try { localStorage.setItem(MP_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
}

export function installMultiplayer(Game) {
  const P = Game.prototype;

  // Is this page served by a Lumencraft server? Then joining it needs no address.
  P.detectHostServer = async function detectHostServer() {
    if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
    try {
      // relative, not "/lumen-server.json": the game may be served from a subpath (e.g. behind a
      // hub's reverse proxy at /games/lumencraft/), where only that path space is ours
      const r = await fetch('./lumen-server.json', { cache: 'no-store' });
      if (!r.ok) return null;
      const info = await r.json();
      this.hostServer = info && info.lumencraft ? info : null;
    } catch (e) { this.hostServer = null; }
    return this.hostServer;
  };

  P.joinServer = async function joinServer({ address, name, password }) {
    if (this.mp) return;
    const inFrame = (() => { try { return window.top !== window; } catch (e) { return true; } })();
    const url = serverUrl(address);
    if (!url) throw new Error(inFrame ? 'sandbox' : 'address');
    const net = new NetClient();
    let w;
    try {
      w = await net.connect(url, { n: name, pw: password });
    } catch (e) {
      net.close();
      throw new Error(e.message === 'unreachable' && inFrame ? 'sandbox' : e.message);
    }
    saveMultiplayerPrefs({ address, name });
    await this.save(); // the single-player world, before switching over
    try {
      this.enterServerWorld(net, w, name);
    } catch (e) {
      // don't leave a half-joined game behind
      console.error('joining failed', e);
      this.mp = null;
      net.close();
      await this.loadSinglePlayer();
      throw new Error('unreachable');
    }
  };

  P.enterServerWorld = function enterServerWorld(net, w, name) {
    this.mp = {
      net, id: w.id, name, serverName: w.name, dayLength: w.dayLength || 20,
      players: new Map(), ghosts: new Map(), ghostIds: new Map(), nextGhost: 1e9,
      stateTimer: 0, mobTimer: 0, saveTimer: 0, voiceTimer: 0, lastState: '', sentMobs: false,
      edits: [],
      // shared dropped items: what the server knows of (all dimensions) and the ones in our world
      itemData: new Map(), itemEnts: new Map(), dropSeq: 0,
      // chunks whose structure creatures we asked to spawn ("d:key" -> creatures); the creatures
      // that stay are reported every few seconds
      claims: new Map(), pmobTimer: 2,
      // who carries what: carrier id -> { kind: 'mob', o, r, u } | { kind: 'player', id }
      carries: new Map(),
    };
    const me = w.me && typeof w.me === 'object' ? w.me : {};
    this.mp.endHost = w.endHost || null;
    const data = {
      version: 2, seed: w.seed, gen: Number.isInteger(w.gen) ? w.gen : 1, edits: w.edits, dimEdits: w.dimEdits || {}, dayTime: w.dayTime, dayCount: w.dayCount,
      mode: me.mode || w.mode, difficulty: w.difficulty, endState: w.endState || undefined,
      dimension: Number.isInteger(me.dimension) && me.dimension >= 1 && me.dimension <= 7 ? me.dimension : 0,
      space: me.space && typeof me.space === 'object' ? me.space : undefined,
      inventory: Array.isArray(me.inventory) ? me.inventory : undefined,
      selected: me.selected, spawn: me.spawn || null,
      player: me.player && Array.isArray(me.player.pos) ? me.player : undefined,
      blockEntities: w.bents && typeof w.bents === 'object' ? w.bents : undefined,
      survival: me.survival && typeof me.survival === 'object' ? me.survival : undefined,
      saucer: me.saucer && typeof me.saucer === 'object' ? me.saucer : undefined,
    };
    this.loadWorld(w.seed, data);
    // the server's weather, straight away
    if (w.weather) this.weather.setShared(w.weather.r, w.weather.s, true);
    this.world.onEdit = (x, y, z, v) => { if (this.mp) this.mp.edits.push([x, y, z, v]); };
    // every dropped item is shared: announced when dropped, and whoever reaches it first asks the
    // server for it
    this.sim.onDrop = (d) => this.shareDrop(d);
    this.sim.onTake = (it) => { if (this.mp) this.mp.net.send({ t: 'take', i: it.netId }); };
    for (const it of Array.isArray(w.items) ? w.items : []) this.addSharedItem(it);
    this.sim.onGhostHit = (ghost, damage, from) => {
      ghost.hitByMe = performance.now() / 1000; // (if it dies of it, villagers who saw cheer: villagerlife.js)
      net.send({ t: 'hit', to: ghost.owner, e: ghost.rid, d: Math.round(damage * 10) / 10, f: from });
    };
    this.sim.onRemoteLoot = (to, loot, pos) => net.send({ t: 'loot', to, l: loot, p: pos });
    this.voice = new Voice(net, () => (this.audio.ctx && this.audio.ctx.state !== 'closed' ? this.audio.ctx : null));
    this.voice.setIce(w.ice);
    this.voice.mode = this.settings.voiceMode || 'proximity';
    this.voice.volume = this.settings.voiceVolume ?? 1;
    this.bindNet(net);
    for (const p of w.players) this.addRemotePlayer(p.id, p.n, p.st, p.voice);
    this.ui.setMultiplayer({ server: w.name });
    if (this.touch) this.touch.setMultiplayer(true);
    this.ui.addChat(null, t('mp.welcome', { server: w.name }));
    this.play();
  };

  P.bindNet = function bindNet(net) {
    const mp = this.mp;
    net.on('join', (m) => { this.addRemotePlayer(m.id, m.n, null, null); this.ui.addChat(null, t('mp.joined', { name: m.n })); });
    net.on('leave', (m) => {
      const p = mp.players.get(m.id);
      if (p) this.ui.addChat(null, t('mp.left', { name: p.name }));
      this.removeRemotePlayer(m.id);
      this.passengerGone(String(m.id));
    });
    net.on('st', (m) => {
      const p = mp.players.get(m.id);
      if (p) this.applyRemoteState(p, m);
    });
    net.on('b', (m) => {
      const d = m.d | 0;
      if (d === (this.dimension | 0)) { for (const [x, y, z, b] of m.l) this.world.applyRemoteEdit(x, y, z, b); return; }
      // an edit in another dimension: kept for when we go there
      const edits = this.dimEdits[d] || (this.dimEdits[d] = new Map());
      for (const [x, y, z, b] of m.l) {
        if (y < 0 || y >= WORLD_HEIGHT) continue;
        const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
        const key = (cx + 32768) * 65536 + (cz + 32768);
        let e = edits.get(key);
        if (!e) { e = new Map(); edits.set(key, e); }
        e.set((y << 8) | ((z - cz * 16) << 4) | (x - cx * 16), b);
      }
    });
    net.on('m', (m) => this.applyMobSnapshots(m.id, m.l));
    net.on('sleepers', (m) => { this.mpSleepers = { n: m.n | 0, m: m.m | 0 }; });
    net.on('wake', () => { if (this.sleeping) this.wakeUp(true); });
    net.on('endHost', (m) => { mp.endHost = m.id; });
    net.on('end', (m) => {
      if (!m.s || typeof m.s !== 'object') return;
      const was = this.endState && this.endState.dragonDead;
      this.endState = { ...this.endState, ...m.s };
      if (m.slain && !was) this.ui.toast(t('boss.slain'), 5000);
    });
    net.on('hit', (m) => this.sim.remoteHit(m.from, m.e, m.d, m.f));
    net.on('hurt', (m) => {
      const src = String(m.s || 'other');
      // (flying an F-22: someone's fire hits the jet, not us, until it is shot down)
      if (this.jet && FORCE_SOURCES.has(src) && this.jetTakeHit(Number(m.a) || 0, src)) return;
      this.sim.damagePlayer('local', Number(m.a) || 0, src, Array.isArray(m.f) ? m.f : null);
    });
    net.on('knock', (m) => { if (Array.isArray(m.f)) this.sim.emit({ type: 'knock', id: 'local', from: m.f, strength: Math.min(3, Number(m.k) || 1) }); });
    net.on('loot', (m) => {
      if (!Array.isArray(m.l) || !Array.isArray(m.p)) return;
      for (const [id, n] of m.l.slice(0, 8)) if (Number.isInteger(id) && n > 0) this.sim.dropItem(id, Math.min(64, n), m.p[0], m.p[1] + 0.5, m.p[2]);
    });
    net.on('fx', (m) => {
      if (m.k === 'boom') {
        // (a fighter's missile: its own fire and thunder)
        if (m.s && Array.isArray(m.p)) this.jetBlast(m.p, Math.max(1, Number(m.pw) || 6));
        else this.sim.emit({ type: 'explosion', pos: m.p, power: m.pw, remote: true });
      } else if (m.k === 'gun' || m.k === 'msl') this.onJetFx(m);
    });
    net.on('drop', (m) => this.addSharedItem(m));
    net.on('took', (m) => this.sharedItemTaken(m.i, m.by));
    net.on('gone', (m) => this.sharedItemTaken(m.i, null));
    // chests and furnaces: lent by the server one player at a time
    net.on('cont', (m) => this.onContainerReply(m));
    net.on('cgone', (m) => {
      if (this.openBlock && this.openBlock.key === m.k) { this.inventory.container = null; this.openBlock = null; this.closeInventory(); }
    });
    // signs (block entities everyone sees)
    net.on('bent', (m) => {
      const d = GROUND_DIMS.includes(m.d) ? m.d : 0;
      const map = this.bents[d] || (this.bents[d] = new Map());
      const e = m.e ? loadEntity(m.e) : null;
      if (e && e.kind === 'sign') map.set(String(m.k), e); else map.delete(String(m.k));
      if (this.signLayers) this.signLayers.delete(String(m.k));
    });
    net.on('chat', (m) => { this.ui.addChat(m.n, m.x); if (m.id !== mp.id) this.audio.sfx('pickup', 0.35, 0); });
    // someone picking up (or putting down) a creature or a player, or wriggling free
    net.on('carry', (m) => this.onCarryMessage(m));
    // flying saucers: coming aboard someone's, and parked ones handed over to whoever climbs in
    net.on('board', (m) => this.onBoardMessage(m));
    net.on('aboard', (m) => this.onAboardMessage(m));
    net.on('sgrab', (m) => this.onSaucerGrab(m));
    net.on('sgive', (m) => this.onSaucerGive(m));
    // villagers: what they say, what they did for us, and the ones we run told to stop or follow
    this.bindVillagerNet(net);
    net.on('ev', (m) => {
      if (m.k === 'death') this.ui.addChat(null, t('mp.died', { name: m.n }));
      else if (m.k === 'dragon') this.ui.addChat(null, t('mp.dragon', { name: m.n }));
    });
    net.on('voice', (m) => { const p = mp.players.get(m.id); if (p) { p.voice = { on: !!m.on, muted: !!m.muted }; this.refreshMpPanel(); } });
    net.on('rtc', (m) => { if (this.voice) this.voice.signal(m.from, m.d); });
    net.on('weather', (m) => this.weather.setShared(m.r, m.s));
    // structure creatures: spawned by whoever the server says got there first
    net.on('claimed', (m) => {
      const key = (m.d | 0) + ':' + m.k;
      const mobs = mp.claims.get(key);
      mp.claims.delete(key);
      if (m.ok && mobs && (m.d | 0) === (this.dimension | 0)) this.spawnFeatureMobs(mobs);
    });
    // creatures that stay, handed to us because we are near them and nobody else simulates them
    net.on('adopt', (m) => {
      if ((m.d | 0) !== (this.dimension | 0) || !Array.isArray(m.l)) { if (Array.isArray(m.l)) mp.net.send({ t: 'pmobs', d: m.d | 0, l: [], rel: m.l }); return; }
      const have = new Set();
      for (const e of this.sim.entities.values()) if (e.uid) have.add(e.uid);
      for (const o of m.l) if (o && !have.has(o.uid)) this.loadCreature(o);
    });
    net.on('time', (m) => {
      if (Math.abs(m.d - this.dayTime) > 0.002) this.dayTime = m.d;
      this.dayCount = m.n;
    });
    net.on('close', () => {
      this.ui.toast(t('mp.lost'), 5000);
      this.leaveServer(true);
    });
  };

  // ---------------------------------------------------------------- other players
  P.addRemotePlayer = function addRemotePlayer(id, name, state, voice) {
    const mp = this.mp;
    if (!mp || id === mp.id || mp.players.has(id)) return;
    const p = {
      id, name, pos: null, goal: null, yaw: 0, goalYaw: 0, pitch: 0, flags: 0, held: 0,
      walkPhase: 0, walkAmount: 0, swing: 0, hurtTime: 0, deathTime: 0,
      skin: 'player:' + variantOf(name), voice: voice || { on: false, muted: false },
      rec: this.sim.addPlayer(id, { remote: true, name, pos: [0, -100, 0] }),
      tag: this.ui.createNameTag(name),
    };
    mp.players.set(id, p);
    if (state) this.applyRemoteState(p, state);
    if (this.voice) this.voice.connect(id);
    this.refreshMpPanel();
  };

  P.removeRemotePlayer = function removeRemotePlayer(id) {
    const mp = this.mp;
    const p = mp && mp.players.get(id);
    if (!p) return;
    p.tag.remove();
    this.sim.removePlayer(id);
    mp.players.delete(id);
    this.carryPlayerLeft(id);
    for (const [key, g] of mp.ghosts) if (g.owner === id) { g.removed = true; mp.ghosts.delete(key); }
    if (this.voice) this.voice.remove(id);
    this.refreshMpPanel();
  };

  P.applyRemoteState = function applyRemoteState(p, s) {
    if (!Array.isArray(s.p)) return;
    // (in space everyone's position is in the coordinates of the body nearest them: placed in
    // our frame each frame, as the body turns and moves)
    const body = (s.d | 0) === 3 ? BODY_NAMES[s.b | 0] || 'earth' : null;
    p.goalB = body ? { body, q: s.p.slice(0, 3) } : null;
    p.goal = body && this.spaceLocalOfBody ? this.spaceLocalOfBody(body, p.goalB.q) : s.p.slice(0, 3);
    if (!p.pos) p.pos = p.goal.slice();
    // (an F-22 goes ten blocks between two of these: carried on at its speed in between)
    const tNow = performance.now() / 1000;
    if ((s.f || 0) & FLAG.JET && p.jetSeen && tNow - p.jetSeen.t > 0.02 && tNow - p.jetSeen.t < 1) {
      const dtS = tNow - p.jetSeen.t;
      p.jvel = p.goal.map((v, i) => Math.max(-450, Math.min(450, (v - p.jetSeen.p[i]) / dtS)));
    } else if (!((s.f || 0) & FLAG.JET)) p.jvel = null;
    p.jetSeen = (s.f || 0) & FLAG.JET ? { t: tNow, p: p.goal.slice() } : null;
    p.goalYaw = s.y || 0;
    p.pitch = s.pi || 0;
    p.held = s.h || 0;
    p.offhand = s.o | 0;
    p.armor = Array.isArray(s.a) ? s.a.slice(0, 4).map((v) => v | 0) : null;
    p.dim = s.d | 0;
    p.flags = s.f || 0;
    p.jqGoal = Array.isArray(s.q) && s.q.length === 4 ? s.q.slice(0, 4).map(Number) : null;
    if (!p.jqGoal) p.jq = null;
    else if (!p.jq) p.jq = p.jqGoal.slice();
    if (p.flags & FLAG.SWING) p.swing = 1;
    const rec = p.rec;
    rec.dead = !!(p.flags & FLAG.DEAD);
    rec.mode = p.flags & FLAG.CREATIVE ? 'creative' : 'survival';
  };

  // ---------------------------------------------------------------- creatures from other players
  P.applyMobSnapshots = function applyMobSnapshots(owner, list) {
    const mp = this.mp;
    if (!mp || !mp.players.has(owner) || !Array.isArray(list)) return;
    // creatures of a player in another dimension are not here
    if ((mp.players.get(owner).dim | 0) !== (this.dimension | 0)) list = [];
    const seen = new Set();
    for (const s of list) {
      if (!Array.isArray(s) || s.length < 10) continue;
      const type = MOB_TYPES[s[1]];
      if (!type) continue;
      const key = owner + ':' + s[0];
      seen.add(key);
      let g = mp.ghosts.get(key);
      if (!g || g.removed) {
        g = new RemoteMob(this.sim, mp.nextGhost++, owner, s[0], type);
        mp.ghosts.set(key, g);
        this.sim.add(g);
      }
      g.apply(s);
    }
    for (const [key, g] of mp.ghosts) {
      if (g.owner === owner && !seen.has(key)) { g.removed = true; mp.ghosts.delete(key); }
    }
  };

  // ---------------------------------------------------------------- per frame
  P.updateNet = function updateNet(dt) {
    const mp = this.mp;
    if (!mp) return;
    const net = mp.net;
    // our block edits
    this.flushEdits();
    // our position and look
    mp.stateTimer -= dt;
    const me = this.me();
    if (mp.stateTimer <= 0) {
      mp.stateTimer = STATE_INTERVAL;
      const pl = this.player;
      const f = (pl.sneaking ? FLAG.SNEAK : 0) | (me && me.dead ? FLAG.DEAD : 0) | (this.isCreative() ? FLAG.CREATIVE : 0) | (pl.flying ? FLAG.FLY : 0) | (this.swing > 0.5 ? FLAG.SWING : 0) | (this.sleeping ? FLAG.SLEEP : 0)
        | (pl.gliding ? FLAG.GLIDE : 0) | (this.blocking ? FLAG.BLOCK : 0) | (pl.riding || this.passengerOf ? FLAG.RIDE : 0) | (pl.boost > 0 ? FLAG.BOOST : 0) | (this.carrying ? FLAG.CARRY : 0)
        | (this.ride ? FLAG.SAUCER | (this.ride.engine > 0.3 ? FLAG.THRUST : 0) | (this.ride.legs > 0.5 ? FLAG.LEGS : 0) : 0)
        | (this.jet ? FLAG.JET | (this.jet.ab > 0.5 ? FLAG.AB : 0) | (this.jet.gear > 0.5 ? FLAG.GEAR : 0) | (this.jet.mode === 'hover' ? FLAG.HOVER : 0) | (this.jet.firing > 0.5 ? FLAG.GUN : 0) : 0);
      // (in space: where we are over the body nearest us, the same for everyone)
      const sb = this.dimension === 3 && this.spaceState ? this.spaceBodyCoords() : null;
      const at = sb ? sb.q : pl.pos;
      // (flying a saucer: the way it faces, not where our camera looks from)
      const msg = { t: 'st', p: [round2(at[0]), round2(at[1]), round2(at[2])], y: round2(this.ride ? this.ride.yaw : this.passengerOf && this.passengerYaw !== undefined ? this.passengerYaw : pl.yaw), pi: this.ride || this.passengerOf ? 0 : round2(pl.pitch), h: this.heldId(), f };
      // (flying an F-22: how it is turned)
      if (this.jet) msg.q = this.jet.q.map((v) => Math.round(v * 1000) / 1000);
      if (sb) msg.b = BODY_NAMES.indexOf(sb.body);
      if (this.inventory && this.inventory.offhand) msg.o = this.inventory.offhand.id;
      const armor = this.inventory ? this.inventory.armorIds() : null;
      if (armor && armor.some(Boolean)) msg.a = armor;
      if (this.dimension) msg.d = this.dimension;
      const key = JSON.stringify(msg);
      mp.idle = key === mp.lastState ? (mp.idle || 0) + STATE_INTERVAL : 0;
      if (key !== mp.lastState || mp.idle > 1) { net.send(msg); mp.lastState = key; if (mp.idle > 1) mp.idle = 0; }
    }
    // our creatures near other players
    mp.mobTimer -= dt;
    if (mp.mobTimer <= 0 && mp.players.size) {
      mp.mobTimer = MOB_INTERVAL;
      const others = [...mp.players.values()].filter((p) => p.pos && (p.dim | 0) === (this.dimension | 0));
      const list = [];
      for (const e of this.sim.entities.values()) {
        if (e.kind !== 'mob' || e.ghost || e.removed) continue;
        const b = e.body.pos;
        if (others.some((p) => (p.pos[0] - b[0]) ** 2 + (p.pos[2] - b[2]) ** 2 < SHARE_RADIUS * SHARE_RADIUS)) list.push(mobSnapshot(e));
        if (list.length >= 96) break;
      }
      if (list.length || mp.sentMobs) net.send({ t: 'm', l: list });
      mp.sentMobs = list.length > 0;
    }
    // everyone else, smoothed towards their latest reported position
    const k = 1 - Math.exp(-dt * 12);
    for (const p of mp.players.values()) {
      if (!p.goal) continue;
      if (p.goalB) {
        // the body turns and moves, and our own frame with us as we fly: where they are in it now
        const g = p.goalB, b = p.atBody;
        if (b && b.body === g.body) b.q = b.q.map((v, i) => v + (g.q[i] - v) * k);
        else p.atBody = { body: g.body, q: g.q.slice() };
        if (this.spaceLocalOfBody) { p.pos = this.spaceLocalOfBody(p.atBody.body, p.atBody.q); p.goal = p.pos.slice(); }
      } else p.atBody = null;
      if (p.jvel && p.flags & FLAG.JET) for (let i = 0; i < 3; i++) p.goal[i] += p.jvel[i] * dt;
      if (p.jqGoal && p.jq) p.jq = p.jq.map((v, i) => v + ((p.jq[0] * p.jqGoal[0] + p.jq[1] * p.jqGoal[1] + p.jq[2] * p.jqGoal[2] + p.jq[3] * p.jqGoal[3] < 0 ? -p.jqGoal[i] : p.jqGoal[i]) - v) * k);
      const d = Math.hypot(p.goal[0] - p.pos[0], p.goal[1] - p.pos[1], p.goal[2] - p.pos[2]);
      if (d > (p.flags & FLAG.JET ? 80 : 10)) p.pos = p.goal.slice();
      const ox = p.pos[0], oz = p.pos[2];
      for (let i = 0; i < 3; i++) p.pos[i] += (p.goal[i] - p.pos[i]) * k;
      p.yaw = lerpAngle(p.yaw, p.goalYaw, k);
      const speed = Math.hypot(p.pos[0] - ox, p.pos[2] - oz) / Math.max(dt, 1e-3);
      p.walkAmount += ((p.flags & (FLAG.FLY | FLAG.SAUCER) ? 0 : Math.min(1, speed / 4)) - p.walkAmount) * Math.min(1, dt * 10);
      p.walkPhase += speed * dt * 2.2;
      p.swing = Math.max(0, p.swing - dt * 3);
      p.hurtTime = p.rec.hurtTime > 0 ? 0.3 : Math.max(0, p.hurtTime - dt);
      p.deathTime = p.flags & FLAG.DEAD ? Math.min(1, p.deathTime + dt) : 0;
      // someone in another dimension is nowhere near us, whatever their coordinates say
      p.rec.pos = (p.dim | 0) === (this.dimension | 0) ? p.pos.slice() : [0, -1000, 0];
    }
    // villagers sitting in someone's saucer as it flies: in their seats where we see it now (what
    // its pilot reports of them lags behind it, and in space is in their frame, not ours)
    for (const g of mp.ghosts.values()) {
      if (g.seat === null || g.seat === undefined || g.removed) continue;
      const p = mp.players.get(g.owner);
      if (!p || !p.pos || !(p.flags & FLAG.SAUCER) || (p.dim | 0) !== (this.dimension | 0)) { g.pinned = 0; continue; }
      const s = seatAt(p.pos, p.yaw, g.seat);
      g.body.pos = [s.pos[0], s.pos[1] + SEAT_H - 0.375, s.pos[2]];
      g.prevPos = g.body.pos.slice();
      g.yaw = g.prevYaw = g.goalYaw = g.headYaw = g.goalHeadYaw = s.yaw;
      g.pinned = 0.3;
    }
    // voice: loudness by distance, a few times a second
    mp.voiceTimer -= dt;
    if (this.voice && mp.voiceTimer <= 0) {
      mp.voiceTimer = 0.1;
      const cam = this.camera ? this.camera.pos : this.player.eye;
      this.voice.update(cam, this.player.yaw, (id) => { const p = mp.players.get(id); return p && p.pos ? [p.pos[0], p.pos[1] + 1.6, p.pos[2]] : null; });
      const speaking = [];
      for (const p of mp.players.values()) {
        const v = this.voice.peers.get(p.id);
        p.speaking = !!(v && v.speaking);
        if (p.speaking) speaking.push(p.name);
      }
      this.ui.setVoiceHud({ mic: this.voice.micOn, muted: this.voice.muted, level: this.voice.level, speaking });
    }
    // the creatures that stay: kept on the server; the ones whose chunks we no longer have go
    // back to it, for whoever comes by
    mp.pmobTimer -= dt;
    if (mp.pmobTimer <= 0) { mp.pmobTimer = PMOB_INTERVAL; this.reportCreatures(false); }
    // our inventory and position are kept on the server
    mp.saveTimer += dt;
    if (mp.saveTimer > 20) { mp.saveTimer = 0; net.send({ t: 'save', s: this.mpSaveState() }); }
    if (this.ui.current === 'pause') {
      mp.panelTimer = (mp.panelTimer || 0) - dt;
      if (mp.panelTimer <= 0) { mp.panelTimer = 1; this.refreshMpPanel(); }
    }
  };

  // ---------------------------------------------------------------- shared items
  P.shareDrop = function shareDrop(d) {
    const mp = this.mp;
    if (!mp) return;
    d.netId = mp.id + '.' + (++mp.dropSeq);
    const b = d.body;
    const msg = {
      t: 'drop', i: d.netId, it: d.item, n: d.count, w: d.wear || 0, dl: round2(d.pickupDelay || 0),
      p: b.pos.map(round2), v: b.vel.map(round2), d: this.dimension || 0,
    };
    if (d.ench) msg.e = d.ench;
    mp.itemData.set(d.netId, msg);
    mp.itemEnts.set(d.netId, d);
    mp.net.send(msg);
  };

  // An item someone dropped (or the server spilled from a broken chest).
  P.addSharedItem = function addSharedItem(m) {
    const mp = this.mp;
    if (!mp || !m || typeof m.i !== 'string' || mp.itemData.has(m.i)) return;
    if (!Number.isInteger(m.it) || !itemDef(m.it) || !Array.isArray(m.p)) return;
    mp.itemData.set(m.i, m);
    if ((m.d | 0) === (this.dimension | 0)) this.spawnSharedItem(m);
  };

  P.spawnSharedItem = function spawnSharedItem(m) {
    const v = Array.isArray(m.v) ? m.v : null;
    const ench = m.e && typeof m.e === 'object' ? m.e : null;
    const e = this.sim.dropItem(m.it, Math.max(1, Math.min(64, m.n | 0)), m.p[0], m.p[1], m.p[2], v, m.w | 0, { delay: Number(m.dl) || 0, remote: true, netId: m.i, ench });
    if (e) this.mp.itemEnts.set(m.i, e);
  };

  // The server's answer: `by` got the item (us: it goes into the inventory), or null: it's gone.
  P.sharedItemTaken = function sharedItemTaken(id, by) {
    const mp = this.mp;
    if (!mp) return;
    const data = mp.itemData.get(id);
    mp.itemData.delete(id);
    const e = mp.itemEnts.get(id);
    mp.itemEnts.delete(id);
    if (e) e.removed = true;
    if (!data || by !== mp.id) return;
    const ench = data.e && typeof data.e === 'object' ? data.e : null;
    const left = this.inventory.add(data.it, data.n, data.w || 0, ench);
    if (left < data.n) this.audio.sfx('pickup', 0.6, 0);
    if (left > 0) {
      // no room for all of it: the rest goes back on the ground
      const p = this.player.pos;
      this.sim.dropItem(data.it, left, p[0], p[1] + 0.5, p[2], [0, 2, 0], data.w || 0, { delay: 2, ench });
      this.ui.toast(t('inv.full'), 2000);
    }
  };

  // After changing dimension: the shared items of the world we are in now.
  P.respawnSharedItems = function respawnSharedItems() {
    const mp = this.mp;
    if (!mp) return;
    mp.itemEnts.clear();
    for (const m of mp.itemData.values()) if ((m.d | 0) === (this.dimension | 0)) this.spawnSharedItem(m);
  };

  // releaseAll: leaving the dimension (or the server): every one of them goes back
  P.reportCreatures = function reportCreatures(releaseAll) {
    const mp = this.mp;
    if (!mp || !this.sim) return;
    const l = [], rel = [];
    for (const e of this.sim.entities.values()) {
      if (e.kind !== 'mob' || e.ghost || e.removed || e.deathTime > 0 || !this.keepsCreature(e)) continue;
      const o = this.serializeCreature(e);
      if (releaseAll || !this.world.isChunkReady(e.body.pos[0], e.body.pos[2])) { rel.push(o); if (!releaseAll) e.removed = true; }
      else l.push(o);
    }
    mp.net.send({ t: 'pmobs', d: this.dimension || 0, l, rel, full: 1 });
  };

  P.flushEdits = function flushEdits() {
    const mp = this.mp;
    if (!mp) return;
    while (mp.edits.length) {
      const msg = { t: 'b', l: mp.edits.splice(0, 512) };
      if (this.dimension) msg.d = this.dimension;
      mp.net.send(msg);
    }
  };

  P.mpSaveState = function mpSaveState() {
    const me = this.me();
    const p = this.player;
    return {
      player: { pos: p.pos.map(round2), yaw: round2(p.yaw), pitch: round2(p.pitch), flying: p.flying, health: me ? me.health : 20, air: me ? me.air : 10 },
      inventory: this.inventory ? this.inventory.serialize() : [],
      selected: this.selected,
      spawn: this.spawnPoint,
      mode: this.mode,
      dimension: this.dimension || 0,
      survival: this.serializeSurvival ? this.serializeSurvival() : undefined,
      ...this.serializeSpace(),
      // (in a flying saucer, or an F-22: back in it next time)
      ...this.serializeSaucer(),
      ...this.serializeJet(),
    };
  };

  // Local simulation events that other players need to know about.
  P.forwardSimEvent = function forwardSimEvent(e) {
    const mp = this.mp;
    if (!mp) return;
    if (e.type === 'remoteHurt') mp.net.send({ t: 'hurt', to: e.id, a: Math.round(e.amount * 10) / 10, s: e.source, f: e.from ? Array.from(e.from).map(round2) : null });
    else if (e.type === 'knock' && e.id !== 'local') mp.net.send({ t: 'knock', to: e.id, f: Array.from(e.from).map(round2), k: round2(e.strength) });
    else if (e.type === 'explosion' && !e.remote) mp.net.send({ t: 'fx', k: 'boom', p: e.pos.map(round2), pw: e.power, ...(e.strike ? { s: 1 } : null) });
    else if (e.type === 'playerDeath' && e.id === 'local') mp.net.send({ t: 'ev', k: 'death', s: e.source });
  };

  // What the renderer draws for the other players.
  P.remotePlayerModels = function remotePlayerModels() {
    const mp = this.mp;
    if (!mp) return null;
    const out = [];
    for (const p of mp.players.values()) {
      if (!p.pos) continue;
      if ((p.dim | 0) !== (this.dimension | 0)) continue; // in another dimension
      const gliding = !!(p.flags & FLAG.GLIDE);
      const chest = p.armor && p.armor[1] ? itemDef(p.armor[1]) : null;
      // (carried by us or by someone else: drawn lying in their arms)
      const by = p.carriedBy === 'local' ? this.player : p.carriedBy ? mp.players.get(p.carriedBy) : null;
      // (flying an F-22: inside it, under its canopy)
      if (p.flags & FLAG.JET) continue;
      // (flying a saucer: sitting in its dome)
      if (p.flags & FLAG.SAUCER) {
        const s = seatAt(p.pos, p.yaw, 'pilot');
        out.push({ id: p.id, pos: [s.pos[0], s.pos[1] + SEAT_H - 0.55, s.pos[2]], yaw: s.yaw, headYaw: s.yaw, headPitch: 0, skin: p.skin, held: 0, armor: p.armor, sitting: true, walkPhase: 0, walkAmount: 0, swing: 0, hurtTime: 0, deathTime: 0, offhand: 0 });
        continue;
      }
      out.push({
        ...(by && by.pos ? { carried: 'arms' } : null), carrying: !!(p.flags & FLAG.CARRY),
        id: p.id, pos: by && by.pos ? by.pos : p.pos, yaw: by && by.pos ? by.yaw : p.yaw, headYaw: p.yaw, headPitch: gliding ? 0 : p.pitch, skin: p.skin, held: p.held, armor: p.armor, lying: !!(p.flags & FLAG.SLEEP),
        walkPhase: p.walkPhase, walkAmount: p.flags & FLAG.RIDE ? 0 : p.walkAmount, swing: p.swing, hurtTime: p.hurtTime, deathTime: p.deathTime,
        gliding, glidePitch: gliding ? -p.pitch * 0.6 : 0, sitting: !!(p.flags & FLAG.RIDE), blocking: !!(p.flags & FLAG.BLOCK),
        wings: !!(chest && chest.elytra), offhand: p.offhand || 0,
      });
    }
    return out;
  };

  // Name tags follow the players on screen.
  P.updateNameTags = function updateNameTags() {
    const mp = this.mp;
    if (!mp || !this.camera) return;
    const cam = this.camera;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const show = this.state === 'playing' || this.state === 'chat';
    for (const p of mp.players.values()) {
      const tag = p.tag;
      const head = p.pos && (p.dim | 0) === (this.dimension | 0) ? [p.pos[0], p.pos[1] + 2.15, p.pos[2]] : null;
      const dist = head ? Math.hypot(head[0] - cam.pos[0], head[1] - cam.pos[1], head[2] - cam.pos[2]) : Infinity;
      const at = head && show && !this.hudHidden && dist < 96 ? projectToScreen(cam, head, w, h) : null;
      tag.hidden = !at;
      if (!at) continue;
      tag.style.transform = `translate(${at[0].toFixed(1)}px, ${at[1].toFixed(1)}px) translate(-50%, -100%) scale(${Math.max(0.6, Math.min(1, 14 / dist)).toFixed(2)})`;
      tag.classList.toggle('speaking', !!p.speaking);
    }
  };

  P.refreshMpPanel = function refreshMpPanel() {
    const mp = this.mp;
    if (!mp) return;
    const list = [{ name: mp.name, me: true, voice: this.voice ? { on: this.voice.micOn, muted: this.voice.muted } : null, ping: mp.net.rtt }];
    for (const p of mp.players.values()) list.push({ name: p.name, voice: p.voice, speaking: p.speaking });
    this.ui.renderMpPanel({ server: mp.serverName, players: list, mic: this.voice ? this.voice.micOn : false, muted: this.voice ? this.voice.muted : false, mode: this.voice ? this.voice.mode : 'proximity', ping: Math.round(mp.net.rtt) });
  };

  // ---------------------------------------------------------------- voice controls
  P.toggleMic = async function toggleMic() {
    const v = this.voice;
    if (!v) return;
    this.audio.unlock();
    try {
      if (!v.micOn) {
        await v.enableMic();
        this.ui.toast(t('voice.micOn'));
      } else {
        v.setMuted(!v.muted);
        this.ui.toast(t(v.muted ? 'voice.muted' : 'voice.micOn'));
      }
    } catch (e) {
      this.ui.toast(t('voice.err.' + (['insecure', 'denied', 'unsupported'].includes(e.message) ? e.message : 'unsupported')), 5000);
    }
    if (this.touch) this.touch.setMultiplayer(true, v.micOn ? (v.muted ? 'muted' : 'on') : null);
    this.refreshMpPanel();
  };

  P.setVoiceMode = function setVoiceMode(mode) {
    this.settings.voiceMode = mode;
    if (this.voice) this.voice.mode = mode;
    this.refreshMpPanel();
  };

  // ---------------------------------------------------------------- chat
  P.openChat = function openChat() {
    if (!this.mp || this.state !== 'playing') return;
    this.state = 'chat';
    this.input.enabled = false;
    this.input.keys.clear();
    this.input.buttons.clear();
    this.input.exitLock();
    if (this.touch) this.touch.show(false);
    this.ui.openChat();
  };

  P.closeChat = function closeChat(text) {
    if (this.state !== 'chat') return;
    const msg = String(text || '').trim();
    if (msg && this.mp) this.mp.net.send({ t: 'chat', x: msg.slice(0, 200) });
    this.ui.closeChat();
    this.state = 'playing';
    this.input.enabled = true;
    if (this.touch) this.touch.show(true);
    const padUser = this.pads.connected && performance.now() - this.pads.lastActive < 1500;
    if (!this.input.lockFailed && !this.touch && !padUser) this.input.requestLock();
  };

  // ---------------------------------------------------------------- leaving
  P.leaveServer = async function leaveServer(lost = false) {
    const mp = this.mp;
    if (!mp) return;
    if (!lost) { mp.net.send({ t: 'save', s: this.mpSaveState() }); this.reportCreatures(true); }
    if (this.voice) { this.voice.stop(); this.voice = null; }
    for (const p of mp.players.values()) p.tag.remove();
    this.mp = null;
    setTimeout(() => mp.net.close(), lost ? 0 : 300); // let the last save go out
    this.ui.setMultiplayer(null);
    if (this.touch) this.touch.setMultiplayer(false);
    await this.loadSinglePlayer();
    this.enterTitle();
  };
}
