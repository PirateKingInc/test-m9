// Phase 7 verification (f): full four-camp free-for-alls with the multi-rival
// AI, every camp scripted (team 1 plays Merchant Kingdom, the AI camps their
// FFA_STRATEGIES), all acting through the read-only view, each played to its
// declared result. Compared with the Phase 6 placeholder on the same seeds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PF } from './helpers.js';
import { Match } from '../src/ai/match.js';
import { readonly } from '../src/ai/readonly.js';
import { FFA_MAP, FFA_STRATEGIES } from '../src/data/ffa.js';

// The same seeds played with `targeting: 'nearest'` (which reproduces Phase 6
// exactly, see the freeze guard): winner and elimination order ("fallen<-by").
const PHASE6 = {
  2: '4 3<-2 1<-2 2<-4',
  3: '3 4<-1 2<-3 1<-3',
  5: '1 4<-1 2<-1 3<-1',
  6: '4 1<-4 2<-3 3<-4',
};

function play(seed, targeting = 'assess') {
  const camps = Object.fromEntries(Object.entries(FFA_STRATEGIES).map(([t, s]) => [t, { strategy: s, difficulty: 'hard', targeting }]));
  const m = new Match({ seed, PF, ffa: { map: FFA_MAP, camps }, player: { strategy: 'boom', difficulty: 'hard', targeting }, view: readonly });
  const falls = [], captures = [];
  while (!m.world.result) {
    m.step();
    for (const e of m.world.drainEvents()) {
      if (e.type === 'eliminated') falls.push(e);
      if (e.type === 'zoneCaptured') captures.push({ ...e, t: m.world.time });
    }
  }
  return { m, r: m.world.result, falls, captures };
}

test('multi-rival FFA playthroughs: camps turn on weakened rivals, avoid stronger ones and claim land, and play differently from Phase 6', () => {
  const opportunism = [], claims = [], outcomes = {};
  for (const seed of Object.keys(PHASE6).map(Number)) {
    const { m, r, falls, captures } = play(seed);
    assert.ok(['last-standing', 'time-limit', 'draw'].includes(r.reason), `seed ${seed}: a declared result`);
    assert.equal(r.standings.length, 4);
    outcomes[seed] = `${r.winner} ${falls.map((f) => `${f.team}<-${f.by}`).join(' ')}`;
    for (const b of m.brains) {
      for (const x of b.reactions) {
        // A wave turning on a rival for what it saw (weaker, engaged, a damaged
        // Castle), not because its old target fell.
        const [, why = ''] = x.detail?.split(': ') ?? [];
        if (x.kind === 'retarget' && /-> camp/.test(x.detail) && !/fell\)/.test(x.detail) && /weaker|engaged|Castle/.test(why)) {
          opportunism.push(`seed ${seed} camp ${b.team} at ${x.t.toFixed(0)} s: ${x.detail}`);
        }
        // Backing off from clearly stronger rivals to claim a free zone, and taking it.
        const claim = (x.kind === 'cautious-claim' || (x.kind === 'retarget' && /-> claim/.test(x.detail))) && x.detail.match(/(?:-> claim|claiming) (\w+)/);
        if (claim) {
          const taken = captures.find((c) => c.zone === claim[1] && c.to === b.team && c.t >= x.t);
          claims.push({ seed, team: b.team, t: x.t, zone: claim[1], taken: taken?.t, detail: x.detail });
        }
      }
    }
    console.log(`# seed ${seed}: ${r.reason} at ${r.time.toFixed(0)} s, winner ${r.winner}; falls ${falls.map((f) => `${f.team} to ${f.by} at ${f.time.toFixed(0)} s`).join(', ')} (Phase 6: winner/falls ${PHASE6[seed]})`);
  }
  for (const o of opportunism) console.log(`# retarget: ${o}`);
  for (const c of claims) console.log(`# claim: seed ${c.seed} camp ${c.team} at ${c.t.toFixed(0)} s -> ${c.zone}${c.taken ? `, taken at ${c.taken.toFixed(0)} s` : ''} (${c.detail})`);
  assert.ok(opportunism.length >= 1, 'at least one camp changes target after seeing a rival weakened');
  assert.ok(claims.some((c) => c.taken != null), 'at least one camp avoids stronger rivals and takes a free zone instead');
  const differ = Object.keys(PHASE6).filter((s) => outcomes[s] !== PHASE6[s]);
  assert.ok(differ.length >= 3, `outcomes differ from Phase 6 on most seeds (${differ.length} of ${Object.keys(PHASE6).length})`);
});

test('the Phase 6 outcomes above are what targeting: nearest produces', () => {
  const { r, falls } = play(2, 'nearest');
  assert.equal(`${r.winner} ${falls.map((f) => `${f.team}<-${f.by}`).join(' ')}`, PHASE6[2]);
});
