// Phase 3 AI expansion to the middle crystal fields, and attack waves that go
// for the *scouted* enemy Core rather than its start location.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PF } from './helpers.js';
import { Match } from '../src/ai/match.js';
import { readonly } from '../src/ai/readonly.js';
import { STRATEGIES, EXPANSION } from '../src/data/strategies.js';

const near = (e, p, tiles) => Math.hypot(e.x - p.x, e.y - p.y) <= tiles * 32;
const T = 32;

// The AI (east, team 2) against the passive `sentinel` script, through the
// read-only guard.
function vsSentinel(strategy, seed = 3) {
  return new Match({ seed, PF, ai: { strategy, difficulty: 'hard' }, player: { strategy: 'sentinel', difficulty: 'hard' }, view: readonly });
}

function runUntil(m, pred, max) {
  while (!pred()) {
    if (m.world.result || m.world.time > max) return false;
    m.step();
  }
  return true;
}

for (const strategy of ['rush', 'boom', 'turtle']) {
  test(`${strategy} expands to an uncontested middle field under its trigger, with Drones and a defensive presence`, () => {
    const x = STRATEGIES[strategy].expand;
    const m = vsSentinel(strategy), ai = m.ai;
    let firstWanted = null;
    const ok = runUntil(m, () => {
      if (ai.expansion) return true;
      if (firstWanted == null && ai.expandWanted()) firstWanted = m.world.time;
      return false;
    }, 900);
    assert.ok(ok, 'expanded within 15 minutes');
    const r = ai.reactions.find((e) => e.kind === 'expand');
    firstWanted ??= r.t; // the trigger first held in the very tick the AI expanded (seen after it, not before)
    assert.ok(r.t - firstWanted < 30, `expanded ${(r.t - firstWanted).toFixed(1)}s after its trigger first held`);
    assert.ok(r.detail.includes('home-low') || r.t >= x.after, `expanded at ${r.t.toFixed(0)}s: ${r.detail}`);
    if (r.detail.includes('home-low')) assert.ok(ai.homeLeft() < x.orHomeBelow + 0.05);
    assert.ok(ai.expansion.center.x > 40 * T && ai.expansion.center.x < 60 * T, 'a middle field (between the ridges)');
    const mine = (type) => [...m.world.ofKind(type === 'drone' || type === 'unit' ? 'unit' : 'building')];
    // Staffed and defended within two minutes of the Depot finishing.
    // (It may abort a field that turns out contested and take the other one.)
    const staffed = runUntil(m, () => {
      const f = ai.expansion;
      if (!f) return false;
      const depot = mine('b').find((b) => b.team === 2 && b.type === 'depot' && b.built && near(b, f.center, 12));
      if (!depot) return false;
      const nodes = new Set(ai.nodesNear(f.center, EXPANSION.fieldRadius).map((n) => n.id));
      const drones = mine('unit').filter((u) => u.team === 2 && u.type === 'drone' && u.order.type === 'gather' && nodes.has(u.order.node));
      const spires = mine('b').filter((b) => b.team === 2 && b.type === 'spire' && b.built && near(b, f.center, 12));
      const guards = [...ai.guards].map((id) => m.world.get(id)).filter((u) => u && near(u, f.guard, 8));
      return drones.length >= x.drones && spires.length >= x.spires && guards.length >= x.guards;
    }, r.t + 300);
    assert.ok(staffed, `${strategy}: Depot, ${x.drones} Drones, ${x.spires} Spires and ${x.guards} guards at the field`);
    assert.ok(x.spires + x.guards > 0, 'every strategy defends its expansion');
  });
}

test('the AI never builds an expansion in a field the enemy holds', () => {
  const m = vsSentinel('boom'), ai = m.ai, w = m.world;
  // The enemy (team 1) already holds the north field, which boom would pick first.
  const north = EXPANSION.fields.north;
  w.addBuilding('depot', 1, north.depot[0], north.depot[1], { built: true });
  w.addBuilding('spire', 1, north.spire[0], north.spire[1], { built: true });
  const northC = { x: north.center[0] * T, y: north.center[1] * T }, southC = { x: EXPANSION.fields.south.center[0] * T, y: EXPANSION.fields.south.center[1] * T };
  const ok = runUntil(m, () => {
    for (const b of w.ofKind('building')) {
      if (b.team === 2 && b.type === 'depot' && near(b, northC, 12)) assert.ok(!b.built, 'no finished AI Depot in the held field');
    }
    return [...w.ofKind('building')].some((b) => b.team === 2 && b.type === 'depot' && b.built && near(b, southC, 12));
  }, 900);
  assert.ok(ok, 'expanded to the free south field instead');
});

test('attack waves hunt down a relocated Core the AI has scouted, not the start location', () => {
  const m = new Match({ seed: 2, PF, ai: { strategy: 'rush', difficulty: 'hard' }, player: null, view: readonly });
  const w = m.world;
  // The player's only Core stands in the far south-west corner, away from its start.
  const moved = w.addBuilding('core', 1, 3, 52, { built: true });
  w.removeEntity([...w.ofKind('building')].find((b) => b.team === 1 && b.type === 'core' && b !== moved));
  let sawStartEmpty = false, targeted = false;
  const ok = runUntil(m, () => {
    if (m.ai.scout.startEmptyAt != null) sawStartEmpty = true;
    if (m.ai.scout.knownCores().some((c) => c.id === moved.id) && m.ai.attackTarget().id === moved.id) targeted = true;
    return false;
  }, 1200);
  assert.equal(ok, false);
  assert.ok(sawStartEmpty, 'the AI saw the start was empty');
  assert.ok(targeted, 'it scouted the relocated Core and made it the wave target');
  assert.equal(w.result?.winner, 2, `the AI won (result: ${JSON.stringify(w.result)})`);
  assert.equal(w.result.reason, 'core-destroyed');
});
