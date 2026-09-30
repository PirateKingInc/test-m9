// Phase 11 verification (h): chat goes over the data channels to every
// player, under their lobby names; typing never reaches the game; it is rate
// limited; it has no effect on the game state; and it is kept in memory only
// (a reloaded page starts with an empty log).
import { test, expect } from '@playwright/test';
import { lobbyToGame, netState, sameHashes } from './mp-helpers.js';

test('chat reaches every player under their lobby names, and never touches the game', async ({ browser }) => {
  test.setTimeout(5 * 60_000);
  const { ps } = await lobbyToGame(browser, ['Ava', 'Bram', 'Cora'], { net: { speed: 2, hashEvery: 50 } });
  // Chat is on demand: closed at the start; Enter (or the top bar's Chat
  // button) opens it, Escape closes it.
  const panelOpen = (p) => p.page.locator('#net-chat').isVisible();
  const open = async (p) => { if (!(await panelOpen(p))) await p.page.keyboard.press('Enter'); await expect(p.page.locator('#net-chat-input')).toBeFocused(); };
  const say = async (p, text) => { await open(p); const box = p.page.locator('#net-chat-input'); await box.fill(text); await box.press('Enter'); };
  const log = (p) => p.page.locator('#net-chat-log .net-chat-line');
  const badge = (p) => p.page.locator('#net-chat-toggle .net-unread');

  for (const p of ps) expect(await panelOpen(p), 'closed by default').toBe(false);
  await say(ps[0], 'good luck all');
  // Ava's panel is open; Bram's and Cora's are closed and count the line.
  for (const p of ps.slice(1)) await expect(badge(p)).toHaveText('1');
  await expect(badge(ps[0])).toBeHidden();
  await say(ps[1], 'you too'); // opening Bram's panel clears his badge
  await expect(badge(ps[1])).toBeHidden();
  await expect(badge(ps[2])).toHaveText('2');
  await ps[2].page.locator('#net-chat-toggle').click(); // the top bar's button opens it too
  await expect(ps[2].page.locator('#net-chat')).toBeVisible();
  await expect(badge(ps[2])).toBeHidden();
  await ps[2].page.locator('#net-chat-input').press('Escape');
  await expect(ps[2].page.locator('#net-chat')).toBeHidden();
  for (const [i, p] of ps.entries()) {
    await expect(log(p)).toHaveCount(2);
    const lines = await log(p).allTextContents();
    expect(lines).toContain(i === 0 ? 'You: good luck all' : 'Ava: good luck all');
    expect(lines).toContain(i === 1 ? 'You: you too' : 'Bram: you too');
  }

  // Keys typed into the chat box are not game shortcuts: the selection and
  // the camera stay as they were.
  const view = (p) => p.page.evaluate(() => { const { scene } = globalThis.__game, cam = scene.cameras.main; return { sel: scene.ui.selection.ids.join(), out: globalThis.__net.session.ls.outbox.length, x: cam.scrollX, y: cam.scrollY }; });
  const before = await view(ps[2]);
  await open(ps[2]);
  await ps[2].page.keyboard.type('asdw qe 12345 hold');
  await ps[2].page.keyboard.press('Control+a');
  expect(await view(ps[2])).toEqual(before);
  await ps[2].page.keyboard.press('Enter');
  for (const p of ps) await expect(log(p)).toHaveCount(3);

  // Rate limit: a burst of eight from one player; only what the window
  // (5 lines per 5 s) still allows gets through.
  const burst = await ps[1].page.evaluate(() => {
    const s = globalThis.__net.session, now = performance.now();
    const room = s.net.chatBurst - s.chatTimes.filter((t) => now - t < s.net.chatWindowMs).length;
    const accepted = Array.from({ length: 8 }, (_, i) => s.chat(`spam ${i}`)).filter(Boolean).length;
    return { room, accepted };
  });
  expect(burst.accepted).toBe(burst.room);
  expect(burst.accepted).toBeLessThan(8);
  for (const p of ps) await expect(log(p)).toHaveCount(3 + burst.accepted);

  // Long lines are cut to the limit.
  await say(ps[0], 'x'.repeat(500));
  await expect.poll(async () => (await log(ps[2]).last().textContent()).length).toBe('Ava: '.length + 200);

  // No effect on the game: every page still has the same state at every checkpoint.
  await expect.poll(async () => (await netState(ps[0])).tick, { timeout: 60000 }).toBeGreaterThan(400);
  const st = await Promise.all(ps.map(netState));
  const cmp = sameHashes(st);
  expect(cmp.ok, JSON.stringify(cmp)).toBe(true);
  expect(cmp.shared).toBeGreaterThan(4);
  for (const s of st) { expect(s.desync).toBeNull(); expect(s.chat).toHaveLength(4 + burst.accepted); }

  // In memory only: a reloaded page starts over with no chat.
  await ps[2].page.reload();
  await expect.poll(() => ps[2].page.evaluate(() => globalThis.__net?.session?.caughtUpAt ?? null), { timeout: 60000 }).not.toBeNull();
  expect((await netState(ps[2])).chat).toEqual([]);
  expect(await ps[2].page.evaluate(() => JSON.stringify(localStorage).includes('good luck') || JSON.stringify(sessionStorage).includes('good luck'))).toBe(false);
  await say(ps[2], 'back again');
  for (const p of ps.slice(0, 2)) await expect(log(p).last()).toHaveText('Cora: back again');
  expect(ps.flatMap((p) => p.errors)).toEqual([]);
  console.log(`# chat: ${4 + burst.accepted} lines seen by all three players under lobby names; a burst of 8 cut to ${burst.accepted}; ${cmp.shared} shared hash checkpoints identical; empty after a reload`);
  for (const p of ps) await p.context.close();
});
