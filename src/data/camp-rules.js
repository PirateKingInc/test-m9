// Phase 9 camp rules (PHASE9_SPEC.md): auto-defend, moving a structure and
// hopeless-camp elimination. Gameplay values only.

// Part A: idle combat units in a zone their camp owns engage intruders.
export const AUTO_DEFEND = {
  scanEvery: 0.5, // s between checks (tick-aligned)
  returnSlack: 16, // px from its post at which a unit counts as back
};

// Part B: moving a completed building.
export const RELOCATE = {
  costShare: 0.5, // of the building's cost, rounded down, paid on confirmation
  timeShare: 0.5, // of its build time
  fixed: ['core'], // types that cannot move
};

// Part C: a camp that provably can never produce a unit or income again.
export const HOPELESS = {
  checkEvery: 1, // s between checks (tick-aligned)
  confirm: 5, // s the predicate must hold before the camp is eliminated
};
