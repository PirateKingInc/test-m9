// Platform Milestone 1, verification (c): Ringout, a game unlike Dragonmarch,
// plays real multiplayer sessions over the lockstep module's public API only:
// a whole match in three browsers to its result, and a player who reloads
// mid-match, is anchored, rejoins from a snapshot and plays on. Against the
// Firebase emulator (npm run test:mp).
import { test, expect } from '@playwright/test';
import { lobbyToGame, scriptPlayer, netState, sameHashes, inGame } from './ringout-helpers.js';

const TIMING = { speed: 3, graceMs: 5000, handbackStableMs: 3000, snapshotEvery: 200, hashEvery: 50 };
test.describe.configure({ timeout: 6 * 60_000 });

test('Ringout: three players play a whole match over WebRTC and end with the same state and result', async ({ browser }) => {
  const { ps } = await lobbyToGame(browser, ['Ava', 'Bram', 'Cora'], { timing: TIMING });
  for (const [i, p] of ps.entries()) await scriptPlayer(p, 10 + i);
  for (const p of ps) await expect.poll(async () => (await netState(p)).done, { timeout: 5 * 60_000, intervals: [2000] }).toBe(true);
  const st = await Promise.all(ps.map(netState));
  const cmp = sameHashes(st);
  console.log(`# Ringout, 3 browsers: ended at tick ${st[0].tick}, result ${JSON.stringify(st[0].result)}; ${cmp.shared} shared hash checkpoints ${cmp.ok ? 'identical' : 'DIFFER'}; commands sent ${st.map((s) => s.sent)}`);
  expect(cmp.ok, JSON.stringify(cmp)).toBe(true);
  expect(cmp.shared).toBeGreaterThan(20);
  for (const s of st) { expect(s.result).toEqual(st[0].result); expect(s.tick).toBe(st[0].tick); expect(s.desync).toBeNull(); expect(s.sent).toBeGreaterThan(10); }
  for (const p of ps) await expect(p.page.locator('#result')).toBeVisible();
  expect(ps.flatMap((p) => p.errors)).toEqual([]);
  for (const p of ps) await p.context.close();
});

test('Ringout: a player reloads mid-match, is anchored, rejoins from a snapshot and plays on', async ({ browser }) => {
  const { ps } = await lobbyToGame(browser, ['Ava', 'Bram', 'Cora'], { timing: { ...TIMING, speed: 1.5 } });
  for (const [i, p] of ps.entries()) await scriptPlayer(p, 20 + i);
  const [a, b, c] = ps;
  await expect.poll(async () => (await netState(a)).tick, { timeout: 60000 }).toBeGreaterThan(250);
  await b.page.reload(); // the same tab: sessionStorage keeps the match, so it rejoins
  for (const p of [a, c]) await expect.poll(async () => (await netState(p)).anchored?.[b.slot], { timeout: 60000, message: 'anchored' }).toBe(true);
  await inGame(b);
  await expect.poll(async () => (await netState(b)).caughtUpAt, { timeout: 60000 }).not.toBeNull();
  const caught = (await netState(b)).caughtUpAt;
  expect(caught.hash, 'the whole state at the catch-up tick equals the serving player\'s').toBe(caught.serverHash);
  await scriptPlayer(b, 99);
  for (const p of ps) await expect.poll(async () => (await netState(p)).anchored?.[b.slot], { timeout: 60000, message: 'handed back' }).toBe(false);
  await expect.poll(async () => (await netState(b)).tick, { timeout: 60000 }).toBeGreaterThan(caught.tick + 300);
  const st = await Promise.all(ps.map(netState));
  const cmp = sameHashes(st);
  console.log(`# Ringout rejoin: caught up at tick ${caught.tick} from slot ${caught.server} (hash ${caught.hash}); ${cmp.shared} shared checkpoints ${cmp.ok ? 'identical' : 'DIFFER'}`);
  expect(cmp.ok, JSON.stringify(cmp)).toBe(true);
  for (const s of st) expect(s.desync).toBeNull();
  expect(ps.flatMap((p) => p.errors)).toEqual([]);
  for (const p of ps) await p.context.close();
});
