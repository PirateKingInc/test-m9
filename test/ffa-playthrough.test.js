// Phase 6 verification (g): a full four-camp free-for-all, every camp scripted,
// played to its final result. Team 1 plays Merchant Kingdom as a scripted
// player; the AI camps play their assigned scripts (FFA_STRATEGIES) with the
// placeholder targeting. All four act through a read-only view of the world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PF } from './helpers.js';
import { Match } from '../src/ai/match.js';
import { readonly } from '../src/ai/readonly.js';
import { FFA_MAP, FFA_STRATEGIES } from '../src/data/ffa.js';

test('a four-camp free-for-all plays to a declared result, with eliminations that capture land and loot', () => {
  const camps = Object.fromEntries(Object.entries(FFA_STRATEGIES).map(([t, s]) => [t, { strategy: s, difficulty: 'hard' }]));
  const m = new Match({ seed: 1, PF, ffa: { map: FFA_MAP, camps }, player: { strategy: 'boom', difficulty: 'hard' }, view: readonly });
  const w = m.world;
  const captures = [], falls = [];
  while (!w.result) {
    m.step();
    for (const e of w.drainEvents()) {
      if (e.type === 'zoneCaptured') captures.push(e);
      if (e.type === 'eliminated') {
        // Right after the transfer, the conqueror owns every zone the fallen camp had.
        const owners = e.zones.map((id) => w.zones.find((z) => z.id === id).owner);
        falls.push({ ...e, owners, conquerorGold: w.resources[e.by] });
      }
    }
  }
  const r = w.result;
  console.log(`# FFA seed 1: ${r.reason} at ${r.time.toFixed(0)} s, winner ${r.winner}; ${captures.length} zone captures; `
    + falls.map((f) => `camp ${f.team} fell to ${f.by} at ${f.time.toFixed(0)} s (+${f.gold} gold, zones ${f.zones.join('/')})`).join('; '));
  assert.ok(['last-standing', 'time-limit', 'draw'].includes(r.reason), 'a declared result');
  assert.equal(r.standings.length, 4, 'every camp is ranked');
  assert.ok(captures.some((c) => c.from === null), 'neutral zones were taken by military control');
  const captured = falls.filter((f) => f.by != null);
  assert.ok(captured.length >= 1, 'at least one camp was eliminated by another');
  for (const f of captured) {
    assert.ok(f.zones.length >= 1, `camp ${f.team} lost its land`);
    assert.ok(f.owners.every((o) => o === f.by), `camp ${f.team}'s zones went to ${f.by}`);
    assert.ok(f.conquerorGold >= f.gold, 'the conqueror banked the loot');
  }
  for (const t of r.eliminated.map((e) => e.team)) {
    assert.equal([...w.entities.values()].filter((e) => e.team === t).length, 0, `camp ${t} left nothing standing`);
  }
});
