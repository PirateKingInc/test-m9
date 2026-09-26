import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';

// World -> page coordinates (the canvas fills the page, zoom is 1).
const toScreen = (page, x, y) => page.evaluate(([x, y]) => {
  const cam = window.__game.scene.cameras.main;
  return { x: x - cam.scrollX, y: y - cam.scrollY };
}, [x, y]);

const drones = (page) => page.evaluate(() => [...window.__game.world.ofKind('unit')].filter((u) => u.type === 'drone').map((u) => ({ id: u.id, x: u.x, y: u.y })));
const selected = (page) => page.evaluate(() => window.__game.scene.ui.selection.ids.slice().sort((a, b) => a - b));

test('drag-box selects the drones, control groups assign and recall, right-click moves', async ({ page }) => {
  const errors = await openGame(page);
  const ds = await drones(page);
  const ids = ds.map((d) => d.id).sort((a, b) => a - b);
  const minY = Math.min(...ds.map((d) => d.y)), maxY = Math.max(...ds.map((d) => d.y));
  const p1 = await toScreen(page, ds[0].x - 30, minY - 30);
  const p2 = await toScreen(page, ds[0].x + 30, maxY + 30);

  // Drag-box over all four drones.
  await page.mouse.move(p1.x, p1.y);
  await page.mouse.down();
  await page.mouse.move(p2.x, p2.y, { steps: 5 });
  await page.mouse.up();
  expect(await selected(page)).toEqual(ids);
  await expect(page.locator('#selection-panel')).toContainText('Peasant ×4');

  // Ctrl+1 assigns; click one drone; 1 recalls the group.
  await page.keyboard.press('Control+1');
  const one = await toScreen(page, ds[0].x, ds[0].y);
  await page.mouse.click(one.x, one.y);
  expect(await selected(page)).toEqual([ds[0].id]);
  await page.keyboard.press('Digit1');
  expect(await selected(page)).toEqual(ids);

  // Right-click on open ground: every drone walks to its own nearby slot.
  const target = await toScreen(page, ds[0].x + 200, ds[0].y);
  await page.mouse.click(target.x, target.y, { button: 'right' });
  await expect.poll(async () => {
    const now = await drones(page);
    return now.every((d) => d.x > ds[0].x + 120);
  }, { timeout: 15000 }).toBe(true);

  // Click empty ground deselects.
  const empty = await toScreen(page, ds[0].x, ds[0].y + 220); // open ground below the base
  await page.mouse.click(empty.x, empty.y);
  expect(await selected(page)).toEqual([]);
  expect(errors).toEqual([]);
});
