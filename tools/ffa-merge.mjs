#!/usr/bin/env node
// Merges free-for-all batch files run in seed chunks (tools/ffa-balance.mjs
// --seeds 20 --offset 0, 20, 40...) into one, with the combined summary. With
// chunk sizes a multiple of 4 the jobs are exactly those of a single run.
//
//   node tools/ffa-merge.mjs --out balance/ffa-phase12.json balance/chunk-*.json
import { readFileSync, writeFileSync } from 'node:fs';
import { aggregate, report } from './ffa-lib.mjs';

const argv = process.argv.slice(2);
const out = argv[argv.indexOf('--out') + 1];
const files = argv.filter((a, i) => a !== '--out' && argv[i - 1] !== '--out');
const parts = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
const results = parts.flatMap((p) => p.results);
const seeds = parts.reduce((n, p) => n + p.seeds, 0), tier = parts[0].tier;
const agg = aggregate(results);
writeFileSync(out, `{"seeds":${seeds},"seedOffset":0,"tier":"${tier}","generated":"${new Date().toISOString()}","chunks":${JSON.stringify(parts.map((p) => [p.seedOffset, p.seeds]))},\n"summary":${JSON.stringify(agg)},\n"results":[\n${results.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`);
console.log(report(agg, { title: `${seeds} seeds per class, ${tier} timing (merged from ${files.length} chunks)` }));
