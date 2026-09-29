// Phase 7 dev panel targeting view (PHASE7_SPEC.md "Dev panel: targeting
// view"): one block per AI camp with its ranking and reasons, rendered from
// what the brains last computed, never asking them to compute anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PF } from './helpers.js';
import { Match } from '../src/ai/match.js';
import { FFA_MAP, FFA_STRATEGIES } from '../src/data/ffa.js';
import { targetingHtml } from '../src/game/devai.js';

test('the targeting view lists each AI camp\'s ranking with names and reasons, read-only', () => {
  const camps = Object.fromEntries(Object.entries(FFA_STRATEGIES).map(([t, s]) => [t, { strategy: s, difficulty: 'hard' }]));
  const m = new Match({ seed: 2, PF, ffa: { map: FFA_MAP, camps } });
  m.run(30);
  const before = m.brains.map((b) => b.intelCache);
  const html = targetingHtml(m.brains);
  assert.deepEqual(m.brains.map((b) => b.intelCache), before, 'rendering computed nothing');
  assert.equal((html.match(/class="dev-ai-camp"/g) || []).length, 3);
  assert.equal((html.match(/<li/g) || []).length, 9, 'three rivals each');
  assert.match(html, /Crimson<\/b> · building up/);
  assert.match(html, /<li class="pick"><b style="color:#d45aa8">Rose<\/b>/, 'Crimson\'s pick: Rose, the nearest');
  assert.ok(!/camp \d/.test(html), 'team numbers shown as camp names');
  assert.equal(targetingHtml(new Match({ seed: 2, PF }).brains), '', 'nothing in the 1v1 match');
});
