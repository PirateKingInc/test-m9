// Platform Milestone 1: Ringout across browser engines. Its physics calls
// cos, sin, hypot and atan2 every tick, so one last-bit difference between
// engines would show within seconds; the module's deterministic Math is what
// keeps a Chromium, a Firefox and a WebKit player identical.
// CI installs Firefox and WebKit and sets CROSS_ENGINE=1 (npm run test:engines).
import { test, expect, chromium, firefox, webkit } from '@playwright/test';
import { lobbyToGame, scriptPlayer, netState, sameHashes } from './ringout-helpers.js';

test.skip(!process.env.CROSS_ENGINE, 'needs Firefox and WebKit (CROSS_ENGINE=1)');
test.describe.configure({ timeout: 6 * 60_000 });

test('Ringout: a Chromium, a Firefox and a WebKit player play a whole match in lockstep', async () => {
  const browsers = [await chromium.launch(), await firefox.launch(), await webkit.launch()];
  try {
    const { ps } = await lobbyToGame(null, ['Chromium', 'Firefox', 'WebKit'], { browsers, timing: { speed: 3, hashEvery: 25 } });
    for (const [i, p] of ps.entries()) await scriptPlayer(p, 30 + i);
    for (const p of ps) await expect.poll(async () => (await netState(p)).done, { timeout: 5 * 60_000, intervals: [2000] }).toBe(true);
    const st = await Promise.all(ps.map(netState));
    const cmp = sameHashes(st);
    console.log(`# Ringout, 3 engines: ${cmp.shared} shared hash checkpoints ${cmp.ok ? 'identical' : 'DIFFER'} to tick ${st[0].tick}; result ${JSON.stringify(st[0].result)}`);
    expect(cmp.ok, JSON.stringify(cmp)).toBe(true);
    expect(cmp.shared).toBeGreaterThan(40);
    for (const s of st) { expect(s.result).toEqual(st[0].result); expect(s.desync).toBeNull(); }
    expect(ps.flatMap((p) => p.errors)).toEqual([]);
  } finally { for (const b of browsers) await b.close(); }
});
