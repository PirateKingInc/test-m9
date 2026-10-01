#!/usr/bin/env node
// Phase 12: how soon the AI raids a weak player camp in the free-for-all.
// Camp 1 has no brain (its Castle and four Peasants, nothing else); the
// other camps play their FFA_STRATEGIES at Easy, as in the touch playthrough.
// Prints, per seed, when the first enemy soldier comes within the touch
// playthrough bot's watch radius of camp 1's Castle (1,250 px on the 120-tile
// map, scaled with the map: 1,000 px on Phase 11's 96 tiles) and when camp 1
// is eliminated (up to 20:00).
//
//   node tools/raid-timing.mjs [--seeds 1,...,20] [--phase11 | --old-supply | --old-maps]
// --phase11 replays with every Phase 12 data change undone; --old-supply
// undoes only the cap and Storehouse, --old-maps only the maps (and the
// route budget) (test/phase11-data.js).
import { createRequire } from 'node:module';
import { Match } from '../src/ai/match.js';
import { FFA_MAP, FFA_STRATEGIES } from '../src/data/ffa.js';
import { withPhase11 } from '../test/phase11-data.js';

const PF = createRequire(import.meta.url)('pathfinding/visual/lib/pathfinding-browser.min.js');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const seeds = arg('seeds', Array.from({ length: 20 }, (_, i) => i + 1).join(',')).split(',').map(Number);

function run(seed) {
  const camps = Object.fromEntries(Object.entries(FFA_STRATEGIES).map(([t, s]) => [t, { strategy: s, difficulty: 'easy' }]));
  const m = new Match({ seed, PF, ffa: { map: FFA_MAP, camps }, player: null });
  const w = m.world, core = [...w.ofKind('building')].find((b) => b.team === 1 && b.type === 'core');
  const watch = 1250 * FFA_MAP.cols / 120;
  let first = null, by = null, fell = null;
  while (!w.result && w.time < 1200 && fell == null) {
    m.step();
    if (first == null) for (const u of w.ofKind('unit')) if (u.team !== 1 && u.type !== 'drone' && Math.hypot(u.x - core.x, u.y - core.y) < watch) { first = w.time; by = u.team; break; }
    for (const e of w.drainEvents()) if (e.type === 'eliminated' && e.team === 1) fell = e.time;
  }
  return { seed, firstRaid: first, by, fell };
}

function all() {
  const rows = seeds.map(run);
  for (const r of rows) console.log(`seed ${r.seed}: first raid ${r.firstRaid == null ? '-' : `${Math.round(r.firstRaid)} s (camp ${r.by})`}, fell ${r.fell == null ? '-' : `${Math.round(r.fell)} s`}`);
  const v = (k) => rows.map((r) => r[k] ?? Infinity).sort((a, b) => a - b), q = (a, p) => a[Math.floor(p * (a.length - 1))];
  const f = v('firstRaid'), e = v('fell');
  console.log(`raided ${f.filter(Number.isFinite).length}/${rows.length}, fell ${e.filter(Number.isFinite).length}/${rows.length}; first raid quartiles ${[0.25, 0.5, 0.75].map((p) => Math.round(q(f, p))).join(' / ')} s; median fall ${Math.round(q(e, 0.5))} s`);
}

if (argv.includes('--phase11')) withPhase11(all);
else if (argv.includes('--old-supply')) withPhase11(all, ['supply']);
else if (argv.includes('--old-maps')) withPhase11(all, ['maps', 'pathing']);
else all();
