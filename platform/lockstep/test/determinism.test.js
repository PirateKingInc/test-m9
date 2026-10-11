// The module's determinism helpers, with no game at all: the codec's exact
// round trips and refusals, the seeded RNG, the state hash, and the
// deterministic-Math fingerprint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCodec, hashText, SeededRng, installDetMath, detMathInstalled, detMathFingerprint, DETMATH_GOLDEN, sin } from '../index.js';

test('codec round trip: exact numbers, undefined, Map, Set, typed arrays, shared references and cycles', () => {
  const { serialize, deserialize } = createCodec();
  const shared = { n: 1 };
  const v = { a: -0, b: NaN, c: Infinity, d: -Infinity, e: undefined, f: 0.1 + 0.2, g: new Map([[3, shared], ['k', [shared]]]),
    h: new Set([1, 'x', shared]), i: new Int32Array([1, -2, 3]), j: new Float64Array([0.5, -0]), s: shared };
  v.self = v;
  const r = deserialize(serialize(v));
  assert.ok(Object.is(r.a, -0) && Number.isNaN(r.b) && r.c === Infinity && r.d === -Infinity);
  assert.ok('e' in r && r.e === undefined);
  assert.equal(r.f, 0.1 + 0.2);
  assert.equal(r.g.get(3), r.s, 'shared references stay shared');
  assert.ok(r.h.has(r.s) && r.h.has('x'));
  assert.ok(r.i instanceof Int32Array && r.j instanceof Float64Array && Object.is(r.j[1], -0));
  assert.equal(r.self, r, 'cycles');
  assert.deepEqual(Object.keys(r), Object.keys(v), 'key order kept');
});

test('codec: registered classes come back as instances, skipped fields are rebuilt by fixups with the context', () => {
  class Board { constructor(n) { this.cells = new Array(n).fill(0); this.cache = new Map(); this.lib = null; } sum() { return this.cells.reduce((a, b) => a + b, 0); } }
  const codec = createCodec({ classes: { Board }, skip: { Board: ['cache', 'lib'] }, fixups: { Board(b, ctx) { b.cache = new Map(); b.lib = ctx.lib; } } });
  const b = new Board(4); b.cells[2] = 7; b.cache.set('x', 1);
  const r = codec.deserialize(codec.serialize({ b }), { lib: 'LIB' }).b;
  assert.ok(r instanceof Board);
  assert.equal(r.sum(), 7);
  assert.equal(r.cache.size, 0, 'the cache is not state');
  assert.equal(r.lib, 'LIB', 'the context reaches the fixup');
});

test('codec: constant data is written by reference, not copied', () => {
  const RULES = { pieces: { king: { moves: 1 } } };
  const codec = createCodec({ constants: { rules: { RULES } } });
  const state = { mine: RULES.pieces.king };
  const text = codec.serialize(state);
  assert.match(text, /rules\.RULES\.pieces\.king/);
  assert.equal(codec.deserialize(text).mine, RULES.pieces.king);
});

test('codec: refuses what it cannot restore exactly', () => {
  class Unknown {}
  const { encode, decode } = createCodec();
  assert.throws(() => encode({ x: new Unknown() }), /unregistered class Unknown/);
  assert.throws(() => encode({ f: () => 1 }), /function in state/);
  assert.throws(() => decode({ $x: 'nope' }), /unknown data/);
  assert.throws(() => decode({ $i: 1, $c: 'Nope', $o: {} }), /unknown class/);
});

test('two codecs are independent: registering in one does not leak into the other', () => {
  class A {}
  const one = createCodec({ classes: { A } }), two = createCodec();
  assert.doesNotThrow(() => one.encode(new A()));
  assert.throws(() => two.encode(new A()), /unregistered class A/);
});

test('hashText: 16 hex digits, stable, sensitive to every character', () => {
  assert.match(hashText('abc'), /^[0-9a-f]{16}$/);
  assert.equal(hashText('abc'), hashText('abc'));
  assert.notEqual(hashText('abc'), hashText('abd'));
  assert.notEqual(hashText('ab'), hashText('ba'));
});

test('SeededRng: deterministic, restorable from its one field, ranges in bounds', () => {
  const a = new SeededRng(42), b = new SeededRng(42);
  for (let i = 0; i < 1000; i++) assert.equal(a.next(), b.next());
  const copy = new SeededRng(a.s);
  for (let i = 0; i < 1000; i++) assert.equal(copy.next(), a.next());
  for (let i = 0; i < 1000; i++) { const n = a.int(-2, 3); assert.ok(n >= -2 && n <= 3 && Number.isInteger(n)); const r = a.range(5, 6); assert.ok(r >= 5 && r < 6); }
  const { serialize, deserialize } = createCodec({ classes: { SeededRng } });
  const r = deserialize(serialize({ r: a })).r;
  assert.equal(r.next(), a.next(), 'it survives a snapshot');
});

test('deterministic Math: the golden fingerprint, and install/uninstall nest', () => {
  assert.equal(detMathFingerprint(), DETMATH_GOLDEN);
  const native = Math.sin;
  const off1 = installDetMath(), off2 = installDetMath();
  assert.equal(Math.sin, sin);
  assert.ok(detMathInstalled());
  off1(); off1();
  assert.equal(Math.sin, sin, 'still installed while one install is live');
  off2();
  assert.equal(Math.sin, native);
});
