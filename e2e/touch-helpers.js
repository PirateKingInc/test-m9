// Real touch input for Playwright (Chromium): CDP Input.dispatchTouchEvent
// produces genuine TouchEvents, including multi-finger ones for pinch.
import { openGame } from './helpers.js';

export const PHONE = { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };

export async function openTouchGame(page, query = '?mode=sandbox', opts) {
  const errors = await openGame(page, query.includes('input=') ? query : `${query}&input=touch`, opts);
  return { errors, touch: await touchOn(page) };
}

// Real touch gestures on any page already open (the multiplayer tests use it).
export async function touchOn(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i })) });
  const touch = {
    async tap(x, y) { await send('touchStart', [[x, y]]); await send('touchEnd', []); await page.waitForTimeout(60); },
    // Two quick taps, 150 ms apart by their event timestamps (a real finger's
    // double-tap). The timestamps are explicit because on a loaded test machine
    // each CDP call can take ~100 ms, which would otherwise stretch the gesture.
    async doubleTap(x, y) {
      const t0 = Date.now() / 1000;
      const at = (type, pts, t) => cdp.send('Input.dispatchTouchEvent', { type, timestamp: t, touchPoints: pts.map(([px, py], i) => ({ x: px, y: py, id: i })) });
      await at('touchStart', [[x, y]], t0);
      await at('touchEnd', [], t0 + 0.05);
      await at('touchStart', [[x, y]], t0 + 0.15);
      await at('touchEnd', [], t0 + 0.2);
      await page.waitForTimeout(60);
    },
    async drag(x0, y0, x1, y1, steps = 8) {
      await send('touchStart', [[x0, y0]]);
      for (let i = 1; i <= steps; i++) await send('touchMove', [[x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]]);
      await send('touchEnd', []);
      await page.waitForTimeout(60);
    },
    // Hold a finger down for `ms` (press-and-hold).
    async hold(x, y, ms) { await send('touchStart', [[x, y]]); await page.waitForTimeout(ms); await send('touchEnd', []); await page.waitForTimeout(60); },
    // Two fingers from distance d0 to d1 around (cx, cy).
    async pinch(cx, cy, d0, d1, steps = 8) {
      const pts = (d) => [[cx - d / 2, cy], [cx + d / 2, cy]];
      await send('touchStart', pts(d0));
      for (let i = 1; i <= steps; i++) await send('touchMove', pts(d0 + ((d1 - d0) * i) / steps));
      await send('touchEnd', []);
      await page.waitForTimeout(60);
    },
    // Tap a DOM element by selector (real touch at its center).
    async tapEl(selector) {
      const b = await page.locator(selector).boundingBox();
      await this.tap(b.x + b.width / 2, b.y + b.height / 2);
    },
  };
  return touch;
}

// Screen position of a world point under the current camera.
export function screenOf(page, x, y) {
  return page.evaluate(([x, y]) => {
    const cam = window.__game.scene.cameras.main;
    return { x: (x - cam.worldView.x) * cam.zoom, y: (y - cam.worldView.y) * cam.zoom };
  }, [x, y]);
}

// Test setup only: center the camera on a world point (a player would pan).
export function centerOn(page, x, y) {
  return page.evaluate(([x, y]) => { const c = window.__game.scene.cameras.main; c.centerOn(x, y); c.preRender(); }, [x, y]);
}
