import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';

test('first-run tutorial: hints advance with play, Skip hides it for good, Help brings it back', async ({ page }) => {
  const errors = await openGame(page, '?mode=match&seed=5', { tutorial: true });
  const panel = page.locator('#tutorial');
  await expect(panel).toBeVisible();
  await expect(page.locator('#tutorial-step')).toHaveText('1 / 6');
  await expect(page.locator('#tutorial-text')).toContainText('Peasants');
  // Real input: drag a box around the starting Drones.
  const box = await page.evaluate(() => {
    const cam = window.__game.scene.cameras.main;
    const ds = [...window.__game.world.ofKind('unit')].filter((u) => u.team === 1);
    const xs = ds.map((d) => d.x - cam.worldView.x), ys = ds.map((d) => d.y - cam.worldView.y);
    return { x0: Math.min(...xs) - 30, y0: Math.min(...ys) - 30, x1: Math.max(...xs) + 30, y1: Math.max(...ys) + 30 };
  });
  await page.mouse.move(box.x0, box.y0);
  await page.mouse.down();
  await page.mouse.move(box.x1, box.y1, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#tutorial-step')).toHaveText('2 / 6');
  await page.locator('#tutorial-skip').click();
  await expect(panel).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => window.__game?.world.tick > 5);
  await expect(panel).toBeHidden();
  await page.locator('#help').click();
  await expect(panel).toBeVisible();
  expect(errors).toEqual([]);
});

test('the game and tutorial still work when localStorage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } });
  });
  const errors = await openGame(page, '?mode=match&seed=5', { tutorial: true });
  await expect(page.locator('#tutorial')).toBeVisible();
  await page.locator('#tutorial-skip').click();
  await expect(page.locator('#tutorial')).toBeHidden();
  expect(errors).toEqual([]);
});

test('menu describes the chosen strategy', async ({ page }) => {
  await openGame(page, '?mode=match');
  await page.goto('/');
  await expect(page.locator('#strategy-note')).toContainText('Warband Raid'); // Normal's default (Phase 3): rush
  await page.locator('#strategy').selectOption('turtle');
  await expect(page.locator('#strategy-note')).toContainText('Stone Bastion');
});

test('result screen shows match statistics; command buttons explain costs and counters', async ({ page }) => {
  const errors = await openGame(page, '?mode=match&seed=2');
  await page.evaluate(() => {
    const w = window.__game.world, ui = window.__game.scene.ui;
    const drone = [...w.ofKind('unit')].find((u) => u.team === 1 && u.type === 'drone');
    ui.selection.set([drone.id]);
  });
  await expect(page.locator('#command-card button').first()).toHaveAttribute('title', /gold/);
  await page.evaluate(() => {
    const w = window.__game.world;
    const f = w.addBuilding('foundry', 1, 14, 34, { built: true });
    window.__game.scene.ui.selection.set([f.id]);
  });
  await expect(page.locator('#command-card button[data-action="train:lancer"]')).toHaveAttribute('title', /melts Shield Knights/);
  await page.evaluate(() => { [...window.__game.world.ofKind('building')].find((b) => b.team === 2 && b.type === 'core').hp = 0; });
  await expect(page.locator('#result-title')).toHaveText('Victory');
  await expect(page.locator('#result-stats')).toContainText('Gold gathered');
  await expect(page.locator('#result-stats')).toContainText('Buildings lost');
  expect(errors).toEqual([]);
});
