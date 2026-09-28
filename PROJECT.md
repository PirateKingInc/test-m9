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
| **6 — Free-for-all foundation** | Not in the original plan. Player feedback wanted free-for-all play. Adds a **free-for-all mode**: **4 camps** on a larger 96×96 map, each with a home zone, plus 5 neutral zones with gold mines. Every zone has an owner (a camp or neutral), shown as a tint in the owner's colour; military control of a zone takes it. Destroying a camp's last Castle eliminates it, and the camp that landed the killing blow takes its banked gold and every zone it owned. Last camp standing wins; at the time limit, most zones (then score) wins. The sim's team model becomes a list of N teams, and the classic 1v1 match runs through the same code with its Phase 5 fixed-seed fingerprints unchanged. AI camps run the existing scripts with an explicitly **placeholder** targeting rule (attack the nearest living rival); real multi-rival AI is Phase 7. Also fixes native double-tap-to-zoom on phones. See [PHASE6_SPEC.md](PHASE6_SPEC.md). | in progress |

## Explicitly OUT OF SCOPE for the whole project

Do not add any of these in any phase. They were ruled out on purpose to keep
the project small:

- Fog of war or any vision/line-of-sight mechanic
- More than one faction or asymmetric races
- Deep tech trees. There are **at most 2 tech tiers, ever**. Phase 1 has one tier.
- Multiplayer, networking or lockstep netcode
- Map editors or procedural maps. (Until Phase 6 this read "more than one
  map". Phase 6's request added a second, hand-made map for the free-for-all
  mode, so the rule now bans map editors and generated maps only.)
- Adaptive or learning AI (ML, self-play training, online adaptation). The
  Phase 2 AI is scripted.

Any other idea goes into `BACKLOG.md`, tagged with the phase it belongs to.
Ideas are not built on the side.

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
