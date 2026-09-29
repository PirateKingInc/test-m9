// Phase 8 stale intel and re-scouting (PHASE8_SPEC.md "Part D"). Crimson
// (team 2, north-east) is the AI camp under test. It sees Azure (team 1) weak
// once; Azure then rebuilds out of sight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenario } from './rivals-helpers.js';
import { rankRivals } from '../src/ai/rivals.js';
import { RIVALS } from '../src/data/rivals.js';
import { FFA_MAP } from '../src/data/ffa.js';
import { Match } from '../src/ai/match.js';
import { PF } from './helpers.js';

const T = FFA_MAP.tile;
const azure = (r) => r.ranking.find((x) => x.team === 1);

// Crimson's army of 10 at home; a lookout of its sees Azure's 2 Horsemen and
// its Castle at 20% at t = 400, then leaves. Azure then fields 12 Shield
// Knights at home, where Crimson has no eyes.
function seenWeakOnce() {
  const s = scenario();
  s.w.time = 400;
  s.at('striker', 2, 80, 18, 10);
  const castle = [...s.w.ofKind('building')].find((b) => b.team === 1 && b.type === 'core');
  castle.hp = castle.maxHp * 0.2;
  const lookout = s.at('striker', 2, 16, 14);
  const horsemen = s.at('striker', 1, 18, 16, 2);
  s.rank = () => { s.ai.scout.scan(); return rankRivals(s.ai, null); };
  const first = s.rank();
  for (const u of lookout) s.w.removeEntity(u); // the lookout leaves (nothing more seen of Azure)
  for (const u of horsemen) s.w.removeEntity(u); // and Azure's Horsemen go elsewhere, unseen
  s.at('bulwark', 1, 14, 9, 12); // Azure rebuilds beside its Castle, unseen
  return { ...s, first, castle };
}

test('fresh intel is used as seen', () => {
  const { first } = seenWeakOnce();
  const a = azure(first);
  assert.equal(a.confidence, 1);
  assert.ok(a.R < 0.5, `seen weak: R ${a.R.toFixed(2)}`);
  assert.ok(a.why.includes('weaker') && a.why.includes('Castle 20%'));
});

test('ageing intel is blended toward "assumed equal" and labelled stale', () => {
  const s = seenWeakOnce();
  s.w.time = 400 + 30;
  assert.equal(azure(s.rank()).confidence, 1, 'within freshFor (45 s): still trusted');
  s.w.time = 400 + 80;
  const a = azure(s.rank());
  const c = 1 - (80 - RIVALS.intel.freshFor) / (RIVALS.intel.staleAt - RIVALS.intel.freshFor);
  assert.ok(Math.abs(a.confidence - c) < 1e-9, `confidence ${a.confidence.toFixed(3)}`);
  assert.ok(Math.abs(a.R - (1 + c * (a.Rseen - 1))) < 1e-9, 'R blended toward 1');
  assert.ok(a.R > a.Rseen, `not trusted as weak as it looked: ${a.R.toFixed(2)} > ${a.Rseen.toFixed(2)}`);
  assert.ok(Math.abs(a.castle - c * 0.8) < 1e-9, 'Castle damage blended too');
  assert.match(a.why[0], /^stale intel \(80 s\)/);
});

test('past the window the camp does not act on the stale "weak" read (Azure has since rebuilt)', () => {
  const s = seenWeakOnce();
  s.w.time = 400 + RIVALS.intel.staleAt + 10;
  const r = s.rank();
  const a = azure(r);
  assert.equal(a.R, 1, 'assumed equal, not weak');
  assert.equal(a.castle, 0, 'no bonus for a Castle it last saw at 20% long ago');
  assert.ok(!a.why.includes('weaker'));
  // Its score is now what an unknown equal rival at that distance scores:
  // nothing pulls the camp toward Azure over its nearer neighbour.
  assert.ok(a.score <= -0.49 + 1e-9, `Azure ${a.score.toFixed(2)}`);
  assert.equal(r.target, 3, 'the nearest rival, Rose, not the Azure that looked weak 160 s ago');
});

test('a re-scout catches the change: the scoring updates to the rebuilt army', () => {
  const s = seenWeakOnce();
  s.w.time = 400 + 130; // older than rescoutAfter (120 s)
  // Crimson's economy: Peasants mining at home.
  const node = [...s.w.ofKind('node')].sort((p, q) => Math.hypot(p.x - 86 * T, p.y - 14 * T) - Math.hypot(q.x - 86 * T, q.y - 14 * T))[0];
  const drones = s.at('drone', 2, 82, 12, 4);
  s.w.issue({ type: 'gather', ids: drones.map((d) => d.id), node: node.id, team: 2 });
  s.ai.scout.scoutDone = true; // the first scout is long back
  s.ai.lastTarget = 1; // Azure is the current target
  s.ai.nextThinkAt = 0;
  for (let i = 0; i < 120 / 0.05 && !s.ai.reactions.some((x) => x.kind === 'rescout'); i++) { s.w.step(); s.ai.update(); }
  const sent = s.ai.reactions.find((x) => x.kind === 'rescout');
  assert.match(sent.detail, /^camp 1: intel 13\d s old/, 'Azure, the current target, is re-scouted first');
  const before = azure(rankRivals(s.ai, 1));
  assert.ok(before.confidence < 1);
  // Walk there and look (the Phase 2 scout's walk and loiter).
  for (let i = 0; i < 100 / 0.05 && s.ai.scout.rescout; i++) { s.w.step(); s.ai.update(); }
  assert.equal(s.ai.scout.rescout, null, 'the re-scout finished');
  s.ai.scout.scan();
  const after = azure(rankRivals(s.ai, 1));
  assert.ok(after.confidence === 1, 'fresh again');
  assert.ok(after.seen >= 15, `sees the Shield Knights (army value ${after.seen})`);
  assert.ok(after.R >= RIVALS.caution && after.why.includes('clearly stronger'), `R ${after.R.toFixed(2)}`);
  assert.notEqual(rankRivals(s.ai, 1).target, 1, 'no longer a target');
});

test('re-scouting is free-for-all only, one Peasant at a time, and spaced out', () => {
  // 1v1: the scout goes once, as in Phase 2.
  const m = new Match({ seed: 4, PF, ai: { strategy: 'boom', difficulty: 'hard' }, player: { strategy: 'boom', difficulty: 'hard' } });
  m.run(600);
  assert.ok(!m.brains.some((b) => b.reactions.some((x) => x.kind === 'rescout')));
  // Free-for-all: re-scouts happen, never two at once, at least rescoutEvery apart.
  const camps = { 2: { strategy: 'rush', difficulty: 'hard' }, 3: { strategy: 'boom', difficulty: 'hard' }, 4: { strategy: 'turtle', difficulty: 'hard' } };
  const f = new Match({ seed: 4, PF, ffa: { map: FFA_MAP, camps }, player: { strategy: 'boom', difficulty: 'hard' } });
  let overlap = false;
  while (f.world.time < 600 && !f.world.result) {
    f.step();
    for (const b of f.brains) if (b.scout.rescout && !b.scout.scoutDone) overlap = true;
  }
  const times = f.brains.map((b) => b.reactions.filter((x) => x.kind === 'rescout').map((x) => x.t));
  assert.ok(times.flat().length >= 2, `re-scouts sent: ${times.flat().length}`);
  for (const ts of times) for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] >= RIVALS.intel.rescoutEvery - 1e-6);
  assert.equal(overlap, false, 'never alongside the first scout');
});
