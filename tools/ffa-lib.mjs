// Four-camp free-for-all batch runner helpers (Phase 8, PHASE8_SPEC.md
// "Part B"): corner arrangements and their mirror classes, one headless match,
// a worker pool, aggregation and the report.
import { fork } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { createRequire } from 'node:module';
import { Match } from '../src/ai/match.js';
import { FFA_MAP } from '../src/data/ffa.js';

export const STRATS = ['rush', 'boom', 'turtle'];
export const CORNERS = { 1: 'NW', 2: 'NE', 3: 'SE', 4: 'SW' };
// The map's symmetries (both mirrors and the half turn) as corner permutations.
const SYMMETRIES = [
  { 1: 1, 2: 2, 3: 3, 4: 4 },
  { 1: 2, 2: 1, 3: 4, 4: 3 }, // east-west mirror
  { 1: 4, 2: 3, 3: 2, 4: 1 }, // north-south mirror
  { 1: 3, 2: 4, 3: 1, 4: 2 }, // half turn
];
const RELATION = (a, b) => ([a, b].sort().join('') === '14' || [a, b].sort().join('') === '23' ? 'north-south neighbours'
  : [a, b].sort().join('') === '12' || [a, b].sort().join('') === '34' ? 'east-west neighbours' : 'diagonal');

// All 36 arrangements (team -> strategy): one strategy doubled, all three present.
export function arrangements() {
  const out = [];
  for (const x of STRATS) {
    const others = STRATS.filter((s) => s !== x);
    for (let a = 1; a <= 4; a++) for (let b = a + 1; b <= 4; b++) {
      const rest = [1, 2, 3, 4].filter((t) => t !== a && t !== b);
      for (const [p, q] of [[others[0], others[1]], [others[1], others[0]]]) out.push({ [a]: x, [b]: x, [rest[0]]: p, [rest[1]]: q });
    }
  }
  return out;
}

const key = (arr) => [1, 2, 3, 4].map((t) => arr[t]).join('/');

// The 9 classes: each is one arrangement and its 4 mirror images.
export function classes() {
  const seen = new Set(), out = [];
  for (const arr of arrangements()) {
    if (seen.has(key(arr))) continue;
    const images = SYMMETRIES.map((g) => Object.fromEntries([1, 2, 3, 4].map((t) => [g[t], arr[t]])));
    for (const im of images) seen.add(key(im));
    const doubled = STRATS.find((s) => [1, 2, 3, 4].filter((t) => arr[t] === s).length === 2);
    const [a, b] = [1, 2, 3, 4].filter((t) => arr[t] === doubled);
    out.push({ name: `${doubled} x2, ${RELATION(a, b)}`, doubled, relation: RELATION(a, b), images });
  }
  return out;
}

// Jobs: `seeds` per class, spread evenly over its 4 mirror images.
export function jobsFor({ seeds = 100, seedOffset = 0, tier = 'hard' } = {}) {
  const jobs = [];
  for (const [ci, c] of classes().entries()) {
    for (let s = 1; s <= seeds; s++) jobs.push({ cls: ci, arrangement: c.images[(s - 1) % 4], seed: s + seedOffset, tier });
  }
  return jobs;
}

const PF = createRequire(import.meta.url)('pathfinding/visual/lib/pathfinding-browser.min.js');

// One full free-for-all, every camp scripted. `ffaParams` overrides are
// merged into each camp's strategy (tuning experiments only).
export function playFfa({ arrangement, seed, tier = 'hard', cls = null }) {
  const cfg = (t) => ({ strategy: arrangement[t], difficulty: tier });
  const m = new Match({ seed, PF, ffa: { map: FFA_MAP, camps: { 2: cfg(2), 3: cfg(3), 4: cfg(4) } }, player: cfg(1) });
  const falls = [];
  while (!m.world.result) {
    m.step();
    for (const e of m.world.drainEvents()) if (e.type === 'eliminated') falls.push({ team: e.team, by: e.by ?? null, time: Math.round(e.time) });
  }
  const r = m.world.result;
  const camps = Object.fromEntries(m.brains.map((b) => [b.team, {
    strategy: arrangement[b.team], waves: b.stats.waves, attacks: b.stats.attacks || 0, claims: b.stats.claims || 0, retargets: b.stats.retargets || 0,
    scouts: b.stats.scouts || 0, place: r.standings.find((s) => s.team === b.team)?.place ?? null,
  }]));
  return { cls, seed, arrangement, winner: r.winner ?? null, reason: r.reason, time: Math.round(r.time), falls, camps };
}

export function runPool(jobs, { workers = availableParallelism(), onResult = () => {} } = {}) {
  const url = new URL('./ffa-worker.mjs', import.meta.url);
  const chunks = Array.from({ length: Math.min(workers, jobs.length) }, () => []);
  jobs.forEach((j, i) => chunks[i % chunks.length].push(j));
  const results = [];
  return Promise.all(chunks.map((chunk) => new Promise((resolve, reject) => {
    const child = fork(url, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    child.on('message', (msg) => {
      if (msg.result) { results.push(msg.result); onResult(msg.result, results.length, jobs.length); }
      if (msg.done) { child.kill(); resolve(); }
    });
    child.on('error', reject);
    child.on('exit', (code) => { if (code) reject(new Error(`worker exited ${code}`)); });
    child.send({ jobs: chunk });
  }))).then(() => results.sort((x, y) => x.cls - y.cls || x.seed - y.seed));
}

// 95% Wilson score interval.
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

export function aggregate(results) {
  const n = results.length;
  const byStrategy = Object.fromEntries(STRATS.map((s) => [s, { wins: 0, matches: 0, camps: 0, placeSum: 0, fallTimes: [], attacks: [], claims: [], waves: [], retargets: [] }]));
  const byCorner = Object.fromEntries([1, 2, 3, 4].map((t) => [t, { wins: 0, placeSum: 0 }]));
  const byClass = {};
  let draws = 0, timeLimit = 0, totalTime = 0;
  for (const r of results) {
    totalTime += r.time;
    if (r.reason === 'time-limit') timeLimit++;
    if (r.winner == null) draws++;
    else { byStrategy[r.arrangement[r.winner]].wins++; byCorner[r.winner].wins++; }
    const c = (byClass[r.cls] ||= { n: 0, wins: Object.fromEntries(STRATS.map((s) => [s, 0])), draws: 0 });
    c.n++;
    if (r.winner == null) c.draws++; else c.wins[r.arrangement[r.winner]]++;
    for (const s of STRATS) if (Object.values(r.arrangement).includes(s)) byStrategy[s].matches++;
    for (const [t, cs] of Object.entries(r.camps)) {
      const b = byStrategy[cs.strategy];
      b.camps++; b.placeSum += cs.place ?? 4; b.attacks.push(cs.attacks); b.claims.push(cs.claims); b.waves.push(cs.waves); b.retargets.push(cs.retargets || 0);
      byCorner[t].placeSum += cs.place ?? 4;
    }
    for (const f of r.falls) byStrategy[r.arrangement[f.team]].fallTimes.push(f.time);
  }
  for (const b of Object.values(byStrategy)) {
    b.share = b.wins / n; b.perCamp = b.wins / b.camps; b.ci = wilson(b.wins, n); b.avgPlace = b.placeSum / b.camps;
    b.avgFall = b.fallTimes.length ? b.fallTimes.reduce((x, y) => x + y, 0) / b.fallTimes.length : null;
    b.attacksMean = b.attacks.reduce((x, y) => x + y, 0) / b.camps; b.attacksMedian = median(b.attacks);
    b.claimsMean = b.claims.reduce((x, y) => x + y, 0) / b.camps; b.wavesMean = b.waves.reduce((x, y) => x + y, 0) / b.camps;
    b.retargetsMean = b.retargets.reduce((x, y) => x + y, 0) / b.camps;
    b.attackedOnce = b.attacks.filter((a) => a >= 1).length / b.camps;
    delete b.fallTimes; delete b.attacks; delete b.claims; delete b.waves; delete b.retargets;
  }
  for (const c of Object.values(byCorner)) { c.share = c.wins / n; c.ci = wilson(c.wins, n); c.avgPlace = c.placeSum / n; }
  return { n, draws, timeLimit, avgTime: totalTime / n, byStrategy, byCorner, byClass };
}

const pct = (x) => `${Math.round(x * 100)}%`;
export function report(agg, { title = '' } = {}) {
  const L = [];
  if (title) L.push(`### ${title}`, '');
  L.push(`${agg.n} matches; ${agg.draws} draws; ${agg.timeLimit} decided at the time limit; average length ${(agg.avgTime / 60).toFixed(1)} min.`, '');
  L.push('| Strategy | FFAs won (chance 33%) | Per camp (chance 25%) | Avg place | Avg elimination | Attacks per camp (mean / median) | Camps attacking ≥ once | Claims per camp | Retargets per camp |', '|---|---|---|---|---|---|---|---|---|');
  for (const [s, b] of Object.entries(agg.byStrategy)) {
    L.push(`| ${s} | **${pct(b.share)}** (${pct(b.ci[0])}–${pct(b.ci[1])}) | ${pct(b.perCamp)} | ${b.avgPlace.toFixed(2)} | ${b.avgFall == null ? '–' : `${(b.avgFall / 60).toFixed(1)} min`} | ${b.attacksMean.toFixed(2)} / ${b.attacksMedian} | ${pct(b.attackedOnce)} | ${b.claimsMean.toFixed(2)} | ${b.retargetsMean.toFixed(2)} |`);
  }
  L.push('', '| Corner | FFAs won (chance 25%) | Avg place |', '|---|---|---|');
  for (const [t, c] of Object.entries(agg.byCorner)) L.push(`| ${CORNERS[t]} | **${pct(c.share)}** (${pct(c.ci[0])}–${pct(c.ci[1])}) | ${c.avgPlace.toFixed(2)} |`);
  const cls = classes();
  L.push('', `| Class (${Math.round(agg.n / 9)} seeds each) | Rush wins | Boom wins | Turtle wins | Draws |`, '|---|---|---|---|---|');
  for (const [i, c] of Object.entries(agg.byClass)) L.push(`| ${cls[i].name} | ${c.wins.rush} | ${c.wins.boom} | ${c.wins.turtle} | ${c.draws} |`);
  const worstS = Object.entries(agg.byStrategy).sort((a, b) => b[1].share - a[1].share)[0];
  const worstC = Object.entries(agg.byCorner).sort((a, b) => b[1].share - a[1].share)[0];
  L.push('', `Targets: strategy ≤ ~50% — worst ${worstS[0]} ${pct(worstS[1].share)} (${worstS[1].share <= 0.505 ? 'met' : 'MISSED'}); corner ≤ ~35% — worst ${CORNERS[worstC[0]]} ${pct(worstC[1].share)} (${worstC[1].share <= 0.355 ? 'met' : 'MISSED'}).`);
  return L.join('\n');
}
