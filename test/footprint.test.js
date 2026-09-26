// Phase 5 zoom range: re-measure a fully built home base (every building near
// the Core plus the home gold mines) and check it stays inside BASE_FOOTPRINT,
// the box the minimum zoom was chosen to fit (PHASE5_SPEC.md "Zoom range").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PF } from './helpers.js';
import { Match } from '../src/ai/match.js';
import { MAP } from '../src/data/map.js';
import { BASE_FOOTPRINT } from '../src/game/camera.js';

// World-px box [l, t, r, b] of team 2's home base.
export function homeBase(world, team = 2) {
  const T = world.grid.tile;
  const core = [...world.ofKind('building')].find((b) => b.team === team && b.type === 'core');
  const near = (x, y) => Math.hypot(x - core.x, y - core.y) < 14 * T * 1.2;
  const rects = [...world.ofKind('building')].filter((b) => b.team === team && near(b.x, b.y))
    .map((b) => [b.x - b.pw / 2, b.y - b.ph / 2, b.x + b.pw / 2, b.y + b.ph / 2]);
  const mines = MAP.nodes.filter(([x, y]) => near((x + 1) * T, (y + 1) * T)).map(([x, y]) => [x * T, y * T, (x + 2) * T, (y + 2) * T]);
  const all = [...rects, ...mines];
  return [Math.min(...all.map((r) => r[0])), Math.min(...all.map((r) => r[1])), Math.max(...all.map((r) => r[2])), Math.max(...all.map((r) => r[3]))];
}

test('a fully built home base fits BASE_FOOTPRINT, for every AI strategy', () => {
  for (const strategy of ['boom', 'turtle', 'rush']) {
    const m = new Match({ seed: 2, PF, ai: { strategy, difficulty: 'hard' }, player: { strategy: 'sentinel', difficulty: 'hard' } });
    while (m.world.time < 600 && !m.world.result) m.step();
    const [l, t, r, b] = homeBase(m.world);
    const n = [...m.world.ofKind('building')].filter((x) => x.team === 2).length;
    assert.ok(n >= 8, `${strategy} built a full base (${n} buildings)`);
    assert.ok(r - l <= BASE_FOOTPRINT.w && b - t <= BASE_FOOTPRINT.h, `${strategy}: ${r - l} x ${b - t} fits ${BASE_FOOTPRINT.w} x ${BASE_FOOTPRINT.h}`);
  }
});
