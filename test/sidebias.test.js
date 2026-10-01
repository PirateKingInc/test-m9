// Phase 3 side-bias regression: the map is a mirror image, so every tie-break
// (spiral order, A* ties, spawn side, head-on steering) must be mirrored too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PF, makeWorld } from './helpers.js';
import { Match } from '../src/ai/match.js';
import { STRATEGIES } from '../src/data/strategies.js';
import { DIFFICULTY } from '../src/data/difficulty.js';
import { MAP } from '../src/data/map.js';

const COLS = MAP.cols;

test('grid spiral order in the east half is the mirror image of the west half', () => {
  const w = makeWorld({ setup: 'match' });
  const g = w.grid;
  for (const [tx, ty] of [[10, 20], [14, 33], [20, 5], [30, 40], [5, 52]]) {
    const west = [...g.spiral(tx, ty, 6)];
    const east = [...g.spiral(COLS - 1 - tx, ty, 6)].map((t) => ({ tx: COLS - 1 - t.tx, ty: t.ty }));
    assert.deepEqual(east, west, `spiral around ${tx},${ty}`);
  }
});

test('pathfinding is mirror-equivariant: an east path is the mirror of the west path', () => {
  const w = makeWorld({ setup: 'match' });
  const W = w.width, T = w.grid.tile;
  const pairs = [];
  for (let i = 0; i < 40; i++) pairs.push([[(i * 7) % 38 + 1, (i * 11) % 55 + 2], [(i * 13) % 38 + 1, (i * 17) % 55 + 2]]);
  let found = 0;
  for (const [[sx, sy], [gx, gy]] of pairs) {
    const c = (tx, ty) => [(tx + 0.5) * T, (ty + 0.5) * T];
    const [x0, y0] = c(sx, sy), [x1, y1] = c(gx, gy);
    const west = w.pathfinder.find(x0, y0, x1, y1);
    const east = w.pathfinder.find(W - x0, y0, W - x1, y1);
    assert.equal(!!east, !!west, `both or neither path exists for ${sx},${sy} -> ${gx},${gy}`);
    if (!west) continue;
    found++;
    assert.deepEqual(east.map((p) => ({ x: W - p.x, y: p.y })), west, `path ${sx},${sy} -> ${gx},${gy}`);
  }
  assert.ok(found >= 30, `${found} of 40 sample paths exist`);
});

test('units trained without a rally point spawn at mirror-image positions', () => {
  const w = makeWorld({ setup: 'match' });
  for (const team of [1, 2]) w.resources[team] = 1000;
  const cores = [1, 2].map((t) => [...w.ofKind('building')].find((b) => b.team === t && b.type === 'core'));
  for (const c of cores) w.issue({ type: 'train', team: c.team, building: c.id, unit: 'drone' });
  const before = new Set([...w.ofKind('unit')].map((u) => u.id));
  for (let i = 0; i < 20 * 11; i++) w.step();
  const fresh = [...w.ofKind('unit')].filter((u) => !before.has(u.id));
  assert.equal(fresh.length, 2);
  const [a, b] = [1, 2].map((t) => fresh.find((u) => u.team === t));
  assert.ok(Math.abs(w.width - b.x - a.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6, `west ${a.x},${a.y} vs east ${b.x},${b.y}`);
});

// With timing jitter off and no scout (whose head-on meeting at mid-map is an
// inherently symmetric tie), a mirror match stays an exact mirror image until
// float rounding creeps in. Before the Phase 3 fixes it diverged at ~10 s.
for (const strat of ['rush', 'boom', 'turtle']) {
  test(`${strat} mirror match stays mirror-exact for the first 90 s`, () => {
    const diff = { ...DIFFICULTY.hard, jitter: 0 };
    const s = { ...STRATEGIES[strat], scoutAt: null };
    const m = new Match({ seed: 1, PF, ai: { strategy: s, difficulty: diff }, player: { strategy: s, difficulty: diff } });
    const W = m.world.width;
    const snap = (team) => ({
      lumen: m.world.resources[team],
      units: [...m.world.ofKind('unit')].filter((u) => u.team === team)
        .map((u) => ({ t: u.type, x: team === 2 ? W - u.x : u.x, y: u.y })),
      buildings: [...m.world.ofKind('building')].filter((b) => b.team === team)
        .map((b) => `${b.type}@${team === 2 ? COLS - b.tx - b.w : b.tx},${b.ty}:${b.progress.toFixed(3)}`).sort(),
    });
    while (m.world.time < 90) {
      m.step();
      if (m.world.tick % 20) continue;
      const a = snap(1), b = snap(2);
      const at = `t=${m.world.time.toFixed(1)}s`;
      assert.equal(b.lumen, a.lumen, `lumen at ${at}`);
      assert.deepEqual(b.buildings, a.buildings, `buildings at ${at}`);
      assert.equal(b.units.length, a.units.length, `unit count at ${at}`);
      const used = new Set();
      for (const u of a.units) {
        const j = b.units.findIndex((v, i) => !used.has(i) && v.t === u.t && Math.abs(v.x - u.x) < 0.05 && Math.abs(v.y - u.y) < 0.05);
        assert.ok(j >= 0, `${u.t} at ${u.x.toFixed(2)},${u.y.toFixed(2)} has no mirror at ${at}`);
        used.add(j);
      }
    }
  });
}
