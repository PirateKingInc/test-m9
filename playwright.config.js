import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  // The full-match mobile playthrough runs as its own CI job (npm run test:mobile).
  // The multiplayer tests need the Firebase emulator: npm run test:mp.
  testIgnore: [
    ...(process.env.MOBILE_PLAYTHROUGH ? [] : ['**/mobile-playthrough.spec.js']),
    ...(process.env.MULTIPLAYER ? [] : ['**/mp-*.spec.js']),
  ],
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173', viewport: { width: 1280, height: 800 } },
  webServer: { command: 'node e2e/server.js', url: 'http://localhost:4173', reuseExistingServer: true },
});
