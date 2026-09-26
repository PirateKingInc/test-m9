import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';

const coreOf = (team) => `[...window.__game.world.ofKind('building')].find((b) => b.team === ${team} && b.type === 'core')`;

test('match mode: destroying the enemy Command Core shows Victory', async ({ page }) => {
  const errors = await openGame(page, '?mode=match');
  expect(await page.evaluate(`!!${coreOf(2)}`)).toBe(true);
  await page.evaluate(`${coreOf(2)}.hp = 0`);
  await expect(page.locator('#result-title')).toHaveText('Victory');
  await expect(page.locator('#result-detail')).toContainText('enemy Castle has fallen');
  await expect(page.locator('#play-again')).toBeVisible();
  expect(errors).toEqual([]);
});

test('match mode: losing your own Command Core shows Defeat', async ({ page }) => {
  await openGame(page, '?mode=match');
  await page.evaluate(`${coreOf(1)}.hp = 0`);
  await expect(page.locator('#result-title')).toHaveText('Defeat');
});

test('under-attack cue: enemy fire on our base raises a toast, and Space jumps the camera there', async ({ page }) => {
  const errors = await openGame(page, '?mode=match&difficulty=easy&seed=3');
  await page.evaluate(() => {
    const w = window.__game.world;
    const drone = [...w.ofKind('unit')].find((u) => u.team === 1);
    const id = w.issue({ type: 'devSpawn', unit: 'sparker', team: 2, x: drone.x + 150, y: drone.y }).id;
    w.issue({ type: 'attack', ids: [id], target: drone.id, team: 2 });
  });
  await expect(page.locator('#toast')).toContainText('under attack', { timeout: 10000 });
  await page.evaluate(() => window.__game.scene.cameras.main.centerOn(2000, 1500));
  await page.keyboard.press('Space');
  const cam = await page.evaluate(() => window.__game.scene.cameras.main.midPoint);
  expect(cam.x).toBeLessThan(1000);
  expect(errors).toEqual([]);
});
