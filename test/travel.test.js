// Phase 6 camp spacing (PHASE6_SPEC.md "Spacing, measured by travel time"):
// a full army's round trip between the two closest camps must leave its own
// base open for many times as long as an undefended Castle survives a raid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundTrip, castleKillTime } from './travel.js';

test('camp spacing: the nearest round trip is long enough to make attacking a real risk', () => {
  const pairs = { 'NW-SW': roundTrip(1, 4), 'NE-SE': roundTrip(2, 3), 'NW-NE': roundTrip(1, 2), 'NW-SE': roundTrip(1, 3) };
  const kill = castleKillTime();
  const report = Object.entries(pairs).map(([k, r]) => `${k} ${r.roundTrip.toFixed(1)} s (${r.pathTiles.toFixed(0)} tiles)`).join(', ');
  console.log(`# round trips: ${report}; undefended Castle vs a 14-unit raid: ${kill.toFixed(1)} s`);
  for (const [k, r] of Object.entries(pairs)) assert.ok(r.there < 300 && r.back < 300, `${k}: the army arrives (no unit stuck)`);
  // Symmetry: every camp's nearest neighbour is the same distance away.
  assert.ok(Math.abs(pairs['NW-SW'].roundTrip - pairs['NE-SE'].roundTrip) < 3, 'mirror pairs match');
  const nearest = Math.min(...Object.values(pairs).map((r) => r.roundTrip));
  assert.equal(nearest, Math.min(pairs['NW-SW'].roundTrip, pairs['NE-SE'].roundTrip), 'the vertical neighbours are the closest');
  // The risk window: away for at least 5 Castle lifetimes, and each leg alone
  // longer than a raid needs; but not so far that a match is all walking.
  assert.ok(nearest >= 5 * kill, `nearest round trip ${nearest.toFixed(1)} s >= 5 x ${kill.toFixed(1)} s`);
  assert.ok(pairs['NW-SW'].there > 3 * kill, 'one leg outlasts a raid several times over');
  assert.ok(nearest <= 120, 'but under two minutes: fights happen');
});
