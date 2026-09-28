#!/usr/bin/env node
// Renders sheet.html (every sprite, both teams, at in-game zoom 1x, 0.5x and 0.35x)
// and saves docs/reference-sheet.png for manual visual review.
//
//   node tools/reference-sheet.mjs [out.png]
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const out = process.argv[2] || 'docs/reference-sheet.png';
const port = 4199;
const server = spawn(process.execPath, ['e2e/server.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const CDN = { 'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js': 'node_modules/phaser/dist/phaser.min.js' };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 900 } });
  for (const [url, file] of Object.entries(CDN)) await page.route(url, (r) => r.fulfill({ body: readFileSync(file), contentType: 'text/javascript' }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/sheet.html`);
  await page.waitForFunction(() => window.__sheet?.ready, null, { timeout: 20000 });
  const height = await page.evaluate(() => window.__sheet.height);
  await page.setViewportSize({ width: 1800, height });
  await page.waitForTimeout(300);
  await page.screenshot({ path: out, fullPage: true });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`wrote ${out} (1800x${height})`);
} finally {
  await browser.close();
  server.kill();
}
