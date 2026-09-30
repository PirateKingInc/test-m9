// Phase 11 snapshots (PHASE11_SPEC.md "Snapshots and reconnection"): a whole
// match as data, restorable into an identical live match, and a hash of it.
//
// A graph serialisation of the live objects: plain objects and arrays, Map,
// Set, typed arrays, instances of the registered classes, shared references and
// cycles, and exact numbers (-0, NaN, Infinity and undefined are kept, since
// JSON would lose them). Static game data (unit tables, the map, strategies)
// is written as a reference by name, never copied, so a restored match points
// at the same objects. Caches are dropped and rebuilt; closures are rebuilt by
// the per-class fixups below. Anything unexpected (an unregistered class, a
// function in a field) throws: a snapshot is exact or it is refused.
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

// ---- a storable RNG, identical to src/sim/rng.js --------------------------------

// mulberry32, the same arithmetic as createRng(), with its state in a field.
export class SerialRng {
  constructor(state) { this.s = state >>> 0; }
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
}

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

// ---- registries -------------------------------------------------------------------

const CLASSES = new Map(); // name -> class
const NAMES = new Map(); // prototype -> name
export function registerClass(name, cls) { CLASSES.set(name, cls); NAMES.set(cls.prototype, name); }
for (const [n, c] of Object.entries({ World, Grid, SpatialIndex, Pathfinder, Match, AiEngine, SandboxBot, Scout, SerialRng })) registerClass(n, c);

// Static data: every object reachable from the data modules' exports, by path.
const EXT = new Map(); // object -> path
const EXT_BY_PATH = new Map();
function walkData(v, path) {
  if (v === null || typeof v !== 'object' || EXT.has(v)) return;
  EXT.set(v, path);
  EXT_BY_PATH.set(path, v);
  for (const k of Object.keys(v)) walkData(v[k], `${path}.${k}`);
}
for (const [mod, m] of Object.entries({ units: UNITS_MOD, buildings: BUILDINGS_MOD, map: MAP_MOD, ffa: FFA_MOD, strategies: STRATEGIES_MOD, difficulty: DIFFICULTY_MOD, rivals: RIVALS_MOD, camprules: CAMP_RULES_MOD })) {
  for (const [k, v] of Object.entries(m)) walkData(v, `${mod}.${k}`);
}

// Fields that are not state: caches, the PathFinding.js library and closures.
// They are rebuilt by FIXUPS after a restore.
const SKIP = {
  World: new Set(['PF', 'events', 'byKind']),
  Pathfinder: new Set(['PF', 'finder', 'cache', 'views', 'frame']),
  AiEngine: new Set(['issueFn']),
  SandboxBot: new Set(['issueFn']),
};

// ---- encode -----------------------------------------------------------------------

export function encode(root) {
  const ids = new Map();
  let next = 1;
  const enc = (v, path) => {
    if (v === undefined) return { $u: 1 };
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') return Number.isFinite(v) && !Object.is(v, -0) ? v : { $n: Object.is(v, -0) ? '-0' : String(v) };
    if (typeof v === 'function') throw new Error(`snapshot: a function in state at ${path}`);
    if (typeof v !== 'object') throw new Error(`snapshot: unsupported ${typeof v} at ${path}`);
    const ext = EXT.get(v);
    if (ext) return { $x: ext };
    if (ids.has(v)) return { $r: ids.get(v) };
    const id = next++;
    ids.set(v, id);
    if (Array.isArray(v)) return { $i: id, $a: v.map((x, i) => enc(x, `${path}[${i}]`)) };
    if (v instanceof Map) return { $i: id, $m: [...v].map(([k, x]) => [enc(k, `${path}<key>`), enc(x, `${path}<${String(k)}>`)]) };
    if (v instanceof Set) return { $i: id, $s: [...v].map((x) => enc(x, `${path}<set>`)) };
    if (ArrayBuffer.isView(v)) return { $i: id, $t: v.constructor.name, d: Array.from(v) };
    const proto = Object.getPrototypeOf(v);
    let cls = null;
    if (proto !== Object.prototype && proto !== null) {
      cls = NAMES.get(proto);
      if (!cls) throw new Error(`snapshot: unregistered class ${proto.constructor?.name} at ${path}`);
    }
    const skip = cls && SKIP[cls], o = {};
    for (const k of Object.keys(v)) if (!skip || !skip.has(k)) o[k] = enc(v[k], `${path}.${k}`);
    return cls ? { $i: id, $c: cls, $o: o } : { $i: id, $o: o };
  };
  return enc(root, '$');
}

// ---- decode -----------------------------------------------------------------------

const TYPED = { Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, Uint8ClampedArray };

export function decode(data, { PF = globalThis.PF } = {}) {
  const objs = new Map();
  const made = []; // [object, class name] for the fixups
  const dec = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if ('$u' in v) return undefined;
    if ('$n' in v) return v.$n === '-0' ? -0 : Number(v.$n);
    if ('$x' in v) { const o = EXT_BY_PATH.get(v.$x); if (!o) throw new Error(`snapshot: unknown data ${v.$x}`); return o; }
    if ('$r' in v) { if (!objs.has(v.$r)) throw new Error(`snapshot: dangling reference ${v.$r}`); return objs.get(v.$r); }
    if ('$a' in v) { const a = []; objs.set(v.$i, a); for (const x of v.$a) a.push(dec(x)); return a; }
    if ('$m' in v) { const m = new Map(); objs.set(v.$i, m); for (const [k, x] of v.$m) m.set(dec(k), dec(x)); return m; }
    if ('$s' in v) { const s = new Set(); objs.set(v.$i, s); for (const x of v.$s) s.add(dec(x)); return s; }
    if ('$t' in v) { const t = new TYPED[v.$t](v.d); objs.set(v.$i, t); return t; }
    const cls = v.$c ? CLASSES.get(v.$c) : null;
    if (v.$c && !cls) throw new Error(`snapshot: unknown class ${v.$c}`);
    const o = cls ? Object.create(cls.prototype) : {};
    objs.set(v.$i, o);
    for (const k of Object.keys(v.$o)) o[k] = dec(v.$o[k]);
    if (cls) made.push([o, v.$c]);
    return o;
  };
  const root = dec(data);
  for (const [o, name] of made) FIXUPS[name]?.(o, PF);
  return root;
}

// Rebuild what was not stored: caches and closures, exactly as the
// constructors create them.
const FIXUPS = {
  World(w, PF) { w.PF = PF; w.events = []; w.byKind = null; },
  Pathfinder(p, PF) { const fresh = new Pathfinder(p.grid, PF); p.PF = fresh.PF; p.finder = fresh.finder; },
  AiEngine(e) { e.issueFn = (cmd) => e.w.issue(cmd); },
  SandboxBot(e) { e.issueFn = (cmd) => e.w.issue(cmd); },
};

// ---- text and hash ----------------------------------------------------------------

export const serialize = (root) => JSON.stringify(encode(root));
export const deserialize = (text, opts) => decode(JSON.parse(text), opts);

// 64-bit FNV-1a over the serialized text, as 16 hex digits.
export function hashText(s) {
  let h1 = 0x811c9dc5, h2 = 0xcbf29ce4;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c * 31 + (i & 0xff)), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

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
