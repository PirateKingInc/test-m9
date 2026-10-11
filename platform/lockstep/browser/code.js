// Match codes and display names. A code is `length` characters from an
// alphabet with no look-alikes (no 0/O, no 1/I by default), shown split in
// two halves (ABC-DEF). (From Dragonmarch Phase 10.)
export const CODE_DEFAULTS = Object.freeze({ alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', length: 6, nameMax: 16 });

export function createCodes({ alphabet = CODE_DEFAULTS.alphabet, length = CODE_DEFAULTS.length, nameMax = CODE_DEFAULTS.nameMax } = {}) {
  // random(n) -> an array of n random bytes; crypto in the browser. (With 32
  // letters, 256 % 32 == 0: every letter is equally likely.)
  const newCode = (random = (n) => crypto.getRandomValues(new Uint8Array(n))) => [...random(length)].map((b) => alphabet[b % alphabet.length]).join('');

  const half = Math.ceil(length / 2);
  const formatCode = (code) => `${code.slice(0, half)}-${code.slice(half)}`;

  // What a player typed -> { code } or { error } (nothing is sent for an error).
  function parseCode(input) {
    const s = String(input ?? '').toUpperCase().replace(/[\s-]/g, '');
    if (!s) return { error: 'Enter the match code.' };
    const bad = [...new Set([...s].filter((ch) => !alphabet.includes(ch)))];
    if (bad.length) return { error: `Match codes never contain ${bad.join(', ')}. Check the code and try again.` };
    if (s.length !== length) return { error: `A match code has ${length} characters.` };
    return { code: s };
  }

  // A display name: trimmed, inner whitespace collapsed, 1-nameMax characters.
  function parseName(input) {
    const s = String(input ?? '').trim().replace(/\s+/g, ' ');
    if (!s) return { error: 'Enter a name the other players will see.' };
    if ([...s].length > nameMax || s.length > nameMax) return { error: `Names are at most ${nameMax} characters.` };
    return { name: s };
  }

  return { alphabet, length, nameMax, newCode, formatCode, parseCode, parseName };
}
