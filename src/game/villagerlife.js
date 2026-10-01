// The life of a village round the player:
// - what villagers show: a little picture rising over a head (a heart, a cross vein, a note, a !
//   or a ?, a tear) and what they do with their bodies (a nod, a shake of the head, a wave, a
//   cheer, a hop, a stamp of the foot), with what they say and how they feel;
// - what they make of what they see: a friend coming by (a wave), a monster seen off in the
//   village (a cheer, and they like you for it), their house knocked about (a telling-off), a
//   storm (everyone indoors), someone dropping out of the sky (they all come to look);
// - two neighbours stopping for a word, the conversation written by the server's model when
//   there is one (on a server, everyone near sees and hears the same one);
// - the places they tell of (real ones, found in the world's plan): a marker on the screen until
//   you get there, and the villager who told you is pleased when you do.
// Installed as methods on Game.prototype.

import {
  personaName, reactLine, offlineDialogue, cleanDialogue, compass, placeName, dirName, befriend, remember, foeName, clip,
} from '../sim/brain.js';
import { BLOCKS } from '../world/blocks.js';
import { carriedEye } from './carry.js';
import { projectToScreen } from '../net/multiplayer.js';
import { t, getLanguage } from '../ui/i18n.js';

const now = () => performance.now() / 1000;
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

// ---------------------------------------------------------------- the pictures
// little pixel pictures, row by row (a letter is a colour, '.' nothing)
const ICONS = {
  heart: [{ r: '#ec3a52', h: '#ffb8c3' }, ['.rr.rr.', 'rhrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...']],
  angry: [{ r: '#ff3b30' }, ['.rr.rr.', 'r.r.r.r', 'rr...rr', '.......', 'rr...rr', 'r.r.r.r', '.rr.rr.']],
  note: [{ b: '#62b6ff' }, ['...bb.', '...bbb', '...b.b', '...b..', '.bbb..', 'bbbb..', '.bb...']],
  alert: [{ y: '#ffd84a', Y: '#e0a000' }, ['yyY', 'yyY', 'yyY', 'yyY', '...', 'yyY']],
  ask: [{ w: '#f4f6ff', s: '#b9c4e6' }, ['.www.', 'ws.ww', '...ws', '..ws.', '..w..', '.....', '..w..']],
  drop: [{ b: '#4aa6ff', h: '#d6efff' }, ['..b..', '..b..', '.bbb.', 'bhbbb', 'bhbbb', 'bbbbb', '.bbb.']],
  sparkle: [{ y: '#ffe066', h: '#ffffff' }, ['...y...', '...y...', '..yyy..', 'yyyhyyy', '..yyy..', '...y...', '...y...']],
};
const iconUrls = {};
function iconUrl(kind) {
  if (iconUrls[kind]) return iconUrls[kind];
  const [pal, rows] = ICONS[kind];
  const h = rows.length, w = rows[0].length;
  let r = '';
  rows.forEach((row, y) => { for (let x = 0; x < w; x++) if (pal[row[x]]) r += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${pal[row[x]]}"/>`; });
  iconUrls[kind] = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${r}</svg>`)}")`;
  return iconUrls[kind];
}
export const EMOTES = Object.keys(ICONS);
export const GESTURES = ['nod', 'shake', 'wave', 'cheer', 'hop', 'stomp', 'droop', 'tremble'];

// how a feeling shows: [picture or null, gesture or null], one picked at random
const MOOD_SHOW = {
  happy: [['note', 'nod'], ['heart', 'hop'], [null, 'nod'], ['sparkle', null]],
  angry: [['angry', 'stomp'], ['angry', 'shake']],
  sad: [['drop', 'droop']],
  scared: [['alert', 'tremble'], ['drop', 'tremble']],
  surprised: [['alert', 'hop'], ['ask', null], ['alert', null]],
  neutral: [[null, 'nod'], [null, null], [null, null]],
};

// blocks of the land itself (and crops): nobody minds them dug up
const NATURAL = /^(stone|grass|dirt|sand|red_sand|gravel|water|lava|bedrock|snow|snowy_grass|ice|cactus|tall_grass|fern|poppy|dandelion|cornflower|dead_bush|clay|pumpkin|melon|farmland|vine|lily_pad|sugar_cane|pink_petals|cobweb|dirt_path|fire|netherrack|soul_sand|end_stone|obsidian)$|_ore$|_leaves$|_sapling$|^(wheat|carrots|potatoes|nether_wart)_\d$|^(moon|mars)_/;

// how close to a place counts as there: [across, up and down]
const REACHED = { village: [48, 60], mansion: [30, 40], temple: [18, 30], hut: [14, 30], outpost: [22, 40], monument: [36, 80], mineshaft: [22, 24], stronghold: [40, 40] };

// how long a line of a conversation stays before the next (seconds)
const lineTime = (s) => 1.6 + String(s).length * (/[㐀-鿿]/.test(s) ? 0.2 : 0.065);

export function installVillagerLife(Game) {
  const P = Game.prototype;

  P.setupVillagerLife = function setupVillagerLife(data) {
    if (this.emotes) for (const em of this.emotes.values()) em.el.remove();
    this.emotes = new Map(); // mob -> { el, until }
    this.lifeQueue = [];
    this.dialogue = null;
    this.reactTimer = 1;
    this.friendSeen = new Map(); // uid -> when it may wave again
    this.reactCool = new Map(); // uid:kind -> when it may again
    this.placedByMe = new Set();
    this.placeCache = null;
    this.stormNoticed = false;
    this.lastArrival = -99;
    this.lastGlide = -99;
    const w = data && data.wp;
    this.waypoint = w && REACHED[w.k] && [w.x, w.y, w.z].every(Number.isFinite) ? { k: w.k, x: w.x, y: w.y, z: w.z, uid: typeof w.uid === 'string' ? w.uid : '', by: clip(w.by, 16) } : null;
    this.updateWaypointButton();
  };

  // ---------------------------------------------------------------- faces and bodies
  P.villagerEmote = function villagerEmote(m, kind, delay = 0) {
    if (!m || !ICONS[kind] || !this.emotes) return;
    let em = this.emotes.get(m);
    if (!em) {
      const el = document.createElement('div');
      el.className = 'vemote';
      el.innerHTML = '<i></i>';
      // (hidden by visibility, not display: its rise keeps time while it's out of sight)
      el.style.visibility = 'hidden';
      document.getElementById('vbubbles').appendChild(el);
      em = { el };
      this.emotes.set(m, em);
    }
    const i = em.el.firstChild;
    i.style.backgroundImage = iconUrl(kind);
    // (start the rise again)
    i.style.animation = 'none';
    void i.offsetWidth;
    i.style.animation = '';
    i.style.animationDelay = delay ? delay.toFixed(2) + 's' : '';
    em.until = now() + 1.9 + delay;
  };

  P.villagerGesture = function villagerGesture(m, kind, seconds = 1.6, delay = 0) {
    if (!m || !GESTURES.includes(kind)) return;
    const t0 = now() + delay;
    m.gesture = { kind, t0, until: t0 + seconds };
  };

  // A feeling shows with the words (not over a gesture or a picture already going).
  P.villagerExpress = function villagerExpress(m, mood, text = '') {
    const opts = MOOD_SHOW[mood] || MOOD_SHOW.neutral;
    let [pic, ges] = opts[Math.floor(Math.random() * opts.length)];
    if (!pic && /[?？]\s*$/.test(text) && Math.random() < 0.5) pic = 'ask';
    const tn = now();
    const busy = m.gesture && tn < m.gesture.until;
    if (ges && !busy) this.villagerGesture(m, ges, ges === 'nod' ? 1.1 : 1.6);
    const showing = this.emotes.get(m);
    if (pic && (!showing || tn > showing.until - 0.6)) this.villagerEmote(m, pic);
  };

  P.updateEmotes = function updateEmotes() {
    if (!this.emotes || !this.emotes.size) return;
    const tn = now();
    const cam = this.camera;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const show = (this.state === 'playing' || this.state === 'talk' || this.state === 'chat') && !this.hudHidden && cam;
    const f = cam ? cam.forward : [0, 0, -1];
    const rl = Math.hypot(f[0], f[2]) || 1;
    const right = [-f[2] / rl, 0, f[0] / rl];
    const a = this.sim.alpha || 0;
    for (const [m, em] of this.emotes) {
      if (tn > em.until || m.removed) { em.el.remove(); this.emotes.delete(m); continue; }
      const x = m.prevPos[0] + (m.body.pos[0] - m.prevPos[0]) * a, y = m.prevPos[1] + (m.body.pos[1] - m.prevPos[1]) * a, z = m.prevPos[2] + (m.body.pos[2] - m.prevPos[2]) * a;
      // beside the face (the words go above it)
      const head = m.carried === 'arms' ? carriedEye([x, y, z], m.yaw).map((v, i) => (i === 1 ? v + 0.4 : v)) : [x, y + (m.baby ? 0.95 : 1.85), z];
      const s = m.baby ? 0.35 : 0.55;
      const at = show ? projectToScreen(cam, [head[0] + right[0] * s, head[1], head[2] + right[2] * s], w, h) : null;
      const dist = cam ? Math.hypot(head[0] - cam.pos[0], head[1] - cam.pos[1], head[2] - cam.pos[2]) : 99;
      const hide = !at || dist > 36;
      if (em.hide !== hide) { em.hide = hide; em.el.style.visibility = hide ? 'hidden' : ''; }
      if (hide) continue;
      const k = Math.max(0.55, Math.min(1.25, 9 / Math.max(dist, 1)));
      em.el.style.transform = `translate(${at[0].toFixed(1)}px, ${at[1].toFixed(1)}px) translate(-50%, -100%) scale(${k.toFixed(2)})`;
    }
  };

  // later, as long as the game goes on (not while paused)
  P.lifeLater = function lifeLater(seconds, fn) {
    this.lifeQueue.push({ at: now() + seconds, fn });
  };

  // ---------------------------------------------------------------- who is about
  P.villagersNear = function villagersNear(pos, r, { dy = 24, max = 8, ghosts = true } = {}) {
    const out = [];
    for (const e of this.sim.entities.values()) {
      if (e.kind !== 'mob' || e.type !== 'villager' || e.removed || e.deathTime > 0 || e.carriedBy) continue;
      if (!ghosts && e.ghost) continue;
      const d = flat(e.body.pos, pos);
      if (d < r && Math.abs(e.body.pos[1] - pos[1]) < dy) out.push([d, e]);
    }
    return out.sort((p, q) => p[0] - q[0]).slice(0, max).map((p) => p[1]);
  };

  // how much a villager likes us (0..100): our own records, or what a server last told us
  P.friendshipOf = function friendshipOf(uid) {
    if (this.mp) { const f = this.mpFriends && this.mpFriends.get(uid); return Number.isFinite(f) ? f : 30; }
    const r = this.souls && this.souls.get(uid);
    return r ? r.f : 30;
  };

  // one of these per villager per so long
  P.reactOnce = function reactOnce(uid, kind, seconds) {
    const key = uid + ':' + kind;
    const tn = now();
    if (tn < (this.reactCool.get(key) || 0)) return false;
    this.reactCool.set(key, tn + seconds);
    if (this.reactCool.size > 600) this.reactCool.delete(this.reactCool.keys().next().value);
    return true;
  };

  // A villager takes note of something done (its record here, or the server's): how it feels about
  // us, and a line to remember it by.
  P.villagerNote = function villagerNote(m, event, { amount = 0, note = '', item = '', first = false } = {}) {
    const per = this.villagerPersona(m);
    if (!per) return;
    if (this.mp) {
      const msg = { t: 'vnote', k: event, u: per.uid, j: per.job, l: getLanguage(), x: '', p: m.body.pos.map((v) => Math.round(v * 10) / 10), d: this.dimension | 0 };
      if (item) msg.it = item;
      if (first) msg.first = 1;
      this.mp.net.send(msg);
      return;
    }
    const rec = this.soulOf(per.uid);
    if (amount) befriend(rec, amount);
    if (note) remember(rec, { note, day: this.dayCount | 0 });
  };

  // a villager this game runs stops for a moment and turns to us
  const lookAtMe = (m, seconds) => { if (!m.ghost && !m.trading && !m.followId) { m.trading = 'local'; m.attendUntil = m.age + seconds; } };

  // ---------------------------------------------------------------- what they see you do
  // A monster seen off near the village: they cheer, and like you for it.
  P.villagersSeeKill = function villagersSeeKill(mob) {
    if (!mob || !mob.hostile || this.dimension || !this.sim) return;
    const near = this.villagersNear(mob.body.pos, 15, { max: 5 });
    if (!near.length) return;
    const lang = getLanguage();
    const who = this.playerName() || t('talk.you');
    near.forEach((v, i) => {
      this.villagerGesture(v, i % 3 === 2 ? 'hop' : 'cheer', 1.9, i * 0.18);
      this.villagerEmote(v, i % 2 ? 'heart' : 'note', i * 0.18);
      const per = this.villagerPersona(v);
      if (per && i < 4 && this.reactOnce(per.uid, 'hero', 60)) {
        this.villagerNote(v, 'hero', { amount: 2, item: mob.type, first: i === 0, note: lang === 'zh' ? `${who}在村里打跑了${foeName(mob.type, 'zh')}` : `${who} saw off ${foeName(mob.type, 'en')} in the village` });
      }
    });
    if (!this.mp && this.reactOnce('village', 'heroRumor', 120)) this.addRumor('hero', mob.type);
    const first = near[0], per = this.villagerPersona(first);
    if (per && this.reactOnce('village', 'cheerLine', 6)) this.lifeLater(0.4, () => this.onVillagerSay(per.uid, reactLine('cheer', { lang, playerName: this.playerName() }), 'happy'));
  };

  // A block of a house broken: its villager (or one standing right by it) tells you off.
  P.villagersSeeBreak = function villagersSeeBreak(x, y, z, block) {
    if (this.dimension || !this.sim) return;
    const key = x + ',' + y + ',' + z;
    if (this.placedByMe.delete(key)) return; // (our own scaffolding)
    const def = BLOCKS[block];
    if (!def || NATURAL.test(def.key)) return;
    const at = [x + 0.5, y + 0.5, z + 0.5];
    let who = null, bd = 1e9;
    for (const v of this.villagersNear(at, 30, { dy: 30, max: 12 })) {
      const home = v.home;
      const d = home ? Math.hypot(home[0] + 0.5 - at[0], home[2] + 0.5 - at[2]) : flat(v.body.pos, at);
      const mine = home ? d < 7.5 && Math.abs(home[1] - at[1]) < 7 : d < 4.5;
      if (mine && d < bd) { bd = d; who = v; }
    }
    if (!who) return;
    const per = this.villagerPersona(who);
    if (!per) return;
    lookAtMe(who, 2.5);
    if (this.reactOnce(per.uid, 'houseLine', 18)) {
      this.villagerGesture(who, 'stomp', 1.6);
      this.villagerEmote(who, 'angry');
      this.onVillagerSay(per.uid, reactLine('house', { lang: getLanguage(), playerName: this.playerName() }), 'angry');
    }
    if (this.reactOnce(per.uid, 'house', 30)) {
      const lang = getLanguage();
      this.villagerNote(who, 'house', { amount: -3, note: this.reactOnce(per.uid, 'houseNote', 600) ? (lang === 'zh' ? `${this.playerName() || '这个人'}拆过你家的东西` : `${this.playerName() || 'they'} knocked bits off your house`) : '' });
    }
  };

  // what we put up ourselves, we may take down again
  P.notePlaced = function notePlaced(x, y, z) {
    if (!this.placedByMe) return;
    this.placedByMe.add(x + ',' + y + ',' + z);
    if (this.placedByMe.size > 600) this.placedByMe.delete(this.placedByMe.values().next().value);
  };

  // Someone comes down out of the sky (kind: space, glide, fall, saucer): they all come to look.
  P.villagersSeeArrival = function villagersSeeArrival(kind, pos = this.player.pos) {
    if (this.dimension || !this.sim) return;
    const tn = now();
    if (tn - this.lastArrival < 45) return;
    const near = this.villagersNear(pos, 40, { dy: 40, max: 6 });
    if (!near.length) return;
    this.lastArrival = tn;
    const lang = getLanguage();
    near.forEach((v, i) => {
      this.villagerEmote(v, i < 3 ? 'alert' : 'ask', 0.15 + i * 0.25);
      this.villagerGesture(v, 'hop', 1.4, 0.15 + i * 0.25);
      if (!v.ghost && !v.followId && !v.trading && !v.baby) this.villagerFollow(v, 'local', 9 + Math.random() * 5);
    });
    const say = (v, d) => { const per = this.villagerPersona(v); if (per) this.lifeLater(d, () => this.onVillagerSay(per.uid, v.baby ? (lang === 'zh' ? '哇！再来一次！' : 'Wow! Do it again!') : reactLine(kind, { lang, playerName: this.playerName() }), 'surprised')); };
    say(near[0], 0.7);
    if (near[1]) say(near[1], 3.2);
  };

  // How we came down: after a landing (speed: how fast, fromSpace: in the space suit).
  P.noticeLanding = function noticeLanding(speed, fromSpace) {
    if (this.dimension) return;
    if (fromSpace) this.villagersSeeArrival('space');
    else if (now() - this.lastGlide < 1.2) this.villagersSeeArrival('glide');
    else if (speed > 22) this.villagersSeeArrival('fall');
  };

  // The weather as the villagers take it: 2 a thunderstorm, 1 rain (where it rains), 0 fair.
  P.villageWeather = function villageWeather() {
    if (this.dimension || !this.weather) return 0;
    if ((this.weather.storm || 0) > 0.5) return 2;
    return (this.weather.rain || 0) > 0.35 && this.precipType && this.precipType !== 'none' ? 1 : 0;
  };

  // Every second or so: friends wave as we come by; a storm sends everyone indoors.
  P.updateReactions = function updateReactions(dt) {
    if (this.player.gliding) this.lastGlide = now();
    this.reactTimer -= dt;
    if (this.reactTimer > 0) return;
    this.reactTimer = 1;
    const me = this.me();
    if (!me || me.dead || this.dimension || this.state !== 'playing') return;
    const tn = now();
    const lang = getLanguage();
    // a friend (60 and more) waves and calls out when we come near (every five minutes at most)
    if (!this.talk && tn - (this.lastFriendHello || -99) > 15) {
      for (const v of this.villagersNear(me.pos, 8, { dy: 6, max: 6 })) {
        if (v.baby) continue;
        const per = this.villagerPersona(v);
        if (!per || this.friendshipOf(per.uid) < 60 || tn < (this.friendSeen.get(per.uid) || 0)) continue;
        this.friendSeen.set(per.uid, tn + 300);
        this.lastFriendHello = tn;
        v.nextGreet = tn + 120; // (no ordinary hello on top of it)
        lookAtMe(v, 3);
        this.villagerGesture(v, 'wave', 2.4);
        this.villagerEmote(v, 'heart');
        this.onVillagerSay(per.uid, reactLine('friend', { lang, playerName: this.playerName() }), 'happy');
        break;
      }
    }
    // a thunderstorm: someone says so, and they all run home (see creatures.js)
    const storm = this.villageWeather();
    if (storm >= 2 && !this.stormNoticed) {
      this.stormNoticed = true;
      const near = this.villagersNear(me.pos, 32, { max: 5 });
      near.forEach((v, i) => { this.villagerEmote(v, i % 2 ? 'alert' : 'drop', i * 0.3); this.villagerGesture(v, 'tremble', 1.2, i * 0.3); });
      const per = near[0] && this.villagerPersona(near[0]);
      if (per) this.onVillagerSay(per.uid, reactLine('storm', { lang }), 'scared');
    } else if (storm === 0) this.stormNoticed = false;
    // monsters we saw off on a server (the game that runs them saw them die)
    for (const e of this.sim.entities.values()) {
      if (e.ghost && e.kind === 'mob' && e.deathTime > 0 && e.hitByMe && !e.cheered && tn - e.hitByMe < 3 && e.hostile) { e.cheered = true; this.villagersSeeKill(e); }
    }
  };

  // ---------------------------------------------------------------- two neighbours have a word
  P.villagerChatter = function villagerChatter() {
    const me = this.me();
    if (!me || this.dimension || this.dialogue || !this.sim.day || this.sim.storm >= 2) return false;
    // two this game runs, near us and near each other, neither busy
    const free = (e) => !e.ghost && !e.baby && !e.trading && !e.followId && !e.chatWith && e.mode !== 'flee' && !(e.gesture && now() < e.gesture.until);
    const near = this.villagersNear(me.pos, 18, { dy: 8, max: 10 }).filter(free);
    let best = null, bd = 9;
    for (let i = 0; i < near.length; i++) {
      for (let j = i + 1; j < near.length; j++) {
        const d = flat(near[i].body.pos, near[j].body.pos);
        if (d < bd) { bd = d; best = [near[i], near[j]]; }
      }
    }
    if (!best) return false;
    this.startDialogue(best[0], best[1]);
    return true;
  };

  // they come together and turn to each other (the ones this game runs)
  P.holdChat = function holdChat(a, b, seconds) {
    for (const [m, o] of [[a, b], [b, a]]) {
      if (m.ghost) continue;
      m.chatWith = o;
      m.chatUntil = m.age + seconds;
      m.chatHere = false;
      m.path = null;
    }
  };

  P.startDialogue = async function startDialogue(a, b) {
    const pa = this.villagerPersona(a), pb = this.villagerPersona(b);
    if (!pa || !pb) return;
    const lang = getLanguage();
    const ctx = this.villagerContext(a);
    if (this.mp) {
      // the server writes it and sends it to everyone near (us too), unless it's too soon after the
      // last one round here
      this.mp.net.send({ t: 'vchat', a: pa.uid, ja: pa.job, b: pb.uid, jb: pb.job, l: lang, p: a.body.pos.map((v) => Math.round(v * 10) / 10), d: this.dimension | 0, c: ctx });
      return;
    }
    // (a model takes a while to write it, up to half a minute: meanwhile they go about their
    // business, and meet when it's ready)
    const d = { a, b, lines: null, i: 0, next: 0, asked: now() };
    this.dialogue = d;
    let lines = null;
    if (this.hostServer && this.hostServer.ai === 'atria') {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 45000);
        const res = await fetch('./api/chat2', {
          method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ a: pa.uid, ja: pa.job, b: pb.uid, jb: pb.job, l: lang, c: ctx, rm: this.rumors.slice(-8), day: this.dayCount | 0, name: this.playerName() }),
        });
        clearTimeout(timer);
        if (res.ok) { const r = await res.json(); lines = cleanDialogue(r && r.lines); }
      } catch (e) { lines = null; }
    }
    if (this.dialogue !== d) return; // (the world changed meanwhile)
    if (!lines) lines = offlineDialogue({ a: pa, b: pb, lang, ctx, rumors: this.rumors || [], day: this.dayCount | 0, player: this.playerName() });
    this.playDialogue(pa.uid, pb.uid, lines);
  };

  // A conversation to play out (ours, or one a server sent): a line at a time, each over its
  // speaker's head and in its voice.
  P.playDialogue = function playDialogue(ua, ub, lines) {
    const a = this.villagerByUid(ua), b = this.villagerByUid(ub);
    lines = cleanDialogue(lines);
    const me = this.me();
    // (still near each other, and near enough to us to be seen and heard)
    const ok = a && b && lines && !a.carriedBy && !b.carriedBy && flat(a.body.pos, b.body.pos) < 13 && (!me || Math.min(flat(a.body.pos, me.pos), flat(b.body.pos, me.pos)) < 36);
    if (!ok) { this.dialogue = null; return; }
    let total = 0;
    for (const l of lines) total += lineTime(l[1]);
    this.holdChat(a, b, total + 6);
    this.dialogue = { a, b, lines, i: 0, next: now() + 0.4, started: now() };
  };

  P.updateDialogue = function updateDialogue() {
    const dl = this.dialogue;
    if (!dl) return;
    const tn = now();
    const { a, b } = dl;
    const end = () => {
      for (const m of [a, b]) if (!m.ghost && m.chatWith) m.chatUntil = m.age + 1;
      this.dialogue = null;
    };
    if (a.removed || b.removed || a.deathTime > 0 || b.deathTime > 0 || a.carriedBy || b.carriedBy) { end(); return; }
    if (!dl.lines) { if (tn - dl.asked > 50) this.dialogue = null; return; }
    if (dl.i >= dl.lines.length) { if (tn > dl.next) end(); return; }
    // the first line once they're face to face (or have had time to get there); each next one
    // when the last has been said (a few seconds more at most)
    const together = flat(a.body.pos, b.body.pos) < 3.2;
    if (tn < dl.next || (dl.i === 0 && !together && tn - dl.started < 5) || (this.speech.busy() && tn < dl.next + 4)) return;
    const [who, say, mood] = dl.lines[dl.i++];
    const m = who ? b : a, other = who ? a : b;
    const per = this.villagerPersona(m);
    if (per) this.onVillagerSay(per.uid, say, mood);
    if (Math.random() < 0.3 && !(other.gesture && tn < other.gesture.until)) this.villagerGesture(other, 'nod', 1, 0.6);
    dl.next = tn + lineTime(say);
  };

  // ---------------------------------------------------------------- places worth the trip
  // The places a villager here may have heard of (the nearest of each kind, and another village):
  // [{ k, x, y, z, d, dir }], nearest first.
  P.nearbyPlaces = function nearbyPlaces(pos) {
    if ((this.dimension | 0) !== 0 || !this.world) return [];
    const g = this.world.generator;
    const S = g && g.structures;
    if (!S) return [];
    const cell = Math.floor(pos[0] / 64) + ',' + Math.floor(pos[2] / 64);
    const c = this.placeCache;
    if (c && c.cell === cell && c.gen === g) return c.list;
    const out = [];
    const add = (k, x, y, z) => { const dx = x - pos[0], dz = z - pos[2]; out.push({ k, x, y, z, d: Math.hypot(dx, dz), dir: compass(dx, dz) }); };
    for (const k of ['temple', 'hut', 'outpost', 'monument', 'mansion', 'mineshaft']) {
      try { const r = S.locate(k, pos[0], pos[2], k === 'mineshaft' ? 500 : 1500); if (r) add(k, r.x, r.y, r.z); } catch (e) { /* not in this world */ }
    }
    try {
      let best = null, bd = 1400;
      for (const L of S.near('village', pos[0] - 1400, pos[2] - 1400, pos[0] + 1400, pos[2] + 1400)) {
        const d = Math.hypot(L.x - pos[0], L.z - pos[2]);
        if (d > 150 && d < bd) { bd = d; best = L; } // (not this one)
      }
      if (best) add('village', best.x, best.y, best.z);
    } catch (e) { /* no villages */ }
    if (g.strongholds) {
      let best = null, bd = 2600;
      for (const s of g.strongholds()) { const d = Math.hypot(s.x - pos[0], s.z - pos[2]); if (d < bd) { bd = d; best = s; } }
      if (best) add('stronghold', best.x, best.y, best.z);
    }
    out.sort((p, q) => p.d - q.d);
    const list = out.filter((p) => p.d > 12 && p.d < (p.k === 'stronghold' ? 2600 : 1500)).slice(0, 4);
    this.placeCache = { cell, gen: g, list };
    return list;
  };

  // A villager told us of a place: a marker on it until we get there.
  P.setWaypoint = function setWaypoint(kind, uid = '') {
    const me = this.me();
    const pos = me ? me.pos : this.player.pos;
    const list = (this.placeCache && this.placeCache.list) || this.nearbyPlaces(pos);
    const p = list.find((q) => q.k === kind) || this.nearbyPlaces(pos).find((q) => q.k === kind);
    if (!p) return;
    const m = uid ? this.villagerByUid(uid) : null;
    const per = m ? this.villagerPersona(m) : null;
    const lang = getLanguage();
    this.waypoint = { k: kind, x: p.x, y: p.y, z: p.z, uid, by: per ? personaName(per, lang) : '' };
    const d = Math.round(Math.hypot(p.x - pos[0], p.z - pos[2]) / 10) * 10;
    this.ui.toast(t('wp.set', { place: placeName(kind, lang), dir: dirName(compass(p.x - pos[0], p.z - pos[2]), lang), d }), 4200);
    this.audio.sfx('pickup', 0.5, 0);
    this.updateWaypointButton();
  };

  P.clearWaypoint = function clearWaypoint() {
    this.waypoint = null;
    this.ui.setWaypoint(null);
    this.updateWaypointButton();
  };

  P.updateWaypointButton = function updateWaypointButton() {
    if (this.ui && this.ui.setWaypointButton) this.ui.setWaypointButton(this.waypoint ? placeName(this.waypoint.k, getLanguage()) : null);
  };

  P.updateWaypoint = function updateWaypoint() {
    const wp = this.waypoint;
    const cam = this.camera;
    if (!wp || !cam || this.dimension || this.hudHidden || !(this.state === 'playing' || this.state === 'talk')) { this.ui.setWaypoint(null); return; }
    const me = this.me();
    const pos = me ? me.pos : this.player.pos;
    const across = Math.hypot(wp.x - pos[0], wp.z - pos[2]);
    const [rr, ry] = REACHED[wp.k] || [24, 40];
    if (across < rr && Math.abs(wp.y - pos[1]) < ry) { this.placeFound(wp); return; }
    // where it is on the screen, or the way to turn at the edge of it
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const f = cam.forward;
    let rx = -f[2], rz = f[0];
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    const ux = -rz * f[1], uy = rz * f[0] - rx * f[2], uz = rx * f[1];
    const x = wp.x + 0.5 - cam.pos[0], y = Math.max(wp.y, pos[1] - 40) + 3 - cam.pos[1], z = wp.z + 0.5 - cam.pos[2];
    const depth = x * f[0] + y * f[1] + z * f[2];
    const th = Math.tan((cam.fov || 1.2) / 2), aspect = w / Math.max(1, h);
    let sx = (x * rx + z * rz) / (Math.max(Math.abs(depth), 0.01) * th * aspect);
    let sy = (x * ux + y * uy + z * uz) / (Math.max(Math.abs(depth), 0.01) * th);
    const lang = getLanguage();
    const label = { name: placeName(wp.k, lang), dist: t('wp.dist', { d: Math.round(across) }) };
    if (depth > 0.3 && Math.abs(sx) < 0.9 && Math.abs(sy) < 0.86) {
      this.ui.setWaypoint({ ...label, at: [(sx * 0.5 + 0.5) * w, (0.5 - sy * 0.5) * h], angle: null });
      return;
    }
    // off the screen: at its edge, pointing the way
    if (depth <= 0.3) { sx = -sx; sy = -sy; if (Math.hypot(sx, sy) < 0.05) sy = -1; }
    const px = sx * w * 0.5, py = -sy * h * 0.5;
    const k = Math.min((w * 0.5 - 56) / Math.max(Math.abs(px), 1e-3), (h * 0.5 - 70) / Math.max(Math.abs(py), 1e-3));
    this.ui.setWaypoint({ ...label, at: [w * 0.5 + px * k, h * 0.5 + py * k], angle: Math.atan2(py, px) });
  };

  // There! The villager who told us is pleased (and will say so).
  P.placeFound = function placeFound(wp) {
    const lang = getLanguage();
    this.ui.toast(t('wp.found', { place: placeName(wp.k, lang) }) + (wp.by ? ' ' + t('wp.foundBy', { name: wp.by }) : ''), 4500);
    this.audio.sfx('levelup', 0.6, 0);
    this.waypoint = null;
    this.ui.setWaypoint(null);
    this.updateWaypointButton();
    if (!wp.uid) return;
    const who = this.playerName() || t('talk.you');
    if (this.mp) { this.mp.net.send({ t: 'vnote', k: 'found', u: wp.uid, j: 'none', l: lang, x: '', it: wp.k, p: [wp.x, wp.y, wp.z], d: 0 }); return; }
    const rec = this.soulOf(wp.uid);
    befriend(rec, 4);
    remember(rec, { note: lang === 'zh' ? `${who}按你说的找到了${placeName(wp.k, 'zh')}` : `${who} found the ${placeName(wp.k, 'en')} you told them of`, day: this.dayCount | 0 });
    this.addRumor('found', wp.k);
    // (if it's about, it says so)
    const m = this.villagerByUid(wp.uid);
    const me = this.me();
    if (m && me && flat(m.body.pos, me.pos) < 30) this.onVillagerSay(wp.uid, reactLine('found', { lang, place: wp.k }), 'happy');
  };

  // ---------------------------------------------------------------- every frame
  P.updateVillagerLife = function updateVillagerLife(dt) {
    if (!this.sim || !this.emotes) return;
    this.updateEmotes();
    this.updateWaypoint();
    if (this.state !== 'playing' && this.state !== 'talk') return;
    const tn = now();
    if (this.lifeQueue.length) {
      const due = this.lifeQueue.filter((q) => q.at <= tn);
      if (due.length) { this.lifeQueue = this.lifeQueue.filter((q) => q.at > tn); for (const q of due) q.fn(); }
    }
    this.updateDialogue();
    this.updateReactions(dt);
  };
}
