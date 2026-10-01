// Phase 12b Part A (PHASE12B_SPEC.md): a player whose direct connections all
// fail (a carrier-grade NAT on a cellular network, in the live test) sees the
// "could not connect directly" message, and no raw error ever reaches the page,
// on their screen or anyone else's. The failure is forced in that player's
// browser: it never sends its own ICE candidates and ignores everyone else's,
// so no network path can form, exactly as when NAT blocks every one.
import { test, expect } from '@playwright/test';
import { player, create, join, sees } from './mp-helpers.js';

test.describe.configure({ timeout: 180_000 });

// No ICE in or out for this page's peer connections.
const blockIce = (p) => p.page.addInitScript(() => {
  const RPC = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = class extends RPC {
    constructor(...a) {
      super(...a);
      // Candidates this side gathers are never handed to the page (so never signalled).
      super.addEventListener('icecandidate', (e) => { if (e.candidate) e.stopImmediatePropagation(); });
    }
    set onicecandidate(fn) { super.onicecandidate = fn && ((e) => { if (!e.candidate) fn(e); }); }
    get onicecandidate() { return super.onicecandidate; }
    addIceCandidate() { return Promise.resolve(); } // and the others' are ignored
  };
});

const watch = (p) => {
  p.console = [];
  p.page.on('console', (m) => { if (m.type() === 'error') p.console.push(m.text()); });
};

test('a player whose every direct connection fails sees a clean message, and nobody sees a raw error', async ({ browser }) => {
  const names = ['Ava', 'Bram', 'Cora', 'Dunn'];
  const ps = [];
  for (const n of names) {
    const p = await player(browser, n);
    watch(p);
    if (n === 'Dunn') { await blockIce(p); await p.page.reload(); await p.page.locator('#start-mp').click(); await p.page.locator('#mp-name').fill(n); }
    ps.push(p);
  }
  const code = await create(ps[0]);
  for (const [i, p] of ps.entries()) if (i > 0) { await join(p, code); await sees(p, names.slice(0, i + 1)); }
  await ps[0].page.locator('#mp-start').click();
  const dunn = ps[3], others = ps.slice(0, 3);

  // Dunn: every link reported as failed, in the existing words.
  await expect(dunn.page.locator('#mp-links-title')).toHaveText('Connected to 0 of 3. 3 could not connect directly (a strict network or firewall).', { timeout: 90_000 });
  await expect(dunn.page.locator('#mp-links-note')).toHaveText('The match cannot start without a direct connection to every player.');
  // The others: connected to each other, Dunn reported as failed.
  for (const p of others) await expect(p.page.locator('#mp-links-title')).toHaveText('Connected to 2 of 3. 1 could not connect directly (a strict network or firewall).', { timeout: 90_000 });
  // Give anything that would throw late (timers, closing connections) its chance.
  await dunn.page.waitForTimeout(5000);
  for (const p of ps) {
    expect(p.errors, `${p.name}: uncaught errors`).toEqual([]);
    expect(p.console.filter((t) => !/Failed to load resource/.test(t)), `${p.name}: console errors`).toEqual([]);
    await expect(p.page.locator('body')).not.toContainText(/is not an object|TypeError|Cannot read properties|undefined is not/);
  }
  for (const p of ps) await p.context.close();
});
