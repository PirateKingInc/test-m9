// Phase 6 free-for-all win condition (PHASE6_SPEC.md "Win condition"): last
// camp standing wins; at the time limit most zones, then score, wins; a full
// tie is a draw. Every scenario ends with a declared result, never limbo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { FFA_MAP } from '../src/data/ffa.js';
import { PF } from './helpers.js';

function ffa() {
  const w = new World({ map: FFA_MAP, seed: 5, PF, setup: 'ffa' });
  for (const u of [...w.ofKind('unit')]) w.removeEntity(u);
  return w;
}
const castle = (w, team) => [...w.ofKind('building')].find((b) => b.team === team && b.type === 'core');
const fell = (w, team, by) => { const c = castle(w, team); c.hp = 0; c.killedBy = by; };
const toLimit = (w) => { w.time = FFA_MAP.timeLimit - 0.02; w.step(); };

test('last camp standing wins, with a full ranking of every camp', () => {
  const w = ffa();
  fell(w, 3, 2); w.step();
  assert.equal(w.result, null, 'three left: no result');
  fell(w, 4, 1); w.step();
  assert.equal(w.result, null, 'two left: no result');
  fell(w, 2, 1); w.step();
  assert.equal(w.result.winner, 1);
  assert.equal(w.result.reason, 'last-standing');
  assert.deepEqual(w.result.standings.map((s) => [s.place, s.team]), [[1, 1], [2, 2], [3, 4], [4, 3]], 'the winner, then the last out first');
  assert.equal(w.result.zones[1], 4, 'the winner holds every home zone it conquered');
  assert.equal(w.issue({ type: 'stop', ids: [], team: 1 }).ok, false, 'the world is frozen');
});

test('if the last camps fall in the same tick, it is a draw', () => {
  const w = ffa();
  fell(w, 3, 2); fell(w, 4, 1); w.step();
  fell(w, 1, 2); fell(w, 2, 1); w.step();
  assert.equal(w.result.winner, null);
  assert.equal(w.result.reason, 'draw');
});

test('at the time limit the camp with the most zones wins, whatever the gold', () => {
  const w = ffa();
  w.zones.find((z) => z.id === 'c').owner = 4;
  w.zones.find((z) => z.id === 's').owner = 4;
  w.resources[2] = 99999; // the richest camp does not win on land
  toLimit(w);
  assert.equal(w.result.reason, 'time-limit');
  assert.equal(w.result.winner, 4);
  assert.deepEqual(w.result.standings.map((s) => s.team), [4, 2, 1, 3]);
});

test('at the time limit a tie on zones goes to the higher score; a tie on both is a draw', () => {
  const w = ffa();
  w.resources[3] = 1000;
  toLimit(w);
  assert.equal(w.result.winner, 3, 'equal land: the higher score wins');
  const v = ffa();
  toLimit(v);
  assert.equal(v.result.winner, null, 'four identical camps: a draw');
  assert.equal(v.result.reason, 'time-limit');
});

test('three camps alive at the time limit still get a winner (no limbo)', () => {
  const w = ffa();
  fell(w, 2, 3); w.step();
  w.zones.find((z) => z.id === 'e').owner = 1;
  toLimit(w);
  assert.equal(w.result.reason, 'time-limit');
  assert.equal(w.result.winner, 3, 'Rose conquered Crimson: two zones, the most');
  assert.equal(w.result.standings.at(-1).team, 2, 'the eliminated camp ranks last');
});

test('an idle four-camp match always reaches a declared result', () => {
  const w = ffa();
  while (!w.result) w.step();
  assert.ok(w.time <= FFA_MAP.timeLimit + 0.1);
  assert.ok(['time-limit', 'last-standing', 'draw'].includes(w.result.reason));
});
