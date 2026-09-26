// Phase 5 zoom range: the camera zooms out to 0.35x on desktop (mouse wheel) and
// touch (pinch), far enough that a fully built base fits the screen area the
// HUD leaves free. See PHASE5_SPEC.md "Zoom range (measured)".
import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';
import { openTouchGame, PHONE, centerOn } from './touch-helpers.js';

const zoom = (page) => page.evaluate(() => window.__game.scene.cameras.main.zoom);

// Let the AI (team 2) build its whole base: 600 s of game time on Hard, with
// the idle player's Castle made unbreakable so the match keeps going.
async function buildEnemyBase(page) {
  await page.evaluate(() => {
    const { match, world } = window.__game;
    const core = [...world.ofKind('building')].find((b) => b.team === 1 && b.type === 'core');
    core.hp = core.maxHp = 1e9;
    while (world.time < 600 && !world.result) match.step();
  });
}

// Screen rects of the enemy base (buildings near its Castle and its home mines)
// with the camera centered on it, and the screen area the HUD leaves free.
function measure(page) {
  return page.evaluate(async () => {
    const { MAP } = await import('/src/data/map.js');
    const { world, scene } = window.__game, cam = scene.cameras.main, T = world.grid.tile;
    const core = [...world.ofKind('building')].find((b) => b.team === 2 && b.type === 'core');
    const near = (x, y) => Math.hypot(x - core.x, y - core.y) < 14 * T * 1.2;
    const rects = [...world.ofKind('building')].filter((b) => b.team === 2 && near(b.x, b.y)).map((b) => [b.x - b.pw / 2, b.y - b.ph / 2, b.x + b.pw / 2, b.y + b.ph / 2]);
    // Every home mine, including ones already mined out.
    for (const [x, y] of MAP.nodes) if (near((x + 1) * T, (y + 1) * T)) rects.push([x * T, y * T, (x + 2) * T, (y + 2) * T]);
    const box = [Math.min(...rects.map((r) => r[0])) - T, Math.min(...rects.map((r) => r[1])) - T, Math.max(...rects.map((r) => r[2])) + T, Math.max(...rects.map((r) => r[3])) + T];
    // A player pans here; the test centers the free area on the base.
    const r = (id) => { const e = document.getElementById(id); return e && !e.hidden && e.offsetParent !== null ? e.getBoundingClientRect() : null; };
    const top = r('hud-top').bottom, bottom = r('hud-bottom').top, bar = r('touchbar'), right = bar ? bar.left : innerWidth;
    const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
    const freeMidX = right / 2, freeMidY = (top + bottom) / 2;
    scene.fitBounds();
    cam.centerOn(cx + (innerWidth / 2 - freeMidX) / cam.zoom, cy + (innerHeight / 2 - freeMidY) / cam.zoom);
    cam.preRender();
    const scr = (x, y) => [(x - cam.worldView.x) * cam.zoom, (y - cam.worldView.y) * cam.zoom];
    const [l, t] = scr(box[0], box[1]), [rr, b] = scr(box[2], box[3]);
    return { base: { l, t, r: rr, b, w: box[2] - box[0], h: box[3] - box[1], buildings: rects.length }, free: { l: 0, t: top, r: right, b: bottom } };
  });
}

function expectFits({ base, free }) {
  expect(base.buildings).toBeGreaterThanOrEqual(14); // 8+ buildings and 6 mines
  expect(base.l).toBeGreaterThanOrEqual(free.l);
  expect(base.t).toBeGreaterThanOrEqual(free.t);
  expect(base.r).toBeLessThanOrEqual(free.r);
  expect(base.b).toBeLessThanOrEqual(free.b);
}

test('desktop: the mouse wheel zooms about the cursor between 0.35x and 1.6x', async ({ page }) => {
  await openGame(page);
  expect(await zoom(page)).toBe(1);
  await centerOn(page, 1280, 960); // mid-map, clear of the camera bounds
  await page.mouse.move(500, 300);
  const before = await page.evaluate(() => { const p = window.__game.scene.cameras.main.getWorldPoint(500, 300); return [p.x, p.y]; });
  await page.mouse.wheel(0, 100);
  await expect.poll(() => zoom(page)).toBeLessThan(1);
  const after = await page.evaluate(() => { const p = window.__game.scene.cameras.main.getWorldPoint(500, 300); return [p.x, p.y]; });
  expect(Math.abs(after[0] - before[0])).toBeLessThan(2); // the point under the cursor stays put
  expect(Math.abs(after[1] - before[1])).toBeLessThan(2);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 300);
  await expect.poll(() => zoom(page)).toBeCloseTo(0.35, 5);
  for (let i = 0; i < 16; i++) await page.mouse.wheel(0, -300);
  await expect.poll(() => zoom(page)).toBeCloseTo(1.6, 5);
});

test.describe('desktop 1280x720', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test('at minimum zoom a fully built base fits the free screen', async ({ page }) => {
    test.setTimeout(120_000);
    await openGame(page, '?mode=match&difficulty=hard&strategy=boom&seed=2');
    await buildEnemyBase(page);
    await page.mouse.move(640, 360);
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 300);
    await expect.poll(() => zoom(page)).toBeCloseTo(0.35, 5);
    expectFits(await measure(page));
  });
});

test.describe('phone landscape 844x390', () => {
  test.use(PHONE);
  test('at minimum zoom (pinch) a fully built base fits the free screen', async ({ page }) => {
    test.setTimeout(120_000);
    const { touch } = await openTouchGame(page, '?mode=match&difficulty=hard&strategy=turtle&seed=2');
    await buildEnemyBase(page);
    await touch.pinch(360, 170, 300, 40);
    await touch.pinch(360, 170, 300, 40);
    await expect.poll(() => zoom(page)).toBeCloseTo(0.35, 5);
    expectFits(await measure(page));
  });
});
