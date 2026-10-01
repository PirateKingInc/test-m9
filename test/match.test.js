// Phase 2 match setup and win/lose rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, runUntil } from './helpers.js';
import { MAP } from '../src/data/map.js';
import { hasCore, score } from '../src/sim/victory.js';

const core = (w, team) => [...w.ofKind('building')].find((b) => b.team === team && b.type === 'core');
const units = (w, team) => [...w.ofKind('unit')].filter((u) => u.team === team);

test('the map is mirror-symmetric about the vertical center line', () => {
  const key = ([x, y, w, h]) => `${x},${y},${w},${h}`;
  const rocks = new Set(MAP.rocks.map(key));
  for (const [x, y, w, h] of MAP.rocks) assert.ok(rocks.has(key([MAP.cols - x - w, y, w, h])), `rock ${key([x, y, w, h])} has a mirror`);
  const nodes = new Set(MAP.nodes.map(([x, y]) => `${x},${y}`));
  for (const [x, y] of MAP.nodes) assert.ok(nodes.has(`${MAP.cols - x - 2},${y}`), `node ${x},${y} has a mirror`);
  assert.deepEqual(MAP.aiStart.core, [MAP.cols - MAP.start.core[0] - 4, MAP.start.core[1]]);
  assert.deepEqual(MAP.aiStart.drones, MAP.start.drones.map(([x, y]) => [MAP.cols - x - 1, y]));
});

test('match setup: both teams start with a Core, four Drones and 250 Lumen; sandbox is unchanged', () => {
  const w = makeWorld({ setup: 'match' });
  for (const team of [1, 2]) {
    assert.ok(core(w, team)?.built, `team ${team} core`);
    assert.equal(units(w, team).filter((u) => u.type === 'drone').length, 4);
    assert.equal(w.resources[team], 250);
  }
  assert.deepEqual([core(w, 2).tx, core(w, 2).ty], [88, 35]);
  const sandbox = makeWorld();
  assert.equal(sandbox.mode, 'sandbox');
  assert.equal(units(sandbox, 2).length, 0);
  sandbox.run(5);
  assert.equal(sandbox.result, null, 'the sandbox never ends');
});

test('both bases can reach each other (the map is fully connected for both starts)', () => {
  const w = makeWorld({ setup: 'match' });
  const d = units(w, 1)[0];
  const target = core(w, 2);
  w.issue({ type: 'move', ids: [d.id], x: target.x - 80, y: target.y });
  runUntil(w, () => d.order.type === 'idle', 90);
  assert.ok(Math.hypot(d.x - (target.x - 80), d.y - target.y) < 40);
});

for (const [victim, winner] of [[2, 1], [1, 2]]) {
  test(`destroying team ${victim}'s Command Core ends the match: team ${winner} wins`, () => {
    const w = makeWorld({ setup: 'match' });
    const c = core(w, victim);
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push(w.issue({ type: 'devSpawn', unit: 'lancer', team: winner, x: c.x + (victim === 2 ? -90 : 90), y: c.y - 60 + i * 24 }).id);
    w.issue({ type: 'attack', ids, target: c.id, team: winner });
    const t = runUntil(w, () => w.result, 120);
    assert.ok(t < 120);
    assert.deepEqual([w.result.winner, w.result.loser, w.result.reason], [winner, victim, 'core-destroyed']);
    assert.ok(w.drainEvents().some((e) => e.type === 'gameOver' && e.winner === winner));
  });
}

test('an unfinished replacement Core does not keep a team alive', () => {
  const w = makeWorld({ setup: 'match' });
  w.addBuilding('core', 2, 60, 44); // under construction
  core(w, 2).hp = 0;
  w.step();
  assert.equal(w.result.winner, 1);
});

test('a second completed Core keeps a team alive until it falls too', () => {
  const w = makeWorld({ setup: 'match' });
  const spare = w.addBuilding('core', 2, 60, 44, { built: true });
  core(w, 2).hp = 0;
  w.step();
  assert.equal(w.result, null);
  assert.ok(hasCore(w, 2));
  spare.hp = 0;
  w.step();
  assert.equal(w.result.winner, 1);
});

test('both Cores falling in the same tick is a declared draw', () => {
  const w = makeWorld({ setup: 'match' });
  core(w, 1).hp = 0;
  core(w, 2).hp = 0;
  w.step();
  assert.deepEqual([w.result.winner, w.result.reason], [null, 'draw']);
});

test('the time limit always ends the match, on score (ties draw)', () => {
  const w = makeWorld({ setup: 'match' });
  w.map = { ...w.map, timeLimit: 3 };
  w.resources[1] += 100;
  runUntil(w, () => w.result, 10);
  assert.deepEqual([w.result.winner, w.result.reason], [1, 'time-limit']);
  assert.equal(w.result.scores[1] - w.result.scores[2], 100);
  const tie = makeWorld({ setup: 'match' });
  tie.map = { ...tie.map, timeLimit: 2 };
  runUntil(tie, () => tie.result, 10);
  assert.deepEqual([tie.result.winner, tie.result.reason], [null, 'time-limit']);
  assert.equal(score(tie, 1), score(tie, 2));
});

test('after the result the world is frozen: step() and issue() are inert', () => {
  const w = makeWorld({ setup: 'match' });
  core(w, 2).hp = 0;
  w.step();
  const t = w.time, tick = w.tick;
  const d = units(w, 1)[0], x = d.x;
  const res = w.issue({ type: 'move', ids: [d.id], x: 100, y: 100 });
  assert.deepEqual(res, { ok: false, reason: 'Game over' });
  w.run(5);
  assert.deepEqual([w.time, w.tick, d.x], [t, tick, x]);
  assert.equal(w.drainEvents().filter((e) => e.type === 'gameOver').length, 1, 'exactly one gameOver event');
});
