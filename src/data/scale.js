// Gameplay values only: player-facing names and text live in src/theme (Phase 5).
// Scale limits (Phase 12, PHASE12_SPEC.md): what keeps a big battle within the
// performance budget, as data.
export const PATHING = {
  // Route planning a tick may do: pathfinding nodes touched (by A* and by the
  // flood fill toward an unreachable goal) before further route requests wait
  // for the next tick. Sized from the measured cost (PHASE12_SPEC.md "The
  // route-search budget"); Infinity would be Phase 11's unlimited planning.
  workPerTick: 50000,
};
