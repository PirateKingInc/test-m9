import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';
import { World } from '../src/sim/world.js';
import { MAP } from '../src/data/map.js';
import { createRng } from '../src/sim/rng.js';
import { Grid } from '../src/sim/grid.js';
import { SIM_DT } from '../src/sim/constants.js';

test('seeded RNG is deterministic and in [0,1)', () => {
  const a = createRng(42), b = createRng(42), c = createRng(43);
  const sa = Array.from({ length: 100 }, a.next);
  const sb = Array.from({ length: 100 }, b.next);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, Array.from({ length: 100 }, c.next));
  assert.ok(sa.every((v) => v >= 0 && v < 1));
});

test('map is larger than one screen and matches SPEC dimensions', () => {
  const w = new World();
  assert.equal(w.width, 3200);
  assert.equal(w.height, 2400);
  assert.ok(w.width > 1920 && w.height > 1080);
});

test('rocks, nodes and the starting core block their tiles', () => {
  const w = new World();
  assert.equal(w.grid.isWalkable(38, 0), false); // ridge A
  assert.equal(w.grid.isWalkable(38, 25), true); // ridge A chokepoint
  assert.equal(w.grid.isWalkable(20, 29), false); // crystal node
  assert.equal(w.grid.isWalkable(9, 36), false); // command core
  assert.equal(w.grid.isWalkable(13, 35), true); // drone start tile
  assert.equal([...w.ofKind('node')].length, MAP.nodes.length);
  assert.equal([...w.ofKind('node')].every((n) => n.amount === 2500), true);
});

test('start state: one built core, four drones, 250 Lumen', () => {
  const w = new World();
  const buildings = [...w.ofKind('building')];
  assert.equal(buildings.length, 1);
  assert.equal(buildings[0].type, 'core');
  assert.equal(buildings[0].built, true);
  assert.equal([...w.ofKind('unit')].filter((u) => u.type === 'drone').length, 4);
  assert.equal(w.resources[1], 250);
});

test('fixed timestep advances time by SIM_DT per step', () => {
  const w = new World();
  w.run(3);
  assert.equal(w.tick, Math.round(3 / SIM_DT));
  assert.ok(Math.abs(w.time - 3) < 1e-9);
});

test('grid spiral yields nearest walkable tiles first and skips blocked ones', () => {
  const g = new Grid(10, 10, 32);
  g.setRock(4, 4, 2, 2);
  const first = g.nearestWalkable(4, 4);
  assert.ok(g.isWalkable(first.tx, first.ty));
  assert.equal(Math.max(Math.abs(first.tx - 4), Math.abs(first.ty - 4)), 1);
  assert.equal(g.isRectFree(0, 0, 3, 3), true);
  assert.equal(g.isRectFree(3, 3, 2, 2), false);
  assert.equal(g.isRectFree(9, 9, 2, 2), false); // out of bounds
});
