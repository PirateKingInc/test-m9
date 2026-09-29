// Phase 7 rival assessment (PHASE7_SPEC.md "What an AI camp knows about a
// rival" and "Priority formula"): scripted scenarios on the free-for-all map.
// The AI camp under test is Crimson (team 2, north-east). Its rivals: Rose
// (3, south-east) is the nearest by measured travel, Azure (1, north-west)
// next, Jade (4, south-west) the furthest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenario } from './rivals-helpers.js';
import { CAMP_TRAVEL, campTravel, FFA_MAP } from '../src/data/ffa.js';
import { RIVALS } from '../src/data/rivals.js';
import { roundTrip } from './travel.js';

const order = (r) => r.ranking.map((x) => x.team);

test('CAMP_TRAVEL is the measured march time (both one-way marches, each the median of 12 shifted marches, averaged; within 1 s)', () => {
  // The same shifts as tools/symmetry.mjs (its first 12 of 24).
  const SHIFTS = Array.from({ length: 12 }, (_, i) => [((i * 37) % 17) - 8, ((i * 53) % 17) - 8]);
  const median = (xs) => { const v = [...xs].sort((p, q) => p - q); return (v[5] + v[6]) / 2; };
  for (const key of Object.keys(CAMP_TRAVEL)) {
    const [a, b] = key.split('-').map(Number);
    const leg = (from, to) => median(SHIFTS.map((s) => roundTrip(from, to, 1, FFA_MAP, s).there));
    const half = (leg(a, b) + leg(b, a)) / 2;
    assert.ok(Math.abs(half - CAMP_TRAVEL[key]) <= 1, `${key}: table ${CAMP_TRAVEL[key]} s vs measured ${half.toFixed(1)} s`);
  }
  assert.equal(campTravel(3, 2), CAMP_TRAVEL['2-3']);
});

test('with no intel, the ranking picks the nearest rival by travel (the Phase 6 placeholder\'s camp)', () => {
  for (const team of [1, 2, 3, 4]) {
    const { ai, scan } = scenario({ team });
    const r = scan();
    const placeholder = ai.targetCamp().team;
    assert.equal(r.target, placeholder, `camp ${team}`);
    assert.ok(r.ranking.every((x) => !x.scouted && x.R === 1), 'everyone unscouted, assumed equal');
    assert.equal(r.cautious, false);
  }
});

test('opportunism: Azure at 20% after fighting Jade outranks Rose, nearest and full strength', () => {
  const { ai, at, fight, scan } = scenario();
  // Our eyes: a Horseman posted in the north zone, where Azure and Jade fight.
  at('striker', 2, 50, 12, 6);
  const azure = at('striker', 1, 46, 14, 6, 0.2);
  const jade = at('striker', 4, 46, 17, 3, 0.5);
  fight(azure, jade);
  // Rose's full-strength army is seen near our base.
  at('sparker', 3, 80, 26, 6);
  const r = scan();
  const a = r.ranking.find((x) => x.team === 1), c = r.ranking.find((x) => x.team === 3);
  console.log(`# ${r.ranking.map((x) => `camp ${x.team} ${x.score.toFixed(2)} R ${x.R.toFixed(2)} [${x.why.join(', ')}]`).join(' | ')}`);
  assert.equal(a.engaged, 4, 'Azure witnessed fighting Jade');
  assert.ok(a.R < c.R, 'Azure is seen weaker than Rose');
  assert.equal(r.target, 1, 'target the weakened, engaged rival');
  assert.ok(travelOf(2, 3) < travelOf(2, 1), 'even though Rose is nearer');
  assert.equal(order(r)[0], 1);
});

const travelOf = (a, b) => campTravel(a, b);

test('opportunism: a rival witnessed fighting a third camp outranks an equal one that is nearer', () => {
  const { at, fight, scan } = scenario();
  at('striker', 2, 50, 12, 2);
  fight(at('striker', 1, 46, 14, 3), at('striker', 4, 46, 17, 3));
  at('striker', 3, 80, 26, 3); // Rose: same army, nearer, not fighting anyone
  const r = scan();
  assert.equal(r.target, 1);
  assert.ok(r.ranking.find((x) => x.team === 1).why.includes('engaged with camp 4'));
});

test('opportunism: a damaged Castle scores up (Castle at 20%)', () => {
  const { w, at, scan } = scenario();
  const azureCastle = [...w.ofKind('building')].find((b) => b.team === 1 && b.type === 'core');
  azureCastle.hp = azureCastle.maxHp * 0.2;
  at('striker', 2, azureCastle.tx + 8, azureCastle.ty + 1); // a lookout beside it
  const r = scan();
  const a = r.ranking.find((x) => x.team === 1);
  assert.ok(Math.abs(a.castle - 0.8) < 1e-9);
  assert.ok(a.why.includes('Castle 20%'));
  assert.equal(r.target, 1, 'the Castle about to fall is the pick');
});

test('opportunism: a rival whose army we watched die scores as weak', () => {
  const { w, at, scan } = scenario();
  at('striker', 2, 78, 26, 4);
  const rose = at('striker', 3, 80, 27, 6);
  assert.ok(scan().ranking.find((x) => x.team === 3).R > 1);
  for (const u of rose) w.removeEntity(u); // it died (in view: our units stand there)
  w.time += 2;
  const r = scan();
  const c = r.ranking.find((x) => x.team === 3);
  assert.ok(c.scouted && c.seen === 0, 'seen gone: its army no longer counts');
  assert.equal(r.target, 3);
});

test('caution: a clearly stronger rival is never the target, even when nearest and engaged', () => {
  const { at, fight, scan } = scenario();
  at('striker', 2, 78, 26, 3); // our eyes near our base, and our 3-unit army
  const rose = at('bulwark', 3, 80, 28, 6); // Rose: 18 supply, next to us
  fight(rose, at('striker', 1, 82, 30, 1));
  const r = scan();
  const c = r.ranking.find((x) => x.team === 3);
  assert.ok(c.R >= RIVALS.caution, `Rose R ${c.R.toFixed(2)} is clearly stronger`);
  assert.ok(c.why.includes('clearly stronger'));
  assert.notEqual(r.target, 3, 'no suicide attack on the stronger neighbour');
  assert.equal(r.target, 1, 'redirected to the weaker rival it saw fighting Rose');
  assert.equal(r.cautious, false);
});

test('caution: when every rival is clearly stronger the camp is cautious (no target)', () => {
  const { at, scan } = scenario();
  at('striker', 2, 78, 26, 1);
  at('bulwark', 3, 80, 28, 4);
  at('bulwark', 1, 76, 22, 4); // Azure raiders in view too
  at('bulwark', 4, 74, 28, 4); // and Jade's
  const r = scan();
  assert.ok(r.ranking.every((x) => x.R >= RIVALS.caution));
  assert.equal(r.target, null);
  assert.equal(r.cautious, true);
});

test('only what is inside our eyes counts: a fight out of sight is not witnessed', () => {
  const { at, fight, scan } = scenario();
  fight(at('striker', 1, 46, 14, 6, 0.2), at('striker', 4, 46, 17, 3)); // nobody of ours near the north zone
  const r = scan();
  const a = r.ranking.find((x) => x.team === 1);
  assert.equal(a.engaged, null);
  assert.equal(a.scouted, false);
  assert.equal(r.target, 3, 'still the nearest');
});

test('a rival attacking us is marked as hitting us', () => {
  const { at, fight, scan } = scenario();
  const ours = at('striker', 2, 78, 26, 3);
  fight(at('striker', 4, 80, 26, 3), ours);
  const r = scan();
  assert.equal(r.ranking.find((x) => x.team === 4).hitting, true);
  assert.equal(r.ranking.find((x) => x.team === 4).engaged, null, 'fighting us is not "engaged with a third camp"');
});
