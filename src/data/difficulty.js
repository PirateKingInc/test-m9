// Gameplay values only: player-facing names and text live in src/theme (Phase 5).
// Difficulty tiers (SPEC.md "Difficulty"). Difficulty picks the default strategy,
// how tightly its script is timed and (Phase 3) how much production it runs; it
// never makes the AI smarter or gives it resources. Phase 3 balanced the three
// strategies against each other, so a tier's strength now comes from execution:
// the Foundry cap is the handicap that measurably orders the tiers (test/fairness).
// Defaults were re-picked from the Phase 3 policy x tier x strategy measurement.
export const DIFFICULTY = {
  easy: {
    strategy: 'turtle',
    decisionInterval: 2.5, // s between engine decisions
    stepDelay: 2, // s of extra idle time after each opening step
    reactionDelay: 25, // s before a scouting trigger takes effect
    workerFactor: 0.7, // x the strategy's worker target
    jitter: 0.3, // +/- share of random slack on each decision and step delay (seeded)
    maxFoundries: 1, // Phase 3: production handicap (the strategy's own cap applies below this)
  },
  normal: {
    strategy: 'rush',
    decisionInterval: 1.2, stepDelay: 2, reactionDelay: 10, workerFactor: 0.9, jitter: 0.2, maxFoundries: 2,
  },
  hard: {
    strategy: 'boom',
    decisionInterval: 0.5, stepDelay: 0, reactionDelay: 3, workerFactor: 1.0, jitter: 0.1,
  },
};
