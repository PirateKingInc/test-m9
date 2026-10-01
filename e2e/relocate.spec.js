// Phase 9 moving a structure in the browser (PHASE9_SPEC.md "Part B"): select a
// completed building, Move, place the new spot, by mouse and by touch.
import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';
import { PHONE, openTouchGame, screenOf, centerOn } from './touch-helpers.js';

// Test setup: a completed Storehouse of the player's at tile (15, 35).
const addDepot = (page) => page.evaluate(() => {
  const w = window.__game.world;
  const b = w.addBuilding('depot', 1, 15, 35, { built: true });
  return { id: b.id, x: b.x, y: b.y };
});
const state = (page, id) => page.evaluate((id) => {
  const w = window.__game.world;
  const depots = [...w.ofKind('building')].filter((b) => b.type === 'depot').map((b) => ({ id: b.id, tx: b.tx, ty: b.ty, built: b.built }));
  return { old: !!w.get(id), depots, gold: w.resources[1], placing: window.__game.scene.ui.placing };
}, id);

test('mouse: select a Storehouse, Move (V), click a new spot', async ({ page }) => {
  const errors = await openGame(page);
  const d = await addDepot(page);
  const at = await page.evaluate(([x, y]) => { const c = window.__game.scene.cameras.main; return { x: x - c.scrollX, y: y - c.scrollY }; }, [d.x, d.y]);
  await page.mouse.click(at.x, at.y);
  const move = page.locator('#command-card button[data-action="move"]');
  await expect(move).toBeVisible();
  await expect(move).toContainText('Move');
  await expect(move).toContainText('50');
  await page.keyboard.press('KeyV');
  expect(await page.evaluate(() => window.__game.scene.ui.placing)).toBe('depot');
  const spot = await page.evaluate(() => { const c = window.__game.scene.cameras.main; return { x: 21.5 * 32 - c.scrollX, y: 39.5 * 32 - c.scrollY }; });
  await page.mouse.move(spot.x, spot.y);
  expect(await page.evaluate(() => window.__game.scene.ui.ghost())).toMatchObject({ tx: 20, ty: 38, valid: true });
  const gold = (await state(page, d.id)).gold;
  await page.mouse.click(spot.x, spot.y);
  const s = await state(page, d.id);
  expect(s.old).toBe(false);
  expect(s.depots).toEqual([expect.objectContaining({ tx: 20, ty: 38, built: false })]);
  expect(gold - s.gold).toBe(50);
  expect(s.placing).toBe(null);
  await expect.poll(async () => (await state(page, d.id)).depots[0].built, { timeout: 20000 }).toBe(true); // 10 s, no Peasant needed
  expect(errors).toEqual([]);
});

test('the Castle has no Move button', async ({ page }) => {
  await openGame(page);
  const core = await page.evaluate(() => { const b = [...window.__game.world.ofKind('building')].find((x) => x.type === 'core'); const c = window.__game.scene.cameras.main; return { x: b.x - c.scrollX, y: b.y - c.scrollY }; });
  await page.mouse.click(core.x, core.y);
  await expect(page.locator('#command-card button[data-action="train:drone"]')).toBeVisible();
  await expect(page.locator('#command-card button[data-action="move"]')).toHaveCount(0);
});

test.describe('touch', () => {
  test.use(PHONE);
  test('touch: tap a Storehouse, tap Move, drag the ghost and lift', async ({ page }) => {
    const { errors, touch } = await openTouchGame(page);
    const d = await addDepot(page);
    await centerOn(page, d.x, d.y);
    const at = await screenOf(page, d.x, d.y);
    await touch.tap(at.x, at.y);
    await expect(page.locator('#command-card button[data-action="move"]')).toBeVisible();
    await touch.tapEl('#command-card button[data-action="move"]');
    expect(await page.evaluate(() => window.__game.scene.ui.moving)).toBe(d.id);
    // Drag on the map above the bottom panel: from beside the Storehouse to 4 tiles right of it.
    const from = await screenOf(page, d.x, d.y - 2 * 32), to = await screenOf(page, d.x + 4 * 32, d.y - 2 * 32);
    await touch.drag(from.x, from.y, to.x, to.y);
    const s = await state(page, d.id);
    expect(s.old).toBe(false);
    expect(s.depots).toEqual([expect.objectContaining({ built: false })]);
    expect(s.placing).toBe(null);
    expect(errors).toEqual([]);
  });
});
