// Canonical form of every gameplay value in src/data (Phase 5). Display text
// (names, roles, descriptions) lives in src/theme and is not part of it, so a
// reskin can never move this hash, and any change to a stat, cost, time, counter,
// strategy threshold or map value does.
import { createHash } from 'node:crypto';
import * as buildings from '../src/data/buildings.js';
import * as units from '../src/data/units.js';
import * as strategies from '../src/data/strategies.js';
import * as difficulty from '../src/data/difficulty.js';
import * as map from '../src/data/map.js';

const DISPLAY = new Set(['name', 'role', 'description']);

// Sorted keys, display fields dropped, non-JSON numbers spelled out.
function canon(v) {
  if (typeof v === 'number' && !Number.isFinite(v)) return `#${v}`;
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) if (!DISPLAY.has(k)) out[k] = canon(v[k]);
    return out;
  }
  return v;
}

export function gameplayValues() {
  return canon({ buildings: { ...buildings }, units: { ...units }, strategies: { ...strategies }, difficulty: { ...difficulty }, map: { ...map } });
}

export const gameplayHash = () => createHash('sha256').update(JSON.stringify(gameplayValues())).digest('hex');
