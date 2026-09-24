// Multiplayer on top of the Game: joining a server, the other players (models, name tags, and
// positions the local creature simulation can see), shared block edits, chat, voice, and creatures
// that live on the machine of whoever they spawned near (each game simulates its own and sends
// snapshots; hits, damage and loot travel as messages). Installed as methods on Game.prototype.

import { NetClient, serverUrl } from './net.js';
import { Voice } from './voice.js';
import { RemoteMob, MOB_TYPES, mobSnapshot } from '../sim/remote.js';
import { PLAYER_VARIANTS } from '../render/models.js';
import { t } from '../ui/i18n.js';

const STATE_INTERVAL = 1 / 12;
const MOB_INTERVAL = 1 / 8;
const SHARE_RADIUS = 72; // our creatures within this distance of another player are sent to them
const FLAG = { SNEAK: 1, DEAD: 2, CREATIVE: 4, FLY: 8, SWING: 16 };
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
      const r = await fetch('/lumen-server.json', { cache: 'no-store' });
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
    this.mp = {
      net, id: w.id, name, serverName: w.name, dayLength: w.dayLength || 20,
      players: new Map(), ghosts: new Map(), ghostIds: new Map(), nextGhost: 1e9,
      stateTimer: 0, mobTimer: 0, saveTimer: 0, voiceTimer: 0, lastState: '', sentMobs: false,
      edits: [],
    };
    const me = w.me && typeof w.me === 'object' ? w.me : {};
    const data = {
      version: 2, seed: w.seed, edits: w.edits, dayTime: w.dayTime, dayCount: w.dayCount,
      mode: me.mode || w.mode, difficulty: w.difficulty,
      inventory: Array.isArray(me.inventory) ? me.inventory : undefined,
      selected: me.selected, spawn: me.spawn || null,
      player: me.player && Array.isArray(me.player.pos) ? me.player : undefined,
    };
    this.loadWorld(w.seed, data);
    this.world.onEdit = (x, y, z, id) => { if (this.mp) this.mp.edits.push([x, y, z, id]); };
    this.sim.onGhostHit = (ghost, damage, from) => net.send({ t: 'hit', to: ghost.owner, e: ghost.rid, d: Math.round(damage * 10) / 10, f: from });
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
    });
    net.on('st', (m) => {
      const p = mp.players.get(m.id);
      if (p) this.applyRemoteState(p, m);
    });
    net.on('b', (m) => { for (const [x, y, z, b] of m.l) this.world.applyRemoteEdit(x, y, z, b); });
    net.on('m', (m) => this.applyMobSnapshots(m.id, m.l));
    net.on('hit', (m) => this.sim.remoteHit(m.from, m.e, m.d, m.f));
    net.on('hurt', (m) => this.sim.damagePlayer('local', Number(m.a) || 0, String(m.s || 'other'), Array.isArray(m.f) ? m.f : null));
    net.on('knock', (m) => { if (Array.isArray(m.f)) this.sim.emit({ type: 'knock', id: 'local', from: m.f, strength: Math.min(3, Number(m.k) || 1) }); });
    net.on('loot', (m) => {
      if (!Array.isArray(m.l) || !Array.isArray(m.p)) return;
      for (const [id, n] of m.l.slice(0, 8)) if (Number.isInteger(id) && n > 0) this.sim.dropItem(id, Math.min(64, n), m.p[0], m.p[1] + 0.5, m.p[2]);
    });
    net.on('fx', (m) => { if (m.k === 'boom') this.sim.emit({ type: 'explosion', pos: m.p, power: m.pw, remote: true }); });
    net.on('chat', (m) => { this.ui.addChat(m.n, m.x); if (m.id !== mp.id) this.audio.sfx('pickup', 0.35, 0); });
    net.on('ev', (m) => { if (m.k === 'death') this.ui.addChat(null, t('mp.died', { name: m.n })); });
    net.on('voice', (m) => { const p = mp.players.get(m.id); if (p) { p.voice = { on: !!m.on, muted: !!m.muted }; this.refreshMpPanel(); } });
    net.on('rtc', (m) => { if (this.voice) this.voice.signal(m.from, m.d); });
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
    for (const [key, g] of mp.ghosts) if (g.owner === id) { g.removed = true; mp.ghosts.delete(key); }
    if (this.voice) this.voice.remove(id);
    this.refreshMpPanel();
  };

  P.applyRemoteState = function applyRemoteState(p, s) {
    if (!Array.isArray(s.p)) return;
    p.goal = s.p.slice(0, 3);
    if (!p.pos) p.pos = p.goal.slice();
    p.goalYaw = s.y || 0;
    p.pitch = s.pi || 0;
    p.held = s.h || 0;
    p.flags = s.f || 0;
    if (p.flags & FLAG.SWING) p.swing = 1;
    const rec = p.rec;
    rec.dead = !!(p.flags & FLAG.DEAD);
    rec.mode = p.flags & FLAG.CREATIVE ? 'creative' : 'survival';
  };

  // ---------------------------------------------------------------- creatures from other players
  P.applyMobSnapshots = function applyMobSnapshots(owner, list) {
    const mp = this.mp;
    if (!mp || !mp.players.has(owner) || !Array.isArray(list)) return;
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
    if (mp.edits.length) {
      while (mp.edits.length) net.send({ t: 'b', l: mp.edits.splice(0, 512) });
    }
    // our position and look
    mp.stateTimer -= dt;
    const me = this.me();
    if (mp.stateTimer <= 0) {
      mp.stateTimer = STATE_INTERVAL;
      const pl = this.player;
      const f = (pl.sneaking ? FLAG.SNEAK : 0) | (me && me.dead ? FLAG.DEAD : 0) | (this.isCreative() ? FLAG.CREATIVE : 0) | (pl.flying ? FLAG.FLY : 0) | (this.swing > 0.5 ? FLAG.SWING : 0);
      const msg = { t: 'st', p: [round2(pl.pos[0]), round2(pl.pos[1]), round2(pl.pos[2])], y: round2(pl.yaw), pi: round2(pl.pitch), h: this.heldId(), f };
      const key = JSON.stringify(msg);
      mp.idle = key === mp.lastState ? (mp.idle || 0) + STATE_INTERVAL : 0;
      if (key !== mp.lastState || mp.idle > 1) { net.send(msg); mp.lastState = key; if (mp.idle > 1) mp.idle = 0; }
    }
    // our creatures near other players
    mp.mobTimer -= dt;
    if (mp.mobTimer <= 0 && mp.players.size) {
      mp.mobTimer = MOB_INTERVAL;
      const others = [...mp.players.values()].filter((p) => p.pos);
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
      const d = Math.hypot(p.goal[0] - p.pos[0], p.goal[1] - p.pos[1], p.goal[2] - p.pos[2]);
      if (d > 10) p.pos = p.goal.slice();
      const ox = p.pos[0], oz = p.pos[2];
      for (let i = 0; i < 3; i++) p.pos[i] += (p.goal[i] - p.pos[i]) * k;
      p.yaw = lerpAngle(p.yaw, p.goalYaw, k);
      const speed = Math.hypot(p.pos[0] - ox, p.pos[2] - oz) / Math.max(dt, 1e-3);
      p.walkAmount += ((p.flags & FLAG.FLY ? 0 : Math.min(1, speed / 4)) - p.walkAmount) * Math.min(1, dt * 10);
      p.walkPhase += speed * dt * 2.2;
      p.swing = Math.max(0, p.swing - dt * 3);
      p.hurtTime = p.rec.hurtTime > 0 ? 0.3 : Math.max(0, p.hurtTime - dt);
      p.deathTime = p.flags & FLAG.DEAD ? Math.min(1, p.deathTime + dt) : 0;
      p.rec.pos = p.pos.slice();
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
    // our inventory and position are kept on the server
    mp.saveTimer += dt;
    if (mp.saveTimer > 20) { mp.saveTimer = 0; net.send({ t: 'save', s: this.mpSaveState() }); }
    if (this.ui.current === 'pause') {
      mp.panelTimer = (mp.panelTimer || 0) - dt;
      if (mp.panelTimer <= 0) { mp.panelTimer = 1; this.refreshMpPanel(); }
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
    };
  };

  // Local simulation events that other players need to know about.
  P.forwardSimEvent = function forwardSimEvent(e) {
    const mp = this.mp;
    if (!mp) return;
    if (e.type === 'remoteHurt') mp.net.send({ t: 'hurt', to: e.id, a: Math.round(e.amount * 10) / 10, s: e.source, f: e.from ? Array.from(e.from).map(round2) : null });
    else if (e.type === 'knock' && e.id !== 'local') mp.net.send({ t: 'knock', to: e.id, f: Array.from(e.from).map(round2), k: round2(e.strength) });
    else if (e.type === 'explosion' && !e.remote) mp.net.send({ t: 'fx', k: 'boom', p: e.pos.map(round2), pw: e.power });
    else if (e.type === 'playerDeath' && e.id === 'local') mp.net.send({ t: 'ev', k: 'death', s: e.source });
  };

  // What the renderer draws for the other players.
  P.remotePlayerModels = function remotePlayerModels() {
    const mp = this.mp;
    if (!mp) return null;
    const out = [];
    for (const p of mp.players.values()) {
      if (!p.pos) continue;
      out.push({
        id: p.id, pos: p.pos, yaw: p.yaw, headYaw: p.yaw, headPitch: p.pitch, skin: p.skin,
        walkPhase: p.walkPhase, walkAmount: p.walkAmount, swing: p.swing, hurtTime: p.hurtTime, deathTime: p.deathTime,
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
      const head = p.pos ? [p.pos[0], p.pos[1] + 2.15, p.pos[2]] : null;
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
    if (!lost) mp.net.send({ t: 'save', s: this.mpSaveState() });
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
