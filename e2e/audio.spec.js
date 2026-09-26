import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';

test('audio unlocks on the first gesture, plays for events, and M mutes', async ({ page }) => {
  const errors = await openGame(page);
  expect(await page.evaluate(() => window.__game.sfx.ctx)).toBe(null);
  await page.mouse.click(640, 400);
  expect(await page.evaluate(() => window.__game.sfx.ctx.state)).toBe('running');
  const played = await page.evaluate(() => { const { sfx } = window.__game; sfx.muted = false; sfx.ui('select'); return sfx.played; });
  expect(played).toBeGreaterThan(0);
  await page.keyboard.press('KeyM');
  await expect(page.locator('#sound')).toHaveText('Sound off (M)');
  const after = await page.evaluate(() => { const { sfx } = window.__game; const n = sfx.played; sfx.ctx.currentTime; sfx.handle([{ type: 'trained' }]); return sfx.played - n; });
  expect(after).toBe(0);
  // Rejected commands give feedback: queue a Command Core with too little Lumen.
  await page.evaluate(() => { const w = window.__game.world; const d = [...w.ofKind('unit')][0]; w.issue({ type: 'build', ids: [d.id], building: 'core', tx: 14, ty: 34 }); });
  await expect(page.locator('#toast')).toHaveText('Not enough gold');
  expect(errors).toEqual([]);
});
