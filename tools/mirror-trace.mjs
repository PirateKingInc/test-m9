// Mirror trace (BALANCE.md "Side bias" method, Phase 3; extended to the
// free-for-all's north-south mirror in Phase 8). Every camp plays the same
// script with timing jitter off and no scout; each tick, a camp's state is
// compared with the mirror image of its mirror partner. In a symmetric sim
// they stay identical; the first tick they differ points at the asymmetric rule.
//
//   node tools/mirror-trace.mjs [strategy] [seconds]
// Pairs: NW (1) vs SW (4) and NE (2) vs SE (3) across the east-west axis
// (y -> H - y); NW (1) vs NE (2) across the north-south axis (x -> W - x).
import PF from 'pathfinding';
import { Match } from '../src/ai/match.js';
import { STRATEGIES } from '../src/data/strategies.js';
import { DIFFICULTY } from '../src/data/difficulty.js';
import { FFA_MAP } from '../src/data/ffa.js';

export function trace({ strategy = 'boom', seconds = 120, seed = 1, stopAtFirst = true } = {}) {
  const diff = { ...DIFFICULTY.hard, jitter: 0 };
  const s = { ...STRATEGIES[strategy], scoutAt: null, waveJitter: 0 };
  const cfg = { strategy: s, difficulty: diff };
  const m = new Match({ seed, PF, ffa: { map: FFA_MAP, camps: { 2: cfg, 3: cfg, 4: cfg } }, player: cfg });
  const w = m.world, W = w.width, H = w.height, cols = w.grid.cols, rows = w.grid.rows;
  const snap = (team, mx, my) => ({
    lumen: Math.round(w.resources[team] * 1000),
    units: [...w.ofKind('unit')].filter((u) => u.team === team).map((u) => ({ t: u.type, x: mx ? W - u.x : u.x, y: my ? H - u.y : u.y, o: u.order.type })),
    buildings: [...w.ofKind('building')].filter((b) => b.team === team)
      .map((b) => `${b.type}@${mx ? cols - b.tx - b.w : b.tx},${my ? rows - b.ty - b.h : b.ty}:${b.progress.toFixed(3)}`).sort(),
  });
  const pairs = [[1, 4, false, true, 'NW-SW (y mirror)'], [2, 3, false, true, 'NE-SE (y mirror)'], [1, 2, true, false, 'NW-NE (x mirror)']];
  const found = {};
  while (w.time < seconds && Object.keys(found).length < pairs.length) {
    m.step();
    for (const [a, b, mx, my, name] of pairs) {
      if (found[name]) continue;
      const A = snap(a, false, false), B = snap(b, mx, my);
      let why = null;
      if (A.lumen !== B.lumen) why = `gold ${A.lumen / 1000} vs ${B.lumen / 1000}`;
      else if (JSON.stringify(A.buildings) !== JSON.stringify(B.buildings)) why = `buildings ${A.buildings.filter((x) => !B.buildings.includes(x))} vs ${B.buildings.filter((x) => !A.buildings.includes(x))}`;
      else if (A.units.length !== B.units.length) why = `unit count ${A.units.length} vs ${B.units.length}`;
      else {
        const used = new Set();
        for (const u of A.units) {
          const j = B.units.findIndex((v, i) => !used.has(i) && v.t === u.t && Math.abs(v.x - u.x) < 0.05 && Math.abs(v.y - u.y) < 0.05);
          if (j < 0) {
            const near = B.units.filter((v) => v.t === u.t).sort((p, q) => Math.hypot(p.x - u.x, p.y - u.y) - Math.hypot(q.x - u.x, q.y - u.y))[0];
            why = `${u.t} (${u.o}) at ${u.x.toFixed(2)},${u.y.toFixed(2)}; mirror's nearest ${near ? `${near.x.toFixed(2)},${near.y.toFixed(2)} (${near.o})` : 'none'}`;
            break;
          }
          used.add(j);
        }
      }
      if (why) found[name] = { t: w.time, why };
    }
    if (stopAtFirst && Object.keys(found).length) break;
  }
  return found;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [strategy = 'boom', seconds = '120'] = process.argv.slice(2);
  const r = trace({ strategy, seconds: Number(seconds), stopAtFirst: false });
  for (const [k, v] of Object.entries(r)) console.log(`${k}: first divergence at ${v.t.toFixed(2)} s: ${v.why}`);
  if (!Object.keys(r).length) console.log(`no divergence in ${seconds} s`);
}
