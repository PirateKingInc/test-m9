// Phase 6 team model: any number of teams, each an enemy of every other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorld, runUntil } from './helpers.js';
import { AiEngine } from '../src/ai/engine.js';

// Three teams on an open map, as a free-for-all would have them.
function threeTeams() {
  const w = emptyWorld({ cols: 40, rows: 30 });
  const camps = [1, 2, 3].map((team, i) => ({ team, core: [2 + i * 14, 2], drones: [] }));
  w.camps = camps;
  w.teams = [1, 2, 3];
  for (const c of camps) w.resources[c.team] = 0;
  return w;
}

test('combat treats every other team as an enemy, whatever the team count', () => {
  const w = threeTeams();
  const T = 32;
  // A Striker of each team in a tight triangle: all three fight until one is left.
  const a = w.addUnit('striker', 1, 20 * T, 15 * T), b = w.addUnit('striker', 2, 21 * T, 15 * T), c = w.addUnit('striker', 3, 20.5 * T, 16 * T);
  runUntil(w, () => [a, b, c].filter((u) => w.get(u.id)).length <= 1, 60);
  const alive = [a, b, c].filter((u) => w.get(u.id));
  assert.equal(alive.length, 1, 'one survivor of a three-way fight');
  const hitTeams = new Set();
  for (const u of [a, b, c]) if (u.lastHit != null) hitTeams.add(u.team);
  assert.ok(hitTeams.size >= 2, 'more than one team took hits');
});

test('the AI sees every other team as a rival; the Phase 6 placeholder rule (targeting: nearest) picks the nearest living camp', () => {
  const w = threeTeams();
  for (const c of w.camps) w.addBuilding('core', c.team, c.core[0], c.core[1], { built: true });
  const ai = new AiEngine(w, { team: 1, strategy: 'rush', difficulty: 'hard', targeting: 'nearest' });
  assert.equal(ai.isEnemyTeam(2), true);
  assert.equal(ai.isEnemyTeam(3), true);
  assert.equal(ai.isEnemyTeam(1), false);
  assert.equal(ai.isEnemyTeam(undefined), false, 'gold mines have no team');
  assert.equal(ai.targetCamp().team, 2, 'team 2 is nearer than team 3');
  // Team 2's Castle falls: the AI moves on to the next nearest living camp.
  w.removeEntity([...w.ofKind('building')].find((b) => b.team === 2));
  assert.equal(ai.targetCamp().team, 3);
});
