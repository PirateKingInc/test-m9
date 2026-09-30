// AI fill-in (PHASE10_SPEC.md "AI fill-in"). Slot n plays camp n; at the start
// every empty slot becomes an AI camp playing FFA_STRATEGIES[n], exactly as
// single-player free-for-all fills camps 2-4. The result is the same
// `ffa.camps` table single-player passes to Match (src/game/main.js), so the
// match and the AI run unchanged.
import { FFA_STRATEGIES } from '../data/ffa.js';
import { LOBBY } from './config.js';

// slots: { 1: {uid, name}, 3: {...} } -> 'HAHA' (Human / AI per camp 1-4).
export function lineupOf(slots) {
  let s = '';
  for (let n = 1; n <= LOBBY.slots; n++) s += slots?.[n] ? 'H' : 'A';
  return s;
}

export const humansIn = (lineup) => [...lineup].filter((c) => c === 'H').length;

// 'HHAA', 'normal' -> { 3: { strategy: 'boom', difficulty: 'normal' }, 4: {...} }
export function campsFor(lineup, difficulty) {
  const camps = {};
  [...lineup].forEach((c, i) => {
    const team = i + 1;
    if (c === 'A') camps[team] = { strategy: FFA_STRATEGIES[team], difficulty };
  });
  return camps;
}
