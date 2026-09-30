// Phase 11 protocol (PHASE11_SPEC.md "Disconnects and AI hold", "Snapshots and
// reconnection", "Chat"): lockstep sessions on a fake network with latency, a
// virtual clock and a stand-in for Firebase presence. Timings are shortened
// (grace 4 s, handback 2 s steady); the rules are the shipped ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetSim, TEST_NET } from './net-sim.js';
import { installDetMath } from '../src/net/detmath.js';
import { homeOf } from '../src/net/hold.js';

const det = (fn) => () => { const off = installDetMath(); try { fn(); } finally { off(); } };
const same = (sim, from) => {
  const c = sim.compare({ from });
  assert.ok(c.ok, `peers diverged: ${JSON.stringify(c)}`);
  for (const p of sim.peers.values()) if (p.alive) assert.equal(p.session.desync, null, `player ${p.me} saw a desync: ${JSON.stringify(p.session.desync)}`);
  return c;
};
const control = (sim, me, x) => JSON.stringify(sim.s(me).ls.shared.control.get(x));

test('three players on a network with latency stay identical at every tick', det(() => {
  const sim = new NetSim({ seed: 3, lineup: 'HHHA', latency: [30, 150] });
  sim.run(40000);
  const c = same(sim);
  assert.ok(c.compared >= 750, `${c.compared} ticks compared`);
  for (const p of sim.peers.values()) { assert.equal(p.session.desync, null); assert.deepEqual(p.notices, []); }
}));

test('a drop shorter than the grace period: the game waits, then goes on, no takeover', det(() => {
  const sim = new NetSim({ seed: 1, lineup: 'HHHA' });
  sim.run(10000);
  const before = sim.s(1).tick;
  sim.cutLinks(2);
  sim.run(TEST_NET.graceMs - 1000);
  assert.ok(sim.s(1).tick - before <= TEST_NET.inputDelay + 1, 'the others waited for the missing player');
  assert.deepEqual(sim.s(1).status().waiting.map((w) => w.s), [2], '"waiting for" the silent player');
  sim.cutLinks(2, false);
  sim.run(10000);
  for (const me of [1, 2, 3]) assert.equal(control(sim, me, 2), '[]', 'no takeover at all');
  assert.ok(sim.s(1).tick > before + 150, 'play resumed');
  same(sim);
}));

test('no takeover while Firebase still sees the player: no split brain, the game waits', det(() => {
  const sim = new NetSim({ seed: 1, lineup: 'HHHA' });
  sim.run(8000);
  sim.cutLinks(3); // the P2P links die, but player 3 is still online to Firebase
  sim.run(TEST_NET.graceMs * 3);
  for (const me of [1, 2]) assert.equal(control(sim, me, 3), '[]');
  sim.cutLinks(3, false);
  sim.run(8000);
  same(sim);
}));

test('the side that lost its connection freezes; only the online side takes over', det(() => {
  const sim = new NetSim({ seed: 4, lineup: 'HHAA' });
  sim.run(8000);
  // Player 1's internet goes: no links, no Firebase; Firebase drops its presence.
  sim.cutLinks(1); sim.online.set(1, false); sim.at(sim.clock + 800, () => sim.presence.set(1, false));
  const frozenAt = sim.s(1).tick;
  sim.run(TEST_NET.graceMs + 3000);
  assert.match(control(sim, 2, 1), /"held":true/, 'the online player took over');
  assert.equal(control(sim, 1, 2), '[]', 'the offline player took nothing over');
  assert.ok(sim.s(1).tick <= frozenAt + TEST_NET.inputDelay + 1, 'and did not play on alone');
  // Its internet comes back: it learns it was held and starts again from a snapshot.
  sim.online.set(1, true); sim.presence.set(1, true); sim.cutLinks(1, false);
  sim.run(2000);
  assert.equal(sim.s(1).mode, 'held-out');
}));

test('takeover after the grace period: every remaining player agrees on the tick; the AI holds the camp', det(() => {
  const sim = new NetSim({ seed: 2, lineup: 'HHHA' });
  sim.run(60000); // a minute of play: armies out
  const w0 = sim.s(1).ls.world;
  sim.close(3);
  sim.run(TEST_NET.graceMs - 1500);
  assert.equal(control(sim, 1, 3), '[]', 'not before the grace period');
  sim.run(3000);
  const c1 = control(sim, 1, 3), c2 = control(sim, 2, 3);
  assert.match(c1, /^\[\{"k":\d+,"held":true\}\]$/);
  assert.equal(c2, c1, 'the same tick on both');
  for (const me of [1, 2]) assert.ok(sim.s(me).notices.some((n) => /Cora is disconnected: the AI holds their camp/.test(n.text)), 'announced');
  // The hold behaviour, 40 s later, on the live world.
  const w = sim.s(1).ls.world;
  assert.equal(w, w0);
  const C = JSON.parse(c1)[0].k;
  const sites = [...w.ofKind('building')].filter((b) => b.team === 3).length;
  const queued = [...w.ofKind('building')].filter((b) => b.team === 3).reduce((a, b) => a + b.queue.length, 0);
  sim.run(40000);
  const home = homeOf(w, 3);
  const army = [...w.ofKind('unit')].filter((u) => u.team === 3 && u.type !== 'drone');
  assert.ok(army.every((u) => home.contains(u) || u.order.auto), 'the army is home (or fighting an intruder in its zones)');
  assert.ok([...w.ofKind('building')].filter((b) => b.team === 3).length <= sites, 'nothing new built');
  assert.equal([...w.ofKind('building')].filter((b) => b.team === 3).reduce((a, b) => a + b.queue.length, 0), 0, `the ${queued} queued units finished, nothing new queued`);
  assert.ok([...w.ofKind('building')].filter((b) => b.team === 3 && b.rally).every((b) => home.contains(b.rally)), 'rally points home');
  assert.ok(sim.s(1).tick > C + 700, 'the others played on');
  same(sim);
}));

function rejoinScenario(leaver, { seed = 5 } = {}) {
  const sim = new NetSim({ seed, lineup: 'HHHA' });
  sim.run(20000);
  sim.close(leaver);
  sim.run(TEST_NET.graceMs + 4000);
  const heldFrom = JSON.parse(control(sim, leaver === 1 ? 2 : 1, leaver))[0].k;
  sim.run(8000); // ticks pass under the AI
  const back = sim.reopen(leaver);
  const reopenedAt = sim.clock;
  sim.run(15000);
  return { sim, back, reopenedAt, heldFrom };
}

test('rejoin: a snapshot from another player, byte-identical at the catch-up tick, handed back after a steady link', det(() => {
  const { sim, back, reopenedAt, heldFrom } = rejoinScenario(3);
  const c = back.session.caughtUpAt;
  assert.ok(c, 'caught up');
  assert.notEqual(c.server, 3);
  assert.equal(c.hash, c.serverHash, `whole-state hash at tick ${c.tick} equals the serving player's`);
  assert.ok(c.tick > heldFrom + 100, 'ticks had passed under the AI');
  const backNotice = back.notices.find((n) => /back in control/.test(n.text));
  assert.ok(backNotice, 'handed back');
  assert.ok(backNotice.at - reopenedAt >= TEST_NET.handbackStableMs, `only after ${TEST_NET.handbackStableMs} ms of steady link (${backNotice.at - reopenedAt})`);
  for (const me of [1, 2]) assert.ok(sim.s(me).notices.some((n) => /Cora is back in control/.test(n.text)));
  const cmp = same(sim, c.tick);
  assert.ok(cmp.compared > 200, `identical at every tick since (${cmp.compared} compared)`);
  assert.equal(sim.s(3).ls.isHuman(3, sim.s(3).tick), true);
}));

test('the host leaves and rejoins: another player serves the snapshot and hands the camp back', det(() => {
  const { sim, back } = rejoinScenario(1, { seed: 6 });
  const c = back.session.caughtUpAt;
  assert.ok(c && c.hash === c.serverHash, 'byte-identical at catch-up');
  assert.ok([2, 3].includes(c.server), `served by player ${c.server}, not the host`);
  assert.ok(back.notices.some((n) => /You are back in control/.test(n.text)));
  same(sim, c.tick);
}));

test('hysteresis: a flapping link is not a steady one; the handback waits for 2 s of calm', det(() => {
  const sim = new NetSim({ seed: 7, lineup: 'HHAA' });
  sim.run(15000);
  sim.close(2);
  sim.run(TEST_NET.graceMs + 3000);
  const back = sim.reopen(2);
  sim.run(1500);
  assert.ok(back.session.caughtUpAt, 'caught up quickly');
  // The link flaps: down 1.6 s (> handbackMaxGapMs), up 1 s, a few times.
  for (let i = 0; i < 4; i++) { sim.cutLinks(2); sim.run(1600); sim.cutLinks(2, false); sim.run(1000); }
  assert.ok(!back.notices.some((n) => /back in control/.test(n.text)), 'no handback while it flaps');
  sim.run(TEST_NET.handbackStableMs + 2000);
  assert.ok(back.notices.some((n) => /back in control/.test(n.text)), 'handed back once steady');
  same(sim, back.session.caughtUpAt.tick);
}));

test('no one to serve a snapshot: the rejoining player waits, then rejoins when someone is back', det(() => {
  const sim = new NetSim({ seed: 8, lineup: 'HHAA' });
  sim.run(15000);
  sim.close(2);
  sim.run(TEST_NET.graceMs + 3000);
  sim.cutLinks(1); // the only other player is unreachable for now
  const back = sim.reopen(2);
  sim.run(3000);
  assert.equal(back.session.status().mode, 'waiting');
  sim.cutLinks(1, false);
  sim.run(3000);
  assert.equal(back.session.mode, 'play');
  assert.equal(back.session.caughtUpAt.hash, back.session.caughtUpAt.serverHash);
}));

test('a match with a camp the AI holds for good still ends through the normal rules', det(() => {
  const sim = new NetSim({ seed: 9, lineup: 'HHHA', net: { ...TEST_NET, hashEvery: 600, snapshotEvery: 1200 } });
  sim.run(10000);
  sim.close(3); // never comes back
  const done = sim.run(40 * 60 * 1000, { until: (x) => x.s(1).ls.done && x.s(2).ls.done });
  assert.ok(done, 'the match ended');
  const r1 = sim.s(1).ls.world.result, r2 = sim.s(2).ls.world.result;
  assert.deepEqual(r1, r2, 'the same result on both');
  assert.ok(['last-standing', 'time-limit'].includes(r1.reason), r1.reason);
  assert.equal(r1.standings.length, 4);
  console.log(`# a held camp for good: ${r1.reason} at ${Math.round(r1.time)} s, winner camp ${r1.winner}; camp 3 ${r1.eliminated.find((e) => e.team === 3) ? 'eliminated' : 'survived'}`);
  same(sim);
}));

test('chat: lines reach everyone with the lobby names, are rate-limited, and never touch the game', det(() => {
  const run = (talk) => {
    const sim = new NetSim({ seed: 10, lineup: 'HHHA' });
    sim.run(5000);
    if (talk) {
      assert.equal(sim.s(1).chat('gl hf'), true);
      assert.equal(sim.s(2).chat('  you too  '), true);
      assert.equal(sim.s(3).chat('x'.repeat(500)), true);
      for (let i = 0; i < 4; i++) sim.s(1).chat(`spam ${i}`);
      assert.equal(sim.s(1).chat('one too many'), false, 'at most 5 lines per 5 s');
    }
    sim.run(10000);
    return sim;
  };
  const quiet = run(false), chatty = run(true);
  for (const me of [1, 2, 3]) {
    const log = chatty.s(me).chatLog;
    const lines = log.map((c) => `${c.name}: ${c.text.length > 50 ? c.text.length : c.text}`);
    for (const want of ['Ava: gl hf', 'Bram: you too', 'Cora: 200', 'Ava: spam 0', 'Ava: spam 3']) assert.ok(lines.includes(want), `${me} got "${want}"`);
    assert.equal(log.length, 7, 'every line once, the sixth of Ava\'s burst refused');
  }
  const t = Math.min(quiet.s(1).tick, chatty.s(1).tick);
  assert.equal(chatty.peers.get(1).fp.get(t), quiet.peers.get(1).fp.get(t), 'the same game with or without chat');
}));

test('a desync is detected and stops the match', det(() => {
  const sim = new NetSim({ seed: 11, lineup: 'HHAA' });
  sim.run(5000);
  sim.s(2).ls.world.resources[2] += 1; // corrupt one peer
  sim.run(8000);
  const d = sim.s(1).desync || sim.s(2).desync;
  assert.ok(d, 'detected');
  assert.ok(sim.s(1).notices.concat(sim.s(2).notices).some((n) => /Desync detected/.test(n.text)));
}));

test('a reload within the grace period: the returning tab asks to be held first, so its old and new turns never mix', det(() => {
  const sim = new NetSim({ seed: 12, lineup: 'HHHA' });
  sim.run(15000);
  sim.close(3);
  sim.run(600); // back before the grace period, before Firebase even noticed
  const back = sim.reopen(3);
  sim.run(3000);
  const c = back.session.caughtUpAt;
  assert.ok(c && c.hash === c.serverHash, 'caught up, byte-identical');
  for (const me of [1, 2]) assert.match(control(sim, me, 3), /"held":true/, 'held first (at its own request)');
  sim.run(TEST_NET.handbackStableMs + 3000);
  assert.ok(back.notices.some((n) => /You are back in control/.test(n.text)), 'then handed back');
  same(sim, c.tick);
}));
