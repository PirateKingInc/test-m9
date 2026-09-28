import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const CDN = {
  'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js': 'node_modules/phaser/dist/phaser.min.js',
  'https://cdn.jsdelivr.net/npm/pathfinding@0.4.18/visual/lib/pathfinding-browser.min.js': 'node_modules/pathfinding/visual/lib/pathfinding-browser.min.js',
};

test('start screen: pick Hard + Turtle, start, and an AI opponent plays', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const [url, file] of Object.entries(CDN)) await page.route(url, (r) => r.fulfill({ body: readFileSync(file), contentType: 'text/javascript' }));
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible();
  await page.locator('button[data-difficulty="hard"]').click();
  await expect(page.locator('#difficulty-note')).toContainText('Hard');
  await page.locator('#strategy').selectOption('turtle');
  await page.locator('#start-match').click();
  await page.waitForFunction(() => window.__game?.match && window.__game.world.tick > 20);
  expect(page.url()).toContain('difficulty=hard');
  expect(await page.evaluate(() => window.__game.match.ai.strategyId)).toBe('turtle');
  await expect(page.locator('#opponent')).toHaveText('vs AI · Hard');
  // The AI acts on its own through World.issue(): it queues Drones right away.
  await expect.poll(() => page.evaluate(() => window.__game.match.ai.stats.commands), { timeout: 15000 }).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('sandbox from the menu has no opponent', async ({ page }) => {
  for (const [url, file] of Object.entries(CDN)) await page.route(url, (r) => r.fulfill({ body: readFileSync(file), contentType: 'text/javascript' }));
  await page.goto('/');
  await page.locator('#start-sandbox').click();
  await page.waitForFunction(() => window.__game?.world.tick > 5);
  expect(await page.evaluate(() => window.__game.match)).toBe(null);
  expect(await page.evaluate(() => [...window.__game.world.ofKind('unit')].filter((u) => u.team === 2).length)).toBe(0);
});

// Phase 5: the title screen carries the game name and a dragon emblem drawn in
// code (a shield in both team colours with a gold dragon), no image file.
test('title screen: Dragonmarch with a code-drawn dragon emblem', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const [url, file] of Object.entries(CDN)) await page.route(url, (r) => r.fulfill({ body: readFileSync(file), contentType: 'text/javascript' }));
  await page.goto('/');
  await expect(page.locator('.brand-title')).toHaveText('DRAGONMARCH');
  await expect(page).toHaveTitle('Dragonmarch');
  const px = await page.evaluate(() => {
    const c = document.getElementById('emblem'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let gold = 0, azure = 0, crimson = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
      if (a < 200) continue;
      if (r > 200 && g > 150 && b < 110) gold++;
      else if (b > r + 40) azure++;
      else if (r > b + 60 && g < 90) crimson++;
    }
    return { gold, azure, crimson, n: d.length / 4 };
  });
  expect(px.gold / px.n, 'gold dragon').toBeGreaterThan(0.04);
  expect(px.azure / px.n, 'azure half').toBeGreaterThan(0.05);
  expect(px.crimson / px.n, 'crimson half').toBeGreaterThan(0.05);
  expect(await page.locator('img').count(), 'no image files').toBe(0);
  expect(errors).toEqual([]);
});
