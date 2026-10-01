import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorld, makeWorld, tileCenter, runUntil } from './helpers.js';
import { GATHER } from '../src/sim/economy.js';

// Depot footprint x 10..12, node x 20..21: approach tiles are x=13 and x=19, 192 px apart.
function economyWorld({ amount = 1500, depot = true } = {}) {
  const w = emptyWorld({ nodes: [] });
  const node = w.addNode(20, 9, amount);
  const dep = depot ? w.addBuilding('depot', 1, 10, 9, { built: true }) : null;
  const c = tileCenter(15, 10);
  const d = w.addUnit('drone', 1, c.x, c.y);
  return { w, node, dep, d };
}

test('gathering rate matches 8 / (2 + roundTrip/72) within 15%', () => {
  const { w, node, d } = economyWorld();
  const start = w.resources[1];
  w.issue({ type: 'gather', ids: [d.id], node: node.id });
  runUntil(w, () => w.resources[1] > start, 30); // first delivery
  const r0 = w.resources[1], t0 = w.time;
  w.run(240);
  const measured = (w.resources[1] - r0) / (w.time - t0);
  const expected = GATHER.carry / (GATHER.mineTime + (2 * 192) / 72);
  const err = Math.abs(measured - expected) / expected;
  assert.ok(err < 0.15, `measured ${measured.toFixed(3)}/s vs expected ${expected.toFixed(3)}/s (${(err * 100).toFixed(1)}%)`);
  assert.equal(node.amount, 1500 - (w.resources[1] - start) - d.carry, 'every Lumen mined is accounted for');
});

test('several drones on one node deliver proportionally more', () => {
  const { w, node } = economyWorld();
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(w.addUnit('drone', 1, tileCenter(15, 8 + i).x, tileCenter(15, 8 + i).y).id);
  w.issue({ type: 'gather', ids, node: node.id });
  w.run(120);
  const per = GATHER.carry / (GATHER.mineTime + (2 * 192) / 72);
  assert.ok(w.resources[1] - 1000 > 3 * per * 120 * 0.75, `got ${w.resources[1] - 1000}`);
});

test('the Command Core is not a drop-off: drones hold cargo until a Depot exists', () => {
  const { w, node, d } = economyWorld({ depot: false });
  w.addBuilding('core', 1, 3, 8, { built: true });
  w.issue({ type: 'gather', ids: [d.id], node: node.id });
  w.run(20);
  assert.equal(d.carry, 8);
  assert.equal(w.resources[1], 1000);
  w.addBuilding('depot', 1, 10, 9, { built: true });
  runUntil(w, () => w.resources[1] > 1000, 30);
  assert.equal(w.resources[1], 1008);
});

test('unfinished depots do not accept cargo', () => {
  const { w, node, d } = economyWorld({ depot: false });
  const site = w.addBuilding('depot', 1, 10, 9);
  w.issue({ type: 'gather', ids: [d.id], node: node.id });
  w.run(20);
  assert.equal(w.resources[1], 1000);
  site.built = true;
  runUntil(w, () => w.resources[1] > 1000, 30);
});

test('empty nodes vanish, free their tiles, and drones move on to a nearby node', () => {
  const { w, node, d } = economyWorld({ amount: 16 });
  const other = w.addNode(20, 14, 1500);
  w.issue({ type: 'gather', ids: [d.id], node: node.id });
  runUntil(w, () => !w.get(node.id), 60);
  assert.equal(w.grid.isWalkable(20, 9), true);
  assert.ok(w.drainEvents().some((e) => e.type === 'depleted'));
  runUntil(w, () => other.amount < 1500, 30);
  assert.equal(d.order.node, other.id);
});

test('drones go idle when no node is left nearby', () => {
  const { w, node, d } = economyWorld({ amount: 8 });
  w.issue({ type: 'gather', ids: [d.id], node: node.id });
  runUntil(w, () => d.order.type === 'idle', 60);
  assert.equal(w.resources[1], 1008);
});

test('on the real map four drones gather into a new depot', () => {
  const w = makeWorld();
  const drones = [...w.ofKind('unit')];
  w.issue({ type: 'build', ids: [drones[0].id], building: 'depot', tx: 17, ty: 35 });
  runUntil(w, () => [...w.ofKind('building')].every((b) => b.built), 60);
  const node = [...w.ofKind('node')].find((n) => n.tx === 23 && n.ty === 35);
  w.issue({ type: 'gather', ids: drones.map((u) => u.id), node: node.id });
  const before = w.resources[1];
  w.run(60);
  assert.ok(w.resources[1] - before >= 150, `gathered ${w.resources[1] - before} in 60s`);
});
