// Phase 9 auto-defend (PHASE9_SPEC.md "Part A"): idle combat units in a zone
// their camp owns engage hostile units in it, never override an order, never
// get pulled in from elsewhere, and walk back to their post afterwards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PF } from './helpers.js';
import { World } from '../src/sim/world.js';
import { FFA_MAP } from '../src/data/ffa.js';
import { COMBAT } from '../src/data/units.js';

const T = FFA_MAP.tile;
function ffa() {
  const w = new World({ map: FFA_MAP, seed: 2, PF, setup: 'ffa' });
  for (const u of [...w.ofKind('unit')]) w.removeEntity(u);
  w.at = (type, team, tx, ty) => w.addUnit(type, team, (tx + 0.5) * T, (ty + 0.5) * T);
  w.zone = (id) => w.zones.find((z) => z.id === id);
  w.runFor = (s) => { for (let i = 0; i < s / 0.05; i++) w.step(); };
  return w;
}
const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius;

test('an idle soldier engages an intruder anywhere in its home zone, beyond the old aggro range', () => {
  const w = ffa();
  const guard = w.at('striker', 1, 6, 24);
  const raider = w.at('striker', 3, 24, 8); // in Azure's home zone, 25 tiles away
  assert.ok(far(guard, raider) > COMBAT.aggroRange, 'out of Phase 1 auto-acquire range');
  w.runFor(0.6);
  assert.equal(guard.order.type, 'attack');
  assert.equal(guard.order.target, raider.id);
  assert.equal(guard.order.defend, 'nw');
  assert.deepEqual(guard.post, { x: 6.5 * T, y: 24.5 * T });
});

test('it applies in any zone the camp owns, not only the home zone', () => {
  const w = ffa();
  w.zone('w').owner = 1;
  const guard = w.at('lancer', 1, 5, 40), raider = w.at('striker', 4, 26, 58);
  w.runFor(0.6);
  assert.equal(guard.order.target, raider.id);
});

test('not in a zone the camp does not own, and nothing is pulled in from another zone', () => {
  const w = ffa();
  const neutral = w.at('striker', 1, 40, 10), n2 = w.at('striker', 3, 60, 20); // the North field: nobody's
  const away = w.at('striker', 1, 16, 40); // Azure's unit idle in the West field (neutral)
  w.at('striker', 3, 24, 8); // a raider in Azure's home zone
  w.runFor(1);
  assert.equal(neutral.order.type, 'idle');
  assert.equal(away.order.type, 'idle', 'not recalled from another zone');
  void n2;
});

test('a unit carrying out an order is never interrupted', () => {
  const w = ffa();
  const walker = w.at('striker', 1, 4, 4);
  w.issue({ type: 'move', ids: [walker.id], x: 4.5 * T, y: 28.5 * T, team: 1 });
  const archer = w.at('sparker', 1, 20, 4);
  w.issue({ type: 'attackMove', ids: [archer.id], x: 28.5 * T, y: 28.5 * T, team: 1 });
  w.at('striker', 3, 26, 20);
  w.runFor(1);
  assert.equal(walker.order.type, 'move', 'still walking where it was told');
  assert.equal(walker.order.auto, undefined);
  assert.ok(archer.order.type === 'attackMove', 'the attack-move carries on by its own rules');
});

test('Peasants never auto-defend', () => {
  const w = ffa();
  const peasant = w.at('drone', 1, 6, 24);
  w.at('striker', 3, 24, 8);
  w.runFor(1);
  assert.equal(peasant.order.type, 'idle');
});

test('after the fight it walks back to its post', () => {
  const w = ffa();
  const guard = w.at('bulwark', 1, 6, 24), post = { x: guard.x, y: guard.y };
  const raider = w.at('drone', 3, 20, 10); // a weak intruder
  w.runFor(20);
  assert.ok(!w.get(raider.id), 'the intruder was killed');
  w.runFor(30);
  assert.ok(Math.hypot(guard.x - post.x, guard.y - post.y) <= 16, `back at its post (${guard.x.toFixed(0)},${guard.y.toFixed(0)})`);
  assert.equal(guard.order.type, 'idle');
  assert.equal(guard.post, null);
});

test('it does not walk back into a zone that has turned hostile', () => {
  const w = ffa();
  w.zone('w').owner = 1;
  const guard = w.at('bulwark', 1, 16, 44); // in the West field, which Azure owns
  const raider = w.at('drone', 3, 16, 70);
  w.runFor(0.6);
  assert.equal(guard.order.target, raider.id);
  w.zone('w').owner = 3; // meanwhile the West field falls to Rose
  w.runFor(1);
  assert.equal(guard.post, null, 'post forgotten');
  assert.notEqual(guard.order.returning, true);
});

test('an order from the owner cancels the automatic one and forgets the post', () => {
  const w = ffa();
  const guard = w.at('striker', 1, 6, 24);
  w.at('striker', 3, 24, 8);
  w.runFor(0.6);
  assert.ok(guard.post);
  w.issue({ type: 'move', ids: [guard.id], x: 3.5 * T, y: 3.5 * T, team: 1 });
  assert.equal(guard.post, null);
  assert.equal(guard.order.type, 'move');
  w.runFor(1);
  assert.equal(guard.order.type, 'move', 'not re-grabbed while it follows the order');
});

test('it is the same rule for every camp (an AI camp\'s units defend its zone too)', () => {
  const w = ffa();
  const guard = w.at('striker', 3, 94, 114), raider = w.at('striker', 1, 114, 94);
  w.runFor(0.6);
  assert.equal(guard.order.target, raider.id);
  assert.equal(guard.order.defend, 'se');
});

test('the 1v1 match has no zones, so nothing changes there', () => {
  const w = new World({ seed: 2, PF, setup: 'match' });
  assert.equal(w.zones, undefined);
});
