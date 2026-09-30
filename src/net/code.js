// Match codes (PHASE10_SPEC.md "Match codes"): 6 characters from a 32-letter
// alphabet with no 0/O or 1/I, shown as ABC-DEF.
import { LOBBY } from './config.js';

const { alphabet, codeLength } = LOBBY;

// random(n) -> an array of n random bytes; crypto in the browser.
export function newCode(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return [...random(codeLength)].map((b) => alphabet[b % alphabet.length]).join(''); // 256 % 32 == 0: uniform
}

export const formatCode = (code) => `${code.slice(0, 3)}-${code.slice(3)}`;

// What a player typed -> { code } or { error } (nothing is sent for an error).
export function parseCode(input) {
  const s = String(input ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (!s) return { error: 'Enter the match code.' };
  const bad = [...new Set([...s].filter((ch) => !alphabet.includes(ch)))];
  if (bad.length) return { error: `Match codes never contain ${bad.join(', ')}. Check the code and try again.` };
  if (s.length !== codeLength) return { error: `A match code has ${codeLength} characters.` };
  return { code: s };
}

// A display name: trimmed, inner whitespace collapsed, 1-16 characters.
export function parseName(input) {
  const s = String(input ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return { error: 'Enter a name the other players will see.' };
  if ([...s].length > LOBBY.nameMax || s.length > LOBBY.nameMax) return { error: `Names are at most ${LOBBY.nameMax} characters.` };
  return { name: s };
}
