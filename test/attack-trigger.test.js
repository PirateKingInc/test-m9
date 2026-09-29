// Phase 8 free-for-all attack triggers (PHASE8_SPEC.md "Part C"): Boom and
// Turtle also launch a wave on an opportunity once their home army reaches
// RIVALS.attack[strategy].opportunitySupply, instead of only at their usual
// (large) army-supply threshold. Crimson (team 2, north-east) is the camp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenario } from './rivals-helpers.js';
import { RIVALS } from '../src/data/rivals.js';

// A camp of `strategy` with a home army of `supply` (Shield Knights, 3 each,
// plus Archers) and, optionally, Rose seen weakened next door.
function camp(strategy, { supply = 18, roseWeak = true } = {}) {
  const s = scenario({ strategy });
  s.w.time = 400;
  const knights = Math.floor(supply / 3);
  const home = [...s.at('bulwark', 2, 78, 16, knights), ...s.at('sparker', 2, 76, 20, supply - knights * 3)];
  s.ai.stats.waves = 1; // past the first wave: its usual threshold is its waveSupply
  if (roseWeak) { // a lookout sees Rose's army at 20%
    s.at('striker', 2, 80, 58);
    s.at('striker', 3, 80, 60, 4, 0.2);
  }
  s.home = home;
  s.think = () => { s.ai.scout.scan(); s.ai.intelCache = null; s.ai.commandArmy(); };
  return s;
}

for (const strategy of ['boom', 'turtle']) {
  test(`${strategy}: a weakened target draws a wave at the opportunity threshold, well below its usual one`, () => {
    const need = RIVALS.attack[strategy].opportunitySupply;
    const s = camp(strategy, { supply: need + 2 });
    s.think();
    assert.equal(s.ai.mode, 'attack');
    assert.equal(s.ai.goal.team, 3, 'at Rose');
    assert.equal(s.ai.stats.opportunities, 1);
    assert.match(s.ai.reactions.find((r) => r.kind === 'opportunity').detail, /^camp 3 seen weaker: wave at \d+ supply/);
  });

  test(`${strategy}: no opportunity, no early wave (its usual threshold still applies)`, () => {
    const s = camp(strategy, { supply: RIVALS.attack[strategy].opportunitySupply + 2, roseWeak: false });
    s.think();
    assert.equal(s.ai.mode, 'gather');
    assert.ok(s.home.every((u) => u.order.type === 'idle'));
  });

  test(`${strategy}: below the opportunity threshold, no wave even on an opportunity`, () => {
    const s = camp(strategy, { supply: 8 });
    s.think();
    assert.equal(s.ai.mode, 'gather');
  });
}

test('rush has no opportunity trigger (it already attacks by unit count)', () => {
  const s = camp('rush', { supply: 18 });
  s.ai.stats.waves = 1;
  s.think();
  assert.ok(!s.ai.reactions.some((r) => r.kind === 'opportunity'));
});

test('an engaged target counts as an opportunity too', () => {
  const s = camp('boom', { supply: 20, roseWeak: false });
  s.at('striker', 2, 81, 61); // a lookout between them
  const rose = s.at('bulwark', 3, 78, 60, 6), jade = s.at('bulwark', 4, 83, 60, 6); // both about our equal; Rose busy with Jade
  for (const u of rose) u.order = { type: 'attack', target: jade[0].id };
  s.think();
  assert.match(s.ai.reactions.find((r) => r.kind === 'opportunity')?.detail || '', /engaged with camp 4/);
});
