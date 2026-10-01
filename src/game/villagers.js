// Talking with villagers, on the player's side: the talk screen (what was said, a few ready-made
// questions, typing or speaking a line), the villager's answer from the server's mind (the user's
// language model) or from the scripted one when there is no server or no model, its words over
// its head and in its own voice, and what it does about it: a task (and handing it in), a
// present, a discount on its trades, following you about. In a single-player game the villagers'
// memories live in the save; on a server, with the server. Also: a word in passing when you walk
// by, and remembering being punched. (What villagers show and do, what they make of what they
// see, their conversations with each other and the places they tell of: villagerlife.js.)
// Installed as methods on Game.prototype.

import {
  personaFor, personaName, jobName, offlineReply, cleanAction, applyAction, remember, befriend, feelingFor, newRecord, cleanRecord,
  cleanRumor, ambientLine, stuffId, stuffName, hearts, discountToday, clip,
} from '../sim/brain.js';
import { JOB_LIST } from '../sim/looks.js';
import { itemDef } from '../sim/items.js';
import { BLOCKS } from '../world/blocks.js';
import { Speech, canListen, listenOnce, stopListening } from './speech.js';
import { carriedEye } from './carry.js';
import { projectToScreen, loadMultiplayerPrefs } from '../net/multiplayer.js';
import { t, getLanguage } from '../ui/i18n.js';

const TALK_RANGE = 7; // how close you must be to start talking
const LEAVE_RANGE = 12; // walk further than this and the conversation is over
const HEAR_RANGE = 28; // how far a villager's voice carries
const BUBBLE_RANGE = 40;
const MAX_RUMORS = 40;
const bubbleTime = (text) => 3.2 + String(text).length * 0.11;
const now = () => performance.now() / 1000;

export function installVillagers(Game) {
  const P = Game.prototype;

  // ---------------------------------------------------------------- with the world
  P.setupVillagers = function setupVillagers(data) {
    const souls = data && data.souls && typeof data.souls === 'object' ? data.souls : {};
    this.souls = new Map();
    for (const [uid, r] of Object.entries(souls).slice(0, 3000)) if (/^[\w.:-]{1,40}$/.test(uid)) this.souls.set(uid, cleanRecord(r));
    this.rumors = (data && Array.isArray(data.rumors) ? data.rumors : []).map(cleanRumor).filter(Boolean).slice(-MAX_RUMORS);
    if (this.bubbles) for (const b of this.bubbles.values()) b.el.remove();
    this.bubbles = new Map();
    this.talk = null;
    this.ambientTimer = 4;
    this.chatterTimer = 30;
    this.lastHitTalk = new Map();
    if (!this.speech) this.speech = new Speech();
    this.speech.enabled = this.settings.villagerVoice !== false;
    this.speech.volume = this.settings.villagerVolume ?? 1;
    this.mpFriends = new Map(); // (on a server: how much each villager likes us, as it last said)
    this.setupVillagerLife(this.mp ? null : data);
  };

  P.serializeVillagers = function serializeVillagers() {
    // on a server the memories are the server's
    if (this.mp || !this.souls) return {};
    return { souls: Object.fromEntries(this.souls), rumors: this.rumors || [], wp: this.waypoint || null };
  };

  // Something the village will talk about (single player; a server keeps its own gossip).
  P.addRumor = function addRumor(k, s = '') {
    if (this.mp || !this.rumors) return;
    const who = this.playerName() || t('talk.you');
    const r = cleanRumor({ k, who, s, day: this.dayCount | 0 });
    if (!r) return;
    const last = this.rumors[this.rumors.length - 1];
    if (last && last.k === r.k && last.s === r.s && last.day === r.day) return;
    this.rumors.push(r);
    while (this.rumors.length > MAX_RUMORS) this.rumors.shift();
  };

  P.playerName = function playerName() {
    if (this.mp) return this.mp.name;
    const prefs = loadMultiplayerPrefs();
    return clip(prefs.name || '', 16);
  };

  // ---------------------------------------------------------------- who a villager is
  P.villagerUid = function villagerUid(m) {
    if (!m) return null;
    if (m.ghost) return typeof m.uid === 'string' ? m.uid : null;
    if (!m.uid) this.serializeCreature(m); // (gives it its lasting name)
    return m.uid;
  };
  P.villagerJob = (m) => JOB_LIST[m.variant | 0] || 'none';
  P.villagerPersona = function villagerPersona(m) {
    const uid = this.villagerUid(m);
    if (!uid) return null;
    const job = this.villagerJob(m);
    if (!m.persona || m.persona.uid !== uid || m.persona.job !== job) m.persona = personaFor(uid, job);
    return m.persona;
  };
  P.villagerByUid = function villagerByUid(uid) {
    if (!uid || !this.sim) return null;
    for (const e of this.sim.entities.values()) if (e.kind === 'mob' && e.type === 'villager' && !e.removed && e.uid === uid) return e;
    return null;
  };
  P.soulOf = function soulOf(uid) {
    let r = this.souls.get(uid);
    if (!r) { r = newRecord(this.dayCount | 0); this.souls.set(uid, r); }
    return r;
  };

  // The moment, as a villager sees it.
  P.villagerContext = function villagerContext(m) {
    const lang = getLanguage();
    const hour = ((this.dayTime || 0) * 24 + 6) % 24;
    const phase = hour < 5 || hour >= 19.5 ? 'night' : hour < 10 ? 'morning' : hour < 17 ? 'day' : 'evening';
    const w = this.weather || {};
    const weather = (w.storm || 0) > 0.5 ? 'storm' : (w.rain || 0) > 0.3 ? (this.precipType === 'snow' ? 'snow' : 'rain') : 'clear';
    let biome = '';
    try {
      const col = this.world.generator.column(Math.floor(m.body.pos[0]), Math.floor(m.body.pos[2]));
      const names = t('biomes').split('|');
      biome = names[col.biome] || '';
    } catch (e) { /* no generator column here */ }
    const me = this.me();
    const chest = this.inventory && this.inventory.armor[1] ? itemDef(this.inventory.armor[1].id) : null;
    const held = this.heldSlot();
    let danger = 0;
    for (const e of this.sim.entities.values()) {
      if (e.kind !== 'mob' || !e.hostile || e.deathTime > 0) continue;
      const p = e.body.pos, q = m.body.pos;
      if ((p[0] - q[0]) ** 2 + (p[2] - q[2]) ** 2 < 18 * 18) danger++;
    }
    const keyOf = (id) => (id >= 256 ? (itemDef(id) || {}).key : (BLOCKS[id] || {}).key) || '';
    // the places round about it may have heard of (which way, how far)
    const places = this.nearbyPlaces(m.body.pos).map((q) => ({ k: q.k, dir: q.dir, d: Math.round(q.d) }));
    return {
      phase, weather, biome, held: held ? keyOf(held.id) : '', armor: chest && chest.material ? chest.material : '',
      hp: me ? me.health : 20, food: me && me.food !== undefined ? me.food : 20, danger, lang, places,
    };
  };

  P.villagerNeighbors = function villagerNeighbors(m) {
    const out = [];
    const lang = getLanguage();
    for (const e of this.sim.entities.values()) {
      if (e === m || e.kind !== 'mob' || e.type !== 'villager' || e.removed || e.baby) continue;
      const p = e.body.pos, q = m.body.pos;
      if ((p[0] - q[0]) ** 2 + (p[2] - q[2]) ** 2 > 40 * 40) continue;
      const per = this.villagerPersona(e);
      if (per) out.push({ name: personaName(per, lang), job: per.job });
      if (out.length >= 6) break;
    }
    return out;
  };

  // ---------------------------------------------------------------- the talk screen
  P.openTalk = function openTalk(m) {
    const persona = this.villagerPersona(m);
    if (!persona) { this.ui.toast(t('talk.cannot'), 2200); return false; }
    const me = this.me();
    if (me && Math.hypot(me.pos[0] - m.body.pos[0], me.pos[2] - m.body.pos[2]) > TALK_RANGE + 1) return false;
    this.speech.unlock();
    this.audio.unlock();
    if (!this.speech.ok && this.settings.villagerVoice !== false && !this.noVoiceHinted) {
      this.noVoiceHinted = true;
      this.ui.toast(t('talk.noVoice'), 5000);
    }
    const uid = persona.uid;
    this.talk = { mob: m, uid, persona, lines: [], waiting: false, rec: this.mp ? null : this.soulOf(uid), ai: this.mp ? null : (this.hostServer && this.hostServer.ai) || 'offline', opened: now() };
    this.state = 'talk';
    this.input.enabled = false;
    this.input.keys.clear();
    this.input.buttons.clear();
    this.input.exitLock();
    if (this.touch) this.touch.show(false);
    // the villager stops and turns to us (on a server, whoever runs it is told to)
    if (!m.ghost) { m.trading = 'local'; m.attendUntil = m.age + 90; }
    if (this.mp) this.mp.net.send({ t: 'vopen', u: uid, d: this.dimension | 0 });
    this.renderTalk();
    this.ui.show('talk');
    requestAnimationFrame(() => this.frameTalkCamera());
    this.audio.sfx('villager', 0.6, 0);
    // a greeting: the villager speaks first
    this.talkSend('', { greeting: true });
    return true;
  };

  P.closeTalk = function closeTalk() {
    const tk = this.talk;
    if (!tk) return;
    this.talk = null;
    stopListening();
    const m = tk.mob;
    if (!m.ghost && m.trading === 'local') m.trading = null;
    if (this.mp) this.mp.net.send({ t: 'vclose', u: tk.uid, d: this.dimension | 0 });
    if (this.state === 'talk') {
      this.ui.show(null);
      this.state = 'playing';
      this.input.enabled = true;
      if (this.touch) this.touch.show(true);
      const padUser = this.pads.connected && performance.now() - this.pads.lastActive < 1500;
      if (!this.input.lockFailed && !this.touch && !padUser) this.input.requestLock();
    }
  };

  // Turn to the villager so its face stays in view beside (or above) the talk panel.
  P.frameTalkCamera = function frameTalkCamera() {
    const tk = this.talk;
    if (!tk || !this.camera) return;
    const m = tk.mob, eye = this.player.eye;
    const head = [m.body.pos[0], m.body.pos[1] + (m.baby ? 0.85 : 1.62), m.body.pos[2]];
    const dx = head[0] - eye[0], dy = head[1] - eye[1], dz = head[2] - eye[2];
    let yaw = Math.atan2(-dx, -dz);
    let pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const lay = this.ui.talkLayout();
    const half = Math.tan((this.camera.fov || 1.3) / 2);
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    // the villager in the middle of what the panel leaves free
    if (lay.side === 'right') yaw -= Math.atan(lay.frac * half * aspect);
    else pitch -= Math.atan(lay.frac * half);
    tk.cam = { yaw, pitch: Math.max(-1.3, Math.min(1.3, pitch)), t: 0 };
  };

  // What the screen shows: name, job, hearts, the conversation, the task, what can be given.
  P.renderTalk = function renderTalk() {
    const tk = this.talk;
    if (!tk) return;
    const lang = getLanguage();
    const p = tk.persona;
    const rec = tk.rec || newRecord();
    const q = rec.quest;
    let quest = null;
    if (q) {
      const id = stuffId(q.want);
      quest = { text: t('talk.quest', { name: personaName(p, lang), item: stuffName(q.want, lang), n: q.count, have: id ? this.inventory.count(id) : 0, reward: stuffName(q.reward, lang), rn: q.rewardCount }), ready: id && this.inventory.count(id) >= q.count };
    }
    const held = this.heldSlot();
    const heldName = held ? this.stackName(held.id) : '';
    const disc = discountToday(rec, this.dayCount | 0);
    this.ui.renderTalk({
      name: personaName(p, lang), job: jobName(p.job, lang) + (disc ? ' · ' + t('talk.discount', { pct: disc }) : ''), hearts: hearts(rec), lines: tk.lines, waiting: tk.waiting,
      quest, gift: heldName ? t('talk.gift', { item: heldName }) : '', canTrade: !tk.mob.baby && (!tk.mob.ghost || !!tk.mob.tradeSeed), canListen: canListen() && !this.listenBroken,
      brain: tk.ai === 'atria' ? t('talk.brainAi') : tk.ai === 'offline' ? t('talk.brainOffline') : '',
      quick: t('talk.quickList').split('|'),
    });
  };

  P.stackName = function stackName(id) {
    const d = id >= 256 ? itemDef(id) : BLOCKS[id];
    if (!d) return '';
    return getLanguage() === 'zh' && d.zh ? d.zh : d.name || d.key;
  };

  // A line from the player (or, empty, the villager greeting them), and the villager's answer.
  P.talkSend = function talkSend(text, { greeting = false, event = null, item = '', itemName = '' } = {}) {
    const tk = this.talk;
    if (!tk) return;
    const line = clip(text, 200);
    if (!greeting && !event && !line) return;
    if (tk.waiting && !event) return;
    if (line) tk.lines.push({ me: true, text: line });
    tk.waiting = true;
    this.renderTalk();
    this.askVillager(tk.mob, { line, event, item, itemName, talkScreen: true });
  };

  // Ask a villager something (a line, or something that happened): the server's mind when there
  // is one, the scripted one otherwise. The answer comes back to onVillagerSay.
  P.askVillager = async function askVillager(m, { line = '', event = null, item = '', itemName = '', talkScreen = false } = {}) {
    const persona = this.villagerPersona(m);
    if (!persona) return;
    const uid = persona.uid, job = persona.job;
    const lang = getLanguage();
    const ctx = this.villagerContext(m);
    const neighbors = this.villagerNeighbors(m);
    const pos = m.body.pos.map((v) => Math.round(v * 10) / 10);
    if (this.mp) {
      const msg = { t: event ? 'vnote' : 'talk', u: uid, j: job, l: lang, x: line, p: pos, d: this.dimension | 0, c: ctx, nb: neighbors };
      if (event) { msg.k = event; if (item) msg.it = item; if (itemName) msg.n = itemName; }
      if (m.baby) msg.b = 1;
      this.mp.net.send(msg);
      return;
    }
    // single player: the memories are ours, and travel with the question
    const rec = this.soulOf(uid);
    const day = this.dayCount | 0;
    const quest = rec.quest;
    let r = null;
    if (this.hostServer && this.hostServer.ai === 'atria') {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 47000); // (the server gives the model 40 s)
        const res = await fetch('./api/talk', {
          method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ u: uid, j: job, l: lang, name: this.playerName(), x: line, r: rec, c: ctx, nb: neighbors, rm: this.rumors.slice(-8), day, k: event, it: item, n: itemName, b: m.baby ? 1 : 0 }),
        });
        clearTimeout(timer);
        if (res.ok) r = await res.json();
      } catch (e) { r = null; }
    }
    if (!r || typeof r.say !== 'string') {
      r = offlineReply({ persona, lang, playerName: this.playerName(), line, rec, ctx, neighbors, rumors: this.rumors, day, event, item, itemName, baby: !!m.baby });
      r.offline = true;
    }
    if (this.talk && this.talk.uid === uid) this.talk.ai = r.offline ? (this.hostServer && this.hostServer.ai === 'atria' ? 'busy' : 'offline') : 'atria';
    const action = cleanAction(r.action, { job, rec, day, places: ctx.places });
    if (event === 'deliver' && quest) rec.quest = null;
    applyAction(rec, action, day);
    remember(rec, { line: line || (event && item ? `（${itemName || item}）` : ''), reply: r.say, day });
    if (!event) befriend(rec, feelingFor({ line, action }));
    if (line && Math.random() < 0.12) this.addRumor('talk', clip(line, 24));
    this.onVillagerSay(uid, r.say, r.mood, true);
    this.onVillagerAction(uid, action);
  };

  // What the voice test found, in words: what works, or what to do about it.
  P.voiceReport = function voiceReport(r, lang) {
    const st = this.speech.status(lang);
    const off = this.settings.villagerVoice === false ? ' ' + t('voice.r.off') : '';
    if (r === 'unsupported' || !st.ok) return t('voice.r.unsupported');
    if (r === 'ok') return (st.voice ? t('voice.r.ok', { voice: st.voice, n: st.matching }) : t('voice.r.okDefault')) + off;
    if (st.total > 0 && st.matching === 0) return t('voice.r.novoice') + off;
    if (r === 'not-allowed') return t('voice.r.notAllowed');
    if (r === 'silent') return t('voice.r.silent') + off;
    return t('voice.r.error', { err: r }) + off;
  };

  // A villager speaks (ours or, on a server, anyone's): over its head, in its voice, and on the
  // talk screen when that is who we are talking to.
  P.onVillagerSay = function onVillagerSay(uid, text, mood = 'neutral', toMe = false) {
    const m = this.villagerByUid(uid);
    const tk = this.talk;
    if (tk && tk.uid === uid && toMe) {
      tk.lines.push({ me: false, text, mood });
      while (tk.lines.length > 40) tk.lines.shift();
      tk.waiting = false;
      this.renderTalk();
    }
    if (!m) return;
    this.showBubble(m, text);
    const persona = this.villagerPersona(m);
    const cam = this.camera ? this.camera.pos : this.player.eye;
    const d = Math.hypot(m.body.pos[0] - cam[0], m.body.pos[1] + 1.6 - cam[1], m.body.pos[2] - cam[2]);
    const vol = toMe && tk && tk.uid === uid ? 1 : Math.max(0, Math.min(1, 1 - (d - 4) / (HEAR_RANGE - 4)));
    if (persona && vol > 0.02) {
      const ok = this.speech.speak(text, { lang: getLanguage(), pitch: persona.voice.pitch, rate: persona.voice.rate, volume: vol, gender: persona.gender });
      if (!ok) this.audio.sfx(mood === 'angry' ? 'villagerNo' : mood === 'happy' ? 'villagerYes' : 'villager', 0.5 * vol, 0);
    }
    m.talkUntil = now() + bubbleTime(text) * 0.6;
    if (mood === 'angry' || mood === 'sad') this.audio.sfx('villagerNo', 0.35 * vol, 0);
    this.villagerExpress(m, mood, text);
  };

  // What the villager decided to do for the player it was talking to.
  P.onVillagerAction = function onVillagerAction(uid, a, rec = null) {
    if (rec && this.talk && this.talk.uid === uid) this.talk.rec = { ...newRecord(), ...rec };
    if (!a) { if (this.talk && this.talk.uid === uid) this.renderTalk(); return; }
    const m = this.villagerByUid(uid);
    const persona = m ? this.villagerPersona(m) : personaFor(uid, 'none');
    const name = personaName(persona, getLanguage());
    if (a.type === 'gift') {
      const id = stuffId(a.item);
      if (id) {
        const left = this.inventory.add(id, a.count);
        if (left > 0) { const p = this.player.pos; this.sim.dropItem(id, left, p[0], p[1] + 0.5, p[2], [0, 2, 0], 0, { delay: 1 }); }
        this.audio.sfx('pickup', 0.7, 0);
        this.ui.toast(t('talk.gotGift', { name, n: a.count, item: this.stackName(id) }), 3000);
      }
    } else if (a.type === 'quest') {
      this.ui.toast(t('talk.newQuest', { name, n: a.count, item: stuffName(a.want, getLanguage()) }), 3000);
    } else if (a.type === 'discount') {
      this.ui.toast(t('talk.gotDiscount', { name, pct: a.pct }), 3000);
    } else if (a.type === 'follow' && m && !m.ghost && !this.mp) {
      this.villagerFollow(m, 'local', a.seconds);
    } else if (a.type === 'rumor') {
      this.setWaypoint(a.place, uid);
    }
    if (this.talk && this.talk.uid === uid) this.renderTalk();
  };

  // A villager (one this game runs) follows a player for a while; 0 seconds: it stops.
  P.villagerFollow = function villagerFollow(m, who, seconds) {
    if (!m || m.ghost) return;
    if (seconds > 0) { m.followId = who; m.followUntil = m.age + seconds; m.path = null; } else { m.followId = null; m.followUntil = 0; }
  };

  // Things done to a villager.
  P.villagerHit = function villagerHit(m) {
    if (!m || m.type !== 'villager' || m.deathTime > 0) return;
    const uid = this.villagerUid(m);
    if (!uid) return;
    const lang = getLanguage();
    if (!this.mp) {
      const rec = this.soulOf(uid);
      befriend(rec, feelingFor({ event: 'hit' }));
      remember(rec, { note: lang === 'zh' ? `${this.playerName() || '这个人'}打过你` : `${this.playerName() || 'this one'} hit you`, day: this.dayCount | 0 });
      this.addRumor('hit', personaName(this.villagerPersona(m), lang));
    }
    // one complaint every few seconds, not one per punch
    const last = this.lastHitTalk.get(uid) || 0;
    if (now() - last < 5) return;
    this.lastHitTalk.set(uid, now());
    if (this.mp) { this.askVillager(m, { event: 'hit' }); return; }
    const r = offlineReply({ persona: this.villagerPersona(m), lang, event: 'hit', rec: this.soulOf(uid) });
    this.onVillagerSay(uid, r.say, r.mood, !!(this.talk && this.talk.uid === uid));
  };

  // The talk screen's buttons.
  P.talkDeliver = function talkDeliver() {
    const tk = this.talk;
    if (!tk || tk.waiting) return;
    const rec = tk.rec;
    const q = rec && rec.quest;
    if (!q) return;
    const id = stuffId(q.want), rid = stuffId(q.reward);
    if (!id || !rid || this.inventory.count(id) < q.count) { this.audio.sfx('villagerNo', 0.6, 0); return; }
    this.inventory.take(id, q.count);
    const left = this.inventory.add(rid, q.rewardCount);
    if (left > 0) { const p = this.player.pos; this.sim.dropItem(rid, left, p[0], p[1] + 0.5, p[2], [0, 2, 0], 0, { delay: 1 }); }
    this.inventory.changed();
    this.audio.sfx('villagerYes', 0.8, 0);
    this.ui.toast(t('talk.questDone', { n: q.rewardCount, item: this.stackName(rid) }), 3000);
    if (!this.mp) {
      befriend(rec, feelingFor({ event: 'deliver' }));
      rec.done = (rec.done | 0) + 1;
      remember(rec, { note: getLanguage() === 'zh' ? `${this.playerName() || '这个人'}帮你找来了${q.count}个${stuffName(q.want, 'zh')}` : `${this.playerName() || 'they'} brought you ${q.count} ${stuffName(q.want, 'en')}`, day: this.dayCount | 0 });
      this.addRumor('quest', personaName(tk.persona, getLanguage()));
    } else rec.quest = null; // (the server clears its copy when it hears)
    this.talkSend('', { event: 'deliver', item: q.want, itemName: stuffName(q.want, getLanguage()) });
  };

  P.talkGift = function talkGift() {
    const tk = this.talk;
    const held = this.heldSlot();
    if (!tk || tk.waiting || !held) return;
    const d = held.id >= 256 ? itemDef(held.id) : BLOCKS[held.id];
    const key = d ? d.key : '';
    const name = this.stackName(held.id);
    this.inventory.consume(this.selected, 1);
    this.audio.sfx('pickup', 0.6, 0);
    if (!this.mp) {
      const rec = this.soulOf(tk.uid);
      befriend(rec, feelingFor({ event: 'gift' }));
      remember(rec, { note: getLanguage() === 'zh' ? `${this.playerName() || '这个人'}送过你${name}` : `${this.playerName() || 'they'} gave you ${name}`, day: this.dayCount | 0 });
      this.addRumor('gift', personaName(tk.persona, getLanguage()));
    }
    this.talkSend('', { event: 'gift', item: key, itemName: name });
  };

  // The discount this villager gives us today (talked into it), in percent.
  P.tradeDiscount = function tradeDiscount(m) {
    const uid = m && m.type === 'villager' ? this.villagerUid(m) : null;
    if (!uid) return 0;
    const day = this.dayCount | 0;
    if (this.mp) { const d = this.mpDiscounts && this.mpDiscounts.get(uid); return d && d.day === day ? d.pct : 0; }
    return discountToday(this.souls && this.souls.get(uid), day);
  };

  // A trade done: a little more liked, and now and then a word about it.
  P.villagerTraded = function villagerTraded(m) {
    const uid = this.villagerUid(m);
    if (!uid) return;
    if (this.mp) { this.askVillager(m, { event: 'trade' }); return; } // (the server decides whether it says anything)
    const rec = this.soulOf(uid);
    befriend(rec, feelingFor({ event: 'trade' }));
    if (Math.random() < 0.3) {
      const r = offlineReply({ persona: this.villagerPersona(m), lang: getLanguage(), event: 'trade', rec });
      this.onVillagerSay(uid, r.say, r.mood);
    }
  };

  P.talkTrade = function talkTrade() {
    const tk = this.talk;
    if (!tk || tk.mob.baby || (tk.mob.ghost && !tk.mob.tradeSeed)) return;
    const m = tk.mob;
    this.closeTalk();
    this.openTrading(m);
  };

  // Speaking instead of typing (where the browser can).
  P.talkListen = async function talkListen() {
    const tk = this.talk;
    if (!tk || tk.waiting || this.listening) return;
    this.listening = true;
    this.ui.setTalkListening(true);
    try {
      const text = await listenOnce(getLanguage(), { onPartial: (s) => this.ui.setTalkDraft(s) });
      this.ui.setTalkDraft('');
      if (text && this.talk === tk) this.talkSend(text);
    } catch (e) {
      // e.g. Chrome's recogniser lives on servers that can't be reached from everywhere
      if (e.message !== 'not-allowed') this.listenBroken = true;
      this.ui.toast(t(e.message === 'not-allowed' ? 'talk.micDenied' : 'talk.micFail'), 3500);
      this.renderTalk();
    } finally {
      this.listening = false;
      this.ui.setTalkListening(false);
    }
  };

  // ---------------------------------------------------------------- words over heads
  P.showBubble = function showBubble(m, text) {
    const uid = m.uid || 'e' + m.id;
    let b = this.bubbles.get(uid);
    if (!b) { b = { el: this.ui.createBubble(), mob: m }; this.bubbles.set(uid, b); }
    b.mob = m;
    b.until = now() + bubbleTime(text);
    const per = this.villagerPersona(m);
    this.ui.setBubble(b.el, per ? personaName(per, getLanguage()) : '', text);
  };

  // Every frame: the bubbles follow their villagers; a word in passing now and then; the talk
  // screen ends when either of you walks off.
  P.updateVillagers = function updateVillagers(dt) {
    if (!this.sim || !this.bubbles) return;
    const tnow = now();
    const cam = this.camera;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const show = (this.state === 'playing' || this.state === 'talk' || this.state === 'chat') && !this.hudHidden;
    for (const [uid, b] of this.bubbles) {
      const m = b.mob;
      if (tnow > b.until || !m || m.removed) { b.el.remove(); this.bubbles.delete(uid); continue; }
      const a = this.sim.alpha || 0;
      const x = m.prevPos[0] + (m.body.pos[0] - m.prevPos[0]) * a, y = m.prevPos[1] + (m.body.pos[1] - m.prevPos[1]) * a, z = m.prevPos[2] + (m.body.pos[2] - m.prevPos[2]) * a;
      // (in someone's arms: over its head there, to their left)
      const head = m.carried === 'arms' ? carriedEye([x, y, z], m.yaw).map((v, i) => (i === 1 ? v + 0.75 : v)) : [x, y + (m.baby ? 1.3 : 2.35), z];
      const dist = cam ? Math.hypot(head[0] - cam.pos[0], head[1] - cam.pos[1], head[2] - cam.pos[2]) : 99;
      const at = show && cam && dist < BUBBLE_RANGE ? projectToScreen(cam, head, w, h) : null;
      this.ui.placeBubble(b.el, at, dist, tnow > b.until - 0.6);
    }
    // the villager we look at: its name over its head
    this.updateVillagerTag();
    this.updateVillagerLife(dt);
    const tk = this.talk;
    if (tk) {
      const m = tk.mob, me = this.me();
      const gone = m.removed || m.deathTime > 0 || !me || me.dead || Math.hypot(me.pos[0] - m.body.pos[0], me.pos[2] - m.body.pos[2]) > LEAVE_RANGE;
      if (gone) this.closeTalk();
      else {
        if (!m.ghost) { m.trading = 'local'; m.attendUntil = m.age + 90; }
        // ease the view round to the villager (for the first moment only: then it's ours again)
        const c = tk.cam;
        if (c && c.t < 1.2) {
          c.t += dt;
          const k = 1 - Math.exp(-dt * 7);
          const p = this.player;
          p.yaw += Math.atan2(Math.sin(c.yaw - p.yaw), Math.cos(c.yaw - p.yaw)) * k;
          p.pitch += (c.pitch - p.pitch) * k;
        }
      }
    }
    if (this.state !== 'playing' && this.state !== 'talk') return;
    // a word in passing, to us
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = 2.5;
      const me = this.me();
      if (me && !me.dead && !this.talk && !this.dimension) {
        let best = null, bd = 6.5;
        for (const e of this.sim.entities.values()) {
          if (e.kind !== 'mob' || e.type !== 'villager' || e.removed || e.deathTime > 0) continue;
          const d = Math.hypot(e.body.pos[0] - me.pos[0], e.body.pos[2] - me.pos[2]);
          if (d < bd && tnow > (e.nextGreet || 0) && !e.chatWith && !this.bubbles.has(e.uid || 'e' + e.id)) { best = e; bd = d; }
        }
        // (in a crowded village not one after another: a few seconds between greetings)
        if (best && Math.random() < 0.55 && tnow - (this.lastAmbient || 0) > 8) {
          this.lastAmbient = tnow;
          best.nextGreet = tnow + 90 + Math.random() * 90;
          const per = this.villagerPersona(best);
          if (per) this.onVillagerSay(per.uid, best.baby ? (getLanguage() === 'zh' ? '嘻嘻！' : 'Hee hee!') : ambientLine({ persona: per, lang: getLanguage(), playerName: this.playerName(), ctx: this.villagerContext(best) }), 'happy');
        }
      }
    }
    // two villagers stop for a word (the ones this game runs, near us): see villagerlife.js
    this.chatterTimer -= dt;
    if (this.chatterTimer <= 0) this.chatterTimer = this.villagerChatter() ? 60 + Math.random() * 45 : 12;
  };

  P.updateVillagerTag = function updateVillagerTag() {
    const m = this.aimMob;
    const cam = this.camera;
    const ok = m && m.type === 'villager' && !m.removed && m.deathTime === 0 && this.state === 'playing' && !this.hudHidden && cam;
    if (!ok) { this.ui.setVillagerTag(null); return; }
    const per = this.villagerPersona(m);
    if (!per) { this.ui.setVillagerTag(null); return; }
    const head = [m.body.pos[0], m.body.pos[1] + (m.baby ? 1.25 : 2.2), m.body.pos[2]];
    const at = projectToScreen(cam, head, this.canvas.clientWidth, this.canvas.clientHeight);
    const lang = getLanguage();
    const dist = Math.hypot(head[0] - cam.pos[0], head[1] - cam.pos[1], head[2] - cam.pos[2]);
    this.ui.setVillagerTag(at && !this.bubbles.has(per.uid) ? { at, name: personaName(per, lang), job: m.baby ? t('talk.child') : jobName(per.job, lang), hint: t(this.touch ? 'talk.hintTouch' : this.pads.connected ? 'talk.hintPad' : 'talk.hintKeys'), dist } : null);
  };

  // ---------------------------------------------------------------- on a server
  P.bindVillagerNet = function bindVillagerNet(net) {
    net.on('say', (m) => { if ((m.d | 0) === (this.dimension | 0) && typeof m.x === 'string') this.onVillagerSay(String(m.u), clip(m.x, 200), m.m, m.to === this.mp.id); });
    net.on('said', (m) => {
      if ((m.d | 0) !== (this.dimension | 0) || typeof m.x !== 'string') return;
      const v = this.villagerByUid(String(m.u));
      const per = v ? this.villagerPersona(v) : null;
      this.ui.addChat(m.n, (per ? '→ ' + personaName(per, getLanguage()) + '：' : '') + clip(m.x, 200));
    });
    const keepDiscount = (u, r) => {
      if (r && r.disc) { if (!this.mpDiscounts) this.mpDiscounts = new Map(); this.mpDiscounts.set(u, r.disc); }
      if (r && Number.isFinite(r.f)) {
        if (!this.mpFriends) this.mpFriends = new Map();
        this.mpFriends.set(u, r.f);
        if (this.mpFriends.size > 500) this.mpFriends.delete(this.mpFriends.keys().next().value);
      }
    };
    // two villagers' conversation (asked for by whichever game runs them)
    net.on('vchat', (m) => {
      if ((m.d | 0) !== (this.dimension | 0) || typeof m.a !== 'string' || typeof m.b !== 'string') return;
      if (this.dialogue && this.dialogue.lines && this.dialogue.i < this.dialogue.lines.length) return; // (one at a time)
      this.playDialogue(m.a, m.b, m.l);
    });
    net.on('vact', (m) => { keepDiscount(String(m.u), m.r); this.onVillagerAction(String(m.u), m.a || null, m.r || null); });
    net.on('vrec', (m) => {
      const tk = this.talk;
      if (!tk || tk.uid !== m.u) return;
      tk.rec = { ...newRecord(), ...(m.r || {}) };
      keepDiscount(tk.uid, m.r);
      tk.ai = m.ai || null;
      this.renderTalk();
    });
    // a villager this game runs, asked to stop for (or follow) another player
    net.on('vdo', (m) => {
      const v = this.villagerByUid(String(m.u));
      if (!v || v.ghost || !m.a) return;
      const who = m.a.id === this.mp.id ? 'local' : String(m.a.id);
      if (m.a.type === 'attend') { v.trading = who; v.attendUntil = v.age + 90; }
      else if (m.a.type === 'release') { if (v.trading === who) v.trading = null; }
      else if (m.a.type === 'follow') this.villagerFollow(v, who, Math.max(0, Math.min(120, Number(m.a.seconds) || 0)));
    });
  };
}
