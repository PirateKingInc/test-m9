// Phase 11: deterministic Math (PHASE11_SPEC.md "Determinism"). Accurate to
// the native functions within one unit in the last place, right on the special
// values, with a pinned hash of 4,000 exact results that every engine and peer
// must reproduce, and installed only on demand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sin, cos, atan, atan2, hypot, installDetMath, detMathInstalled } from '../src/net/detmath.js';
import { detMathFingerprint, GOLDEN } from '../src/net/detmath-golden.js';

const NATIVE = { sin: Math.sin, cos: Math.cos, atan: Math.atan, atan2: Math.atan2, hypot: Math.hypot };
const dv = new DataView(new ArrayBuffer(8));
const ulp = (x) => { dv.setFloat64(0, Math.abs(x)); dv.setBigUint64(0, dv.getBigUint64(0) + 1n); return dv.getFloat64(0) - Math.abs(x); };

test('within one ulp of the native functions over the ranges the sim uses', () => {
  let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const worst = { sin: 0, cos: 0, atan: 0, atan2: 0, hypot: 0 };
  for (let i = 0; i < 100000; i++) {
    const a = (rnd() * 2 - 1) * 20, y = (rnd() * 2 - 1) * 3000, x = (rnd() * 2 - 1) * 3000;
    for (const [n, f, args] of [['sin', sin, [a]], ['cos', cos, [a]], ['atan', atan, [y / (x || 1)]], ['atan2', atan2, [y, x]], ['hypot', hypot, [y, x]]]) {
      const d = f(...args), e = NATIVE[n](...args);
      worst[n] = Math.max(worst[n], Math.abs(d - e) / (ulp(e) || 5e-324));
    }
  }
  for (const [n, u] of Object.entries(worst)) assert.ok(u <= 1, `${n}: ${u} ulp`);
});

test('special values match the native functions, signs of zero included', () => {
  const same = (a, b) => Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b));
  const pairs = [[sin, 'sin', [[0], [-0], [NaN], [Infinity], [-Infinity]]], [cos, 'cos', [[0], [-0], [NaN], [Infinity]]],
    [atan2, 'atan2', [[0, 0], [-0, 0], [0, -0], [-0, -0], [1, 0], [-1, 0], [0, -1], [-0, -1], [Infinity, Infinity], [-Infinity, -Infinity], [Infinity, -Infinity], [1, Infinity], [1, -Infinity], [-1, -Infinity], [NaN, 1], [1, NaN]]],
    [hypot, 'hypot', [[0, 0], [-0, -0], [3, 4], [Infinity, NaN], [NaN, 1], [-3, 4], [1e300, 1e300], [1e-300, 1e-300]]]];
  for (const [f, n, cases] of pairs) for (const args of cases) assert.ok(same(f(...args), NATIVE[n](...args)), `${n}(${args}) = ${f(...args)}, native ${NATIVE[n](...args)}`);
  assert.equal(hypot(1, 2, 2), 3);
});

test('the exact bits of 4,000 results are pinned (every engine must match)', () => {
  assert.equal(detMathFingerprint(), 'cc6ed4f6');
  assert.equal(GOLDEN, 'cc6ed4f6');
});

test('installed only on demand, and removed again', () => {
  assert.equal(Math.sin, NATIVE.sin);
  const off = installDetMath();
  assert.ok(detMathInstalled());
  assert.equal(Math.hypot, hypot);
  const off2 = installDetMath(); // nested: stays until the last one is removed
  off();
  assert.ok(detMathInstalled());
  off2();
  assert.equal(Math.sin, NATIVE.sin);
  assert.equal(Math.hypot, NATIVE.hypot);
});
