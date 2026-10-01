#!/usr/bin/env node
// Phase 12 economy check (PHASE12_SPEC.md "Economy"): how close each camp's
// supply gets to the cap over a 30-minute match, and how much gold it mined.
// The "dedicated economy player" is the sentinel script (a defensive economy
// that never attacks), played against itself to the time limit; the three AI
// strategies are measured in ordinary 1v1 matches against each other.
//
//   node tools/economy.mjs [--seeds 1,2,3] [--phase11]   (--phase11: the Phase 11 cap and maps, for comparison)
import { createRequire } from 'node:module';
import { Match } from '../src/ai/match.js';
import { SUPPLY } from '../src/data/buildings.js';
import { supplyOf } from '../src/sim/supply.js';
import { withPhase11 } from '../test/phase11-data.js';

const PF = createRequire(import.meta.url)('pathfinding/visual/lib/pathfinding-browser.min.js');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const seeds = arg('seeds', '1,2,3').split(',').map(Number);

// Play one match to its end, sampling each team's supply every 10 s.
function play(player, ai, seed) {
  const m = new Match({ seed, PF, player: { strategy: player, difficulty: 'hard' }, ai: { strategy: ai, difficulty: 'hard' } });
  const peak = { 1: { used: 0, at: 0 }, 2: { used: 0, at: 0 } }, mined = { 1: 0, 2: 0 }, at = {};
  let last = { ...m.world.resources };
  while (!m.world.result) {
    m.step();
    for (const t of [1, 2]) { const d = m.world.resources[t] - last[t]; if (d > 0) mined[t] += d; }
    last = { ...m.world.resources };
    if (m.world.tick % 200 === 0) {
      for (const t of [1, 2]) {
        const s = supplyOf(m.world, t);
        if (s.used > peak[t].used) peak[t] = { used: s.used, at: m.world.time };
        for (const frac of [0.5, 0.75, 0.9]) if (s.used >= frac * SUPPLY.max && !at[`${t}-${frac}`]) at[`${t}-${frac}`] = m.world.time;
      }
    }
  }
  const r = m.world.result;
  return { player, ai, seed, result: `${r.winner}/${r.reason}/${r.time.toFixed(0)}`, peak, mined, at };
}

function run() {
  const rows = [];
  for (const seed of seeds) rows.push(play('sentinel', 'sentinel', seed));
  for (const seed of seeds) for (const [a, b] of [['boom', 'rush'], ['boom', 'turtle'], ['turtle', 'rush']]) rows.push(play(a, b, seed));
  console.log(`cap ${SUPPLY.max}`);
  for (const r of rows) {
    const t = (k) => (r.at[k] != null ? `${(r.at[k] / 60).toFixed(1)} min` : '-');
    console.log(`${r.player} vs ${r.ai} seed ${r.seed} (${r.result}): peak supply ${r.peak[1].used} / ${r.peak[2].used} (at ${(r.peak[1].at / 60).toFixed(1)} / ${(r.peak[2].at / 60).toFixed(1)} min), mined ${r.mined[1]} / ${r.mined[2]}, team 1 reached 50/75/90% of cap at ${t('1-0.5')}, ${t('1-0.75')}, ${t('1-0.9')}`);
  }
  return rows;
}

if (argv.includes('--phase11')) withPhase11(run); else run();
