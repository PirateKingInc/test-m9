// Phase 6 free-for-all map (PHASE6_SPEC.md "The free-for-all map").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FFA_MAP } from '../src/data/ffa.js';
import { World } from '../src/sim/world.js';
import { PF } from './helpers.js';

const N = FFA_MAP.cols;
const key = (r) => r.join(',');
const mirror = ([x, y, w, h], fx, fy) => [fx ? N - x - w : x, fy ? N - y - h : y, w, h];

test('96 x 96, four camps, 44 gold mines, 9 zones tiling the map', () => {
  assert.equal(FFA_MAP.cols, 96);
  assert.equal(FFA_MAP.rows, 96);
  assert.deepEqual(FFA_MAP.camps.map((c) => c.team), [1, 2, 3, 4]);
  assert.equal(FFA_MAP.nodes.length, 4 * 6 + 4 * 4 + 6);
  assert.equal(FFA_MAP.zones.length, 9);
  const cover = new Map();
  for (const z of FFA_MAP.zones) {
    const [x, y, w, h] = z.rect;
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) cover.set(`${tx},${ty}`, (cover.get(`${tx},${ty}`) || 0) + 1);
  }
  assert.equal(cover.size, N * N, 'every tile is in a zone');
  assert.ok([...cover.values()].every((n) => n === 1), 'no tile is in two zones');
  assert.deepEqual(FFA_MAP.zones.filter((z) => z.home).map((z) => z.home).sort(), [1, 2, 3, 4]);
});

test('the map is mirror-symmetric in both axes', () => {
  const S = 2; // node size
  for (const [fx, fy] of [[true, false], [false, true], [true, true]]) {
    const rocks = new Set(FFA_MAP.rocks.map(key));
    for (const r of FFA_MAP.rocks) assert.ok(rocks.has(key(mirror(r, fx, fy))), `rock ${r} has its mirror`);
    const nodes = new Set(FFA_MAP.nodes.map(([x, y]) => `${x},${y}`));
    for (const [x, y] of FFA_MAP.nodes) {
      const [mx, my] = mirror([x, y, S, S], fx, fy);
      assert.ok(nodes.has(`${mx},${my}`), `mine (${x},${y}) has its mirror`);
    }
    const cores = new Set(FFA_MAP.camps.map((c) => `${c.core}`));
    for (const c of FFA_MAP.camps) assert.ok(cores.has(`${mirror([...c.core, 4, 4], fx, fy).slice(0, 2)}`), `camp ${c.team} has its mirror`);
  }
});

test('nothing overlaps: mines, rocks and Castles each have their own tiles', () => {
  const used = new Map();
  const claim = (what, [x, y, w, h]) => {
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) {
      const k = `${tx},${ty}`;
      if (used.has(k) && !(used.get(k).startsWith('rock') && what.startsWith('rock'))) assert.fail(`${what} overlaps ${used.get(k)} at ${k}`);
      assert.ok(tx >= 0 && ty >= 0 && tx < N && ty < N, `${what} inside the map`);
      used.set(k, what);
    }
  };
  FFA_MAP.rocks.forEach((r, i) => claim(`rock ${i}`, r));
  FFA_MAP.nodes.forEach(([x, y]) => claim(`mine ${x},${y}`, [x, y, 2, 2]));
  for (const c of FFA_MAP.camps) {
    claim(`castle ${c.team}`, [...c.core, 4, 4]);
    for (const [x, y] of c.drones) claim(`peasant of ${c.team}`, [x, y, 1, 1]);
  }
});

test('each camp sits in its own home zone with its six mines; each neutral zone holds its field', () => {
  const inRect = ([x, y], [rx, ry, rw, rh]) => x >= rx && y >= ry && x < rx + rw && y < ry + rh;
  for (const c of FFA_MAP.camps) {
    const z = FFA_MAP.zones.find((q) => q.home === c.team);
    assert.ok(inRect(c.core, z.rect) && inRect([c.core[0] + 3, c.core[1] + 3], z.rect), `camp ${c.team}'s Castle in its zone`);
    for (const n of c.nodes) assert.ok(inRect(n, z.rect) && inRect([n[0] + 1, n[1] + 1], z.rect), `camp ${c.team}'s mines in its zone`);
  }
  for (const z of FFA_MAP.zones.filter((q) => q.field)) {
    const mines = FFA_MAP.nodes.filter((n) => inRect(n, z.rect));
    assert.equal(mines.length, z.id === 'c' ? 6 : 4, `${z.id} field`);
  }
});

test("World({ setup: 'ffa' }) sets up four camps, and every camp can reach every other and every mine", () => {
  const w = new World({ map: FFA_MAP, seed: 1, PF, setup: 'ffa' });
  assert.deepEqual(w.teams, [1, 2, 3, 4]);
  assert.equal(w.mode, 'ffa');
  const cores = [...w.ofKind('building')].filter((b) => b.type === 'core');
  assert.deepEqual(cores.map((b) => b.team), [1, 2, 3, 4]);
  for (const t of w.teams) {
    assert.equal(w.resources[t], FFA_MAP.startingLumen);
    assert.equal([...w.ofKind('unit')].filter((u) => u.team === t && u.type === 'drone').length, 4);
  }
  const T = w.grid.tile;
  for (const a of cores) {
    const from = { x: a.x + 3 * T, y: a.y + 3 * T };
    for (const b of cores) if (b !== a) {
      const path = w.pathfinder.find(from.x, from.y, b.x, b.y + 3 * T);
      const end = path[path.length - 1];
      assert.ok(Math.hypot(end.x - b.x, end.y - (b.y + 3 * T)) < 2 * T, `camp ${a.team} reaches camp ${b.team}`);
    }
    for (const n of w.ofKind('node')) {
      const path = w.pathfinder.find(from.x, from.y, n.x, n.y);
      const end = path[path.length - 1];
      assert.ok(Math.hypot(end.x - n.x, end.y - n.y) < 3 * T, `camp ${a.team} reaches the mine at ${n.tx},${n.ty}`);
    }
  }
});
