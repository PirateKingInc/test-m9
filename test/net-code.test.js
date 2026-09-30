// Phase 10: match codes and display names (PHASE10_SPEC.md "Match codes").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCode, parseCode, formatCode, parseName } from '../src/net/code.js';
import { LOBBY } from '../src/net/config.js';

test('codes: 6 characters, never 0, O, 1 or I, and every letter of the alphabet reachable', () => {
  assert.equal(LOBBY.alphabet.length, 32);
  for (const ch of '0O1I') assert.ok(!LOBBY.alphabet.includes(ch), ch);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const c = newCode();
    assert.match(c, /^[A-HJ-NP-Z2-9]{6}$/, 'the same pattern the security rules require');
    for (const ch of c) seen.add(ch);
  }
  assert.equal(seen.size, 32);
  assert.equal(newCode(() => [0, 31, 32, 255, 1, 2]), 'A9A9BC', 'bytes map uniformly (256 is a multiple of 32)');
});

test('typing a code is forgiving about case, spaces and the dash, and precise about the rest', () => {
  assert.deepEqual(parseCode('abc-def'), { code: 'ABCDEF' });
  assert.deepEqual(parseCode(' ab cd ef '), { code: 'ABCDEF' });
  assert.equal(formatCode('ABCDEF'), 'ABC-DEF');
  assert.match(parseCode('').error, /Enter/);
  assert.match(parseCode('ABC0EF').error, /never contain 0/);
  assert.match(parseCode('abcdIO').error, /never contain I, O/);
  assert.match(parseCode('ABCDE').error, /6 characters/);
  assert.match(parseCode('ABCDEFG').error, /6 characters/);
});

test('display names: trimmed, 1-16 characters', () => {
  assert.deepEqual(parseName('  Sir   Lancelot '), { name: 'Sir Lancelot' });
  assert.match(parseName('   ').error, /Enter/);
  assert.deepEqual(parseName('x'.repeat(16)), { name: 'x'.repeat(16) });
  assert.match(parseName('x'.repeat(17)).error, /at most 16/);
});
