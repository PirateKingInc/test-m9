// Phase 12b Part C (PHASE12B_SPEC.md): the TURN relay, for real. Every player
// asks the deployed Worker (worker/src/index.js) for a short-lived Cloudflare
// TURN credential, exactly as the shipped game does; "relay" players are then
// forced through the relay (iceTransportPolicy 'relay'), as a phone behind
// carrier-grade NAT effectively is. Each link's selected ICE candidate pair is
// read from the browser's own WebRTC stats, so "relayed" is measured, not
// assumed. Needs the real Cloudflare service: CI sets RELAY=1 (npm run test:relay).
import { test, expect, chromium, firefox, webkit } from '@playwright/test';
import { player, create, join, sees, scriptPlayer, netState, sameHashes, sleepRender } from './mp-helpers.js';
import { NET_DEFAULTS } from '../src/net/net-rules.js';
import { TURN } from '../src/net/config.js';

test.skip(!process.env.RELAY, 'needs the real Cloudflare TURN service (RELAY=1)');
test.describe.configure({ timeout: 10 * 60_000 });

// Lobby -> start -> verified links -> the match running, with per-player options.
async function relayLobby(browser, specs, { net, latency = null, stall = null, browsers = null } = {}) {
  const ps = [];
  for (const [i, s] of specs.entries()) {
    const p = await player(browsers?.[i] || browser, s.name, { net, latency, stall, turn: 'live', relay: s.relay || false });
    p.relay = !!s.relay;
    p.worker = []; // the Worker's answers to this page: what it was given to connect with
    p.page.on('response', (r) => { if (r.url() === TURN.endpoint) p.worker.push(r.status()); });
    p.page.on('requestfailed', (r) => { if (r.url() === TURN.endpoint) p.worker.push(`failed: ${r.failure()?.errorText}`); });
    ps.push(p);
  }
  const names = specs.map((s) => s.name);
  const code = await create(ps[0]);
  for (const [i, p] of ps.entries()) if (i > 0) { await join(p, code); await sees(p, names.slice(0, i + 1)); }
  await sees(ps[0], names);
  await ps[0].page.locator('#mp-start').click();
  // Every link verified: the Phase 10 test message went both ways over it.
  for (const p of ps) {
    await expect(p.page.locator('#mp-links-title')).toHaveText(`Connected directly to all ${ps.length - 1} other player${ps.length > 2 ? 's' : ''}.`, { timeout: 60_000 });
    p.rtts = await p.page.evaluate(() => [...globalThis.__net.mesh.peers.values()].map((x) => ({ name: x.name, state: x.state, rtt: x.rtt, said: x.hello?.name })));
    for (const r of p.rtts) { expect(r.state).toBe('verified'); expect(r.said).toBe(r.name); }
  }
  for (const p of ps) {
    await expect.poll(() => p.page.evaluate(() => globalThis.__net?.session?.mode === 'play' && !!globalThis.__game?.scene), { timeout: 60_000, message: `${p.name} in the game` }).toBe(true);
    p.slot = await p.page.evaluate(() => globalThis.__net.session.me);
  }
  return ps;
}

// The ICE candidate pair each of this page's links actually uses, from getStats.
const paths = (p) => p.page.evaluate(async () => {
  const out = [];
  for (const [slot, l] of globalThis.__net.links.links) {
    const st = await l.pc.getStats();
    let pair = null;
    for (const r of st.values()) if (r.type === 'transport' && r.selectedCandidatePairId) pair = st.get(r.selectedCandidatePairId);
    if (!pair) for (const r of st.values()) if (r.type === 'candidate-pair' && r.selected) pair = r; // Firefox
    if (!pair) for (const r of st.values()) if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r;
    const loc = pair && st.get(pair.localCandidateId), rem = pair && st.get(pair.remoteCandidateId);
    // Offered the relay: a TURN server with a minted credential in this connection's configuration.
    const turn = (l.pc.getConfiguration().iceServers || []).some((s) => s.username && [].concat(s.urls).some((u) => /^turns?:/.test(u)));
    out.push({ slot, local: loc?.candidateType, remote: rem?.candidateType, proto: loc?.relayProtocol || loc?.protocol,
      bytesIn: pair?.bytesReceived ?? 0, bytesOut: pair?.bytesSent ?? 0, packetsIn: pair?.packetsReceived ?? null, rtt: pair?.currentRoundTripTime ?? null, turn });
  }
  return out;
});

// A relay-forced player uses a relayed local candidate on every link (its far
// end is logged: it can read 'prflx' when the relay's checks arrive before its
// candidate is signalled); a pair with neither end forced does not use the relay.
async function expectRelayed(ps) {
  const all = {};
  for (const p of ps) {
    all[p.name] = await paths(p);
    for (const x of all[p.name]) {
      const peer = ps.find((q) => q.slot === x.slot);
      if (p.relay) expect(x.local, `${p.name}'s link to ${peer.name}`).toBe('relay');
      if (!p.relay && !peer.relay) expect(x.local, `${p.name}'s link to ${peer.name}: neither forced, stays direct`).not.toBe('relay');
    }
  }
  console.log(`# selected paths: ${ps.map((p) => `${p.name}${p.relay ? ' (relay-only)' : ''} -> ${all[p.name].map((x) => `${ps.find((q) => q.slot === x.slot).name} ${x.local}/${x.remote} ${x.proto} rtt ${x.rtt == null ? '?' : Math.round(x.rtt * 1000)} ms`).join(', ')}`).join('; ')}`);
  console.log(`# Worker answers: ${ps.map((p) => `${p.name} ${JSON.stringify(p.worker)}`).join(', ')}`);
  console.log(`# test-message round trips: ${ps.map((p) => `${p.name}: ${p.rtts.map((r) => `${r.name} ${r.rtt} ms`).join(', ')}`).join('; ')}`);
  return all;
}

async function playUntil(ps, tick, timeout) {
  await expect.poll(async () => Math.min(...(await Promise.all(ps.map(netState))).map((s) => s.tick)), { timeout, intervals: [3000] }).toBeGreaterThan(tick);
  const st = await Promise.all(ps.map(netState));
  const cmp = sameHashes(st);
  expect(cmp.ok, JSON.stringify(cmp)).toBe(true);
  for (const s of st) { expect(s.desync).toBeNull(); expect(s.held).toEqual([]); }
  expect(ps.flatMap((p) => p.errors)).toEqual([]);
  return { st, cmp };
}

// Lobbies of 2, 3 and 4 with one or more players relay-only: connect, prove
// every channel, start, and play a synced match.
for (const [n, forced] of [[2, ['Bram']], [3, ['Bram', 'Cora']], [4, ['Ava', 'Bram', 'Cora', 'Dunn']]]) {
  test(`${n} players, ${forced.length === n ? 'every one' : forced.join(' and ')} relay-only: connect, verify every channel, play in sync`, async ({ browser }) => {
    const specs = ['Ava', 'Bram', 'Cora', 'Dunn'].slice(0, n).map((name) => ({ name, relay: forced.includes(name) }));
    const ps = await relayLobby(browser, specs, { net: { speed: 8, hashEvery: 50 } });
    await expectRelayed(ps);
    for (const [i, p] of ps.entries()) { await sleepRender(p); await scriptPlayer(p, ['boom', 'rush', 'turtle', 'boom'][i]); }
    const { st, cmp } = await playUntil(ps, 2400, 6 * 60_000);
    console.log(`# ${n} players (${forced.join(', ')} relay-only): ${cmp.shared} shared hash checkpoints identical up to tick ${Math.min(...st.map((s) => s.tick))}; commands sent ${st.map((s) => s.sent)}`);
    for (const s of st) expect(s.sent).toBeGreaterThan(20);
    expect(cmp.shared).toBeGreaterThanOrEqual(20 * (n - 1)); // each peer keeps its ~20 latest hashes, compared with the first player's
    for (const p of ps) await p.context.close();
  });
}

// A network that blocks UDP (some carriers and corporate firewalls): the
// relay-only player may use only TURN over TLS on port 443, which looks like
// ordinary HTTPS traffic to a firewall.
test('2 players, Bram relay-only over TLS on port 443 alone (UDP blocked): connect, verify, play in sync', async ({ browser }) => {
  const ps = await relayLobby(browser, [{ name: 'Ava' }, { name: 'Bram', relay: 'tls' }], { net: { speed: 8, hashEvery: 50 } });
  const all = await expectRelayed(ps);
  for (const x of all.Bram) expect(x.proto, "Bram's relay is reached over TLS/TCP").toMatch(/tls|tcp/);
  for (const [i, p] of ps.entries()) { await sleepRender(p); await scriptPlayer(p, ['boom', 'rush'][i]); }
  const { st, cmp } = await playUntil(ps, 2400, 6 * 60_000);
  console.log(`# 2 players (Bram relay-only, TURN over TLS 443 only): ${cmp.shared} shared hash checkpoints identical up to tick ${Math.min(...st.map((s) => s.tick))}`);
  expect(cmp.shared).toBeGreaterThanOrEqual(20);
  for (const p of ps) await p.context.close();
});

// TURN is a fallback, not a replacement: with the relay on offer, players who
// can connect directly still do.
test('relay on offer, nobody forced: both players are given the relay, and still connect directly', async ({ browser }) => {
  const ps = await relayLobby(browser, [{ name: 'Ava' }, { name: 'Bram' }], { net: { speed: 8 } });
  const all = await expectRelayed(ps);
  for (const p of ps) for (const x of all[p.name]) {
    expect(x.turn, `${p.name} has the relay in its ICE servers`).toBe(true);
    expect(x.local).toBe('host'); // same machine: the most direct path there is
  }
  // Logged, not asserted: once a direct pair is writable (here within a
  // millisecond), Chrome stops gathering, so a pair that connects directly
  // never even allocates a relay. The relay-forced tests above show these
  // same pages gather and use relay candidates when nothing direct works.
  for (const p of ps) console.log(`# ${p.name} gathered ICE candidates by type: ${JSON.stringify(await p.page.evaluate(() => globalThis.__gathered))}`);
  for (const p of ps) await p.context.close();
});

// The 200 ms input delay, with a relayed peer. UI commands (the path the
// screen uses) are given on every page, including the relay-only one, and each
// must land at least NET.inputDelay ticks after it was given, at the same tick
// on every page. Phase 12 found a command given and run in the same tick when
// a frame ran more ticks than the delay; the conditions that expose that are
// all here: uneven per-message latency, periodic stalls that release turns in
// bursts, faster-than-real-time play, and a frozen tab catching up.
const giveCommands = (p, count, everyMs) => p.page.evaluate(async ({ count, everyMs }) => {
  const s = globalThis.__net.session, ls = s.ls, me = s.me, { scene } = globalThis.__game;
  const given = [];
  const base = Math.round([...ls.world.ofKind('unit')].find((x) => x.team === me && x.type === 'drone').x);
  for (let k = 0; k < count; k++) {
    const u = [...ls.world.ofKind('unit')].find((x) => x.team === me && x.type === 'drone');
    if (u) {
      const x = base + 7 * (k + 1) + me * 1000, y = Math.round(u.y); // unique per command (not from u.x: the drone moves)
      scene.world.issue({ type: 'move', ids: [u.id], x, y, team: me });
      given.push({ x, tick: ls.tick });
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return given;
}, { count, everyMs });
// Where each move landed, recorded as the ticks run (the session prunes its
// executed-turn history at every snapshot, so it cannot be read afterwards).
const recordLandings = (p) => p.page.evaluate(() => {
  const ls = globalThis.__net.session.ls, seen = (globalThis.__landed = {}), prev = ls.onTick;
  ls.onTick = (T) => {
    prev?.(T);
    const last = ls.executed[ls.executed.length - 1];
    if (last) for (const t of last[1]) for (const c of t.c || []) if (c.type === 'move' && !(c.x in seen)) seen[c.x] = Number(last[0]);
  };
});
const landedAt = (p, xs) => p.page.evaluate((xs) => Object.fromEntries(Object.entries(globalThis.__landed).filter(([x]) => xs.includes(Number(x)))), xs);
const freeze = (p, ms) => p.page.evaluate((ms) => { const end = performance.now() + ms; while (performance.now() < end) { /* the tab is busy */ } }, ms);

async function checkDelay(ps, given) {
  const xs = given.map((g) => g.x);
  await expect.poll(async () => Math.min(...(await Promise.all(ps.map(async (p) => Object.keys(await landedAt(p, xs)).length)))), { timeout: 60_000 }).toBe(xs.length);
  const at = await Promise.all(ps.map((p) => landedAt(p, xs)));
  const lags = given.map((g) => { for (const a of at) expect(a[g.x], `command ${g.x} lands at the same tick everywhere`).toBe(at[0][g.x]); return at[0][g.x] - g.tick; });
  for (const l of lags) expect(l).toBeGreaterThanOrEqual(NET_DEFAULTS.inputDelay);
  return { min: Math.min(...lags), max: Math.max(...lags), n: lags.length };
}

test('the 200 ms input delay holds with a relay-only peer: real-time play over the relay with uneven latency keeps full speed', async ({ browser }) => {
  const ps = await relayLobby(browser, [{ name: 'Ava' }, { name: 'Bram' }, { name: 'Cora', relay: true }], { net: { speed: 1, hashEvery: 50 }, latency: [40, 150] });
  await expectRelayed(ps);
  for (const [i, p] of ps.entries()) { await sleepRender(p); await scriptPlayer(p, ['boom', 'rush', 'turtle'][i]); }
  for (const p of ps) await recordLandings(p);
  const tick0 = (await netState(ps[2])).tick, t0 = Date.now();
  const given = (await Promise.all(ps.map((p) => giveCommands(p, 40, 1500)))).flat(); // a minute of play
  const rate = ((await netState(ps[2])).tick - tick0) / ((Date.now() - t0) / 1000);
  const lag = await checkDelay(ps, given);
  const { cmp } = await playUntil(ps, 0, 10_000);
  console.log(`# relay + 40-150 ms per message, real time: ${rate.toFixed(1)} ticks/s on the relay-only peer (20 is full speed); ${lag.n} UI commands from all 3 pages landed ${lag.min}-${lag.max} ticks after they were given (input delay ${NET_DEFAULTS.inputDelay}); ${cmp.shared} shared hash checkpoints identical`);
  expect(rate).toBeGreaterThanOrEqual(19);
  for (const p of ps) await p.context.close();
});

test('the 200 ms input delay holds with a relay-only peer: bursty stalls, 8x speed, and a frozen tab catching up', async ({ browser }) => {
  const ps = await relayLobby(browser, [{ name: 'Ava' }, { name: 'Bram' }, { name: 'Cora', relay: true }], { net: { speed: 8, hashEvery: 50 }, latency: [20, 250], stall: [2500, 700] });
  await expectRelayed(ps);
  for (const [i, p] of ps.entries()) { await sleepRender(p); await scriptPlayer(p, ['boom', 'rush', 'turtle'][i]); }
  for (const p of ps) await recordLandings(p);
  const giving = Promise.all(ps.map((p) => giveCommands(p, 50, 400)));
  const caught = [];
  for (let i = 0; i < 4; i++) { // the relay-only tab freezes 1.5 s, then runs up to 40 ticks a frame to catch up
    await ps[2].page.waitForTimeout(3000);
    await freeze(ps[2], 1500);
    caught.push((await netState(ps[2])).tick);
  }
  const given = (await giving).flat();
  const lag = await checkDelay(ps, given);
  const { st, cmp } = await playUntil(ps, Math.max(...caught) + 200, 3 * 60_000);
  console.log(`# relay + 20-250 ms per message + 700 ms stalls every 2.5 s, 8x speed, 4 freezes of 1.5 s on the relay-only tab: ${lag.n} UI commands landed ${lag.min}-${lag.max} ticks after they were given (input delay ${NET_DEFAULTS.inputDelay}), the same tick on every page; ${cmp.shared} shared hash checkpoints identical up to tick ${Math.min(...st.map((s) => s.tick))}`);
  for (const p of ps) await p.context.close();
});

// Bandwidth: four players, every link relayed (the worst case for the free
// allowance: all traffic of all four players crosses Cloudflare), real time.
// Billed traffic is what the relay sends to each relayed client, so what every
// page receives on its relayed links.
test('bandwidth: four relay-only players in real time', async ({ browser }) => {
  const ps = await relayLobby(browser, ['Ava', 'Bram', 'Cora', 'Dunn'].map((name) => ({ name, relay: true })), { net: { speed: 1 } });
  for (const [i, p] of ps.entries()) { await sleepRender(p); await scriptPlayer(p, ['boom', 'rush', 'turtle', 'boom'][i]); }
  await ps[0].page.waitForTimeout(15_000); // past the opening
  const sum = async () => { let b = 0, pk = 0; for (const p of ps) for (const x of await paths(p)) { b += x.bytesIn; pk += x.packetsIn ?? 0; } return { b, pk }; };
  const a = await sum(), tick0 = (await netState(ps[0])).tick, t0 = Date.now();
  await ps[0].page.waitForTimeout(120_000);
  const z = await sum(), secs = (Date.now() - t0) / 1000, ticks = (await netState(ps[0])).tick - tick0;
  const bytes = z.b - a.b, packets = z.pk - a.pk;
  // Per relayed client, plus TURN framing (4-byte ChannelData header) and IPv4+UDP headers (28) per packet: a ceiling.
  const perClientPerSec = (bytes + packets * 32) / 4 / secs;
  console.log(`# bandwidth, 4 relay-only players, ${secs.toFixed(0)} s real time (${ticks} ticks): ${bytes} bytes in ${packets} packets received over all 12 link ends; per relayed client ${(perClientPerSec / 1024).toFixed(2)} KiB/s with framing; a 30-minute match, 4 relayed clients: ${(perClientPerSec * 4 * 1800 / 1e6).toFixed(1)} MB`);
  expect(packets).toBeGreaterThan(0);
  await playUntil(ps, 0, 10_000);
  for (const p of ps) await p.context.close();
});

// The Phase 11 cross-engine lockstep proof, re-run with the WebKit player
// (Safari's engine: an iPhone on a cellular network) relay-only.
test('a Chromium, a Firefox and a relay-only WebKit player play one match in lockstep', async () => {
  test.skip(!process.env.CROSS_ENGINE, 'needs Firefox and WebKit (CROSS_ENGINE=1)');
  test.setTimeout(14 * 60_000);
  const engines = { chromium, firefox, webkit }, order = ['chromium', 'firefox', 'webkit'];
  const browsers = [];
  for (const n of order) browsers.push(await engines[n].launch());
  try {
    const ps = await relayLobby(null, [{ name: 'Ava' }, { name: 'Bram' }, { name: 'Cora', relay: true }], { net: { speed: 4, hashEvery: 50 }, browsers });
    await expectRelayed(ps);
    for (const [i, p] of ps.entries()) { await scriptPlayer(p, ['boom', 'rush', 'turtle'][i]); await sleepRender(p); }
    const { st, cmp } = await playUntil(ps, 3000, 9 * 60_000);
    console.log(`# ${order.join(' + ')} (webkit relay-only): ${cmp.shared} shared hash checkpoints up to tick ${Math.min(...st.map((s) => s.tick))}: all identical; commands sent ${st.map((s) => s.sent)}`);
    expect(cmp.shared).toBeGreaterThan(40);
    for (const s of st) expect(s.sent).toBeGreaterThan(20);
  } finally {
    for (const b of browsers) await b.close();
  }
});
