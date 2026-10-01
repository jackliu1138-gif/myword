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
    // (the nether, the end, the Moon and Mars; space has no ground to edit)
    assert.deepEqual(wa.dimEdits, { 1: {}, 2: {}, 4: {}, 5: {} });
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

test('dropped items are shared first come first served; chests are lent one at a time and spill when broken; signs and furnaces', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'lumen-'));
  const open = [];
  let srv = null;
  try {
    srv = startServer({ port: 0, dataDir, seed: 'chests', quiet: true });
    const port = await srv.ready;
    const a = client(port), b = client(port);
    open.push(a, b);
    await a.send({ t: 'hello', n: 'Ann', v: PROTOCOL });
    const wa = await a.next('welcome');
    assert.deepEqual(wa.items, []);
    await b.send({ t: 'hello', n: 'Ben', v: PROTOCOL });
    const wb = await b.next('welcome');
    // a drop is announced to the others; the first to ask for it gets it
    await a.send({ t: 'drop', i: wa.id + '.1', it: 286, n: 3, w: 0, dl: 2, p: [1, 70, 1], v: [0, 2, 0], d: 0 });
    const d = await b.next('drop');
    assert.deepEqual([d.i, d.it, d.n], [wa.id + '.1', 286, 3]);
    await a.send({ t: 'drop', i: wb.id + '.9', it: 286, n: 1, p: [0, 0, 0], v: [0, 0, 0], d: 0 }); // not theirs to name
    await b.send({ t: 'take', i: d.i });
    assert.equal((await b.next('took')).by, wb.id);
    assert.equal((await a.next('gone')).i, d.i);
    await a.send({ t: 'take', i: d.i });
    assert.equal((await a.next('gone')).i, d.i, 'too late');
    // a chest: placed (an edit with its facing in the state), opened by one player at a time
    const chest = 124 | (2 << 8);
    await a.send({ t: 'b', l: [[5, 60, 5, chest]] });
    assert.deepEqual((await b.next('b')).l, [[5, 60, 5, chest]], 'states travel with edits');
    await a.send({ t: 'open', k: '5,60,5', d: 0 });
    const c1 = await a.next('cont');
    assert.equal(c1.c.kind, 'chest');
    await b.send({ t: 'open', k: '5,60,5', d: 0 });
    assert.equal((await b.next('cont')).busy, 'Ann');
    const slots = new Array(27).fill(null);
    slots[0] = [260, 5, 0];
    await a.send({ t: 'close', k: '5,60,5', d: 0, c: { kind: 'chest', slots } });
    await b.send({ t: 'open', k: '5,60,5', d: 0 });
    const c2 = await b.next('cont');
    assert.deepEqual(c2.c.slots[0], [260, 5, 0]);
    // breaking it (while Ben has it open) spills what it held for everyone and tells Ben
    await a.send({ t: 'b', l: [[5, 60, 5, 0]] });
    assert.equal((await b.next('cgone')).k, '5,60,5');
    const spill = await a.next('drop');
    assert.deepEqual([spill.it, spill.n, spill.p], [260, 5, [5.5, 60.5, 5.5]]);
    // signs: only on a sign block, and passed on to everyone
    await a.send({ t: 'bent', k: '7,60,7', d: 0, e: { kind: 'sign', lines: ['no sign here'] } });
    await a.send({ t: 'b', l: [[7, 60, 7, 163 | (1 << 8)]] });
    await a.send({ t: 'bent', k: '7,60,7', d: 0, e: { kind: 'sign', lines: ['你好', 'Ben', '', '', 'extra'] } });
    const bent = await b.next('bent');
    assert.deepEqual([bent.k, bent.e.lines], ['7,60,7', ['你好', 'Ben', '', '']]);
    // a furnace nobody has open keeps cooking on the server and lights up for everyone
    await a.send({ t: 'b', l: [[9, 60, 9, 125 | (2 << 8)]] });
    await a.send({ t: 'open', k: '9,60,9', d: 0 });
    await a.next('cont');
    await a.send({ t: 'close', k: '9,60,9', d: 0, c: { kind: 'furnace', slots: [[371, 1, 0], [257, 1, 0], null], burn: 0, burnMax: 0, cook: 0 } });
    let lit = await b.next('b', 4000);
    while (lit.l[0][0] !== 9 || (lit.l[0][3] & 255) === 125) lit = await b.next('b', 4000); // (the placing edit comes first)
    assert.equal(lit.l[0][3], 126 | (2 << 8), 'lit, facing kept');
    b.close();
    a.close();
    await srv.stop();
    srv = null;
    // what chests hold and what signs say is kept on disk; a late joiner reads the sign
    srv = startServer({ port: 0, dataDir, quiet: true });
    const c = client(await srv.ready);
    open.push(c);
    await c.send({ t: 'hello', n: 'Cat', v: PROTOCOL });
    const wc = await c.next('welcome');
    assert.deepEqual(wc.bents[0]['7,60,7'].lines, ['你好', 'Ben', '', '']);
    assert.equal(wc.bents[0]['9,60,9'], undefined, 'furnaces are not in the welcome');
    await c.send({ t: 'open', k: '9,60,9', d: 0 });
    assert.equal((await c.next('cont')).c.kind, 'furnace');
    c.close();
    await srv.stop();
    srv = null;
  } finally {
    for (const cl of open) cl.close();
    if (srv) await srv.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('protocol 4: the generator version, shared weather, structure creatures spawned once, creatures that stay, loot chests, brewing stands, enchanted drops', async () => {
  const { BLOCK } = await import('../src/world/blocks.js');
  const { ITEM } = await import('../src/sim/items.js');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const dataDir = mkdtempSync(join(tmpdir(), 'lumen-'));
  const open = [];
  let srv = null;
  try {
    srv = startServer({ port: 0, dataDir, seed: 'villages', quiet: true });
    const port = await srv.ready;
    const a = client(port), b = client(port);
    open.push(a, b);
    await a.send({ t: 'hello', n: 'Ann', v: PROTOCOL });
    const wa = await a.next('welcome');
    assert.equal(wa.gen, 2, 'a new world is made with the new generator');
    assert.ok(wa.weather && typeof wa.weather.r === 'number' && (wa.weather.s === 0 || wa.weather.s === 1), 'the weather everyone shares');
    await b.send({ t: 'hello', n: 'Ben', v: PROTOCOL });
    await b.next('welcome');
    // a village's creatures: whoever claims the chunk first spawns them, nobody else does
    await a.send({ t: 'claim', k: 123456, d: 0 });
    assert.equal((await a.next('claimed')).ok, 1);
    await b.send({ t: 'claim', k: 123456, d: 0 });
    assert.equal((await b.next('claimed')).ok, 0);
    await b.send({ t: 'claim', k: 123456, d: 1 });
    assert.equal((await b.next('claimed')).ok, 1, 'each dimension has its own');
    // creatures that stay: Ann simulates a villager; when she leaves, Ben (near it) is handed it
    const villager = { uid: 'p1.abc.1', type: 'villager', p: [10, 70, 10], yaw: 0, hp: 20, v: 1, persistent: true, trades: [0, 2] };
    await a.send({ t: 'st', p: [12, 70, 12], y: 0, pi: 0, h: 0, f: 0 });
    await a.send({ t: 'pmobs', d: 0, l: [villager], rel: [], full: 1 });
    await b.send({ t: 'st', p: [30, 70, 30], y: 0, pi: 0, h: 0, f: 0 });
    a.close();
    const adopt = await b.next('adopt', 5000);
    assert.equal(adopt.d, 0);
    assert.deepEqual(adopt.l.map((c) => [c.uid, c.type, c.trades]), [['p1.abc.1', 'villager', [0, 2]]]);
    // a chest a structure left: filled the first time it is opened
    await b.send({ t: 'b', l: [[3, 50, 3, BLOCK.CHEST | (2 << 8)]] });
    await b.send({ t: 'open', k: '3,50,3', d: 0, loot: 1 });
    const loot = await b.next('cont');
    assert.ok(loot.c.slots.filter(Boolean).length > 0, 'the dungeon chest has loot');
    await b.send({ t: 'close', k: '3,50,3', d: 0, c: loot.c });
    // a brewing stand is lent like a furnace
    await b.send({ t: 'b', l: [[4, 50, 4, BLOCK.BREWING_STAND]] });
    await b.send({ t: 'open', k: '4,50,4', d: 0 });
    const brew = await b.next('cont');
    assert.equal(brew.c.kind, 'brewing');
    assert.equal(brew.c.slots.length, 5);
    await b.send({ t: 'close', k: '4,50,4', d: 0, c: brew.c });
    // enchantments travel with dropped items (and odd ones are dropped)
    const wb2 = client(port);
    open.push(wb2);
    await wb2.send({ t: 'hello', n: 'Cy', v: PROTOCOL });
    const wc = await wb2.next('welcome');
    await wb2.send({ t: 'drop', i: wc.id + '.1', it: ITEM.DIAMOND_SWORD, n: 1, w: 3, p: [1, 70, 1], v: [0, 0, 0], d: 0, e: { sharpness: 3, bogus: 99, '<x>': 1 } });
    const dr = await b.next('drop');
    assert.deepEqual(dr.e, { sharpness: 3 });
    b.close();
    wb2.close();
    await srv.stop();
    srv = null;
    // restart: the villager, the claims and the loot chest's contents are kept
    srv = startServer({ port: 0, dataDir, quiet: true });
    const c = client(await srv.ready);
    open.push(c);
    await c.send({ t: 'hello', n: 'Dee', v: PROTOCOL });
    const wd = await c.next('welcome');
    assert.equal(wd.gen, 2);
    await c.send({ t: 'claim', k: 123456, d: 0 });
    assert.equal((await c.next('claimed')).ok, 0, 'claims are kept');
    await c.send({ t: 'st', p: [8, 70, 8], y: 0, pi: 0, h: 0, f: 0 });
    const ad2 = await c.next('adopt', 5000);
    assert.equal(ad2.l[0].uid, 'p1.abc.1');
    c.close();
    await srv.stop();
    srv = null;
    // a world from before the 384-high one (no generator version saved) keeps its terrain
    const old = mkdtempSync(join(tmpdir(), 'lumen-'));
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, 'world.json'), JSON.stringify({ version: 1, seed: 42, dayTime: 0.3, dayCount: 2, edits: {}, dimEdits: {}, players: {} }));
    srv = startServer({ port: 0, dataDir: old, quiet: true });
    const o = client(await srv.ready);
    open.push(o);
    await o.send({ t: 'hello', n: 'Old', v: PROTOCOL });
    const wo = await o.next('welcome');
    assert.equal(wo.gen, 1);
    assert.equal(wo.seed, 42);
    o.close();
    await srv.stop();
    srv = null;
    rmSync(old, { recursive: true, force: true });
  } finally {
    for (const cl of open) cl.close();
    if (srv) await srv.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
