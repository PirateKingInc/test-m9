// Phase 11 AI hold (PHASE11_SPEC.md "Disconnects and AI hold"): a new mode,
// not Rush, Boom or Turtle. At takeover the army goes home and every rally
// point points home; then it decides nothing. Phase 9's auto-defend makes the
// idle garrison fight whatever enters the camp's zones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PF } from './helpers.js';
import { World } from '../src/sim/world.js';
import { FFA_MAP } from '../src/data/ffa.js';
import { HoldBrain, homeOf } from '../src/net/hold.js';
import { canPlace } from '../src/sim/construction.js';

const T = FFA_MAP.tile;
function world() {
  const w = new World({ map: FFA_MAP, seed: 3, PF, setup: 'ffa' });
  w.resources[2] = 2000;
  return w;
}
const run = (w, s) => { for (let i = 0; i < s / 0.05; i++) w.step(); };
const recorder = (w) => { const cmds = []; const issue = w.issue.bind(w); w.issue = (c) => { cmds.push(c); return issue(c); }; return cmds; };

test('at takeover: the army comes home, orders its player gave are dropped, rallies point home', () => {
  const w = world();
  const home = homeOf(w, 2);
  const out = [w.addUnit('striker', 2, 48 * T, 48 * T), w.addUnit('sparker', 2, 50 * T, 46 * T)]; // in the middle of the map
  const marching = w.addUnit('lancer', 2, home.x, home.y);
  w.issue({ type: 'attackMove', ids: [marching.id], x: 10 * T, y: 80 * T, team: 2 }); // its player sent it off
  const idle = w.addUnit('striker', 2, home.x + 2 * T, home.y + 2 * T); // standing guard at home
  const core = [...w.ofKind('building')].find((b) => b.team === 2 && b.type === 'core');
  const spot = [...w.grid.spiral(core.tx + 6, core.ty + 6, 20)].find((t) => canPlace(w, 'foundry', t.tx, t.ty) && canPlace(w, 'foundry', t.tx - 1, t.ty - 1));
  const foundry = w.addBuilding('foundry', 2, spot.tx, spot.ty, { built: true });
  w.issue({ type: 'rally', building: foundry.id, x: 30 * T, y: 30 * T, team: 2 });
  assert.ok(w.issue({ type: 'train', building: foundry.id, unit: 'striker', team: 2 }).ok, 'one unit queued before the takeover');
  const peasant = [...w.ofKind('unit')].find((u) => u.team === 2 && u.type === 'drone');
  const peasantOrder = JSON.stringify(peasant.order);

  const cmds = recorder(w);
  const hold = new HoldBrain(2);
  hold.activate(w);
  assert.equal(hold.since, w.tick);
  const move = cmds.find((c) => c.type === 'move');
  assert.deepEqual(move.ids.sort(), [...out.map((u) => u.id), marching.id].sort(), 'the units away or on an order go home; the one on guard stays');
  assert.equal(JSON.stringify(peasant.order), peasantOrder, 'Peasants keep what they were told');
  assert.ok(cmds.filter((c) => c.type === 'rally').length >= 2, 'the Castle and the Barracks rally home');
  assert.ok(home.contains(foundry.rally), 'the Barracks rally is home');
  assert.ok(cmds.every((c) => ['move', 'rally'].includes(c.type)), 'nothing else: no training, building or expansion');

  // After the takeover the hold brain issues nothing (the sim still walks a
  // finished unit to its rally point by itself: that is not a decision).
  cmds.length = 0;
  let byHold = 0;
  for (let i = 0; i < 60 / 0.05; i++) { const before = cmds.length; hold.update(w); byHold += cmds.length - before; w.step(); }
  assert.equal(byHold, 0, 'no decisions after the takeover');
  assert.ok(cmds.every((c) => c.type === 'move' && home.contains(c)), 'only the sim\'s own rally walk, to home');
  assert.ok([...out, marching].every((u) => home.contains(u)), 'the army is home');
  const trained = [...w.ofKind('unit')].filter((u) => u.team === 2 && u.type === 'striker' && !out.includes(u) && u !== idle);
  assert.equal(trained.length, 1, 'the queued unit finished');
  assert.ok(home.contains(trained[0]), 'and stayed home');
  assert.equal(idle.order.type, 'idle');
});

test('the idle garrison defends the camp by itself (Phase 9 auto-defend)', () => {
  const w = world();
  const home = homeOf(w, 2);
  const guards = [0, 1, 2].map((i) => w.addUnit('striker', 2, home.x + i * T, home.y));
  new HoldBrain(2).activate(w);
  run(w, 5);
  const intruder = w.addUnit('sparker', 3, home.x + 6 * T, home.y + 6 * T); // walks into the home zone
  run(w, 1);
  assert.ok(guards.some((g) => g.order.type === 'attack' && g.order.defend), 'the garrison engages');
  run(w, 20);
  assert.ok(!w.get(intruder.id) || intruder.hp <= 0, 'the intruder is dealt with');
});
