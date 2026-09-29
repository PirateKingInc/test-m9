# Backlog

Ideas that came up and were **not** built. Each one is tagged with the phase
it belongs to. The out-of-scope list in PROJECT.md always wins, and nothing
here may bring back fog of war, extra factions, more than 2 tech tiers,
multiplayer, extra maps or adaptive AI.

## Phase 2: Scripted AI opponent (done)

These shipped in Phase 2: win/lose on the Command Core, the mirrored east start,
the population cap, AI scouting, the scripted AI grown from `test/bot.js`,
under-attack notifications, and the Ctrl+1–8 control-group fix. The ideas below
were not built, so they move to Phase 3.

## Phase 3: Balance & polish (done)

These shipped in Phase 3:
* the strategy-vs-strategy batch runner (`tools/balance.mjs`) and a tuned
  strategy matrix (see BALANCE.md)
* the side-bias root-cause fix
* AI expansion to the middle fields and attacks on the scouted Core
* per-tier execution handicaps (a Foundry cap)
* the audio pass, visual juice, result-screen stats, tooltips and the
  first-run tutorial

## Phase 4: Mobile & art (done)

These shipped in Phase 4:
* touch controls alongside the unchanged mouse and keyboard (the action bar,
  tap, double-tap, Box, drag-pan, pinch-zoom and group hold)
* sprite art drawn in code: units, buildings in three construction states,
  crystals and terrain
* a visual reference sheet
* a tutorial for each input mode, what-you-can-do hints and phone layouts

## Phase 5: Fantasy reskin & zoom (done)

These shipped in Phase 5:
* the knights-and-dragons reskin: every name, description and sprite (see
  PHASE5_SPEC.md), with the display text split out of `src/data` into
  `src/theme` and a freeze guard that hashes gameplay values
* the zoom range down to 0.35x, measured so a whole base fits a phone in
  landscape, and mouse-wheel zoom on desktop (the `[P4]` wheel-zoom item)
* the title screen with a code-drawn dragon emblem, and the medieval UI look

## Phase 6: Free-for-all foundation (done)

These shipped in Phase 6:
* the N-team sim and AI, proven equivalent on the 1v1 match by fingerprints
* a four-camp free-for-all map with measured spacing, zones and territory
* elimination with capture of gold and land, last-camp-standing and a
  time-limit ranking
* four team colours, the territory overlay and the free-for-all HUD
* no more native double-tap-to-zoom on phones

## Post-project (not scheduled)

The project's phases are complete. These ideas were deliberately not
built. They are tagged `[P3]` because they were raised in, or deferred to,
Phase 3.

- [P3] **Uniform balance at Hard.** At Hard timing, Turtle beats Rush about 80% of the time (81% pooled over 200 seeds; see BALANCE.md). The Foundry cap also leaves Turtle beating Rush at Easy and Normal. Three strategies form a rock-paper-scissors triangle: across several tuning passes, fixing that cell reliably broke another. Fixing it for real likely needs a new lever, such as Sparker kiting or AI micro, or a fourth strategy, not more tuning of the same numbers.
- [P3] **Real GPU frame-rate measurement.** CI and the dev container only have headless software GL (about 12 fps with 40 units). The sim and render budgets are measured per step and per frame instead. This is a known, accepted limitation of the environment.
- [P3] Kiting micro for Sparkers (step back while reloading). This changes the Striker-vs-Sparker counter, so retest it.
- [P3] Minimap with click-to-jump and alert pings. Space jumps to the last attack for now.
- [P3] Hold-position and patrol commands for players and the Turtle AI.
- [P3] Drones auto-flee or retaliate when attacked while gathering.
- [P3] AI micro: focus fire, pulling damaged units back, and Spire-aware pathing when attacking.
- [P3] Settings panel (volume slider, edge-scroll toggle) and full key rebinding. Shift+digit, the HUD group bar and fullscreen Keyboard Lock cover the Ctrl+1–8 conflict.
- [P3] Save/restore sandbox state (JSON snapshot of `World`).
- [P3] Flow-field pathfinding if unit counts ever go far beyond 40.
- [P3] Shift-queued waypoints/commands (command queueing).
- [P3] Optional second tech tier (the hard cap is 2): e.g. an upgrade building that unlocks armor/damage upgrades.
- [P4] Building damage states and animated construction. Phase 4 draws three construction states; there's no damage look yet.
- [P3] Accessibility: colorblind-safe team palettes and bigger UI scale.
- [P3] Building rotation/footprint variety.
- [P3] Smarter formation slot assignment when a move target straddles an obstacle.
- [P4] **Real-device testing.** Phase 4's touch controls are verified in Playwright/Chromium mobile emulation (CDP touch events), not on physical phones. Open questions:
  - how iOS Safari handles gestures on the canvas
  - whether the tap sizes feel right to real fingers
  - how the notch and safe areas affect the layout
  - frame rate on real GPUs (also see "Real GPU frame-rate measurement")
- [P4] Build orders pull every selected Drone off mining, and they stay idle afterwards. A Drone can also be reassigned away from an unfinished site, stalling it. Both are sim rules, frozen in Phase 4. On a phone they're the first friction a new player hits: mobile playtests and the tutorial test both ran into them. A future change could send builders back to their crystal.
- [P4] Landscape phones show group slots 1–6 only; slots 7–9 are hidden to fit the bottom panel. Portrait shows all nine.
- [P3] Polish items from issue #59 that were not built: audio cues for supply-blocked, scout reports and wave-launched (the under-attack alarm exists); an on-building construction-progress ring and production-complete flash; a rally-point marker; an on-building queue progress bar (the HUD queue has one).
- [P4] **Mobile difficulty.** The scripted touch player in the mobile playthrough (`e2e/mobile-playthrough.spec.js`) usually loses to the Easy AI. The test proves touch can play a whole match, not that a touch player can win one. Whether Easy is too hard on a phone (slower orders, a smaller view) needs real players; Phase 5 left it as is, on purpose.
- [P5] **Medieval sound pass.** Phase 5 reskinned names and art only; the synthesized sounds are the Phase 3 set (a zap for arrows, a whine for dragonfire). A pass with a bowstring twang, a fire roar, hooves and a horn would match the theme.
- [P5] Animated sprites: walking legs and hooves, beating dragon wings, flags that wave. Units are single rotated sprites.
- [P5] The design docs (SPEC.md, BALANCE.md, PROJECT.md and the Phase 2-4 specs) still use the internal codenames; README.md has the mapping table. Renaming them would touch every table the tests cross-check against the data.
- [P5] Zoomed right out (0.35x), buildings and gold mines are small; a simplified far-zoom icon set (or a minimap) would help on phones.
- [P7] **Real multi-rival AI targeting.** Phase 6's AI camps use a deliberate placeholder: attack the nearest living rival camp (`AiEngine.targetCamp()`). Phase 7 should weigh each rival's strength, threat and distance, pile on a weakened camp, avoid being the third party that softens a target for someone else, and defend against two attackers at once.
- [P7] AI awareness of territory: take and hold zones on purpose (today zones change hands only as a side effect of expansions and waves), and value a rival's banked gold and land as loot when choosing a target.
- [P8] **N-way balance.** No tuning was done for four camps: seed 1 at Hard ends with Rose (Merchant Kingdom) last standing at 13 minutes, and the idle-player browser match loses its Castle to Jade's first wave at about 7 minutes. Strategy strength, the camp-to-strategy assignment and the 30:00 limit all need measuring for four camps, as Phase 3 did for two.
- [P8] Side symmetry for four camps: the pathfinder's mirror frame is east-west only (Phase 3), so tie-breaks are not mirrored north-south; the NE-SE army round trip is 2.5 s longer than NW-SW.
- [P6] **Capturing intact enemy structures.** Buildings of an eliminated camp are razed; taking them over (and turning surviving units) was out of scope.
- [P6] Spectating after your camp falls: the match runs on, but there is no camp-follow camera, speed-up or skip to the result.
- [P6] Zone income or upkeep: owning land only matters for loot and the time-limit ranking; a per-zone bonus could make territory matter during the match.
- [P6] More than four camps or other free-for-all maps (the map data format supports it; colours and symmetry would need new work).
