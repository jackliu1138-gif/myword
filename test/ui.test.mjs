// UI data checks that run without a browser: translations, block names, controller helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { t, setLanguage, registerStrings } from '../src/ui/i18n.js';
import { BLOCKS } from '../src/world/blocks.js';
import { padStyle, GLYPHS } from '../src/game/gamepad.js';
import { readFileSync } from 'node:fs';

test('every interface string exists in both languages', () => {
  const src = readFileSync(new URL('../src/ui/i18n.js', import.meta.url), 'utf8');
  const block = (name) => {
    const start = src.indexOf(`  ${name}: {`);
    const end = src.indexOf('\n  },', start);
    return new Set([...src.slice(start, end).matchAll(/^\s+'([\w.]+)':/gm)].map((m) => m[1]));
  };
  const en = block('en'), zh = block('zh');
  assert.ok(en.size > 150);
  assert.deepEqual([...en].filter((k) => !zh.has(k)), [], 'missing Chinese');
  assert.deepEqual([...zh].filter((k) => !en.has(k)), [], 'missing English');
});

test('keys used by the interface resolve to text', () => {
  setLanguage('zh');
  assert.equal(t('title.play'), '开始游戏');
  assert.equal(t('unit.chunks', { n: 6 }), '6 个区块');
  setLanguage('en');
  assert.equal(t('title.play'), 'Play');
  assert.equal(t('toast.time', { time: '12:00' }), 'Time 12:00');
  assert.equal(t('no.such.key'), 'no.such.key');
  registerStrings('en', { 'x.test': 'Hi {who}' });
  assert.equal(t('x.test', { who: 'Ada' }), 'Hi Ada');
});

test('every placeable block has a Chinese name', () => {
  const missing = BLOCKS.filter((b) => b.id !== 0 && !b.zh).map((b) => b.key);
  assert.deepEqual(missing, []);
});

test('controller families are recognised for button names', () => {
  assert.equal(padStyle('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'), 'xbox');
  assert.equal(padStyle('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'), 'ps');
  assert.equal(padStyle('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)'), 'nintendo');
  for (const g of Object.values(GLYPHS)) assert.deepEqual(Object.keys(g), ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT']);
});
