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

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// sha256 of every file: src/sim and src/ai as shipped by Phase 3 (commit
// 8649e39); src/data as split in Phase 5 (display fields removed, no value changed).
export const FROZEN = {
  "src/data/buildings.js": "0176c4b3f71568db3421a3f661c96fbf64b9b78d7d3d2f812770307c8b204ec8",
  "src/data/difficulty.js": "5edbe78a9ebb8172eed5c945f34732d549375eeb806df9265e684577b1a0ea6e",
  "src/data/map.js": "7ca9715b0b10d0d0a5659268c05bb7df451bda0306b21032a0fa5f13abc6436f",
  "src/data/strategies.js": "ce6e3cd4a084145f4ae7315103bf953ae76d6e6b5cfdc117aab6f966fe15e499",
  "src/data/units.js": "b401f86514666b40bd0a2f8b5b1ac664563a6f33be2869391763c747f36a3ca0",
  "src/sim/combat.js": "c4282da4b4b60ae110d42dd176c2eb41bb32f8c0ae8f29c9131fae9457a1764b",
  "src/sim/constants.js": "5b908c2299440ddc070608d52ebc5ee3ab663c5eca24fdb209bbc782bdc845cd",
  "src/sim/construction.js": "ab8038d3cc615af3d15960b06d9b90ae79ccb0a0d0dadf97dca3e42778fbb6dd",
  "src/sim/economy.js": "d3aba13d910b5063111e0f262d273407ed2e105c10c21128dcda6ad7e9522756",
  "src/sim/geometry.js": "15ee1ec57af7007c22ed774bdddf71647a22085dd89c00e30f269270d0f06d49",
  "src/sim/grid.js": "2aee3106845edb3f0fdeacc78a862a86f2f63eff8c68d2cceb9ec91290add5c1",
  "src/sim/movement.js": "185f9be83ad3169c919552e08dc331c4a1836fc8bd7b8f4405166d6947d4b6f5",
  "src/sim/orders.js": "e1a2790c0ae437911afa30e2149b642b4770ea195cdc4171c516ce77385e1ba0",
  "src/sim/pathfinder.js": "f1e25627fccdd409c630d18ae2013b39a4583f01fdbe7190bb4510e2c671dfa0",
  "src/sim/production.js": "8c4a4669e1f1e78eac4ed6a071da7f1f30c9cb4c0c515f659d27a6fda44bdba6",
  "src/sim/rng.js": "16b01e7963ce86441359bdea3b68f2b4479afbcc9ea3d1018ef4da36614d95f0",
  "src/sim/selection.js": "cf20075f76b5ac3023454f2392cab4f47b0ca50d8ef5f49b885c1e4e04abe3ef",
  "src/sim/spatial.js": "9c8ca85c581fcb61e63338d7c19c286018ea01410272dfd4ba0bd79be1b8334d",
  "src/sim/steering.js": "b89ec8a54093853a66b8a4e7b4902fda00a36694565a369fb256b31c8c34c57f",
  "src/sim/supply.js": "3dafb9550ca87e902d153392eb319697a6559fa6b84c05d75cee160e1f0d6824",
  "src/sim/victory.js": "ae0c086cf9d905e99bc48bd703b386e08b2921be1db24f719ce1203a9d613cc3",
  "src/sim/world.js": "b140a77b657c30453532527df5082b25744910b00554f77e025edef1c8315e8d",
  "src/ai/engine-types.js": "af5469d73733f3337336b5217b6a9186f1c3c0fd36e9623477c786b4f5b1c643",
  "src/ai/engine.js": "04c2e07cd49736969dbb9797ec07c9403efd56529ddf4182cba697f89e95bc69",
  "src/ai/match.js": "1bbc68ebbecdb720452be211e0cc3059d04cacca755f4908204adb4f788c2f54",
  "src/ai/readonly.js": "85d635a231882096209c77af1e34820ecae488fde5da79d390b5dfdee07850f7",
  "src/ai/scout.js": "fec0641a2a2114836b823d3f863ac7930b79a5f1ec3520588e0c4555db1eb29b"
};

test('src/sim and src/ai are byte-identical to Phase 3, src/data to its Phase 5 split', () => {
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
