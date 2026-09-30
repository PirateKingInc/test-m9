// A multiplayer match on phone screens, both orientations: the chat box sits
// bottom-right above the row of group slots and never covers the touch action
// bar (Order, Attack, Stop, Box, Cancel, Base) or the group slots, which all
// stay fully visible and tappable; and pinching out as far as it goes mid-match
// leaves the camera free to pan. (A real phone had the chat box on top of the
// Order button, and a camera that got stuck after pinching out.)
import { test, expect } from '@playwright/test';
import { lobbyToGame } from './mp-helpers.js';
import { touchOn } from './touch-helpers.js';

const SHOTS = process.env.SHOTS_DIR; // set to save a screenshot of each screen size
const SCREENS = {
  'landscape phone': { width: 844, height: 390 },
  'small landscape phone': { width: 667, height: 375 },
  'portrait phone': { width: 390, height: 844 },
  'small portrait phone': { width: 360, height: 640 },
};

// Screen rects of the controls that matter, and whether each one is really on
// top at its centre and just inside its corners (nothing drawn over it).
const layout = (page) => page.evaluate(() => {
  const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, id: e.id || e.dataset.touch || e.dataset.group || e.tagName }; };
  const visible = (e) => e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
  const onTop = (e) => {
    const r = e.getBoundingClientRect(), pts = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]];
    return pts.every(([fx, fy]) => { const hit = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy); return hit === e || e.contains(hit); });
  };
  const buttons = [...document.querySelectorAll('#touchbar button')].filter(visible);
  const slots = [...document.querySelectorAll('#groups button')].filter(visible);
  const input = document.getElementById('net-chat-input');
  return {
    W, H, touchMode: document.body.classList.contains('touch'),
    chat: box(document.getElementById('net-chat')), log: box(document.getElementById('net-chat-log')), input: box(input),
    bar: box(document.getElementById('touchbar')), groups: box(document.getElementById('groups')),
    buttons: buttons.map((b) => ({ ...box(b), onTop: onTop(b) })),
    slots: slots.map((b) => ({ ...box(b), onTop: onTop(b) })),
    inputOnTop: onTop(input),
    lines: document.querySelectorAll('#net-chat-log .net-chat-line').length,
    page: { dw: document.documentElement.scrollWidth, dh: document.documentElement.scrollHeight },
  };
});

const overlap = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;
const inside = (a, W, H) => a.l >= -0.5 && a.t >= -0.5 && a.r <= W + 0.5 && a.b <= H + 0.5;

for (const [label, viewport] of Object.entries(SCREENS)) {
  test(`${label}: chat above the group slots, clear of the action bar and the slots; pinch-out then pan works`, async ({ browser }) => {
    test.setTimeout(3 * 60_000);
    const { ps } = await lobbyToGame(browser, ['Ava', 'Bram'], { contextOptions: { viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } });
    const [p] = ps;
    // Chat enough to fill the log (it grows upward from above the slots).
    for (const q of ps) await q.page.evaluate(async (n) => { for (let i = 0; i < 3; i++) globalThis.__net.session.chat(`${n} line ${i + 1}: good luck and have fun out there`); }, q.name);
    await expect.poll(async () => (await layout(p.page)).lines, { timeout: 10_000 }).toBe(6);
    await p.page.waitForTimeout(700); // the box re-places itself every 500 ms

    const L = await layout(p.page);
    expect(L.touchMode, 'the phone is in touch mode').toBe(true);
    expect(L.buttons.map((b) => b.id)).toEqual(['order', 'attack', 'stop', 'box', 'cancel', 'base']);
    expect(L.slots.length).toBeGreaterThanOrEqual(6);
    expect(inside(L.chat, L.W, L.H), `chat box on screen ${JSON.stringify(L.chat)}`).toBe(true);
    expect(overlap(L.chat, L.bar), `chat box ${JSON.stringify(L.chat)} clear of the action bar ${JSON.stringify(L.bar)}`).toBe(false);
    expect(overlap(L.chat, L.groups), `chat box ${JSON.stringify(L.chat)} clear of the group slots ${JSON.stringify(L.groups)}`).toBe(false);
    expect(L.chat.b, 'above the row of group slots').toBeLessThanOrEqual(L.groups.t);
    expect(L.chat.r, 'on the right-hand side').toBeGreaterThan(L.W * 0.6);
    for (const b of [...L.buttons, ...L.slots]) {
      expect(inside(b, L.W, L.H), `${b.id} fully on screen`).toBe(true);
      expect(b.onTop, `${b.id} not covered by anything`).toBe(true);
    }
    expect(L.inputOnTop, 'the chat input is not covered').toBe(true);
    expect(L.log.b - L.log.t, 'the chat log shows a few lines').toBeGreaterThan(30);
    expect(L.page, 'the page does not scroll').toEqual({ dw: L.W, dh: L.H });

    // Real taps: the Order button is the Order button (it does not focus the
    // chat), and the chat input is the chat input.
    const touch = await touchOn(p.page);
    const order = L.buttons.find((b) => b.id === 'order');
    await touch.tap((order.l + order.r) / 2, (order.t + order.b) / 2);
    expect(await p.page.evaluate(() => document.activeElement?.id || null)).not.toBe('net-chat-input');
    await touch.tap((L.input.l + L.input.r) / 2, (L.input.t + L.input.b) / 2);
    expect(await p.page.evaluate(() => document.activeElement?.id)).toBe('net-chat-input');
    await p.page.evaluate(() => document.activeElement.blur());

    // Mid-match, pinch out as far as the gesture goes, then pan: the camera moves.
    const cam = () => p.page.evaluate(() => { const c = globalThis.__game.scene.cameras.main; return { z: c.zoom, x: c.scrollX, y: c.scrollY }; });
    const cx = viewport.width * 0.45, cy = viewport.height * 0.45;
    for (let i = 0; i < 3; i++) await touch.pinch(cx, cy, Math.min(viewport.width, viewport.height) * 0.7, 14);
    const a = await cam();
    expect(a.z).toBe(0.35);
    // Our camp is in a corner: drag toward the middle of the map first.
    for (let i = 0; i < 10; i++) {
      const off = await p.page.evaluate(() => { const c = globalThis.__game.scene.cameras.main, w = globalThis.__game.world; c.preRender(); return [w.width / 2 - c.midPoint.x, w.height / 2 - c.midPoint.y].map((d) => d * c.zoom); });
      if (Math.hypot(...off) < 40) break;
      const step = Math.min(1, 150 / Math.hypot(...off));
      await touch.drag(cx, cy, cx - off[0] * step, cy - off[1] * step);
    }
    for (const [dx, dy] of [[140, 0], [-140, 0], [0, 140], [0, -140]]) {
      const b0 = await cam();
      await touch.drag(cx, cy, cx + dx, cy + dy);
      const b1 = await cam();
      expect(Math.hypot(b1.x - b0.x, b1.y - b0.y), `a ${dx},${dy} drag pans after pinching all the way out`).toBeGreaterThan(140 / 0.35 * 0.5);
    }

    if (SHOTS) await p.page.screenshot({ path: `${SHOTS}/mp-${label.replace(/ /g, '-')}.png` });
    expect(ps.flatMap((q) => q.errors)).toEqual([]);
    for (const q of ps) await q.context.close();
  });
}
