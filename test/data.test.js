import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UNITS, DAMAGE_MULTIPLIERS } from '../src/data/units.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { MAP } from '../src/data/map.js';

const spec = readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
const rows = (header) => {
  const lines = spec.split('\n');
  const i = lines.findIndex((l) => l.startsWith(header));
  const out = [];
  for (let j = i + 2; j < lines.length && lines[j].startsWith('|'); j++) out.push(lines[j].split('|').slice(1, -1).map((c) => c.trim()));
  return out;
};

test('unit stats in src/data/units.js match the SPEC.md table', () => {
  const table = rows('| id | Name | Role |');
  assert.equal(table.length, 5, 'five playable unit types');
  for (const [id, , , hp, armor, attack, dmg, cd, range, speed, radius, cost, time] of table) {
    const u = UNITS[id];
    assert.ok(u, `unit ${id} exists`);
    assert.deepEqual(
      [u.hp, u.armor, u.attack, u.damage, u.cooldown, u.range, u.speed, u.radius, u.cost, u.trainTime],
      [+hp, armor, attack, +dmg, +cd, +range, +speed, +radius, +cost, +time], id);
  }
});

test('damage multipliers match the SPEC.md table', () => {
  for (const [attack, light, heavy, structure] of rows('| Attack ↓ / Armor → |')) {
    assert.deepEqual(DAMAGE_MULTIPLIERS[attack], { light: +light, heavy: +heavy, structure: +structure }, attack);
  }
});

test('building stats match SPEC.md', () => {
  for (const [id, , fp, hp, , cost, time] of rows('| id | Name | Footprint |')) {
    const b = BUILDINGS[id];
    const [w, h] = fp.split('×').map(Number);
    assert.deepEqual([b.w, b.h, b.hp, b.cost, b.buildTime], [w, h, +hp, +cost, +time], id);
  }
});

test('the Foundry trains all four combat units; the Core trains the Drone', () => {
  assert.deepEqual(BUILDINGS.foundry.trains, ['striker', 'sparker', 'bulwark', 'lancer']);
  assert.deepEqual(BUILDINGS.core.trains, ['drone']);
  for (const [id, u] of Object.entries(UNITS)) {
    if (u.testOnly) continue;
    assert.ok(BUILDINGS[u.trainedAt].trains.includes(id), `${id} is trainable at ${u.trainedAt}`);
  }
});

test('map is 100x75 with 20 crystal nodes (Phase 12; 80x60 before)', () => {
  assert.equal(MAP.cols, 100);
  assert.equal(MAP.rows, 75);
  assert.equal(MAP.nodes.length, 20);
});
