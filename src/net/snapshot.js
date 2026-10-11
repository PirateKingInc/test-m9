// Phase 11 snapshots (PHASE11_SPEC.md "Snapshots and reconnection"): a whole
// match as data, restorable into an identical live match, and a hash of it.
//
// The serialisation itself is the lockstep module's codec
// (platform/lockstep/codec.js, Platform Milestone 1). This file is
// Dragonmarch's instance of it: the classes a match is made of, the static
// game data written by reference (unit tables, maps, strategies), the caches
// and closures to skip and rebuild, and Dragonmarch's RNG adoption.
import { createCodec, hashText, SeededRng } from '../../platform/lockstep/index.js';
import { World } from '../sim/world.js';
import { Grid } from '../sim/grid.js';
import { SpatialIndex } from '../sim/spatial.js';
import { Pathfinder } from '../sim/pathfinder.js';
import { Match } from '../ai/match.js';
import { AiEngine, SandboxBot } from '../ai/engine.js';
import { Scout } from '../ai/scout.js';
import * as UNITS_MOD from '../data/units.js';
import * as BUILDINGS_MOD from '../data/buildings.js';
import * as MAP_MOD from '../data/map.js';
import * as FFA_MOD from '../data/ffa.js';
import * as STRATEGIES_MOD from '../data/strategies.js';
import * as DIFFICULTY_MOD from '../data/difficulty.js';
import * as RIVALS_MOD from '../data/rivals.js';
import * as CAMP_RULES_MOD from '../data/camp-rules.js';

export { hashText };

// ---- a storable RNG, identical to src/sim/rng.js --------------------------------

// mulberry32, the same arithmetic as createRng(), with its state in a field:
// the module's SeededRng.
export const SerialRng = SeededRng;

// Replace a createRng() generator (whose state is hidden in a closure) by a
// SerialRng at exactly the same point of the same sequence. The original is
// probed (its next outputs consumed) and discarded; the replacement is found
// by stepping the same seed until those outputs line up.
export function adoptRng(orig, seeds, maxSteps = 100000) {
  const probe = [orig.next(), orig.next(), orig.next()];
  for (const seed of [].concat(seeds)) {
    const r = new SerialRng(seed);
    for (let k = 0; k < maxSteps; k++) {
      const at = r.s, t = new SerialRng(at);
      if (t.next() === probe[0] && t.next() === probe[1] && t.next() === probe[2]) return new SerialRng(at);
      r.next();
    }
  }
  throw new Error('adoptRng: the generator does not follow its seed');
}

// Swap every RNG of a freshly built match for its storable twin. Every peer
// does this at the same point (right after building the match).
export function adoptRngs(match, seed) {
  const w = match.world;
  w.rng = adoptRng(w.rng, seed);
  // Match seeds AI camps with its seed and a scripted player with seed + 7.
  for (const b of match.brains) b.rng = adoptRng(b.rng, [seed * 31 + b.team, (seed + 7) * 31 + b.team]);
  return match;
}

// ---- Dragonmarch's codec ----------------------------------------------------------

const codec = createCodec({
  classes: { World, Grid, SpatialIndex, Pathfinder, Match, AiEngine, SandboxBot, Scout, SerialRng },
  // Static data: every object reachable from the data modules' exports, by path.
  constants: { units: UNITS_MOD, buildings: BUILDINGS_MOD, map: MAP_MOD, ffa: FFA_MOD, strategies: STRATEGIES_MOD, difficulty: DIFFICULTY_MOD, rivals: RIVALS_MOD, camprules: CAMP_RULES_MOD },
  // Fields that are not state: caches, the PathFinding.js library and closures.
  skip: {
    World: ['PF', 'events', 'byKind'],
    Pathfinder: ['PF', 'finder', 'cache', 'views', 'frame', 'walk', 'touched'],
    AiEngine: ['issueFn'],
    SandboxBot: ['issueFn'],
  },
  // Rebuild what was not stored, exactly as the constructors create it.
  fixups: {
    World(w, { PF }) { w.PF = PF; w.events = []; w.byKind = null; },
    Pathfinder(p, { PF }) { const fresh = new Pathfinder(p.grid, PF); p.PF = fresh.PF; p.finder = fresh.finder; },
    AiEngine(e) { e.issueFn = (cmd) => e.w.issue(cmd); },
    SandboxBot(e) { e.issueFn = (cmd) => e.w.issue(cmd); },
  },
});

export const registerClass = codec.register;
export const encode = codec.encode;
export const decode = (data, { PF = globalThis.PF } = {}) => codec.decode(data, { PF });

// ---- text and hash ----------------------------------------------------------------

export const serialize = (root) => JSON.stringify(encode(root));
export const deserialize = (text, opts) => decode(JSON.parse(text), opts);
export const hashState = (root) => hashText(serialize(root));

// A fast per-tick fingerprint (the full hash is the proof; this one is cheap
// enough to take at every tick): time, ids, every camp's gold, the RNG, and
// every entity's position, health, order, path and queue, as exact bits.
const fp = new DataView(new ArrayBuffer(8));
export function quickHash(world) {
  let h = 0x811c9dc5;
  const mix = (x) => { fp.setFloat64(0, x); h = Math.imul(h ^ fp.getUint32(0), 0x01000193); h = Math.imul(h ^ fp.getUint32(4), 0x01000193); };
  mix(world.tick); mix(world.time); mix(world.nextId); mix(world.rng.s ?? -1);
  for (const t of world.teams) mix(world.resources[t] ?? 0);
  for (const e of world.entities.values()) {
    mix(e.id); mix(e.x); mix(e.y); mix(e.hp ?? -1); mix(e.amount ?? -1); mix(e.progress ?? -1); mix(e.carry ?? -1);
    mix(e.order ? e.order.type.length * 31 + (e.order.target ?? 0) : -1);
    mix(e.path ? e.path.length : -1); mix(e.queue ? e.queue.length : -1); mix(e.facing ?? 0);
  }
  return h >>> 0;
}
