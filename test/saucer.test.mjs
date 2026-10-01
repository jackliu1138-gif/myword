// Flying saucers: what a trip costs, the way across space (never through a planet, from wherever
// it sets off), the launch pads it comes down on, its fuel and its recipe; flying it yourself (a
// soft landing on flat ground, none on rough, a bounce off walls and not through thin ones); a
// villager along for the ride; and on a server, asking to come aboard and taking over a parked
// saucer, between two players only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as S from '../src/world/space.js';
import { tripCost, cruisePoint, installSaucer, SAUCER_DESTS, SAUCER_FLAGS } from '../src/game/saucer.js';
import { createGenerator, generate, DIM } from '../src/world/dimensions.js';
import { STATION_Y, STATION_PAD } from '../src/world/planets.js';
import { BLOCK } from '../src/world/blocks.js';
import { ITEM, saucerFuel, SAUCER_TANK, RECIPES } from '../src/sim/items.js';
import { offlineReply, tripNote, TRIP_STAGES, personaFor, newRecord } from '../src/sim/brain.js';
import { t } from '../src/ui/i18n.js';
import '../src/ui/strings5.js';
import { startServer, PROTOCOL } from '../server/server.mjs';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ARRIVE_BELOW_TOP = 170; // (as in saucer.js: arriving a little under where a world takes over)

// Follows a trip from u = 0 to 1: its ends, how high it ever is over each body, its longest step.
function walk(trip, T, steps = 1000) {
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(cruisePoint(trip, i / steps, T, {}));
  const low = {};
  for (const b of new Set([trip.from, trip.to])) {
    const c = S.bodyPos(b, T);
    low[b] = Math.min(...pts.map((p) => dist(p, c) - S.BODIES[b].R));
  }
  let longest = 0, total = 0;
  for (let i = 1; i < pts.length; i++) { const d = dist(pts[i], pts[i - 1]); longest = Math.max(longest, d); total += d; }
  return { start: pts[0], end: pts[pts.length - 1], low, longest, total, pts };
}

test('trips: a hop costs a little, further worlds more, and a full tank goes anywhere', () => {
  assert.equal(tripCost('earth', 'earth'), 2);
  assert.ok(tripCost('earth', 'moon') < tripCost('earth', 'mars'));
  assert.ok(tripCost('earth', 'mars') < tripCost('earth', 'jupiter'));
  assert.equal(tripCost('moon', 'earth'), tripCost('earth', 'moon'));
  for (const a of SAUCER_DESTS) for (const b of SAUCER_DESTS) assert.ok(tripCost(a, b) > 0 && tripCost(a, b) <= SAUCER_TANK, a + ' to ' + b);
});

test('across space: from just out of one world\'s air to over the pad of the other, never through either', () => {
  for (const T of [0.3, 7.65, 41.2]) {
    for (const from of SAUCER_DESTS) {
      for (const to of SAUCER_DESTS) {
        if (from === to) continue;
        // (setting off from the far side of where it is going, so the way has to swing round)
        const D0 = S.positionOn(from, 0.7, -0.3, S.BODIES[from].top + 6, T).pos;
        const trip = { from, to, qD0: S.toBody(from, D0, T), lonT: 2.1, latT: 0.4, altT: S.BODIES[to].top - ARRIVE_BELOW_TOP };
        const A0 = S.positionOn(to, trip.lonT, trip.latT, trip.altT, T).pos;
        const w = walk(trip, T);
        const what = `${from} to ${to} at ${T}`;
        assert.ok(dist(w.start, D0) < 0.5, what + ': starts where it is');
        assert.ok(dist(w.end, A0) < 0.5, what + ': ends over the pad');
        assert.ok(w.low[from] >= S.BODIES[from].top + 6 - 1, what + ': never down into ' + from + ' (' + w.low[from] + ')');
        assert.ok(w.low[to] >= trip.altT - 1, what + ': never down into ' + to + ' (' + w.low[to] + ')');
        assert.ok(w.longest < w.total * 0.02, what + ': no jumps along the way');
      }
    }
  }
});

test('setting off in space by the world it is going to: round that one and down over its pad', () => {
  const T = 3.3;
  for (const body of SAUCER_DESTS) {
    const { R, top } = S.BODIES[body];
    // the far side of it, high; a long way out; just over the pad already
    for (const [lon, lat, alt] of [[2.1 + Math.PI, -0.4, top + 900], [1.4, 0.35, R * 2], [2.1, 0.4, top + 40]]) {
      const D0 = S.positionOn(body, lon, lat, alt, T).pos;
      const trip = { from: body, to: body, qD0: S.toBody(body, D0, T), lonT: 2.1, latT: 0.4, altT: top - ARRIVE_BELOW_TOP };
      const A0 = S.positionOn(body, trip.lonT, trip.latT, trip.altT, T).pos;
      const w = walk(trip, T);
      const what = `${body} from ${[lon, lat, alt].map((v) => +v.toFixed(2)).join(', ')}`;
      assert.ok(dist(w.start, D0) < 0.5 && dist(w.end, A0) < 0.5, what + ': from where it is to over the pad');
      assert.ok(w.low[body] >= trip.altT - 1, what + ': never down into it');
      // (and it stays by that world: never further out than it started, plus a swing over the top)
      const c = S.bodyPos(body, T);
      const far = Math.max(...w.pts.map((p) => dist(p, c)));
      assert.ok(far <= R + alt + R * 0.5 + 1, what + ': stays by it');
      assert.ok(w.longest < Math.max(w.total * 0.02, 1), what + ': no jumps');
    }
  }
});

test('launch pads: a flat, clear deck in the middle of the Moon and Mars, where the autopilot comes down', () => {
  for (const [dim, body] of [[DIM.MOON, 'moon'], [DIM.MARS, 'mars']]) {
    for (const seed of [77, 4242]) {
      const g = createGenerator(seed, dim, 2);
      const chunks = new Map();
      const at = (x, y, z) => {
        const cx = Math.floor(x / 16), cz = Math.floor(z / 16), key = cx + ',' + cz;
        if (!chunks.has(key)) chunks.set(key, generate(g, cx, cz).blocks);
        return chunks.get(key)[(y << 8) | ((z - cz * 16) << 4) | (x - cx * 16)];
      };
      const py = g.padHeight();
      assert.equal(at(0, py, 0), BLOCK.SEA_LANTERN, body + ': the glowing middle');
      for (const [x, z] of [[3, 0], [-3, 2], [0, -4], [2, 3]]) assert.equal(at(x, py, z), BLOCK.SMOOTH_STONE, body + ': the deck');
      assert.equal(at(-6, py, 0), BLOCK.YELLOW_WOOL, body + ': the ring');
      for (let x = -7; x <= 7; x++) {
        for (let z = -7; z <= 7; z++) {
          if (Math.hypot(x, z) > 7) continue;
          assert.ok(at(x, py, z) && at(x, py - 1, z), `${body}: solid under the deck at ${x}, ${z}`);
          for (let y = py + 1; y <= py + 12; y++) assert.equal(at(x, y, z), 0, `${body}: clear over the deck at ${x}, ${y}, ${z}`);
        }
      }
      // the game's idea of where its pad is: the same place
      class G {}
      installSaucer(G);
      const game = new G();
      game.world = { seed };
      const pad = game.padOf(body);
      assert.deepEqual([pad.x, pad.y, pad.z], [0.5, py + 1, 0.5]);
    }
  }
  class G {}
  installSaucer(G);
  const game = new G();
  game.world = { seed: 1 };
  for (const body of ['jupiter', 'saturn']) assert.deepEqual(game.padOf(body), { x: STATION_PAD[0] + 0.5, y: STATION_Y + 1, z: STATION_PAD[1] + 0.5 });
  // the Earth's pad is wherever the saucer was first set down (none yet: nowhere to go back to)
  assert.equal(game.padOf('earth'), null);
  game.ride = { home: [10.5, 70, -3.5] };
  assert.deepEqual(game.padOf('earth'), { x: 10.5, y: 70, z: -3.5 });
});

test('fuel: coal or charcoal a unit, a blaze rod two, lava eight, nothing else; and its recipe', () => {
  assert.equal(saucerFuel(ITEM.COAL), 1);
  assert.equal(saucerFuel(ITEM.CHARCOAL), 1);
  assert.equal(saucerFuel(ITEM.BLAZE_ROD), 2);
  assert.equal(saucerFuel(ITEM.LAVA_BUCKET), 8);
  assert.equal(saucerFuel(BLOCK.DIRT), 0);
  assert.equal(saucerFuel(ITEM.BUCKET), 0);
  const r = RECIPES.find((x) => x[0] === ITEM.FLYING_SAUCER);
  assert.ok(r, 'it can be made');
  assert.ok(r[2].some(([id]) => id === ITEM.DIAMOND) && r[2].some(([id]) => id === BLOCK.IRON_BLOCK));
});

// ------------------------------------------------------------------ flying it yourself
// A game with just enough of the game in it to fly: the world is `solid(x, y, z)`.
function flight(solid, at) {
  class G {}
  installSaucer(G);
  const g = new G();
  g.toasts = [];
  g.world = { getBlock: (x, y, z) => (solid(x, y, z) ? BLOCK.STONE : 0), seed: 1 };
  g.dimension = 0;
  g.player = { pos: at.slice(), vel: [0, 0, 0], yaw: 0, pitch: 0, forward: () => [0, 0, -1] };
  g.ride = { uid: 'l.saucer.t', fuel: SAUCER_TANK, home: null, hp: 16, yaw: 0, phase: 'manual', legs: 0, engine: 0, trip: null, camDist: 13, bank: [0, 0], t: 0, burn: 0 };
  g.isCreative = () => false;
  g.ui = { toast: (m) => g.toasts.push(m) };
  g.audio = { sfx() {}, play() {}, setEngine() {} };
  g.particles = { smoke() {}, spark() {} };
  g.shake = 0;
  g.bodyBase = () => 0;
  g.goToSpace = () => { g.wentToSpace = true; };
  return g;
}
const controls = (o = {}) => ({ forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, ...o });
// flies for `secs` (or until it lands), checking every step that it is never inside anything
function fly(g, secs, ctl, each = null) {
  for (let i = 0; i < secs * 60 && g.ride.phase === 'manual'; i++) {
    g.saucerStep(1 / 60, ctl);
    assert.ok(!g.saucerBlocked(g.player.pos, g.ride.legs) || g.ride.phase === 'landed', 'inside something at ' + g.player.pos.map((v) => v.toFixed(2)));
    if (each) each(g);
  }
}
const FLOOR = 64;

test('flying it yourself: holding sneak over flat ground, it slows and sets down softly', () => {
  const g = flight((x, y) => y < FLOOR, [0.5, 95, 0.5]);
  let fastest = 0;
  fly(g, 30, controls({ sneak: true }), (q) => { fastest = Math.max(fastest, -q.player.vel[1]); });
  assert.equal(g.ride.phase, 'landed');
  assert.equal(g.player.pos[1], FLOOR);
  assert.ok(fastest > 10, 'it came down quickly while high up');
  assert.ok(g.toasts.includes(t('saucer.touchdown')));
  assert.ok(!g.toasts.includes(t('saucer.bump')), 'no bump on the way down');
  assert.equal(g.ride.legs, 1);
});

test('flying it yourself: slammed into the ground it bounces off unharmed; rough ground is no place to land', () => {
  const g = flight((x, y) => y < FLOOR, [0.5, 130, 0.5]);
  let up = 0;
  fly(g, 4, controls({ sneak: true, sprint: true }), (q) => { up = Math.max(up, q.player.vel[1]); });
  assert.ok(up > 5, 'it bounced back up');
  assert.ok(g.toasts.includes(t('saucer.bump')));
  assert.equal(g.ride.hp, 16, 'not a scratch');
  fly(g, 20, controls({ sneak: true }));
  assert.equal(g.ride.phase, 'landed', 'let down gently afterwards, it lands');

  // steps of rock under it: down onto them, it won't land
  const rough = flight((x, y, z) => y < FLOOR || (Math.abs(x) <= 8 && Math.abs(z) <= 8 && y < FLOOR + ((x + z) & 3)), [0.5, 80, 0.5]);
  fly(rough, 12, controls({ sneak: true }));
  assert.equal(rough.ride.phase, 'manual');
  assert.ok(rough.toasts.includes(t('saucer.uneven')));
});

test('flying it yourself: into a wall at speed it bounces back; fast and high, not through a thin one', () => {
  // a wall a block thick to the north (-z), from the ground up
  const g = flight((x, y, z) => y < FLOOR || (z === -10 && y < 90), [0.5, FLOOR + 2, 0.5]);
  let back = 0;
  fly(g, 3, controls({ forward: 1, sprint: true }), (q) => {
    assert.ok(q.player.pos[2] > -9, 'on this side of the wall');
    back = Math.max(back, q.player.vel[2]);
  });
  assert.ok(back > 4, 'thrown back off it');
  assert.ok(g.toasts.includes(t('saucer.bump')));
  assert.equal(g.ride.hp, 16);

  // high up it goes faster (as fast as it ever goes: several blocks a step): a one-block wall
  // still stops it, from wherever it set off
  for (const z0 of [601, 603, 603.5, 604, 606]) {
    const hi = flight((x, y, z) => y < FLOOR || (z === -10 && y >= 330 && y < 384), [0.5, 360, z0]);
    hi.bodyBase = () => -2000;
    let fastest = 0;
    fly(hi, 3, controls({ forward: 1, sprint: true }), (q) => {
      assert.ok(q.player.pos[2] > -9, `from ${z0}: not through the wall (${q.player.pos[2].toFixed(2)})`);
      fastest = Math.max(fastest, -q.player.vel[2]);
    });
    assert.ok(fastest / 60 > 6.5, 'fast enough to have jumped the wall in a step: ' + fastest.toFixed(1));
    assert.ok(hi.toasts.includes(t('saucer.bump')));
  }
});

test('a saucer saved mid-trip carries on after loading; one parked keeps its fuel and pad', () => {
  class G {}
  installSaucer(G);
  const g = new G();
  g.ride = { uid: 'l.saucer.q', fuel: 33, home: [4.5, 70, 9.5], hp: 12, yaw: 1.2, phase: 'cruise', trip: { from: 'earth', to: 'mars', dur: 120, pad: { x: 0.5, y: 101, z: 0.5 } } };
  const saved = JSON.parse(JSON.stringify(g.serializeSaucer()));
  const h = new G();
  h.loadSaucer(saved);
  assert.equal(h.ride.phase, 'landed');
  assert.deepEqual([h.ride.uid, h.ride.fuel, h.ride.home, h.ride.hp], ['l.saucer.q', 33, [4.5, 70, 9.5], 12]);
  assert.deepEqual(h.ride.resume, { from: 'earth', to: 'mars', dur: 120, pad: { x: 0.5, y: 101, z: 0.5 } });
  // flown by hand when saved: back hovering where it was, to fly on or land
  const f = new G();
  f.ride = { ...g.ride, phase: 'manual', trip: null };
  const h2 = new G();
  h2.loadSaucer(JSON.parse(JSON.stringify(f.serializeSaucer())));
  assert.deepEqual([h2.ride.phase, h2.ride.legs, h2.ride.resume], ['manual', 0, undefined]);
  // nonsense in a save: a parked saucer with an empty tank, nothing more
  const k = new G();
  k.loadSaucer({ saucer: { fuel: 'lots', home: [1, 'x'], trip: { from: 'pluto', to: 'mars' } } });
  assert.deepEqual([k.ride.fuel, k.ride.home, k.ride.resume], [0, null, undefined]);
  k.loadSaucer({});
  assert.equal(k.ride, null);
});

test('a villager along for the ride has something to say at each stage, and the model is told what is happening', () => {
  const p = personaFor('v.trip', 'farmer');
  for (const lang of ['zh', 'en']) {
    for (const stage of TRIP_STAGES) {
      const r = offlineReply({ persona: p, lang, playerName: 'Ann', event: 'trip', itemName: stage + ':mars', rec: newRecord(), ctx: {}, rnd: () => 0.5 });
      assert.ok(r.say && !/\{|\}/.test(r.say), `${lang} ${stage}: ${r.say}`);
      assert.ok(tripNote(stage + ':mars', 'Ann', lang).length > 10);
    }
  }
  // home again: glad of it (not "the first villager ever to come here")
  assert.equal(offlineReply({ persona: p, lang: 'en', event: 'trip', itemName: 'home:earth', rec: newRecord(), ctx: {} }).mood, 'happy');
  assert.ok(!/first villager/.test(tripNote('home:earth', 'Ann', 'en')));
  assert.ok(/first villager/.test(tripNote('arrive:moon', 'Ann', 'en')));
});

// ------------------------------------------------------------------ on a server
test('the pilot\'s side: three seats, once each, only while landed; getting off frees the seat', () => {
  class G {}
  installSaucer(G);
  const g = new G();
  const sent = [];
  g.mp = { net: { send: (m) => sent.push(m) }, players: new Map([['7', { name: 'Ann' }]]) };
  g.ui = { toast() {} };
  g.ride = { phase: 'landed', passengers: [] };
  const ask = (from) => { g.onBoardMessage({ from }); return sent[sent.length - 1]; };
  assert.deepEqual(ask('7'), { t: 'aboard', to: '7', ok: 1, seat: 0 });
  assert.deepEqual(ask('7'), { t: 'aboard', to: '7', ok: 1, seat: 0 }, 'asked twice: the same seat');
  assert.equal(ask('8').seat, 1);
  assert.equal(ask('9').seat, 2);
  assert.deepEqual(ask('10'), { t: 'aboard', to: '10', ok: 0, why: 'full' });
  g.onBoardMessage({ from: '8', leave: 1 });
  assert.equal(ask('10').seat, 1, 'a seat came free');
  g.ride.phase = 'cruise';
  assert.equal(ask('11').why, 'flying');
  g.ride = null;
  assert.equal(ask('12').why, 'gone');
});

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
    queue,
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

test('on a server: coming aboard and taking over a parked saucer pass between two players only; others see it fly', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'lumen-'));
  const srv = startServer({ port: 0, dataDir, seed: 'saucer', quiet: true });
  const all = [];
  try {
    const port = await srv.ready;
    const join = async (n) => { const c = client(port); all.push(c); await c.send({ t: 'hello', n, v: PROTOCOL }); return [c, await c.next('welcome')]; };
    const [a, wa] = await join('Ann');
    const [b, wb] = await join('Bo');
    const [c] = await join('Cy');
    // Ann asks Bo (the pilot) to come aboard; Bo gives her a seat
    await a.send({ t: 'board', to: wb.id });
    assert.equal((await b.next('board')).from, wa.id);
    await b.send({ t: 'aboard', to: wa.id, ok: 1, seat: 2 });
    const ok = await a.next('aboard');
    assert.deepEqual([ok.from, ok.ok, ok.seat, ok.to], [wb.id, 1, 2, undefined]);
    // a saucer parked in Bo's game: Ann climbs in, Bo's game hands it over
    await a.send({ t: 'sgrab', to: wb.id, r: 17, u: 'l.saucer.k' });
    const grab = await b.next('sgrab');
    assert.deepEqual([grab.from, grab.r, grab.u], [wa.id, 17, 'l.saucer.k']);
    await b.send({ t: 'sgive', to: wa.id, c: { type: 'saucer', uid: 'l.saucer.k', fuel: 12, pos: [1, 70, 2] } });
    const give = await a.next('sgive');
    assert.deepEqual([give.from, give.c.uid, give.c.fuel], [wb.id, 'l.saucer.k', 12]);
    // flying it: everyone sees the saucer (its flags in the pilot's state), engine going, legs up
    await a.send({ t: 'st', p: [1, 90, 2], y: 0.5, pi: 0, h: 0, f: SAUCER_FLAGS.SAUCER | SAUCER_FLAGS.THRUST });
    const st = await c.next('st');
    assert.equal(st.id, wa.id);
    assert.equal(st.f & (SAUCER_FLAGS.SAUCER | SAUCER_FLAGS.THRUST | SAUCER_FLAGS.LEGS), SAUCER_FLAGS.SAUCER | SAUCER_FLAGS.THRUST);
    // and Cy heard nothing of the rest
    await a.send({ t: 'chat', x: 'off we go' });
    await c.next('chat');
    assert.deepEqual(c.queue.filter((m) => ['board', 'aboard', 'sgrab', 'sgive'].includes(m.t)), []);
  } finally {
    for (const c of all) c.close();
    await srv.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
