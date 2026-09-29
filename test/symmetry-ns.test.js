// Phase 8 pathfinding symmetry (PHASE8_SPEC.md "Pathfinding symmetry"): the
// free-for-all map is mirrored north-south as well as east-west, so every
// tie-break must be mirrored in y too. Phase 3's side-bias fixes
// (test/sidebias.test.js) covered only the east-west mirror.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PF, makeWorld } from './helpers.js';
import { World } from '../src/sim/world.js';
import { FFA_MAP } from '../src/data/ffa.js';
import { adjacentTile } from '../src/sim/movement.js';
import { trace } from '../tools/mirror-trace.mjs';
import { roundTrip } from './travel.js';

const ffa = () => new World({ map: FFA_MAP, seed: 1, PF, setup: 'ffa' });
const N = FFA_MAP.cols; // 96 x 96

test('only maps mirrored north-south get the north-south tie-breaks (the 1v1 map keeps Phase 3\'s)', () => {
  assert.equal(ffa().grid.mirrorY, true);
  assert.equal(makeWorld({ setup: 'match' }).grid.mirrorY, false);
});

test('grid spiral order in the south half is the vertical mirror image of the north half', () => {
  const g = ffa().grid;
  for (const [tx, ty] of [[10, 20], [14, 33], [20, 5], [40, 40], [60, 12], [5, 45]]) {
    const north = [...g.spiral(tx, ty, 6)];
    const south = [...g.spiral(tx, N - 1 - ty, 6)].map((t) => ({ tx: t.tx, ty: N - 1 - t.ty }));
    assert.deepEqual(south, north, `spiral around ${tx},${ty}`);
  }
});

test('pathfinding is equivariant under both mirrors and their composition', () => {
  const w = ffa(), W = w.width, H = w.height, T = w.grid.tile;
  let found = 0;
  for (let i = 0; i < 40; i++) {
    const c = (tx, ty) => [(tx + 0.5) * T, (ty + 0.5) * T];
    const [x0, y0] = c((i * 7) % 90 + 3, (i * 11) % 90 + 3), [x1, y1] = c((i * 13) % 90 + 3, (i * 17) % 90 + 3);
    const p = w.pathfinder.find(x0, y0, x1, y1);
    for (const [fx, fy, name] of [[false, true, 'north-south'], [true, false, 'east-west'], [true, true, 'both']]) {
      const mx = (v) => (fx ? W - v : v), my = (v) => (fy ? H - v : v);
      const q = w.pathfinder.find(mx(x0), my(y0), mx(x1), my(y1));
      assert.equal(!!q, !!p, `${name}: both or neither path exists (${i})`);
      if (p) assert.deepEqual(q.map((pt) => ({ x: mx(pt.x), y: my(pt.y) })), p, `${name} mirror of path ${i}`);
    }
    if (p) found++;
  }
  assert.ok(found >= 30, `${found} of 40 sample paths exist`);
});

test('the approach tile beside a gold mine or building is the mirror image for mirrored camps', () => {
  const w = ffa(), W = w.width, H = w.height;
  const nodes = [...w.ofKind('node')];
  // Each NW home mine has twins in the other corners; a Peasant beside the NW
  // Castle and its mirror images pick mirror-image tiles, ties included.
  for (const n of nodes.filter((q) => q.x < W / 2 && q.y < H / 2)) {
    const twin = (fx, fy) => nodes.find((q) => q.x === (fx ? W - n.x : n.x) && q.y === (fy ? H - n.y : n.y));
    const from = { x: 432, y: 464 };
    const a = adjacentTile(w, n, from.x, from.y);
    for (const [fx, fy] of [[false, true], [true, false], [true, true]]) {
      const b = adjacentTile(w, twin(fx, fy), fx ? W - from.x : from.x, fy ? H - from.y : from.y);
      assert.deepEqual({ x: fx ? W - b.x : b.x, y: fy ? H - b.y : b.y }, a, `mine at ${n.x},${n.y} mirrored ${fx}/${fy}`);
    }
  }
});

test('units trained without a rally point spawn at mirror-image positions in all four corners', () => {
  const w = ffa(), W = w.width, H = w.height;
  for (const t of [1, 2, 3, 4]) w.resources[t] = 1000;
  const cores = [1, 2, 3, 4].map((t) => [...w.ofKind('building')].find((b) => b.team === t && b.type === 'core'));
  for (const c of cores) w.issue({ type: 'train', team: c.team, building: c.id, unit: 'drone' });
  const before = new Set([...w.ofKind('unit')].map((u) => u.id));
  for (let i = 0; i < 20 * 11; i++) w.step();
  const fresh = Object.fromEntries([1, 2, 3, 4].map((t) => [t, [...w.ofKind('unit')].find((u) => u.team === t && !before.has(u.id))]));
  const near = (p, q) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
  assert.ok(near({ x: fresh[2].x, y: fresh[2].y }, { x: W - fresh[1].x, y: fresh[1].y }), 'NE mirrors NW');
  assert.ok(near({ x: fresh[4].x, y: fresh[4].y }, { x: fresh[1].x, y: H - fresh[1].y }), 'SW mirrors NW');
  assert.ok(near({ x: fresh[3].x, y: fresh[3].y }, { x: W - fresh[1].x, y: H - fresh[1].y }), 'SE mirrors NW');
});

// Every camp on the same script, timing jitter off, no scout: a camp and its
// mirror twin stay mirror-exact. Before the fix the north-south pairs diverged
// at 0.1 s (the first Peasant's approach tile); they now hold as long as the
// east-west pairs Phase 3 fixed (until crowd float rounding, after 90 s).
for (const strategy of ['rush', 'boom', 'turtle']) {
  test(`${strategy}: all four camps stay mirror-exact for the first 90 s`, () => {
    assert.deepEqual(trace({ strategy, seconds: 90, stopAtFirst: true }), {});
  });
}

test('diagonal marches take the same time from the north and from the south', () => {
  // Before the fix a march that started in the south took a different A*
  // route: 0.7-0.8 s slower than its north-starting mirror twin.
  const nw = roundTrip(1, 3).there, sw = roundTrip(4, 2).there, ne = roundTrip(2, 4).there, se = roundTrip(3, 1).there;
  assert.ok(Math.abs(nw - sw) < 0.05, `NW->SE ${nw} vs SW->NE ${sw}`);
  assert.ok(Math.abs(ne - se) < 0.05, `NE->SW ${ne} vs SE->NW ${se}`);
});
