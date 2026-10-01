import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorld, makeWorld, tileCenter, runUntil } from './helpers.js';
import { canPlace } from '../src/sim/construction.js';
import { BUILDINGS } from '../src/data/buildings.js';

function withDrone(opts) {
  const w = emptyWorld(opts);
  const c = tileCenter(3, 3);
  return { w, d: w.addUnit('drone', 1, c.x, c.y) };
}

test('placement validity: rock, nodes, buildings and map bounds are rejected', () => {
  const w = makeWorld();
  assert.equal(canPlace(w, 'depot', 15, 35), true, 'open ground next to the home field');
  assert.equal(canPlace(w, 'depot', 37, 5), false, 'overlaps ridge A');
  assert.equal(canPlace(w, 'depot', 19, 28), false, 'overlaps a crystal node');
  assert.equal(canPlace(w, 'depot', 10, 36), false, 'overlaps the Command Core');
  assert.equal(canPlace(w, 'core', 97, 10), false, 'runs off the map');
  const drone = [...w.ofKind('unit')][0];
  const res = w.issue({ type: 'build', ids: [drone.id], building: 'depot', tx: 37, ty: 5 });
  assert.equal(res.ok, false);
  assert.equal(w.resources[1], 250, 'rejected placement costs nothing');
});

test('cost is paid on placement; orders beyond the stockpile are rejected', () => {
  const { w, d } = withDrone();
  w.resources[1] = 260;
  assert.equal(w.issue({ type: 'build', ids: [d.id], building: 'foundry', tx: 10, ty: 3 }).ok, true);
  assert.equal(w.resources[1], 260 - BUILDINGS.foundry.cost);
  const res = w.issue({ type: 'build', ids: [d.id], building: 'foundry', tx: 10, ty: 10 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'Not enough Lumen');
  assert.equal(w.resources[1], 110);
  assert.ok(w.drainEvents().some((e) => e.type === 'rejected'));
});

test('construction takes buildTime once the drone arrives; HP grows 10% -> 100%', () => {
  const { w, d } = withDrone();
  const { id } = w.issue({ type: 'build', ids: [d.id], building: 'depot', tx: 6, ty: 2 });
  const b = w.get(id);
  assert.equal(b.built, false);
  assert.equal(b.hp, BUILDINGS.depot.hp * 0.1);
  runUntil(w, () => b.progress > 0, 10);
  const started = w.time;
  runUntil(w, () => b.built, 60);
  const took = w.time - started;
  assert.ok(Math.abs(took - BUILDINGS.depot.buildTime) < 0.2, `took ${took}`);
  assert.equal(b.hp, BUILDINGS.depot.hp);
  w.step();
  assert.equal(d.order.type, 'idle', 'builder is released when done');
  assert.ok(w.drainEvents().some((e) => e.type === 'built' && e.id === id));
});

test('progress pauses without a builder and extra builders do not stack', () => {
  const { w, d } = withDrone();
  const c = tileCenter(4, 8);
  const d2 = w.addUnit('drone', 1, c.x, c.y);
  const { id } = w.issue({ type: 'build', ids: [d.id], building: 'spire', tx: 6, ty: 5 });
  const b = w.get(id);
  runUntil(w, () => b.progress > 0.2, 30);
  w.issue({ type: 'stop', ids: [d.id] });
  const p = b.progress;
  w.run(3);
  assert.equal(b.progress, p, 'paused without a builder');
  w.issue({ type: 'assist', ids: [d.id, d2.id], target: id });
  runUntil(w, () => b.progress > p, 20);
  const p2 = b.progress, t2 = w.time;
  runUntil(w, () => b.built, 60);
  const rate = (1 - p2) / (w.time - t2);
  assert.ok(Math.abs(rate - 1 / BUILDINGS.spire.buildTime) < 0.002, 'two builders build at the single rate');
});

test('cancelling an unfinished site refunds 75% and frees its tiles', () => {
  const { w, d } = withDrone();
  const before = w.resources[1];
  const { id } = w.issue({ type: 'build', ids: [d.id], building: 'foundry', tx: 8, ty: 8 });
  w.run(2);
  assert.equal(w.grid.isWalkable(9, 9), false);
  const res = w.issue({ type: 'cancelBuild', id });
  assert.equal(res.refund, Math.floor(150 * 0.75));
  assert.equal(w.resources[1], before - 150 + 112);
  assert.equal(w.get(id), undefined);
  assert.equal(w.grid.isWalkable(9, 9), true);
  w.run(0.5);
  assert.equal(d.order.type, 'idle');
});

test('placing a building evicts units on the footprint and re-routes movers', () => {
  const { w, d } = withDrone();
  const c = tileCenter(12, 5);
  const bystander = w.addUnit('striker', 1, c.x, c.y);
  const mover = w.addUnit('striker', 1, tileCenter(2, 12).x, tileCenter(2, 12).y);
  const goal = tileCenter(22, 12);
  w.issue({ type: 'move', ids: [mover.id], ...goal });
  w.issue({ type: 'build', ids: [d.id], building: 'core', tx: 11, ty: 4 });
  const t = w.grid.tileOf(bystander.x, bystander.y);
  assert.ok(w.grid.isWalkable(t.tx, t.ty), 'bystander pushed off the footprint');
  w.issue({ type: 'build', ids: [d.id], building: 'foundry', tx: 10, ty: 11 }); // blocks the mover's line
  runUntil(w, () => mover.order.type === 'idle', 30);
  assert.ok(Math.hypot(mover.x - goal.x, mover.y - goal.y) < 3, 'mover routed around the new building');
});
