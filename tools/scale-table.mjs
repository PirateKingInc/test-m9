#!/usr/bin/env node
// Phase 12: prints the PHASE12_SPEC.md result tables from the measurement
// files, each cell marked against the budget (a pass is plain, a miss **bold**).
//
//   node tools/scale-table.mjs headless perf/scale-headless.json
//   node tools/scale-table.mjs browser perf/scale-browser.json
import { readFileSync } from 'node:fs';

const [kind, file] = process.argv.slice(2);
const data = JSON.parse(readFileSync(file, 'utf8'));
const f = (x, d = 1) => x.toFixed(d);
const mark = (x, limit, d = 1, over = true) => ((over ? x > limit : x < limit) ? `**${f(x, d)}**` : f(x, d));

if (kind === 'headless') {
  console.log('| Map | Army | Cap | Units | Tick mean (≤ 5) | p95 | p99 (≤ 16.7) | p99 range | Slowest (≤ 50) | Ticks > 50 ms per run | First tick |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of data.cells) {
    console.log(`| ${c.map} | ${c.mix} | ${c.cap} | ${c.units} | ${mark(c.tick.mean, 5, 2)} | ${f(c.tick.p95)} | ${mark(c.tick.p99, 16.7)} | ${c.p99Range.map((x) => f(x)).join('–')} | ${mark(c.tick.max, 50)} | ${c.tick.over50.join(' / ')} | ${f(c.firstTick)} |`);
  }
} else {
  for (const profile of ['mobile', 'desktop']) {
    const rows = data.rows.filter((r) => r.profile === profile);
    if (!rows.length) continue;
    const [p50, p95, rate] = profile === 'mobile' ? [33.3, 66.7, 19] : [16.7, 33.3, 19.5];
    console.log(`\n**${profile === 'mobile' ? 'Mobile proxy (844 × 390, touch, 4x CPU throttle)' : 'Desktop (1280 × 800)'}** — ms of main-thread JavaScript; budget p50 ≤ ${p50}, p95 ≤ ${p95}, sim ≥ ${rate} ticks/s\n`);
    console.log('| Map | Army | Cap | Units | Sim ticks/s | One-tick frame p50 | One-tick frame p95 | Raw frame p50 | Raw frame p95 | Ticks per frame | Tick p50 / p95 | fps (not judged) |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      const one = r.oneTickFrame ? `${mark(r.oneTickFrame.p50, p50)} | ${mark(r.oneTickFrame.p95, p95)}` : '– | –';
      const tick = r.tick ? `${f(r.tick.p50)} / ${f(r.tick.p95)}` : '–';
      console.log(`| ${r.map} | ${r.mix} | ${r.cap} | ${r.units} | ${mark(r.simRate, rate, 1, false)} | ${one} | ${mark(r.frameJs.p50, p50)} | ${mark(r.frameJs.p95, p95)} | ${r.ticksPerFrame ? f(r.ticksPerFrame) : '–'} | ${tick} | ${f(r.fps)} |`);
    }
  }
}
