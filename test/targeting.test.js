// Phase 7 targeting in the AI's decisions (PHASE7_SPEC.md "Priority formula"
// and "Caution: claim instead of attack"): scripted scenarios with Crimson
// (team 2, north-east, Rush) and a 14-Horseman army at home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenario } from './rivals-helpers.js';
import { MutationError } from '../src/ai/readonly.js';
import { FFA_MAP } from '../src/data/ffa.js';

const T = FFA_MAP.tile;

function ready() {
  const s = scenario();
  s.army = s.at('striker', 2, 78, 18, 14);
  s.ai.stats.waves = 1; // past the first wave: the next leaves at 10 +/-30% units
  s.think = () => { s.ai.scout.scan(); s.ai.intelCache = null; s.ai.commandArmy(); };
  // What the AI "has seen" of a rival: remembered sightings far from our eyes.
  s.remember = (team, type, n, tx, ty) => {
    for (let i = 0; i < n; i++) {
      s.ai.scout.memory.set(`fake-${team}-${type}-${i}`, { kind: 'unit', type, team, x: tx * T, y: ty * T, seenAt: s.w.time, nearBase: false, health: 1 });
    }
  };
  return s;
}
const heading = (u) => ({ x: u.order.x / T, y: u.order.y / T });

test('a wave marches on the pick: with no intel, the nearest rival (Rose)', () => {
  const { ai, army, think } = ready();
  think();
  assert.equal(ai.mode, 'attack');
  assert.equal(ai.goal.team, 3);
  assert.ok(army.every((u) => u.order.type === 'attackMove' && heading(u).y > 64), 'south, to Rose');
  assert.ok(ai.reactions.some((r) => r.kind === 'target' && r.detail.startsWith('attacking camp 3')));
});

test('opportunism: a wave in the field turns on a rival it sees weakened by a third camp', () => {
  const { w, ai, army, at, fight, think } = ready();
  think();
  assert.equal(ai.goal.team, 3);
  // On the march, the wave comes across Azure (at 20%) fighting Jade.
  for (const u of army) { u.x = u.px = 70 * T; u.y = u.py = 20 * T; }
  fight(at('striker', 1, 66, 22, 6, 0.2), at('striker', 4, 66, 25, 3, 0.5));
  think();
  assert.equal(ai.goal.team, 3, 'not within commitTime of setting out');
  w.time += 30; // on the march
  think();
  assert.equal(ai.goal.team, 1, 'retargeted at Azure');
  const r = ai.reactions.find((x) => x.kind === 'retarget');
  assert.match(r.detail, /^camp 3 -> camp 1: weaker, engaged with camp 4/);
  assert.ok(army.every((u) => u.order.type === 'attackMove' && heading(u).x < 32), 'the whole wave turns west');
});

test('a wave does not turn round on a small change in the numbers (switch margin)', () => {
  const { ai, army, at, think } = ready();
  think();
  for (const u of army) { u.x = u.px = 70 * T; u.y = u.py = 20 * T; }
  at('striker', 1, 66, 22, 8); // Azure seen, a bit weaker than us: not worth turning round for
  think();
  assert.equal(ai.intel().ranking[0].team, 1, 'Azure now edges the ranking...');
  assert.equal(ai.goal.team, 3, '...but by less than the switch margin: the wave keeps going');
  assert.ok(!ai.reactions.some((x) => x.kind === 'retarget'));
});

test('caution: with every rival clearly stronger, a ready army claims the nearest free zone instead of attacking', () => {
  const { ai, army, remember, think } = ready();
  remember(1, 'bulwark', 9, 10, 14); remember(3, 'bulwark', 9, 86, 82); remember(4, 'bulwark', 9, 10, 82);
  think();
  assert.equal(ai.intel().cautious, true);
  assert.equal(ai.goal.claim.id, 'e', 'the East field: the nearest neutral zone to the north-east camp');
  assert.ok(army.every((u) => u.order.type === 'attackMove' && Math.round(heading(u).x) === 80 && Math.round(heading(u).y) === 48));
  assert.ok(ai.reactions.some((r) => r.kind === 'cautious-claim'));
});

test('caution: a claimed zone leads to the next, and a rival that weakens becomes the target again', () => {
  const { w, ai, army, remember, think } = ready();
  remember(1, 'bulwark', 9, 10, 14); remember(3, 'bulwark', 9, 86, 82); remember(4, 'bulwark', 9, 10, 82);
  think();
  w.zones.find((z) => z.id === 'e').owner = 2; // taken
  think();
  assert.equal(ai.goal.claim.id, 'n', 'on to the next free zone');
  for (const [id] of [...ai.scout.memory].filter(([, m]) => m.team === 3)) ai.scout.memory.delete(id); // Rose's army is gone
  remember(3, 'striker', 2, 86, 82);
  think();
  assert.equal(ai.goal.team, 3, 'Rose, now weaker, is attacked');
  assert.ok(army.every((u) => heading(u).y > 64));
});

test('caution: with nothing free to claim, the army stays home (holds)', () => {
  const { w, ai, army, remember, think } = ready();
  remember(1, 'bulwark', 9, 10, 14); remember(3, 'bulwark', 9, 86, 82); remember(4, 'bulwark', 9, 10, 82);
  for (const z of w.zones) if (z.field) ai.scout.memory.set(`tower-${z.id}`, { kind: 'building', type: 'spire', team: 1, x: z.field[0] * T, y: z.field[1] * T, seenAt: 0, health: 1 });
  think();
  assert.equal(ai.mode, 'gather', 'no wave');
  assert.ok(army.every((u) => u.order.type === 'idle'));
  assert.ok(ai.reactions.some((r) => r.kind === 'cautious-hold'));
});

test('the read-only guard catches the targeting code writing game state', () => {
  const { ai, remember, think } = ready();
  remember(1, 'bulwark', 9, 10, 14); remember(3, 'bulwark', 9, 86, 82); remember(4, 'bulwark', 9, 10, 82);
  const honest = ai.claimZone;
  ai.claimZone = function cheat() { for (const z of this.w.zones) z.owner = this.team; return honest.call(this); };
  assert.throws(() => think(), MutationError);
});
