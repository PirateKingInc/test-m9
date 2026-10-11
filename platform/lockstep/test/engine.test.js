// The lockstep engine with a mock game, several peers in one process,
// turns exchanged as JSON with random latency and reordering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lockstep, SeededRng } from '../index.js';
import { Counter } from './mock-game.js';

function peers(players, { delay = 4, seed = 1, endAt } = {}) {
  return players.map((me) => ({ me, ls: new Lockstep({ game: new Counter({ seed, slots: players, endAt }), players, me, delay }), hashes: [], given: [] }));
}

// Runs every peer to `ticks`; each peer's player submits a random command on
// some ticks (recording the tick it was given at).
function run(ps, { ticks, latency = 5, seed = 7, act = true, onRound } = {}) {
  const rnd = new SeededRng(seed);
  const inbox = new Map(ps.map((p) => [p.me, []]));
  for (let round = 1; ps.some((p) => p.ls.tick < ticks && !p.ls.done); round++) {
    if (round > ticks * 50) throw new Error(`stuck: ${ps.map((p) => `${p.me}@${p.ls.tick} missing ${p.ls.missing()}`)}`);
    for (const p of [...ps].sort(() => rnd.next() - 0.5)) {
      const box = inbox.get(p.me);
      for (let i = box.length - 1; i >= 0; i--) if (box[i].at <= round) { p.ls.accept(JSON.parse(box[i].msg)); box.splice(i, 1); }
      if (act && p.ls.inControl(p.me, p.ls.tick) && rnd.next() < 0.3) { const n = rnd.int(1, 9); p.ls.submit({ n }); p.given.push([p.ls.tick, n]); }
      for (const turn of p.ls.commit()) for (const q of ps) if (q !== p) inbox.get(q.me).push({ at: round + 1 + rnd.int(0, latency), msg: JSON.stringify(turn) });
      if (p.ls.tick < ticks && p.ls.step()) p.hashes[p.ls.tick] = p.ls.stateHash();
    }
    onRound?.(round);
  }
}

test('three peers stay identical at every tick under latency and reordering', () => {
  const ps = peers([1, 2, 3]);
  run(ps, { ticks: 600 });
  for (const p of ps.slice(1)) for (let t = 1; t <= 600; t++) assert.equal(p.hashes[t], ps[0].hashes[t], `peer ${p.me} at tick ${t}`);
  assert.ok(ps[0].ls.game.ran.length > 300, 'commands ran');
});

test('every command runs at least `delay` ticks after it was given, exactly once, in order', () => {
  for (const delay of [1, 4, 9]) {
    const ps = peers([1, 2], { delay });
    run(ps, { ticks: 300 });
    for (const p of ps) {
      const ran = ps[0].ls.game.ran.filter(([, s]) => s === p.me);
      const given = p.given.slice(0, ran.length);
      assert.ok(p.given.length - ran.length <= delay + 2, 'only the last few, still in flight at the end, are missing');
      assert.deepEqual(ran.map(([, , n]) => n), given.map(([, n]) => n), `slot ${p.me}: the same commands in the same order`);
      for (let i = 0; i < ran.length; i++) assert.ok(ran[i][0] - given[i][0] >= delay, `slot ${p.me}, delay ${delay}: given at ${given[i][0]}, ran at ${ran[i][0]}`);
    }
  }
});

test('the engine waits for a missing turn and never guesses', () => {
  const [a] = peers([1, 2]);
  for (let i = 0; i < 4; i++) { a.ls.commit(); assert.ok(a.ls.step(), 'ticks before the delay need no turns'); }
  a.ls.commit();
  assert.equal(a.ls.step(), false);
  assert.deepEqual(a.ls.missing(), [2]);
  assert.equal(a.ls.accept({ t: 'turn', s: 2, k: 4, c: [{ n: 5 }], y: [] }), true);
  assert.equal(a.ls.accept({ t: 'turn', s: 2, k: 4, c: [{ n: 6 }], y: [] }), false, 'a duplicate is ignored');
  assert.equal(a.ls.accept({ t: 'turn', s: 9, k: 4, c: [], y: [] }), false, 'not a player');
  assert.ok(a.ls.step());
  assert.equal(a.ls.game.counts[2], 5);
});

test('local commands go through the game\'s validate()', () => {
  const [a] = peers([1, 2]);
  assert.deepEqual(a.ls.submit({ n: 'x' }), { ok: false, reason: 'n must be an integer' });
  assert.deepEqual(a.ls.submit({ n: 2 }), { ok: true, pending: true });
  assert.equal(a.ls.outbox.length, 1);
});

test('hold and release happen at the same tick on every peer, before that tick\'s step; held turns are not needed', () => {
  const ps = peers([1, 2, 3]);
  let decided = false;
  run(ps, { ticks: 400, onRound: () => {
    if (!decided && ps.every((p) => p.ls.tick >= 100)) {
      decided = true;
      const from = Math.max(...ps.map((p) => p.ls.tick)) + 10;
      for (const p of ps) p.ls.hold(3, from); // the decision the session agrees on
    }
  } });
  const ev = ps.map((p) => JSON.stringify(p.ls.game.events));
  assert.ok(ev.every((e) => e === ev[0]) && /hold/.test(ev[0]), ev[0]);
  const [, slot, at] = ps[0].ls.game.events[0];
  assert.equal(slot, 3);
  assert.equal(ps[0].ls.inControl(3, at - 1), true);
  assert.equal(ps[0].ls.inControl(3, at), false);
  assert.ok(ps[0].ls.game.ran.every(([t, s]) => s !== 3 || t < at), 'no command of a held slot runs');
  for (const p of ps.slice(1)) assert.equal(p.hashes[400], ps[0].hashes[400]);
});

test('a control command hands a held slot back, delay + 1 ticks after the turn that carries it', () => {
  const ps = peers([1, 2]);
  for (const p of ps) p.ls.hold(2, 50);
  let sent = false;
  run(ps, { ticks: 300, onRound: () => { if (!sent && ps[0].ls.tick >= 120) { sent = true; ps[0].ls.system({ kind: 'back', slot: 2 }); } } });
  const ev = ps.map((p) => p.ls.game.events);
  assert.deepEqual(ev[0], ev[1]);
  const back = ev[0].find(([k]) => k === 'release');
  assert.ok(back && back[2] > 120, JSON.stringify(ev[0]));
  assert.ok(ps[0].ls.game.ran.some(([t, s]) => s === 2 && t >= back[2]), 'slot 2 plays again');
  assert.equal(ps[1].hashes[300], ps[0].hashes[300]);
});

test('snapshot -> restore continues identically; the snapshot is a copy', () => {
  const ps = peers([1, 2]);
  run(ps, { ticks: 200 });
  const snap = JSON.parse(JSON.stringify(ps[0].ls.snapshot()));
  const kept = ps[0].ls.snapshot();
  ps[0].ls.hold(2, 260);
  assert.equal(JSON.stringify(kept.state.control), JSON.stringify(snap.state.control), 'a later decision does not leak into a kept snapshot');
  const r = Lockstep.restore(snap, { restoreGame: Counter.restore, players: [1, 2], me: 1, delay: 4 });
  assert.equal(r.tick, 200);
  assert.ok(r.game instanceof Counter);
  // the original without the hold, for a fair comparison
  const fresh = Lockstep.restore(snap, { restoreGame: Counter.restore, players: [1, 2], me: 1, delay: 4 });
  assert.equal(r.stateHash(), ps[1].ls.stateHash(), 'the same state as a live peer at that tick');
  for (let k = 200; k < 260; k++) {
    const turns = [1, 2].map((s) => ({ t: 'turn', s, k, c: [{ n: k % 5 }], y: [] }));
    for (const t of turns) { r.accept(t); fresh.accept(t); }
    assert.ok(r.step() && fresh.step());
    assert.equal(r.stateHash(), fresh.stateHash());
  }
});

test('the state hash leaves out decisions scheduled for later ticks', () => {
  const [a, b] = peers([1, 2]);
  assert.equal(a.ls.stateHash(), b.ls.stateHash());
  a.ls.hold(2, 30);
  assert.equal(a.ls.stateHash(), b.ls.stateHash(), 'not yet in effect: not in the hash');
  assert.notEqual(JSON.stringify(a.ls.snapshot().state.control), JSON.stringify(b.ls.snapshot().state.control), 'but in the snapshot');
});

test('the match stops at the game\'s result', () => {
  const ps = peers([1, 2], { endAt: 50 });
  run(ps, { ticks: 1000 });
  for (const p of ps) { assert.equal(p.ls.tick, 50); assert.ok(p.ls.done); assert.equal(p.ls.step(), false); }
});
