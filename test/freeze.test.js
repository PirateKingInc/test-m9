// Freeze guard. Phase 4 and Phase 5 are controls, visuals and names only: the
// sim, the AI and every gameplay number must stay as the Phase 3 release
// shipped them, and fixed-seed matches (positions, HP, orders: collision,
// pathing and hit detection) must play out exactly as they did.
//
// Phase 5 moved display text (names, roles, descriptions) out of src/data into
// src/theme (PHASE5_SPEC.md "Display text and gameplay data"). The guard now has
// three locks: src/sim and src/ai byte-identical to Phase 3; src/data
// byte-identical to its split form; and a canonical hash of every gameplay
// value in src/data, recorded on the Phase 4 release *before* the split, so the
// split provably moved no number and re-pinning file hashes cannot hide a change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { PF, makeWorld } from './helpers.js';
import { Match } from '../src/ai/match.js';
import { SandboxBot } from '../src/ai/engine.js';
import { gameplayHash } from './gameplay-values.js';
import { FFA_MAP, FFA_STRATEGIES } from '../src/data/ffa.js';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// sha256 of every file. src/data: as split in Phase 5 (display fields removed,
// no value changed). src/sim and src/ai: byte-identical to Phase 3 until Phase
// 6, which had to change them for N teams; they are re-pinned to the Phase 6
// refactor, so any later change is deliberate. The proof that the refactor
// changed no behaviour is the fingerprints below, not these pins.
//
// Phase 12 re-pins pathfinder.js, movement.js and steering.js for speed at
// high supply caps (PHASE12_SPEC.md "Results"): a reset of only the nodes a
// search touched, allocation-free clearance and standing checks, numeric
// separation keys, and a per-tick budget of route searches (96) that normal
// play at the Phase 11 scale never reaches (peak 90). Every fingerprint below
// is unchanged by them, and test/path-budget.test.js checks the routes
// against a fresh grid query by query.
export const FROZEN = {
  "src/data/buildings.js": "0176c4b3f71568db3421a3f661c96fbf64b9b78d7d3d2f812770307c8b204ec8",
  "src/data/camp-rules.js": "eaba6b6ba317c1a0a1027eedb46a1888ca23b860bce20b49cf2a8618406049da",
  "src/data/difficulty.js": "5edbe78a9ebb8172eed5c945f34732d549375eeb806df9265e684577b1a0ea6e",
  "src/data/ffa.js": "aae3f1f3cef2a7e34f8b923414f643189ffb44872e105f25b9d9d30a021877df",
  "src/data/map.js": "7ca9715b0b10d0d0a5659268c05bb7df451bda0306b21032a0fa5f13abc6436f",
  "src/data/rivals.js": "54c99cdb2916999bc23ec81d33a8438d9db58915afa7ef7fb73e0a43032ac905",
  "src/data/strategies.js": "ce6e3cd4a084145f4ae7315103bf953ae76d6e6b5cfdc117aab6f966fe15e499",
  "src/data/units.js": "b401f86514666b40bd0a2f8b5b1ac664563a6f33be2869391763c747f36a3ca0",
  "src/sim/combat.js": "75bdaad3d784746da47791b0e2fb8a16a3413db6550ac5436dd10357356a830a",
  "src/sim/constants.js": "5b908c2299440ddc070608d52ebc5ee3ab663c5eca24fdb209bbc782bdc845cd",
  "src/sim/construction.js": "1acee32ecc2a8a519407927c239ad16ebf3a5f8e528a4d37b749dc9a8b701bbf",
  "src/sim/defense.js": "516e85ef4ffd7dad3151afb05278e527fb0eb6d632f22663c6dd9129a83cfa7a",
  "src/sim/economy.js": "d3aba13d910b5063111e0f262d273407ed2e105c10c21128dcda6ad7e9522756",
  "src/sim/geometry.js": "15ee1ec57af7007c22ed774bdddf71647a22085dd89c00e30f269270d0f06d49",
  "src/sim/grid.js": "f990df96f1d979bf2302f8d5567e8aed7fa9148e5e6411144c7b91cb66b137c9",
  "src/sim/hopeless.js": "6b6f232c23bef7d7a065ca700d20de21b129026b1c7767c4c819cc3ddcfd7f8b",
  "src/sim/movement.js": "9a9357576e795e6e7cae5bb1f2672ba56a81086c4a1820835a3ace1a761cff34",
  "src/sim/orders.js": "e1a2790c0ae437911afa30e2149b642b4770ea195cdc4171c516ce77385e1ba0",
  "src/sim/pathfinder.js": "238fcbac8aa26f8aa83eade1e5859bf0a7fb5913097dd88b623a938d47338bf9",
  "src/sim/production.js": "4a4d10ec7300e92407a80a5ee2a8c975dc749b8a87b0b9300cb9911864e9f578",
  "src/sim/rng.js": "16b01e7963ce86441359bdea3b68f2b4479afbcc9ea3d1018ef4da36614d95f0",
  "src/sim/selection.js": "cf20075f76b5ac3023454f2392cab4f47b0ca50d8ef5f49b885c1e4e04abe3ef",
  "src/sim/spatial.js": "9c8ca85c581fcb61e63338d7c19c286018ea01410272dfd4ba0bd79be1b8334d",
  "src/sim/steering.js": "74f783e5696a230fca9faa386aa6f3a513a34144d8a1355f612e7b6dab8870e1",
  "src/sim/supply.js": "3dafb9550ca87e902d153392eb319697a6559fa6b84c05d75cee160e1f0d6824",
  "src/sim/territory.js": "fee37dd402325984869d955157822817e35388881dc1ef3962a13f2ad7f49d4a",
  "src/sim/victory.js": "7361a2180bd9485a989352eac8ca7f40d6b6ddd369f057a32ba48fd1fa4301e1",
  "src/sim/world.js": "8ed7678c152ccbe3287977b8466167b3d400ff2361caf8ef9503df0dee2b6073",
  "src/ai/engine-types.js": "af5469d73733f3337336b5217b6a9186f1c3c0fd36e9623477c786b4f5b1c643",
  "src/ai/engine.js": "4066de8ee3929528059f84ce8b20b1d83cc06f9b7f35c8ecef7e7e14a4936357",
  "src/ai/match.js": "c833058cc4533c4e947693dfaf25602c02b16b24772b21d2f2c6a57565747442",
  "src/ai/readonly.js": "85d635a231882096209c77af1e34820ecae488fde5da79d390b5dfdee07850f7",
  "src/ai/rivals.js": "f23a6d6da53c7edb400983396f9894bba876c0a0179b8fe5f2247b74dc7d30ec",
  "src/ai/scout.js": "c180f32a0f13c5ce55541790b0ec578f3970a0664270198c11e5428a17c83368"
};

test('src/data is byte-identical to its Phase 5 split; src/sim and src/ai to their pinned Phase 6 state', () => {
  const now = {};
  for (const dir of ['data', 'sim', 'ai']) {
    const url = new URL(`../src/${dir}/`, import.meta.url);
    for (const f of readdirSync(url).sort()) now[`src/${dir}/${f}`] = sha(readFileSync(new URL(f, url)));
  }
  assert.deepEqual(Object.keys(now).sort(), Object.keys(FROZEN).sort(), 'no files added or removed');
  for (const [f, h] of Object.entries(FROZEN)) assert.equal(now[f], h, `${f} changed`);
});

// Canonical gameplay values of src/data (test/gameplay-values.js), recorded on
// the Phase 4 release (commit f08f2d8) before the Phase 5 split.
export const GAMEPLAY_HASH = '9fd621ee00b78dd2e7123d0492c21ba28d79c1e80cf0b60046ad1f92a0f11900';

test('every gameplay value in src/data is unchanged from the Phase 4 release', () => {
  assert.equal(gameplayHash(), GAMEPLAY_HASH);
});

// A fingerprint of everything collision and combat touch: positions, HP, orders.
function fingerprint(world) {
  const parts = [];
  for (const kind of ['unit', 'building', 'node']) {
    for (const e of world.ofKind(kind)) parts.push(`${e.id}:${e.type}:${e.team}:${e.x.toFixed(3)},${e.y.toFixed(3)}:${(e.hp ?? e.amount ?? 0).toFixed(3)}:${e.order?.type ?? ''}`);
  }
  parts.push(`t=${world.tick}`, `r=${JSON.stringify(world.resources)}`);
  return sha(parts.join('|')).slice(0, 16);
}

export function fingerprints() {
  const out = {};
  const w = makeWorld({ seed: 2024 });
  const bot = new SandboxBot(w);
  for (let t = 0; t < 400 * 20; t++) { if (t % 10 === 0) bot.think(); w.step(); }
  out.sandboxBot = fingerprint(w);
  for (const [a, b, tier, seed] of [['rush', 'boom', 'hard', 1], ['turtle', 'rush', 'normal', 2], ['boom', 'turtle', 'easy', 3]]) {
    const m = new Match({ seed, PF, player: { strategy: a, difficulty: tier }, ai: { strategy: b, difficulty: tier } });
    for (let i = 0; i < 300 * 20 && !m.world.result; i++) m.step();
    out[`${a}-${b}-${tier}-${seed}`] = fingerprint(m.world);
  }
  return out;
}

// Recorded on the Phase 3 release.
export const GOLDEN = {
  sandboxBot: '109126657f0ba006',
  'rush-boom-hard-1': 'bf6f9c44c89a7af7',
  'turtle-rush-normal-2': 'aa2d62efa10a9089',
  'boom-turtle-easy-3': '2aa5e3de88611963',
};

test('fixed-seed games play out exactly as in Phase 3 and 4 (collision, pathing, combat)', () => {
  assert.deepEqual(fingerprints(), GOLDEN);
});

// Phase 6 equivalence proof. The sim and the AI were refactored from two teams
// to a list of N teams (PHASE6_SPEC.md "Team model"). These fingerprints were
// recorded on the Phase 5 release (commit 1b1a22b) *before* that refactor: all
// nine ordered strategy pairs across the three tiers, each played to its
// result, the browser's AI-only match, and a match decided at the time limit.
// The 1v1 match now runs through the N-team code and must reproduce every one:
// the final state of every entity, the tick, both stockpiles and the result.
function toResult(m) {
  while (!m.world.result) m.step();
  const r = m.world.result;
  return `${fingerprint(m.world)} ${r.winner}/${r.reason}/${r.time.toFixed(2)}`;
}

export function phase5Fingerprints() {
  const out = {};
  const S = ['rush', 'boom', 'turtle'], T = ['easy', 'normal', 'hard'];
  let i = 0;
  for (const a of S) for (const b of S) {
    const tier = T[i % 3], seed = 11 + i++;
    const m = new Match({ seed, PF, player: { strategy: a, difficulty: tier }, ai: { strategy: b, difficulty: tier } });
    out[`${a}-${b}-${tier}-${seed}`] = `${toResult(m)} ${JSON.stringify(m.world.result.scores)}`;
  }
  out['idlePlayer-rush-hard-5'] = toResult(new Match({ seed: 5, PF, ai: { strategy: 'rush', difficulty: 'hard' } }));
  const tl = new Match({ seed: 7, PF, player: { strategy: 'sentinel', difficulty: 'hard' }, ai: { strategy: 'sentinel', difficulty: 'normal' } });
  out['sentinel-sentinel-timeLimit-7'] = `${toResult(tl)} ${JSON.stringify(tl.world.result.scores)}`;
  return out;
}

export const GOLDEN_PHASE5 = {
  'rush-rush-easy-11': '36ee13c7915dbf76 2/core-destroyed/915.20 {"1":9564,"2":9271}',
  'rush-boom-normal-12': 'b6ab9dff57239767 2/core-destroyed/691.55 {"1":2746,"2":5489}',
  'rush-turtle-hard-13': '8759eeaa974aa053 1/core-destroyed/470.25 {"1":4694,"2":997}',
  'boom-rush-easy-14': '8c7ca4cd9b9c6c35 1/core-destroyed/896.75 {"1":11200,"2":7602}',
  'boom-boom-normal-15': 'b57d573828ee00bf 2/core-destroyed/438.30 {"1":5960,"2":6678}',
  'boom-turtle-hard-16': '8ff6d9169fa5e6bd 2/core-destroyed/423.45 {"1":3926,"2":5733}',
  'turtle-rush-easy-17': 'fe90e7f6d0fb833f 1/core-destroyed/490.55 {"1":5645,"2":3358}',
  'turtle-boom-normal-18': '39f1e6649c9cc51e 2/core-destroyed/611.40 {"1":2424,"2":10270}',
  'turtle-turtle-hard-19': 'd9e78765b7e09afc 2/core-destroyed/512.45 {"1":1456,"2":6089}',
  'idlePlayer-rush-hard-5': '3af1e255e21bf12a 2/core-destroyed/267.45',
  'sentinel-sentinel-timeLimit-7': '0338b34329f588de 1/time-limit/1800.05 {"1":13430,"2":12946}',
};

test('Phase 6 equivalence: 1v1 matches through the N-team code reproduce Phase 5 exactly', () => {
  assert.deepEqual(phase5Fingerprints(), GOLDEN_PHASE5);
});

// Phase 7 equivalence proof (PHASE7_SPEC.md "What stays the same"). The new
// multi-rival targeting only decides where armies go; the strategies' build
// and train logic and the economy are untouched. The free-for-all's
// production log (every build and train order every camp issued, with its
// tick) was recorded on the Phase 6 release (commit b1a9c0c), before any
// Phase 7 change, for three seeds over the first 10 minutes. With the Phase 6
// placeholder targeting switched back on (`targeting: 'nearest'`), the Phase 7
// engine must reproduce every order at the same tick.
export function ffaProductionLogs({ targeting = 'nearest', until = 600, mirrorY = true, phase9 = true } = {}) {
  const out = {};
  for (const seed of [1, 2, 3]) {
    const camps = Object.fromEntries(Object.entries(FFA_STRATEGIES).map(([t, s]) => [t, { strategy: s, difficulty: 'hard', targeting }]));
    const m = new Match({ seed, PF, ffa: { map: FFA_MAP, camps }, player: { strategy: 'boom', difficulty: 'hard', targeting } });
    m.world.grid.mirrorY = mirrorY; // false: without Phase 8's north-south mirrored tie-breaks
    if (!phase9) m.world.autoDefend = m.world.hopelessCheck = false; // without Phase 9's camp rules
    const log = [];
    for (const b of m.brains) {
      const orig = b.issueFn;
      b.issueFn = (cmd) => {
        const r = orig(cmd);
        if (r.ok && (cmd.type === 'build' || cmd.type === 'train')) log.push(`${m.world.tick}:${cmd.team}:${cmd.type}:${cmd.building}:${cmd.unit ?? ''}`);
        return r;
      };
    }
    while (m.world.time < until && !m.world.result) m.step();
    out[`seed${seed}-${until}s`] = `${createHash('sha256').update(log.join('|')).digest('hex').slice(0, 16)} (${log.length} build/train orders)`;
  }
  return out;
}

export const GOLDEN_PHASE6_FFA = {
  'seed1-600s': '4f4318ddf6ec1937 (450 build/train orders)',
  'seed2-600s': 'd929da210827d0d8 (423 build/train orders)',
  'seed3-600s': 'c24196fc992e9861 (515 build/train orders)',
};

test('Phase 7 equivalence: with placeholder targeting, the free-for-all builds and trains exactly as in Phase 6', () => {
  // Phase 8 changed the free-for-all's pathing (north-south mirrored
  // tie-breaks, PHASE8_SPEC.md "Pathfinding symmetry"). With exactly that
  // switched off, every order still lands on the same tick as in Phase 6.
  assert.deepEqual(ffaProductionLogs({ mirrorY: false, phase9: false }), GOLDEN_PHASE6_FFA);
});

// Phase 8 gate (PHASE8_SPEC.md "Pathfinding symmetry"): the same production
// logs with the north-south mirrored tie-breaks on (pathfinding, spiral,
// approach tile, spawn corner and separation order), recorded before any
// Phase 8 balance change. (With placeholder targeting, Phase 8's AI changes
// are off, so only the symmetry fix moves this log.) The 1v1 fingerprints above are
// untouched by the fix (the 1v1 map is not mirrored north-south).
export const GOLDEN_PHASE8_FFA = {
  'seed1-600s': 'ed06bd6d3f1e3144 (440 build/train orders)',
  'seed2-600s': '3df41df5e3e29dc2 (529 build/train orders)',
  'seed3-600s': '92297db501e93762 (471 build/train orders)',
};

test('Phase 8 equivalence: the free-for-all with the pathfinding fix builds and trains as pinned', () => {
  // With Phase 9's camp rules (auto-defend, hopeless camps) switched off.
  assert.deepEqual(ffaProductionLogs({ phase9: false }), GOLDEN_PHASE8_FFA);
});

// Phase 9 (PHASE9_SPEC.md): the same log with the camp rules on. Auto-defend
// is a real combat change in the free-for-all, so this log moves; the 1v1
// has no zones and its fingerprints above do not.
export const GOLDEN_PHASE9_FFA = {
  'seed1-600s': '02cba90ea9f830a7 (467 build/train orders)',
  'seed2-600s': '6a95f780de4c515b (539 build/train orders)',
  'seed3-600s': 'cb407a258047be60 (539 build/train orders)',
};

test('Phase 9 equivalence: the free-for-all with auto-defend and hopeless camps builds and trains as pinned', () => {
  assert.deepEqual(ffaProductionLogs(), GOLDEN_PHASE9_FFA);
});
