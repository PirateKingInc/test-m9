// Phase 11: the lockstep across browser engines. Chromium, Firefox and WebKit
// each ship their own Math.sin/cos/atan2/hypot (approximations the language
// leaves to the engine), which is why the multiplayer game swaps in
// src/net/detmath.js. Here every engine computes the same fingerprint of it,
// and a Chromium, a Firefox and a WebKit player play one match together with
// identical state at every shared checkpoint.
// CI installs Firefox and WebKit and sets CROSS_ENGINE=1; without it this is skipped.
import { test, expect, chromium, firefox, webkit } from '@playwright/test';
import { lobbyToGame, scriptPlayer, netState, sameHashes, sleepRender } from './mp-helpers.js';
import { GOLDEN } from '../src/net/detmath-golden.js';

test.skip(!process.env.CROSS_ENGINE, 'needs Firefox and WebKit (CROSS_ENGINE=1)');
const ENGINES = { chromium, firefox, webkit };
let browsers = {};
test.beforeAll(async () => { for (const [n, e] of Object.entries(ENGINES)) browsers[n] = await e.launch(); });
test.afterAll(async () => { for (const b of Object.values(browsers)) await b.close(); browsers = {}; });

test('every engine computes the same deterministic Math, bit for bit', async () => {
  const out = {};
  for (const [n, b] of Object.entries(browsers)) {
    const page = await b.newPage();
    await page.goto('http://localhost:4173/');
    out[n] = await page.evaluate(async () => {
      const { detMathFingerprint } = await import('/src/net/detmath-golden.js');
      // A few of the engine's own Math results, for the record.
      const native = { sin: Math.sin(1e6), cos: Math.cos(3e6), atan2: Math.atan2(1234.5, -777.25), hypot: Math.hypot(3.1, 4.7, 0) };
      return { det: detMathFingerprint(), native: JSON.stringify(native) };
    });
    await page.close();
  }
  console.log(`# deterministic Math fingerprint: ${Object.entries(out).map(([n, o]) => `${n} ${o.det}`).join(', ')} (golden ${GOLDEN}); native Math samples ${new Set(Object.values(out).map((o) => o.native)).size === 1 ? 'agree' : 'DIFFER'} across engines`);
  for (const o of Object.values(out)) expect(o.det).toBe(GOLDEN);
});

test('a Chromium, a Firefox and a WebKit player play one match in lockstep', async ({ browser }) => {
  test.setTimeout(12 * 60_000);
  const order = ['chromium', 'firefox', 'webkit'];
  const { ps } = await lobbyToGame(browser, ['Ava', 'Bram', 'Cora'], { net: { speed: 4, hashEvery: 50 }, browsers: order.map((n) => browsers[n]) });
  for (const [i, p] of ps.entries()) { await scriptPlayer(p, ['boom', 'rush', 'turtle'][i]); await sleepRender(p); }
  await expect.poll(async () => Math.min(...(await Promise.all(ps.map(netState))).map((s) => s.tick)), { timeout: 9 * 60_000, intervals: [3000] }).toBeGreaterThan(3000);
  const st = await Promise.all(ps.map(netState));
  const cmp = sameHashes(st);
  console.log(`# ${order.join(' + ')}: ${cmp.shared} shared hash checkpoints up to tick ${Math.min(...st.map((s) => s.tick))}: ${cmp.ok ? 'all identical' : `DIFFER at ${JSON.stringify(cmp)}`}; commands sent ${st.map((s) => s.sent)}`);
  expect(cmp.ok, JSON.stringify(cmp)).toBe(true);
  expect(cmp.shared).toBeGreaterThan(40);
  for (const s of st) { expect(s.desync).toBeNull(); expect(s.sent).toBeGreaterThan(20); }
  expect(ps.flatMap((p) => p.errors)).toEqual([]);
  for (const p of ps) await p.context.close();
});
