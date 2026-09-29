// Phase 6 elimination, capture and loot (PHASE6_SPEC.md): the camp that lands
// the killing blow on a camp's last Castle gets exactly its banked gold and
// every zone it owned; nobody else gains or loses anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { FFA_MAP } from '../src/data/ffa.js';
import { zonesOf } from '../src/sim/territory.js';
import { PF } from './helpers.js';

const T = FFA_MAP.tile;
function ffa() {
  const w = new World({ map: FFA_MAP, seed: 3, PF, setup: 'ffa' });
  for (const u of [...w.ofKind('unit')]) w.removeEntity(u); // no income, no spending
  return w;
}
const castle = (w, team) => [...w.ofKind('building')].find((b) => b.team === team && b.type === 'core');
const snapshot = (w) => Object.fromEntries(w.teams.map((t) => [t, { gold: w.resources[t], zones: zonesOf(w, t).map((z) => z.id).sort() }]));
// Run until `team` is eliminated (or a limit), returning the elimination record.
function untilEliminated(w, team, max = 120) {
  const end = w.time + max;
  while (w.time < end && !(w.eliminated || []).some((e) => e.team === team)) w.step();
  return (w.eliminated || []).find((e) => e.team === team);
}

test('eliminating a camp with X gold and Y zones gives the conqueror exactly +X gold and +Y zones, and nobody else anything', () => {
  const w = ffa();
  // Rose (3) banks 777 gold and owns its home plus the East and South fields: Y = 3.
  w.resources[3] = 777;
  for (const id of ['e', 's']) w.zones.find((z) => z.id === id).owner = 3;
  w.zones.find((z) => z.id === 'n').owner = 1; // other camps own land too
  w.resources[1] = 1234; w.resources[2] = 500; w.resources[4] = 42;
  const before = snapshot(w);
  const X = before[3].gold, Y = before[3].zones.length;
  assert.deepEqual([X, Y], [777, 3]);
  // Jade (4) wounds Rose's Castle; Crimson (2) lands the killing blow.
  const c = castle(w, 3);
  c.hp = 60;
  const jade = w.addUnit('sparker', 4, c.x - 5 * T, c.y);
  w.issue({ type: 'attack', ids: [jade.id], target: c.id, team: 4 });
  while (c.hp > 30) w.step();
  w.removeEntity(jade);
  const raiders = [0, 1, 2].map((i) => w.addUnit('striker', 2, c.x - 3 * T, c.y + (i - 1) * 24));
  w.issue({ type: 'attack', ids: raiders.map((u) => u.id), target: c.id, team: 2 });
  const rec = untilEliminated(w, 3);
  assert.ok(rec, 'Rose is eliminated');
  assert.equal(rec.by, 2, "the killing blow was Crimson's");
  const after = snapshot(w);
  assert.equal(after[2].gold, before[2].gold + X, 'conqueror: exactly +X gold');
  assert.deepEqual(after[2].zones, [...before[2].zones, ...before[3].zones].sort(), 'conqueror: exactly +Y zones');
  assert.equal(after[3].gold, 0);
  assert.deepEqual(after[3].zones, []);
  for (const t of [1, 4]) assert.deepEqual(after[t], before[t], `camp ${t} untouched`);
  assert.equal([...w.entities.values()].filter((e) => e.team === 3).length, 0, "the eliminated camp's units and buildings are razed");
  assert.deepEqual([rec.gold, rec.zones.sort()], [X, before[3].zones]);
  assert.equal(w.result, null, 'three camps left: the match goes on');
});

test('if the conqueror falls in the same tick, the gold is lost and the zones go neutral', () => {
  const w = ffa();
  w.resources[3] = 300; w.resources[2] = 200;
  w.zones.find((z) => z.id === 'e').owner = 3;
  const c3 = castle(w, 3), c2 = castle(w, 2);
  c3.hp = 0; c3.killedBy = 2; // Crimson kills Rose's Castle...
  c2.hp = 0; c2.killedBy = 4; // ...while Jade kills Crimson's in the same tick
  w.step();
  const r3 = w.eliminated.find((e) => e.team === 3), r2 = w.eliminated.find((e) => e.team === 2);
  assert.equal(r3.by, null, "Rose's conqueror was eliminated too");
  assert.equal(r2.by, 4);
  assert.deepEqual(zonesOf(w, 4).map((z) => z.id).sort(), ['ne', 'sw'], "Jade takes Crimson's home, not Rose's land");
  assert.equal(w.zones.find((z) => z.id === 'e').owner, null);
  assert.equal(w.zones.find((z) => z.id === 'se').owner, null);
  assert.equal(w.resources[4], 250 + 200, "Jade gets Crimson's gold only");
});

test('the 1v1 match never runs elimination: losing the Castle simply ends it', () => {
  const w = new World({ seed: 1, PF, setup: 'match' });
  const c = castle(w, 2);
  c.hp = 0; c.killedBy = 1;
  w.step();
  assert.equal(w.eliminated, undefined);
  assert.equal(w.result.winner, 1);
  assert.equal(w.result.reason, 'core-destroyed');
  assert.equal(w.resources[1], 250, 'no loot in the 1v1 match');
});
