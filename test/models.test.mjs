// Creature models: they stand on their feet the right way up, face where they walk, and their
// poses bend the way they should (the original's angles are for a Y-down space: turns about x
// and z change sign in ours).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, buildSkins, emitModel, ENTITY_FLOATS } from '../src/render/models.js';

const skins = buildSkins({});
const out = new Float32Array(ENTITY_FLOATS * 36 * 256);

// every vertex (in pixels, the creature at the origin facing -z) and each part's range of them
function build(type, extra = {}) {
  const e = { id: 1, type, yaw: 0, headYaw: 0, headPitch: 0, walkPhase: 0, walkAmount: 0, flags: 0, ...extra };
  const n = emitModel(out, 0, e, type, [0, 0, 0], 0, [0, 0, 0], [1, 1], skins, 0, [0, 0, 0, 0], type, null) / ENTITY_FLOATS;
  const verts = [];
  for (let i = 0; i < n; i++) {
    const k = i * ENTITY_FLOATS;
    verts.push({ p: [out[k] * 16, out[k + 1] * 16, out[k + 2] * 16], n: [out[k + 3], out[k + 4], out[k + 5]] });
  }
  const parts = {};
  let i = 0;
  for (const [name] of MODELS[type].parts) { parts[name] = verts.slice(i, i + 36); i += 36; }
  return { verts, parts };
}
const range = (vs, axis) => [Math.min(...vs.map((v) => v.p[axis])), Math.max(...vs.map((v) => v.p[axis]))];
const centre = (vs) => [0, 1, 2].map((a) => vs.reduce((s, v) => s + v.p[a], 0) / vs.length);

test('creatures that walk stand on the ground, the right way up', () => {
  const ground = ['zombie', 'player', 'skeleton', 'creeper', 'cow', 'pig', 'sheep', 'chicken', 'zombified_piglin', 'enderman', 'villager', 'witch',
    'pillager', 'vindicator', 'evoker', 'iron_golem', 'wolf', 'cat', 'horse', 'wither_skeleton', 'slime', 'spider', 'cave_spider'];
  for (const type of ground) {
    const { verts } = build(type);
    const [lo] = range(verts, 1);
    assert.ok(lo > -2.5 && lo < 0.5, `${type}: lowest point ${lo.toFixed(2)} px`);
  }
});

test('spiders stand on their eight legs (not on their backs with the legs in the air)', () => {
  for (const type of ['spider', 'cave_spider']) {
    for (const walk of [0, 1]) {
      const { verts, parts } = build(type, { walkAmount: walk, walkPhase: 0.7 });
      const top = range([...parts.body, ...parts.head], 1)[1];
      assert.ok(range(verts, 1)[1] <= top + 0.01, `${type}: nothing sticks up above the body`);
      let down = 0;
      for (let i = 0; i < 4; i++) {
        for (const side of ['R', 'L']) {
          const leg = parts['leg' + side + i];
          if (range(leg, 1)[0] < 2.5) down++;
          // right legs to the right (-x), left legs to the left
          const c = centre(leg);
          assert.ok(side === 'R' ? c[0] < -3 : c[0] > 3, `${type}: leg ${side}${i} is on its side`);
        }
      }
      // standing, all eight reach the ground; walking, the ones mid-step are lifted
      assert.ok(walk ? down >= 4 : down === 8, `${type}: ${down} legs on the ground`);
      assert.ok(centre(parts.legR0)[2] < centre(parts.legR3)[2], `${type}: front legs ahead of the hind ones`);
    }
  }
});

test('heads are at the front, tails at the back', () => {
  for (const [type, m] of Object.entries(MODELS)) {
    if (!m.parts) continue;
    const names = m.parts.map((p) => p[0]);
    if (!names.includes('head') || !names.includes('body')) continue;
    const { parts } = build(type);
    const hz = centre(parts.head)[2], bz = centre(parts.body)[2];
    assert.ok(hz <= bz + 0.01, `${type}: head (z ${hz.toFixed(1)}) not behind the body (z ${bz.toFixed(1)})`);
    if (parts.tail) assert.ok(centre(parts.tail)[2] >= bz - 0.01 || type === 'wither', `${type}: tail behind the body`);
  }
});

test('noses and ears turn with the head, once', () => {
  for (const [type, nose] of [['villager', 'nose'], ['pillager', 'nose'], ['iron_golem', 'nose'], ['wolf', 'snout'], ['cat', 'nose'], ['zombified_piglin', 'earR']]) {
    const still = build(type);
    const turned = build(type, { headYaw: 0.8 });
    const pivot = MODELS[type].parts.find((p) => p[0] === 'head')[1];
    const c0 = centre(still.parts[nose]), c1 = centre(turned.parts[nose]);
    // where it should be: turned about the head's pivot by the head's turn
    const dx = c0[0] - pivot[0], dz = c0[2] - pivot[2];
    const ex = pivot[0] + Math.cos(0.8) * dx + Math.sin(0.8) * dz, ez = pivot[2] - Math.sin(0.8) * dx + Math.cos(0.8) * dz;
    assert.ok(Math.hypot(c1[0] - ex, c1[2] - ez) < 0.6, `${type}: the ${nose} stays on the face`);
  }
});

test('poses: tails behind, pets sit on their haunches, riders sit with their legs forward, sleepers lie face up', () => {
  // a tame wolf's tail sticks out behind, a wild one's hangs down behind
  for (const flags of [0, 128]) {
    const { parts } = build('wolf', { flags, health: 20 });
    assert.ok(centre(parts.tail)[2] > 10, `wolf (flags ${flags}): tail behind the body, not tucked under it`);
  }
  // the horse's tail hangs behind its rump
  assert.ok(centre(build('horse').parts.tail)[2] > 11, 'horse: tail behind');
  // sitting: the rear on the ground, the chest up, hind legs folded forwards along the ground
  const sit = build('wolf', { flags: 256 | 128 }).parts;
  assert.ok(range(sit.body, 1)[0] < 1.5, 'sitting wolf: rear on the ground');
  assert.ok(range(sit.legBR, 1)[1] - range(sit.legBR, 1)[0] < 3.5, 'sitting wolf: hind legs folded flat');
  const cat = build('cat', { flags: 256 }).parts;
  assert.ok(range(cat.body, 1)[0] < 1.5, 'sitting cat: rear on the ground');
  // squid tentacles open outwards
  const sq = build('squid').parts;
  for (let i = 0; i < 8; i++) {
    const tip = sq['tent' + i].reduce((a, v) => (v.p[1] < a.p[1] ? v : a));
    const piv = MODELS.squid.parts.find((p) => p[0] === 'tent' + i)[1];
    assert.ok(Math.hypot(tip.p[0], tip.p[2]) >= Math.hypot(piv[0], piv[2]) - 0.5, `squid tentacle ${i} opens out`);
  }
  // a rider's legs go forwards
  const ride = build('player', { sitting: true }).parts;
  assert.ok(centre(ride.rightLeg)[2] < -3 && centre(ride.leftLeg)[2] < -3, 'riding: legs forwards');
  // asleep: the face looks up
  const lying = build('player', { lying: true }).parts.head;
  assert.ok(lying[0].n[1] > 0.9, 'asleep: face up');
  // gliding: the arms out beside the body, not inside it
  const glide = build('player', { gliding: true }).parts;
  assert.ok(centre(glide.rightArm)[0] < -5.5 && centre(glide.leftArm)[0] > 5.5, 'gliding: arms out at the sides');
  // the boat's oars dip into the water as they pull back (the blades going backwards, +z)
  const pull = build('boat', { rowPhase: 0 }).parts, back = build('boat', { rowPhase: 0.2 }).parts;
  assert.ok(range(pull.oarR, 1)[0] < 3 && range(pull.oarL, 1)[0] < 3, 'oars deep in the water');
  assert.ok(Math.max(...back.oarR.map((v) => v.p[2])) > Math.max(...pull.oarR.map((v) => v.p[2])), 'the deep blade sweeps backwards');
  assert.ok(range(build('boat', { rowPhase: Math.PI }).parts.oarR, 1)[0] > 3, 'and comes forwards out of the water');
});
