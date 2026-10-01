// Village life: the places villagers tell of (real ones, which way and how far), two villagers
// talking with each other (written by a model, or scripted), what they make of what they see
// (words for each), how they move for it (face to face for a chat, indoors in a storm) and the
// gestures that go with it; and the server's side: a conversation for single-player games, one
// heard by everyone near on a server (and not too often), and the things villagers only take note of.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  personaFor, offlineReply, cleanAction, buildMessages, newRecord, intentOf, compass, cleanPlaces, placeLine, offlineDialogue, parseDialogue,
  cleanDialogue, buildDialogueMessages, reactLine, REACT_KINDS, rumorText, cleanRumor,
} from '../src/sim/brain.js';
import { Simulation } from '../src/sim/simulation.js';
import { BLOCK, IS_SOLID } from '../src/world/blocks.js';
import { newPose } from '../src/render/mobmodels.js';
import { TerrainGenerator2 } from '../src/world/generator2.js';
import { startServer, PROTOCOL } from '../server/server.mjs';
import { createBrain } from '../server/brain.mjs';

const PLACES = [{ k: 'temple', dir: 'ne', d: 352 }, { k: 'mineshaft', dir: 's', d: 84 }];

test('places: the way as a point of the compass, checked as sent, told in words', () => {
  assert.equal(compass(0, -10), 'n', 'north is -Z');
  assert.equal(compass(10, 0), 'e');
  assert.equal(compass(-7, 7), 'sw');
  assert.equal(compass(5, -5), 'ne');
  const clean = cleanPlaces([...PLACES, { k: 'temple', dir: 'n', d: 9 }, { k: 'diamond_mine', dir: 'n', d: 5 }, { k: 'hut', dir: 'up', d: 4 }, null]);
  assert.deepEqual(clean, [{ k: 'temple', dir: 'ne', d: 350 }, { k: 'mineshaft', dir: 's', d: 80 }], 'one of each real kind, rounded to ten blocks');
  assert.equal(placeLine(clean[0], 'zh'), '沙漠神殿在东北边，大约350格远');
  assert.equal(placeLine(clean[1], 'en'), 'an abandoned mineshaft to the south, about 80 blocks away');
  assert.equal(placeLine({ k: 'village', dir: 'w', d: 400 }, 'en'), 'another village to the west, about 400 blocks away');
});

test('the world knows where its places are, near enough to ask about', () => {
  const g = new TerrainGenerator2(777);
  const near = [];
  for (const k of ['temple', 'hut', 'outpost', 'monument', 'mineshaft']) { const r = g.structures.locate(k, 0, 0, 1500); if (r) near.push(r); }
  assert.ok(near.length >= 3, 'a few kinds of place within reach: ' + near.map((r) => r.kind).join(','));
  for (const r of near) assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.z));
});

test('asked about treasure, a villager tells of a real place and marks it; nothing made up', () => {
  const p = personaFor('l.wp.1', 'cartographer');
  assert.equal(intentOf('附近有什么好玩的地方？'), 'treasure');
  assert.equal(intentOf('听说附近有宝藏？'), 'treasure');
  assert.equal(intentOf('Anything interesting near here?'), 'treasure');
  const r = offlineReply({ persona: p, lang: 'zh', line: '附近有什么好玩的地方？', ctx: { places: PLACES }, rec: newRecord(), rnd: () => 0.1 });
  assert.deepEqual(r.action, { type: 'rumor', place: 'temple' }, 'the nearest-first list: the temple');
  assert.ok(r.say.includes('沙漠神殿在东北边') && r.say.includes('350'), r.say);
  const none = offlineReply({ persona: p, lang: 'en', line: 'any treasure about?', ctx: {}, rec: newRecord() });
  assert.equal(none.action, null, 'no places known: nothing to mark');
  // what a model says it marks is checked against what is really there
  assert.deepEqual(cleanAction({ type: 'rumor', place: 'mineshaft' }, { places: PLACES }), { type: 'rumor', place: 'mineshaft' });
  assert.equal(cleanAction({ type: 'rumor', place: 'mansion' }, { places: PLACES }), null);
  assert.equal(cleanAction({ type: 'rumor', place: 'temple' }, {}), null);
  // and the prompt says what is there, and how to mark it
  const sys = buildMessages({ persona: p, lang: 'zh', line: '附近有宝藏吗', ctx: { phase: 'night', weather: 'storm', places: PLACES } })[0].content;
  assert.ok(sys.includes('沙漠神殿在东北边，大约350格远') && sys.includes('"type":"rumor"'), 'places and the rumor action in the prompt');
  assert.ok(sys.includes('晚上') && sys.includes('电闪雷鸣'), 'the time and the weather in words');
  assert.ok(!buildMessages({ persona: p, lang: 'en', line: 'hi', ctx: {} })[0].content.includes('rumor'), 'no places, no rumor action');
});

test('two villagers talk: scripted lines take turns, a model\'s answer is read, untidy or not', () => {
  const a = personaFor('v.a', 'farmer'), b = personaFor('v.b', 'librarian');
  for (const lang of ['zh', 'en']) {
    for (let i = 0; i < 30; i++) {
      const lines = offlineDialogue({ a, b, lang, ctx: { phase: ['morning', 'day', 'evening'][i % 3], weather: i % 4 ? 'clear' : 'rain', places: i % 2 ? PLACES : [], danger: i % 7 === 0 ? 2 : 0 }, rumors: i % 3 ? [{ k: 'moon', who: 'Ann', day: 0 }] : [], player: 'Ann' });
      assert.ok(lines.length >= 4 && lines.length <= 6, 'four to six lines: ' + lines.length);
      lines.forEach((l, j) => {
        assert.equal(l[0], j % 2, 'they take turns, A first');
        assert.ok(typeof l[1] === 'string' && l[1].length > 0 && !/\{\w+\}/.test(l[1]), 'filled in: ' + l[1]);
        assert.ok(lang === 'zh' ? /[一-鿿]/.test(l[1]) || /Ann/.test(l[1]) : !/[一-鿿]/.test(l[1]), lang + ': ' + l[1]);
        assert.ok(!/[。！]。/.test(l[1]), 'no doubled stops: ' + l[1]);
      });
    }
  }
  assert.deepEqual(parseDialogue('```json\n{"lines":[{"who":"A","say":"你好","mood":"happy"},{"who":"B","say":"嗨","mood":"cross"}]}\n```'), [[0, '你好', 'happy'], [1, '嗨', 'neutral']]);
  assert.deepEqual(parseDialogue('Here: [{"who":"A","say":"Hi"},{"who":"b","say":"Hello"}]'), [[0, 'Hi', 'neutral'], [1, 'Hello', 'neutral']]);
  assert.equal(parseDialogue('{"lines":[{"who":"A","say":"just one"}]}'), null, 'one line is not a conversation');
  assert.equal(parseDialogue('no json here'), null);
  assert.equal(cleanDialogue([[0, 'x'.repeat(300), 'happy'], [1, 'ok', 'bad'], ['junk']]).length, 2);
  assert.ok(cleanDialogue([[0, 'x'.repeat(300)], [1, 'y']])[0][1].length <= 90, 'long lines cut');
  const m = buildDialogueMessages({ a, b, lang: 'zh', ctx: { phase: 'day', weather: 'clear', places: PLACES }, rumors: [{ k: 'hero', who: '小明', s: 'zombie', day: 1 }], day: 2, player: '小明' });
  assert.ok(m[0].content.includes(a.name.zh) && m[0].content.includes(b.name.zh), 'both of them in the prompt');
  assert.ok(m[0].content.includes('打跑了僵尸') && m[0].content.includes('沙漠神殿'), 'with the gossip and the places');
});

test('a word for everything they see, in both languages; new gossip about it', () => {
  for (const kind of REACT_KINDS) {
    for (const lang of ['zh', 'en']) {
      const s = reactLine(kind, { lang, playerName: 'Ann', place: 'temple' });
      assert.ok(s.length > 1 && !/\{\w+\}/.test(s), `${kind}/${lang}: ${s}`);
    }
  }
  assert.ok(reactLine('found', { lang: 'zh', place: 'mansion' }).includes('林地府邸'));
  assert.ok(reactLine('nonsense', { lang: 'zh' }) === '');
  assert.ok(rumorText(cleanRumor({ k: 'hero', who: '小明', s: 'creeper', day: 1 }), 'zh', 1).includes('苦力怕'));
  assert.ok(rumorText(cleanRumor({ k: 'found', who: 'Ann', s: 'temple', day: 0 }), 'en', 3).includes('desert temple'));
  assert.ok(rumorText(cleanRumor({ k: 'found', who: 'Ann', s: 'village', day: 0 }), 'en', 0).includes('another village'));
});

// a flat stone world, as in sim.test.mjs
function flatWorld() {
  const get = (x, y, z) => (y <= 10 ? BLOCK.STONE : 0);
  return { getBlock: get, isSolidAt: (x, y, z) => !!IS_SOLID[get(x, y, z)], getLight: () => [15, 0], isChunkReady: () => true, surfaceHeight: () => 10, setBlock: () => true };
}

test('a chat brings two villagers face to face; a storm sends them home, even by day', () => {
  const sim = new Simulation(flatWorld(), { difficulty: 'peaceful', spawnMobs: false });
  const a = sim.spawnMob('villager', 0.5, 11, 0.5), b = sim.spawnMob('villager', 6.5, 11, 0.5);
  a.chatWith = b; a.chatUntil = 30; b.chatWith = a; b.chatUntil = 30;
  for (let i = 0; i < 160; i++) sim.tick({ dayTime: 0.3 });
  const d = Math.hypot(a.body.pos[0] - b.body.pos[0], a.body.pos[2] - b.body.pos[2]);
  assert.ok(d < 3.2, 'they came together: ' + d.toFixed(2));
  const facing = (m, o) => { const want = Math.atan2(-(o.body.pos[0] - m.body.pos[0]), -(o.body.pos[2] - m.body.pos[2])); return Math.abs(Math.atan2(Math.sin(want - m.yaw), Math.cos(want - m.yaw))); };
  assert.ok(facing(a, b) < 0.3 && facing(b, a) < 0.3, 'and turned to each other');
  const still = a.body.pos.slice();
  for (let i = 0; i < 60; i++) sim.tick({ dayTime: 0.3 });
  assert.ok(Math.hypot(a.body.pos[0] - still[0], a.body.pos[2] - still[2]) < 0.3, 'standing still while they talk');
  // a thunderstorm in the middle of the day: home
  const c = sim.spawnMob('villager', 20.5, 11, 20.5);
  c.home = [10, 11, 20];
  for (let i = 0; i < 400; i++) sim.tick({ dayTime: 0.3, storm: 2 });
  assert.ok(Math.hypot(c.body.pos[0] - 10.5, c.body.pos[2] - 20.5) < 3, 'indoors: ' + c.body.pos.map((v) => v.toFixed(1)));
  for (let i = 0; i < 20; i++) sim.tick({ dayTime: 0.3, storm: 0 });
  assert.equal(sim.storm, 0);
});

test('gestures: a nod bows the head, a cheer raises the arms and lifts them off the ground', () => {
  const k = { sw: 0, walk: 0, amt: 0, headYaw: 0, headPitch: 0 };
  const pose = (g, t) => { const r = {}; newPose(r, { id: 1, gesture: g }, 'villager', t, k); return r; };
  const rest = pose(null, 10);
  const nod = pose({ kind: 'nod', t0: 10, until: 11.2 }, 10.18);
  assert.ok(nod.head[0] < rest.head[0] - 0.1, 'head down');
  const cheer = pose({ kind: 'cheer', t0: 10, until: 12 }, 10.6);
  assert.ok(cheer.arms[0] > rest.arms[0] + 0.5, 'arms up');
  const wave = pose({ kind: 'wave', t0: 10, until: 12 }, 10.2);
  assert.ok(Math.abs(wave.arms[2]) > 0.2 && Math.abs(wave.head[2]) > 0.05, 'a wave rocks the arms and tilts the head');
  assert.ok(cheer.__lift > 0, 'off the ground');
  const done = pose({ kind: 'cheer', t0: 10, until: 12 }, 13);
  assert.deepEqual(done.arms, pose(null, 13).arms, 'and back to normal after');
  assert.equal(done.__lift, undefined);
  for (const kind of ['shake', 'wave', 'hop', 'stomp', 'droop', 'tremble']) {
    const r = pose({ kind, t0: 10, until: 12 }, 10.7);
    assert.ok(r.head.every(Number.isFinite) && r.arms.every(Number.isFinite), kind);
  }
});

// ---------------------------------------------------------------- the server's side
function fakeModel(reply) {
  const seen = [];
  const srv = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const j = JSON.parse(body);
    seen.push(j);
    const r = await reply(j, seen.length);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: r } }] }));
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, seen, base: `http://127.0.0.1:${srv.address().port}/v1` })));
}
const llm = (base, extra = {}) => ({ key: 'test-key', base, model: 'Atria-Dawn-Preview', reasoning: 'none', timeout: 1500, rpm: 30, daily: 100, concurrent: 4, singlePlayer: true, ...extra });
const TALK = JSON.stringify({ lines: [{ who: 'A', say: '听说东北边有座沙漠神殿！', mood: 'surprised' }, { who: 'B', say: '真的？我可不敢去。', mood: 'scared' }, { who: 'A', say: '胆小鬼！', mood: 'happy' }] });

test('single player: the server writes the villagers\' conversation (or scripts one)', async () => {
  const fm = await fakeModel(() => TALK);
  const dataDir = mkdtempSync(join(tmpdir(), 'lumen-'));
  const srv = startServer({ port: 0, dataDir, quiet: true, llm: llm(fm.base) });
  try {
    const port = await srv.ready;
    const post = (body) => fetch(`http://127.0.0.1:${port}/api/chat2`, { method: 'POST', body: JSON.stringify(body) });
    const r = await (await post({ a: 'l.c.1', ja: 'farmer', b: 'l.c.2', jb: 'mason', l: 'zh', c: { phase: 'day', places: PLACES }, day: 1, name: '阿杰' })).json();
    assert.equal(r.offline, false);
    assert.deepEqual(r.lines.map((l) => l[0]), [0, 1, 0]);
    assert.equal(r.lines[1][2], 'scared');
    const sys = fm.seen[0].messages[0].content;
    assert.ok(sys.includes(personaFor('l.c.1', 'farmer').name.zh) && sys.includes('沙漠神殿') && sys.includes('阿杰'));
    assert.deepEqual(fm.seen[0].thinking, { type: 'disabled' });
    assert.equal((await post({ a: 'l.c.1', b: 'l.c.1' })).status, 400, 'a villager doesn\'t talk to itself');
    assert.equal((await post({ a: 'bad uid!', b: 'l.c.2' })).status, 400);
  } finally {
    await srv.stop();
    fm.srv.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
  // a model that answers nonsense, or none at all: scripted
  const fm2 = await fakeModel(() => 'I would rather not.');
  const brain = createBrain({ cfg: { llm: llm(fm2.base) } });
  const r2 = await brain.dialogue({ a: { uid: 'x.1', job: 'farmer' }, b: { uid: 'x.2', job: 'cleric' }, lang: 'en', ctx: {} });
  assert.equal(r2.offline, true);
  assert.ok(r2.lines.length >= 4);
  fm2.srv.close();
  const none = createBrain({ cfg: { llm: { key: '' } } });
  assert.equal((await none.dialogue({ a: { uid: 'x.1', job: 'farmer' }, b: { uid: 'x.2', job: 'cleric' }, lang: 'zh', ctx: {} })).offline, true);
});

// a test client on Node's WebSocket (as in server.test.mjs)
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
    has: (type) => queue.some((m) => m.t === type),
    close: () => ws.close(),
  };
}

test('on a server: everyone near hears the same conversation, not too often; seen deeds change feelings', async () => {
  const fm = await fakeModel(() => TALK);
  const dataDir = mkdtempSync(join(tmpdir(), 'lumen-'));
  const srv = startServer({ port: 0, dataDir, quiet: true, llm: llm(fm.base) });
  try {
    const port = await srv.ready;
    const a = client(port), b = client(port), far = client(port);
    for (const [c, n] of [[a, 'Alice'], [b, 'Bob'], [far, 'Faraway']]) { await c.send({ t: 'hello', n, v: PROTOCOL }); await c.next('welcome'); }
    await a.send({ t: 'st', p: [10, 70, 10], y: 0, pi: 0, h: 0, f: 0 });
    await b.send({ t: 'st', p: [20, 70, 14], y: 0, pi: 0, h: 0, f: 0 });
    await far.send({ t: 'st', p: [900, 70, 900], y: 0, pi: 0, h: 0, f: 0 });
    await new Promise((r) => setTimeout(r, 100));
    await a.send({ t: 'vchat', a: 'p9.v.1', ja: 'farmer', b: 'p9.v.2', jb: 'mason', l: 'zh', p: [11, 70, 11], d: 0, c: { phase: 'day' } });
    const ca = await a.next('vchat'), cb = await b.next('vchat');
    assert.deepEqual(ca.l, cb.l, 'the same conversation for both');
    assert.equal(ca.a, 'p9.v.1');
    assert.equal(ca.l[0][1], '听说东北边有座沙漠神殿！');
    // straight after, in the same stretch of village: none
    await b.send({ t: 'vchat', a: 'p9.v.3', ja: 'farmer', b: 'p9.v.4', jb: 'mason', l: 'zh', p: [14, 70, 12], d: 0, c: {} });
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(!a.has('vchat') && !b.has('vchat') && !far.has('vchat'), 'one a minute and a half round here, and never for those far off');
    assert.equal(fm.seen.length, 1);
    // seen deeds: a monster seen off (liked better, gossip), the house knocked about (liked less)
    await a.send({ t: 'vnote', k: 'hero', u: 'p9.v.1', j: 'farmer', l: 'zh', x: '', it: 'zombie', first: 1, p: [11, 70, 11], d: 0 });
    await a.send({ t: 'vnote', k: 'found', u: 'p9.v.1', j: 'farmer', l: 'zh', x: '', it: 'temple', p: [400, 70, -300], d: 0 });
    await a.send({ t: 'vnote', k: 'house', u: 'p9.v.2', j: 'mason', l: 'zh', x: '', p: [11, 70, 11], d: 0 });
    await new Promise((r) => setTimeout(r, 150));
    await a.send({ t: 'vopen', u: 'p9.v.1', d: 0 });
    assert.equal((await a.next('vrec')).r.f, 36, '+2 for the zombie, +4 for finding the temple');
    await a.send({ t: 'vopen', u: 'p9.v.2', d: 0 });
    assert.equal((await a.next('vrec')).r.f, 27, '-3 for the house');
    assert.ok(!a.has('say'), 'only noted: no answer');
    assert.equal(fm.seen.length, 1, 'and no model asked');
    a.close(); b.close(); far.close();
    await srv.stop();
    const { readFileSync } = await import('node:fs');
    const saved = JSON.parse(readFileSync(join(dataDir, 'world.json'), 'utf8'));
    assert.ok(saved.brain.rumors.some((r) => r.k === 'hero' && r.s === 'zombie' && r.who === 'Alice'), 'the village talks of it');
    assert.ok(saved.brain.rumors.some((r) => r.k === 'found' && r.s === 'temple'));
    assert.ok(saved.brain.souls['p9.v.1'].alice.facts.some((f) => f.includes('沙漠神殿')), 'remembered');
  } finally {
    await srv.stop();
    fm.srv.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
