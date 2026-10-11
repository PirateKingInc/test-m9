// The peer protocol with a mock game on FakeNet: no game fixture, no browser.
// Timings are shortened (grace 4 s, handback 2 s steady); the rules are the
// module's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeNet, DEFAULT_TIMING, SeededRng, PROTOCOL_MESSAGES } from '../index.js';
import { Counter } from './mock-game.js';

const TIMING = { ...DEFAULT_TIMING, graceMs: 4000, handbackStableMs: 2000, snapshotEvery: 200, hashEvery: 50 };

// A scripted player per peer: adds a random number on some ticks, only while
// its slot is in control.
function net(players, opts = {}) {
  const rngs = new Map(players.map((s) => [s, new SeededRng(100 + s)]));
  return new FakeNet({
    players, timing: TIMING, seed: opts.seed || 1,
    newGame: () => new Counter({ seed: 9, slots: players, endAt: opts.endAt }),
    restoreGame: Counter.restore,
    onTick: (peer, ls) => { const r = rngs.get(peer.me); if (ls.inControl(peer.me, ls.tick) && r.next() < 0.25) ls.submit({ n: r.int(1, 5) }); },
    ...opts,
  });
}
const same = (n, from) => {
  const c = n.compare({ from });
  assert.ok(c.ok, `peers diverged: ${JSON.stringify(c)}`);
  for (const p of n.peers.values()) if (p.alive) assert.equal(p.session.desync, null);
  return c;
};

test('three peers on a network with latency stay identical at every tick', () => {
  const n = net([1, 2, 3], { latency: [30, 150] });
  n.run(30000);
  const c = same(n);
  assert.ok(c.compared >= 550, `${c.compared} ticks compared`);
  assert.ok(n.s(1).lockstep.game.ran.length > 300, 'the scripted players played');
});

test('a drop shorter than the grace period: the game waits, then goes on, nobody is held', () => {
  const n = net([1, 2, 3]);
  n.run(5000);
  const before = n.s(1).tick;
  n.cutLinks(2);
  n.run(TIMING.graceMs - 1000);
  assert.ok(n.s(1).tick - before <= TIMING.inputDelay + 1, 'the others waited');
  assert.deepEqual(n.s(1).status().waiting.map((w) => w.s), [2]);
  n.cutLinks(2, false);
  n.run(5000);
  assert.deepEqual(n.events(1, 'held'), []);
  assert.ok(n.s(1).tick > before + 80);
  same(n);
});

test('no slot is held while the arbiter still sees its player (no split brain)', () => {
  const n = net([1, 2, 3]);
  n.run(4000);
  n.cutLinks(3);
  n.run(TIMING.graceMs * 3);
  for (const me of [1, 2]) assert.deepEqual(n.events(me, 'held'), []);
  n.cutLinks(3, false);
  n.run(5000);
  same(n);
});

test('a closed tab: after the grace period every peer holds the slot from the same tick, and the game\'s hold() runs there', () => {
  const n = net([1, 2, 3]);
  n.run(8000);
  n.close(3);
  n.run(TIMING.graceMs + 3000);
  const h1 = n.events(1, 'held'), h2 = n.events(2, 'held');
  assert.equal(h1.length, 1);
  assert.deepEqual(h1[0].args, h2[0].args, 'the same slot and tick on both');
  const [slot, from] = h1[0].args;
  assert.equal(slot, 3);
  n.run(3000);
  for (const me of [1, 2]) assert.deepEqual(n.s(me).lockstep.game.events, [['hold', 3, from]]);
  same(n);
});

test('rejoin: a snapshot from another peer, identical at the catch-up tick, handed back after a steady link', () => {
  const n = net([1, 2, 3]);
  n.run(10000);
  n.close(2);
  n.run(TIMING.graceMs + 3000);
  n.run(4000); // ticks pass while held
  const back = n.reopen(2);
  const at = n.clock;
  n.run(10000);
  const c = back.session.caughtUpAt;
  assert.ok(c && c.match, `caught up with a matching hash: ${JSON.stringify(c)}`);
  assert.notEqual(c.server, 2);
  const ret = back.events.find((e) => e.name === 'returned' && e.args[0] === 2);
  assert.ok(ret, 'handed back');
  assert.ok(ret.at - at >= TIMING.handbackStableMs, 'only after a steady link');
  for (const me of [1, 3]) assert.ok(n.events(me, 'returned').some((e) => e.args[0] === 2));
  assert.deepEqual(back.session.lockstep.game.events.map(([k, s]) => [k, s]), [['hold', 2], ['release', 2]]);
  assert.ok(back.session.lockstep.game.ran.some(([t, s]) => s === 2 && t > ret.args[1]), 'its player plays again');
  same(n, c.tick);
});

test('the side that lost its connection freezes; when it comes back it learns it was held and starts again', () => {
  const n = net([1, 2]);
  n.run(5000);
  n.cutLinks(1); n.online.set(1, false); n.at(n.clock + 800, () => n.presence.set(1, false));
  const frozenAt = n.s(1).tick;
  n.run(TIMING.graceMs + 3000);
  assert.equal(n.events(2, 'held').length, 1, 'the online peer held slot 1');
  assert.deepEqual(n.events(1, 'held'), [], 'the offline peer held nobody');
  assert.ok(n.s(1).tick <= frozenAt + TIMING.inputDelay + 1);
  n.online.set(1, true); n.presence.set(1, true); n.cutLinks(1, false);
  n.run(2000);
  assert.equal(n.s(1).mode, 'held-out');
  assert.equal(n.events(1, 'heldOut').length, 1);
});

test('a desync is detected (one peer\'s state corrupted) and reported with the tick', () => {
  const n = net([1, 2]);
  n.run(3000);
  n.s(2).lockstep.game.total += 1;
  n.run(5000);
  const d = n.events(1, 'desync').concat(n.events(2, 'desync'));
  assert.ok(d.length >= 1);
  assert.equal(d[0].args[1], 'hash');
  assert.ok(n.s(1).desync || n.s(2).desync);
});

test('app messages: any type the protocol does not use reaches onMessage and never touches the game', () => {
  const run = (talk) => {
    const n = net([1, 2, 3], { seed: 4 });
    n.run(2000);
    if (talk) { n.s(1).broadcast({ t: 'emote', s: 1, what: 'wave' }); n.s(3).send(2, { t: 'ping', s: 3 }); }
    n.run(4000);
    return n;
  };
  const quiet = run(false), chatty = run(true);
  assert.deepEqual(chatty.events(2, 'message').map((e) => [e.args[0], e.args[1].t]).sort(), [[1, 'emote'], [3, 'ping']], 'from each sender (in any order: latency differs per message)');
  assert.deepEqual(chatty.events(3, 'message').map((e) => e.args[1].t), ['emote']);
  const t = Math.min(quiet.s(1).tick, chatty.s(1).tick);
  assert.equal(chatty.peers.get(1).fp.get(t), quiet.peers.get(1).fp.get(t), 'the same game');
  for (const t2 of ['turn', 'hb', 'snap']) assert.ok(PROTOCOL_MESSAGES.includes(t2));
});

test('a match that ends: every peer stops at the same tick', () => {
  const n = net([1, 2], { endAt: 300 });
  n.run(30000);
  for (const me of [1, 2]) { assert.ok(n.s(me).lockstep.done); assert.equal(n.s(me).tick, 300); }
  same(n);
});
