// Platform Milestone 1: browser tests for Ringout, the second game on the
// lockstep module. Every player is its own browser context against the
// Firebase Local Emulator Suite, like Dragonmarch's (e2e/mp-helpers.js), but
// nothing here touches Dragonmarch: Ringout has its own page and config.
import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { TURN } from '../games/ringout/config.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
export const EMULATOR = {
  auth: process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099',
  db: process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000',
  projectId: 'demo-dragonmarch',
  ns: 'demo-dragonmarch-default-rtdb',
};
export const PAGE = 'http://localhost:4173/games/ringout/index.html';

// timing: lockstep timing overrides; turn: 'live' asks the real TURN Worker;
// relay: every connection forced through the TURN relay.
export async function player(browser, name, { timing = null, turn = 'off', relay = false, pace = 'hard' } = {}) {
  const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(({ emu, timing, relay }) => {
    globalThis.__RINGOUT_FIREBASE_EMULATOR__ = emu;
    if (timing) globalThis.__RINGOUT_TIMING__ = timing;
    globalThis.__gathered = {};
    const RPC = globalThis.RTCPeerConnection;
    if (RPC) {
      globalThis.RTCPeerConnection = class extends RPC {
        constructor(cfg = {}, ...rest) {
          super(relay ? { ...cfg, iceTransportPolicy: 'relay' } : cfg, ...rest);
          this.addEventListener('icecandidate', (e) => { const ty = / typ (\w+)/.exec(e.candidate?.candidate || '')?.[1]; if (ty) globalThis.__gathered[ty] = (globalThis.__gathered[ty] || 0) + 1; });
        }
        setConfiguration(cfg = {}) { return super.setConfiguration(relay ? { ...cfg, iceTransportPolicy: 'relay' } : cfg); }
      };
    }
  }, { emu: EMULATOR, timing, relay });
  if (turn !== 'live') await page.route(TURN.endpoint, (r) => r.abort());
  await page.route(`${SDK}*`, (r) => r.fulfill({ body: readFileSync(`node_modules/firebase/${new URL(r.request().url()).pathname.split('/').pop()}`), contentType: 'text/javascript' }));
  await page.goto(PAGE);
  await page.locator('#name').fill(name);
  await page.locator('#pace').selectOption(pace);
  return { context, page, errors, name };
}

export async function lobbyToGame(browser, names, opts = {}) {
  const ps = [];
  // relayOnly: the name of the one player forced through the relay.
  for (const [i, n] of names.entries()) ps.push(await player(opts.browsers?.[i] || browser, n, { ...opts, relay: opts.relayOnly ? opts.relayOnly === n : opts.relay }));
  await ps[0].page.locator('#create').click();
  await expect(ps[0].page.locator('#code-shown')).toHaveText(/^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/, { timeout: 15000 });
  const code = (await ps[0].page.locator('#code-shown').textContent()).replace('-', '');
  for (const [i, p] of ps.entries()) {
    if (i === 0) continue;
    await p.page.locator('#code').fill(code);
    await p.page.locator('#join').click();
    await expect.poll(() => p.page.locator('#players').getAttribute('data-names'), { timeout: 15000 }).toBe(names.slice(0, i + 1).join('|'));
  }
  await expect.poll(() => ps[0].page.locator('#players').getAttribute('data-names'), { timeout: 15000 }).toBe(names.join('|'));
  await ps[0].page.locator('#start').click();
  for (const p of ps) await inGame(p);
  return { ps, code };
}

export async function inGame(p) {
  await expect.poll(() => p.page.evaluate(() => globalThis.__ringout?.run?.session?.mode === 'play' && !!globalThis.__ringout.run.session.lockstep), { timeout: 60000, message: `${p.name} in the game` }).toBe(true);
  p.slot = await p.page.evaluate(() => globalThis.__ringout.run.session.me);
}

// A scripted player for this page's slot, sending commands through the
// lockstep exactly as the keyboard does (so every command crosses the network).
export const scriptPlayer = (p, seed = 1) => p.page.evaluate(async (seed) => {
  const { Bot } = await import('/games/ringout/bot.js');
  const s = globalThis.__ringout.run.session, me = s.me;
  let bot = null, game = null, sent = 0;
  const ls = s.lockstep, prev = ls.onTick;
  ls.onTick = (T) => {
    prev?.(T);
    if (!ls.inControl(me, ls.tick) || ls.done) return;
    if (game !== ls.game) { game = ls.game; bot = new Bot(me, seed); }
    bot.act(ls.game, (c) => { sent++; ls.submit(c); });
  };
  globalThis.__bot = { get sent() { return sent; } };
}, seed);

export const netState = (p) => p.page.evaluate(() => {
  const s = globalThis.__ringout?.run?.session, ls = s?.lockstep;
  return { me: s?.me, mode: s?.mode, tick: ls?.tick, done: ls?.done, result: ls?.game.result, held: ls?.held(), anchored: ls?.game.anchored,
    desync: s?.desync, caughtUpAt: s?.caughtUpAt, hashes: s ? Object.fromEntries(s.hashes) : {}, sent: globalThis.__bot?.sent ?? 0, gathered: globalThis.__gathered };
});

export function sameHashes(states) {
  const [a, ...rest] = states;
  let shared = 0;
  for (const b of rest) for (const [k, h] of Object.entries(b.hashes)) if (k in a.hashes) { shared++; if (a.hashes[k] !== h) return { tick: k, a: a.me, b: b.me }; }
  return { ok: true, shared };
}
