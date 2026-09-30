// Phase 10 verification (d): starting a multiplayer free-for-all with fewer
// than 4 humans gives the empty camps to the existing AI strategies, through
// the unchanged Match (PHASE10_SPEC.md "AI fill-in").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PF } from './helpers.js';
import { Match } from '../src/ai/match.js';
import { FFA_MAP, FFA_STRATEGIES } from '../src/data/ffa.js';
import { DIFFICULTY } from '../src/data/difficulty.js';
import { lineupOf, campsFor, humansIn } from '../src/net/lineup.js';

test('the lineup follows the occupied slots: slot n plays camp n', () => {
  assert.equal(lineupOf({ 1: { name: 'A' } }), 'HAAA');
  assert.equal(lineupOf({ 1: {}, 3: {} }), 'HAHA');
  assert.equal(lineupOf({ 1: {}, 2: {}, 3: {}, 4: {} }), 'HHHH');
  assert.equal(humansIn('HHAH'), 3);
});

test('one human is exactly single-player: the same camps table src/game/main.js builds', () => {
  const single = Object.fromEntries(Object.entries(FFA_STRATEGIES).map(([team, s]) => [team, { strategy: s, difficulty: 'hard' }]));
  assert.deepEqual(campsFor('HAAA', 'hard'), single);
});

for (const lineup of ['HHAA', 'HAHA', 'HAAH', 'HHHA', 'HHAH', 'HAHH', 'HHHH']) {
  test(`${lineup}: AI brains on exactly the empty camps, with the single-player strategies`, () => {
    const m = new Match({ seed: 5, PF, ffa: { map: FFA_MAP, camps: campsFor(lineup, 'normal') } });
    const ai = [...lineup].map((c, i) => (c === 'A' ? i + 1 : null)).filter(Boolean);
    assert.deepEqual(m.brains.map((b) => b.team), ai);
    for (const b of m.brains) {
      assert.equal(b.strategyId, FFA_STRATEGIES[b.team], `camp ${b.team} plays its single-player script`);
      assert.equal(b.d, DIFFICULTY.normal, 'at the difficulty the host chose');
    }
    m.run(60); // the match runs; human camps simply wait for their players
    for (const t of [1, 2, 3, 4]) assert.ok([...m.world.ofKind('building')].some((x) => x.team === t && x.type === 'core'), `camp ${t} is on the map`);
    const trained = (t) => [...m.world.ofKind('unit')].filter((u) => u.team === t).length;
    for (const t of ai) assert.ok(trained(t) > 5, `AI camp ${t} is playing`);
  });
}
