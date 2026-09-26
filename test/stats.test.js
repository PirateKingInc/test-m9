// Result-screen statistics are tallied correctly from the event stream.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PF } from './helpers.js';
import { Match } from '../src/ai/match.js';
import { MatchStats } from '../src/game/stats.js';

test('match stats add up: units, losses, kills and Lumen balance for both teams', () => {
  const m = new Match({ seed: 4, PF, ai: { strategy: 'rush', difficulty: 'hard' }, player: { strategy: 'boom', difficulty: 'hard' } });
  const stats = new MatchStats();
  const start = { 1: 0, 2: 0 };
  for (const u of m.world.ofKind('unit')) start[u.team]++;
  while (!m.world.result) { m.step(); stats.add(m.world.drainEvents()); }
  const t = stats.teams;
  for (const team of [1, 2]) {
    const alive = [...m.world.ofKind('unit')].filter((u) => u.team === team).length;
    assert.equal(start[team] + t[team].trained, alive + t[team].unitsLost, `team ${team}: units in = units out`);
    assert.ok(t[team].lumen > 1000, `team ${team} gathered ${t[team].lumen}`);
  }
  // Every death was caused by the other team, so kills mirror losses.
  assert.equal(t[1].kills, t[2].unitsLost + t[2].buildingsLost);
  assert.equal(t[2].kills, t[1].unitsLost + t[1].buildingsLost);
  const rows = stats.rows(1, 2);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[0], ['Gold gathered', t[1].lumen, t[2].lumen]);
});
