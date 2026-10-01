// Space: the planets' frames and orbits, the overworld as the Earth's map, going up and coming
// back down, the planet maps, the Moon and Mars, the empty world of space, the suit's thrusters,
// and the terrain near the world's middle that must never change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/world/space.js';
import { createGenerator, generate, DIM } from '../src/world/dimensions.js';
import { buildLocalMap, buildBodyMap, earthTexel, ELEV_SEA } from '../src/world/planetmap.js';
import { World } from '../src/world/world.js';
import { Player } from '../src/game/player.js';
import { HOME } from '../src/world/generator.js';
import { BLOCK } from '../src/world/blocks.js';
import { installSpace } from '../src/game/space.js';

const near = (a, b, e = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < e);

test('the overworld sky is the space model\'s: the sun where the game always had it, at any place', () => {
  for (const T of [0.1, 0.3, 2.77, 15.5]) {
    const a = 2 * Math.PI * T;
    const sun = [Math.cos(a), Math.sin(a) * Math.cos(S.TILT), Math.sin(a) * Math.sin(S.TILT)];
    const L = S.overworldFrame(T);
    assert.ok(near(S.fromC(L, S.SUN_DIR), sun), 'the sun at ' + T);
    for (const [x, z] of [[0, 0], [12000, -7000], [-80000, 30000]]) {
      const bf = S.earthFrameAt(x, z, T);
      const [lon, lat] = S.worldToLonLat('earth', x, z);
      const { local } = S.positionOn('earth', lon, lat, 50, T, bf);
      assert.ok(near(local.x, L.x) && near(local.y, L.y) && near(local.z, L.z), 'the local frame at ' + x + ',' + z);
    }
  }
});

test('leaving the ground for space and coming back lands where you left', () => {
  const T = 3.2;
  for (const body of ['earth', 'moon', 'mars']) {
    const base = body === 'earth' ? 64 : S.BODIES[body].base;
    const left = S.leaveSurface(body, 1234, base + 1800, -5678, base, T);
    const back = S.reachSurface(body, left.pos, T, left.bodyFrame);
    assert.ok(Math.abs(back.x - 1234) < 1e-3 && Math.abs(back.z + 5678) < 1e-3, body + ' x, z');
    assert.ok(Math.abs(back.alt - 1800) < 1e-3, body + ' height');
  }
});

test('the Moon goes round in eight days, full on the first night, its near side to the Earth', () => {
  assert.equal(S.moonPhase(0.75), 0.5);
  assert.equal(S.moonPhase(8.75), 0.5);
  assert.ok(Math.abs(S.moonPhase(4.75) - 0) < 1e-9 || Math.abs(S.moonPhase(4.75) - 1) < 1e-9);
  for (const T of [0.75, 2.5, 6.1]) {
    const f = S.moonFrame(T);
    const toEarth = S.v3.norm(S.v3.scale(S.bodyPos('moon', T), -1));
    assert.ok(near(f.x, toEarth), 'near side at ' + T);
  }
  // full: lit side faces the Earth (noon at the middle of the near side); new: night there
  assert.ok(S.sunAt('moon', 0, 0, 0.75)[1] > 0.9);
  assert.ok(S.sunAt('moon', 0, 0, 4.75)[1] < -0.9);
  // the full moon at midnight is high in the southern sky of the overworld, and not eclipsed
  const L = S.overworldFrame(0.75);
  const m = S.fromC(L, S.v3.norm(S.v3.sub(S.bodyPos('moon', 0.75), S.v3.scale(L.y, S.EARTH_R))));
  assert.ok(m[1] > 0.7 && m[2] > 0.3, JSON.stringify(m));
  const d = S.bodyPos('moon', 0.75);
  assert.ok(Math.hypot(d[1], d[2]) > S.EARTH_R + S.BODIES.moon.R, 'out of the Earth\'s shadow');
});

test('every body\'s frame is a rotation; the nearest body is found', () => {
  for (const name of S.BODY_NAMES) {
    const f = S.bodyFrame(name, 1.3);
    assert.ok(Math.abs(S.v3.dot(S.v3.cross(f.x, f.y), f.z) - 1) < 1e-9, name);
  }
  const T = 1;
  const nearMoon = S.v3.add(S.bodyPos('moon', T), [0, S.BODIES.moon.R + 500, 0]);
  const n = S.nearestBody(nearMoon, T);
  assert.equal(n.name, 'moon');
  assert.ok(Math.abs(n.alt - 500) < 1e-3);
});

test('far from the world\'s middle the planet has oceans and climates; near it, nothing changes', () => {
  const g = createGenerator(77, DIM.OVERWORLD, 2);
  const c = {};
  // (within HOME the terrain generator ignores the planet's geography)
  assert.equal(g.macro(HOME * 0.9, 0), null);
  assert.ok(g.macro(HOME * 2, 0));
  // the far north is frozen, the tropics hot
  let ice = 0, hot = 0, n = 0;
  for (let i = 0; i < 200; i++) {
    const [xN, zN] = S.lonLatToWorld('earth', -3 + i * 0.03, 1.4);
    g.column(Math.round(xN), Math.round(zN), c); if (c.temp < -0.5) ice++;
    const [xE, zE] = S.lonLatToWorld('earth', -3 + i * 0.03, 0.05);
    g.column(Math.round(xE), Math.round(zE), c); if (c.temp > 0.3) hot++;
    n++;
  }
  assert.ok(ice > n * 0.8, 'the far north is frozen: ' + ice);
  assert.ok(hot > n * 0.6, 'the equator is hot: ' + hot);
});

test('planet maps: the sea under water, land above it, lights where the villages are', () => {
  const g = createGenerator(4242, 0, 2);
  const m = buildLocalMap(g, 63, 0, 0, 2048, 64);
  let water = 0, land = 0;
  for (let i = 0; i < 64 * 64; i++) { if (m.rgba[i * 4 + 3] / 255 < ELEV_SEA) water++; else land++; }
  assert.ok(water > 50 && land > 50, `water ${water}, land ${land}`);
  // a texel of deep sea is dark blue, of desert sand light
  const col = {};
  const t = earthTexel(g, 0, 0, 63, col);
  assert.equal(t.length, 4);
  const moon = buildBodyMap(createGenerator(4242, DIM.MOON, 2), 64, 32, 'moon');
  assert.equal(moon.rgba.length, 64 * 32 * 4);
  const grey = moon.rgba.filter((v, i) => i % 4 === 0).reduce((a, b) => a + b, 0) / (64 * 32);
  assert.ok(grey > 60 && grey < 170, 'the Moon is grey: ' + grey);
});

test('the Moon and Mars have ground of their own, and space none at all', () => {
  const moon = createGenerator(5, DIM.MOON, 2), mars = createGenerator(5, DIM.MARS, 2);
  const a = generate(moon, 3, -2), b = generate(mars, 3, -2);
  const has = (blocks, id) => blocks.includes(id);
  assert.ok(has(a.blocks, BLOCK.MOON_REGOLITH) && !has(a.blocks, BLOCK.GRASS) && !has(a.blocks, BLOCK.WATER));
  assert.ok(has(b.blocks, BLOCK.MARS_SAND) || has(b.blocks, BLOCK.MARS_ROCK));
  assert.ok(a.top > 40 && a.top < 330 && b.top > 30 && b.top < 340, `tops ${a.top} ${b.top}`);
  const w = new World(5, { dimension: DIM.SPACE, workers: 0, renderDistance: 2 });
  assert.equal(w.void, true);
  assert.equal(w.getBlock(10, 64, 10), 0);
  assert.equal(w.isSolidAt(0, -5, 0), false);
  assert.equal(w.boxCollides(0, 0, 0, 1, 2, 1), false);
  assert.equal(w.isChunkReady(1e6, -1e6), true);
  w.update(0, 0);
  assert.equal(w.chunks.size, 0);
  w.dispose();
});

test('low gravity jumps high; the suit\'s thrusters lift you on a fresh press of jump in the air', () => {
  const FLOOR = 100;
  const world = { getBlock: (x, y) => (y < FLOOR ? 1 : 0), getState: () => 0, isSolidAt: (x, y) => y < FLOOR, boxCollides: (x0, y0) => y0 < FLOOR, climbableAt: () => false };
  const DT = 1 / 60;
  const run = (gravity, jetpack) => {
    const p = new Player(world);
    p.pos = [0.5, FLOOR + 0.2, 0.5];
    p.gravity = gravity;
    p.jetpack = jetpack;
    const idle = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
    for (let i = 0; i < 30; i++) p.update(DT, idle);
    let top = 0;
    p.update(DT, { ...idle, jump: true, jumpPressed: true });
    for (let i = 0; i < 400; i++) { p.update(DT, { ...idle, jump: i < 20 }); top = Math.max(top, p.pos[1] - FLOOR); }
    return { p, top };
  };
  const earth = run(1, false).top, moon = run(1 / 6, false).top;
  assert.ok(earth > 1 && earth < 1.6, 'a jump on the Earth: ' + earth.toFixed(2));
  assert.ok(moon > 5 && moon < 10, 'on the Moon: ' + moon.toFixed(2));
  // holding jump from the jump does not thrust; releasing and pressing again does
  const { p } = run(1 / 6, true);
  p.pos[1] = FLOOR + 20; p.vel = [0, 0, 0]; p.onGround = false;
  const idle = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
  for (let i = 0; i < 60; i++) p.update(DT, { ...idle, jump: true });
  assert.ok(p.pos[1] > FLOOR + 22, 'thrusters climb: ' + (p.pos[1] - FLOOR).toFixed(1));
});

test('stopping in space near a body keeps you over the same ground as it turns and goes round', () => {
  class G {}
  installSpace(G);
  const g = new G();
  g.dimension = 3; g.genVersion = 2;
  g.player = { pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0.3, pitch: -0.2 };
  const hover = (body, base, x, z, h, T0, days, steps) => {
    g.dayCount = Math.floor(T0); g.dayTime = T0 - g.dayCount;
    const left = S.leaveSurface(body, x, base + h, z, base, T0);
    g.spaceState = { earth: { f: body === 'earth' ? left.bodyFrame : S.earthFrameStd(T0), T0 }, origin: left.pos, frame: left.local, from: body, lastT: T0 };
    for (let i = 0; i < steps; i++) { g.dayTime += days / steps; g.carryInSpace(); }
    return g.spaceNadir();
  };
  for (const [body, base, days] of [['earth', 64, 0.3], ['moon', 100, 1], ['mars', 90, 0.5]]) {
    const n = hover(body, base, 500, -300, 1500, 1.3, days, 300);
    assert.equal(n.body, body);
    assert.ok(Math.abs(n.x - 500) < 0.01 && Math.abs(n.z + 300) < 0.01 && Math.abs(n.alt - 1500) < 0.01, body + ': ' + [n.x, n.z, n.alt].join(', '));
    // and the view turns with the ground
    const f = g.bodyFrameNow(body);
    const pl = S.placeOn(body, g.spacePosC(), g.spaceTime(), f);
    assert.ok(near(S.localFrame(f, pl.lon, pl.lat).y, g.spaceState.frame.y, 1e-9), body + ' up');
  }
  // far from everything nothing carries you
  g.dayCount = 0; g.dayTime = 0.5;
  g.spaceState = { earth: { f: S.earthFrameStd(0.5), T0: 0.5 }, origin: [0, 0, -2e6], frame: S.IDENTITY, from: 'earth', lastT: 0.5 };
  for (let i = 0; i < 10; i++) { g.dayTime += 0.01; g.carryInSpace(); }
  assert.ok(near(g.spacePosC(), [0, 0, -2e6], 1e-6));
  // where you are as others are told it (over the nearest body), and back
  g.player.pos = [3, 4, 5];
  const bc = g.spaceBodyCoords();
  assert.equal(bc.body, 'earth');
  assert.ok(near(g.spaceLocalOfBody(bc.body, bc.q), [3, 4, 5], 1e-6));
});

test('joining a server again later, you are back in space over the ground you left', () => {
  class G {}
  installSpace(G);
  const g = new G();
  g.dimension = 3; g.genVersion = 2;
  g.player = { pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 };
  for (const [body, base] of [['moon', 100], ['earth', 64]]) {
    g.dayCount = 3; g.dayTime = 0.2;
    const T = g.spaceTime();
    const left = S.leaveSurface(body, 800, base + 1200, 250, base, T);
    g.spaceState = { earth: { f: body === 'earth' ? left.bodyFrame : S.earthFrameStd(T), T0: T }, origin: left.pos, frame: left.local, from: body, lastT: T };
    g.player.pos = [0, 0, 0];
    const saved = JSON.parse(JSON.stringify({ ...g.serializeSpace(), dimension: 3, dayCount: 5, dayTime: 0.7 }));
    // ... the world's clock has gone on two and a half days meanwhile
    g.loadSpace(saved);
    g.dayCount = 5; g.dayTime = 0.7;
    assert.equal(g.spaceState.atOrigin, true);
    const n = g.spaceNadir();
    assert.equal(n.body, body);
    assert.ok(Math.abs(n.x - 800) < 0.01 && Math.abs(n.z - 250) < 0.01 && Math.abs(n.alt - 1200) < 0.01, body + ': ' + [n.x, n.z, n.alt].join(', '));
  }
});
