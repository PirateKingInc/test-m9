// Phase 12 pathfinding at scale (PHASE12_SPEC.md "Part A"): the per-tick
// route-search budget, and the pathfinder's cheaper reset and clearance
// check, which must give exactly the routes the full reset gave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PF, makeWorld, emptyWorld, tileCenter } from './helpers.js';
import { Pathfinder } from '../src/sim/pathfinder.js';
import { createRng } from '../src/sim/rng.js';
import { FFA_MAP } from '../src/data/ffa.js';

const BUDGET = 96;

function army(w, n) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const c = tileCenter(1 + (i % 10), 1 + Math.floor(i / 10));
    ids.push(w.addUnit('striker', 1, c.x, c.y).id);
  }
  return ids;
}

test('an order to a big army plans at most the budget of routes a tick; the rest follow in unit order', () => {
  const w = emptyWorld({ cols: 60, rows: 40, rocks: [[30, 0, 2, 30]] });
  const ids = army(w, 250);
  const goal = tileCenter(50, 20);
  const s0 = w.pathfinder.searches;
  w.issue({ type: 'move', ids, x: goal.x, y: goal.y });
  assert.equal(w.pathfinder.searches - s0, BUDGET, 'the order itself plans only the budget');
  const units = ids.map((id) => w.get(id));
  const planned = () => units.filter((u) => !u.pathPending && u.path && u.path.length > 0).length;
  assert.equal(planned(), BUDGET);
  assert.deepEqual(units.slice(0, BUDGET).map((u) => !!u.pathPending), Array(BUDGET).fill(false), 'first come, first planned');
  assert.ok(units.slice(BUDGET).every((u) => u.pathPending && u.dest), 'the rest keep their destination, route pending');
  let ticks = 0;
  while (planned() < units.length) {
    const before = w.pathfinder.searches;
    w.step();
    ticks++;
    assert.ok(w.pathfinder.searches - before <= BUDGET + 4, 'a tick never plans much past the budget'); // (+ a second search when a goal is unreachable)
    assert.ok(ticks < 10, 'every route is planned within a few ticks');
  }
  // The order and the step after it share one tick's budget: 96 routes with
  // the order, none in that step, then 96 and 58 in the next two ticks.
  assert.equal(ticks, 3);
  // Pending units wait in place, then march like everyone else.
  for (let i = 0; i < 400; i++) w.step();
  assert.ok(units.every((u) => u.x > 32 * 31), 'the whole army crossed the wall');
});

test('a small order is untouched by the budget', () => {
  const w = emptyWorld({ cols: 40, rows: 30 });
  const ids = army(w, 40);
  w.issue({ type: 'move', ids, x: tileCenter(35, 20).x, y: tileCenter(35, 20).y });
  assert.ok(ids.every((id) => !w.get(id).pathPending && w.get(id).path.length > 0));
  assert.ok(ids.every((id) => !('pathPending' in w.get(id))), 'no new field on units that never waited');
});

test('the budget is deterministic: two identical worlds stay identical', () => {
  const run = () => {
    const w = emptyWorld({ cols: 60, rows: 40, rocks: [[30, 0, 2, 30]] });
    const ids = army(w, 200);
    w.issue({ type: 'attackMove', ids, x: tileCenter(50, 30).x, y: tileCenter(50, 30).y });
    for (let i = 0; i < 200; i++) w.step();
    return ids.map((id) => { const u = w.get(id); return `${u.x},${u.y}`; }).join(';');
  };
  assert.equal(run(), run());
});

test('resetting only the nodes a search touched gives the same routes as a fresh grid', () => {
  for (const map of [undefined, FFA_MAP]) {
    const w = makeWorld(map ? { map, setup: 'ffa' } : {});
    const g = w.grid, rng = createRng(7).next;
    const pf = w.pathfinder;
    const walk = () => { for (;;) { const tx = Math.floor(rng() * g.cols), ty = Math.floor(rng() * g.rows); if (g.isWalkable(tx, ty)) return g.center(tx, ty); } };
    for (let i = 0; i < 300; i++) {
      const a = walk(), b = i % 7 === 0 ? { x: rng() * g.cols * g.tile, y: rng() * g.rows * g.tile } : walk();
      const fresh = new Pathfinder(g, PF).find(a.x, a.y, b.x, b.y);
      assert.deepEqual(pf.find(a.x, a.y, b.x, b.y), fresh, `query ${i} on ${map ? 'the free-for-all' : 'the 1v1'} map`);
    }
  }
});
