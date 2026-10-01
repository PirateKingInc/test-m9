// Phase 12 equivalence (PHASE12_SPEC.md "Regression"). Phase 12 changes data
// only where the scale needs it: the supply cap and the Storehouse's supply
// (and, in its map slice, the maps and their gold). This module holds the
// Phase 11 values of exactly those fields, so the earlier fixed-seed
// fingerprints can be replayed with them put back: if every one still
// reproduces, the Phase 12 code changed nothing but through these values.
import { SUPPLY, BUILDINGS } from '../src/data/buildings.js';

// [live object, its Phase 11 fields]
export const PHASE11 = [
  [SUPPLY, { max: 60 }],
  [BUILDINGS.depot, { supply: 8 }],
];

// Run fn with the Phase 11 values in place, then restore the live ones.
export function withPhase11(fn) {
  const saved = PHASE11.map(([o, v]) => [o, Object.fromEntries(Object.keys(v).map((k) => [k, o[k]]))]);
  for (const [o, v] of PHASE11) Object.assign(o, structuredClone(v));
  try { return fn(); } finally { for (const [o, v] of saved) Object.assign(o, v); }
}
