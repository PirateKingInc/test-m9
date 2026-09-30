// Phase 11 Part A, the gate (PHASE11_SPEC.md "The tick loop"): lockstep peers
// in one process, no network code, fed the same command streams through JSON
// turns with random latency and reordering. Every peer's state must be
// byte-identical at every tick (a fingerprint of every entity each tick, the
// whole serialized match every 250 ticks and at the end), over the fixed-seed
// scenarios of Phases 3, 6 and 8. Deterministic Math is installed, as in a
// real multiplayer match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PF } from './helpers.js';
import { Match } from '../src/ai/match.js';
import { FFA_STRATEGIES } from '../src/data/ffa.js';
import { lobbyMatch, humansOf } from '../src/net/lockstep.js';
import { adoptRngs } from '../src/net/snapshot.js';
import { installDetMath } from '../src/net/detmath.js';
import { lockstepPeers, runPeers, firstDivergence } from './net-harness.js';

const finals = new Map(); // scenario -> final state hash

function gate(name, { make, humans, bots, ticks, latency, seed }) {
  test(name, () => {
    const uninstall = installDetMath();
    try {
      const peers = lockstepPeers({ make, humans, bots });
      runPeers(peers, { ticks, latency, seed });
      const div = firstDivergence(peers);
      assert.equal(div, null, `peers diverged: ${JSON.stringify(div)}`);
      const ends = peers.map((p) => p.ls.tick);
      assert.ok(ends.every((t) => t === ends[0]), `all peers at the same tick (${ends})`);
      const commands = peers.reduce((a, p) => a + p.commands, 0);
      const units = [...peers[0].ls.world.ofKind('unit')].length;
      assert.ok(commands > 50, `the scripted players really played (${commands} commands)`);
      finals.set(name, [...peers[0].full.values()].at(-1));
      console.log(`# ${name}: ${peers.length} peers identical over ${ends[0]} ticks (${[...peers[0].full.keys()].length} full-state checks), ${commands} player commands, ${units} units${peers[0].ls.done ? `, result ${peers[0].ls.world.result.reason}` : ''}`);
      return peers;
    } finally { uninstall(); }
  });
}

// Phase 3's fixed-seed 1v1 pairings, both sides now lockstep players.
for (const [a, b, tier, seed] of [['rush', 'boom', 'hard', 1], ['turtle', 'rush', 'normal', 2], ['boom', 'turtle', 'easy', 3]]) {
  gate(`1v1 ${a} vs ${b}, ${tier}, seed ${seed}`, {
    make: () => adoptRngs(new Match({ seed, PF, ai: null }), seed),
    humans: [1, 2], bots: { 1: { strategy: a, difficulty: tier }, 2: { strategy: b, difficulty: tier } },
    ticks: 3000, latency: 5, seed,
  });
}

// Phases 6 and 8's free-for-all seeds, with 2, 3 and 4 human camps.
const bot = (s) => ({ strategy: FFA_STRATEGIES[s] || 'boom', difficulty: 'hard' });
for (const seed of [1, 2, 3]) {
  for (const lineup of ['HHAA', 'HHHA', 'HHHH']) {
    const humans = humansOf(lineup);
    gate(`free-for-all seed ${seed}, ${lineup}`, {
      make: () => lobbyMatch({ seed, lineup, difficulty: 'hard' }, PF),
      humans, bots: Object.fromEntries(humans.map((s) => [s, bot(s)])),
      ticks: 2400, latency: 6, seed: seed * 10 + humans.length,
    });
  }
}

// One whole match, four humans, played to its result.
gate('free-for-all seed 5, HHHH, to the end', {
  make: () => lobbyMatch({ seed: 5, lineup: 'HHHH', difficulty: 'hard' }, PF),
  humans: [1, 2, 3, 4], bots: { 1: bot(1), 2: bot(2), 3: bot(3), 4: bot(4) },
  ticks: 36000, latency: 6, seed: 55,
});

// The gate is not vacuous: the scenarios differ, and a divergence is caught.
test('control: different seeds end in different states', () => {
  const byLineup = {};
  for (const [name, h] of finals) { const m = name.match(/seed (\d), (H{2,4}A*)$/); if (m) (byLineup[m[2]] ||= new Set()).add(h); }
  for (const [lineup, hashes] of Object.entries(byLineup)) assert.equal(hashes.size, 3, `${lineup}: seeds 1-3 end in 3 different states`);
});

test('control: a peer that built its match from another seed is caught', () => {
  const uninstall = installDetMath();
  try {
    let n = 0;
    const peers = lockstepPeers({ make: () => lobbyMatch({ seed: n++ === 0 ? 1 : 2, lineup: 'HHAA', difficulty: 'hard' }, PF), humans: [1, 2], bots: { 1: bot(1), 2: bot(2) } });
    runPeers(peers, { ticks: 600, latency: 3, seed: 9 });
    assert.ok(firstDivergence(peers), 'caught');
  } finally { uninstall(); }
});

test('control: one command lost on one peer is caught at the next tick', () => {
  const uninstall = installDetMath();
  try {
    const peers = lockstepPeers({ make: () => lobbyMatch({ seed: 1, lineup: 'HHAA', difficulty: 'hard' }, PF), humans: [1, 2], bots: { 1: bot(1), 2: bot(2) } });
    const victim = peers[1].ls, accept = victim.accept.bind(victim);
    let dropped = null;
    victim.accept = (turn) => { if (!dropped && turn.s === 1 && turn.c.length) { dropped = turn.k; turn = { ...turn, c: turn.c.slice(1) }; } return accept(turn); };
    runPeers(peers, { ticks: 1200, latency: 3, seed: 9 });
    const div = firstDivergence(peers);
    assert.ok(dropped != null && div, 'caught');
    assert.equal(div.tick, dropped + 1, `caught right after the tick that lost it (${dropped})`);
  } finally { uninstall(); }
});
