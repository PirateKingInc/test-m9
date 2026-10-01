// Phase 12 verification (PHASE12_SPEC.md): whole matches at the new cap and
// map size, played to the 30:00 time limit by the economy script (it never
// attacks, so it is the camp that fills the cap), in the 1v1 and the
// four-camp free-for-all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PF } from './helpers.js';
import { Match } from '../src/ai/match.js';
import { FFA_MAP } from '../src/data/ffa.js';
import { SUPPLY, BUILDINGS } from '../src/data/buildings.js';
import { supplyOf } from '../src/sim/supply.js';

const SECONDS = 1800;

function toEnd(m, teams) {
  const peak = Object.fromEntries(teams.map((t) => [t, 0]));
  while (!m.world.result) {
    m.step();
    if (m.world.tick % 100 === 0) for (const t of teams) peak[t] = Math.max(peak[t], supplyOf(m.world, t).used);
  }
  return peak;
}

test('1v1 at cap 100 on the 100 x 75 map: an economy fills the cap and the match ends at 30:00 on score', () => {
  assert.equal(SUPPLY.max, 100);
  const m = new Match({ seed: 7, PF, player: { strategy: 'sentinel', difficulty: 'hard' }, ai: { strategy: 'sentinel', difficulty: 'hard' } });
  assert.deepEqual([m.world.grid.cols, m.world.grid.rows], [100, 75]);
  const peak = toEnd(m, [1, 2]);
  const r = m.world.result;
  assert.equal(r.reason, 'time-limit');
  assert.ok(Math.abs(r.time - SECONDS) < 0.1, `ended at ${r.time}`);
  for (const t of [1, 2]) {
    assert.ok(peak[t] >= 0.9 * SUPPLY.max && peak[t] <= SUPPLY.max, `camp ${t} peaked at ${peak[t]} supply`);
    const depots = [...m.world.ofKind('building')].filter((b) => b.team === t && b.type === 'depot' && b.built).length;
    assert.ok(BUILDINGS.core.supply + depots * BUILDINGS.depot.supply >= peak[t], `${depots} Storehouses house it`);
  }
  console.log(`# 1v1 to 30:00: peak supply ${peak[1]} / ${peak[2]}, scores ${JSON.stringify(r.scores)}`);
});

test('four-camp free-for-all at cap 100 on the 120 x 120 map plays to the 30:00 time limit and ranks the camps', () => {
  const camps = { 2: { strategy: 'sentinel', difficulty: 'hard' }, 3: { strategy: 'sentinel', difficulty: 'hard' }, 4: { strategy: 'sentinel', difficulty: 'hard' } };
  const m = new Match({ seed: 3, PF, ffa: { map: FFA_MAP, camps }, player: { strategy: 'sentinel', difficulty: 'hard' } });
  assert.deepEqual([m.world.grid.cols, m.world.grid.rows], [120, 120]);
  const peak = toEnd(m, [1, 2, 3, 4]);
  const r = m.world.result;
  assert.equal(r.reason, 'time-limit');
  assert.equal(r.standings.length, 4);
  for (const t of [1, 2, 3, 4]) assert.ok(peak[t] >= 0.9 * SUPPLY.max && peak[t] <= SUPPLY.max, `camp ${t} peaked at ${peak[t]} supply`);
  // Mirror-symmetric camps running the same script field the same army.
  assert.equal(new Set(Object.values(peak)).size, 1, `peaks ${JSON.stringify(peak)}`);
  console.log(`# free-for-all to 30:00: peak supply ${JSON.stringify(peak)}, ${r.standings.length} camps ranked, winner ${r.winner}`);
});
