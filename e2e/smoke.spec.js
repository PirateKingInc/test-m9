import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';

test('game boots, sim ticks, HUD shows the stockpile, no console errors', async ({ page }) => {
  const errors = await openGame(page);
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.locator('#lumen')).toHaveText('250');
  const t0 = await page.evaluate(() => window.__game.world.time);
  await page.waitForTimeout(500);
  const t1 = await page.evaluate(() => window.__game.world.time);
  expect(t1).toBeGreaterThan(t0);
  expect(errors).toEqual([]);
});

test('camera pans with arrow keys and stays inside the map', async ({ page }) => {
  await openGame(page);
  await page.mouse.move(640, 400); // keep the pointer away from the edge-pan zones
  const scrollX = () => page.evaluate(() => window.__game.scene.cameras.main.scrollX);
  const before = await scrollX();
  await page.keyboard.down('ArrowRight');
  await expect.poll(scrollX, { timeout: 5000 }).toBeGreaterThan(before + 50);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowLeft');
  await expect.poll(scrollX, { timeout: 10000 }).toBe(0);
  await page.keyboard.up('ArrowLeft');
});
