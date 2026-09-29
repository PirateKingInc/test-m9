// Phase 8 four-camp batch runner (PHASE8_SPEC.md "Part B"): the corner
// arrangements, their mirror classes, and one full match's record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangements, classes, jobsFor, playFfa, aggregate, STRATS } from '../tools/ffa-lib.mjs';

const key = (a) => [1, 2, 3, 4].map((t) => a[t]).join('/');

test('36 arrangements, each with all three strategies and one doubled', () => {
  const all = arrangements();
  assert.equal(all.length, 36);
  assert.equal(new Set(all.map(key)).size, 36);
  for (const a of all) {
    for (const s of STRATS) assert.ok(Object.values(a).includes(s));
    assert.equal(new Set(Object.values(a)).size, 3);
  }
});

test('9 mirror classes of 4 distinct images cover every arrangement once', () => {
  const cls = classes();
  assert.equal(cls.length, 9);
  const seen = cls.flatMap((c) => c.images.map(key));
  assert.equal(seen.length, 36);
  assert.equal(new Set(seen).size, 36);
  for (const s of STRATS) for (const rel of ['north-south neighbours', 'east-west neighbours', 'diagonal']) {
    assert.equal(cls.filter((c) => c.doubled === s && c.relation === rel).length, 1, `${s} doubled as ${rel}`);
  }
});

test('each class\'s seeds are spread evenly over its mirror images, so every corner hosts every role equally', () => {
  const jobs = jobsFor({ seeds: 100 });
  assert.equal(jobs.length, 900);
  for (let c = 0; c < 9; c++) {
    const mine = jobs.filter((j) => j.cls === c);
    const per = {};
    for (const j of mine) per[key(j.arrangement)] = (per[key(j.arrangement)] || 0) + 1;
    assert.deepEqual(Object.values(per), [25, 25, 25, 25]);
    for (const t of [1, 2, 3, 4]) {
      const counts = {};
      for (const j of mine) counts[j.arrangement[t]] = (counts[j.arrangement[t]] || 0) + 1;
      const doubled = classes()[c].doubled;
      assert.equal(counts[doubled], 50, `class ${c}: the doubled strategy holds corner ${t} in half the seeds`);
    }
  }
});

test('one full free-for-all gives a complete record, and aggregation counts it', () => {
  const r = playFfa({ arrangement: { 1: 'boom', 2: 'rush', 3: 'boom', 4: 'turtle' }, seed: 3, cls: 0 });
  assert.ok(['last-standing', 'time-limit', 'draw'].includes(r.reason));
  assert.equal(Object.keys(r.camps).length, 4);
  for (const c of Object.values(r.camps)) assert.ok(c.place >= 1 && c.place <= 4 && c.attacks >= 0 && c.claims >= 0);
  if (r.winner != null) assert.equal(r.camps[r.winner].place, 1);
  const agg = aggregate([r]);
  assert.equal(agg.n, 1);
  assert.equal(Object.values(agg.byStrategy).reduce((n, b) => n + b.wins, 0) + agg.draws, 1);
});
