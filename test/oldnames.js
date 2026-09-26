// The Phase 1-4 player-facing names (PHASE5_SPEC.md "Naming"). Phase 5 made
// them internal only: none may reach the player. Shared by the static scan
// (test/oldnames.test.js) and the in-browser scan (e2e/oldnames.spec.js).
// Proper names are matched case-sensitively (so "an early rush" in prose is
// fine); the generic words (lumen, crystal, prism, outpost, depot, test
// target) in any case.
const PROPER = /\b(Drones?|Strikers?|Sparkers?|Bulwarks?|Lancers?|Command Cores?|Foundr(?:y|ies)|Spires?|Rush|Economy-Boom|Turtle-and-Tech)\b/;
const GENERIC = /\b(lumen|crystals?|prism|outpost|depots?|test targets?)\b/i;

// The old names found in a piece of player-facing text.
export function oldNamesIn(text) {
  const out = [];
  for (const re of [PROPER, GENERIC]) {
    const g = new RegExp(re.source, re.flags.includes('i') ? 'gi' : 'g');
    for (const m of text.matchAll(g)) out.push(m[0]);
  }
  return out;
}
