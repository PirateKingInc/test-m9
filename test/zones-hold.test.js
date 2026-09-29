// Phase 7 zone holding (PHASE7_SPEC.md "Zone holding"): an AI camp defends the
// non-home zones it owns and retakes one it just lost, with a small squad from
// its home army. Crimson (team 2, north-east) owns the East zone (gold field
// at tile 80, 48) in each scenario.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenario } from './rivals-helpers.js';
import { FFA_MAP } from '../src/data/ffa.js';
import { SIM_DT } from '../src/sim/constants.js';

const T = FFA_MAP.tile;
const EAST = { x: 80 * T, y: 48 * T };

function owning() {
  const s = scenario();
  s.east = s.w.zones.find((z) => z.id === 'e');
  s.east.owner = 2;
  s.home = s.at('striker', 2, 80, 18, 6);
  s.think = () => { s.ai.scout.scan(); s.ai.intelCache = null; s.ai.commandArmy(); };
  // Play the world with the AI deciding, for `sec` seconds.
  s.play = (sec) => { for (let i = 0; i < sec / SIM_DT; i++) { s.w.step(); s.ai.update(); } };
  return s;
}
const squadOf = (s) => s.home.filter((u) => u.order.type === 'attackMove' && u.order.x === EAST.x && u.order.y === EAST.y);

test('defend: a rival taking a zone we own draws a squad of up to 4 home units', () => {
  const s = owning();
  s.think(); // nothing happening: no squad
  assert.equal(s.ai.squad, null);
  s.east.holder = 3; s.east.holdSince = s.w.time; // Rose is taking it (the banner shows it)
  s.think();
  assert.equal(s.ai.squad.kind, 'defend');
  assert.equal(squadOf(s).length, 4, 'four go, two stay home');
  assert.ok(s.ai.reactions.some((r) => r.kind === 'zone-defend' && r.detail.startsWith('e: 4 units')));
  assert.equal(s.ai.wave.length, 0, 'the squad is not an attack wave');
});

test('defend: rival units seen in our zone draw a squad; a much bigger force does not', () => {
  const small = owning();
  small.at('striker', 2, 78, 47); // a lookout in the zone
  small.at('striker', 3, 80, 50, 2);
  small.think();
  assert.equal(small.ai.squad?.kind, 'defend', '2 Horsemen vs a squad of 4: go');

  const big = owning();
  big.at('striker', 2, 78, 47);
  big.at('bulwark', 3, 80, 50, 4); // 12 supply of Shield Knights vs a 4-Horseman squad
  big.think();
  assert.equal(big.ai.squad, null, 'no squad thrown at a force more than 1.5x its size');
});

test('recapture: a zone lost in the last 90 s is retaken by a squad (military control, 5 s)', () => {
  const s = owning();
  s.think(); // the camp notes it owns the East zone
  s.east.owner = 3; // lost to Rose, whose raiders have moved on
  s.play(45);
  assert.ok(s.ai.reactions.some((r) => r.kind === 'zone-recapture'), 'a recapture squad went');
  assert.equal(s.east.owner, 2, 'the East zone is Crimson\'s again');
  assert.ok(s.w.drainEvents().some((e) => e.type === 'zoneCaptured' && e.zone === 'e' && e.to === 2));
});

test('recapture: not after lostMemory, and not against a bigger force seen there', () => {
  const late = owning();
  late.think();
  late.east.owner = 3; // lost 91 s ago, as the camp noted then
  late.ai.zoneSeen.set('e', 3);
  late.ai.zoneLost.set('e', { at: late.w.time - 91, to: 3 });
  late.think();
  assert.equal(late.ai.squad, null, 'too long ago');

  const held = owning();
  held.think();
  held.east.owner = 3;
  held.at('striker', 2, 78, 47);
  held.at('striker', 3, 80, 50, 5);
  held.think();
  assert.equal(held.ai.squad, null, '5 Horsemen hold it: a 4-unit squad does not try');
});

test('the squad goes home once the zone is secure, and leaves for defend mode', () => {
  const s = owning();
  s.east.holder = 3;
  s.think();
  const ids = [...s.ai.squad.ids];
  s.east.holder = null;
  for (const id of ids) { const u = s.w.get(id); u.x = u.px = EAST.x; u.y = u.py = EAST.y; u.order = { type: 'idle' }; }
  s.think(); // secure from now
  s.w.time += 11;
  s.think();
  assert.equal(s.ai.squad, null);
  assert.ok(s.ai.reactions.some((r) => r.kind === 'zone-squad-home' && r.detail === 'e: zone secure'));
  assert.ok(ids.every((id) => s.w.get(id).order.type === 'move'), 'back to the rally point');

  const d = owning();
  d.east.holder = 3;
  d.think();
  d.ai.defending = { since: d.w.time, lastThreat: d.w.time, attackers: new Set(['striker']) };
  d.think();
  assert.equal(d.ai.squad, null, 'defend mode takes everyone');
});
