# Dragonmarch — Project Overview

A small real-time strategy game that runs in the browser as a static site
(Phaser + PathFinding.js from a CDN, no build step, all art and audio made in code).

**Read this first if you are picking the project up in a new session.** It
covers the whole project, lists what is out of scope, and describes the
counter design every phase relies on. Phase-specific numbers are in
[SPEC.md](SPEC.md). Ideas we postponed are in [BACKLOG.md](BACKLOG.md).

## Fixed design pillars (all phases)

This document, SPEC.md and BALANCE.md use the **internal codenames** from
Phases 1–4 (Lumen, Drone, Command Core, ...), which are also the ids in the
code and data. Since Phase 5 the player sees fantasy names instead (Gold,
Peasant, Castle, ...): the mapping is in README.md, "Internal names", and in
PHASE5_SPEC.md.

- **One faction.** The player and any future opponent use the same units and
  buildings. There are no asymmetric races.
- **No fog of war:** the whole map is always visible. (Phases 1–5 had one
  map. Phase 6 was asked to add a larger free-for-all map; that request
  changed this pillar and the out-of-scope list below on purpose. The 1v1
  map is unchanged.)
- **One resource**, *Lumen*. Drones gather it from fixed crystal nodes and
  carry it back to a Lumen Depot, which adds it to the stockpile.
- **Four buildings:** Command Core (base, trains Drones), Lumen Depot
  (drop-off), Foundry (the one unit-production building) and Sentry Spire
  (defensive turret). Each has a cost and a construction time.
- **Five unit types with clear counters.** They are listed in the table below.
- Original theme, names and art. We use no existing IP. (Phase 5 reskinned
  the theme to knights and dragons; the rules did not change.)

## Phases

| Phase | Goal | Status |
|---|---|---|
| **1 — Sandbox** | A playable sandbox with base building, gathering, production queues, unit control, pathfinding with steering, and combat that follows the counter design. **No AI opponent** and no win/lose condition. Neutral *test targets* exist only for verification and are not a game feature. Shipped to GitHub Pages. | done |
| **2 — Scripted AI opponent** | An opponent that plays with the same rules and roster. It picks one of three scripted strategies (**rush**, **economy boom**, **turtle-and-tech**) and reacts to what it scouts. For example, it builds Lancers after seeing Bulwarks, or adds Spires after seeing an early rush. It adds a population (supply) cap for both sides and the win/lose condition: **destroying the enemy Command Core wins**, and losing your own loses. The player picks a difficulty, which selects the strategy and how tightly its script is timed. | done |
| **3 — Balance & polish** | Headless simulated matches between the strategies to tune the unit and building data. The Phase 2 fairness harness is the starting point. Then polish: UX, feedback, performance and accessibility. | done |
| **4 — Mobile & art** | Not in the original plan. It was added after playtest feedback: the right-click controls don't work on a phone, everything renders as plain blocks, and a new player finds the game unclear. It adds a **touch control scheme** alongside the unchanged mouse/keyboard one; the two share the same command layer, so every order still ends in `world.issue()`. It replaces the placeholder shapes with **sprite art generated in code**: every unit, every building in each construction state, the crystals and the terrain. And it adds a light **clarity pass**: a tutorial for each input mode and readouts that work on a small screen. **Sim, AI and balance are frozen** at their Phase 3 state. See [PHASE4_SPEC.md](PHASE4_SPEC.md). | done |
| **5 — Fantasy reskin & zoom** | Not in the original plan. It was added after playtest feedback: the game should read as a **fantasy game of knights and dragons**, and the camera should zoom out far enough to see a whole base. A **reskin only**: every unit, building and strategy keeps its exact stats, costs, times, counters and behaviour; only names, descriptions and code-drawn art change. Display text moves out of `src/data` into `src/theme`, so the gameplay data files stay byte-identical from here on, and the freeze guard adds a hash of every gameplay value on top of its file pins. The minimum zoom drops to 0.35× (measured: a fully built base fits a phone in landscape), with mouse-wheel zoom added on desktop so the range applies to both. **Sim, AI and balance stay frozen.** See [PHASE5_SPEC.md](PHASE5_SPEC.md). | done |
| **6 — Free-for-all foundation** | Not in the original plan. Player feedback wanted free-for-all play. Adds a **free-for-all mode**: **4 camps** on a larger 96×96 map, each with a home zone, plus 5 neutral zones with gold mines. Every zone has an owner (a camp or neutral), shown as a tint in the owner's colour; military control of a zone takes it. Destroying a camp's last Castle eliminates it, and the camp that landed the killing blow takes its banked gold and every zone it owned. Last camp standing wins; at the time limit, most zones (then score) wins. The sim's team model becomes a list of N teams, and the classic 1v1 match runs through the same code with its Phase 5 fixed-seed fingerprints unchanged. AI camps run the existing scripts with an explicitly **placeholder** targeting rule (attack the nearest living rival); real multi-rival AI is Phase 7. Also fixes native double-tap-to-zoom on phones. See [PHASE6_SPEC.md](PHASE6_SPEC.md). | done |
| **7 — Multi-rival AI** | Not in the original plan. Replaces Phase 6's placeholder targeting with real multi-rival decisions in the free-for-all. Each AI camp assesses every living rival from what it has actually scouted (seen army strength, zones owned, whether it **witnessed** the rival fighting a third camp, Castle damage, measured travel time) and ranks them with a documented formula. It piles on a rival it saw weakened or engaged elsewhere, holds back from a clearly stronger one (claiming empty land instead), reacts to massing per rival, and defends or retakes the zones it holds. A dev-panel view shows each camp's ranking and why. Still 4 camps; build/train scripts, stats and balance are unchanged, and the 1v1 match is byte-identical. See [PHASE7_SPEC.md](PHASE7_SPEC.md). | done |
| **8 — Symmetry & N-way balance** | Not in the original plan. Closes the gaps Phase 7 named. Fixes the free-for-all's **north-south pathfinding tie-break asymmetry** (root-caused with Phase 3's mirror trace). **Measures four-camp balance** for the first time with a batch runner over every corner arrangement, and tunes it within a **bounded stop condition set in advance** (no strategy above ~50% of wins, no corner above ~35%; one tuning pass plus at most 3 hypothesis-driven adjustments, then stop and document any exception). Gives Boom and Turtle free-for-all attack triggers so every strategy acts, and adds **re-scouting with an intel staleness window**. The 1v1 match stays byte-identical. See [PHASE8_SPEC.md](PHASE8_SPEC.md). | done |
| **9 — Auto-defend, moving structures, hopeless camps** | Not in the original plan. Three pieces of player feedback: **idle combat units in a zone their camp owns now engage intruders automatically** (never overriding an order, never recalled from elsewhere, walking back to their post afterwards); a completed building can be **moved** for half its cost and half its build time (the Castle cannot move); and a camp with no army and **provably no way to ever produce a unit or income** is eliminated after a short confirmation window instead of watching itself lose. The balance matrix is re-measured and reported, with intervention only for a severe outlier. See [PHASE9_SPEC.md](PHASE9_SPEC.md). | done |
| **10 — Multiplayer foundation** | Not in the original plan. The first half of real multiplayer free-for-all: a **Multiplayer** option next to "vs AI" in the free-for-all menu, a **lobby** created or joined with a short **match code** (display names, a live player list, up to 4 humans, the host starts with 2 or more), and a **direct WebRTC connection between every pair of human players** (full mesh, public STUN), each proven by a test message over its data channel. Unfilled camps go to the existing free-for-all AI scripts, unchanged. **No game state is sent**: lockstep sync, AI takeover on disconnect, reconnection and chat are Phase 11. Adds Firebase Realtime Database as a logged exception to "no external services" (below). **Sim, AI and balance are untouched.** See [PHASE10_SPEC.md](PHASE10_SPEC.md). | done |

## Explicitly OUT OF SCOPE for the whole project

Do not add any of these in any phase. They were ruled out on purpose to keep
the project small:

- Fog of war or any vision/line-of-sight mechanic
- More than one faction or asymmetric races
- Deep tech trees. There are **at most 2 tech tiers, ever**. Phase 1 has one tier.
- Multiplayer, networking or lockstep netcode. (Phase 10 was asked to build
  multiplayer free-for-all, so this rule changed on purpose: free-for-all
  multiplayer between human players is now in scope, in two phases. 1v1
  multiplayer, matchmaking and accounts stay out.)
- Map editors or procedural maps. (Until Phase 6 this read "more than one
  map". Phase 6's request added a second, hand-made map for the free-for-all
  mode, so the rule now bans map editors and generated maps only.)
- Adaptive or learning AI (ML, self-play training, online adaptation). The
  Phase 2 AI is scripted.

Any other idea goes into `BACKLOG.md`, tagged with the phase it belongs to.
Ideas are not built on the side.

## Logged exceptions

- **Phase 10: an external service.** Until Phase 10 the game used no external
  services, no runtime dependencies beyond CDN-loaded libraries and no build
  step. Multiplayer needs a way for browsers to find each other, so **Firebase
  Realtime Database** (free Spark plan, with Firebase anonymous
  authentication) is now a dependency, loaded as Google's standard web SDK
  from its CDN (gstatic.com), and **only when a player opens Multiplayer**. It
  holds only lobby records keyed by match code and the one-time WebRTC
  handshake (offers, answers, ICE candidates); never game state, never
  ongoing traffic. Game traffic goes directly between browsers over WebRTC.
  Single-player modes load and run exactly as before, with no Firebase code.
  The web config in `src/net/config.js` is public by design (it identifies the
  project, it is not a credential); the security boundary is the server-side
  rules in `database.rules.json`. Tests run against the Firebase Local Emulator
  Suite (`firebase-tools`, a dev dependency), never the production project.
  There is still no build step. See PHASE10_SPEC.md.

## Counter relationships (design contract)

Each attack type deals a percentage of its damage to each armor class:

| Attack type ↓ / Armor → | light | heavy | structure |
|---|---|---|---|
| blade (Drone, Striker) | 100% | 40% | 50% |
| bolt (Sparker, Sentry Spire) | 100% | 40% | 50% |
| crush (Bulwark) | 100% | 60% | 100% |
| lance (Lancer) | 35% | 250% | 150% |

The intended 1v1 results below are verified by simulated fights in
`test/counters.test.js`:

| Matchup | Winner | Why |
|---|---|---|
| Striker vs Sparker, **starting in melee range** | **Striker** | The Striker's burst kills the fragile Sparker (65 HP) in 7 hits (3.6 s). The Sparker needs 4.5 s. |
| Striker vs Sparker, **starting at Sparker range** | **Sparker** | The Striker spends about 2 s closing the gap while the Sparker shoots freely. |
| Bulwark vs Striker | **Bulwark** | Heavy armor takes only 40% of blade damage. |
| Bulwark vs Sparker | **Bulwark** | Heavy armor takes only 40% of bolt damage. |
| Lancer vs Bulwark | **Lancer** | The lance deals 250% damage to heavy armor and kills in 5 hits. |
| Striker vs Lancer | **Striker** | The lance deals only 35% to light armor, and the Lancer fires slowly. |
| Sparker vs Lancer | **Sparker** | The Sparker outranges the Lancer (176 vs 128), which also deals only 35% to light armor. |
| Any combat unit vs Drone | **combat unit** | Drones are workers. |

In short: the **Striker** beats the Sparker up close and beats the Lancer.
The **Sparker** beats the Striker at range and beats the Lancer. The
**Bulwark** beats both Striker and Sparker. The **Lancer** beats the
Bulwark. Every unit has at least one counter.

## Architecture (all phases)

- `index.html` loads Phaser 3 and PathFinding.js from jsDelivr, then
  `src/game/main.js` as an ES module.
- `src/data/*.js`: readable data for units, buildings and the map: gameplay
  values only since Phase 5.
- `src/data/ffa.js` (Phase 6): the free-for-all map, the territory numbers and
  the AI camps' scripts. `src/sim/territory.js` tracks zone ownership;
  `src/sim/victory.js` handles elimination, loot and the N-camp result.
- `src/theme/*.js`: every player-facing name and description (Phase 5), keyed
  by the internal ids, so a reskin never touches `src/data`.
- `src/sim/*.js`: **pure game logic** with no Phaser or DOM code. It uses a
  fixed timestep (`SIM_DT = 0.05 s`) and a seeded RNG, so it runs headless in
  Node for tests and in the future for Phase 2 and 3 simulations. The world
  is changed only through commands (`world.issue(cmd)`), which is the same
  API the UI, the tests and a future AI use.
- `src/ai/*.js`: the scripted AI opponent (Phase 2). It grew out of the Phase 1
  sandbox bot, reads the world, and acts **only** through `world.issue()` with
  its own team. It runs outside `World` in the match loop and has no Phaser or
  DOM code. Strategy and difficulty numbers live in `src/data/strategies.js`
  and `src/data/difficulty.js`.
- `src/net/*.js` (Phase 10): multiplayer lobby and peer connections. A
  separate layer: it never imports from `src/sim` or `src/ai` except the
  free-for-all camp table it reuses, and nothing in the game imports it.
  `index.html` loads `src/net/menu.js`, which loads Firebase on demand.
- `src/game/*.js`: the Phaser scene (rendering and input), the DOM HUD and
  Web Audio. It only reads sim state and sends commands.
- `test/*.test.js`: `node --test`. Unit, economy, counter, pathfinding and
  stress tests, plus a scripted bot (`test/bot.js`) that plays the whole loop
  through the command API. The Phase 2 AI extends that same engine.
  `test/e2e/*.spec.js` has Playwright browser smoke tests.
- CI is GitHub Actions: tests run on every push and PR. Merging to `main`
  deploys to GitHub Pages.

## Working agreement

Each vertical slice gets a GitHub Issue with acceptance criteria. Each slice
then goes through branch, PR, green CI, self-review, merge and issue close.
Never merge a PR with red CI. PRs over about 400 lines are split.
