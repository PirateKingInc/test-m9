// Phase 4 art: every baked sprite is distinct from every other, by silhouette
// at low zoom (not just colour), and the two teams are told apart by colour.
import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';
import { TEAM } from '../src/art/palette.js';

// Compare textures inside the page: an alpha silhouette sampled at the size a
// 64 px unit box is shown at the given zoom (0.5x -> 32x32 screen px, Phase 5's
// minimum 0.35x -> 22x22), plus the mean colour. Conservative: the renderer
// draws units up to 2x larger when zoomed out, and most buildings are bigger.
const ZOOMS = [0.5, 0.35];
async function signatures(page, keys, zoom) {
  return page.evaluate(([keys, zoom]) => {
    const tm = window.__game.scene.textures, N = Math.round(64 * zoom), out = {};
    for (const k of keys) {
      const src = tm.get(k).getSourceImage(), c = document.createElement('canvas');
      c.width = N; c.height = N;
      const ctx = c.getContext('2d');
      ctx.drawImage(src, 0, 0, N, N);
      const d = ctx.getImageData(0, 0, N, N).data;
      const mask = [];
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        mask.push(d[i + 3] > 96 ? 1 : 0);
        if (d[i + 3] > 96) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      }
      out[k] = { mask, color: [r / n, g / n, b / n], coverage: n / (N * N), px: Array.from(d) };
    }
    return out;
  }, [keys, zoom]);
}

// Share of opaque pixels near each team's colour (the palette's base/light/dark
// swatches: Azure, Crimson, and since Phase 6 Rose and Ivory). Each pixel
// counts for the team with the nearest swatch, if within 45.
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const TEAMS = [1, 2, 3, 4];
const SWATCHES = Object.fromEntries(TEAMS.map((t) => [t, [TEAM[t].base, TEAM[t].light, TEAM[t].dark].map(rgb)]));
function teamShare(sig) {
  const count = Object.fromEntries(TEAMS.map((t) => [t, 0]));
  let n = 0;
  for (let i = 0; i < sig.px.length; i += 4) {
    if (sig.px[i + 3] < 200) continue;
    n++;
    let best = null, bestD = 45;
    for (const t of TEAMS) for (const [r, g, b] of SWATCHES[t]) {
      const d = Math.hypot(sig.px[i] - r, sig.px[i + 1] - g, sig.px[i + 2] - b);
      if (d < bestD) { bestD = d; best = t; }
    }
    if (best) count[best]++;
  }
  return Object.fromEntries(TEAMS.map((t) => [t, count[t] / n]));
}

// 1 - intersection/union of the two silhouettes (0 = identical, 1 = no overlap).
const silhouetteDiff = (a, b) => {
  let inter = 0, union = 0;
  a.mask.forEach((v, i) => { inter += v & b.mask[i]; union += v | b.mask[i]; });
  return 1 - inter / union;
};
const colorDiff = (a, b) => Math.hypot(a.color[0] - b.color[0], a.color[1] - b.color[1], a.color[2] - b.color[2]);

for (const zoom of ZOOMS) {
test(`every unit sprite has its own silhouette, and teams differ by colour (at ${zoom}x)`, async ({ page }) => {
  const errors = await openGame(page);
  const types = ['drone', 'striker', 'sparker', 'bulwark', 'lancer'];
  const keys = [];
  for (const team of TEAMS) for (const t of types) keys.push(`u-${t}-${team}`);
  const sig = await signatures(page, keys, zoom);
  for (const team of TEAMS) {
    for (let i = 0; i < types.length; i++) for (let j = i + 1; j < types.length; j++) {
      const d = silhouetteDiff(sig[`u-${types[i]}-${team}`], sig[`u-${types[j]}-${team}`]);
      expect(d, `${types[i]} vs ${types[j]} silhouettes overlap too much at ${zoom}x`).toBeGreaterThan(0.35);
    }
  }
  // Phase 4's check between the first two teams, then (Phase 6) for all four:
  // each unit's most common team colour is its own, clearly ahead of the rest.
  for (const t of types) expect(colorDiff(sig[`u-${t}-1`], sig[`u-${t}-2`]), `${t}: team colours differ (mean colour; white parts dilute it)`).toBeGreaterThan(45);
  for (const t of types) for (const team of TEAMS) {
    const share = teamShare(sig[`u-${t}-${team}`]);
    expect(share[team], `${t} of team ${team} shows its colour`).toBeGreaterThan(0.05);
    for (const other of TEAMS) if (other !== team) expect(share[other], `${t} of team ${team} vs team ${other}`).toBeLessThan(share[team] / 3);
  }
  // Size ranks match the roster: the Drone is the smallest, the Bulwark the biggest body.
  expect(sig['u-drone-1'].coverage).toBeLessThan(sig['u-bulwark-1'].coverage);
  expect(errors).toEqual([]);
});
}

// Mean per-channel difference of two same-size textures sampled at 32x32 (0..255).
const pixelDiff = (a, b) => a.px.reduce((s, v, i) => s + Math.abs(v - b.px[i]), 0) / a.px.length;

for (const zoom of ZOOMS) {
test(`every building differs in each construction state, types stay distinct, and teams differ (at ${zoom}x)`, async ({ page }) => {
  const errors = await openGame(page);
  const types = ['core', 'depot', 'foundry', 'spire'], states = ['foundation', 'frame', 'complete'];
  const keys = [];
  for (const team of TEAMS) for (const t of types) for (const st of states) keys.push(`b-${t}-${team}-${st}`);
  const sig = await signatures(page, keys, zoom);
  for (const team of TEAMS) {
    for (const t of types) {
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
        expect(pixelDiff(sig[`b-${t}-${team}-${states[i]}`], sig[`b-${t}-${team}-${states[j]}`]), `${t}: ${states[i]} vs ${states[j]}`).toBeGreaterThan(12);
      }
    }
    // The Depot and the Foundry share a 3x3 footprint: they must differ in every state.
    // Foundations share the same concrete pad by design, so only the type
    // stencil differs there (measured ~7.4 vs >= 19 between states).
    for (const st of states) expect(pixelDiff(sig[`b-depot-${team}-${st}`], sig[`b-foundry-${team}-${st}`]), `depot vs foundry (${st})`).toBeGreaterThan(st === 'foundation' ? 5 : 8);
  }
  // Allegiance: each team's buildings carry its own colour and no other team's.
  for (const t of types) for (const st of states) for (const team of TEAMS) {
    const share = teamShare(sig[`b-${t}-${team}-${st}`]);
    expect(share[team], `${t} ${st}: team ${team} shows its colour`).toBeGreaterThan(0.03);
    for (const other of TEAMS) if (other !== team) expect(share[other], `${t} ${st}: team ${team} shows no team ${other} colour`).toBeLessThan(0.01);
  }
  expect(errors).toEqual([]);
});
}

test('the visual reference sheet renders every sprite without errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js', (r) => r.fulfill({ path: 'node_modules/phaser/dist/phaser.min.js', contentType: 'text/javascript' }));
  await page.goto('/sheet.html');
  await page.waitForFunction(() => window.__sheet?.ready, null, { timeout: 20000 });
  const keys = await page.evaluate(() => window.__sheet.textures);
  // 2 teams x (6 units + carrying Drone + ring) + 2 x 4 buildings x 3 states + 3 crystals + terrain (+ Phaser defaults)
  expect(keys).toBeGreaterThanOrEqual(2 * 8 + 24 + 3 + 1);
  expect(errors).toEqual([]);
});
