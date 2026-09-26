// Phase 5: display text lives in src/theme, keyed by the internal ids in src/data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNITS } from '../src/data/units.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { STRATEGIES } from '../src/data/strategies.js';
import { DIFFICULTY } from '../src/data/difficulty.js';
import { UNIT_TEXT, BUILDING_TEXT, STRATEGY_TEXT, DIFFICULTY_TEXT } from '../src/theme/names.js';

test('every unit, building, strategy and difficulty has display text, and nothing else does', () => {
  for (const [data, text] of [[UNITS, UNIT_TEXT], [BUILDINGS, BUILDING_TEXT], [STRATEGIES, STRATEGY_TEXT], [DIFFICULTY, DIFFICULTY_TEXT]]) {
    assert.deepEqual(Object.keys(text).sort(), Object.keys(data).sort());
    for (const t of Object.values(text)) assert.ok(t.name, 'has a name');
  }
  for (const id of Object.keys(UNITS)) assert.ok(UNIT_TEXT[id].role, `${id} has a role`);
  for (const id of ['rush', 'boom', 'turtle']) assert.ok(STRATEGY_TEXT[id].description, `${id} has a description`);
});

test('src/data carries no display text', () => {
  const walk = (v, path) => {
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      assert.ok(!['name', 'role', 'description'].includes(k), `${path}.${k} is display text`);
      walk(x, `${path}.${k}`);
    }
  };
  walk({ UNITS, BUILDINGS, STRATEGIES, DIFFICULTY }, 'data');
});
