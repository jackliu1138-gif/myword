// Villagers that talk: who they are, what they say without a model, what a model may and may not
// make them do, the prompt and its answer, and the server's side of it (with a stand-in for the
// ATRIA endpoint): single-player requests, players on a server hearing a villager, memories kept
// with the world, rationing and falling back when the model is slow or missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  personaFor, offlineReply, cleanAction, parseReply, buildMessages, newRecord, remember, cleanRecord, applyAction, intentOf, discounted, hearts,
} from '../src/sim/brain.js';
import { ITEM } from '../src/sim/items.js';
import { startServer, PROTOCOL } from '../server/server.mjs';
import { createBrain } from '../server/brain.mjs';

test('each villager is somebody: the same uid always gives the same person, and they differ', () => {
  const a = personaFor('p1.abc.1', 'farmer');
  assert.deepEqual(personaFor('p1.abc.1', 'farmer'), a, 'deterministic');
  const names = new Set();
  for (let i = 0; i < 60; i++) names.add(personaFor('v' + i, 'mason').name.zh);
  assert.ok(names.size > 40, 'mostly different names: ' + names.size);
  for (let i = 0; i < 40; i++) {
    const p = personaFor('w' + i, 'cleric');
    assert.ok(p.gender === 'male' ? p.voice.pitch < 1 : p.voice.pitch > 0.95, 'a voice to match');
    assert.ok(p.traits[0] !== p.traits[1]);
  }
});

test('without a model a villager still talks: introductions, tasks, presents, gossip, following', () => {
  const p = personaFor('l.test.7', 'farmer');
  const rec = newRecord(2);
  const ask = (line, extra = {}) => offlineReply({ persona: p, lang: 'zh', playerName: '阿杰', line, rec, ctx: {}, day: 2, rnd: () => 0.3, ...extra });
  const hi = ask('你好');
  assert.ok(hi.say.includes(p.name.zh) || hi.say.includes(p.full.zh), 'first meeting: says who they are: ' + hi.say);
  const q = ask('有什么任务吗？');
  assert.equal(q.action.type, 'quest');
  assert.ok(['wheat', 'carrot', 'potato', 'pumpkin', 'melon_slice', 'bone'].includes(q.action.want), 'a farmer wants farm things');
  applyAction(rec, q.action, 2);
  assert.equal(ask('有任务吗').action, null, 'one task at a time: reminded of it instead');
  assert.equal(ask('送我点东西吧').action, null, 'no presents for strangers');
  rec.f = 80;
  const g = ask('送我点东西吧');
  assert.equal(g.action.type, 'gift');
  applyAction(rec, g.action, 2);
  assert.equal(ask('再送我一个').action, null, 'one present a day');
  const n = ask('最近有什么新鲜事？', { rumors: [{ k: 'nether', who: '小明', day: 1 }] });
  assert.ok(n.say.includes('小明') && n.say.includes('下界'), 'passes on the gossip: ' + n.say);
  assert.deepEqual(ask('跟我来').action, { type: 'follow', seconds: 60 });
  assert.deepEqual(ask('别跟着我了').action, { type: 'follow', seconds: 0 });
  assert.ok(/啥|什么|没见过/.test(ask('你知道手机吗').say), 'knows nothing of phones');
  const en = offlineReply({ persona: p, lang: 'en', playerName: 'Ann', line: 'hello', rec: newRecord(), ctx: {}, day: 0, rnd: () => 0.5 });
  assert.ok(/[a-z]/i.test(en.say) && !/[一-鿿]/.test(en.say), 'English when the game is in English');
  assert.equal(intentOf('能便宜点吗'), 'discount');
  assert.equal(intentOf('goodbye!'), 'bye');
});

test('what a model asks for is checked: no diamonds, sensible counts, one task, rare presents', () => {
  const rec = { ...newRecord(), f: 90 };
  assert.equal(cleanAction({ type: 'gift', item: 'diamond', count: 64 }, { job: 'farmer', rec, day: 1 }), null);
  assert.deepEqual(cleanAction({ type: 'gift', item: 'bread', count: 64 }, { job: 'farmer', rec, day: 1 }), { type: 'gift', item: 'bread', count: 3 });
  const q = cleanAction({ type: 'quest', want: 'wheat', count: 500, reward: 'diamond', rewardCount: 99 }, { job: 'farmer', rec, day: 1 });
  assert.deepEqual([q.want, q.count, q.reward, q.rewardCount], ['wheat', 20, 'emerald', 8]);
  assert.equal(cleanAction({ type: 'quest', want: 'netherite_ingot', count: 1, reward: 'emerald', rewardCount: 1 }, { job: 'farmer', rec, day: 1 }), null);
  assert.equal(cleanAction({ type: 'quest', want: 'wheat', count: 5 }, { job: 'farmer', rec: { ...rec, quest: { want: 'carrot' } }, day: 1 }), null);
  assert.equal(cleanAction({ type: 'gift', item: 'bread' }, { rec: { ...rec, f: 20 }, day: 1 }), null, 'strangers get nothing');
  assert.equal(cleanAction({ type: 'discount', pct: 90 }, { rec, day: 1 }).pct, 30);
  assert.equal(cleanAction({ type: 'discount', pct: 90 }, { rec: { ...rec, f: 10 }, day: 1 }).pct, 10);
  assert.equal(cleanAction({ type: 'teleport' }, { rec }), null);
  assert.equal(cleanAction({ type: 'follow', seconds: 9999 }, { rec }).seconds, 120);
  // a discount takes emeralds off a trade, never below one
  assert.deepEqual(discounted([[ITEM.EMERALD, 10], [ITEM.WHEAT, 20]], 20), [[ITEM.EMERALD, 8], [ITEM.WHEAT, 20]]);
  assert.deepEqual(discounted([[ITEM.EMERALD, 1]], 30), [[ITEM.EMERALD, 1]]);
});

test('the prompt carries the villager, its memories and the gossip; the answer is read even when it is untidy', () => {
  const p = personaFor('p2.x.9', 'librarian');
  const rec = newRecord(4);
  remember(rec, { line: '我叫阿杰', reply: '阿杰你好！', day: 4 });
  remember(rec, { note: '阿杰送过你一本书', day: 4 });
  const msgs = buildMessages({ persona: p, lang: 'zh', playerName: '阿杰', line: '你还记得我吗？', rec, ctx: { time: '晚上', weather: '晴', biome: '平原' }, rumors: [{ k: 'dragon', who: '小红', day: 3 }], neighbors: [{ name: '王大爷', job: 'farmer' }], day: 4 });
  const sys = msgs[0].content;
  assert.equal(msgs[0].role, 'system');
  assert.ok(sys.includes(p.full.zh) && sys.includes('图书管理员'), 'who they are');
  assert.ok(sys.includes('阿杰送过你一本书') && sys.includes('小红') && sys.includes('王大爷'), 'memories, gossip, neighbours');
  assert.ok(sys.includes('JSON') && sys.includes('小朋友'), 'the answer format and keeping it child-friendly');
  assert.deepEqual(msgs.slice(1).map((m) => m.role), ['user', 'assistant', 'user'], 'earlier exchange, then the new line');
  assert.ok(msgs[msgs.length - 1].content.includes('你还记得我吗'));
  const en = buildMessages({ persona: p, lang: 'en', playerName: 'Ann', line: 'hi', rec: newRecord(), ctx: {}, day: 0 });
  assert.ok(en[0].content.includes('librarian') && en[0].content.includes('English'));

  assert.deepEqual(parseReply('{"say":"你好！","mood":"happy","action":null}'), { say: '你好！', mood: 'happy', action: null });
  assert.equal(parseReply('```json\n{"say":"嗯","mood":"weird"}\n```').mood, 'neutral');
  assert.equal(parseReply('<think>let me think</think>{"say":"Hi!"}').say, 'Hi!');
  assert.equal(parseReply('Just plain words.').say, 'Just plain words.');
  assert.equal(parseReply('').say, '……');
  const long = parseReply(JSON.stringify({ say: '啊'.repeat(400) }));
  assert.ok(long.say.length <= 160);
  // records from saves and clients are trimmed
  const r = cleanRecord({ mem: Array.from({ length: 30 }, (_, i) => ['q' + i, 'a' + i]), f: 300, quest: { want: 'diamond_block', count: 3, reward: 'emerald', rewardCount: 1 } });
  assert.equal(r.mem.length, 8);
  assert.equal(r.f, 100);
  assert.equal(hearts(r), 5);
});

// ---------------------------------------------------------------- the server's side
// a stand-in for the model's endpoint: answers with whatever reply() returns for each request
function fakeModel(reply) {
  const seen = [];
  const srv = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const j = JSON.parse(body);
    seen.push({ auth: req.headers.authorization, body: j });
    const r = await reply(j, seen.length);
    if (r && r.status) { res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.body || {})); return; }
    if (r && r.hang) return; // never answers
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: r } }] }));
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, seen, base: `http://127.0.0.1:${srv.address().port}/v1` })));
}
const llm = (base, extra = {}) => ({ key: 'test-key', base, model: 'Atria-Dawn-Preview', reasoning: 'none', timeout: 1500, rpm: 30, daily: 100, concurrent: 4, singlePlayer: true, ...extra });

test('single player: the server asks the model and checks what comes back; no model, a scripted reply', async () => {
  const fm = await fakeModel((j, n) => (n === 1 && j.reasoning_effort !== undefined ? { status: 400, body: { error: 'unknown parameter reasoning_effort' } }
    : JSON.stringify({ say: '哎呀，阿杰来啦！今天想买点啥？', mood: 'happy', action: { type: 'gift', item: 'diamond_block', count: 64 } })));
  const dataDir = mkdtempSync(join(tmpdir(), 'lumen-'));
  const srv = startServer({ port: 0, dataDir, quiet: true, llm: llm(fm.base) });
  try {
    const port = await srv.ready;
    const info = await (await fetch(`http://127.0.0.1:${port}/lumen-server.json`)).json();
    assert.equal(info.ai, 'atria', 'the game can tell a model is behind the villagers');
    const post = (body) => fetch(`http://127.0.0.1:${port}/api/talk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    const r = await post({ u: 'l.abc.1', j: 'farmer', l: 'zh', name: '阿杰', x: '你好', r: { f: 90 }, c: { time: '早上' }, day: 3 });
    assert.equal(r.say, '哎呀，阿杰来啦！今天想买点啥？');
    assert.equal(r.offline, false);
    assert.equal(r.action, null, 'a stack of diamond blocks was not on the menu');
    // what reached the model: the key, the model, the villager's prompt; reasoning_effort dropped after the 400
    assert.equal(fm.seen.length, 2);
    assert.equal(fm.seen[1].auth, 'Bearer test-key');
    assert.equal(fm.seen[1].body.model, 'Atria-Dawn-Preview');
    assert.equal(fm.seen[1].body.reasoning_effort, undefined);
    assert.ok(fm.seen[1].body.messages[0].content.includes('农民'));
    const bad = await fetch(`http://127.0.0.1:${port}/api/talk`, { method: 'POST', body: 'not json' });
    assert.equal(bad.status, 400);
  } finally {
    await srv.stop();
    fm.srv.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
  // no key: scripted villagers, and the game is told so
  const dir2 = mkdtempSync(join(tmpdir(), 'lumen-'));
  const srv2 = startServer({ port: 0, dataDir: dir2, quiet: true, llm: { key: '' } });
  try {
    const port = await srv2.ready;
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/lumen-server.json`)).json()).ai, 'offline');
    const r = await (await fetch(`http://127.0.0.1:${port}/api/talk`, { method: 'POST', body: JSON.stringify({ u: 'l.x.2', j: 'butcher', l: 'en', name: 'Ann', x: 'hello', day: 0 }) })).json();
    assert.equal(r.offline, true);
    assert.ok(r.say.length > 0);
  } finally {
    await srv2.stop();
    rmSync(dir2, { recursive: true, force: true });
  }
});

test('a slow or missing model: a scripted reply in good time; the ration runs out into scripted replies too', async () => {
  const fm = await fakeModel(() => ({ hang: true }));
  const log = [];
  const brain = createBrain({ cfg: { llm: llm(fm.base, { timeout: 300 }) }, log: (s) => log.push(s) });
  const p = { uid: 'l.slow.1', job: 'fisherman', lang: 'zh', playerName: 'A', line: '你好', day: 0 };
  const t0 = Date.now();
  const r = await brain.reply(p);
  assert.ok(Date.now() - t0 < 1500, 'did not wait for ever');
  assert.equal(r.offline, true);
  assert.ok(log.some((s) => s.includes('timeout')));
  fm.srv.close();
  const fm2 = await fakeModel(() => JSON.stringify({ say: 'ok' }));
  const rationed = createBrain({ cfg: { llm: llm(fm2.base, { rpm: 2 }) } });
  const out = [];
  for (let i = 0; i < 4; i++) out.push((await rationed.reply({ ...p, uid: 'l.r.' + i })).offline);
  assert.deepEqual(out, [false, false, true, true], 'two a minute, then scripted');
  fm2.srv.close();
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

test('on a server: everyone near a villager hears it, it remembers each player, and the memories are kept', async () => {
  const fm = await fakeModel((j) => {
    const last = j.messages[j.messages.length - 1].content;
    return JSON.stringify({ say: last.includes('任务') ? '帮我找10个小麦吧！' : '你好呀！', mood: 'happy', action: last.includes('任务') ? { type: 'quest', want: 'wheat', count: 10, reward: 'emerald', rewardCount: 3 } : null });
  });
  const dataDir = mkdtempSync(join(tmpdir(), 'lumen-'));
  let srv = startServer({ port: 0, dataDir, quiet: true, llm: llm(fm.base) });
  try {
    const port = await srv.ready;
    const a = client(port), b = client(port), far = client(port);
    await a.send({ t: 'hello', n: 'Alice', v: PROTOCOL });
    const wa = await a.next('welcome');
    await b.send({ t: 'hello', n: 'Bob', v: PROTOCOL });
    await b.next('welcome');
    await far.send({ t: 'hello', n: 'Faraway', v: PROTOCOL });
    await far.next('welcome');
    await a.send({ t: 'st', p: [10, 70, 10], y: 0, pi: 0, h: 0, f: 0 });
    await b.send({ t: 'st', p: [14, 70, 12], y: 0, pi: 0, h: 0, f: 0 });
    await far.send({ t: 'st', p: [900, 70, 900], y: 0, pi: 0, h: 0, f: 0 });
    await new Promise((r) => setTimeout(r, 100));
    // the talk screen opens: Alice learns what the villager thinks of her; whoever runs it is told to stop it
    await a.send({ t: 'vopen', u: 'p9.v.1', d: 0 });
    const vr = await a.next('vrec');
    assert.equal(vr.r.f, 30);
    assert.equal((await b.next('vdo')).a.type, 'attend');
    await a.send({ t: 'talk', u: 'p9.v.1', j: 'farmer', l: 'zh', x: '有什么任务吗？', p: [11, 70, 11], d: 0, c: { time: '早上' } });
    const act = await a.next('vact');
    assert.equal(act.a.type, 'quest');
    assert.equal(act.r.quest.want, 'wheat');
    const heard = await b.next('say');
    assert.equal(heard.x, '帮我找10个小麦吧！');
    assert.equal(heard.to, wa.id);
    assert.equal((await b.next('said')).x, '有什么任务吗？', 'Bob also hears what Alice said');
    assert.equal((await a.next('say')).u, 'p9.v.1');
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(!far.has('say') && !far.has('said'), 'too far away to hear');
    // Alice hands over the wheat: the task is done, the villager likes her better
    await a.send({ t: 'vnote', u: 'p9.v.1', j: 'farmer', l: 'zh', k: 'deliver', n: '小麦', p: [11, 70, 11], d: 0 });
    const done = await a.next('vact');
    assert.equal(done.r.quest, null);
    assert.ok(done.r.f > 30);
    assert.equal(done.r.done, 1);
    a.close(); b.close(); far.close();
    await srv.stop();
    // the memories and the gossip are in the saved world
    const saved = JSON.parse(readFileSync(join(dataDir, 'world.json'), 'utf8'));
    const rec = saved.brain.souls['p9.v.1'].alice;
    assert.ok(rec.mem.length >= 2 && rec.facts.length >= 1 && rec.done === 1);
    assert.ok(saved.brain.rumors.some((r) => r.k === 'join') && saved.brain.rumors.some((r) => r.k === 'quest'));
    // and back after a restart
    srv = startServer({ port: 0, dataDir, quiet: true, llm: llm(fm.base) });
    const port2 = await srv.ready;
    const a2 = client(port2);
    await a2.send({ t: 'hello', n: 'Alice', v: PROTOCOL });
    await a2.next('welcome');
    await a2.send({ t: 'vopen', u: 'p9.v.1', d: 0 });
    assert.equal((await a2.next('vrec')).r.done, 1);
    a2.close();
  } finally {
    await srv.stop();
    fm.srv.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
