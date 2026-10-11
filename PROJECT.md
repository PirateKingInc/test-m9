# DragonMarch — Project Overview

**Read this first if you are picking the project up in a new session.**

DragonMarch started as one game, **Dragonmarch**, a small real-time strategy
game that runs in the browser as a static site (Phaser + PathFinding.js from
a CDN, no build step, all art and audio made in code). Its multiplayer
(Phases 10–12b) is now being turned into the **DragonMarch Multiplayer
Platform**: reusable multiplayer infrastructure that other games can be
built on. The platform's vision, its milestones and its roadmap are the
first part of this document. The second part covers the Dragonmarch game:
its phases, what is out of scope for it, and the counter design every phase
relies on. Phase-specific numbers are in [SPEC.md](SPEC.md). Ideas we
postponed for the game are in [BACKLOG.md](BACKLOG.md).

## The DragonMarch Multiplayer Platform

### Vision (the long-term target)

A developer should be able to use DragonMarch to add multiplayer to a
browser game, a competitive game, a co-op game or a persistent world
without building their own networking infrastructure from scratch. The
target end state:

- **Several networking models:** deterministic lockstep; real-time relay
  messaging; authoritative, server-validated multiplayer; turn-based and
  asynchronous multiplayer; and hybrid combinations of these.
- **A shared infrastructure layer:** connectivity and relay; matchmaking and
  lobbies; session and invitation management; disconnect and reconnect
  recovery; state synchronisation and transport; replay recording; optional
  identity and authentication; persistent cloud storage; analytics and
  connection monitoring; optional voice and text chat.
- **Engine integrations beyond the browser:** Godot, Unity and Unreal, all
  built on the same underlying core.

Nothing of that can be built at once. Authoritative servers need
infrastructure this project has never run; each engine integration is in
effect its own SDK in another language; relay-only and turn-based
networking are different paradigms from lockstep. The piece that is
already proven, and hard-won, is the **lockstep core**: WebRTC mesh
connectivity, STUN-then-TURN relay fallback, Firebase signaling,
cross-browser determinism, heartbeat-based disconnect detection and
snapshot-based reconnection. So the platform starts there.

### Platform milestones

| Milestone | Goal | Status |
|---|---|---|
| **Platform Milestone 1 — The lockstep core, extracted and proven** | Turn Dragonmarch's lockstep networking from code embedded in the game into a documented, game-agnostic module (`platform/lockstep/`) with a public API: lobbies and peer connection (Firebase signaling, WebRTC mesh, Cloudflare TURN fallback), tick-tagged commands with input delay, a pluggable state hash for desync detection, snapshots through pluggable serialise/restore hooks, and disconnect detection and reconnection that are generic over what "holding a slot" means to the game. Rebuild Dragonmarch on it with zero behaviour change (every existing test passes unchanged), and prove reusability with a second, unrelated game, **Ringout**, built on the public API only. See [PLATFORM_SPEC.md](PLATFORM_SPEC.md) and the integration guide, [platform/lockstep/README.md](platform/lockstep/README.md). | in progress |

### Platform roadmap (future milestones, not started)

Each item below is a real future milestone. None of it is built in Platform
Milestone 1. Each entry says what it is, what it builds on, and what a
future session needs to decide or provision first. Numbers are a suggested
order, not a commitment.

1. **Generic signaling backend.** *Found while building Ringout.* The deployed
   Realtime Database rules (`database.rules.json`) are Dragonmarch-shaped: a
   lobby must carry `difficulty` (easy/normal/hard) and a 4-seat `H`/`A`
   lineup, so a second game has to dress its settings as a difficulty and is
   capped at 4 seats, and nothing stops a code for one game being joined from
   another (the module's connection check catches it, after the join). Work:
   rules with a `game` id, a bounded free-form `settings` map and a
   configurable seat count (up to 8, the lineup validated by length); keep
   Dragonmarch's records valid; extend `test/rules` for both shapes; deploy
   with `firebase deploy --only database` (the owner's credentials; a rules
   change, not new infrastructure). Then drop Ringout's pace-as-difficulty
   mapping.
2. **Relay-only (non-lockstep) real-time messaging.** Rooms where peers
   exchange game messages without a shared deterministic simulation: each
   client owns its own entities and broadcasts their state. Builds on the
   module's lobby, mesh, links and TURN fallback, but not on `Lockstep`.
   Needs: unreliable/unordered data channels next to the ordered one, a
   message API with per-channel reliability, interest management for larger
   rooms, interpolation helpers, and host migration for anything
   host-owned. Open question: mesh (N² links) caps rooms at about 8; larger
   rooms need a relay server (see 3).
3. **Authoritative server networking.** A server runs the game and validates
   every client input; clients predict and reconcile. Needs new
   infrastructure (Cloudflare Durable Objects are the natural fit with the
   existing Worker; a Node service on a VM is the alternative), a server-side
   runtime for game logic written as for lockstep (the game contract's
   `step`/`serialize` carry over), client prediction and rollback,
   rate limits and anti-cheat. Cost and hosting are the owner's decision.
4. **Turn-based and asynchronous multiplayer.** Players move in turns, possibly
   hours apart, with the match stored between moves. Needs persistent storage
   (5), move validation (server-side, or by every client replaying the move
   log, which the lockstep core already does), notifications that it is your
   turn, and match lists per player (which needs identity, 7).
5. **Persistent cloud storage.** Per-player and per-match records beyond the
   one-hour lobby: saved games, async matches, settings. Firebase already
   hosts the lobbies; the decision is Realtime Database vs Firestore, the
   rules, and quotas on the free plan.
6. **Matchmaking beyond lobby codes.** Quick-match queues (join any open
   lobby of a game with free seats), skill ratings, region-aware pairing
   (latency from the mesh's measured round trips), and invitations by link.
   Builds on the lobby records; needs server-side assignment (a Worker or
   Cloud Function) so that two players are never matched into a race.
7. **Optional identity and authentication.** Today every player is an
   anonymous Firebase user for the life of a tab. Linking to Google, Apple or
   email accounts gives stable identities for ratings, friends, storage and
   moderation. Needs privacy and data-retention decisions.
8. **Replay recording.** Lockstep makes a replay small: the seed, the lineup
   and every turn. Record turns as they execute, export and import them, play
   them back at any speed with seeking through periodic snapshots, and pin
   replays to a game version (a replay is only valid for the build that made
   it). Builds directly on `Lockstep` and the codec.
9. **Analytics and connection monitoring.** Round-trip times, relayed vs
   direct pairs, TURN bandwidth, desync reports with the diverging tick,
   rejoin success, crash reports. Needs a collection endpoint (the Worker),
   consent, and a dashboard.
10. **Voice and text chat as a platform feature.** Dragonmarch's in-match chat
    is game code over the module's app messages and stays so. A platform
    feature would offer text chat with moderation hooks and rate limits for
    any game, and voice over WebRTC audio tracks on the existing peer
    connections (or through TURN), with push-to-talk and mute.
11. **Hybrid models.** Combinations: lockstep with an authoritative arbiter for
    disputes and late joiners, rollback (GGPO-style) on top of the lockstep
    game contract for fighting-game latency, relay messaging for cosmetic
    state beside a lockstep core. Needs 2 and 3 first.
12. **Godot integration.** A GDScript (or C#) SDK speaking the same signaling
    and wire protocol: Godot has WebRTC (`WebRTCPeerConnection`) and HTTP for
    Firebase's REST API. Determinism needs fixed-point or a vetted float
    discipline, since Godot builds differ from browsers.
13. **Unity integration.** A C# SDK: WebRTC through Unity's package, Firebase
    through its SDK or REST, the same protocol; determinism through
    fixed-point maths (Unity's physics is not deterministic across
    platforms).
14. **Unreal integration.** A C++ plugin: WebRTC through a native library,
    the same protocol; Unreal's own networking is server-authoritative, so
    this mainly serves lockstep games that choose it.
15. **Packaging.** Publish `platform/lockstep` as a versioned npm package
    (ES modules, no build step) with semantic versioning of the wire protocol,
    so games outside this repository can depend on it.

## Dragonmarch, the game

### Fixed design pillars (all phases)

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
| **11 — Lockstep play, disconnects, reconnection** | Not in the original plan. The second half of multiplayer: players actually play a free-for-all together. Every browser runs the same deterministic simulation from the same commands at the same ticks (**lockstep** over Phase 10's data channels, with a 200 ms input delay), proven byte-identical first in one process and then across real browsers. A player who disconnects for longer than a grace period has their camp **held by a new AI hold mode** (garrison home, no new decisions, Phase 9 auto-defend); they can **reconnect** from a snapshot served by any connected player and take their camp back. Plus in-match **chat**. **Sim, AI and balance are untouched.** No TURN relay: a player who cannot connect directly can neither play nor rejoin (backlog). See [PHASE11_SPEC.md](PHASE11_SPEC.md). | done |
| **12 — Scale validation** | Not in the original plan. Player feedback: once a camp reaches the supply cap (60), more Storehouses buy nothing. This phase finds, **by measurement**, how high the cap can go while the game stays playable on desktop and (as far as an emulated phone can show) on mobile, against a **performance budget set before measuring**. It then sets the cap and the Storehouse's supply to that number, **resizes the maps** (and their gold) for the bigger armies, re-measures travel time and the four-camp balance matrix (intervening only for a severe outlier, Phase 9's standard), and re-pins the fingerprints the new numbers change. Quantity and space only: **no new units, abilities, upgrades or Castle levels, and no change to unit stats, costs or counters.** Castle leveling (Phase 13) and a heavy unit (Phase 14) build on its numbers. Result: **cap 100** (from 60), Storehouse 10 supply, both maps 1.25x larger with 2,500-gold mines; no balance outlier. See [PHASE12_SPEC.md](PHASE12_SPEC.md). | done |
| **12b — Relay fallback** | Not in the original plan. In the first live multi-person test, a player on a cellular network (likely carrier-grade NAT) could not connect to anyone, and saw a raw JavaScript error. Fixes that error first: a player whose connections fail sees the existing "could not connect directly" message, never an exception. Then adds a **TURN relay** (Cloudflare Realtime TURN) as an extra ICE server next to the public STUN servers, with **short-lived credentials minted server-side** by a small Cloudflare Worker (a logged exception, below); never a static credential. Direct connections stay direct; only pairs that need it are relayed. Verified with relay-forced connections in 2-4 player lobbies, the cross-browser determinism proof and the input-delay guarantee with a relayed peer. Numbered 12b so Castle leveling and the heavy unit keep 13 and 14. No change to the sim, AI, balance or lockstep protocol. See [PHASE12B_SPEC.md](PHASE12B_SPEC.md). | in progress |

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
- **Phase 12b: Cloudflare (a TURN relay and a Worker).** Some networks,
  notably cellular carrier-grade NAT, block every direct WebRTC path, which
  public STUN can't get around. Multiplayer therefore also depends on
  **Cloudflare Realtime TURN** (free for the first 1,000 GB a month, then
  $0.05/GB) as a relay of last resort, and on a small **Cloudflare Worker**
  (`worker/`, free tier) that mints short-lived TURN credentials. Both are
  used only when a multiplayer lobby starts connecting. The Worker holds the
  TURN key's API token as a Worker secret. The site contains only the Worker's
  URL, and a browser only ever receives a credential that expires in 2 hours.
  A static credential is never shipped (project owner's decision), and every
  deploy inspects the site for one (`tools/check-bundle.mjs`). Direct
  connections stay direct. If the Worker can't be reached, the game connects
  STUN-only as before. Relay traffic is end-to-end encrypted (DTLS), so
  Cloudflare relays it without being able to read it. The Worker is deployed
  with Wrangler, not by CI (worker/README.md). See PHASE12B_SPEC.md.

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
