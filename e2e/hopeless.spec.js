// Phase 9 hopeless camps in the browser (PHASE9_SPEC.md "Part C"): when the
// AI camp can never produce again, the match ends with a clear result card.
import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';

test('1v1: an AI camp with no army, no Peasant and no gold loses as hopeless; the card says why', async ({ page }) => {
  const errors = await openGame(page, '?mode=match&seed=4&difficulty=easy');
  await page.evaluate(() => {
    const { world, match } = window.__game;
    match.brains.length = 0; // test setup: the AI stops playing
    for (const u of [...world.ofKind('unit')].filter((x) => x.team === 2)) world.removeEntity(u);
    for (const b of world.ofKind('building')) if (b.team === 2) b.queue.length = 0; // nothing in training either
    world.resources[2] = 0;
  });
  await expect(page.locator('#result')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#result-title')).toHaveText('Victory');
  await expect(page.locator('#result-detail')).toContainText('no army and no way left to raise one');
  expect(await page.evaluate(() => window.__game.world.result.reason)).toBe('hopeless');
  expect(errors).toEqual([]);
});
