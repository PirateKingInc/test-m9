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
// net: Phase 11 timing overrides (shorter grace periods, faster play);
// latency: [lo, hi] ms added to every data-channel message, order preserved.
export async function player(browser, name, { net = null, latency = null, context: ctx = null } = {}) {
  const context = ctx || await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(({ emu, net, latency }) => {
    globalThis.__DM_FIREBASE_EMULATOR__ = emu;
    if (net) globalThis.__DM_NET_OVERRIDES__ = net;
    try { localStorage.setItem('prism-tutorial-v1', 'done'); } catch { /* ignore */ }
    if (latency) { // a slow network under the real data channels, in order
      const send = RTCDataChannel.prototype.send, last = new WeakMap();
      RTCDataChannel.prototype.send = function (data) {
        const now = performance.now();
        const at = Math.max(now + latency[0] + Math.random() * (latency[1] - latency[0]), last.get(this) || 0);
        last.set(this, at);
        setTimeout(() => { try { send.call(this, data); } catch { /* closed */ } }, at - now);
      };
    }
  }, { emu: EMULATOR, net, latency });
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

// Phase 11: lobby -> start -> connections -> the match is running on every page.
export async function lobbyToGame(browser, names, opts = {}) {
  const ps = [];
  // opts.browsers: a browser per player (another engine), else all share `browser`.
  for (const [i, n] of names.entries()) ps.push(await player(opts.browsers?.[i] || browser, n, opts));
  const code = await create(ps[0]);
  for (const [i, p] of ps.entries()) if (i > 0) { await join(p, code); await sees(p, names.slice(0, i + 1)); }
  await sees(ps[0], names);
  await ps[0].page.locator('#mp-start').click();
  for (const p of ps) {
    await expect.poll(() => p.page.evaluate(() => globalThis.__net?.session?.mode === 'play' && !!globalThis.__game?.scene), { timeout: 60000, message: `${p.name} in the game` }).toBe(true);
    p.slot = await p.page.evaluate(() => globalThis.__net.session.me);
  }
  return { ps, code };
}

// A scripted player for this page's camp: the AI engine, issuing through the
// lockstep exactly as the UI does (so every command crosses the network).
export const scriptPlayer = (p, strategy = 'boom') => p.page.evaluate(async (strategy) => {
  const { AiEngine } = await import('/src/ai/engine.js');
  const s = globalThis.__net.session, ls = s.ls, me = s.me;
  const bot = new AiEngine(ls.world, { team: me, seed: 500 + me, strategy, difficulty: 'hard' });
  let sent = 0;
  bot.issueFn = (cmd) => { sent++; return ls.local(cmd); };
  const prev = ls.onTick;
  ls.onTick = (T) => { prev?.(T); if (ls.isHuman(me, ls.tick) && !ls.done) bot.update(); };
  globalThis.__bot = { get sent() { return sent; } };
}, strategy);

// Everything a page knows about its match, for comparing peers.
export const netState = (p) => p.page.evaluate(() => {
  const s = globalThis.__net.session, ls = s.ls;
  return { me: s.me, mode: s.mode, tick: ls?.tick, done: ls?.done, result: ls?.world.result, hash: ls?.stateHash(), desync: s.desync,
    held: ls?.held(), notices: s.notices.map((n) => n.text), chat: s.chatLog.map((c) => `${c.name}: ${c.text}`), sent: globalThis.__bot?.sent ?? 0,
    caughtUpAt: s.caughtUpAt, hashes: Object.fromEntries(s.hashes) };
});

// Whole-state hashes agree at every tick two pages both recorded.
export function sameHashes(states) {
  const [a, ...rest] = states;
  let shared = 0;
  for (const b of rest) for (const [k, h] of Object.entries(b.hashes)) if (k in a.hashes) { shared++; if (a.hashes[k] !== h) return { tick: k, a: a.me, b: b.me }; }
  return { ok: true, shared };
}

// Stop drawing (the simulation keeps running on its own metronome): saves CPU
// in tests with several full browsers on one machine.
export async function sleepRender(p) {
  await p.page.waitForFunction(() => !!globalThis.__game?.game?.loop, null, { timeout: 30000 }); // the screen loads after a rejoin
  await p.page.evaluate(() => globalThis.__game.game.loop.sleep());
}
