// Phase 5: the running game shows no Phase 1-4 names anywhere the player looks:
// the title menu, the HUD, command-card tooltips, selection panels, every
// tutorial step (mouse and touch wording) and the result screen.
import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';
import { oldNamesIn } from '../test/oldnames.js';
import { STEPS } from '../src/game/tutorial.js';

// Everything visible plus every tooltip on the page.
const pageText = (page) => page.evaluate(() => [document.title, document.body.innerText,
  ...[...document.querySelectorAll('[title]')].map((e) => e.title),
  ...[...document.querySelectorAll('option')].map((e) => e.textContent)].join('\n'));

test('menu, HUD, tooltips, selection and result screen use only fantasy names', async ({ page }) => {
  const errors = await openGame(page, '?mode=match'); // routes the CDN, then the menu
  await page.goto('/');
  const seen = [];
  await expect(page.locator('#menu')).toBeVisible();
  for (const d of ['easy', 'normal', 'hard']) {
    await page.locator(`button[data-difficulty="${d}"]`).click();
    for (const s of ['auto', 'rush', 'boom', 'turtle']) { await page.locator('#strategy').selectOption(s); seen.push(await pageText(page)); }
  }
  await openGame(page, '?mode=match&difficulty=normal');
  // Select each kind of thing so its panel, hint and command card render.
  const pick = async (fn, arg) => {
    await page.evaluate(fn, arg);
    await page.waitForTimeout(150);
    seen.push(await pageText(page));
  };
  await pick(() => { const ui = window.__game.scene.ui; ui.selection.set([...window.__game.world.ofKind('unit')].filter((u) => u.team === 1).map((u) => u.id)); });
  await pick(() => { const ui = window.__game.scene.ui; ui.selection.set([[...window.__game.world.ofKind('node')][0].id]); });
  await pick(() => { const ui = window.__game.scene.ui; ui.selection.set([[...window.__game.world.ofKind('building')].find((b) => b.team === 1).id]); });
  await pick(() => { const ui = window.__game.scene.ui; ui.selection.set([[...window.__game.world.ofKind('building')].find((b) => b.team === 2).id]); });
  // A finished Barracks and Watchtower, and a unit being trained, for their tooltips.
  await pick(() => {
    const { world, scene } = window.__game;
    world.resources[1] = 5000;
    for (const [type, tx] of [['foundry', 14], ['spire', 18], ['depot', 22]]) world.addBuilding(type, 1, tx, 18, { built: true }); // test setup
    const f = [...world.ofKind('building')].find((b) => b.team === 1 && b.type === 'foundry');
    world.issue({ type: 'train', building: f.id, unit: 'lancer', team: 1 });
    scene.ui.selection.set([f.id]);
  });
  // Rejection toasts, as translated for the player.
  await pick(() => { const { world } = window.__game; world.resources[1] = 0; const c = [...world.ofKind('building')].find((b) => b.team === 1 && b.type === 'core'); world.issue({ type: 'train', building: c.id, unit: 'drone', team: 1 }); });
  await expect(page.locator('#toast')).toHaveText('Not enough gold');
  // Every selectable panel for the Watchtower and Storehouse too.
  for (const type of ['spire', 'depot']) await pick((type) => { const { world, scene } = window.__game; scene.ui.selection.set([[...world.ofKind('building')].find((b) => b.team === 1 && b.type === type).id]); }, type);
  // The result screen, for each ending.
  for (const r of [{ winner: 1, reason: 'core-destroyed' }, { winner: 2, reason: 'core-destroyed' }, { winner: null, reason: 'draw' }, { winner: 1, reason: 'time-limit' }]) {
    await pick((r) => window.__game.scene.hud.showResult({ ...r, loser: null, time: 600, scores: { 1: 10, 2: 5 } }), r);
  }
  const hits = seen.flatMap((t) => oldNamesIn(t));
  expect([...new Set(hits)]).toEqual([]);
  expect(errors).toEqual([]);
});

test('every tutorial step, in mouse and touch wording, uses only fantasy names', async () => {
  const text = STEPS.flatMap((s) => [s.text, s.touch]).join('\n');
  expect(oldNamesIn(text)).toEqual([]);
});
