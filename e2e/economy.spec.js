import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';

const toScreen = (page, x, y) => page.evaluate(([x, y]) => {
  const cam = window.__game.scene.cameras.main;
  return { x: x - cam.scrollX, y: y - cam.scrollY };
}, [x, y]);

test('right-clicking a crystal with drones starts the gather loop and Lumen rises', async ({ page }) => {
  const errors = await openGame(page);
  // Test setup shortcut: a finished Depot next to the home field.
  await page.evaluate(() => window.__game.world.addBuilding('depot', 1, 18, 27, { built: true }));
  const a = await toScreen(page, 12 * 32, 26 * 32), b = await toScreen(page, 15 * 32, 32 * 32);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  const node = await toScreen(page, 24 * 32, 28 * 32); // crystal at tile (23,27)
  await page.mouse.click(node.x, node.y, { button: 'right' });
  const orders = await page.evaluate(() => [...window.__game.world.ofKind('unit')].map((u) => u.order.type));
  expect(orders).toEqual(['gather', 'gather', 'gather', 'gather']);
  await expect.poll(() => page.locator('#lumen').textContent().then(Number), { timeout: 30000 }).toBeGreaterThan(250);
  expect(errors).toEqual([]);
});

test('Command Core queue: Q trains Drones, clicking a slot cancels with a full refund', async ({ page }) => {
  const errors = await openGame(page);
  const core = await toScreen(page, 10 * 32, 29 * 32);
  await page.mouse.click(core.x, core.y);
  await expect(page.locator('#command-card button')).toHaveText(/Peasant/);
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyQ');
  await expect(page.locator('#lumen')).toHaveText('150');
  await expect(page.locator('.queue button')).toHaveCount(2);
  await page.locator('.queue button').nth(1).click();
  await expect(page.locator('#lumen')).toHaveText('200');
  await expect(page.locator('.queue button')).toHaveCount(1);
  await page.keyboard.press('Backspace');
  await expect(page.locator('#lumen')).toHaveText('250');
  expect(errors).toEqual([]);
});

test('HUD shows supply, and training is refused with a toast when supply runs out', async ({ page }) => {
  const errors = await openGame(page);
  await expect(page.locator('#supply')).toHaveText('4/10');
  // Test setup shortcut: six more units put the player at the 10-supply cap.
  await page.evaluate(() => { const w = window.__game.world; w.resources[1] = 5000; for (let i = 0; i < 6; i++) w.addUnit('striker', 1, 14 * 32, (34 + i) * 32); });
  await expect(page.locator('#supply')).toHaveText('10/10');
  const core = await toScreen(page, 10 * 32, 29 * 32);
  await page.mouse.click(core.x, core.y);
  await expect(page.locator('#command-card button')).toBeDisabled();
  await page.evaluate(() => { const w = window.__game.world; const c = [...w.ofKind('building')][0]; w.issue({ type: 'train', building: c.id, unit: 'drone' }); });
  await expect(page.locator('#toast')).toContainText('Not enough supply');
  expect(errors).toEqual([]);
});
