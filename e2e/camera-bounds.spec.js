// The camera at every zoom the pinch can reach, on phone-sized screens in both
// orientations: panning always works, every map edge can be brought exactly
// clear of the HUD (never stranded under it), a map that fits the screen on
// one axis sits centred there, and the page itself never scrolls. A real phone
// once got the view stuck after pinching out as far as it goes; before the
// fix, the camera margins were fixed numbers (the portrait group slots hid the
// map's bottom edge), a map that fit on one axis was pinned to one side, and
// the page could scroll out from under the game.
import { test, expect } from '@playwright/test';
import { openTouchGame } from './touch-helpers.js';

const SCREENS = {
  'landscape phone': { width: 844, height: 390 },
  'small landscape phone': { width: 667, height: 375 },
  'portrait phone': { width: 390, height: 844 },
  'small portrait phone': { width: 360, height: 640 },
  'portrait tablet': { width: 820, height: 1180 },
};
const SWEEP = ['landscape phone', 'portrait phone', 'small portrait phone'];

// What the HUD covers, measured here from the page (independently of the
// game's own measurement), and where the map's edges are on screen.
const view = (page) => page.evaluate(() => {
  const { scene, world } = window.__game, cam = scene.cameras.main;
  const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
  const r = (id) => { const e = document.getElementById(id); return e && e.offsetParent !== null ? e.getBoundingClientRect() : null; };
  const top = r('hud-top'), bottom = r('hud-bottom'), groups = r('groups'), bar = r('touchbar');
  const free = { l: 0, t: top.bottom, r: bar ? bar.left - 8 : W, b: Math.min(bottom.top, groups ? groups.top : H) }; // 8 px clear of the bar (camera.js BAR_GAP)
  cam.preRender();
  const sx = (x) => (x - cam.worldView.x) * cam.zoom, sy = (y) => (y - cam.worldView.y) * cam.zoom;
  return {
    zoom: cam.zoom, scroll: [cam.scrollX, cam.scrollY], free, W, H,
    map: { l: sx(0), t: sy(0), r: sx(world.width), b: sy(world.height) },
    page: { sx: scrollX, sy: scrollY, dw: document.documentElement.scrollWidth, dh: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight },
  };
});

// Real one-finger drags until the camera stops moving; returns how many moved it.
async function panAll(page, touch, dx, dy) {
  const { W, H } = await view(page);
  const cx = Math.round(W * 0.45), cy = Math.round(H * 0.5);
  let moved = 0;
  for (let i = 0; i < 30; i++) {
    const a = (await view(page)).scroll;
    await touch.drag(cx, cy, cx + dx, cy + dy);
    const b = (await view(page)).scroll;
    if (Math.abs(b[0] - a[0]) < 0.5 && Math.abs(b[1] - a[1]) < 0.5) return moved;
    moved++;
  }
  throw new Error('the camera never stopped');
}

// Pan to each side and check the map edge there lands exactly on the HUD's
// edge, or, on an axis where the whole map fits the free area, that the map is
// centred in it; then check a drag back the other way moves the camera again.
// near: test setup first places the camera so that edge is one drag away (at
// high zoom a big map is many swipes wide); real drags still do the rest.
async function checkEdges(page, touch, label, { near = false } = {}) {
  const v0 = await view(page), mapW = v0.map.r - v0.map.l, mapH = v0.map.b - v0.map.t;
  const fitsX = mapW <= v0.free.r - v0.free.l + 1, fitsY = mapH <= v0.free.b - v0.free.t + 1;
  const D = 260;
  for (const [name, dx, dy] of [['left', D, 0], ['right', -D, 0], ['top', 0, D], ['bottom', 0, -D]]) {
    if (near) {
      await page.evaluate(([name, dx, dy]) => {
        const cam = window.__game.scene.cameras.main, w = window.__game.world;
        cam.preRender();
        // Put the map's edge 120 screen px short of the screen edge on that side.
        const T = { left: [0, null], right: [w.width, null], top: [null, 0], bottom: [null, w.height] }[name];
        if (T[0] !== null) cam.scrollX += (T[0] - cam.worldView.x - (dx > 0 ? 120 : cam.width - 120) / cam.zoom);
        if (T[1] !== null) cam.scrollY += (T[1] - cam.worldView.y - (dy > 0 ? 120 : cam.height - 120) / cam.zoom);
        cam.preRender();
      }, [name, dx, dy]);
    }
    await panAll(page, touch, dx, dy);
    const v = await view(page), m = v.map, f = v.free;
    const horizontal = dx !== 0;
    const at = `${label}, zoom ${v.zoom.toFixed(2)}, panned to the ${name}`;
    if (horizontal ? fitsX : fitsY) {
      // The whole map fits on this axis: centred in the free area, no pan.
      const [lo, hi, a, b] = horizontal ? [m.l - f.l, f.r - m.r, m.l, m.r] : [m.t - f.t, f.b - m.b, m.t, m.b];
      expect(Math.abs(lo - hi), `${at}: centred (gaps ${lo.toFixed(1)} / ${hi.toFixed(1)})`).toBeLessThan(2);
      expect(a, at).toBeGreaterThanOrEqual((horizontal ? f.l : f.t) - 1);
      expect(b, at).toBeLessThanOrEqual((horizontal ? f.r : f.b) + 1);
    } else {
      const edge = { left: [m.l, f.l], right: [m.r, f.r], top: [m.t, f.t], bottom: [m.b, f.b] }[name];
      expect(Math.abs(edge[0] - edge[1]), `${at}: the map's ${name} edge (${edge[0].toFixed(1)}) sits on the HUD's (${edge[1].toFixed(1)})`).toBeLessThan(1.5);
      // Not stuck: a drag back moves it again.
      const before = v.scroll;
      await touch.drag(Math.round(v.W * 0.45), Math.round(v.H * 0.5), Math.round(v.W * 0.45) - dx / 2, Math.round(v.H * 0.5) - dy / 2);
      const after = (await view(page)).scroll;
      expect(Math.hypot(after[0] - before[0], after[1] - before[1]), `${at}: a drag back pans again`).toBeGreaterThan(20);
    }
    expect(v.page, `${at}: the page never scrolls`).toMatchObject({ sx: 0, sy: 0, dw: v.page.iw, dh: v.page.ih });
  }
}

for (const [label, viewport] of Object.entries(SCREENS)) {
  for (const mode of ['sandbox', 'ffa']) {
    test.describe(`${label}, ${mode === 'ffa' ? 'free-for-all map' : '1v1 map'}`, () => {
      test.use({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

      test('pinch out as far as it goes, then every edge is reachable and panning still works', async ({ page }) => {
        const { touch, errors } = await openTouchGame(page, `?mode=${mode}`);
        const { ZOOM } = await page.evaluate(() => import('/src/game/camera.js'));
        const cx = viewport.width / 2, cy = viewport.height / 2;
        // Pinch out again and again, well past the minimum.
        for (let i = 0; i < 4; i++) await touch.pinch(cx, cy, Math.min(viewport.width, viewport.height) - 40, 16);
        expect((await view(page)).zoom).toBe(ZOOM.min);
        await checkEdges(page, touch, `${label} ${mode}`);
        expect(errors).toEqual([]);
      });

      // Between the extremes (three screens cover both orientations and the
      // smallest phone; the extreme pinch above runs on all five).
      if (SWEEP.includes(label)) test('every zoom level in between: every edge reachable, panning works', async ({ page }) => {
        test.setTimeout(180_000);
        const { touch, errors } = await openTouchGame(page, `?mode=${mode}`);
        for (const z of [0.5, 1, 1.6]) {
          // Test setup: set the zoom as a pinch would (about the screen centre).
          await page.evaluate(async (z) => {
            const { zoomAbout } = await import('/src/game/camera.js');
            const cam = window.__game.scene.cameras.main;
            zoomAbout(cam, cam.width / 2, cam.height / 2, z);
          }, z);
          await page.waitForTimeout(300); // the HUD re-measure and the bounds follow within 250 ms
          await checkEdges(page, touch, `${label} ${mode}`, { near: true });
        }
        expect(errors).toEqual([]);
      });
    });
  }
}
