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

## Phase 7: Multi-rival AI (done)

These shipped in Phase 7:
* rival intel from scouting only: seen army strength, seen deaths, witnessed
  fights between rivals, attacks on us, Castle damage, measured travel time
* a documented priority formula, caution (no march on a clearly stronger
  rival; claim free land or hold instead) and retarget hysteresis
* per-rival massing; early-rush defense with raiders from several camps
* zone squads that defend held zones and retake lost ones
* the dev panel targeting view
* a free-for-all production-log fingerprint proving build/train unchanged

## Phase 8: Symmetry & N-way balance (done)

These shipped in Phase 8:
* north-south mirrored tie-breaks on the free-for-all map (pathfinding,
  spiral, approach tile, spawn corner, separation order), root-caused with
  the mirror trace; mirrored marches now match
* a four-camp batch runner over every corner arrangement, a baseline, one
  tuning pass (rejected under the rule fixed in advance), targets met
* Boom/Turtle opportunity attacks; stale-intel confidence and re-scouting

## Phase 9: Auto-defend, moving structures, hopeless camps (done)

These shipped in Phase 9:
* auto-defend: idle combat units in a zone their camp owns engage intruders
  in that zone, never overriding an order, and walk back to their post
* moving a completed Storehouse, Barracks or Watchtower for half its cost and
  half its build time (the Castle cannot move)
* hopeless camps, proven by a reachability search, eliminated after a 5 s
  window with nothing transferred
* the balance matrix re-measured (no severe outlier, no intervention)

## Phase 10: Multiplayer foundation (done)

These shipped in Phase 10:
* Firebase Realtime Database as a logged exception, used only for lobby
  records and the one-time WebRTC handshake; restrictive security rules
  tested against the Firebase emulator
* lobbies with 6-character match codes, display names, a live list, up to 4
  players, AI in the empty camps, leaving and a closing host handled
* a direct WebRTC connection between every pair of players, proven by a
  test message over each data channel

## Phase 11: Lockstep play, disconnects, reconnection (done)

These shipped in Phase 11:
* deterministic lockstep over Phase 10's data channels (a 200 ms input
  delay, no authoritative peer), with engine-independent Math and a
  permanent whole-state desync check
* a new AI hold mode for a disconnected player's camp (army home, queued
  work finishes, no new decisions, Phase 9 auto-defend), with Firebase
  presence as the arbiter so a peer that lost its own connection never
  takes anyone over
* reconnection after a reload from a snapshot served over the data channels
  by any connected player, the host included, and handback after a steady
  link
* in-match chat over the data channels
The deferred items are at the end of the list below, tagged [P11].

## Phase 12: Scale validation (done)

These shipped in Phase 12:
* a performance budget set before measuring, a headless and a browser
  (desktop and 4x-throttled phone viewport) scale harness, and a measured
  ceiling: supply cap **100** (it was 60)
* route planning made cheap without changing a route, and a deterministic
  per-tick budget of pathfinding work so a whole-army order never stalls a tick
* the Storehouse at 10 supply (Castle + 9 Storehouses reach the cap)
* both maps 1.25x larger with wider gates and 2,500-gold mines; travel times
  and `CAMP_TRAVEL` re-measured; the four-camp matrix re-run (no outlier)
The deferred items are at the end of the list below, tagged [P12].

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
- [P9] **Theory of mind.** A camp does not predict what other camps will do to each other: that attacking a rival will leave it open to a fourth camp, or that two rivals are about to fight. It only reacts to what it has seen.
- [P9] AI camps do not value a rival's banked gold as loot when choosing a target (it is not visible); zones owned stand in for it.
- [P9] Zone squads defend one zone at a time with at most four units; with many zones held, larger or several squads may be needed.
- [P9] **5th camp / difficulty scaling** for the free-for-all (deferred from Phases 7 and 8). Five camps cannot be placed mirror-symmetrically on a square map (PHASE6_SPEC.md).
- [P9] **East-west lean in the free-for-all.** West corners win 55-56% of free-for-alls (east 44-45%) in every measurement, for every strategy. The pathfinding is mirror-equivariant in both axes, but a long east-west march is still about 1.3 s slower westward than eastward (median of 24, PHASE8_SPEC.md): crowd behaviour on the way (steering, slots, float rounding), not route choice. Within the corner target; worth a Phase 3-style trace of an east-west march pair.
- [P9] **Strategy spread.** Stone Bastion (Turtle) wins 46% of free-for-alls (pooled 1,800 matches; one seed set's upper interval touches 50%), Warband Raid (Rush) 25%. Within the ~50% ceiling, but the one tuning pass showed how sensitive Boom's opportunity threshold is (16 -> 22 moved Boom from 31% to 50%); a finer, measured adjustment could narrow the spread.
- [P9] Re-scouting costs a Peasant's mining for about a minute every 2 minutes, and the scout often dies at a defended base; a cheaper lookout (a Tower's sight, a mounted scout) would need new rules.
- [P9] The batch runner takes about an hour for 900 matches; profiling the free-for-all step (A* on a 96x96 grid) would allow larger seed sets.
- [P6] **Capturing intact enemy structures.** Buildings of an eliminated camp are razed; taking them over (and turning surviving units) was out of scope.
- [P6] Spectating after your camp falls: the match runs on, but there is no camp-follow camera, speed-up or skip to the result.
- [P6] Zone income or upkeep: owning land only matters for loot and the time-limit ranking; a per-zone bonus could make territory matter during the match.
- [P6] More than four camps or other free-for-all maps (the map data format supports it; colours and symmetry would need new work).
- [P9] **The opportunity trigger does not scale with difficulty.** Easy and Normal free-for-all camps launch the same 16-supply opportunity waves as Hard, so a weak-looking player (or the scripted touch bot) can be raided at about 5 minutes instead of about 7. Scaling `RIVALS.attack` per difficulty tier (and measuring it) is the fix.

- [P10] **No auto-defend in the 1v1.** Auto-defend is keyed to zones, and the 1v1 map has none, so there the Phase 1 rule (idle units attack within 200 px, give up past 320 px) still applies. A home radius around the Castle would bring the same behaviour to the 1v1, at the cost of its frozen fingerprints.
- [P10] The scripted AI never moves a building. A Turtle AI shifting a Watchtower toward a contested zone, or any AI rescuing a Storehouse from a raided field, would use the new command.
- [P10] **Hopeless elimination never fires in AI-vs-AI play** (0 of 2,697 falls in the Phase 9 matrix): the scripted camps always keep a Peasant, gold or a queued unit until their Castle falls. It is a safety net for human play; a real-player telemetry pass would show how often it fires and whether 5 s feels right.
- [P10] A moving building shows as an ordinary construction site; a distinct "packed up" look (carts, crates) would tell the player it rebuilds itself without a Peasant.
- [P10] **Turtle drifted up with auto-defend** (45% -> 48% on the same seeds; upper interval 51%): its home garrison benefits most from automatic defence. Inside the ~65% severe-outlier line of Phase 9 but at Phase 8's ~50% target line; see the Phase 8 strategy-spread item.
- [P11] **TURN relay.** With public STUN only, players behind symmetric NAT or strict corporate/campus firewalls cannot connect directly; they see "could not connect directly". A TURN server (paid, or a free tier) would relay them. Phase 10's tests only prove same-machine connections (host candidates); real-world success rates across networks are unmeasured.
- [P11] **Scheduled lobby sweeper.** Abandoned lobbies are removed by the host's disconnect handler and are inert after an hour, but one whose handler never ran and whose code is never tried again stays (about 1 KB). A scheduled job with an admin credential (a GitHub Actions cron with a service-account secret, or Cloud Functions on the paid plan) could sweep them. A query-restricted sweep in the rules was tried, but the emulator does not evaluate numeric `query.endAt` comparisons, so it could not be tested.
- [P11] Rejoining a lobby after a network blip: a guest whose connection drops loses its slot (the server frees it); it has to join again with the code.
- [P11] Host migration: if the host leaves, the lobby closes rather than passing to another player.
- [P11] Mobile layout of the lobby screens is only checked at desktop size in the multiplayer tests; the lobby uses the menu's responsive card.
- [P11] **The TURN relay is still missing, and now it matters for reconnection too.** A player who cannot connect directly can neither play nor rejoin: the rejoin re-opens WebRTC through the same STUN-only path. All multiplayer tests run on one machine (host candidates); success rates across real home, mobile and corporate networks are unmeasured.
- [P11] **Determinism across engines is proven by tests, not guaranteed by the platform.** Every Math function the simulation uses that the language leaves engine-defined (sin, cos, atan2, hypot) is replaced during multiplayer, and CI plays Chromium, Firefox and WebKit together. A future sim change that calls another approximated function (exp, log, pow with non-integer exponents, tan, asin...) would reopen the risk; the desync check would catch it in play, and the cross-engine CI job should catch it first.
- [P11] Rejoin needs the same tab (the anonymous Firebase user lives in the tab's session storage). A player who closes the tab, or switches device, cannot take their camp back; the AI holds it for the rest of the match.
- [P11] The AI hold never gives a camp back to anyone else, and there is no way to hand a camp to the AI on purpose (a "leave, let the AI play" button).
- [P11] A rejoin snapshot is about 120–135 KB of JSON in a four-camp match (measured at 5, 10 and 11 minutes), sent in 16 KB chunks, plus up to 30 s of turns. Compressing it (a CompressionStream over the JSON) would cut it several times; not needed at today's sizes.
- [P11] Spectating a multiplayer match (a fifth person watching), and matchmaking or persistent identity: out of scope for Phase 11.
- [P11] Real-network latency above the 200 ms input delay slows the game for everyone (it waits for the late turns: about 12 ticks per second at 150–400 ms per message, measured). An adaptive input delay (raised for the match when a peer's round trip is high) would keep the pace smooth at the cost of a laggier feel.
- [P12] **Real-phone measurement of the cap.** Cap 100 rests on a desktop CPU throttled 4x at a phone viewport, with a software GPU, using the one-tick frame measure. Under the raw frame measure that proxy supports only 60 in the worst case (every camp an all-1-supply army). A physical mid-range phone (Android Chrome, iOS Safari) running the same scenario (`e2e/scale-mobile.spec.js` does it in Chromium) would settle whether 100 holds, or whether there is room for more.
- [P12] **The phone limit is the sim tick at the battle peak** (separation steering and combat scans over hundreds of units), not drawing. Cheaper separation (a smaller cell, which changes push order and so every fingerprint), sleeping idle units, or flow fields for large groups (see the [P3] flow-field item) are the levers for a cap above 100.
- [P12] **Stone Bastion (Turtle) wins 58% of free-for-alls** after Phase 12 (48% before; Merchant Kingdom 17%, down from 28%). That is inside the 65% severe-outlier line, so it was recorded rather than tuned. Longer marches and an uncapped late army favour the camp that defends and attacks late. A measured pass on Boom's opportunity and wave thresholds would be the first thing to try.
- [P12] **The AI does not plan for the bigger cap.** Its attack waves still leave at about 30 supply, so AI camps peak at a median of 67 supply in fights (99 when they never attack). Scaling wave sizes with `SUPPLY.max` would change the strategies' character and needs its own balance pass.
- [P12] A full-cap army's order sets off over up to about 0.35 s (7 ticks) on the 1v1 map, rear units last, because route planning is budgeted per tick. Sharing one route across a group order would remove the stagger and most of the planning cost.
- [P12] The 1v1 strategy matrix (BALANCE.md, Phase 3) was not re-run at cap 100 on the larger map; the fixed-seed 1v1 games are re-pinned and the fairness suite passes, but per-matchup win rates are unmeasured.
- [P12] The four-camp batch runner now takes about 50 minutes for 900 matches on the 120 x 120 map (in 20-seed chunks, `tools/ffa-merge.mjs`).
- [P12] **A weak free-for-all camp is raided sooner.** With the Phase 12 data an idle player camp is first raided at a median 395 s (469 s before) and by 432 s on three seeds in four (697 s before); 18 of 20 are eliminated within 20 minutes (16 before) (`tools/raid-timing.mjs`). With the [P9] item on Easy opportunity waves, a new or touch player meets raids by about 6.5 minutes. Scaling `RIVALS.attack` by difficulty would address both.
