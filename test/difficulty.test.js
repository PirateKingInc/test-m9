// Phase 2 difficulty: it picks the default strategy and how tightly the script is
// timed. It never gives the AI extra resources or knowledge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PF } from './helpers.js';
import { Match } from '../src/ai/match.js';
import { DIFFICULTY } from '../src/data/difficulty.js';
import { STRATEGIES } from '../src/data/strategies.js';

const immortal = (m) => { const c = [...m.world.ofKind('building')].find((b) => b.team === 1); c.hp = c.maxHp = 1e9; return m; };
const match = (difficulty, strategy = 'boom', seed = 3) => immortal(new Match({ seed, PF, ai: { strategy, difficulty }, player: null }));

test('difficulty data matches the SPEC.md table', () => {
  const spec = readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
  const row = (label) => spec.split('\n').find((l) => l.startsWith(`| ${label} |`)).split('|').slice(2, 5).map((c) => c.trim());
  // SPEC.md names strategies by their Phase 2 names; the ids are what the data holds.
  const ID = { Rush: 'rush', 'Economy-Boom': 'boom', 'Turtle-and-Tech': 'turtle' };
  assert.deepEqual(row('Default strategy').map((n) => ID[n]), ['easy', 'normal', 'hard'].map((d) => DIFFICULTY[d].strategy));
  assert.deepEqual(row('Decision interval'), ['easy', 'normal', 'hard'].map((d) => `${DIFFICULTY[d].decisionInterval} s`));
  assert.deepEqual(row('Reaction delay before a trigger takes effect'), ['easy', 'normal', 'hard'].map((d) => `${DIFFICULTY[d].reactionDelay} s`));
  assert.deepEqual(row('Worker factor (× worker target)'), ['easy', 'normal', 'hard'].map((d) => DIFFICULTY[d].workerFactor.toFixed(1)));
});

test("'auto' strategy resolves to each difficulty's default", () => {
  for (const [d, cfg] of Object.entries(DIFFICULTY)) {
    const m = new Match({ seed: 1, PF, ai: { strategy: 'auto', difficulty: d }, player: null });
    assert.equal(m.ai.strategyId, cfg.strategy, d);
  }
});

test('the same script finishes its opening sooner on harder tiers', () => {
  const doneAt = {};
  for (const d of ['easy', 'normal', 'hard']) {
    const m = match(d);
    while (m.ai.step < STRATEGIES.boom.opening.length && m.world.time < 600) m.step();
    doneAt[d] = m.world.time;
  }
  console.log(`# Boom opening finished at: easy ${doneAt.easy.toFixed(0)}s, normal ${doneAt.normal.toFixed(0)}s, hard ${doneAt.hard.toFixed(0)}s`);
  assert.ok(doneAt.hard < doneAt.normal && doneAt.normal < doneAt.easy);
  // Phase 3 cut Easy's stepDelay from 6 s to 2 s for strategy balance, so the gap is smaller but still clear.
  assert.ok(doneAt.easy - doneAt.hard > 5, 'the gap is clear (stepDelay overlaps time spent waiting for Lumen)');
});

test('easier tiers react to scouting later', () => {
  const at = {};
  for (const d of ['easy', 'hard']) {
    const m = match(d, 'turtle', 6);
    m.run(120);
    const t0 = m.world.time;
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(m.world.issue({ type: 'devSpawn', unit: 'bulwark', team: 1, x: 70 * 32 - 380 + i * 26, y: 29 * 32 }).id);
    m.world.issue({ type: 'move', ids, x: 70 * 32 - 380, y: 29 * 32, team: 1 });
    while (!m.ai.reactions.some((r) => r.kind === 'early-aggression') && m.world.time - t0 < 60) m.step();
    at[d] = m.world.time - t0;
  }
  console.log(`# early-aggression reaction after: easy ${at.easy.toFixed(1)}s, hard ${at.hard.toFixed(1)}s`);
  assert.ok(at.easy - at.hard >= DIFFICULTY.easy.reactionDelay - DIFFICULTY.hard.reactionDelay - 3);
});

test('worker factor scales the economy, never the rules: no tier gets extra resources', () => {
  const drones = {};
  for (const d of ['easy', 'hard']) {
    const m = match(d);
    m.run(420);
    drones[d] = m.ai.mine('unit', 'drone').length;
    assert.equal(m.world.resources[2] >= 0, true);
  }
  assert.ok(drones.easy < drones.hard, `easy ${drones.easy} < hard ${drones.hard}`);
  // The worker target, plus the Drones sent to an expansion (Phase 3), plus one in training.
  assert.ok(drones.easy <= Math.floor(STRATEGIES.boom.workerTarget * DIFFICULTY.easy.workerFactor) + STRATEGIES.boom.expand.drones + 1);
});

test('seeded timing jitter makes repeated matches differ, but each seed replays exactly', () => {
  const run = (seed) => { const m = match('normal', 'turtle', seed); m.run(240); return m.ai.log.join('\n'); };
  assert.equal(run(21), run(21));
  assert.notEqual(run(21), run(22));
});
