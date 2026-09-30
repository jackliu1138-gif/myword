// The game's methods are spread over several modules that install themselves on Game.prototype;
// two with the same name would silently replace one another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('no two game modules define the same method', () => {
  const dir = new URL('../src/game/', import.meta.url);
  const seen = new Map();
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/^\s*P\.([A-Za-z0-9_$]+)\s*=\s*function/gm)) {
      assert.ok(!seen.has(m[1]), `${m[1]} is defined in both ${seen.get(m[1])} and ${f}`);
      seen.set(m[1], f);
    }
  }
  assert.ok(seen.size > 100);
});
