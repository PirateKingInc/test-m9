// Phase 11 snapshots (PHASE11_SPEC.md "Snapshots and reconnection"): the RNG
// twin, exact round trips, and the real proof: a match restored from a
// snapshot taken mid-match plays out identically to the uninterrupted one, at
// every check, to its end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PF } from './helpers.js';
import { Match } from '../src/ai/match.js';
import { FFA_MAP, FFA_STRATEGIES } from '../src/data/ffa.js';
import { UNITS } from '../src/data/units.js';
import { createRng } from '../src/sim/rng.js';
import { SerialRng, adoptRng, adoptRngs, encode, decode, serialize, deserialize, hashState } from '../src/net/snapshot.js';

test('SerialRng is createRng: the same outputs, with its state in a field', () => {
  for (const seed of [1, 1337, 4242424242]) {
    const a = createRng(seed), b = new SerialRng(seed);
    for (let i = 0; i < 20000; i++) {
      assert.equal(b.next(), a.next());
      assert.equal(b.range(-3, 7), a.range(-3, 7));
      assert.equal(b.int(0, 9), a.int(0, 9));
    }
  }
});

test('adoptRng picks up a generator mid-sequence, wherever it is', () => {
  for (const used of [0, 1, 17, 5000]) {
    const orig = createRng(99), twin = createRng(99);
    for (let i = 0; i < used; i++) { orig.next(); twin.next(); }
    const adopted = adoptRng(orig, 99);
    for (let i = 0; i < 100; i++) assert.equal(adopted.next(), twin.next(), `after ${used} draws`);
  }
});

test('round trip: exact numbers, undefined, Map, Set, typed arrays, shared references and cycles', () => {
  const shared = { n: 1 };
  const v = { a: -0, b: NaN, c: Infinity, d: -Infinity, e: undefined, f: 0.1 + 0.2, g: new Map([[3, shared], ['k', [shared]]]),
    h: new Set([1, 'x', shared]), i: new Int32Array([1, -2, 3]), j: new Uint8Array([255, 0]), s: shared };
  v.self = v;
  const r = deserialize(serialize(v));
  assert.ok(Object.is(r.a, -0) && Number.isNaN(r.b) && r.c === Infinity && r.d === -Infinity);
  assert.ok('e' in r && r.e === undefined, 'undefined kept, key and all');
  assert.equal(r.f, 0.1 + 0.2);
  assert.equal(r.g.get(3), r.s, 'shared references stay shared');
  assert.equal(r.g.get('k')[0], r.s);
  assert.ok(r.h.has(r.s) && r.h.has('x'));
  assert.deepEqual([...r.i], [1, -2, 3]);
  assert.ok(r.i instanceof Int32Array && r.j instanceof Uint8Array);
  assert.equal(r.self, r, 'cycles');
  assert.deepEqual(Object.keys(r), Object.keys(v), 'key order kept');
});

test('refuses what it cannot restore exactly', () => {
  class Unknown {}
  assert.throws(() => encode({ x: new Unknown() }), /unregistered class Unknown/);
  assert.throws(() => encode({ f: () => 1 }), /function in state/);
});

test('static game data is referenced, not copied', () => {
  const m = adoptRngs(new Match({ seed: 1, PF, ffa: { map: FFA_MAP, camps: { 3: { strategy: 'boom', difficulty: 'hard' } } } }), 1);
  const r = decode(encode(m), { PF });
  assert.equal(r.world.map, FFA_MAP);
  assert.equal(r.brains[0].s, m.brains[0].s, 'strategy tables are the same objects');
  assert.ok(Object.values(UNITS).length > 0);
});

// The real proof: interrupt a match with a snapshot, restore it, and let both
// play on. Every 400 ticks and at the end, the two must be identical.
function playOn(original, restored, ticks) {
  for (let i = 1; i <= ticks && !original.world.result; i++) {
    original.step(); restored.step();
    if (i % 400 === 0 || original.world.result) assert.equal(hashState(restored), hashState(original), `diverged by tick ${original.world.tick}`);
  }
}

const camps = Object.fromEntries(Object.entries(FFA_STRATEGIES).map(([t, s]) => [t, { strategy: s, difficulty: 'hard' }]));
for (const [seed, at] of [[1, 1200], [2, 5000], [4, 9000]]) {
  test(`free-for-all seed ${seed}: restored at tick ${at}, identical to the uninterrupted match to its end`, () => {
    const m = adoptRngs(new Match({ seed, PF, ffa: { map: FFA_MAP, camps }, player: { strategy: 'boom', difficulty: 'hard' } }), seed);
    for (let i = 0; i < at; i++) m.step();
    const text = serialize(m);
    const r = deserialize(text, { PF });
    assert.equal(hashState(r), hashState(m), 'identical on restore');
    playOn(m, r, 40000);
    assert.ok(m.world.result && r.world.result, 'both reached the result');
    assert.deepEqual(r.world.result, m.world.result);
    console.log(`# seed ${seed}: snapshot at tick ${at} (${(text.length / 1024).toFixed(0)} KB), both ended at tick ${m.world.tick}, ${m.world.result.reason}`);
  });
}

test('1v1 (Phase 3 seed 1, rush vs boom): restored at tick 3000, identical to the end', () => {
  const m = adoptRngs(new Match({ seed: 1, PF, player: { strategy: 'rush', difficulty: 'hard' }, ai: { strategy: 'boom', difficulty: 'hard' } }), 1);
  for (let i = 0; i < 3000; i++) m.step();
  const r = deserialize(serialize(m), { PF });
  playOn(m, r, 40000);
  assert.deepEqual(r.world.result, m.world.result);
});
