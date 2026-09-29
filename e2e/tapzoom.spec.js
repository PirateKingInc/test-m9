// Phase 6: rapid taps are game input, never the browser's double-tap-to-zoom.
// Chromium's mobile emulation does not reproduce iOS Safari's double-tap zoom,
// so this checks both the conditions browsers use to disable it (touch-action
// on every element, a non-scalable viewport, cancelled gesture events) and the
// behaviour: rapid taps change neither the page zoom nor the camera, and every
// tap counts. The pinch test in touch.spec.js proves the game's pinch still works.
import { test, expect } from '@playwright/test';
import { openTouchGame, PHONE, screenOf } from './touch-helpers.js';

test.use(PHONE);

// N taps `gap` ms apart at (x, y), by explicit event timestamps (a fast finger).
async function rapidTaps(page, x, y, n, gap = 0.11) {
  const cdp = await page.context().newCDPSession(page);
  const t0 = Date.now() / 1000;
  for (let i = 0; i < n; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: t0 + i * gap, touchPoints: [{ x, y, id: 0 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: t0 + i * gap + 0.04, touchPoints: [] });
  }
  await page.waitForTimeout(400);
}

const zooms = (page) => page.evaluate(() => ({ page: visualViewport.scale, camera: window.__game.scene.cameras.main.zoom }));

test('no element outside the canvas allows double-tap zoom, and the page cannot scale', async ({ page }) => {
  await openTouchGame(page);
  const bad = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('body, body *')) {
      const ta = getComputedStyle(el).touchAction;
      if (ta !== 'manipulation' && ta !== 'none' && ta !== 'pinch-zoom pan-x pan-y') out.push(`${el.tagName}#${el.id}.${el.className}: ${ta}`);
    }
    return out;
  });
  expect(bad).toEqual([]);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#game')).touchAction)).toBe('none');
  expect(await page.getAttribute('meta[name="viewport"]', 'content')).toMatch(/user-scalable=no/);
  // Nor can a swipe navigate away (pull-to-refresh, swipe-back).
  expect(await page.evaluate(() => [getComputedStyle(document.documentElement).overscrollBehaviorX, getComputedStyle(document.body).overscrollBehaviorY])).toEqual(['none', 'none']);
  // A cancelable iOS gesture event is cancelled.
  expect(await page.evaluate(() => { const e = new Event('gesturestart', { cancelable: true }); document.dispatchEvent(e); return e.defaultPrevented; })).toBe(true);
});

test('rapid taps on a train button queue a unit per tap and zoom nothing', async ({ page }) => {
  await openTouchGame(page);
  await page.evaluate(() => {
    const { world, scene } = window.__game;
    world.resources[1] = 5000;
    scene.ui.selection.set([[...world.ofKind('building')].find((b) => b.type === 'core').id]);
  });
  const btn = page.locator('#command-card button[data-action="train:drone"]');
  await expect(btn).toBeEnabled();
  const before = await zooms(page);
  const b = await btn.boundingBox();
  await rapidTaps(page, b.x + b.width / 2, b.y + b.height / 2, 4);
  expect(await page.evaluate(() => [...window.__game.world.ofKind('building')].find((x) => x.type === 'core').queue.length)).toBe(4);
  expect(await zooms(page)).toEqual(before);
});

test('rapid taps on the map select without zooming the camera or the page', async ({ page }) => {
  await openTouchGame(page);
  const d = await page.evaluate(() => { const u = [...window.__game.world.ofKind('unit')].find((x) => x.team === 1); return { x: u.x, y: u.y }; });
  const s = await screenOf(page, d.x, d.y);
  const before = await zooms(page);
  await rapidTaps(page, s.x, s.y, 6);
  expect(await zooms(page)).toEqual(before);
  expect((await page.evaluate(() => window.__game.scene.ui.selection.ids.length))).toBeGreaterThan(0);
});
