// The villagers' minds on the server. Each villager remembers each player (what was said, what
// happened, how much it likes them, the task it set) and the village shares its gossip; all of it
// is kept with the world. Replies come from a language model when one is configured (the user's
// ATRIA model by default, or any OpenAI-compatible endpoint), and from the scripted mind in
// src/sim/brain.js when not, or when the model is busy, slow or out of reach — a villager always
// answers. Single-player games (no server of their own) ask over HTTP: POST /api/talk, where the
// game keeps the memories and sends them along.
//
// The model's key stays here (from the environment or config.json, never in the game's files),
// and the requests it is used for are rationed: a few a minute, a daily cap, one at a time per
// player, and per address for single-player games.

import {
  personaFor, personaName, buildMessages, parseReply, offlineReply, cleanAction, applyAction, cleanRecord, cleanRumor, newRecord,
  remember, befriend, feelingFor, JOBS, stuffId, clip, rumorText,
} from '../src/sim/brain.js';

const MAX_SOULS = 3000;
const MAX_PLAYERS_PER_SOUL = 30;
const MAX_RUMORS = 40;
const HEAR_RADIUS = 40; // players this close to a villager hear what it says

export function llmConfig(pick, env = process.env) {
  const key = String(pick('llmKey', 'ATRIA_API_KEY', '') || env.LLM_API_KEY || '').trim();
  return {
    key,
    base: String(pick('llmBase', 'LLM_BASE_URL', 'https://api.atria-asi.ai/v1')).trim().replace(/\/+$/, ''),
    model: String(pick('llmModel', 'LLM_MODEL', 'Atria-Dawn-Preview')).trim(),
    reasoning: String(pick('llmReasoning', 'LLM_REASONING', 'none')).trim(),
    timeout: Math.max(3, Number(pick('llmTimeout', 'LLM_TIMEOUT', 25)) || 25) * 1000,
    rpm: Math.max(1, Number(pick('llmRpm', 'LLM_RPM', 30)) || 30),
    daily: Math.max(1, Number(pick('llmDaily', 'LLM_DAILY', 4000)) || 4000),
    concurrent: Math.max(1, Number(pick('llmConcurrent', 'LLM_CONCURRENT', 4)) || 4),
    singlePlayer: String(pick('llmSinglePlayer', 'LLM_SINGLE_PLAYER', 'yes')).toLowerCase() !== 'no',
  };
}

const LANGS = new Set(['zh', 'en']);
const EVENTS = new Set(['hit', 'gift', 'deliver', 'trade']);
const vec3 = (a) => (Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every(Number.isFinite) ? a.slice(0, 3).map((v) => Math.max(-3e7, Math.min(3e7, v))) : null);

// What the game says about the moment (time, weather, the player's looks): checked and trimmed.
export function cleanContext(c) {
  const o = c && typeof c === 'object' ? c : {};
  const s = (v, n) => (typeof v === 'string' ? clip(v, n) : '');
  const n = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined);
  return {
    time: s(o.time, 12), phase: ['morning', 'day', 'evening', 'night'].includes(o.phase) ? o.phase : 'day', weather: s(o.weather, 16), biome: s(o.biome, 16),
    held: stuffId(o.held) ? o.held : '', armor: s(o.armor, 12), hp: n(o.hp, 0, 40), food: n(o.food, 0, 20), danger: n(o.danger, 0, 50) | 0,
  };
}
const cleanNeighbors = (l) => (Array.isArray(l) ? l.slice(0, 6).filter((x) => x && typeof x.name === 'string').map((x) => ({ name: clip(x.name, 12), job: JOBS[x.job] ? x.job : 'none' })) : []);

export function createBrain({ cfg, log = () => {}, onChange = () => {}, fetchFn = (...a) => fetch(...a), now = () => Date.now() }) {
  const llm = cfg.llm || { key: '' };
  const souls = new Map(); // uid -> Map(playerKey -> record)
  let rumors = [];
  let gameDay = () => 0;
  // rationing
  const minute = []; // times of the requests in the last minute
  let dayStamp = new Date(now()).toDateString(), dayCount = 0;
  let inFlight = 0;
  let pausedUntil = 0; // after a 429: wait as the endpoint asks
  let noReasoningParam = false; // the endpoint refused reasoning_effort once: don't send it again
  const perAddress = new Map(); // ip -> { hour: [times], day: count, stamp }
  const stats = { model: 0, offline: 0, failed: 0, lastError: '' };

  const enabled = () => !!llm.key;
  function allowModel() {
    if (!enabled()) return false;
    const t = now();
    if (t < pausedUntil || inFlight >= llm.concurrent) return false;
    while (minute.length && t - minute[0] > 60000) minute.shift();
    const today = new Date(t).toDateString();
    if (today !== dayStamp) { dayStamp = today; dayCount = 0; }
    if (minute.length >= llm.rpm || dayCount >= llm.daily) return false;
    minute.push(t);
    dayCount++;
    return true;
  }

  async function callModel(messages) {
    const body = { model: llm.model, messages, temperature: 0.85, stream: false, max_tokens: llm.reasoning && llm.reasoning !== 'none' ? 1500 : 400 };
    if (llm.reasoning && !noReasoningParam) body.reasoning_effort = llm.reasoning;
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), llm.timeout);
      let res;
      try {
        res = await fetchFn(llm.base + '/chat/completions', {
          method: 'POST', signal: ctl.signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + llm.key },
          body: JSON.stringify(body),
        });
      } finally { clearTimeout(timer); }
      if ((res.status === 400 || res.status === 422) && body.reasoning_effort !== undefined && attempt === 0) {
        // an endpoint that doesn't know the parameter (or the value: ATRIA answers 422 to
        // reasoning_effort "none"): once more without it, and never again
        noReasoningParam = true;
        delete body.reasoning_effort;
        await res.text().catch(() => '');
        continue;
      }
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after')) || 20;
        pausedUntil = now() + Math.min(300, wait) * 1000;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${clip(text, 160)}`);
      }
      const j = await res.json();
      const msg = j && j.choices && j.choices[0] && j.choices[0].message;
      const text = msg && typeof msg.content === 'string' ? msg.content : '';
      if (!text.trim()) throw new Error('empty answer');
      return text;
    }
    throw new Error('no answer');
  }

  // The heart of it. input: { uid, job, lang, playerName, line, rec, ctx, neighbors, rumors, day,
  // event, item, baby, useModel }. Returns { say, mood, action (checked), offline }.
  async function reply(input) {
    const persona = personaFor(input.uid, input.job);
    const lang = LANGS.has(input.lang) ? input.lang : 'zh';
    const day = input.day | 0;
    const rec = input.rec || newRecord(day);
    const base = { persona, lang, playerName: input.playerName, line: input.line || '', rec, ctx: input.ctx || {}, neighbors: input.neighbors || [], rumors: input.rumors || [], day, event: input.event || null, item: input.item, baby: !!input.baby };
    let out = null, offline = true;
    if (!input.baby && input.useModel !== false && allowModel()) {
      inFlight++;
      try {
        const note = eventNote(input, lang, persona);
        const r = parseReply(await callModel(buildMessages({ ...base, note })));
        out = r;
        offline = false;
        stats.model++;
      } catch (e) {
        stats.failed++;
        stats.lastError = e.name === 'AbortError' ? 'timeout' : clip(e.message, 120);
        log(`villager brain: the model didn't answer (${stats.lastError}); a scripted reply instead`);
      } finally { inFlight--; }
    }
    if (!out) { out = offlineReply(base); stats.offline++; }
    const action = cleanAction(out.action, { job: persona.job, rec, day });
    return { say: out.say, mood: out.mood, action, offline };
  }

  // the thing that happened, as the villager would put it (for the model)
  function eventNote(input, lang, persona) {
    const zh = lang === 'zh';
    const who = clip(input.playerName, 16) || (zh ? '玩家' : 'the player');
    const item = input.item ? (zh ? input.itemName || input.item : input.itemName || input.item) : '';
    switch (input.event) {
      case 'hit': return zh ? `${who}突然打了你一下！` : `${who} just hit you!`;
      case 'gift': return zh ? `${who}送给你一个${item}` : `${who} gives you ${item}`;
      case 'deliver': { const q = input.rec && input.rec.quest; return q ? (zh ? `${who}把你要的${q.count}个东西都带来了，你按约定给了奖励` : `${who} brought all ${q.count} of what you asked for, and you paid the reward`) : ''; }
      case 'trade': return zh ? `${who}刚跟你做了笔买卖` : `${who} just traded with you`;
      default: void persona; return '';
    }
  }

  // ---------------------------------------------------------------- memories kept here (servers)
  function recordFor(uid, key, day) {
    let m = souls.get(uid);
    if (!m) {
      if (souls.size >= MAX_SOULS) souls.delete(souls.keys().next().value);
      m = new Map();
      souls.set(uid, m);
    }
    let r = m.get(key);
    if (!r) {
      if (m.size >= MAX_PLAYERS_PER_SOUL) m.delete(m.keys().next().value);
      r = newRecord(day);
      m.set(key, r);
    }
    return r;
  }
  const summary = (r) => ({ f: r.f, quest: r.quest, disc: r.disc, met: r.met, giftDay: r.giftDay, done: r.done });

  function addRumor(k, who, s = '') {
    const r = cleanRumor({ k, who, s, day: gameDay() });
    if (!r) return;
    // the same news twice in a row is old news
    const last = rumors[rumors.length - 1];
    if (last && last.k === r.k && last.who === r.who && last.s === r.s && last.day === r.day) return;
    rumors.push(r);
    while (rumors.length > MAX_RUMORS) rumors.shift();
    onChange();
  }

  // A player in a server game talks to a villager, or does something to one (hit, gift,
  // deliver, trade). hooks: { day(), sendTo(c, msg), hear(d, pos, msg, except) }
  const busy = new Set(); // players waiting for an answer
  const lastHit = new Map(); // uid -> time of the last reaction to a hit
  async function onTalk(c, m, hooks) {
    const uid = typeof m.u === 'string' && /^[\w.:-]{1,40}$/.test(m.u) ? m.u : null;
    const pos = vec3(m.p);
    if (!uid || !pos) return;
    const event = EVENTS.has(m.k) ? m.k : null;
    // (an empty line: the player just walked up, and the villager greets them)
    const line = event ? '' : clip(m.x, 200);
    const dim = Number.isInteger(m.d) ? m.d : 0;
    const day = hooks.day();
    const job = JOBS[m.j] ? m.j : 'none';
    const lang = LANGS.has(m.l) ? m.l : 'zh';
    const rec = recordFor(uid, c.key, day);
    const persona = personaFor(uid, job);
    const vname = personaName(persona, lang);
    // what happened goes into the record first (whether or not anyone answers)
    let note = '';
    if (event === 'hit') { befriend(rec, feelingFor({ event })); note = lang === 'zh' ? `${c.name}打过你` : `${c.name} hit you`; addRumor('hit', c.name, vname); }
    if (event === 'gift') { const nm = clip(m.n, 16); befriend(rec, feelingFor({ event })); note = lang === 'zh' ? `${c.name}送过你${nm || '礼物'}` : `${c.name} gave you ${nm || 'a present'}`; addRumor('gift', c.name, vname); }
    if (event === 'deliver' && rec.quest) { befriend(rec, feelingFor({ event })); rec.done++; note = lang === 'zh' ? `${c.name}帮你干过活（${rec.quest.count}个${clip(m.n, 12)}）` : `${c.name} did a task for you`; addRumor('quest', c.name, vname); }
    if (event === 'trade') befriend(rec, feelingFor({ event }));
    if (note) { remember(rec, { note, day }); onChange(); }
    // hits get one complaint every few seconds, not one per punch; trades rarely a word
    if (event === 'hit') { const t0 = lastHit.get(uid) || 0; if (now() - t0 < 5000) return; lastHit.set(uid, now()); }
    if (event === 'trade' && Math.random() < 0.7) return;
    if (busy.has(c.id)) return;
    busy.add(c.id);
    try {
      if (line) hooks.hear(dim, pos, { t: 'said', id: c.id, n: c.name, u: uid, x: line, d: dim }, c);
      const quest = rec.quest;
      const r = await reply({
        uid, job, lang, playerName: c.name, line, rec, ctx: cleanContext(m.c), neighbors: cleanNeighbors(m.nb), rumors: rumors.slice(-8), day,
        event, item: stuffId(m.it) ? m.it : '', itemName: clip(m.n, 16), baby: !!m.b,
      });
      if (event === 'deliver' && quest) rec.quest = null;
      if (r.action) applyAction(rec, r.action, day);
      remember(rec, { line: line || (note ? `（${note}）` : ''), reply: r.say, day });
      if (!event) befriend(rec, feelingFor({ line, action: r.action }));
      if (line && Math.random() < 0.15) addRumor('talk', c.name, clip(line, 24));
      onChange();
      hooks.hear(dim, pos, { t: 'say', u: uid, x: r.say, m: r.mood, to: c.id, d: dim }, null);
      hooks.sendTo(c, { t: 'vact', u: uid, a: r.action, r: summary(rec), off: r.offline ? 1 : 0 });
      // following someone is up to whichever game runs the villager
      if (r.action && r.action.type === 'follow') hooks.all(dim, { t: 'vdo', u: uid, a: { type: 'follow', id: c.id, seconds: r.action.seconds } });
    } finally { busy.delete(c.id); }
  }

  // The talk screen opened: what this villager thinks of the player.
  function recordSummary(c, uid, day) {
    return summary(recordFor(uid, c.key, day));
  }

  // ---------------------------------------------------------------- single-player games
  function allowAddress(ip) {
    const t = now();
    let a = perAddress.get(ip);
    const stamp = new Date(t).toDateString();
    if (!a || a.stamp !== stamp) { a = { hour: [], day: 0, stamp }; perAddress.set(ip, a); }
    while (a.hour.length && t - a.hour[0] > 3600000) a.hour.shift();
    if (a.hour.length >= 120 || a.day >= 600) return false;
    a.hour.push(t);
    a.day++;
    if (perAddress.size > 5000) perAddress.delete(perAddress.keys().next().value);
    return true;
  }

  async function handleHttp(req, res) {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(obj));
    };
    if (req.method !== 'POST') return send(405, { error: 'POST only' });
    let raw = '';
    let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 24576) return send(413, { error: 'too big' });
        raw += chunk;
      }
    } catch (e) { return send(400, { error: 'bad body' }); }
    let m;
    try { m = JSON.parse(raw); } catch (e) { return send(400, { error: 'bad json' }); }
    if (!m || typeof m !== 'object') return send(400, { error: 'bad request' });
    const uid = typeof m.u === 'string' && /^[\w.:-]{1,40}$/.test(m.u) ? m.u : null;
    if (!uid) return send(400, { error: 'no villager' });
    // behind the hub's nginx every request comes from 127.0.0.1: the real address is in X-Real-IP
    const sock = req.socket.remoteAddress || '';
    const local = /^(::1|127\.|::ffff:127\.)/.test(sock);
    const ip = (local && (req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim())) || sock;
    const useModel = llm.singlePlayer && allowAddress(ip);
    const day = Number.isInteger(m.day) ? Math.max(0, m.day) : 0;
    const event = EVENTS.has(m.k) ? m.k : null;
    const r = await reply({
      uid, job: JOBS[m.j] ? m.j : 'none', lang: LANGS.has(m.l) ? m.l : 'zh', playerName: clip(m.name, 16), line: event ? '' : clip(m.x, 200),
      rec: cleanRecord(m.r, day), ctx: cleanContext(m.c), neighbors: cleanNeighbors(m.nb),
      rumors: (Array.isArray(m.rm) ? m.rm.slice(-8) : []).map(cleanRumor).filter(Boolean), day, event,
      item: stuffId(m.it) ? m.it : '', itemName: clip(m.n, 16), baby: !!m.b, useModel,
    });
    send(200, { say: r.say, mood: r.mood, action: r.action, offline: r.offline });
  }

  // ---------------------------------------------------------------- with the world on disk
  function serialize() {
    const s = {};
    for (const [uid, m] of souls) s[uid] = Object.fromEntries(m);
    return { souls: s, rumors };
  }
  function load(d) {
    souls.clear();
    rumors = [];
    if (!d || typeof d !== 'object') return;
    for (const [uid, m] of Object.entries(d.souls || {}).slice(0, MAX_SOULS)) {
      if (!/^[\w.:-]{1,40}$/.test(uid) || !m || typeof m !== 'object') continue;
      const mm = new Map();
      for (const [k, r] of Object.entries(m).slice(0, MAX_PLAYERS_PER_SOUL)) mm.set(String(k).slice(0, 32), cleanRecord(r));
      souls.set(uid, mm);
    }
    rumors = (Array.isArray(d.rumors) ? d.rumors : []).map(cleanRumor).filter(Boolean).slice(-MAX_RUMORS);
  }

  return {
    enabled, reply, onTalk, recordSummary, handleHttp, addRumor, serialize, load, stats,
    setDay(fn) { gameDay = fn; },
    rumors: () => rumors.slice(),
    rumorText: (r, lang) => rumorText(r, lang, gameDay()),
    status: () => (enabled() ? 'atria' : 'offline'),
    HEAR_RADIUS,
  };
}
