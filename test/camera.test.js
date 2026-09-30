// Camera bounds (src/game/camera.js hudBounds): at every zoom, every map edge
// can be brought just clear of the HUD, and an axis on which the whole map fits
// the screen is centred rather than pinned to one side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hudBounds, ZOOM } from '../src/game/camera.js';

// Where Phaser's clamp lets the view's left/top edge (world px) go, per axis.
const range = ([x, y, w, h], zoom, W, H) => ({ x: [x, Math.max(x, x + w - W / zoom)], y: [y, Math.max(y, y + h - H / zoom)] });
const PORTRAIT = { top: 29, bottom: 154, left: 0, right: 118 }; // measured on a 390 x 844 phone
const zooms = [ZOOM.min, 0.4, 0.5, 0.75, 1, 1.25, ZOOM.max];

test('every map edge can sit exactly at the HUD edge, at every zoom, when the map is bigger than the view', () => {
  const W = 390, H = 844, mapW = 3072, mapH = 3072;
  for (const z of zooms) {
    const r = range(hudBounds(z, mapW, mapH, PORTRAIT, W, H), z, W, H);
    // Screen position of a world x/y with the view's left/top edge at v.
    const sx = (x, v) => (x - v) * z, sy = (y, v) => (y - v) * z;
    assert.ok(Math.abs(sx(0, r.x[0]) - PORTRAIT.left) < 1e-6, `left edge at z ${z}`);
    assert.ok(Math.abs(sx(mapW, r.x[1]) - (W - PORTRAIT.right)) < 1e-6, `right edge at z ${z}`);
    assert.ok(Math.abs(sy(0, r.y[0]) - PORTRAIT.top) < 1e-6, `top edge at z ${z}`);
    assert.ok(Math.abs(sy(mapH, r.y[1]) - (H - PORTRAIT.bottom)) < 1e-6, `bottom edge (above the group slots) at z ${z}`);
    assert.ok(r.x[1] > r.x[0] && r.y[1] > r.y[0], `room to pan on both axes at z ${z}`);
  }
});

test('an axis where the whole map fits is centred in the free area, not pinned to one side', () => {
  // A map 1500 px tall on a portrait phone at the minimum zoom: 525 screen px,
  // inside the 661 px the HUD leaves free, so its whole height fits.
  const W = 390, H = 844, z = ZOOM.min, mapW = 2560, mapH = 1500;
  const b = hudBounds(z, mapW, mapH, PORTRAIT, W, H), r = range(b, z, W, H);
  assert.equal(r.y[0], r.y[1], 'nothing to pan vertically');
  const top = (0 - r.y[0]) * z, bottom = (mapH - r.y[0]) * z;
  const gapTop = top - PORTRAIT.top, gapBottom = H - PORTRAIT.bottom - bottom;
  assert.ok(gapTop > 0 && Math.abs(gapTop - gapBottom) < 1e-6, `centred in the free area (${gapTop} vs ${gapBottom})`);
  assert.ok(r.x[1] > r.x[0], 'still pans horizontally');
});

test('fits in both directions: the map sits in the middle, no panning needed', () => {
  const ins = { top: 0, bottom: 0, left: 0, right: 0 };
  const b = hudBounds(0.25, 1000, 800, ins, 1000, 800), r = range(b, 0.25, 1000, 800);
  assert.deepEqual([r.x[0], r.x[1]], [r.x[0], r.x[0]]);
  assert.equal((0 - r.x[0]) * 0.25, (1000 - (1000 * 0.25)) / 2);
  assert.equal((0 - r.y[0]) * 0.25, (800 - (800 * 0.25)) / 2);
});
