#!/usr/bin/env node
// Lumencraft multiplayer server. It serves the game, keeps the shared world (seed, block edits,
// time of day and every player's inventory) on disk, relays players and creatures between
// clients, and brokers the WebRTC voice connections. No packages needed: Node 18 or newer.
//
//   node server/server.mjs                      (port 8080)
//   PORT=8080 PASSWORD=secret node server/server.mjs
//
// Settings come from server/config.json and environment variables; see server/README.zh-CN.md.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptUpgrade } from './ws.mjs';
// the game's own rules for items, chests and furnaces (plain data modules, no browser needed)
import { BLOCKS, WORLD_HEIGHT } from '../src/world/blocks.js';
import { itemDef } from '../src/sim/items.js';
import { loadEntity, serializeEntity, serializeEntities, loadEntities, newEntity, tickFurnace, furnaceLit, tickBrewing, contentsOf, parseKey } from '../src/sim/containers.js';
import { rollLoot } from '../src/sim/loot.js';
import { stepWeatherClock } from '../src/game/weather.js';
import { createBrain, llmConfig } from './brain.mjs';

// 2: beds, armour, the nether and the end (new block and item ids); 3: block states in edits
// (id | state << 8), shared dropped items, chests, furnaces and signs; 4: the 384-high world and
// its generator version, shared weather, brewing stands, loot chests, enchanted items, the
// creatures of structures (spawned once) and the creatures that stay (kept by the server); 5: villagers
// that talk (talk / vnote / vopen / vclose / vchat, say / said / vact / vrec / vdo / vchat; a villager's uid
// and trade seed in its snapshots), the villagers' memories and gossip kept with the world, space
// (dimensions 3-7) and carrying one another (carry)
export const PROTOCOL = 5;
const CURRENT_GEN = 2;
const MAX_PMOBS = 3000; // creatures kept per dimension
// the dimensions: 0 the overworld, 1 the Nether, 2 the End, 3 space (no ground), 4 the Moon, 5 Mars, 6 and 7 the stations
// over Jupiter and Saturn
const DIMS = [0, 1, 2, 3, 4, 5, 6, 7];
const GROUND_DIMS = [0, 1, 2, 4, 5, 6, 7];
const OTHER_DIMS = [1, 2, 4, 5, 6, 7]; // with edits of their own (the overworld's are world.edits)
const dimOf = (v) => (Number.isInteger(v) && v >= 0 && v <= 7 ? v : 0);
const ADOPT_RADIUS = 64;
const ITEM_LIFE = 5 * 60 * 1000; // dropped items vanish after five minutes, as they do in the game
const MAX_ITEMS = 3000;
const here = dirname(fileURLToPath(import.meta.url));

function loadConfig(overrides = {}) {
  let file = {};
  const path = join(here, 'config.json');
  if (existsSync(path)) {
    try { file = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { console.error('config.json is not valid JSON:', e.message); }
  }
  const env = process.env;
  const pick = (key, envKey, def) => overrides[key] ?? env[envKey] ?? file[key] ?? def;
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
  const dist = join(here, '..', 'dist');
  return {
    port: Number(pick('port', 'PORT', 8080)),
    host: pick('host', 'HOST', '0.0.0.0'),
    password: String(pick('password', 'PASSWORD', '')),
    maxPlayers: Number(pick('maxPlayers', 'MAX_PLAYERS', 10)),
    name: String(pick('name', 'SERVER_NAME', 'Lumencraft')),
    dataDir: resolve(pick('dataDir', 'DATA_DIR', join(here, 'data'))),
    webRoot: resolve(pick('webRoot', 'WEB_ROOT', existsSync(join(dist, 'index.html')) ? dist : join(here, '..'))),
    seed: pick('seed', 'SEED', ''),
    dayLength: Number(pick('dayLength', 'DAY_LENGTH', 20)),
    mode: pick('mode', 'GAME_MODE', 'survival') === 'creative' ? 'creative' : 'survival',
    difficulty: ['peaceful', 'easy', 'normal', 'hard'].includes(pick('difficulty', 'DIFFICULTY', 'normal')) ? pick('difficulty', 'DIFFICULTY', 'normal') : 'normal',
    stun: list(pick('stun', 'STUN_URLS', 'stun:stun.miwifi.com:3478,stun:stun.l.google.com:19302')),
    turn: list(pick('turn', 'TURN_URLS', '')),
    turnSecret: String(pick('turnSecret', 'TURN_SECRET', '')),
    turnUser: String(pick('turnUser', 'TURN_USER', '')),
    turnPass: String(pick('turnPass', 'TURN_PASS', '')),
    quiet: !!overrides.quiet,
    // the villagers' language model (see server/brain.mjs): its key only ever lives here
    llm: overrides.llm || llmConfig(pick, env),
  };
}

// the same text-to-seed hash the game uses for typed seeds
function seedFromString(s) {
  s = String(s || '').trim();
  if (!s) return (Math.random() * 2 ** 31) | 0;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10) | 0;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h | 0;
}

const chunkKey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};
const COMPRESS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.webmanifest', '.txt']);
// when serving straight from the repository (no build), only the game's own files are public
const SOURCE_PUBLIC = [/^\/$/, /^\/index\.html$/, /^\/styles\.css$/, /^\/manifest\.webmanifest$/, /^\/icons\/[\w.-]+$/, /^\/src\/[\w/.-]+\.js$/];

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
const num = (v, lo, hi, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def);
const int = (v) => (Number.isInteger(v) ? v : null);

export function startServer(overrides = {}) {
  const cfg = loadConfig(overrides);
  const log = (...a) => { if (!cfg.quiet) console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a); };
  const worldFile = join(cfg.dataDir, 'world.json');
  // edits: the overworld's; dimEdits: the nether's (1) and the end's (2); bents: chests, furnaces
  // and signs per dimension ("x,y,z" -> entity); items: dropped items everyone sees (not saved)
  // gen: the terrain generator the world was made with (1: the 128-high world; 2: 384 high, with
  // structures); weather: the rain everyone shares; claims: chunks whose structure creatures
  // have been spawned; pmobs: creatures that stay (villagers, pets...), uid -> { c: data, owner }
  const world = {
    seed: 0, gen: CURRENT_GEN, dayTime: 0.06, dayCount: 0, edits: new Map(), dimEdits: Object.fromEntries(OTHER_DIMS.map((d) => [d, new Map()])), endState: null, players: {},
    bents: Object.fromEntries(DIMS.map((d) => [d, new Map()])), items: new Map(),
    weather: { target: 0, stormTarget: 0, timer: 300 + Math.random() * 420 },
    claims: Object.fromEntries(DIMS.map((d) => [d, new Set()])), pmobs: Object.fromEntries(DIMS.map((d) => [d, new Map()])),
  };
  const locks = new Map(); // "d:x,y,z" -> client holding that chest or furnace open
  let dirty = false;
  // the villagers' minds: what each remembers of each player, and the village gossip
  const brain = createBrain({ cfg, log, onChange: () => { dirty = true; } });
  brain.setDay(() => world.dayCount);
  let nextId = 1;
  const clients = new Map();

  // ------------------------------------------------------------------ world on disk
  async function loadWorld() {
    try {
      const d = JSON.parse(await readFile(worldFile, 'utf8'));
      world.seed = d.seed | 0;
      // worlds from before the 384-high world keep their terrain
      world.gen = Number.isInteger(d.gen) && d.gen >= 1 && d.gen <= CURRENT_GEN ? d.gen : 1;
      world.dayTime = num(d.dayTime, 0, 1, 0.06);
      if (d.weather && typeof d.weather === 'object') {
        world.weather = { target: num(d.weather.target, 0, 1, 0), stormTarget: d.weather.stormTarget ? 1 : 0, timer: num(d.weather.timer, 0, 3600, 300) };
      }
      for (const dim of DIMS) {
        const cl = d.claims && Array.isArray(d.claims[dim]) ? d.claims[dim] : [];
        world.claims[dim] = new Set(cl.filter((k) => Number.isFinite(k)));
        const pm = d.pmobs && Array.isArray(d.pmobs[dim]) ? d.pmobs[dim] : [];
        world.pmobs[dim] = new Map();
        for (const c of pm.slice(0, MAX_PMOBS)) { const ok = cleanCreature(c); if (ok) world.pmobs[dim].set(ok.uid, { c: ok, owner: null }); }
      }
      world.dayCount = d.dayCount | 0;
      world.players = d.players && typeof d.players === 'object' ? d.players : {};
      const readEdits = (obj, into) => {
        for (const k of Object.keys(obj || {})) {
          const arr = obj[k];
          const m = new Map();
          for (let i = 0; i + 1 < arr.length; i += 2) m.set(arr[i], arr[i + 1]);
          into.set(Number(k), m);
        }
      };
      readEdits(d.edits, world.edits);
      for (const dim of OTHER_DIMS) readEdits(d.dimEdits && d.dimEdits[dim], world.dimEdits[dim]);
      world.endState = d.endState && typeof d.endState === 'object' ? d.endState : null;
      brain.load(d.brain);
      const be = d.bents && typeof d.bents === 'object' ? d.bents : {};
      for (const dim of DIMS) world.bents[dim] = loadEntities(be[dim]);
      log(`world loaded: seed ${world.seed} (generator ${world.gen}), ${world.edits.size} edited chunks, ${Object.keys(world.players).length} known players, ${world.pmobs[0].size} creatures kept`);
    } catch (e) {
      world.seed = seedFromString(cfg.seed);
      world.gen = CURRENT_GEN;
      dirty = true;
      log(`new world, seed ${world.seed} (generator ${world.gen})`);
    }
  }

  function serializeEdits(edits = world.edits) {
    const out = {};
    for (const [k, m] of edits) out[k] = Array.from(m.entries()).flat();
    return out;
  }
  const serializeDimEdits = () => Object.fromEntries(OTHER_DIMS.map((d) => [d, serializeEdits(world.dimEdits[d])]));

  let saving = null;
  async function saveWorld() {
    if (saving) await saving;
    const job = (async () => {
      dirty = false;
      await mkdir(cfg.dataDir, { recursive: true });
      const body = JSON.stringify({
        version: 1, seed: world.seed, gen: world.gen, dayTime: world.dayTime, dayCount: world.dayCount, edits: serializeEdits(),
        dimEdits: serializeDimEdits(), endState: world.endState, players: world.players,
        bents: Object.fromEntries(GROUND_DIMS.map((d) => [d, serializeEntities(world.bents[d])])),
        weather: world.weather,
        brain: brain.serialize(),
        claims: Object.fromEntries(GROUND_DIMS.map((d) => [d, [...world.claims[d]]])),
        pmobs: Object.fromEntries(GROUND_DIMS.map((d) => [d, [...world.pmobs[d].values()].map((r) => r.c)])),
      });
      const tmp = worldFile + '.tmp';
      await writeFile(tmp, body);
      await rename(tmp, worldFile);
    })();
    saving = job;
    try { await job; } catch (e) { dirty = true; console.error('saving the world failed:', e.message); } finally { if (saving === job) saving = null; }
  }

  // b: id | state << 8
  function applyEdit(x, y, z, b, d = 0) {
    const edits = d ? world.dimEdits[d] : world.edits;
    if (!edits) return;
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    const k = chunkKey(cx, cz);
    let m = edits.get(k);
    if (!m) { m = new Map(); edits.set(k, m); }
    m.set((y << 8) | ((z - cz * 16) << 4) | (x - cx * 16), b);
    dirty = true;
    blockChanged(x, y, z, b & 255, d);
  }

  // The edited value at a block (id | state << 8), or null if it was never edited.
  function editAt(x, y, z, d) {
    const edits = d ? world.dimEdits[d] : world.edits;
    if (!edits) return null;
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    const m = edits.get(chunkKey(cx, cz));
    const v = m && m.get((y << 8) | ((z - cz * 16) << 4) | (x - cx * 16));
    return v === undefined ? null : v;
  }

  // ------------------------------------------------------------------ chests, furnaces, signs
  const kindOf = (id) => { const bd = BLOCKS[id]; return bd ? bd.container || (bd.sign ? 'sign' : null) : null; };
  const lockKey = (d, k) => d + ':' + k;

  // A block changed: a chest or furnace whose block is gone spills what it held, for everyone.
  function blockChanged(x, y, z, id, d) {
    const k = x + ',' + y + ',' + z;
    const e = world.bents[d].get(k);
    if (!e || kindOf(id) === e.kind) return;
    world.bents[d].delete(k);
    const holder = locks.get(lockKey(d, k));
    if (holder) { locks.delete(lockKey(d, k)); send(holder, { t: 'cgone', k, d }); }
    if (e.kind === 'sign') broadcast({ t: 'bent', k, d, e: null });
    let n = 0;
    for (const [it, count, wear, ench] of contentsOf(e)) {
      spawnItem({ i: 's.' + Date.now().toString(36) + '.' + (n++) + '.' + Math.floor(Math.random() * 1e6), it, n: count, w: wear, dl: 0.5, p: [x + 0.5, y + 0.5, z + 0.5], v: [(Math.random() - 0.5) * 3, 3, (Math.random() - 0.5) * 3], d, e: cleanEnch(ench) });
    }
  }

  // ------------------------------------------------------------------ dropped items
  // an item as players see it (without the server's own timestamp)
  const itemInfo = (it) => (it.e ? { i: it.i, it: it.it, n: it.n, w: it.w, dl: it.dl, p: it.p, v: it.v, d: it.d, e: it.e } : { i: it.i, it: it.it, n: it.n, w: it.w, dl: it.dl, p: it.p, v: it.v, d: it.d });
  // enchantments on an item: { name: level } (a few, small levels)
  const cleanEnch = (e) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return undefined;
    const out = {};
    for (const [k, v] of Object.entries(e).slice(0, 8)) if (/^[a-z_]{1,24}$/.test(k) && Number.isInteger(v) && v > 0 && v <= 10) out[k] = v;
    return Object.keys(out).length ? out : undefined;
  };
  function spawnItem(it, from = null) {
    it.at = Date.now();
    world.items.set(it.i, it);
    if (world.items.size > MAX_ITEMS) world.items.delete(world.items.keys().next().value);
    broadcast({ t: 'drop', ...itemInfo(it) }, from);
  }

  // ------------------------------------------------------------------ voice: ICE servers
  function iceServersFor(id) {
    const out = [];
    if (cfg.stun.length) out.push({ urls: cfg.stun });
    if (cfg.turn.length) {
      if (cfg.turnSecret) {
        // coturn "use-auth-secret": time-limited credentials derived from the shared secret
        const username = `${Math.floor(Date.now() / 1000) + 24 * 3600}:${id}`;
        const credential = createHmac('sha1', cfg.turnSecret).update(username).digest('base64');
        out.push({ urls: cfg.turn, username, credential });
      } else out.push({ urls: cfg.turn, username: cfg.turnUser, credential: cfg.turnPass });
    }
    return out;
  }

  // ------------------------------------------------------------------ creatures that stay
  // A creature as a client describes it (see Game.serializeCreature): checked and trimmed.
  function cleanCreature(c) {
    if (!c || typeof c !== 'object' || typeof c.uid !== 'string' || !/^[\w.:-]{1,40}$/.test(c.uid)) return null;
    if (typeof c.type !== 'string' || !/^[a-z_]{1,24}$/.test(c.type) || !Array.isArray(c.p) || c.p.length !== 3) return null;
    const body = JSON.stringify(c);
    if (body.length > 4096) return null;
    const p = c.p.map((v) => num(v, -3e7, 3e7));
    if (p[1] < -64 || p[1] > WORLD_HEIGHT + 64) return null;
    return { ...c, p };
  }

  // Creatures nobody simulates go to a player near them (the first one to come by).
  function adoptCreatures() {
    for (const d of GROUND_DIMS) {
      const near = [...clients.values()].filter((o) => o.ready && o.state && (o.state.d || 0) === d);
      if (!near.length) continue;
      const give = new Map();
      for (const [uid, r] of world.pmobs[d]) {
        if (r.owner && clients.get(r.owner) && clients.get(r.owner).ready) continue;
        r.owner = null;
        const p = r.c.p;
        const o = near.find((q) => (q.state.p[0] - p[0]) ** 2 + (q.state.p[2] - p[2]) ** 2 < ADOPT_RADIUS * ADOPT_RADIUS);
        if (!o) continue;
        r.owner = o.id;
        if (!give.has(o)) give.set(o, []);
        if (give.get(o).length < 128) give.get(o).push(r.c); else r.owner = null;
        void uid;
      }
      for (const [o, l] of give) send(o, { t: 'adopt', d, l });
    }
  }

  // ------------------------------------------------------------------ messaging
  const sendRaw = (c, text) => { if (c.ws.open) c.ws.send(text); };
  const send = (c, msg) => sendRaw(c, JSON.stringify(msg));
  function broadcast(msg, except = null, lossy = false) {
    const text = JSON.stringify(msg);
    for (const c of clients.values()) {
      if (c === except || !c.ready) continue;
      if (lossy && c.ws.buffered > 1 << 20) continue; // a backed-up client skips position updates
      sendRaw(c, text);
    }
  }
  const byId = (id) => { const c = clients.get(String(id)); return c && c.ready ? c : null; };
  function dimcast(d, msg, except = null) {
    const text = JSON.stringify(msg);
    for (const o of clients.values()) if (o.ready && o !== except && ((o.state && o.state.d) || 0) === d) sendRaw(o, text);
  }
  const villagerHooks = {
    day: () => world.dayCount,
    sendTo: (c, msg) => send(c, msg),
    // what is said to a villager, and what it says back, reaches the players near it (and the one
    // it is talking to, wherever they are)
    hear: (d, pos, msg, except) => {
      const text = JSON.stringify(msg);
      const r2 = brain.HEAR_RADIUS * brain.HEAR_RADIUS;
      for (const o of clients.values()) {
        if (!o.ready || o === except) continue;
        const near = o.state && (o.state.d || 0) === d && (o.state.p[0] - pos[0]) ** 2 + (o.state.p[2] - pos[2]) ** 2 < r2;
        if (near || o.id === msg.to) sendRaw(o, text);
      }
    },
    all: (d, msg, except = null) => dimcast(d, msg, except),
  };

  // ------------------------------------------------------------------ sleeping and the End
  // The night is skipped once everyone in the overworld is in bed.
  let sleepTimer = null;
  function checkSleep() {
    const ow = [...clients.values()].filter((o) => o.ready && !(o.state && o.state.d));
    const n = ow.filter((o) => o.sleeping).length;
    broadcast({ t: 'sleepers', n, m: ow.length });
    if (n > 0 && n === ow.length) {
      if (!sleepTimer) {
        sleepTimer = setTimeout(() => {
          sleepTimer = null;
          const still = [...clients.values()].filter((o) => o.ready && !(o.state && o.state.d));
          if (!still.length || !still.every((o) => o.sleeping)) return;
          if (world.dayTime > 0.3) world.dayCount++;
          world.dayTime = 0.002;
          dirty = true;
          for (const o of still) o.sleeping = false;
          broadcast({ t: 'time', d: world.dayTime, n: world.dayCount });
          broadcast({ t: 'wake', skip: true });
          log('everyone slept: morning');
        }, 2600);
      }
    } else if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
  }

  // One player in the End runs its dragon (the first to arrive); another takes over if they leave.
  let endHost = null;
  function checkEndHost() {
    const inEnd = [...clients.values()].filter((o) => o.ready && o.state && o.state.d === 2);
    const next = inEnd.some((o) => o.id === endHost) ? endHost : inEnd.length ? inEnd[0].id : null;
    if (next !== endHost) {
      endHost = next;
      broadcast({ t: 'endHost', id: endHost });
    }
  }

  function welcome(c, hello) {
    const saved = world.players[c.key] || null;
    const msg = {
      t: 'welcome', v: PROTOCOL, id: c.id, name: cfg.name, seed: world.seed, dayTime: world.dayTime, dayCount: world.dayCount,
      dayLength: cfg.dayLength, mode: cfg.mode, difficulty: cfg.difficulty, edits: serializeEdits(), dimEdits: serializeDimEdits(),
      endState: world.endState, endHost, me: saved, gen: world.gen, weather: { r: world.weather.target, s: world.weather.stormTarget },
      // signs everyone can read (what chests and furnaces hold is sent when one is opened)
      bents: Object.fromEntries(GROUND_DIMS.map((d) => [d, Object.fromEntries([...world.bents[d]].filter(([, e]) => e.kind === 'sign').map(([k, e]) => [k, serializeEntity(e)]))])),
      items: [...world.items.values()].map(itemInfo),
      players: [...clients.values()].filter((o) => o.ready && o !== c).map((o) => ({ id: o.id, n: o.name, st: o.state, voice: o.voice })),
      ice: iceServersFor(c.id),
    };
    const text = JSON.stringify(msg);
    // the edit list can be large: gzip it for browsers that can unpack it
    if (hello.gz && text.length > 16384) c.ws.sendBinary(gzipSync(text));
    else sendRaw(c, text);
  }

  function onHello(c, m) {
    if (m.v !== PROTOCOL) return reject(c, 'version');
    if (cfg.password && m.pw !== cfg.password) return reject(c, 'password');
    const name = clean(m.n, 16);
    if (!name) return reject(c, 'badName');
    const key = name.toLowerCase();
    for (const o of clients.values()) if (o.ready && o.key === key) return reject(c, 'nameTaken');
    if ([...clients.values()].filter((o) => o.ready).length >= cfg.maxPlayers) return reject(c, 'full');
    c.name = name;
    c.key = key;
    c.ready = true;
    if (!world.players[key]) brain.addRumor('join', name);
    welcome(c, m);
    broadcast({ t: 'join', id: c.id, n: name }, c);
    log(`${name} joined (${[...clients.values()].filter((o) => o.ready).length} online)`);
  }

  function reject(c, code) {
    send(c, { t: 'err', code });
    c.ws.close(4000);
  }

  function onMessage(c, text) {
    c.lastSeen = Date.now();
    let m;
    try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    if (!c.ready) { if (m.t === 'hello') onHello(c, m); return; }
    switch (m.t) {
      case 'st': { // position, look, held item, flags
        const d = dimOf(m.d);
        // (in space, positions over the body nearest the player: much further out)
        const lim = d === 3 ? 2e9 : 3e7;
        const p = Array.isArray(m.p) ? m.p.slice(0, 3).map((v) => num(v, -lim, lim)) : null;
        if (!p) return;
        c.state = { p, y: num(m.y, -100, 100), pi: num(m.pi, -2, 2), h: int(m.h) || 0, f: int(m.f) || 0 };
        if (Array.isArray(m.a)) c.state.a = m.a.slice(0, 4).map((v) => int(v) || 0);
        if (d) c.state.d = d;
        // (in space: which body p is measured from, 0-4 = earth, moon, mars, jupiter, saturn)
        if (d === 3) c.state.b = Math.max(0, Math.min(4, int(m.b) || 0));
        broadcast({ t: 'st', id: c.id, ...c.state }, c, true);
        if ((c.lastDim || 0) !== d) {
          c.lastDim = d; c.sleeping = false; checkEndHost(); checkSleep();
          const went = { 1: 'nether', 2: 'end', 3: 'space', 4: 'moon', 5: 'mars', 6: 'jupiter', 7: 'saturn' }[d];
          if (went) brain.addRumor(went, c.name);
        }
        break;
      }
      case 'carry': { // picking up (or putting down) a creature or a player, or wriggling free
        const k = ['mob', 'player', 'free'].includes(m.k) ? m.k : null;
        if (!k) return;
        const v3 = (a) => (Array.isArray(a) && a.length === 3 && a.every((x) => Number.isFinite(x)) ? a.map((x) => Math.max(-3e7, Math.min(3e7, x))) : undefined);
        const out = { t: 'carry', from: c.id, k, on: m.on ? 1 : 0 };
        if (k === 'mob') {
          if (typeof m.o !== 'string' || !Number.isInteger(m.r)) return;
          out.o = m.o.slice(0, 16); out.r = m.r;
          if (typeof m.u === 'string') out.u = m.u.slice(0, 64);
        } else {
          if (typeof m.id !== 'string') return;
          out.id = m.id.slice(0, 16);
        }
        const p = v3(m.p), v = v3(m.v);
        if (p) out.p = p;
        if (v) out.v = v.map((x) => Math.max(-20, Math.min(20, x)));
        broadcast(out, c);
        break;
      }
      case 'sleep':
        c.sleeping = !!m.on;
        checkSleep();
        break;
      case 'end': { // the End's dragon and crystals, from whoever runs them
        const st = m.s;
        if (!st || typeof st !== 'object' || !Array.isArray(st.crystals)) return;
        world.endState = {
          dragonDead: !!st.dragonDead || !!(world.endState && world.endState.dragonDead),
          dragonHp: num(st.dragonHp, 0, 200, 200),
          crystals: st.crystals.slice(0, 10).map((v) => !!v),
          portalOpen: !!st.portalOpen || !!(world.endState && world.endState.portalOpen),
        };
        dirty = true;
        broadcast({ t: 'end', s: world.endState, slain: !!m.slain }, c);
        if (m.slain) { broadcast({ t: 'ev', id: c.id, n: c.name, k: 'dragon', s: '' }); log(`${c.name} slew the ender dragon`); brain.addRumor('dragon', c.name); }
        break;
      }
      case 'b': { // block edits [[x, y, z, id], ...] in dimension d
        if (!Array.isArray(m.l)) return;
        const dim = dimOf(m.d);
        if (dim === 3) return; // (nothing to build on in space)
        const now = Date.now();
        if (now - c.editWindow > 1000) { c.editWindow = now; c.editCount = 0; }
        const out = [];
        for (const e of m.l.slice(0, 1024)) {
          if (!Array.isArray(e) || c.editCount >= 4000) break;
          const [x, y, z, b] = e;
          if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z) || !Number.isInteger(b)) continue;
          if (y < 0 || y >= WORLD_HEIGHT || b < 0 || b > 65535 || !BLOCKS[b & 255] || Math.abs(x) > 5e5 || Math.abs(z) > 5e5) continue;
          applyEdit(x, y, z, b, dim);
          out.push([x, y, z, b]);
          c.editCount++;
        }
        if (out.length) broadcast(dim ? { t: 'b', id: c.id, l: out, d: dim } : { t: 'b', id: c.id, l: out }, c);
        break;
      }
      case 'drop': { // an item dropped in someone's game: everyone sees it, one player gets it
        const i = typeof m.i === 'string' ? m.i.slice(0, 48) : '';
        const it = int(m.it);
        if (!i || !i.startsWith(c.id + '.') || world.items.has(i) || !it || !itemDef(it)) return;
        const now = Date.now();
        if (now - c.dropWindow > 1000) { c.dropWindow = now; c.dropCount = 0; }
        if (++c.dropCount > 80) return;
        const vec = (a) => (Array.isArray(a) ? a.slice(0, 3).map((v) => num(v, -3e7, 3e7)) : [0, 0, 0]);
        spawnItem({ i, it, n: Math.max(1, Math.min(64, int(m.n) || 1)), w: Math.max(0, int(m.w) || 0), dl: num(m.dl, 0, 5, 0.5), p: vec(m.p), v: vec(m.v).map((v) => Math.max(-30, Math.min(30, v))), d: dimOf(m.d), e: cleanEnch(m.e) }, c);
        break;
      }
      case 'take': { // first come, first served
        const i = String(m.i || '');
        if (world.items.has(i)) {
          world.items.delete(i);
          send(c, { t: 'took', i, by: c.id });
          broadcast({ t: 'gone', i }, c);
        } else send(c, { t: 'gone', i });
        break;
      }
      case 'open': { // a chest or furnace: lent to one player at a time
        const d = dimOf(m.d);
        const k = String(m.k || '');
        if (!/^-?\d+,-?\d+,-?\d+$/.test(k)) return;
        const lk = lockKey(d, k);
        const holder = locks.get(lk);
        if (holder && holder !== c && clients.get(holder.id) === holder) { send(c, { t: 'cont', k, busy: holder.name }); return; }
        const [x, y, z] = parseKey(k);
        const v = editAt(x, y, z, d);
        const kind = v === null ? null : kindOf(v & 255);
        if (kind !== 'chest' && kind !== 'furnace' && kind !== 'brewing') { send(c, { t: 'cont', k, c: null }); return; }
        let e = world.bents[d].get(k);
        if (!e || e.kind !== kind) {
          e = newEntity(kind);
          // a chest a structure left behind: filled the first time anyone opens it
          const loot = int(m.loot);
          if (kind === 'chest' && loot > 0 && loot < 16) { const slots = rollLoot(loot, world.seed, x, y, z); if (slots) e.slots = slots; }
          world.bents[d].set(k, e);
          dirty = true;
        }
        locks.set(lk, c);
        send(c, { t: 'cont', k, c: serializeEntity(e) });
        break;
      }
      case 'cput': case 'close': { // what the player holding it open has done with it
        const d = dimOf(m.d);
        const k = String(m.k || '');
        const lk = lockKey(d, k);
        if (locks.get(lk) !== c) return;
        const old = world.bents[d].get(k);
        const e = loadEntity(m.c);
        if (old && e && e.kind === old.kind) { world.bents[d].set(k, e); dirty = true; }
        if (m.t === 'close') locks.delete(lk);
        break;
      }
      case 'bent': { // a sign's words
        const d = dimOf(m.d);
        const k = String(m.k || '');
        if (!/^-?\d+,-?\d+,-?\d+$/.test(k)) return;
        const e = loadEntity(m.e);
        if (!e || e.kind !== 'sign') return;
        const [x, y, z] = parseKey(k);
        const v = editAt(x, y, z, d);
        if (v === null || kindOf(v & 255) !== 'sign') return;
        world.bents[d].set(k, e);
        dirty = true;
        broadcast({ t: 'bent', k, d, e: serializeEntity(e) }, c);
        break;
      }
      case 'claim': { // a chunk with a structure's creatures, made for the first time in someone's game
        const d = dimOf(m.d);
        const k = Number(m.k);
        if (!Number.isFinite(k)) return;
        const ok = !world.claims[d].has(k);
        if (ok) { world.claims[d].add(k); dirty = true; }
        send(c, { t: 'claimed', k, d, ok: ok ? 1 : 0 });
        break;
      }
      case 'pmobs': { // the creatures that stay which this player simulates (l), and the ones let go (rel)
        const d = dimOf(m.d);
        const map = world.pmobs[d];
        const seen = new Set();
        for (const raw of Array.isArray(m.l) ? m.l.slice(0, 512) : []) {
          const cr = cleanCreature(raw);
          if (!cr) continue;
          const r = map.get(cr.uid);
          if (r && r.owner && r.owner !== c.id && clients.get(r.owner)) continue; // someone else has it
          if (!r && map.size >= MAX_PMOBS) continue;
          map.set(cr.uid, { c: cr, owner: c.id });
          seen.add(cr.uid);
        }
        for (const raw of Array.isArray(m.rel) ? m.rel.slice(0, 512) : []) {
          const cr = cleanCreature(raw);
          if (!cr) continue;
          const r = map.get(cr.uid);
          if (r && r.owner && r.owner !== c.id && clients.get(r.owner)) continue;
          if (!r && map.size >= MAX_PMOBS) continue;
          map.set(cr.uid, { c: cr, owner: null });
          seen.add(cr.uid);
        }
        // ours that are in neither list are gone (died, or picked back up as items)
        if (m.full) for (const [uid, r] of map) if (r.owner === c.id && !seen.has(uid)) map.delete(uid);
        dirty = true;
        break;
      }
      case 'm': // creature snapshots from the client that simulates them
        if (Array.isArray(m.l) && m.l.length <= 96) broadcast({ t: 'm', id: c.id, l: m.l }, c, true);
        break;
      case 'hit': case 'hurt': case 'knock': case 'loot': case 'rtc': { // to one player
        const to = byId(m.to);
        if (!to || to === c) return;
        const out = { ...m, from: c.id };
        delete out.to;
        send(to, out);
        break;
      }
      case 'fx':
        broadcast({ t: 'fx', id: c.id, k: clean(m.k, 16), p: Array.isArray(m.p) ? m.p.slice(0, 3).map((v) => num(v, -3e7, 3e7)) : [0, 0, 0], pw: num(m.pw, 0, 8, 3) }, c);
        break;
      case 'chat': {
        const text = clean(m.x, 200);
        if (!text) return;
        const now = Date.now();
        c.chatTimes = c.chatTimes.filter((x) => now - x < 5000);
        if (c.chatTimes.length >= 6) return;
        c.chatTimes.push(now);
        broadcast({ t: 'chat', id: c.id, n: c.name, x: text });
        break;
      }
      case 'ev': // death and other notices shown to everyone
        broadcast({ t: 'ev', id: c.id, n: c.name, k: clean(m.k, 24), s: clean(m.s, 24) }, c);
        if (m.k === 'death') brain.addRumor('death', c.name, clean(m.s, 24));
        break;
      case 'talk': case 'vnote': // a player talking to a villager, or doing something to one
        brain.onTalk(c, m, villagerHooks).catch((e) => log('villager talk failed: ' + e.message));
        break;
      case 'vchat': // two villagers (that this player's game runs) meet: what they say to each other
        brain.onChat2(c, m, villagerHooks).catch((e) => log('villager chat failed: ' + e.message));
        break;
      case 'vopen': case 'vclose': { // the talk screen: the villager stops and faces them (whoever runs it)
        const u = typeof m.u === 'string' && /^[\w.:-]{1,40}$/.test(m.u) ? m.u : null;
        if (!u) return;
        const d = Number.isInteger(m.d) ? m.d : 0;
        if (m.t === 'vopen') send(c, { t: 'vrec', u, r: brain.recordSummary(c, u, world.dayCount), ai: brain.status() });
        dimcast(d, { t: 'vdo', u, a: { type: m.t === 'vopen' ? 'attend' : 'release', id: c.id } }, c);
        break;
      }
      case 'voice':
        c.voice = { on: !!m.on, muted: !!m.muted };
        broadcast({ t: 'voice', id: c.id, ...c.voice }, c);
        break;
      case 'save': {
        const s = m.s;
        if (!s || typeof s !== 'object') return;
        const body = JSON.stringify(s);
        if (body.length > 65536) return;
        world.players[c.key] = s;
        dirty = true;
        break;
      }
      case 'ping':
        send(c, { t: 'pong', c: m.c, n: [...clients.values()].filter((o) => o.ready).length });
        break;
      default: break;
    }
  }

  function onClose(c) {
    clients.delete(c.id);
    for (const [lk, holder] of locks) if (holder === c) locks.delete(lk);
    for (const d of DIMS) for (const r of world.pmobs[d].values()) if (r.owner === c.id) r.owner = null;
    if (!c.ready) return;
    broadcast({ t: 'leave', id: c.id });
    checkEndHost();
    checkSleep();
    log(`${c.name} left (${[...clients.values()].filter((o) => o.ready).length} online)`);
    dirty = true;
  }

  // ------------------------------------------------------------------ HTTP: the game itself
  const gzCache = new Map();
  async function serveFile(req, res) {
    const url = new URL(req.url, 'http://x');
    let path = decodeURIComponent(url.pathname);
    if (path === '/lumen-server.json') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ lumencraft: true, v: PROTOCOL, name: cfg.name, password: !!cfg.password, players: [...clients.values()].filter((c) => c.ready).length, max: cfg.maxPlayers, ai: brain.status() }));
      return;
    }
    const sourceMode = !existsSync(join(cfg.webRoot, 'src')) ? false : !cfg.webRoot.endsWith(sep + 'dist');
    if (sourceMode && !SOURCE_PUBLIC.some((r) => r.test(path))) return notFound(res);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(cfg.webRoot, path));
    if (!file.startsWith(cfg.webRoot + sep) && file !== cfg.webRoot) return notFound(res);
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) return notFound(res);
    const ext = extname(file);
    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
    let body;
    if (COMPRESS.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      const key = file + ':' + s.mtimeMs;
      body = gzCache.get(key);
      if (!body) { body = gzipSync(await readFile(file)); gzCache.set(key, body); }
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
    } else body = await readFile(file);
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  const notFound = (res) => { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); };

  const http = createServer((req, res) => {
    // single-player games ask their villagers here (the memories travel with the request)
    const api = /^\/api\/(talk|chat2)(\?|$)/.exec(req.url);
    if (api) {
      brain.handleHttp(req, res, api[1]).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
      return;
    }
    serveFile(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  http.on('upgrade', (req, socket) => {
    if (!req.url.startsWith('/ws')) { socket.destroy(); return; }
    const ws = acceptUpgrade(req, socket, { maxMessage: 1 << 20 });
    if (!ws) return;
    const c = { id: String(nextId++), ws, ready: false, name: '', key: '', state: null, voice: { on: false, muted: false }, lastSeen: Date.now(), chatTimes: [], editWindow: 0, editCount: 0, dropWindow: 0, dropCount: 0 };
    clients.set(c.id, c);
    ws.on('message', (data, binary) => { if (!binary) onMessage(c, data); });
    ws.on('close', () => onClose(c));
  });

  // ------------------------------------------------------------------ clocks
  let last = Date.now();
  let lastTimeBroadcast = 0;
  const tick = setInterval(() => {
    const now = Date.now();
    const dt = (now - last) / 1000;
    last = now;
    const online = [...clients.values()].filter((c) => c.ready);
    if (online.length) {
      // the day only moves on while someone is playing
      world.dayTime += dt / (Math.max(1, cfg.dayLength) * 60);
      if (world.dayTime >= 1) { world.dayTime -= 1; world.dayCount++; }
      if (now - lastTimeBroadcast > 10000) { lastTimeBroadcast = now; broadcast({ t: 'time', d: world.dayTime, n: world.dayCount }); }
      // the weather everyone shares
      if (stepWeatherClock(world.weather, dt)) {
        dirty = true;
        broadcast({ t: 'weather', r: world.weather.target, s: world.weather.stormTarget });
        log(world.weather.target > 0 ? (world.weather.stormTarget ? 'a thunderstorm rolls in' : 'it starts to rain') : 'the rain stops');
      }
      adoptCreatures();
    }
    for (const c of clients.values()) {
      if (now - c.lastSeen > 60000) c.ws.close(4001);
      else if (now - c.lastSeen > 20000) c.ws.ping();
    }
    // furnaces nobody has open cook here (the one a player has open runs in their game)
    if (online.length) {
      for (const d of GROUND_DIMS) {
        for (const [k, e] of world.bents[d]) {
          if (e.kind === 'brewing' && !locks.has(lockKey(d, k))) { if (tickBrewing(e, dt)) dirty = true; continue; }
          if (e.kind !== 'furnace' || locks.has(lockKey(d, k)) || (!e.burn && !e.slots[0])) continue;
          const wasLit = furnaceLit(e);
          if (tickFurnace(e, dt)) dirty = true;
          const lit = furnaceLit(e);
          if (lit === wasLit) continue;
          const [x, y, z] = parseKey(k);
          const v = editAt(x, y, z, d);
          if (v === null || kindOf(v & 255) !== 'furnace') continue;
          const id = BLOCKS.find((bd) => bd.key === (lit ? 'lit_furnace' : 'furnace')).id;
          const nv = id | (v & 0xff00);
          applyEdit(x, y, z, nv, d);
          broadcast(d ? { t: 'b', id: 'server', l: [[x, y, z, nv]], d } : { t: 'b', id: 'server', l: [[x, y, z, nv]] });
        }
      }
    }
    // dropped items vanish after a while
    for (const [i, it] of world.items) if (now - it.at > ITEM_LIFE) world.items.delete(i);
  }, 1000);
  const autosave = setInterval(() => { if (dirty) saveWorld(); }, 30000);

  const ready = (async () => {
    await loadWorld();
    if (dirty) await saveWorld();
    await new Promise((r) => http.listen(cfg.port, cfg.host, r));
    const addr = http.address();
    log(`Lumencraft server "${cfg.name}" on http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${addr.port}/ (game files from ${cfg.webRoot})`);
    if (!cfg.turn.length) log('no TURN server configured: voice chat may fail between some networks (see server/README.zh-CN.md)');
    return addr.port;
  })();

  async function stop() {
    clearInterval(tick);
    clearInterval(autosave);
    for (const c of clients.values()) c.ws.close(1001);
    await new Promise((r) => http.close(r));
    await saveWorld();
  }

  return { ready, stop, world, clients, config: cfg, save: saveWorld };
}

// run directly: node server/server.mjs
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const srv = startServer();
  srv.ready.catch((e) => { console.error('could not start:', e.message); process.exit(1); });
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log('saving the world and shutting down...');
    await srv.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
