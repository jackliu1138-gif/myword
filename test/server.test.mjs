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

test('everyone in the overworld asleep skips the night; each dimension keeps its own edits', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'lumen-'));
  const open = [];
  let srv = null;
  try {
    srv = startServer({ port: 0, dataDir, seed: 'beds', quiet: true });
    const port = await srv.ready;
    const a = client(port), b = client(port);
    open.push(a, b);
    await a.send({ t: 'hello', n: 'Ann', v: PROTOCOL });
    const wa = await a.next('welcome');
    assert.deepEqual(wa.dimEdits, { 1: {}, 2: {} });
    await b.send({ t: 'hello', n: 'Ben', v: PROTOCOL });
    await b.next('welcome');
    await a.send({ t: 'st', p: [0, 70, 0], y: 0, pi: 0, h: 0, f: 0 });
    await b.send({ t: 'st', p: [5, 70, 0], y: 0, pi: 0, h: 0, f: 0, a: [329, 0, 0, 336] });
    const st = await a.next('st');
    assert.deepEqual(st.a, [329, 0, 0, 336], 'armour is passed on');
    // one of two in bed: nothing happens yet
    await a.send({ t: 'sleep', on: true });
    const s1 = await b.next('sleepers');
    assert.deepEqual([s1.n, s1.m], [1, 2]);
    // someone in the nether does not count
    await b.send({ t: 'st', p: [5, 70, 0], y: 0, pi: 0, h: 0, f: 0, d: 1 });
    let s2 = await a.next('sleepers');
    while (s2.m !== 1) s2 = await a.next('sleepers');
    assert.deepEqual([s2.n, s2.m], [1, 1]);
    const wake = await a.next('wake', 6000);
    assert.equal(wake.skip, true);
    // (a regular clock update may still be queued before the skip)
    let time = await a.next('time');
    while (time.d >= 0.01) time = await a.next('time');
    assert.ok(time.d < 0.01);
    // edits in the nether reach others with their dimension, and are stored apart
    await b.send({ t: 'b', l: [[1, 40, 1, 38]], d: 1 });
    const e1 = await a.next('b');
    assert.equal(e1.d, 1);
    await a.send({ t: 'b', l: [[2, 60, 2, 4]] });
    const e0 = await b.next('b');
    assert.equal(e0.d, undefined);
    // the first player in the End runs its dragon
    await b.send({ t: 'st', p: [100, 49, 0], y: 0, pi: 0, h: 0, f: 0, d: 2 });
    let host = await a.next('endHost');
    assert.equal(host.id, (await b.next('endHost')).id);
    await b.send({ t: 'end', s: { dragonDead: true, dragonHp: 0, crystals: new Array(10).fill(false), portalOpen: true }, slain: true });
    const end = await a.next('end');
    assert.equal(end.s.dragonDead, true);
    assert.equal((await a.next('ev')).k, 'dragon');
    b.close();
    host = await a.next('endHost');
    assert.equal(host.id, null, 'nobody left in the End');
    a.close();
    await srv.stop();
    srv = null;
    // restart: the nether's edit and the End's state come back
    srv = startServer({ port: 0, dataDir, quiet: true });
    const c = client(await srv.ready);
    open.push(c);
    await c.send({ t: 'hello', n: 'Cat', v: PROTOCOL });
    const wc = await c.next('welcome');
    assert.equal(Object.values(wc.dimEdits[1]).flat().length, 2);
    assert.equal(Object.values(wc.edits).flat().length, 2);
    assert.equal(wc.endState.dragonDead, true);
    c.close();
    await srv.stop();
    srv = null;
  } finally {
    for (const c of open) c.close();
    if (srv) await srv.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
