#!/usr/bin/env node
// Four-camp free-for-all batch runner (Phase 8, PHASE8_SPEC.md "Part B").
// Every corner arrangement of the three strategies (9 mirror classes x 4 mirror
// images), all four camps scripted at one difficulty's timing, N seeds per
// class spread evenly over its images, each played to its declared result.
//
//   node tools/ffa-balance.mjs --seeds 100 --out balance/ffa-baseline.json [--tier hard] [--offset 0] [--workers 4]
//
// Deterministic: the same seeds and code give identical results.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { jobsFor, runPool, aggregate, report } from './ffa-lib.mjs';

const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] == null || all[i + 1].startsWith('--') ? true : all[i + 1]]] : acc), []));
const seeds = Number(args.seeds || 100), seedOffset = Number(args.offset || 0), tier = args.tier || 'hard';
const out = args.out || 'balance/ffa-latest.json';
const jobs = jobsFor({ seeds, seedOffset, tier });
const t0 = Date.now();
let lastLog = 0;
const results = await runPool(jobs, {
  workers: args.workers ? Number(args.workers) : undefined,
  onResult: (_r, done, total) => {
    if (Date.now() - lastLog > 60000 || done === total) { lastLog = Date.now(); console.error(`${done}/${total} matches (${Math.round((Date.now() - t0) / 1000)} s)`); }
  },
});
const agg = aggregate(results);
mkdirSync(dirname(out), { recursive: true });
// Compact per-match records (one line each) so the raw data stays small.
writeFileSync(out, `{"seeds":${seeds},"seedOffset":${seedOffset},"tier":"${tier}","generated":"${new Date().toISOString()}",\n"summary":${JSON.stringify(agg)},\n"results":[\n${results.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`);
console.log(report(agg, { title: `${seeds} seeds per class, ${tier} timing (offset ${seedOffset})` }));
