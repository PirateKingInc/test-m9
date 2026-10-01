// Phase 2 population cap: identical for every team, raised by completed providers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyWorld, tileCenter, runUntil } from './helpers.js';
import { supplyOf } from '../src/sim/supply.js';
import { UNITS } from '../src/data/units.js';
import { BUILDINGS, SUPPLY } from '../src/data/buildings.js';

function twoTeams() {
  const w = emptyWorld({ cols: 60, rows: 30 });
  w.resources[1] = w.resources[2] = 10000;
  const c1 = w.addBuilding('core', 1, 4, 4, { built: true });
  const c2 = w.addBuilding('core', 2, 50, 4, { built: true });
  const f1 = w.addBuilding('foundry', 1, 4, 12, { built: true });
  const f2 = w.addBuilding('foundry', 2, 50, 12, { built: true });
  return { w, c1, c2, f1, f2 };
}

test('supply numbers match SPEC.md', () => {
  const spec = readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
  assert.match(spec, /Drone 1, Striker 1, Sparker 1, Lancer 2, Bulwark 3/);
  assert.match(spec, /Command Core \*\*10\*\*, Lumen Depot \*\*10\*\*/);
  assert.match(spec, /\*\*100\*\* per team/);
  assert.deepEqual(['drone', 'striker', 'sparker', 'lancer', 'bulwark'].map((u) => UNITS[u].supply), [1, 1, 1, 2, 3]);
  assert.deepEqual([BUILDINGS.core.supply, BUILDINGS.depot.supply, SUPPLY.max], [10, 10, 100]);
});

test('both teams are capped identically', () => {
  const { w, c1, c2, f1, f2 } = twoTeams();
  const results = {};
  for (const [team, core, foundry] of [[1, c1, f1], [2, c2, f2]]) {
    let accepted = 0;
    for (let i = 0; i < 5; i++) if (w.issue({ type: 'train', building: core.id, unit: 'drone', team }).ok) accepted++;
    for (let i = 0; i < 5; i++) if (w.issue({ type: 'train', building: foundry.id, unit: 'bulwark', team }).ok) accepted++;
    results[team] = { accepted, ...supplyOf(w, team) };
  }
  assert.deepEqual(results[1], results[2]);
  assert.deepEqual(results[1], { accepted: 6, used: 8, cap: 10, free: 2 }, '5 drones + 1 bulwark fit in 10; the next bulwark does not');
});

test('queueing reserves supply, cancelling releases it, and the rejection says why', () => {
  const { w, f1 } = twoTeams();
  for (let i = 0; i < 3; i++) w.issue({ type: 'train', building: f1.id, unit: 'bulwark', team: 1 });
  assert.equal(supplyOf(w, 1).used, 9);
  const res = w.issue({ type: 'train', building: f1.id, unit: 'lancer', team: 1 });
  assert.equal(res.ok, false);
  assert.match(res.reason, /supply/);
  const lumen = w.resources[1];
  w.issue({ type: 'cancelTrain', building: f1.id, team: 1 });
  assert.equal(supplyOf(w, 1).used, 6);
  assert.equal(w.resources[1], lumen + 150, 'cancel still refunds 100%');
  assert.equal(w.issue({ type: 'train', building: f1.id, unit: 'lancer', team: 1 }).ok, true);
});

test('completed Depots raise the cap (+10 each) up to the hard max of 100; unfinished ones do not', () => {
  const { w } = twoTeams();
  const site = w.addBuilding('depot', 1, 12, 4);
  assert.equal(supplyOf(w, 1).cap, 10, 'unfinished depot provides nothing');
  site.built = true;
  assert.equal(supplyOf(w, 1).cap, 20);
  for (let i = 0; i < 7; i++) w.addBuilding('depot', 1, 12 + 4 * (i % 4), 12 + 4 * Math.floor(i / 4), { built: true });
  assert.equal(supplyOf(w, 1).cap, 90, 'the Castle and 8 Storehouses: 10 + 8x10');
  w.addBuilding('depot', 1, 28, 4, { built: true });
  assert.equal(supplyOf(w, 1).cap, 100, 'the ninth reaches the cap');
  w.addBuilding('depot', 1, 32, 4, { built: true });
  assert.equal(supplyOf(w, 1).cap, 100, '10 + 10x10 = 110, clamped to 100');
  assert.equal(supplyOf(w, 2).cap, 10, 'the other team is unaffected');
});

test('trained units hold their supply; losing a provider blocks training but kills nothing', () => {
  const { w, c1, f1 } = twoTeams();
  const depot = w.addBuilding('depot', 1, 12, 4, { built: true });
  for (let i = 0; i < 4; i++) w.issue({ type: 'train', building: f1.id, unit: 'bulwark', team: 1 });
  runUntil(w, () => f1.queue.length === 0, 200);
  assert.equal([...w.ofKind('unit')].filter((u) => u.type === 'bulwark').length, 4);
  assert.deepEqual(supplyOf(w, 1), { used: 12, cap: 20, free: 8 });
  depot.hp = 0; // destroyed
  w.step();
  assert.equal(w.get(depot.id), undefined);
  assert.equal([...w.ofKind('unit')].filter((u) => u.type === 'bulwark').length, 4, 'units survive');
  assert.deepEqual(supplyOf(w, 1), { used: 12, cap: 10, free: -2 });
  assert.equal(w.issue({ type: 'train', building: c1.id, unit: 'drone', team: 1 }).ok, false);
});

test('a full match-sized army is bounded by the cap', () => {
  const { w, f1 } = twoTeams();
  for (let i = 0; i < 9; i++) w.addBuilding('depot', 1, 12 + 4 * (i % 5), 12 + 4 * Math.floor(i / 5), { built: true });
  let trained = 0;
  for (let round = 0; round < 200; round++) {
    while (f1.queue.length < 5 && w.issue({ type: 'train', building: f1.id, unit: 'striker', team: 1 }).ok) trained++;
    if (!f1.queue.length) break; // nothing more could be queued: at the cap
    runUntil(w, () => f1.queue.length < 5, 60);
  }
  runUntil(w, () => f1.queue.length === 0, 100);
  assert.equal(trained, 100, '100 one-supply units, then the hard max stops production');
  assert.equal(supplyOf(w, 1).used, 100);
  assert.equal(w.issue({ type: 'train', building: f1.id, unit: 'striker', team: 1 }).ok, false);
  void tileCenter;
});
