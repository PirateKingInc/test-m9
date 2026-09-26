// Fairness harness (SPEC.md Phase 2 "Fairness protocol"): scripted player-side
// policies vs each difficulty tier over fixed seeds. Deterministic by seed.
import { PF } from '../helpers.js';
import { Match } from '../../src/ai/match.js';
import { DIFFICULTY } from '../../src/data/difficulty.js';
import { difficultyName } from '../../src/theme/names.js';

export const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);

// A beginner is slower than the Easy AI. Phase 2 defined the novice as "Rush at
// Easy timing", which is exactly the Easy AI's own script and timing: once
// Phase 3 removed the side bias, novice-vs-Easy became a pure mirror and a coin
// flip. Phase 3 makes the novice deliberately slower than Easy instead.
export const NOVICE_TIMING = {
  ...DIFFICULTY.easy, name: 'Novice',
  decisionInterval: 4, // vs Easy's 2.5 s
  stepDelay: 6, // vs Easy's 2 s (Easy's Phase 2 value)
  reactionDelay: 40, // vs Easy's 25 s
  workerFactor: 0.6, // vs Easy's 0.7
};

export const POLICIES = {
  competent: { strategy: 'boom', difficulty: 'hard' },
  intermediate: { strategy: 'turtle', difficulty: 'easy' },
  novice: { strategy: 'rush', difficulty: NOVICE_TIMING },
};

// Player (team 1) win rate for one policy against one tier's default strategy.
export function winRate(tier, policy) {
  let wins = 0, losses = 0, draws = 0;
  const times = [];
  for (const seed of SEEDS) {
    const m = new Match({ seed, PF, ai: { strategy: 'auto', difficulty: tier }, player: POLICIES[policy] });
    const r = m.runToEnd();
    times.push(Math.round(r.time));
    if (r.winner === 1) wins++; else if (r.winner === 2) losses++; else draws++;
  }
  const rate = wins / SEEDS.length;
  console.error(`# ${difficultyName(tier).padEnd(6)} AI (${DIFFICULTY[tier].strategy}) vs ${policy.padEnd(12)}: player wins ${wins}/${SEEDS.length} (${Math.round(rate * 100)}%), AI ${losses}, draws ${draws}; median length ${times.sort((a, b) => a - b)[6]}s`);
  return rate;
}

// Required thresholds (player win rate).
export const REQUIRE = {
  competentMin: { easy: 0.75, normal: 0.5, hard: 0.1 },
  noviceMax: 0.5,
  hardBeatsIntermediate: 0.75, // i.e. intermediate player wins at most 25% vs Hard
};
