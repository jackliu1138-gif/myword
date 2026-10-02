// Carrying: a princess carry. Pick up a villager, a friend (on a server) or an animal in both
// arms (G, the touch screen's carry button, the controller's D-pad right), carry it about and put
// it down again, or, running, throw it a little way. Villagers have something to say about it and
// remember it; put down far from home a villager makes the place its new home. Everyone on a
// server sees who carries whom; someone carried can wriggle free (jump three times).
// Installed as methods on Game.prototype.

import { t, getLanguage } from '../ui/i18n.js';
import { seatAt, SEAT_H } from '../sim/saucerform.js';
import { remember, befriend } from '../sim/brain.js';

export const CARRY_RANGE = 3.2;
// what can be picked up; villagers (and players) lie in your arms, the animals are held upright
export const CARRYABLE = new Set(['villager', 'cat', 'wolf', 'chicken', 'pig', 'sheep', 'cow']);
const IN_ARMS = new Set(['villager']);
const NEW_HOME = 32; // put down this far from its home, a villager stays there
const FLAG_DEAD = 2;

// lines a villager says when picked up, put down, thrown, or given a new home
const LINES = {
  zh: {
    up: ['哎哟！你干什么呀，快放我下来！', '哇，好高啊！', '嘿嘿，你要带我去哪儿？', '我、我自己会走路的！', '轻点儿，我的老腰哟！'],
    upChild: ['哇哈哈，再高一点！', '飞起来咯！', '嘻嘻，好好玩！'],
    down: ['呼……终于踩到地了。', '谢谢你送我一程。', '下次先打个招呼嘛。', '嗯，这儿风景不错。'],
    thrown: ['哇啊啊啊——！', '你这个坏蛋！', '哎哟喂，我的屁股！'],
    home: ['这里就是我的新家吗？还挺不错的！', '好吧，我就在这儿住下了。'],
  },
  en: {
    up: ['Oi! What are you doing, put me down!', 'Whoa, it\'s high up here!', 'Heh, where are you taking me?', 'I-I can walk on my own, you know!', 'Careful, my poor old back!'],
    upChild: ['Wheee, higher!', 'I\'m flying!', 'Hee hee, again!'],
    down: ['Phew... solid ground at last.', 'Thanks for the lift.', 'Ask first next time, will you?', 'Hm, nice view from here.'],
    thrown: ['Waaaaah!', 'You rotter!', 'Ow, right on my backside!'],
    home: ['So this is my new home? Not bad at all!', 'All right, I\'ll live here then.'],
  },
};
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Where a carried creature's feet go and which way it faces: the carrier's, the model drawing it
// in their arms from there (see models.js).
export function carriedAt(pos, yaw) {
  return { pos: [pos[0], pos[1], pos[2]], yaw };
}

// The point a carried player sees from: their head, lying across the carrier's arms (to the
// carrier's left, a little in front, at chest height).
export function carriedEye(pos, yaw) {
  const rx = Math.cos(yaw), rz = -Math.sin(yaw); // right
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw); // forward
  return [pos[0] - rx * 0.75 + fx * 0.5, pos[1] + 1.3, pos[2] - rz * 0.75 + fz * 0.5];
}

export function installCarry(Game) {
  const P = Game.prototype;

  // What we could pick up: the creature we look at, or a player in front of us (on a server).
  P.carryTarget = function carryTarget() {
    const p = this.player;
    const m = this.aimMob;
    if (m && !m.removed && !m.deathTime && !m.carriedBy) {
      const b = m.body;
      const d = Math.hypot(b.pos[0] - p.pos[0], b.pos[1] + b.h / 2 - p.pos[1] - 1, b.pos[2] - p.pos[2]);
      if (d <= CARRY_RANGE + b.hw) return { kind: 'mob', e: m, ok: CARRYABLE.has(m.type) && !(m.def && m.def.hostile) };
    }
    const mp = this.mp;
    if (!mp) return null;
    const f = p.forward(), eye = p.eye;
    let best = null, bd = CARRY_RANGE;
    for (const o of mp.players.values()) {
      if (!o.pos || (o.dim | 0) !== (this.dimension | 0) || o.carriedBy || (o.flags & FLAG_DEAD)) continue;
      const dx = o.pos[0] - eye[0], dy = o.pos[1] + 0.9 - eye[1], dz = o.pos[2] - eye[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > bd || (dx * f[0] + dy * f[1] + dz * f[2]) / Math.max(d, 1e-3) < 0.8) continue;
      best = o; bd = d;
    }
    return best ? { kind: 'player', p: best, ok: true } : null;
  };

  // G / the carry button / D-pad right: pick up what is in front of us, or put down what we carry.
  P.toggleCarry = function toggleCarry() {
    if (this.carrying) { this.putDown(); return; }
    if (this.carriedBy || this.player.riding || this.sleeping || this.state !== 'playing') return;
    const tg = this.carryTarget();
    if (!tg) return;
    if (!tg.ok) { this.ui.toast(t(tg.e.def && tg.e.def.hostile ? 'carry.no' : 'carry.heavy'), 1800); return; }
    this.pickUp(tg);
  };

  P.pickUp = function pickUp(tg) {
    const mp = this.mp;
    if (tg.kind === 'mob') {
      const e = tg.e;
      e.carriedBy = 'local';
      e.carried = IN_ARMS.has(e.type) ? 'arms' : 'hold';
      this.carrying = { kind: 'mob', e };
      if (e.type === 'villager') this.villagerCarried(e, 'up');
      if (mp) mp.net.send({ t: 'carry', k: 'mob', ...this.netMobRef(e), on: 1 });
    } else {
      const o = tg.p;
      o.carriedBy = 'local';
      this.carrying = { kind: 'player', id: o.id };
      mp.net.send({ t: 'carry', k: 'player', id: o.id, on: 1 });
    }
    this.swing = 0;
    this.audio.sfx('pickup', 0.7, 0);
  };

  // Put down in front of us (on free ground) or, running, throw a little way forwards.
  P.putDown = function putDown(throwIt = this.player.sprinting) {
    const c = this.carrying;
    if (!c) return;
    this.carrying = null;
    const p = this.player;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const vel = throwIt ? [fx * 7, 4.5, fz * 7] : [0, 0, 0];
    if (c.kind === 'mob') {
      const e = c.e;
      e.carriedBy = null;
      e.carried = null;
      const spot = this.putDownSpot(e);
      e.body.pos = spot;
      e.prevPos = spot.slice();
      e.body.vel = vel.slice();
      e.body.fallDistance = 0;
      if (e.type === 'villager') this.villagerCarried(e, throwIt ? 'thrown' : 'down');
      if (this.mp) this.mp.net.send({ t: 'carry', k: 'mob', ...this.netMobRef(e), on: 0, p: spot.map((v) => Math.round(v * 100) / 100), v: vel });
    } else if (this.mp) {
      const o = this.mp.players.get(c.id);
      if (o) o.carriedBy = null;
      this.mp.net.send({ t: 'carry', k: 'player', id: c.id, on: 0, v: vel });
    }
    this.audio.sfx(throwIt ? 'swing' : 'place', 0.6, 0);
  };

  // In front of us at our feet if there is room, else beside or behind us, else where we stand.
  P.putDownSpot = function putDownSpot(e) {
    const p = this.player;
    const hw = e.body.hw, h = e.body.h;
    for (const k of [1.1, 0.7]) {
      for (const turn of [0, 0.7, -0.7, 1.57, -1.57, 2.4, -2.4, Math.PI]) {
        const a = p.yaw + turn;
        const x = p.pos[0] - Math.sin(a) * k, y = p.pos[1] + 0.05, z = p.pos[2] - Math.cos(a) * k;
        if (!this.world.boxCollides(x - hw, y, z - hw, x + hw, y + h, z + hw)) return [x, y, z];
      }
    }
    return [p.pos[0], p.pos[1] + 0.05, p.pos[2]];
  };

  // How the others on a server name a creature: whose game runs it, and its number there.
  P.netMobRef = function netMobRef(e) {
    const ref = e.ghost ? { o: e.owner, r: e.rid } : { o: this.mp.id, r: e.id };
    if (typeof e.uid === 'string') ref.u = e.uid;
    return ref;
  };
  P.findNetMob = function findNetMob(o, r, u) {
    const mp = this.mp;
    if (!mp) return null;
    if (o === mp.id) { const e = this.sim.entities.get(r); if (e && e.kind === 'mob') return e; }
    const g = mp.ghosts.get(o + ':' + r);
    if (g && !g.removed) return g;
    if (typeof u === 'string') for (const e of this.sim.entities.values()) if (e.kind === 'mob' && e.uid === u && !e.removed) return e;
    return null;
  };

  // A villager picked up, put down or thrown: what it says, what it thinks of it, a new home.
  P.villagerCarried = function villagerCarried(e, how) {
    const persona = this.villagerPersona(e);
    if (!persona) return;
    const L = LINES[getLanguage()] || LINES.zh;
    let key = how === 'up' && e.baby ? 'upChild' : how;
    // put down far from its home: it stays there
    if (how === 'down' && e.home && Math.hypot(e.body.pos[0] - e.home[0], e.body.pos[2] - e.home[2]) > NEW_HOME) {
      e.home = e.body.pos.map(Math.floor);
      key = 'home';
    }
    const text = pick(L[key] || L.up);
    const mood = how === 'thrown' ? 'angry' : key === 'home' || e.baby ? 'happy' : how === 'up' ? 'surprised' : 'neutral';
    this.onVillagerSay(persona.uid, text, mood, false);
    // (single player: it remembers; on a server, its memories live there)
    if (!this.mp) {
      const rec = this.soulOf(persona.uid);
      const zh = getLanguage() === 'zh';
      if (how === 'up') remember(rec, { note: zh ? `${this.playerName()}把我抱了起来` : `${this.playerName()} picked me up and carried me`, day: this.dayCount | 0 });
      if (how === 'thrown') { befriend(rec, -4); remember(rec, { note: zh ? `${this.playerName()}把我扔了出去` : `${this.playerName()} threw me`, day: this.dayCount | 0 }); }
      else if (how === 'down') befriend(rec, e.baby ? 3 : rec.f >= 60 ? 2 : -1);
    }
  };

  // Each frame (after moving): what we carry goes with us; what others carry, with them; and if
  // we are carried ourselves, we go with whoever carries us.
  P.updateCarry = function updateCarry() {
    const p = this.player;
    const c = this.carrying;
    if (c) {
      if (p.riding || this.sleeping || this.state === 'dead' || (this.ride && c.kind !== 'mob')) this.putDown(false);
      else if (c.kind === 'mob') {
        const e = c.e;
        if (e.removed || e.deathTime > 0 || !this.sim.entities.has(e.id)) this.carrying = null;
        // (in a flying saucer: in our arms where we sit, in its dome)
        else if (this.ride) { const s = seatAt(p.pos, this.ride.yaw, 'pilot'); this.holdAt(e, [s.pos[0], s.pos[1] + SEAT_H - 0.55, s.pos[2]], s.yaw); }
        else this.holdAt(e, p.pos, p.yaw);
      } else {
        const o = this.mp && this.mp.players.get(c.id);
        if (!o || (o.dim | 0) !== (this.dimension | 0)) this.carrying = null;
        else o.carriedBy = 'local';
      }
    }
    this.updateCarryButton();
    const mp = this.mp;
    if (mp && mp.carries) {
      for (const [from, cc] of mp.carries) {
        const who = mp.players.get(from);
        if (!who || !who.pos || (who.dim | 0) !== (this.dimension | 0)) continue;
        if (cc.kind === 'mob') {
          const e = this.findNetMob(cc.o, cc.r, cc.u);
          if (e) { e.carriedBy = from; this.holdAt(e, who.pos, who.yaw); }
        }
      }
    }
  };

  // (the touch screen's carry button shows when there is something to pick up, or to put down)
  P.updateCarryButton = function updateCarryButton() {
    if (!this.touch) return;
    let st = null;
    if (this.state === 'playing' && !this.carriedBy) {
      if (this.carrying) st = 'down';
      else { const tg = this.carryTarget(); if (tg && tg.ok) st = 'up'; }
    }
    this.touch.setCarry(st);
  };

  P.holdAt = function holdAt(e, pos, yaw) {
    const at = carriedAt(pos, yaw);
    e.body.pos = at.pos;
    e.prevPos = at.pos.slice();
    e.yaw = e.prevYaw = e.headYaw = at.yaw;
    e.carried = IN_ARMS.has(e.type) ? 'arms' : 'hold';
  };

  // Carried by another player: our place is in their arms, our view from there; jumping three
  // times wriggles free. (Called in place of moving the player.)
  P.followCarrier = function followCarrier(ctl) {
    const mp = this.mp;
    const who = mp && mp.players.get(this.carriedBy);
    const p = this.player;
    if (!who || !who.pos || (who.dim | 0) !== (this.dimension | 0)) { this.carriedBy = null; return; }
    const eye = carriedEye(who.pos, who.yaw);
    p.pos = [eye[0], eye[1] - p.eyeHeight, eye[2]];
    p.vel = [0, 0, 0];
    p.onGround = false;
    p.fallStart = null;
    // (a key press is counted as it comes, see struggleTap; a touch or a controller per frame)
    if (ctl.jumpPressed && !this.struggleKey) this.struggleTap();
    this.struggleKey = false;
  };

  // A jump while carried: three within a few seconds and we are free.
  P.struggleTap = function struggleTap(fromKey = false) {
    if (!this.carriedBy || !this.mp) return;
    if (fromKey) this.struggleKey = true;
    const now = performance.now();
    this.struggle = (this.struggle || []).filter((tm) => now - tm < 3000);
    this.struggle.push(now);
    if (this.struggle.length < 3) return;
    this.struggle = [];
    this.mp.net.send({ t: 'carry', k: 'free', id: this.carriedBy });
    this.carriedBy = null;
    this.player.vel = [0, 4, 0];
    this.ui.toast(t('carry.free'), 1800);
  };

  // What the server tells us of someone carrying something (or someone).
  P.onCarryMessage = function onCarryMessage(m) {
    const mp = this.mp;
    if (!mp) return;
    if (!mp.carries) mp.carries = new Map();
    const from = m.from;
    if (m.k === 'free') {
      // the one we carry wriggled free
      if (this.carrying && this.carrying.kind === 'player' && this.carrying.id === from) {
        this.carrying = null;
        const o = mp.players.get(from);
        if (o) o.carriedBy = null;
      }
      return;
    }
    const v = Array.isArray(m.v) && m.v.length === 3 && m.v.every(Number.isFinite) ? m.v : [0, 0, 0];
    if (m.k === 'player') {
      if (m.id === mp.id) {
        const who = mp.players.get(from);
        if (m.on) {
          this.carriedBy = from;
          this.struggle = [];
          if (this.carrying) this.putDown(false);
          this.ui.toast(t('carry.carried', { name: who ? who.name : '' }), 3000);
        } else if (this.carriedBy === from) {
          this.carriedBy = null;
          this.player.vel = v.slice();
          this.player.fallStart = null;
        }
      } else {
        const o = mp.players.get(m.id);
        if (o) o.carriedBy = m.on ? from : null;
      }
      if (m.on) mp.carries.set(from, { kind: 'player', id: m.id }); else mp.carries.delete(from);
      return;
    }
    if (m.k === 'mob') {
      const e = this.findNetMob(m.o, m.r, m.u);
      if (m.on) {
        mp.carries.set(from, { kind: 'mob', o: m.o, r: m.r, u: m.u });
        if (e) e.carriedBy = from;
      } else {
        mp.carries.delete(from);
        if (e) {
          e.carriedBy = null;
          e.carried = null;
          if (Array.isArray(m.p) && m.p.length === 3 && m.p.every(Number.isFinite)) { e.body.pos = m.p.slice(); e.prevPos = m.p.slice(); }
          if (!e.ghost) { e.body.vel = v.slice(); e.body.fallDistance = 0; }
        }
      }
    }
  };

  // Someone left the server: whatever they carried, and whoever carried us, is let go.
  P.carryPlayerLeft = function carryPlayerLeft(id) {
    const mp = this.mp;
    if (!mp) return;
    const cc = mp.carries && mp.carries.get(id);
    if (cc) {
      mp.carries.delete(id);
      if (cc.kind === 'mob') { const e = this.findNetMob(cc.o, cc.r, cc.u); if (e) { e.carriedBy = null; e.carried = null; } }
      else if (cc.id === mp.id) this.carriedBy = null;
      else { const o = mp.players.get(cc.id); if (o) o.carriedBy = null; }
    }
    if (this.carriedBy === id) this.carriedBy = null;
    if (this.carrying && this.carrying.kind === 'player' && this.carrying.id === id) this.carrying = null;
  };
}
