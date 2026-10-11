// Platform Milestone 1: Ringout through the real TURN relay. Every player asks
// the deployed Worker for a short-lived credential exactly as the shipped page
// does, and one player is forced through the relay (iceTransportPolicy
// 'relay'), as behind carrier-grade NAT. The relay fallback is the module's,
// so the second game gets it with no code of its own. CI: npm run test:relay.
import { test, expect } from '@playwright/test';
import { lobbyToGame, scriptPlayer, netState, sameHashes } from './ringout-helpers.js';

test.skip(!process.env.RELAY, 'needs the real Cloudflare TURN service (RELAY=1)');
test.describe.configure({ timeout: 6 * 60_000 });

test('Ringout: a relay-only player plays with two direct ones, identical state', async ({ browser }) => {
  // lobbyToGame builds every player alike; the relay-only one is built here.
  const names = ['Ava', 'Bram', 'Relay'];
  const { ps } = await lobbyToGame(browser, names, { turn: 'live', timing: { speed: 2, hashEvery: 25 }, relayOnly: 'Relay' });
  for (const [i, p] of ps.entries()) await scriptPlayer(p, 40 + i);
  await expect.poll(async () => (await netState(ps[0])).tick, { timeout: 120_000 }).toBeGreaterThan(800);
  const st = await Promise.all(ps.map(netState));
  const cmp = sameHashes(st);
  console.log(`# Ringout with a relay-only player: candidates gathered ${JSON.stringify(st[2].gathered)}; ${cmp.shared} shared checkpoints ${cmp.ok ? 'identical' : 'DIFFER'}`);
  expect(st[2].gathered.relay, 'the relay-only player gathered relay candidates').toBeGreaterThan(0);
  expect(st[2].gathered.host ?? 0, 'and used no other kind').toBe(0);
  expect(cmp.ok, JSON.stringify(cmp)).toBe(true);
  expect(cmp.shared).toBeGreaterThan(20);
  for (const p of ps) await p.context.close();
});
