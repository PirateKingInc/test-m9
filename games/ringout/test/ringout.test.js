// Ringout, headless: the second game's proof that the lockstep module is
// enough for a game unlike Dragonmarch (PLATFORM_SPEC.md Part C). Only the
// module's public index and Ringout's own files are used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeNet, DEFAULT_TIMING, installDetMath, SeededRng } from '../../../platform/lockstep/index.js';
import { Ringout, RULES } from '../sim.js';
import { Bot } from '../bot.js';

const det = (fn) => () => { const off = installDetMath(); try { fn(); } finally { off(); } };

// A whole match, bots on every slot, no network: the reference.
function solo({ seed, slots = [1, 2, 3], pace = 'normal', until = Infinity, game = new Ringout({ seed, slots, pace }), bots = slots.map((s) => new Bot(s, seed)) } = {}) {
  while (!game.isOver() && game.tick < until) {
    const inputs = bots.map((b) => { const commands = []; b.act(game, (c) => commands.push(c)); return { slot: b.slot, commands }; });
    game.step(game.tick, inputs);
  }
  return game;
}

test('rules: a bot match ends with a result, rounds that ended with a winner or a draw', det(() => {
  for (const seed of [1, 2, 3]) {
    const g = solo({ seed });
    assert.ok(g.result, `seed ${seed} ended`);
    const top = Math.max(...Object.values(g.result.score));
    assert.ok(top === RULES.winScore || g.round === RULES.maxRounds);
    assert.ok(g.history.length === g.round);
    console.log(`# Ringout seed ${seed}: ${g.round} rounds, ${g.tick} ticks, winner ${g.result.winner || 'draw'}, score ${JSON.stringify(g.result.score)}`);
  }
}));

test('rules: the same seed and inputs give the same match bit for bit; another seed does not', det(() => {
  const a = solo({ seed: 5, until: 2000 }), b = solo({ seed: 5, until: 2000 }), c = solo({ seed: 6, until: 2000 });
  assert.equal(a.hash(), b.hash());
  assert.notEqual(a.hash(), c.hash());
}));

test('rules: commands are validated; a held puck is anchored and ignores its player', det(() => {
  const g = new Ringout({ seed: 1, slots: [1, 2] });
  assert.equal(g.validate({ type: 'steer', dir: 3 }), undefined);
  assert.ok(g.validate({ type: 'steer', dir: 16 }));
  assert.ok(g.validate({ type: 'teleport' }));
  g.hold(2);
  const start = { ...g.pucks[2] };
  for (let t = 0; t < 40; t++) g.step(t, [{ slot: 1, commands: [] }, { slot: 2, commands: [{ type: 'steer', dir: 0 }, { type: 'dash' }] }]);
  assert.equal(g.pucks[2].x, start.x, 'anchored: it does not move by itself');
  g.release(2);
  for (let t = 40; t < 60; t++) g.step(t, [{ slot: 2, commands: [{ type: 'steer', dir: 0 }] }]);
  assert.ok(g.pucks[2].x > start.x, 'released: it steers again');
}));

test('snapshot: restored mid-match (and across a round boundary) plays on identically to the end', det(() => {
  const twin = (b) => Object.assign(new Bot(b.slot), { dir: b.dir, rng: new SeededRng(b.rng.s) }); // the scripted players' own state
  for (const at of [300, 1500]) {
    const seed = 4, slots = [1, 2, 3, 4], bots = slots.map((s) => new Bot(s, seed));
    const g = solo({ seed, slots, until: at, bots });
    const copy = Ringout.restore(JSON.parse(JSON.stringify(g.serialize())));
    assert.ok(copy instanceof Ringout);
    assert.equal(copy.hash(), g.hash(), 'identical on restore');
    const botsCopy = bots.map(twin);
    solo({ game: g, bots }); solo({ game: copy, bots: botsCopy });
    assert.ok(g.result);
    assert.equal(copy.hash(), g.hash(), `identical at the end (restored at ${at})`);
    assert.deepEqual(copy.result, g.result);
  }
}));

// Over the network: FakeNet peers, each running only its own slot's bot.
const TIMING = { ...DEFAULT_TIMING, graceMs: 4000, handbackStableMs: 2000, snapshotEvery: 200, hashEvery: 50 };
function net(slots, { seed = 1, latency = [20, 120], pace = 'hard' } = {}) {
  const bots = new Map();
  return new FakeNet({
    players: slots, timing: TIMING, seed, latency,
    newGame: () => new Ringout({ seed, slots, pace }),
    restoreGame: Ringout.restore,
    onTick: (peer, ls) => {
      if (!ls.inControl(peer.me, ls.tick)) return;
      let b = bots.get(peer.me);
      if (!b || b.game !== ls.game) { b = { bot: new Bot(peer.me, seed), game: ls.game }; bots.set(peer.me, b); }
      b.bot.act(ls.game, (c) => ls.submit(c));
    },
  });
}

test('three Ringout peers on a network with latency: identical at every tick, the same result', det(() => {
  const n = net([1, 2, 3], { seed: 2 });
  const done = n.run(20 * 60 * 1000, { until: (x) => [1, 2, 3].every((s) => x.s(s).lockstep.done) });
  assert.ok(done, 'the match ended');
  const c = n.compare();
  assert.ok(c.ok, JSON.stringify(c));
  assert.ok(c.compared > 500);
  const results = [1, 2, 3].map((s) => JSON.stringify(n.s(s).lockstep.game.result));
  assert.ok(results.every((r) => r === results[0]), results.join(' vs '));
  console.log(`# Ringout over FakeNet: 3 peers identical over ${c.compared} ticks, result ${results[0]}`);
}));

test('a Ringout player leaves and comes back: anchored on every peer, rejoins from a snapshot, plays again', det(() => {
  const n = net([1, 2, 3], { seed: 3 });
  n.run(6000);
  n.close(2);
  n.run(TIMING.graceMs + 3000);
  const held = n.events(1, 'held');
  assert.equal(held.length, 1);
  for (const s of [1, 3]) assert.equal(n.s(s).lockstep.game.anchored[2], true, `anchored on peer ${s}`);
  const back = n.reopen(2);
  n.run(10000);
  const c = back.session.caughtUpAt;
  assert.ok(c && c.match, JSON.stringify(c));
  assert.ok(back.events.some((e) => e.name === 'returned' && e.args[0] === 2), 'handed back');
  assert.equal(back.session.lockstep.game.anchored[2], false);
  const cmp = n.compare({ from: c.tick });
  assert.ok(cmp.ok, JSON.stringify(cmp));
}));
