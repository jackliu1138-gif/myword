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

export const PROTOCOL = 2; // 2: beds, armour, the nether and the end (new block and item ids)
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
  // edits: the overworld's; dimEdits: the nether's (1) and the end's (2)
  const world = { seed: 0, dayTime: 0.06, dayCount: 0, edits: new Map(), dimEdits: { 1: new Map(), 2: new Map() }, endState: null, players: {} };
  let dirty = false;
  let nextId = 1;
  const clients = new Map();

  // ------------------------------------------------------------------ world on disk
  async function loadWorld() {
    try {
      const d = JSON.parse(await readFile(worldFile, 'utf8'));
      world.seed = d.seed | 0;
      world.dayTime = num(d.dayTime, 0, 1, 0.06);
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
      readEdits(d.dimEdits && d.dimEdits[1], world.dimEdits[1]);
      readEdits(d.dimEdits && d.dimEdits[2], world.dimEdits[2]);
      world.endState = d.endState && typeof d.endState === 'object' ? d.endState : null;
      log(`world loaded: seed ${world.seed}, ${world.edits.size} edited chunks, ${Object.keys(world.players).length} known players`);
    } catch (e) {
      world.seed = seedFromString(cfg.seed);
      dirty = true;
      log(`new world, seed ${world.seed}`);
    }
  }

  function serializeEdits(edits = world.edits) {
    const out = {};
    for (const [k, m] of edits) out[k] = Array.from(m.entries()).flat();
    return out;
  }
  const serializeDimEdits = () => ({ 1: serializeEdits(world.dimEdits[1]), 2: serializeEdits(world.dimEdits[2]) });

  let saving = null;
  async function saveWorld() {
    if (saving) await saving;
    const job = (async () => {
      dirty = false;
      await mkdir(cfg.dataDir, { recursive: true });
      const body = JSON.stringify({
        version: 1, seed: world.seed, dayTime: world.dayTime, dayCount: world.dayCount, edits: serializeEdits(),
        dimEdits: serializeDimEdits(), endState: world.endState, players: world.players,
      });
      const tmp = worldFile + '.tmp';
      await writeFile(tmp, body);
      await rename(tmp, worldFile);
    })();
    saving = job;
    try { await job; } catch (e) { dirty = true; console.error('saving the world failed:', e.message); } finally { if (saving === job) saving = null; }
  }

  function applyEdit(x, y, z, b, d = 0) {
    const edits = d === 1 || d === 2 ? world.dimEdits[d] : world.edits;
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    const k = chunkKey(cx, cz);
    let m = edits.get(k);
    if (!m) { m = new Map(); edits.set(k, m); }
    m.set((y << 8) | ((z - cz * 16) << 4) | (x - cx * 16), b);
    dirty = true;
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
      endState: world.endState, endHost, me: saved,
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
        const p = Array.isArray(m.p) ? m.p.slice(0, 3).map((v) => num(v, -3e7, 3e7)) : null;
        if (!p) return;
        c.state = { p, y: num(m.y, -100, 100), pi: num(m.pi, -2, 2), h: int(m.h) || 0, f: int(m.f) || 0 };
        if (Array.isArray(m.a)) c.state.a = m.a.slice(0, 4).map((v) => int(v) || 0);
        const d = m.d === 1 || m.d === 2 ? m.d : 0;
        if (d) c.state.d = d;
        broadcast({ t: 'st', id: c.id, ...c.state }, c, true);
        if ((c.lastDim || 0) !== d) { c.lastDim = d; c.sleeping = false; checkEndHost(); checkSleep(); }
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
        if (m.slain) { broadcast({ t: 'ev', id: c.id, n: c.name, k: 'dragon', s: '' }); log(`${c.name} slew the ender dragon`); }
        break;
      }
      case 'b': { // block edits [[x, y, z, id], ...] in dimension d
        if (!Array.isArray(m.l)) return;
        const dim = m.d === 1 || m.d === 2 ? m.d : 0;
        const now = Date.now();
        if (now - c.editWindow > 1000) { c.editWindow = now; c.editCount = 0; }
        const out = [];
        for (const e of m.l.slice(0, 1024)) {
          if (!Array.isArray(e) || c.editCount >= 4000) break;
          const [x, y, z, b] = e;
          if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z) || !Number.isInteger(b)) continue;
          if (y < 0 || y > 127 || b < 0 || b > 255 || Math.abs(x) > 5e5 || Math.abs(z) > 5e5) continue;
          applyEdit(x, y, z, b, dim);
          out.push([x, y, z, b]);
          c.editCount++;
        }
        if (out.length) broadcast(dim ? { t: 'b', id: c.id, l: out, d: dim } : { t: 'b', id: c.id, l: out }, c);
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
        break;
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
      res.end(JSON.stringify({ lumencraft: true, v: PROTOCOL, name: cfg.name, password: !!cfg.password, players: [...clients.values()].filter((c) => c.ready).length, max: cfg.maxPlayers }));
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
    serveFile(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  http.on('upgrade', (req, socket) => {
    if (!req.url.startsWith('/ws')) { socket.destroy(); return; }
    const ws = acceptUpgrade(req, socket, { maxMessage: 1 << 20 });
    if (!ws) return;
    const c = { id: String(nextId++), ws, ready: false, name: '', key: '', state: null, voice: { on: false, muted: false }, lastSeen: Date.now(), chatTimes: [], editWindow: 0, editCount: 0 };
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
    }
    for (const c of clients.values()) {
      if (now - c.lastSeen > 60000) c.ws.close(4001);
      else if (now - c.lastSeen > 20000) c.ws.ping();
    }
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
