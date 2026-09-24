import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, PROTOCOL } from '../server/server.mjs';

// a test client on Node's built-in WebSocket that queues messages until they are awaited
function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const queue = [];
  const waiters = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString());
    const i = waiters.findIndex((w) => w.type === m.t);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
    else queue.push(m);
  });
  const opened = new Promise((r) => ws.addEventListener('open', r));
  return {
    ws,
    send: async (m) => { await opened; ws.send(JSON.stringify(m)); },
    next(type, ms = 3000) {
      const i = queue.findIndex((m) => m.t === type);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { type, resolve };
        waiters.push(w);
        setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); reject(new Error('timeout waiting for ' + type)); } }, ms);
      });
    },
    close: () => ws.close(),
  };
}

test('players join, see each other, share block edits and chat; the world persists', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'lumen-'));
  try {
    let srv = startServer({ port: 0, dataDir, seed: 'lighthouse', password: 'pw', quiet: true });
    const port = await srv.ready;
    const a = client(port);
    await a.send({ t: 'hello', n: 'Alice', pw: 'pw', v: PROTOCOL });
    const wa = await a.next('welcome');
    assert.equal(wa.players.length, 0);
    assert.ok(Number.isInteger(wa.seed));

    const bad = client(port);
    await bad.send({ t: 'hello', n: 'Mallory', pw: 'nope', v: PROTOCOL });
    assert.equal((await bad.next('err')).code, 'password');

    const b = client(port);
    await b.send({ t: 'hello', n: 'Bob', pw: 'pw', v: PROTOCOL });
    const wb = await b.next('welcome');
    assert.deepEqual(wb.players.map((p) => p.n), ['Alice']);
    assert.equal((await a.next('join')).n, 'Bob');

    const dup = client(port);
    await dup.send({ t: 'hello', n: 'bob', pw: 'pw', v: PROTOCOL });
    assert.equal((await dup.next('err')).code, 'nameTaken');

    await a.send({ t: 'st', p: [1, 70, 2], y: 0.5, pi: 0, h: 3, f: 0 });
    const st = await b.next('st');
    assert.deepEqual([st.id, st.p], [wa.id, [1, 70, 2]]);

    await a.send({ t: 'b', l: [[5, 60, -3, 0], [5, 61, -3, 4], [1, 999, 1, 3]] });
    const edits = await b.next('b');
    assert.equal(edits.l.length, 2); // the out-of-range one is dropped

    await b.send({ t: 'chat', x: '你好 <b>' });
    const chat = await a.next('chat');
    assert.equal(chat.x, '你好 b');
    assert.equal(chat.n, 'Bob');

    // messages for one player go only to that player
    await a.send({ t: 'rtc', to: wb.id, d: { sdp: { type: 'offer', sdp: 'x' } } });
    const rtc = await b.next('rtc');
    assert.equal(rtc.from, wa.id);

    // a large message survives the trip (16-bit and 64-bit frame lengths)
    const big = 'x'.repeat(70000);
    await a.send({ t: 'save', s: { note: big.slice(0, 60000) } });
    await a.send({ t: 'ping', c: 1 });
    assert.equal((await a.next('pong')).n, 2);

    b.close();
    assert.equal((await a.next('leave')).id, wb.id);
    a.close();
    await srv.stop();

    const saved = JSON.parse(readFileSync(join(dataDir, 'world.json'), 'utf8'));
    assert.equal(saved.seed, wa.seed);
    assert.ok(saved.players.alice && saved.players.alice.note.length === 60000);

    // restart: same seed, the edits come back with the welcome
    srv = startServer({ port: 0, dataDir, password: 'pw', quiet: true });
    const port2 = await srv.ready;
    const c = client(port2);
    await c.send({ t: 'hello', n: 'Alice', pw: 'pw', v: PROTOCOL });
    const wc = await c.next('welcome');
    assert.equal(wc.seed, wa.seed);
    const flat = Object.values(wc.edits).flat();
    assert.equal(flat.length, 4); // two edits, index + id each
    assert.equal(wc.me.note.length, 60000);
    c.close();
    await srv.stop();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the server serves the game but not its own data', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'lumen-'));
  try {
    const srv = startServer({ port: 0, dataDir, quiet: true, webRoot: join(process.cwd()) });
    const port = await srv.ready;
    const get = (p) => fetch(`http://127.0.0.1:${port}${p}`);
    assert.equal((await get('/')).status, 200);
    assert.equal((await get('/src/main.js')).status, 200);
    const info = await (await get('/lumen-server.json')).json();
    assert.equal(info.lumencraft, true);
    assert.equal((await get('/server/data/world.json')).status, 404);
    assert.equal((await get('/package.json')).status, 404);
    assert.equal((await get('/../../etc/passwd')).status, 404);
    await srv.stop();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
