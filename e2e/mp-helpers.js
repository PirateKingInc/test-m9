// Phase 10 browser tests: every player is its own browser context (separate
// storage, separate anonymous Firebase user, separate WebRTC stack), talking
// to the Firebase Local Emulator Suite. Run with `npm run test:mp`.
import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const CDN = {
  'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js': 'node_modules/phaser/dist/phaser.min.js',
  'https://cdn.jsdelivr.net/npm/pathfinding@0.4.18/visual/lib/pathfinding-browser.min.js': 'node_modules/pathfinding/visual/lib/pathfinding-browser.min.js',
};
export const EMULATOR = {
  auth: process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099',
  db: process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000',
  projectId: 'demo-dragonmarch',
  ns: 'demo-dragonmarch-default-rtdb',
};

// A new player: its own context, on the Multiplayer screen with its name typed.
export async function player(browser, name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((emu) => {
    globalThis.__DM_FIREBASE_EMULATOR__ = emu;
    try { localStorage.setItem('prism-tutorial-v1', 'done'); } catch { /* ignore */ }
  }, EMULATOR);
  for (const [url, file] of Object.entries(CDN)) await page.route(url, (r) => r.fulfill({ body: readFileSync(file), contentType: 'text/javascript' }));
  await page.route(`${SDK}*`, (r) => r.fulfill({ body: readFileSync(`node_modules/firebase/${new URL(r.request().url()).pathname.split('/').pop()}`), contentType: 'text/javascript' }));
  await page.goto('/');
  await page.locator('#start-mp').click();
  await page.locator('#mp-name').fill(name);
  return { context, page, errors, name };
}

export async function create(p) {
  await p.page.locator('#mp-create').click();
  await expect(p.page.locator('#mp-code-shown')).toHaveText(/^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/, { timeout: 15000 });
  return (await p.page.locator('#mp-code-shown').textContent()).replace('-', '');
}

export async function join(p, code) {
  await p.page.locator('#mp-code').fill(code);
  await p.page.locator('#mp-join').click();
}

// The names this player's lobby screen lists, in slot order.
export const names = (p) => p.page.locator('#mp-players').getAttribute('data-names');
export const sees = (p, list) => expect.poll(() => names(p), { timeout: 15000 }).toBe(list.join('|'));
export const status = (p) => p.page.locator('#mp-status');
