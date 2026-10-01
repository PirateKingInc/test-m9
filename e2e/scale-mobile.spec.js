// Phase 12 browser scale measurement (PHASE12_SPEC.md "Part A"). The real
// game page (single-player 1v1 or free-for-all, every AI running), armies
// filled to a given supply cap, a forced clash at 5 s, the camera zoomed all
// the way out over the battle. Measured for 20 s: frames per second, the
// main-thread JavaScript of each frame (update, which includes the sim, and
// render), and sim ticks per second. Two profiles:
// - mobile: a 844 x 390 phone (touch, DPR 3) with the CPU throttled 4x
//   (Chrome DevTools' "mid-tier mobile" setting) - a proxy for a phone, not one;
// - desktop: 1280 x 800, unthrottled.
// Headless Chromium draws with a software GPU, so fps is reported but the
// budget is judged on main-thread time and sim rate (PHASE12_SPEC.md).
//
//   SCALE=1 npx playwright test e2e/scale-mobile.spec.js [SCALE_CAPS=60,100] [SCALE_MAPS=ffa] [SCALE_MIXES=mix] [SCALE_PROFILES=mobile]
import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { openGame } from './helpers.js';

test.skip(!process.env.SCALE, 'Phase 12 measurement: run with SCALE=1');
test.describe.configure({ mode: 'serial', timeout: 15 * 60_000 });

const list = (k, d) => (process.env[k] || d).split(',');
const CAPS = list('SCALE_CAPS', '60,100,150,200,250,300').map(Number);
const MAPS = list('SCALE_MAPS', '1v1,ffa');
const MIXES = list('SCALE_MIXES', 'mix,swarm');
const PROFILES = {
  mobile: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3, throttle: 4 },
  desktop: { viewport: { width: 1280, height: 800 }, throttle: 1 },
};
const OUT = process.env.SCALE_OUT || 'perf/scale-browser.json';
const WINDOW = 20; // s measured, starting 3 s after the clash order

for (const profile of list('SCALE_PROFILES', 'mobile,desktop')) {
  test(`${profile}: frames, main-thread time and sim rate at each supply cap`, async ({ browser }) => {
    const { throttle, ...ctxOpts } = PROFILES[profile];
    const rows = [];
    for (const map of MAPS) for (const mix of MIXES) for (const cap of CAPS) {
      const context = await browser.newContext(ctxOpts);
      const page = await context.newPage();
      await openGame(page, map === 'ffa' ? '?mode=ffa&seed=1&difficulty=hard' : '?mode=match&seed=1&difficulty=hard');
      // Fill the armies and hook the frame timing before throttling (setup is not measured).
      const info = await page.evaluate(async ({ cap, mix }) => {
        const S = await import('/tools/scale-scenario.js');
        S.setCap(cap);
        const { world, game, scene } = window.__game;
        const armies = S.fillArmies(world, cap, mix);
        const cam = scene.cameras.main;
        cam.setZoom(0.35);
        cam.centerOn(world.width / 2, world.height / 2);
        const f = (window.__frames = { pre: 0, post: 0, upd: [], ren: [], tot: [], one: [], tick: [], sim: 0, ticks: 0 });
        // Each sim tick's own cost, so a frame can be split into its sim ticks and the rest.
        const step = scene.stepSim;
        scene.stepSim = () => { const t = performance.now(); try { return step(); } finally { const ms = performance.now() - t; f.sim += ms; f.ticks++; f.tick.push(ms); } };
        game.events.on('prestep', () => { f.pre = performance.now(); f.sim = 0; f.ticks = 0; });
        game.events.on('poststep', () => { f.post = performance.now(); });
        game.events.on('postrender', () => {
          const now = performance.now(), tot = now - f.pre;
          f.upd.push(f.post - f.pre); f.ren.push(now - f.post); f.tot.push(tot);
          // The frame as it would be carrying exactly one tick (its own ticks averaged).
          if (f.ticks) f.one.push(tot - f.sim + f.sim / f.ticks);
        });
        window.__charged = world.time + 5;
        const tick = () => { if (world.time >= window.__charged) S.charge(world); else setTimeout(tick, 50); };
        tick();
        return { units: S.unitCount(world), armies };
      }, { cap, mix });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      await page.waitForTimeout(8000); // the clash is ordered at 5 s of game time; start 3 s later
      const r = await page.evaluate(async (secs) => {
        const { world, game } = window.__game, f = window.__frames;
        f.upd.length = f.ren.length = f.tot.length = f.one.length = f.tick.length = 0;
        const t0 = performance.now(), k0 = world.tick, fr0 = game.loop.frame;
        await new Promise((res) => setTimeout(res, secs * 1000));
        const dt = (performance.now() - t0) / 1000;
        const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
        return {
          fps: (game.loop.frame - fr0) / dt, simRate: (world.tick - k0) / dt,
          frameJs: { p50: q(f.tot, 0.5), p95: q(f.tot, 0.95), max: Math.max(0, ...f.tot) },
          update: { p50: q(f.upd, 0.5), p95: q(f.upd, 0.95) }, render: { p50: q(f.ren, 0.5), p95: q(f.ren, 0.95) },
          ticksPerFrame: f.tick.length / Math.max(1, f.tot.length),
          tick: { p50: q(f.tick, 0.5), p95: q(f.tick, 0.95) }, oneTickFrame: { p50: q(f.one, 0.5), p95: q(f.one, 0.95) },
          unitsAfter: [...world.ofKind('unit')].length, result: world.result?.reason ?? null,
        };
      }, WINDOW);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const row = { profile, throttle, map, mix, cap, units: info.units, ...r };
      rows.push(row);
      const n = (x) => x.toFixed(1);
      console.log(`# ${profile} ${map} ${mix} cap ${cap}: ${info.units} units, ${n(r.fps)} fps, sim ${n(r.simRate)} ticks/s, frame JS p50 ${n(r.frameJs.p50)} p95 ${n(r.frameJs.p95)} ms (update ${n(r.update.p50)}, render ${n(r.render.p50)}, ${n(r.ticksPerFrame)} ticks/frame), tick p50 ${n(r.tick.p50)} p95 ${n(r.tick.p95)}, one-tick frame p50 ${n(r.oneTickFrame.p50)} p95 ${n(r.oneTickFrame.p95)} ms`);
      await context.close();
    }
    mkdirSync('perf', { recursive: true });
    const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).rows.filter((x) => x.profile !== profile) : [];
    writeFileSync(OUT, `${JSON.stringify({ generated: new Date().toISOString(), window: WINDOW, rows: [...prev, ...rows] }, null, 1)}\n`);
    expect(rows.length).toBe(MAPS.length * MIXES.length * CAPS.length);
  });
}
