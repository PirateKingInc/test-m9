// A multiplayer match on phone screens, both orientations. Chat is on demand:
// a Chat button in the touch action bar (with Order, Attack, Stop, Box,
// Cancel, Base) opens a panel; closed, nothing lies over the map; a badge on
// the button counts lines that came in while it was closed. Open, the panel
// sits above the row of group slots, never over the action bar or the slots,
// and lets map gestures through everywhere but its input and close button.
// And pinching out as far as it goes mid-match leaves the camera free to pan.
import { test, expect } from '@playwright/test';
import { lobbyToGame } from './mp-helpers.js';
import { touchOn } from './touch-helpers.js';

const SHOTS = process.env.SHOTS_DIR; // set to save screenshots of each screen size
const SCREENS = {
  'landscape phone': { width: 844, height: 390 },
  'small landscape phone': { width: 667, height: 375 },
  'portrait phone': { width: 390, height: 844 },
  'small portrait phone': { width: 360, height: 640 },
};

// Screen rects of the controls that matter; whether each is really on top at
// its centre and just inside its corners (nothing over it); and whether a grid
// of points over the map, clear of the HUD, reaches the game's canvas.
const layout = (page) => page.evaluate(() => {
  const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, id: e.id || e.dataset.touch || (e.dataset.chat !== undefined ? 'chat' : '') || e.dataset.group || e.tagName }; };
  const visible = (e) => e && !e.hidden && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
  const onTop = (e) => {
    const r = e.getBoundingClientRect(), pts = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]];
    return pts.every(([fx, fy]) => { const hit = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy); return hit === e || e.contains(hit); });
  };
  const $ = (id) => document.getElementById(id);
  const buttons = [...document.querySelectorAll('#touchbar button')].filter(visible);
  const slots = [...document.querySelectorAll('#groups button')].filter(visible);
  const canvas = document.querySelector('#game canvas');
  const bar = box($('touchbar')), groups = box($('groups')), top = $('hud-top').getBoundingClientRect(), bottom = $('hud-bottom').getBoundingClientRect();
  // The map area the HUD leaves free, minus the action bar and the slots.
  const miss = [];
  for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
    const x = (W * i) / 12, y = top.bottom + ((Math.min(bottom.top, groups.t) - top.bottom) * j) / 12;
    if (x >= bar.l - 2 && x <= bar.r + 2 && y >= bar.t - 2 && y <= bar.b + 2) continue;
    if (x >= groups.l - 2 && x <= groups.r + 2 && y >= groups.t - 2 && y <= groups.b + 2) continue;
    if (document.elementFromPoint(x, y) !== canvas) miss.push([Math.round(x), Math.round(y), document.elementFromPoint(x, y)?.id || document.elementFromPoint(x, y)?.tagName]);
  }
  const chat = $('net-chat'), badge = document.querySelector('#touchbar [data-chat] .net-unread');
  return {
    W, H, touchMode: document.body.classList.contains('touch'), open: visible(chat),
    chat: box(chat), log: box($('net-chat-log')), input: box($('net-chat-input')), close: box($('net-chat-close')), bar, groups,
    badge: visible(badge) ? { ...box(badge), text: badge.textContent } : null,
    buttons: buttons.map((b) => ({ ...box(b), onTop: onTop(b) })),
    slots: slots.map((b) => ({ ...box(b), onTop: onTop(b) })),
    inputOnTop: visible(chat) && onTop($('net-chat-input')), closeOnTop: visible(chat) && onTop($('net-chat-close')),
    logToMap: visible(chat) && document.elementFromPoint((box($('net-chat-log')).l + box($('net-chat-log')).r) / 2, (box($('net-chat-log')).t + box($('net-chat-log')).b) / 2) === canvas,
    mapMisses: miss,
    lines: document.querySelectorAll('#net-chat-log .net-chat-line').length,
    page: { dw: document.documentElement.scrollWidth, dh: document.documentElement.scrollHeight },
  };
});

// Keyboard heights (CSS px) of common phone keyboards at these screen sizes,
// suggestions row included.
const KEYBOARD = { 'landscape phone': 200, 'small landscape phone': 190, 'portrait phone': 336, 'small portrait phone': 280 };

async function keyboardUp(page, model, viewport, kb) {
  if (model === 'content') { await page.setViewportSize({ width: viewport.width, height: viewport.height - kb }); return; }
  await page.evaluate((h) => {
    const real = window.__realVV || (window.__realVV = window.visualViewport);
    const fake = new Proxy(real, { get: (t, p) => (p === 'height' ? h : typeof t[p] === 'function' ? t[p].bind(t) : t[p]) });
    Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });
    real.dispatchEvent(new Event('resize'));
  }, viewport.height - kb);
}
async function keyboardDown(page, model, viewport) {
  if (model === 'content') { await page.setViewportSize(viewport); return; }
  await page.evaluate(() => { Object.defineProperty(window, 'visualViewport', { value: window.__realVV, configurable: true }); window.__realVV.dispatchEvent(new Event('resize')); });
}
// Where the chat's field and Send button are, against the visible area.
const typingView = (page) => page.evaluate(() => {
  const $ = (id) => document.getElementById(id);
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left + scrollX, t: r.top + scrollY, r: r.right + scrollX, b: r.bottom + scrollY }; };
  const onTop = (e) => { const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit === e || e.contains(hit); };
  const vv = window.visualViewport, input = $('net-chat-input');
  const style = getComputedStyle(input), ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${style.fontSize} ${style.fontFamily}`;
  const textW = ctx.measureText(input.value).width, roomW = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return {
    vis: { l: vv.pageLeft, t: vv.pageTop, w: vv.width, h: vv.height },
    docked: $('net-chat').classList.contains('docked'),
    chat: box($('net-chat')), input: box(input), send: box($('net-chat-send')),
    inputOnTop: onTop(input), sendOnTop: onTop($('net-chat-send')),
    value: input.value, textFits: roomW > 120 && roomW > Math.min(textW, 200), sendEnabled: !$('net-chat-send').disabled,
  };
});

const overlap = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;
const inside = (a, W, H) => a.l >= -0.5 && a.t >= -0.5 && a.r <= W + 0.5 && a.b <= H + 0.5;
const mid = (r) => [(r.l + r.r) / 2, (r.t + r.b) / 2];

// The action bar (with Chat) and the slots: all on screen, none covered, none
// overlapping another.
function expectControls(L, at) {
  expect(L.buttons.map((b) => b.id), at).toEqual(['order', 'attack', 'stop', 'box', 'cancel', 'base', 'chat']);
  expect(L.slots.length, at).toBeGreaterThanOrEqual(6);
  for (const b of [...L.buttons, ...L.slots]) {
    expect(inside(b, L.W, L.H), `${at}: ${b.id} fully on screen`).toBe(true);
    expect(b.onTop, `${at}: ${b.id} not covered by anything`).toBe(true);
  }
  const all = [...L.buttons, ...L.slots];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i], all[j]), `${at}: ${all[i].id} and ${all[j].id} do not overlap`).toBe(false);
  for (const s of L.slots) expect(overlap(s, L.bar), `${at}: the action bar clear of slot ${s.id}`).toBe(false);
  expect(L.page, `${at}: the page does not scroll`).toEqual({ dw: L.W, dh: L.H });
}

for (const [label, viewport] of Object.entries(SCREENS)) {
  test(`${label}: Chat button in the action bar, panel on demand, map clear when closed; pinch-out then pan works`, async ({ browser }) => {
    test.setTimeout(3 * 60_000);
    const { ps } = await lobbyToGame(browser, ['Ava', 'Bram'], { contextOptions: { viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } });
    const [p, q] = ps;
    const touch = await touchOn(p.page);
    const shot = (name) => SHOTS && p.page.screenshot({ path: `${SHOTS}/mp-${label.replace(/ /g, '-')}-${name}.png` });
    const cam = () => p.page.evaluate(() => { const c = globalThis.__game.scene.cameras.main; return { z: c.zoom, x: c.scrollX, y: c.scrollY }; });

    // Closed by default: nothing over the map.
    let L = await layout(p.page);
    expect(L.touchMode, 'the phone is in touch mode').toBe(true);
    expect(L.open, 'the chat panel is closed at the start').toBe(false);
    expect(L.mapMisses, 'closed: every point of the map reaches the game').toEqual([]);
    expectControls(L, 'closed');
    expect(L.badge, 'no unread badge yet').toBeNull();

    // Bram writes three lines: a badge on Ava's Chat button counts them, and
    // covers none of the other controls.
    await q.page.evaluate(() => { for (let i = 1; i <= 3; i++) globalThis.__net.session.chat(`Bram line ${i}: good luck and have fun out there`); });
    await expect.poll(async () => (await layout(p.page)).badge?.text, { timeout: 10_000 }).toBe('3');
    L = await layout(p.page);
    expect(inside(L.badge, L.W, L.H), 'badge on screen').toBe(true);
    for (const b of [...L.buttons.filter((b) => b.id !== 'chat'), ...L.slots]) expect(overlap(L.badge, b), `badge clear of ${b.id}`).toBe(false);
    expect(L.mapMisses, 'still closed: the map is clear').toEqual([]);
    await shot('closed');

    // A real tap on Chat opens the panel and clears the badge.
    const chatBtn = L.buttons.find((b) => b.id === 'chat');
    await touch.tap(...mid(chatBtn));
    await expect.poll(async () => (await layout(p.page)).open).toBe(true);
    await p.page.waitForTimeout(600); // placed on open and re-placed every 500 ms
    L = await layout(p.page);
    expect(L.badge, 'opening clears the badge').toBeNull();
    expect(L.lines).toBe(3);
    expect(inside(L.chat, L.W, L.H), `panel on screen ${JSON.stringify(L.chat)}`).toBe(true);
    expect(overlap(L.chat, L.bar), `panel ${JSON.stringify(L.chat)} clear of the action bar ${JSON.stringify(L.bar)}`).toBe(false);
    expect(overlap(L.chat, L.groups), `panel ${JSON.stringify(L.chat)} clear of the group slots ${JSON.stringify(L.groups)}`).toBe(false);
    expect(L.chat.b, 'above the row of group slots').toBeLessThanOrEqual(L.groups.t);
    expect(L.chat.r, 'on the right-hand side').toBeGreaterThan(L.W * 0.6);
    expectControls(L, 'open');
    expect(L.inputOnTop && L.closeOnTop, 'the input and the close button are not covered').toBe(true);
    expect(L.log.b - L.log.t, 'the log shows a few lines').toBeGreaterThan(30);
    expect(L.logToMap, 'open: a touch on the log reaches the map').toBe(true);
    await shot('open');

    // Open, the log lets map gestures through: a drag and a pinch that start
    // on it move the camera.
    const [lx, ly] = mid(L.log);
    let c0 = await cam();
    await touch.drag(lx, ly, lx - 60, ly - 40);
    let c1 = await cam();
    expect(Math.hypot(c1.x - c0.x, c1.y - c0.y), 'a drag starting on the open panel pans the map').toBeGreaterThan(30);
    c0 = await cam();
    await touch.pinch(lx, ly, 40, 90);
    expect((await cam()).z, 'a pinch on the open panel zooms the map').toBeGreaterThan(c0.z * 1.3);

    // Typing with the on-screen keyboard up, under both ways phones report
    // it (headless Chromium has no on-screen keyboard; each model reproduces
    // what the page sees and does):
    // - 'visual': iOS Safari, and Chrome on Android since v108: the visual
    //   viewport shrinks to the area above the keyboard; the page keeps its size.
    // - 'content': older Android browsers, Firefox: the page itself shrinks.
    // The field, what is typed in it and the Send button must stay in view
    // above the keyboard, and Send must work without dismissing the keyboard.
    for (const model of ['visual', 'content']) {
      const kb = KEYBOARD[label], at = `${model} keyboard (${kb} px)`;
      L = await layout(p.page);
      await touch.tap(...mid(L.input));
      expect(await p.page.evaluate(() => document.activeElement?.id), `${at}: the field takes a real tap`).toBe('net-chat-input');
      await keyboardUp(p.page, model, viewport, kb);
      await p.page.keyboard.type(`typing on a ${model} keyboard`);
      await p.page.waitForTimeout(450);
      const K = await typingView(p.page);
      expect(K.docked, `${at}: the panel docks above the keyboard`).toBe(true);
      for (const [name, r] of [['field', K.input], ['Send button', K.send], ['panel', K.chat]]) {
        expect(r.t, `${at}: the ${name} is below the top of the visible area`).toBeGreaterThanOrEqual(K.vis.t - 0.5);
        expect(r.b, `${at}: the ${name} (bottom ${r.b.toFixed(1)}) is above the keyboard (visible area ends ${(K.vis.t + K.vis.h).toFixed(1)})`).toBeLessThanOrEqual(K.vis.t + K.vis.h + 0.5);
        expect(r.l >= K.vis.l - 0.5 && r.r <= K.vis.l + K.vis.w + 0.5, `${at}: the ${name} is within the screen's width`).toBe(true);
      }
      expect(K.inputOnTop && K.sendOnTop, `${at}: the field and Send are not covered`).toBe(true);
      expect(K.value, `${at}: what is typed is in the field`).toBe(`typing on a ${model} keyboard`);
      expect(K.textFits, `${at}: the field is wide enough to see what is being typed`).toBe(true);
      expect(K.sendEnabled, `${at}: Send is enabled once there is text`).toBe(true);
      // What the player sees above the keyboard.
      if (SHOTS) await p.page.screenshot({ path: `${SHOTS}/mp-${label.replace(/ /g, '-')}-keyboard-${model}.png`, clip: { x: 0, y: 0, width: viewport.width, height: viewport.height - kb } });
      // A real tap on Send (where it is now, above the keyboard) sends; the
      // field keeps the focus, so the keyboard stays up.
      await touch.tap(...mid(K.send));
      await expect.poll(() => q.page.evaluate(() => globalThis.__net.session.chatLog.map((c) => `${c.name}: ${c.text}`)), { message: `${at}: Send delivers` }).toContain(`Ava: typing on a ${model} keyboard`);
      expect(await p.page.evaluate(() => [document.activeElement?.id, document.getElementById('net-chat-input').value]), `${at}: the field keeps the focus and is cleared`).toEqual(['net-chat-input', '']);
      expect((await typingView(p.page)).sendEnabled, `${at}: Send is disabled with nothing to send`).toBe(false);
      // Enter still sends, as an alternative.
      await p.page.keyboard.type(`enter on a ${model} keyboard`);
      await p.page.keyboard.press('Enter');
      await expect.poll(() => q.page.evaluate(() => globalThis.__net.session.chatLog.map((c) => `${c.name}: ${c.text}`)), { message: `${at}: Enter delivers` }).toContain(`Ava: enter on a ${model} keyboard`);
      // Done typing: the keyboard goes down and the panel goes back to its place.
      await p.page.evaluate(() => document.activeElement.blur());
      await keyboardDown(p.page, model, viewport);
      await p.page.waitForTimeout(600);
      L = await layout(p.page);
      expect(await p.page.evaluate(() => document.getElementById('net-chat').classList.contains('docked')), `${at}: undocked after typing`).toBe(false);
      expect(overlap(L.chat, L.bar) || overlap(L.chat, L.groups), `${at}: back clear of the bar and the slots`).toBe(false);
      expect(L.page, `${at}: the page is back in place`).toEqual({ dw: L.W, dh: L.H });
      expect(await p.page.evaluate(() => [scrollX, scrollY]), `${at}: not scrolled`).toEqual([0, 0]);
    }
    await shot('typed');

    // ✕ closes it; Chat opens it again; Chat again closes it. (The panel grows
    // upward from above the slots, so the new line moved its ✕: look again.)
    await p.page.waitForTimeout(600);
    L = await layout(p.page);
    expect(overlap(L.chat, L.bar) || overlap(L.chat, L.groups), 'still clear of the bar and the slots with one more line').toBe(false);
    await touch.tap(...mid(L.close));
    await expect.poll(async () => (await layout(p.page)).open).toBe(false);
    expect(await p.page.evaluate(() => document.activeElement?.id || null)).not.toBe('net-chat-input');
    await touch.tap(...mid(chatBtn));
    await expect.poll(async () => (await layout(p.page)).open).toBe(true);
    await touch.tap(...mid(chatBtn));
    await expect.poll(async () => (await layout(p.page)).open).toBe(false);
    L = await layout(p.page);
    expect(L.mapMisses, 'closed again: the map is clear').toEqual([]);
    expectControls(L, 'closed again');
    // The Order button is the Order button (no chat focus).
    await touch.tap(...mid(L.buttons.find((b) => b.id === 'order')));
    expect(await p.page.evaluate(() => document.activeElement?.id || null)).not.toBe('net-chat-input');

    // Mid-match, pinch out as far as the gesture goes, then pan: the camera moves.
    const cx = viewport.width * 0.45, cy = viewport.height * 0.45;
    for (let i = 0; i < 3; i++) await touch.pinch(cx, cy, Math.min(viewport.width, viewport.height) * 0.7, 14);
    expect((await cam()).z).toBe(0.35);
    // Our camp is in a corner: drag toward the middle of the map first.
    for (let i = 0; i < 10; i++) {
      const off = await p.page.evaluate(() => { const c = globalThis.__game.scene.cameras.main, w = globalThis.__game.world; c.preRender(); return [w.width / 2 - c.midPoint.x, w.height / 2 - c.midPoint.y].map((d) => d * c.zoom); });
      if (Math.hypot(...off) < 40) break;
      const step = Math.min(1, 150 / Math.hypot(...off));
      await touch.drag(cx, cy, cx - off[0] * step, cy - off[1] * step);
    }
    for (const [dx, dy] of [[140, 0], [-140, 0], [0, 140], [0, -140]]) {
      c0 = await cam();
      await touch.drag(cx, cy, cx + dx, cy + dy);
      c1 = await cam();
      expect(Math.hypot(c1.x - c0.x, c1.y - c0.y), `a ${dx},${dy} drag pans after pinching all the way out`).toBeGreaterThan(140 / 0.35 * 0.5);
    }

    // And the match itself has been running all along on both phones.
    for (const x of ps) expect(await x.page.evaluate(() => globalThis.__net.session.ls.tick), `${x.name}'s game is running`).toBeGreaterThan(200);
    expect(ps.flatMap((x) => x.errors)).toEqual([]);
    for (const x of ps) await x.context.close();
  });
}
