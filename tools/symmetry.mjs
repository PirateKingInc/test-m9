// Phase 8 march symmetry (PHASE8_SPEC.md "Pathfinding symmetry"): every
// one-way march between two free-for-all camps, each the median (and mean) of
// 24 slightly shifted 20-unit marches, then every march against its
// north-south and east-west mirror twin. A single march is chaotic: float
// rounding (W - x is not bit-exact) grows into seconds in a 20-unit crowd, so
// symmetry is judged on the median.
//   node tools/symmetry.mjs [samples=24]
import { roundTrip } from '../test/travel.js';
import { FFA_MAP } from '../src/data/ffa.js';

const n = Number(process.argv[2] || 24);
const shifts = Array.from({ length: n }, (_, i) => [((i * 37) % 17) - 8, ((i * 53) % 17) - 8]);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const leg = {};
const NAME = { 1: 'NW', 2: 'NE', 3: 'SE', 4: 'SW' };
for (let a = 1; a <= 4; a++) for (let b = 1; b <= 4; b++) {
  if (a === b) continue;
  const t = shifts.map((s) => roundTrip(a, b, 1, FFA_MAP, s).there);
  leg[`${a}-${b}`] = { median: median(t), mean: t.reduce((x, y) => x + y, 0) / t.length };
}
console.log('| March | Median | Mean |\n|---|---|---|');
for (const [k, v] of Object.entries(leg)) { const [a, b] = k.split('-'); console.log(`| ${NAME[a]}→${NAME[b]} | ${v.median.toFixed(2)} s | ${v.mean.toFixed(2)} s |`); }
const my = { 1: 4, 4: 1, 2: 3, 3: 2 }, mx = { 1: 2, 2: 1, 3: 4, 4: 3 };
for (const [name, m] of [['north-south mirror', my], ['east-west mirror', mx]]) {
  console.log(`\n${name}:`);
  const seen = new Set();
  for (const k of Object.keys(leg)) {
    const [a, b] = k.split('-'), twin = `${m[a]}-${m[b]}`;
    if (seen.has(twin)) continue;
    seen.add(k);
    const d = Math.abs(leg[k].median - leg[twin].median);
    console.log(`  ${NAME[a]}→${NAME[b]} ${leg[k].median.toFixed(2)} vs ${NAME[m[a]]}→${NAME[m[b]]} ${leg[twin].median.toFixed(2)}: ${d.toFixed(2)} s${d > 0.5 ? '  (over 0.5 s)' : ''}`);
  }
}
