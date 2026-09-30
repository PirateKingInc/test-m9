// Phase 11 verification (c): real, independent browser contexts, connected by
// real WebRTC through Phase 10's lobby, play a whole free-for-all through real
// command transmission and end with identical state on every peer.
import { test, expect } from '@playwright/test';
import { lobbyToGame, scriptPlayer, netState, sameHashes, sleepRender } from './mp-helpers.js';

const FAST = { speed: 8 }; // 8x game time per real time (the lockstep is tick-based)

test('two players play a whole match over WebRTC and end with identical state', async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const { ps } = await lobbyToGame(browser, ['Ava', 'Bram'], { net: FAST });
  await uiCommandCrosses(ps[0], ps[1]);
  for (const p of ps) await sleepRender(p); // the screen's part is done; save CPU for the simulation
  await scriptPlayer(ps[0], 'boom');
  await scriptPlayer(ps[1], 'rush');
  await untilDone(ps, 8 * 60_000);
  const st = await Promise.all(ps.map(netState));
  console.log(`# 2 players: ${st[0].result.reason} at tick ${st[0].tick}, winner camp ${st[0].result.winner}; commands sent ${st.map((s) => s.sent)}; final hash ${st[0].hash}`);
  expect(st[1].tick).toBe(st[0].tick);
  expect(st[1].hash).toBe(st[0].hash);
  expect(st[1].result).toEqual(st[0].result);
  for (const s of st) { expect(s.desync).toBeNull(); expect(s.sent).toBeGreaterThan(100); }
  expect(ps.flatMap((p) => p.errors)).toEqual([]);
  for (const p of ps) await p.context.close();
});

// Wait for the match to end on every page (a timeout says how far each got).
async function untilDone(ps, timeout) {
  for (const p of ps) {
    await expect.poll(async () => { const s = await netState(p); return s.done || `${p.name} at tick ${s.tick}, mode ${s.mode}, waiting ${JSON.stringify(await p.page.evaluate(() => globalThis.__net.session.status().waiting))}`; },
      { timeout, intervals: [3000] }).toBe(true);
  }
}

// A command given through the game screen (the world the UI holds) is not
// applied at once: it goes through the lockstep and lands on both pages at
// the same tick.
async function uiCommandCrosses(a, b) {
  const sent = await a.page.evaluate(() => {
    const { scene } = globalThis.__game, me = globalThis.__net.session.me, ls = globalThis.__net.session.ls;
    const u = [...ls.world.ofKind('unit')].find((x) => x.team === me && x.type === 'drone');
    const x = u.x + 3 * 32, y = u.y;
    const before = JSON.stringify(u.order);
    scene.world.issue({ type: 'move', ids: [u.id], x, y, team: me });
    return { id: u.id, x, y, tick: ls.tick, applied: JSON.stringify(u.order) !== before };
  });
  expect(sent.applied, 'the UI command waits for its tick').toBe(false);
  // The tick whose turns carried it, on each page.
  const landed = (p) => p.page.evaluate(({ id, x }) => {
    for (const [T, turns] of globalThis.__net.session.ls.executed) {
      for (const t of turns) if ((t.c || []).some((c) => c.type === 'move' && c.ids?.includes(id) && c.x === x)) return T;
    }
    return null;
  }, sent);
  for (const p of [a, b]) await expect.poll(() => landed(p), { timeout: 20000, intervals: [100] }).not.toBeNull();
  const at = await Promise.all([a, b].map(landed));
  console.log(`# UI move for unit ${sent.id}, given at tick ${sent.tick}, carried out at tick ${at[0]} on one page and ${at[1]} on the other`);
  expect(at[1]).toBe(at[0]);
  expect(at[0]).toBeGreaterThan(sent.tick);
}

// Verification (c) with four players: every camp human, whole match.
test('four players play a whole match over WebRTC and end with identical state', async ({ browser }) => {
  test.setTimeout(20 * 60_000);
  const { ps } = await lobbyToGame(browser, ['Ava', 'Bram', 'Cora', 'Dunn'], { net: FAST });
  for (const p of ps) await sleepRender(p);
  for (const [i, p] of ps.entries()) await scriptPlayer(p, ['boom', 'rush', 'turtle', 'boom'][i]);
  const t0 = Date.now();
  await untilDone(ps, 17 * 60_000);
  const st = await Promise.all(ps.map(netState));
  console.log(`# 4 players: ${st[0].result.reason} at tick ${st[0].tick} (${(st[0].tick / 20 / 60).toFixed(1)} game min in ${((Date.now() - t0) / 1000).toFixed(0)} s real), winner camp ${st[0].result.winner}; commands sent ${st.map((s) => s.sent)}; final hash ${st[0].hash}`);
  for (const s of st.slice(1)) {
    expect(s.tick).toBe(st[0].tick);
    expect(s.hash).toBe(st[0].hash);
    expect(s.result).toEqual(st[0].result);
  }
  const same = sameHashes(st);
  console.log(`# ${same.shared} shared hash checkpoints identical`);
  expect(same.ok).toBe(true);
  for (const s of st) { expect(s.desync).toBeNull(); expect(s.sent).toBeGreaterThan(50); }
  expect(ps.flatMap((p) => p.errors)).toEqual([]);
  for (const p of ps) await p.context.close();
});

// Verification (d): real-time play (1x) with every data-channel message
// delayed. The 200 ms input delay hides typical latency completely (the game
// keeps its 20 ticks per second); latency beyond it slows the game down (every
// game waits for the late turns) but never splits it.
for (const [lo, hi, minRate] of [[40, 150, 19], [150, 400, 8]]) {
  test(`three players with ${lo}-${hi} ms per message: ${minRate >= 19 ? 'full speed' : 'slower, never apart'}, identical`, async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const { ps } = await lobbyToGame(browser, ['Ava', 'Bram', 'Cora'], { net: { speed: 1, hashEvery: 50 }, latency: [lo, hi] });
    for (const [i, p] of ps.entries()) { await sleepRender(p); await scriptPlayer(p, ['boom', 'rush', 'turtle'][i]); }
    const tick0 = (await netState(ps[0])).tick, t0 = Date.now();
    await ps[0].page.waitForTimeout(60_000);
    const rate = ((await netState(ps[0])).tick - tick0) / ((Date.now() - t0) / 1000);
    const st = await Promise.all(ps.map(netState));
    const cmp = sameHashes(st);
    console.log(`# ${lo}-${hi} ms per message: ${rate.toFixed(1)} ticks/s (20 is full speed) over 60 s; ${cmp.shared} shared hash checkpoints ${cmp.ok ? 'identical' : 'DIFFER'}; commands sent ${st.map((s) => s.sent)}`);
    expect(rate).toBeGreaterThanOrEqual(minRate);
    expect(cmp.ok, JSON.stringify(cmp)).toBe(true);
    expect(cmp.shared).toBeGreaterThan(10);
    for (const s of st) { expect(s.desync).toBeNull(); expect(s.held).toEqual([]); }
    expect(ps.flatMap((p) => p.errors)).toEqual([]);
    for (const p of ps) await p.context.close();
  });
}
