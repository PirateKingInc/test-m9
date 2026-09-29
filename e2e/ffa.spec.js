// Phase 6 free-for-all in the browser: the territory overlay shows each owner's
// colour, distinctly, at 1x and at the 0.35x minimum zoom; the HUD shows your
// land and the camps left; your camp's fall and the final standings are shown.
import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';
import { TEAM } from '../src/art/palette.js';

const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const TEAMS = [1, 2, 3, 4];

// Set zone owners directly (test setup) and clear every unit, so nothing
// stands on the sampled pixels and the AI can't change the map meanwhile.
async function setOwners(page, owners) {
  await page.evaluate((owners) => {
    const { world, match } = window.__game;
    match.brains.length = 0;
    for (const u of [...world.ofKind('unit')]) world.removeEntity(u);
    for (const z of world.zones) if (z.id in owners) { z.owner = owners[z.id]; z.contested = false; }
  }, owners);
}

// The rendered colour on a zone's left border, mid-height, at this zoom.
async function borderPixel(page, zoneId, zoom) {
  await page.evaluate(([id, zoom]) => {
    const { world, scene } = window.__game, T = world.grid.tile, z = world.zones.find((q) => q.id === id);
    const cam = scene.cameras.main, bw = Math.max(6, 3 / zoom);
    cam.setZoom(zoom);
    cam.setBounds(-5000, -5000, 20000, 20000); // test setup: let the camera centre anywhere
    scene.fitBounds = () => {};
    cam.centerOn(z.rect[0] * T + bw / 2, (z.rect[1] + z.rect[3] / 2) * T);
  }, [zoneId, zoom]);
  await page.waitForTimeout(300);
  return page.evaluate(() => new Promise((resolve) => {
    const { game } = window.__game;
    game.renderer.snapshotPixel(Math.floor(game.scale.width / 2), Math.floor(game.scale.height / 2), (c) => resolve([c.r, c.g, c.b]));
  }));
}

const nearestTeam = (px) => {
  let best = null, bestD = Infinity;
  for (const t of TEAMS) {
    const d = Math.hypot(...rgb(TEAM[t].base).map((v, i) => v - px[i]));
    if (d < bestD) { bestD = d; best = t; }
  }
  return { team: best, d: bestD };
};

for (const zoom of [1, 0.35]) {
  test(`zone ownership renders in each owner's colour, distinctly (at ${zoom}x)`, async ({ page }) => {
    const errors = await openGame(page, '?mode=ffa&seed=4&difficulty=easy');
    await setOwners(page, { n: 2, w: 1, c: 3, s: 4, e: null });
    for (const [zone, owner] of [['n', 2], ['w', 1], ['c', 3], ['s', 4]]) {
      const px = await borderPixel(page, zone, zoom);
      const near = nearestTeam(px);
      expect(near.team, `${zone} border ${px} reads as team ${owner}`).toBe(owner);
      expect(near.d, `${zone} border ${px} is close to team ${owner}'s colour`).toBeLessThan(90);
    }
    // A neutral zone's outline is faint: it reads as no team.
    const px = await borderPixel(page, 'e', zoom);
    expect(nearestTeam(px).d, `neutral border ${px}`).toBeGreaterThan(60);
    expect(errors).toEqual([]);
  });
}

test('the HUD shows your zones and the camps left; your fall and the final standings are shown', async ({ page }) => {
  const errors = await openGame(page, '?mode=ffa&seed=4&difficulty=easy');
  await expect(page.locator('#ffa-readout')).toBeVisible();
  await expect(page.locator('#zones')).toHaveText('1/9');
  await expect(page.locator('#camps')).toHaveText('4/4');
  await expect(page.locator('#opponent')).toContainText('Free-for-all');
  // Test setup: Crimson's Castle falls to you, then yours to Jade.
  await page.evaluate(() => {
    const { world, match } = window.__game;
    match.brains.length = 0;
    const castle = (t) => [...world.ofKind('building')].find((b) => b.team === t && b.type === 'core');
    const c2 = castle(2); c2.hp = 0; c2.killedBy = 1;
  });
  await expect(page.locator('#camps')).toHaveText('3/4');
  await expect(page.locator('#zones')).toHaveText('2/9');
  await expect(page.locator('#toast')).toContainText('Crimson has fallen: You take');
  await page.evaluate(() => { const { world } = window.__game; const c = [...world.ofKind('building')].find((b) => b.team === 1 && b.type === 'core'); c.hp = 0; c.killedBy = 4; });
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#result-detail')).toContainText('Jade took your lands');
  await expect(page.locator('#watch-on')).toBeVisible();
  // A tap in the card's first 0.8 s is ignored (it may have been meant for the
  // map): clicked in the same instant the card is shown, nothing happens.
  expect(await page.evaluate(() => {
    const { scene } = window.__game;
    scene.hud.showFall({ team: 1, by: 4, gold: 0, zones: [] });
    document.getElementById('watch-on').click();
    return document.getElementById('result').hidden;
  })).toBe(false);
  await page.waitForTimeout(900);
  await page.locator('#watch-on').click();
  await expect(page.locator('#result')).toBeHidden();
  // The last two fall: Rose to Jade, and Jade is the last camp standing.
  await page.evaluate(() => { const { world } = window.__game; const c = [...world.ofKind('building')].find((b) => b.team === 3 && b.type === 'core'); c.hp = 0; c.killedBy = 4; });
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#result-title')).toHaveText('Defeat');
  await expect(page.locator('#result-detail')).toContainText('Jade is the last camp standing');
  await expect(page.locator('#result-stats')).toContainText('Jade');
  await expect(page.locator('#watch-on')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the start screen starts a free-for-all', async ({ page }) => {
  await openGame(page, '?mode=match');
  await page.goto('/');
  await page.locator('button[data-difficulty="easy"]').click();
  await page.locator('#start-ffa').click();
  await page.waitForFunction(() => window.__game?.world?.teams?.length === 4 && window.__game.world.tick > 5);
  expect(page.url()).toContain('mode=ffa');
  expect(page.url()).toContain('difficulty=easy');
});

// Phase 7 (PHASE7_SPEC.md "Dev panel: targeting view"): behind the dev panel
// toggle, each AI camp's rival ranking; never in the normal HUD.
test('dev panel shows each AI camp\'s rival ranking and why (free-for-all only)', async ({ page }) => {
  const errors = await openGame(page, '?mode=ffa&seed=4&difficulty=hard&speed=8');
  await expect(page.locator('#dev-panel')).toBeHidden();
  await page.waitForFunction(() => window.__game.world.time > 20); // the AI camps have scanned
  await page.keyboard.press('Backquote');
  await expect(page.locator('#dev-panel')).toBeVisible();
  const camps = page.locator('#dev-ai .dev-ai-camp');
  await expect(camps).toHaveCount(3);
  for (const [i, name, nearest] of [[0, 'Crimson', 'Rose'], [1, 'Rose', 'Crimson'], [2, 'Jade', 'Azure']]) {
    const c = camps.nth(i);
    await expect(c.locator('b').first()).toHaveText(name);
    await expect(c.locator('li')).toHaveCount(3); // every living rival, ranked
    await expect(c.locator('li.pick b')).toHaveText(nearest); // no intel yet: the nearest by travel
    await expect(c.locator('li').first()).toContainText(/unscouted|R \d/);
    await expect(c.locator('li').first()).toContainText(/s away/);
  }
  await page.keyboard.press('Backquote');
  await expect(page.locator('#dev-panel')).toBeHidden();
  await expect(page.locator('#hud-top')).not.toContainText('unscouted'); // not in the normal HUD
  expect(errors).toEqual([]);
});

test('dev panel targeting view stays empty outside the free-for-all', async ({ page }) => {
  await openGame(page, '?mode=match&seed=4');
  await page.keyboard.press('Backquote');
  await expect(page.locator('#dev-panel')).toBeVisible();
  await expect(page.locator('#dev-ai')).toBeEmpty();
});
