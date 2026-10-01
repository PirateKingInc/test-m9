// Phase 11 verification (e, f): a real disconnect mid-match (the tab
// navigates away: its WebRTC and Firebase connections close), the AI holds
// the camp after the grace period, the same tab comes back, reconnects through
// Phase 10's signaling, restores a snapshot served by another player over the
// data channel, and is byte-identical to every other player once caught up;
// then it gets its camp back after a steady link. Run with a guest and with
// the lobby host as the one who leaves. Timings shortened for the test.
import { test, expect } from '@playwright/test';
import { lobbyToGame, scriptPlayer, netState, sameHashes, sleepRender } from './mp-helpers.js';

const NET = { speed: 4, graceMs: 5000, handbackStableMs: 3000, snapshotEvery: 200, hashEvery: 50 };

async function leaveAndReturn(browser, leaverIndex) {
  const { ps } = await lobbyToGame(browser, ['Ava', 'Bram', 'Cora'], { net: NET });
  const strategies = ['boom', 'rush', 'turtle'];
  for (const [i, p] of ps.entries()) { await scriptPlayer(p, strategies[i]); await sleepRender(p); }
  const leaver = ps[leaverIndex], stay = ps.filter((p) => p !== leaver);
  await expect.poll(async () => (await netState(leaver)).tick, { timeout: 60000 }).toBeGreaterThan(900); // play a while
  const tLeave = Date.now();
  await leaver.page.goto('about:blank'); // gone: its WebRTC and Firebase connections close

  // The others wait, then (after the grace period) the AI holds the camp.
  for (const p of stay) {
    await expect.poll(async () => (await netState(p)).held, { timeout: 60000 }).toEqual([leaver.slot]);
  }
  const heldAfter = Date.now() - tLeave;
  const heldTick = (await netState(stay[0])).tick;
  for (const p of stay) expect((await netState(p)).notices).toContain(`${leaver.name} is disconnected: the AI holds their camp.`);
  // Ticks pass under the AI.
  await expect.poll(async () => (await netState(stay[0])).tick, { timeout: 60000 }).toBeGreaterThan(heldTick + 300);

  // The same tab comes back: it rejoins from another player's snapshot.
  const tBack = Date.now();
  await leaver.page.goto('/');
  await expect.poll(() => leaver.page.evaluate(() => globalThis.__net?.session?.caughtUpAt ?? null), { timeout: 60000 }).not.toBeNull();
  const back = await netState(leaver);
  const caught = back.caughtUpAt;
  expect(caught.match, 'whole-state hash at the catch-up tick equals the serving player\'s').toBe(true);
  expect(caught.hash).toBe(caught.serverHash);
  expect(caught.server).not.toBe(leaver.slot);
  await sleepRender(leaver);

  // Handback: only after a steady link, announced to everyone.
  await expect.poll(async () => (await netState(leaver)).notices, { timeout: 60000 }).toContain('You are back in control of your camp.').catch(async (e) => {
    // Why no handback: every player's view of the returning one (the leader
    // hands back once it is caught up, at the live edge and steady).
    const view = (p) => p.page.evaluate((x) => {
      const ss = globalThis.__net.session, peer = ss.peers.get(x), now = ss.t.now();
      return { me: ss.me, mode: ss.mode, tick: ss.tick, leader: ss.leader?.(), held: ss.ls?.held(), backSent: ss.backSent ? [...ss.backSent] : null,
        peer: peer && { tick: peer.tick, caughtUp: peer.caughtUp, steadyFor: now - peer.since, heardAgo: now - peer.heard, connected: ss.t.connected(x) } };
    }, leaver.slot);
    for (const p of ps) console.log(`# DIAG ${p.name}:`, JSON.stringify(await view(p).catch((x) => String(x))));
    throw e;
  });
  const handedBackAfter = Date.now() - tBack;
  for (const p of stay) await expect.poll(async () => (await netState(p)).notices, { timeout: 30000 }).toContain(`${leaver.name} is back in control.`);
  await scriptPlayer(leaver, strategies[leaverIndex]); // its player plays again

  // Everyone identical from then on, at every hash checkpoint they share.
  await expect.poll(async () => (await netState(leaver)).tick, { timeout: 60000 }).toBeGreaterThan(caught.tick + 400);
  const st = await Promise.all(ps.map(netState));
  const cmp = sameHashes(st);
  expect(cmp.ok, JSON.stringify(cmp)).toBe(true);
  expect(cmp.shared).toBeGreaterThan(4);
  for (const s of st) expect(s.desync).toBeNull();
  expect(ps.flatMap((p) => p.errors)).toEqual([]);
  console.log(`# ${leaver.name} (slot ${leaver.slot}${leaverIndex === 0 ? ', the host' : ''}) left: held after ${(heldAfter / 1000).toFixed(1)} s (from tick ${heldTick}); came back, snapshot from slot ${caught.server}, caught up at tick ${caught.tick} with the same whole-state hash (${caught.hash}); back in control ${(handedBackAfter / 1000).toFixed(1)} s after returning; ${cmp.shared} shared hash checkpoints identical`);
  for (const p of ps) await p.context.close();
}

test.describe.configure({ timeout: 8 * 60_000 });

test('a guest leaves mid-match, the AI holds the camp, the guest rejoins byte-identical and takes it back', async ({ browser }) => {
  await leaveAndReturn(browser, 2);
});

test('the lobby host leaves and rejoins: another player serves the snapshot', async ({ browser }) => {
  await leaveAndReturn(browser, 0);
});

// Verification (e), a brief drop: the WebRTC links of one player die but the
// tab stays and Firebase still sees it. The others wait (no AI takeover: a
// player Firebase still sees is never taken over), the links reopen through
// Phase 10's signaling, and play resumes identical.
test('a brief network drop: links reopen, no takeover, play resumes identical', async ({ browser }) => {
  const { ps } = await lobbyToGame(browser, ['Ava', 'Bram', 'Cora'], { net: NET });
  for (const [i, p] of ps.entries()) { await scriptPlayer(p, ['boom', 'rush', 'turtle'][i]); await sleepRender(p); }
  const drop = ps[1];
  await expect.poll(async () => (await netState(drop)).tick, { timeout: 60000 }).toBeGreaterThan(600);
  const t0 = Date.now();
  await drop.page.evaluate(() => { for (const l of globalThis.__net.links.links.values()) l.pc.close(); });
  // Every link of that player comes back.
  await expect.poll(() => drop.page.evaluate(() => [...globalThis.__net.links.links.keys()].every((s) => globalThis.__net.links.connected(s))), { timeout: 60000, intervals: [250] }).toBe(true);
  const restored = Date.now() - t0;
  const tick = (await netState(ps[0])).tick;
  await expect.poll(async () => (await netState(drop)).tick, { timeout: 60000 }).toBeGreaterThan(tick + 400);
  const st = await Promise.all(ps.map(netState));
  for (const s of st) {
    expect(s.held).toEqual([]);
    expect(s.notices.filter((n) => /AI holds/.test(n))).toEqual([]);
    expect(s.desync).toBeNull();
  }
  const cmp = sameHashes(st);
  expect(cmp.ok, JSON.stringify(cmp)).toBe(true);
  expect(ps.flatMap((p) => p.errors)).toEqual([]);
  console.log(`# ${drop.name}'s links closed: reopened in ${(restored / 1000).toFixed(1)} s, no takeover, ${cmp.shared} shared hash checkpoints identical`);
  for (const p of ps) await p.context.close();
});
