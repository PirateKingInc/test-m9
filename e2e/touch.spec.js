// Phase 4 touch controls, driven by real touch events in mobile emulation.
import { test, expect } from '@playwright/test';
import { PHONE, openTouchGame, screenOf, centerOn } from './touch-helpers.js';

test.use(PHONE);

const sel = (page) => page.evaluate(() => window.__game.scene.ui.selection.ids.slice().sort((a, b) => a - b));
const drones = (page) => page.evaluate(() => [...window.__game.world.ofKind('unit')].filter((u) => u.team === 1 && u.type === 'drone').map((u) => ({ id: u.id, x: u.x, y: u.y })));

test('touch mode shows the action bar; tap selects, tap on empty ground deselects', async ({ page }) => {
  const { errors, touch } = await openTouchGame(page);
  await expect(page.locator('#touchbar')).toBeVisible();
  expect(await page.evaluate(() => document.body.classList.contains('touch'))).toBe(true);
  const [d] = await drones(page);
  const s = await screenOf(page, d.x, d.y);
  await touch.tap(s.x + 8, s.y + 6); // a fingertip slightly off-center still picks it
  expect(await sel(page)).toEqual([d.id]);
  const empty = await screenOf(page, d.x, d.y - 110);
  await touch.tap(empty.x, empty.y);
  expect(await sel(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('double-tap a unit selects every own unit of that type on screen', async ({ page }) => {
  const { touch } = await openTouchGame(page);
  const ds = await drones(page);
  const s = await screenOf(page, ds[0].x, ds[0].y);
  await touch.doubleTap(s.x, s.y);
  await expect.poll(() => sel(page)).toEqual(ds.map((d) => d.id).sort((a, b) => a - b));
});

test('▭ Box then drag box-selects; without Box a one-finger drag pans instead', async ({ page }) => {
  const { touch } = await openTouchGame(page);
  const ds = await drones(page);
  const xs = ds.map((d) => d.x), ys = ds.map((d) => d.y);
  const a = await screenOf(page, Math.min(...xs) - 30, Math.min(...ys) - 30), b = await screenOf(page, Math.max(...xs) + 30, Math.max(...ys) + 30);
  await touch.tapEl('#touchbar [data-touch="box"]');
  await expect(page.locator('#touchbar [data-touch="box"]')).toHaveClass(/armed/);
  await touch.drag(a.x, a.y, b.x, b.y);
  expect(await sel(page)).toEqual(ds.map((d) => d.id).sort((x, y) => x - y));
  await expect(page.locator('#touchbar [data-touch="box"]')).not.toHaveClass(/armed/);
  // Box is one-shot: the same drag now pans the camera and selects nothing new.
  await touch.tap(a.x, a.y - 60); // clear selection on empty ground
  const before = await page.evaluate(() => window.__game.scene.cameras.main.scrollX);
  await touch.drag(500, 200, 300, 200);
  const after = await page.evaluate(() => window.__game.scene.cameras.main.scrollX);
  expect(after - before).toBeGreaterThan(150);
  expect(await sel(page)).toEqual([]);
});

test('pinch zooms in and out within limits, keeping the pinch center steady; Base re-centers', async ({ page }) => {
  const { touch } = await openTouchGame(page);
  const zoom = () => page.evaluate(() => window.__game.scene.cameras.main.zoom);
  expect(await zoom()).toBe(1);
  const mid = await page.evaluate(() => { const c = window.__game.scene.cameras.main; return c.getWorldPoint(422, 195); });
  await touch.pinch(422, 195, 100, 200);
  const zIn = await zoom();
  expect(zIn).toBeGreaterThan(1.5);
  const midAfter = await page.evaluate(() => window.__game.scene.cameras.main.getWorldPoint(422, 195));
  expect(Math.hypot(midAfter.x - mid.x, midAfter.y - mid.y)).toBeLessThan(40);
  await touch.pinch(422, 195, 300, 40);
  expect(await zoom()).toBe(0.35); // Phase 5 minimum (was 0.5);
  await touch.drag(200, 200, 600, 300);
  await touch.tapEl('#touchbar [data-touch="base"]');
  // At 0.35x the camera is clamped at the map edge, so check the Core is on screen.
  const onScreen = await page.evaluate(() => {
    const v = window.__game.scene.cameras.main.worldView;
    const core = [...window.__game.world.ofKind('building')].find((b) => b.team === 1 && b.type === 'core');
    return core.x > v.x && core.x < v.right && core.y > v.y && core.y < v.bottom;
  });
  expect(onScreen).toBe(true);
});

// ---- P4-2: orders from the action bar ---------------------------------------

const unit = (page, id) => page.evaluate((id) => { const u = window.__game.world.get(id); return u && { x: u.x, y: u.y, order: u.order.type, target: u.order.target, node: u.order.node }; }, id);

// Tap an action-bar button and wait for its click to land (clicks follow touchend asynchronously).
async function arm(page, touch, mode) {
  await touch.tapEl(`[data-touch="${mode}"]`);
  await expect.poll(() => page.evaluate(() => window.__game.scene.ui.armed)).toBe(mode);
}

async function selectDrones(page, touch) {
  const ds = await drones(page);
  const s = await screenOf(page, ds[0].x, ds[0].y);
  await touch.doubleTap(s.x, s.y); // all Drones
  await expect.poll(() => sel(page)).toHaveLength(ds.length);
  return ds;
}

test('➜ Order is disabled with nothing selected, arms with a banner and rings, then moves on tap', async ({ page }) => {
  const { errors, touch } = await openTouchGame(page);
  await expect(page.locator('[data-touch="order"]')).toBeDisabled();
  const ds = await selectDrones(page, touch);
  await expect(page.locator('[data-touch="order"]')).toBeEnabled();
  await touch.tapEl('[data-touch="order"]');
  await expect(page.locator('[data-touch="order"]')).toHaveClass(/armed/);
  await expect(page.locator('#armed-banner')).toContainText('Tap a spot to move');
  expect(await page.evaluate(() => window.__game.scene.ui.armed)).toBe('order');
  const dest = await screenOf(page, ds[0].x, ds[0].y + 70);
  await touch.tap(dest.x, dest.y);
  await expect(page.locator('#armed-banner')).toBeHidden();
  expect(await page.evaluate(() => window.__game.scene.ui.armed)).toBe(null);
  expect((await unit(page, ds[0].id)).order).toBe('move');
  expect(await sel(page)).toHaveLength(4); // the selection is kept
  // Tapping the armed button again disarms without an order.
  await arm(page, touch, 'order');
  await touch.tapEl('[data-touch="order"]');
  await expect.poll(() => page.evaluate(() => window.__game.scene.ui.armed)).toBe(null);
  expect(errors).toEqual([]);
});

test('➜ Order on a crystal gathers; on an enemy attacks; ■ Stop stops', async ({ page }) => {
  const { touch } = await openTouchGame(page, '?mode=match&seed=4');
  const ds = await selectDrones(page, touch);
  const node = await page.evaluate(([x, y]) => { const ns = [...window.__game.world.ofKind('node')]; ns.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y)); return { id: ns[0].id, x: ns[0].x, y: ns[0].y }; }, [ds[0].x, ds[0].y]);
  await centerOn(page, (node.x + ds[0].x) / 2, (node.y + ds[0].y) / 2);
  const ns = await screenOf(page, node.x, node.y);
  await arm(page, touch, 'order');
  await touch.tap(ns.x, ns.y);
  expect((await unit(page, ds[0].id)).order).toBe('gather');
  expect((await unit(page, ds[0].id)).node).toBe(node.id);
  await touch.tapEl('[data-touch="stop"]');
  await expect.poll(async () => (await unit(page, ds[0].id)).order).toBe('idle');
  // An enemy (a stationary test target) next to our Drones: Order + tap it = attack.
  const enemy = await page.evaluate(([x, y]) => window.__game.world.issue({ type: 'devSpawn', unit: 'dummy', team: 2, x: x + 90, y }).id, [ds[0].x, ds[0].y]);
  const e = await unit(page, enemy);
  await centerOn(page, e.x, e.y);
  const es = await screenOf(page, e.x, e.y);
  await arm(page, touch, 'order');
  await touch.tap(es.x + 6, es.y - 6);
  const d0 = await unit(page, ds[0].id);
  expect(d0.order).toBe('attack');
  expect(d0.target).toBe(enemy);
});

test('⚔ Attack-move arms and fires; ✕ Cancel disarms without an order', async ({ page }) => {
  const { touch } = await openTouchGame(page);
  const ids = await page.evaluate(() => { const w = window.__game.world; const c = [...w.ofKind('building')].find((b) => b.team === 1); return [0, 1, 2].map((i) => w.issue({ type: 'devSpawn', unit: 'striker', team: 1, x: c.x + 120, y: c.y - 40 + i * 30 }).id); });
  await page.evaluate((ids) => window.__game.scene.ui.selection.set(ids), ids);
  await touch.tapEl('[data-touch="attack"]');
  await expect(page.locator('#armed-banner')).toContainText('attack-move');
  await touch.tapEl('[data-touch="cancel"]');
  await expect.poll(() => page.evaluate(() => window.__game.scene.ui.armed)).toBe(null);
  expect((await unit(page, ids[0])).order).not.toBe('attackMove');
  await arm(page, touch, 'attack');
  const u = await unit(page, ids[0]);
  const t = await screenOf(page, u.x + 150, u.y);
  await touch.tap(t.x, t.y);
  expect((await unit(page, ids[0])).order).toBe('attackMove');
});

test('Order with a Foundry selected sets its rally point', async ({ page }) => {
  const { touch } = await openTouchGame(page);
  const f = await page.evaluate(() => { const f = window.__game.world.addBuilding('foundry', 1, 14, 34, { built: true }); return { id: f.id, x: f.x, y: f.y }; });
  await centerOn(page, f.x + 50, f.y - 30);
  const fs = await screenOf(page, f.x, f.y);
  await touch.tap(fs.x, fs.y);
  expect(await sel(page)).toEqual([f.id]);
  await arm(page, touch, 'order');
  await expect(page.locator('#armed-banner')).toContainText('rally point');
  const r = await screenOf(page, f.x + 100, f.y - 60);
  await touch.tap(r.x, r.y);
  const rally = await page.evaluate((id) => window.__game.world.get(id).rally, f.id);
  expect(Math.hypot(rally.x - (f.x + 100), rally.y - (f.y - 60))).toBeLessThan(6);
});

test('touch placement: build button, drag the ghost, lift to place; ✕ cancels placement', async ({ page }) => {
  const { touch } = await openTouchGame(page);
  const ds = await selectDrones(page, touch);
  await touch.tapEl('#command-card button[data-action="build:depot"]');
  await expect(page.locator('#armed-banner')).toContainText('Lumen Depot');
  await touch.tapEl('[data-touch="cancel"]');
  await expect.poll(() => page.evaluate(() => window.__game.scene.ui.placing)).toBe(null);
  await touch.tapEl('#command-card button[data-action="build:depot"]');
  await expect.poll(() => page.evaluate(() => window.__game.scene.ui.placing)).toBe('depot'); // the tap's click has landed
  const from = await screenOf(page, ds[0].x + 40, ds[0].y - 100), to = await screenOf(page, ds[0].x + 60, ds[0].y - 110);
  await touch.drag(from.x, from.y, to.x, to.y);
  const site = await page.evaluate(() => [...window.__game.world.ofKind('building')].find((b) => b.team === 1 && b.type === 'depot'));
  expect(site).toBeTruthy();
  expect(site.built).toBe(false);
  expect(Math.hypot(site.x - (ds[0].x + 60), site.y - (ds[0].y - 110))).toBeLessThan(40);
  expect(await page.evaluate(() => window.__game.scene.ui.placing)).toBe(null);
});

// ---- P4-3: control groups and camera helpers --------------------------------

test('group bar: press-and-hold assigns (with fill feedback), tap recalls, tap twice centers the camera', async ({ page }) => {
  const { errors, touch } = await openTouchGame(page);
  const ds = await drones(page);
  await page.evaluate((ids) => window.__game.scene.ui.selection.set(ids), ds.slice(0, 2).map((d) => d.id));
  const slot = await page.locator('#groups button[data-group="3"]').boundingBox();
  const cx = slot.x + slot.width / 2, cy = slot.y + slot.height / 2;
  // A short press is a tap: it recalls (group 3 is empty) and does not assign.
  await touch.tap(cx, cy);
  expect(await page.evaluate(() => (window.__game.scene.ui.groups.groups.get(3) || []).length)).toBe(0);
  await touch.hold(cx, cy, 700);
  expect(await page.evaluate(() => window.__game.scene.ui.groups.groups.get(3))).toEqual(ds.slice(0, 2).map((d) => d.id));
  await expect(page.locator('#groups button[data-group="3"] span')).toHaveText('×2');
  expect(await sel(page)).toHaveLength(2); // assigning keeps the selection
  // Clear the selection, then tap the slot to recall it.
  const empty = await screenOf(page, ds[0].x, ds[0].y - 110);
  await touch.tap(empty.x, empty.y);
  expect(await sel(page)).toEqual([]);
  await touch.tap(cx, cy);
  expect(await sel(page)).toEqual(ds.slice(0, 2).map((d) => d.id).sort((a, b) => a - b));
  // Pan away, then tap twice quickly: the camera centers on the group.
  await touch.drag(400, 200, 800, 200);
  await touch.tap(cx, cy);
  await touch.tap(cx, cy);
  // The camera centers on the group (worldView's right/bottom are getters, so use width/height).
  const view = await page.evaluate(() => { const v = window.__game.scene.cameras.main.worldView; return { x: v.x, y: v.y, w: v.width, h: v.height }; });
  expect(ds[0].x > view.x && ds[0].x < view.x + view.w && ds[0].y > view.y && ds[0].y < view.y + view.h).toBe(true);
  expect(errors).toEqual([]);
});

test('tapping the under-attack alert jumps the camera to the attack', async ({ page }) => {
  const { touch } = await openTouchGame(page, '?mode=match&difficulty=easy&seed=3');
  const at = await page.evaluate(() => {
    const w = window.__game.world;
    const drone = [...w.ofKind('unit')].find((u) => u.team === 1);
    const id = w.issue({ type: 'devSpawn', unit: 'sparker', team: 2, x: drone.x + 150, y: drone.y }).id;
    w.issue({ type: 'attack', ids: [id], target: drone.id, team: 2 });
    return { x: drone.x, y: drone.y };
  });
  await expect(page.locator('#toast')).toContainText('Tap here', { timeout: 10000 });
  await page.evaluate(() => window.__game.scene.cameras.main.centerOn(2000, 1500));
  await touch.tapEl('#toast');
  const mid = await page.evaluate(() => window.__game.scene.cameras.main.midPoint);
  expect(Math.hypot(mid.x - at.x, mid.y - at.y)).toBeLessThan(400);
});

// ---- P4-7: the tutorial, played with touch only -----------------------------

test('first-run tutorial on touch: every hint teaches touch, and touch alone completes all six steps', async ({ page }) => {
  const { errors, touch } = await openTouchGame(page, '?mode=match&difficulty=easy&seed=6&speed=8', { tutorial: true });
  // Test setup: the opponent stays idle. At 8x speed its scout otherwise reaches
  // the base mid-test, and a new Striker that auto-engages it finishes step 6
  // before the player's own touch order does.
  await page.evaluate(() => { window.__game.match.brains.length = 0; });
  const step = () => page.locator('#tutorial-step').textContent();
  await expect(page.locator('#tutorial')).toBeVisible();
  await expect(page.locator('#tutorial-text')).toContainText('Tap a');
  // 1. select: double-tap a Drone
  const ds = await drones(page);
  let s = await screenOf(page, ds[0].x, ds[0].y);
  await touch.doubleTap(s.x, s.y);
  await expect.poll(step).toBe('2 / 6');
  await expect(page.locator('#tutorial-text')).toContainText('Order');
  // 2. gather: Order, then tap the nearest crystal
  const node = await page.evaluate(([x, y]) => { const ns = [...window.__game.world.ofKind('node')]; ns.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y)); return { x: ns[0].x, y: ns[0].y }; }, [ds[0].x, ds[0].y]);
  await centerOn(page, (node.x + ds[0].x) / 2, (node.y + ds[0].y) / 2);
  await arm(page, touch, 'order');
  s = await screenOf(page, node.x, node.y);
  await touch.tap(s.x, s.y);
  await expect.poll(step).toBe('3 / 6');
  // 3. depot and 4. foundry: build buttons, then drag to place (Drones are still selected)
  for (const [type, dx, next] of [['depot', -120, '4 / 6'], ['foundry', -110, '5 / 6']]) {
    await touch.tapEl(`#command-card button[data-action="build:${type}"]`);
    await expect.poll(() => page.evaluate(() => window.__game.scene.ui.placing)).toBe(type);
    const core = await page.evaluate(() => { const c = [...window.__game.world.ofKind('building')].find((b) => b.team === 1 && b.type === 'core'); return { x: c.x, y: c.y }; });
    const spot = type === 'depot' ? { x: core.x + 150, y: core.y - 110 } : { x: core.x + 150, y: core.y + 150 };
    await centerOn(page, spot.x + dx, spot.y);
    const a = await screenOf(page, spot.x - 30, spot.y), b = await screenOf(page, spot.x, spot.y);
    await touch.drag(a.x, a.y, b.x, b.y);
    await expect.poll(step).toBe(next);
    // Let the Depot finish before the Foundry takes its builders (a Drone must stay on a site).
    if (type === 'depot') await expect.poll(() => page.evaluate(() => [...window.__game.world.ofKind('building')].some((x) => x.team === 1 && x.type === 'depot' && x.built)), { timeout: 30000 }).toBe(true);
  }
  // 5. train: wait for the Foundry, send the idle builders back to mining
  // (placement sends every selected Drone to build), then tap the Foundry and a unit button.
  await expect.poll(() => page.evaluate(() => [...window.__game.world.ofKind('building')].some((b) => b.team === 1 && b.type === 'foundry' && b.built)), { timeout: 30000 }).toBe(true);
  const d0 = await page.evaluate(() => { const u = [...window.__game.world.ofKind('unit')].find((x) => x.team === 1 && x.type === 'drone'); return { x: u.x, y: u.y }; });
  await centerOn(page, (d0.x + node.x) / 2, (d0.y + node.y) / 2);
  s = await screenOf(page, d0.x, d0.y);
  await touch.doubleTap(s.x, s.y);
  await arm(page, touch, 'order');
  s = await screenOf(page, node.x, node.y);
  await touch.tap(s.x, s.y);
  const f = await page.evaluate(() => { const b = [...window.__game.world.ofKind('building')].find((x) => x.team === 1 && x.type === 'foundry'); return { x: b.x, y: b.y }; });
  await centerOn(page, f.x - 100, f.y);
  s = await screenOf(page, f.x, f.y);
  await touch.tap(s.x, s.y);
  // Depot + Foundry spent the starting Lumen: wait until the Drones have mined enough.
  await expect(page.locator('#command-card button[data-action="train:striker"]')).toBeEnabled({ timeout: 30000 });
  await touch.tapEl('#command-card button[data-action="train:striker"]');
  await expect.poll(step, { timeout: 30000 }).toBe('6 / 6');
  // 6. attack: once the new Striker has stopped walking out of the Foundry,
  // tap it, arm Attack-move and tap the ground ahead.
  await expect.poll(() => page.evaluate(() => [...window.__game.world.ofKind('unit')].find((x) => x.team === 1 && x.type === 'striker')?.order.type), { timeout: 30000 }).toBe('idle');
  // At 8x speed an idle unit can be nudged by passing Drones between reading its
  // position and the tap landing, so read and tap again until the Striker itself is selected.
  let st;
  await expect(async () => {
    st = await page.evaluate(() => { const u = [...window.__game.world.ofKind('unit')].find((x) => x.team === 1 && x.type === 'striker'); return { x: u.x, y: u.y }; });
    await centerOn(page, st.x, st.y);
    s = await screenOf(page, st.x, st.y);
    await touch.tap(s.x, s.y);
    expect(await page.evaluate(() => [...window.__game.scene.ui.selection.ids].map((id) => window.__game.world.get(id)?.type))).toEqual(['striker']);
  }).toPass({ timeout: 15000 });
  await arm(page, touch, 'attack');
  // Attack-move far enough that the march outlasts the tutorial's 250 ms check
  // at 8x speed (a 150 px march used to finish, and go idle, in between).
  await centerOn(page, st.x + 250, st.y);
  s = await screenOf(page, st.x + 500, st.y);
  await touch.tap(s.x, s.y);
  await expect.poll(step).toBe('done');
  await expect(page.locator('#tutorial-text')).toContainText('pinch to zoom');
  expect(errors).toEqual([]);
});

test('a tap on a building selects the building even when a unit stands over its edge', async ({ page }) => {
  const { touch } = await openTouchGame(page);
  const { f, d } = await page.evaluate(() => {
    const w = window.__game.world;
    const f = w.addBuilding('foundry', 1, 14, 22, { built: true });
    const d = w.issue({ type: 'devSpawn', unit: 'drone', team: 1, x: f.x + 30, y: f.y + 36 }).id;
    return { f: { id: f.id, x: f.x, y: f.y }, d };
  });
  await centerOn(page, f.x, f.y);
  // The fingertip lands on the Foundry, ~22 px from the Drone: the Foundry wins.
  const s = await screenOf(page, f.x + 14, f.y + 18);
  await touch.tap(s.x, s.y);
  expect(await sel(page)).toEqual([f.id]);
  // A tap right on the Drone still selects the Drone.
  const u = await page.evaluate((id) => { const x = window.__game.world.get(id); return { x: x.x, y: x.y }; }, d);
  const us = await screenOf(page, u.x, u.y);
  await touch.tap(us.x, us.y);
  expect(await sel(page)).toEqual([d]);
});
