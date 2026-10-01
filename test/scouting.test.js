// Phase 2 scouting-triggered reactions: scripted scenarios that must (and must
// not) make the AI branch. Player units are verification-only spawns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PF } from './helpers.js';
import { Match } from '../src/ai/match.js';
import { STRATEGIES, SCOUTING } from '../src/data/strategies.js';
import { DIFFICULTY } from '../src/data/difficulty.js';

const AI_BASE = { x: 90 * 32, y: 37 * 32 }; // center of the AI Command Core (Phase 12 map)

// Test harness (not the AI): the player side is just a stand-in here, so its Core
// is made indestructible to keep the match running while scenarios are staged.
function immortalPlayer(m) {
  const core = [...m.world.ofKind('building')].find((b) => b.team === 1 && b.type === 'core');
  core.maxHp = core.hp = 1e9;
  return m;
}

function match(strategy = 'rush', difficulty = 'hard', seed = 4) {
  return immortalPlayer(new Match({ seed, PF, ai: { strategy, difficulty }, player: null }));
}

// Spawn `n` player units of `type` around (x, y) and hold them in place.
function spawn(m, type, n, x, y) {
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(m.world.issue({ type: 'devSpawn', unit: type, team: 1, x: x + (i % 3) * 26, y: y + Math.floor(i / 3) * 26 }).id);
  m.world.issue({ type: 'move', ids, x, y, team: 1 });
  return ids;
}

const reaction = (m, kind) => m.ai.reactions.find((r) => r.kind === kind);
const runUntil = (m, pred, max) => { const t0 = m.world.time; while (!pred() && m.world.time - t0 < max && !m.world.result) m.step(); return pred(); };
const share = (weights, types) => types.reduce((a, t) => a + (weights[t] || 0), 0) / Object.values(weights).reduce((a, b) => a + b, 0);

test('early aggression: 2+ enemy combat units at the base before 5:00 switch the AI to defense', () => {
  const m = match('rush', 'hard'); // Rush owns no Spire, so the Spire reaction is observable
  m.run(150);
  assert.equal([...m.world.ofKind('building')].filter((b) => b.team === 2 && b.type === 'spire').length, 0);
  const t0 = m.world.time;
  spawn(m, 'bulwark', 3, AI_BASE.x - 380, AI_BASE.y); // sturdy: they outlast the reaction delay
  assert.ok(runUntil(m, () => reaction(m, 'early-aggression'), 20), 'defend mode triggered');
  const r = reaction(m, 'early-aggression');
  assert.ok(r.t - t0 >= DIFFICULTY.hard.reactionDelay, 'waited the reaction delay');
  assert.ok(m.ai.defending.attackers.has('bulwark'));
  assert.ok(share(m.ai.composition(), SCOUTING.counters.bulwark) >= SCOUTING.counterShare, 'production biased to Bulwark counters');
  assert.ok(runUntil(m, () => [...m.world.ofKind('building')].some((b) => b.team === 2 && b.type === 'spire'), 60), 'an AI with no Spire builds one while defending');
  // Clear the threat: defend mode ends after 20 s with no enemies near the base.
  for (const u of [...m.world.ofKind('unit')]) if (u.team === 1) u.hp = 0;
  assert.ok(runUntil(m, () => reaction(m, 'defend-end'), SCOUTING.defendClear + 10), 'defend mode ends once clear');
  assert.equal(m.ai.defending, null);
});

test('early aggression recalls an outgoing wave to defend', () => {
  const m = match('rush', 'hard');
  runUntil(m, () => m.ai.mode === 'attack', 400);
  assert.equal(m.ai.mode, 'attack', 'a wave went out');
  if (m.world.time < SCOUTING.earlyWindow - 30) {
    spawn(m, 'bulwark', 4, AI_BASE.x - 300, AI_BASE.y + 120); // sturdy enough to outlast the reaction delay
    assert.ok(runUntil(m, () => reaction(m, 'early-aggression'), 20));
    m.step();
    assert.equal(m.ai.mode, 'gather', 'the wave was recalled');
    const armyToThreat = m.ai.army().filter((u) => u.order.type === 'attackMove' || u.order.type === 'attack');
    assert.ok(armyToThreat.length >= 1, 'the army engages the threat');
  }
});

test('no early-aggression reaction for a lone unit, or after the 5:00 window', () => {
  const lone = match('turtle', 'hard');
  lone.run(40);
  spawn(lone, 'striker', 1, AI_BASE.x - 380, AI_BASE.y);
  lone.run(30);
  assert.equal(reaction(lone, 'early-aggression'), undefined);

  const late = match('turtle', 'hard');
  late.run(SCOUTING.earlyWindow + 5);
  spawn(late, 'striker', 4, AI_BASE.x - 380, AI_BASE.y);
  late.run(30);
  assert.equal(reaction(late, 'early-aggression'), undefined);
});

for (const massed of ['striker', 'sparker', 'bulwark', 'lancer']) {
  test(`massing: seeing mostly ${massed}s shifts production to ${SCOUTING.counters[massed].join('/')}`, () => {
    const m = match('boom', 'hard', 9);
    m.run(SCOUTING.earlyWindow + 10); // past the early window: this is purely the massing branch
    // Harness: clear the AI's (supply-capped) army so there is new production to observe.
    for (const u of m.ai.army()) m.world.get(u.id).hp = 0;
    m.step();
    spawn(m, massed, 6, AI_BASE.x - 420, AI_BASE.y - 200);
    assert.ok(runUntil(m, () => m.ai.counterFor === massed, 20), `countering ${massed}`);
    const before = { ...m.ai.stats.trained }; // production from the reaction onward
    assert.match(reaction(m, 'massing').detail, new RegExp(`${massed} seen`));
    assert.ok(share(m.ai.composition(), SCOUTING.counters[massed]) >= SCOUTING.counterShare);
    m.run(60);
    const after = m.ai.stats.trained;
    const delta = (t) => (after[t] || 0) - (before[t] || 0);
    const made = ['striker', 'sparker', 'bulwark', 'lancer'].reduce((a, t) => a + delta(t), 0);
    const counters = SCOUTING.counters[massed].reduce((a, t) => a + delta(t), 0);
    assert.ok(made >= 3, `kept producing (${made})`);
    assert.ok(counters / made >= 0.6, `mostly counters: ${counters}/${made}`);
  });
}

test('a balanced enemy army does not trip the massing trigger', () => {
  const m = match('boom', 'hard', 9);
  m.run(SCOUTING.earlyWindow + 10);
  for (const t of ['striker', 'sparker', 'bulwark', 'lancer']) spawn(m, t, 2, AI_BASE.x - 420, AI_BASE.y - 250 + ['striker', 'sparker', 'bulwark', 'lancer'].indexOf(t) * 60);
  m.run(20);
  assert.equal(m.ai.counterFor, null);
});

test('the AI only knows what it can see: a far-away massed army goes unnoticed', () => {
  const blind = { ...STRATEGIES.boom, scoutAt: null }; // no scout Drone
  const m = immortalPlayer(new Match({ seed: 9, PF, ai: { strategy: blind, difficulty: 'hard' }, player: null }));
  m.run(100); // before Boom's first wave leaves, so no AI unit is anywhere near the player
  spawn(m, 'bulwark', 8, 12 * 32, 48 * 32); // deep in the player's base, 70+ tiles away
  m.run(40);
  assert.equal(m.ai.stats.waves, 0);
  assert.equal(m.ai.counterFor, null);
  assert.equal([...m.ai.scout.memory.values()].filter((x) => x.type === 'bulwark').length, 0);
});

test('the scout Drone walks to the enemy start and reports what it sees', () => {
  const m = match('boom', 'hard');
  assert.ok(runUntil(m, () => m.ai.scout.knownBuildings('core').length > 0, 200), 'enemy Command Core spotted');
  assert.ok(m.ai.log.some((l) => l.includes('scout drone sent')));
  assert.ok(m.world.time >= STRATEGIES.boom.scoutAt, 'not before the scripted time');
});

test('sightings expire from memory after 90 s out of view', () => {
  const m = match('turtle', 'hard');
  m.run(SCOUTING.earlyWindow + 10);
  const ids = spawn(m, 'lancer', 2, AI_BASE.x - 400, AI_BASE.y - 300);
  m.run(4);
  assert.ok(ids.some((id) => m.ai.scout.memory.has(id)));
  for (const id of ids) { const u = m.world.get(id); if (u) { u.x = u.px = 5 * 32; u.y = u.py = 5 * 32; } }
  m.run(SCOUTING.memory + 5);
  assert.ok(ids.every((id) => !m.ai.scout.memory.has(id)));
});
