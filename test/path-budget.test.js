// Phase 12 pathfinding at scale (PHASE12_SPEC.md "Part A"): the per-tick
// route-search budget, and the pathfinder's cheaper reset and clearance
// check, which must give exactly the routes the full reset gave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PF, makeWorld, emptyWorld, tileCenter } from './helpers.js';
import { Pathfinder } from '../src/sim/pathfinder.js';
import { createRng } from '../src/sim/rng.js';
import { FFA_MAP } from '../src/data/ffa.js';
import { PATHING } from '../src/data/scale.js';
import { SUPPLY } from '../src/data/buildings.js';
import { World } from '../src/sim/world.js';
import { setCap, fillArmies } from '../tools/scale-scenario.js';

const BUDGET = PATHING.workPerTick;

function army(w, n) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const c = tileCenter(1 + (i % 10), 1 + Math.floor(i / 10));
    ids.push(w.addUnit('striker', 1, c.x, c.y).id);
  }
  return ids;
}

test('an order to a full-cap army plans routes up to the work budget a tick; the rest follow in unit order, within 0.5 s', () => {
  setCap(SUPPLY.max);
  const w = new World({ seed: 1, PF, setup: 'match' });
  fillArmies(w, SUPPLY.max, 'swarm'); // the 1v1's worst case: every soldier 1 supply
  const pf = w.pathfinder, enemy = [...w.ofKind('building')].find((b) => b.type === 'core' && b.team === 2);
  const units = [...w.ofKind('unit')].filter((u) => u.team === 1 && u.type !== 'drone');
  const w0 = pf.work, s0 = pf.searches;
  w.issue({ type: 'attackMove', ids: units.map((u) => u.id), x: enemy.x, y: enemy.y, team: 1 });
  const perSearch = (pf.work - w0) / (pf.searches - s0);
  assert.ok(pf.work - w0 >= BUDGET && pf.work - w0 < BUDGET + 2 * perSearch, `the order stopped planning at the budget (${pf.work - w0} nodes)`);
  const planned = () => units.filter((u) => !u.pathPending && u.path && u.path.length > 0).length;
  const first = planned();
  assert.ok(first > 0 && first < units.length, `${first} of ${units.length} routes planned with the order`);
  assert.deepEqual(units.map((u) => !!u.pathPending), units.map((_, i) => i >= first), 'first come, first planned');
  assert.ok(units.every((u) => u.dest), 'the rest keep their destination, route pending');
  let ticks = 0;
  while (planned() < units.length) {
    const before = pf.work;
    w.step();
    ticks++;
    assert.ok(pf.work - before < BUDGET + 2 * perSearch, 'a tick never plans much past the budget');
  }
  assert.ok(ticks <= 10, `every route planned within 0.5 s (${ticks} ticks)`);
  // Pending units waited in place, then march like everyone else.
  for (let i = 0; i < 400; i++) w.step();
  assert.ok(units.every((u) => u.hp <= 0 || u.x > 40 * 32), 'the whole army is past the west ridge');
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
