// Phase 12 equivalence (PHASE12_SPEC.md "Regression"). Phase 12 changes data
// only where the scale needs it: the supply cap and the Storehouse's supply,
// the route-planning budget (and, in its map slice, the maps and their gold). This module holds the
// Phase 11 values of exactly those fields, so the earlier fixed-seed
// fingerprints can be replayed with them put back: if every one still
// reproduces, the Phase 12 code changed nothing but through these values.
import { SUPPLY, BUILDINGS } from '../src/data/buildings.js';
import { PATHING } from '../src/data/scale.js';

// Layers, so each Phase 12 slice can be checked on its own:
// [live object, its Phase 11 fields]
export const PHASE11 = {
  supply: [
    [SUPPLY, { max: 60 }],
    [BUILDINGS.depot, { supply: 8 }],
  ],
  // Phase 11 had no limit on route planning per tick (Phase 12's first,
  // count-based budget was sized never to be reached at that scale).
  pathing: [
    [PATHING, { workPerTick: Infinity }],
  ],
};

// Run fn with the Phase 11 values of the given layers in place, then restore
// the live ones.
export function withPhase11(fn, layers = Object.keys(PHASE11)) {
  const pairs = layers.flatMap((l) => PHASE11[l]);
  const saved = pairs.map(([o, v]) => [o, Object.fromEntries(Object.keys(v).map((k) => [k, o[k]]))]);
  for (const [o, v] of pairs) Object.assign(o, structuredClone(v));
  try { return fn(); } finally { for (const [o, v] of saved) Object.assign(o, v); }
}
