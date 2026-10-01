#!/usr/bin/env node
// Phase 12 headless scale measurement (PHASE12_SPEC.md "Part A"). For each map
// (1v1, free-for-all), army composition and supply cap: a real match with
// every camp's AI running, armies filled to the cap, a forced clash at 5 s,
// 150 s of simulation. Measures every tick (world + AI) and every
// pathfinding call. Runs sequentially in one process: parallel runs would
// share the CPU and distort the timings.
//
//   node tools/scale.mjs [--caps 60,100,150,200,250,300] [--maps 1v1,ffa] [--mixes mix,swarm] [--seeds 1,2,3] [--seconds 150] [--out perf/scale-headless.json]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { Match } from '../src/ai/match.js';
import { FFA_MAP } from '../src/data/ffa.js';
import { SIM_DT } from '../src/sim/constants.js';
import { setCap, fillArmies, charge, unitCount } from './scale-scenario.js';

const PF = createRequire(import.meta.url)('pathfinding/visual/lib/pathfinding-browser.min.js');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const caps = arg('caps', '60,100,150,200,250,300').split(',').map(Number);
const maps = arg('maps', '1v1,ffa').split(',');
const mixes = arg('mixes', 'mix,swarm').split(',');
const seconds = Number(arg('seconds', 150));
const out = arg('out', 'perf/scale-headless.json');
const seeds = arg('seeds', '1,2,3').split(',').map(Number);

const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

export function newMatch(map, s = 1) {
  return map === 'ffa'
    ? new Match({ seed: s, PF, ffa: { map: FFA_MAP, camps: { 2: { strategy: 'rush', difficulty: 'hard' }, 3: { strategy: 'boom', difficulty: 'hard' }, 4: { strategy: 'turtle', difficulty: 'hard' } } }, player: { strategy: 'boom', difficulty: 'hard' } })
    : new Match({ seed: s, PF, ai: { strategy: 'rush', difficulty: 'hard' }, player: { strategy: 'turtle', difficulty: 'hard' } });
}

export function measure({ map, cap, mix, seed = 1, secs = seconds, matchFactory = newMatch }) {
  const old = setCap(cap);
  try {
    const m = matchFactory(map, seed);
    const armies = fillArmies(m.world, cap, mix);
    const pf = m.world.pathfinder;
    let pfMs = 0, pfCalls = 0, depth = 0; // (the methods call each other: time the outermost call only)
    for (const fn of ['find', 'findInFrame', 'nearestReachable']) {
      const orig = pf[fn].bind(pf);
      pf[fn] = (...a) => {
        if (depth++) { try { return orig(...a); } finally { depth--; } }
        const t = performance.now();
        try { return orig(...a); } finally { depth--; pfMs += performance.now() - t; pfCalls++; }
      };
    }
    const tickMs = [], pathMs = [], counts = [];
    const start = unitCount(m.world);
    const ticks = Math.round(secs / SIM_DT);
    let firstTick = 0;
    for (let i = 0; i < ticks && !m.world.result; i++) {
      pfMs = 0;
      const t = performance.now();
      if (i === Math.round(5 / SIM_DT)) charge(m.world); // (a command is applied inside a frame: timed with its tick)
      m.step();
      // The first tick builds the map's pathfinding grids and JIT-compiles
      // this map's code paths, with a full army already standing there (the
      // AI orders it out at once): a one-off at match start, reported apart.
      if (i === 0) { firstTick = performance.now() - t; continue; }
      tickMs.push(performance.now() - t);
      pathMs.push(pfMs);
      if (i % Math.round(10 / SIM_DT) === 0) counts.push(unitCount(m.world));
    }
    return {
      map, cap, mix, seed, units: start, perCamp: armies, ticks: tickMs.length + 1, firstTick,
      tick: { mean: mean(tickMs), p50: quant(tickMs, 0.5), p95: quant(tickMs, 0.95), p99: quant(tickMs, 0.99), max: Math.max(...tickMs), maxAt: tickMs.indexOf(Math.max(...tickMs)) + 1, over50: tickMs.filter((x) => x > 50).length },
      path: { meanPerTick: mean(pathMs), p99PerTick: quant(pathMs, 0.99), maxPerTick: Math.max(...pathMs), calls: pfCalls },
      unitsEvery10s: counts, result: m.world.result ? m.world.result.reason : null,
    };
  } finally { setCap(old); }
}

// One cell of the table: the median of each measure over the seeds (timings
// in a shared container vary run to run), and the worst slowest tick.
const med = (a) => quant(a, 0.5);
export function summarise(runs) {
  const pick = (f) => runs.map(f);
  return {
    map: runs[0].map, cap: runs[0].cap, mix: runs[0].mix, seeds: pick((r) => r.seed), units: runs[0].units,
    tick: { mean: med(pick((r) => r.tick.mean)), p95: med(pick((r) => r.tick.p95)), p99: med(pick((r) => r.tick.p99)), max: Math.max(...pick((r) => r.tick.max)), over50: pick((r) => r.tick.over50) },
    p99Range: [Math.min(...pick((r) => r.tick.p99)), Math.max(...pick((r) => r.tick.p99))],
    firstTick: Math.max(...pick((r) => r.firstTick)),
    path: { p99PerTick: med(pick((r) => r.path.p99PerTick)), maxPerTick: Math.max(...pick((r) => r.path.maxPerTick)) },
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  for (const map of maps) measure({ map, cap: 60, mix: 'mix', secs: 20 }); // JIT warm-up on each map, discarded
  const runs = [], cells = [];
  const f = (x) => x.toFixed(2);
  for (const map of maps) for (const mix of mixes) for (const cap of caps) {
    const rs = seeds.map((seed) => measure({ map, cap, mix, seed }));
    runs.push(...rs);
    const c = summarise(rs);
    cells.push(c);
    console.log(`${map.padEnd(4)} ${mix.padEnd(5)} cap ${String(cap).padStart(3)}: ${String(c.units).padStart(4)} units  tick mean ${f(c.tick.mean)} p95 ${f(c.tick.p95)} p99 ${f(c.tick.p99)} [${c.p99Range.map(f).join('-')}] max ${f(c.tick.max)} (>50 ms: ${c.tick.over50.join('/')})  first ${f(c.firstTick)}  path/tick p99 ${f(c.path.p99PerTick)} max ${f(c.path.maxPerTick)} ms`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ generated: new Date().toISOString(), seconds, seeds, node: process.version, cells, runs }, null, 1)}\n`);
}
