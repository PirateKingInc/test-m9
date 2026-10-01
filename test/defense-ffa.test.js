// Phase 7 reactive defense in the free-for-all (PHASE7_SPEC.md "Reactive
// defense in the free-for-all"): the Phase 2 early-aggression and massing
// triggers, per rival. Crimson (team 2, north-east, Rush, hard: reacts after
// 3 s) is the camp under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenario } from './rivals-helpers.js';

// Scan and evaluate the triggers every 2 s of (frozen) game time.
function watch(s, seconds) {
  for (let t = 0; t < seconds; t += 2) {
    s.w.time += 2;
    s.ai.scout.scan(); s.ai.intelCache = null; s.ai.evaluateTriggers();
  }
}

test('early aggression: one raider each from two different camps is still a rush (defend mode)', () => {
  const s = scenario();
  s.w.time = 100;
  const home = s.at('striker', 2, 104, 16, 4);
  const azure = s.at('striker', 1, 100, 20), jade = s.at('striker', 4, 102, 22);
  watch(s, 6);
  assert.ok(s.ai.defending, 'defend mode');
  const r = s.ai.reactions.find((x) => x.kind === 'early-aggression');
  assert.match(r.detail, /^2 enemy units at the base/);
  s.ai.commandArmy();
  assert.ok(home.every((u) => u.order.type === 'attackMove'), 'the army goes at the raiders');
  assert.ok([azure[0], jade[0]].some((e) => home[0].order.x === e.x && home[0].order.y === e.y));
});

test('early aggression still works for every camp on the map (per-camp mirror)', () => {
  const spots = { 1: [16, 16], 2: [104, 16], 3: [104, 104], 4: [16, 104] }; // beside each Castle
  for (const team of [1, 2, 3, 4]) {
    const s = scenario({ team });
    s.w.time = 100;
    const [x, y] = spots[team], raider = team === 1 ? 2 : 1;
    s.at('striker', raider, x, y, 2);
    watch(s, 6);
    assert.ok(s.ai.defending, `camp ${team} defends`);
  }
});

test('massing per rival: a rival\'s massed army is not hidden by pooling it with another rival', () => {
  const s = scenario();
  s.w.time = 400; // past the early-aggression window
  s.at('striker', 2, 70, 20, 1); // a lookout in the field
  s.at('striker', 1, 66, 20, 5); // Azure: all Horsemen (massed)
  s.at('sparker', 4, 66, 24, 4); // Jade: a mixed army
  s.at('bulwark', 4, 69, 24, 2);
  watch(s, 6);
  // Pooled, the 5 Horsemen are 5 of 11 seen units (45%): no reaction. Per rival, Azure massed.
  assert.equal(s.ai.counterFor, 'striker');
  assert.match(s.ai.reactions.find((x) => x.kind === 'massing').detail, /^5 striker seen \(camp 1\): counter with bulwark\/sparker/);
});

test('massing per rival: with two rivals massing, the one hitting us is countered', () => {
  const s = scenario();
  s.w.time = 400;
  const ours = s.at('striker', 2, 70, 20, 2);
  s.at('striker', 1, 66, 18, 6); // Azure: 6 Horsemen, the bigger army, not fighting us
  const jade = s.at('bulwark', 4, 72, 22, 5); // Jade: 5 Shield Knights, attacking our units
  for (const u of jade) u.order = { type: 'attack', target: ours[0].id };
  watch(s, 6);
  assert.equal(s.ai.counterFor, 'bulwark', 'counter the rival hitting us (pooled, the 6 Horsemen would win)');
  assert.match(s.ai.reactions.find((x) => x.kind === 'massing').detail, /\(camp 4\): counter with lancer/);
});

test('massing per rival: the current target\'s massed army comes first', () => {
  const s = scenario();
  s.w.time = 400;
  s.at('striker', 2, 70, 20, 10);
  s.at('sparker', 1, 66, 18, 5); // Azure: massing Archers, and the weakest: our target
  s.at('bulwark', 4, 72, 22, 6); // Jade: massing Shield Knights, bigger
  watch(s, 6);
  assert.equal(s.ai.intel().target, 1);
  assert.equal(s.ai.counterFor, 'sparker');
});
