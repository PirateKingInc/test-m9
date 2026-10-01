import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';

const toScreen = (page, x, y) => page.evaluate(([x, y]) => {
  const cam = window.__game.scene.cameras.main;
  return { x: x - cam.scrollX, y: y - cam.scrollY };
}, [x, y]);
const buildings = (page) => page.evaluate(() => [...window.__game.world.ofKind('building')].map((b) => ({ id: b.id, type: b.type, tx: b.tx, ty: b.ty, progress: b.progress })));

test('drone places a Depot via hotkey + ghost; invalid spots are refused; construction starts', async ({ page }) => {
  const errors = await openGame(page);
  const drone = await page.evaluate(() => { const u = [...window.__game.world.ofKind('unit')][0]; return { x: u.x, y: u.y }; });
  const d = await toScreen(page, drone.x, drone.y);
  await page.mouse.click(d.x, d.y);
  await expect(page.locator('#command-card button')).toHaveCount(4);

  // W = Lumen Depot. Hover over the Command Core (invalid) and click: refused.
  await page.keyboard.press('KeyW');
  const core = await toScreen(page, 10 * 32, 37 * 32);
  await page.mouse.move(core.x, core.y);
  expect(await page.evaluate(() => window.__game.scene.ui.ghost().valid)).toBe(false);
  await page.mouse.click(core.x, core.y);
  expect((await buildings(page)).length).toBe(1);

  // Valid spot on open ground: centered on tile (16.5, 36.5) -> footprint at (15,35).
  const spot = await toScreen(page, 16.5 * 32, 36.5 * 32);
  await page.mouse.move(spot.x, spot.y);
  expect(await page.evaluate(() => window.__game.scene.ui.ghost())).toMatchObject({ tx: 15, ty: 35, valid: true });
  await page.mouse.click(spot.x, spot.y);
  const bs = await buildings(page);
  expect(bs).toHaveLength(2);
  expect(bs[1]).toMatchObject({ type: 'depot', tx: 15, ty: 35 });
  await expect(page.locator('#lumen')).toHaveText('150');
  expect(await page.evaluate(() => window.__game.scene.ui.placing)).toBe(null);

  // The drone walks over and construction progresses.
  await expect.poll(async () => (await buildings(page))[1].progress, { timeout: 15000 }).toBeGreaterThan(0.02);
  expect(errors).toEqual([]);
});
