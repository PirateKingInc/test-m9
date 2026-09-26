# Prism Outpost

A mini real-time strategy game that runs in the browser. Build a base, mine Lumen
crystals, train an army and **destroy the enemy Command Core** before the scripted
AI opponent destroys yours. The Phase 1 **sandbox** (no opponent) is still available
from the start screen. See [PROJECT.md](PROJECT.md) for the roadmap and scope; this
was built in three phases (sandbox, AI opponent, balance & polish), plus a Phase 4
that added touch controls for phones and sprite art drawn in code.

**Play:** https://piratekinginc.github.io/test-m8/ (desktop with mouse and keyboard, or a phone/tablet with touch; landscape recommended)

It's a static site with no build step. [Phaser 3](https://phaser.io) and
[PathFinding.js](https://github.com/qiao/PathFinding.js) load from the jsDelivr CDN.
All art is drawn in code, and all audio is synthesized with the Web Audio API.

## Playing against the AI

The start screen asks for a **difficulty** and, optionally, which **strategy** the AI
plays (Auto uses the tier's default). Both sides play the same mirrored map with the
same units, buildings, costs, build times, pathing and a **60-supply population
cap**, so the AI gets no special treatment. You win by destroying the enemy's last
completed **Command Core**, and you lose if yours falls. At **30:00** the match ends
on score.

| Difficulty | Default AI strategy | Execution |
|---|---|---|
| Easy | Turtle-and-Tech | at most 1 Foundry; decides every 2.5 s, +2 s after each opening step, reacts to scouting after 25 s, 70% of its worker target |
| Normal | Rush | at most 2 Foundries; every 1.2 s, +2 s per step, reacts after 10 s, 90% of workers |
| Hard | Economy-Boom | the strategy's own Foundry count; every 0.5 s, no step delay, reacts after 3 s, full economy |

**Easy and Normal are handicapped, not just "playing worse".**
- **The cap.** The Easy AI may run only **one Foundry**, and the Normal AI
  **two**. Your own production is never capped. That is an economic handicap
  on the AI: it can't turn its income into an army as fast as you can.
- **Why.** It's the main thing that makes Easy easy. In Phase 2 the tiers
  differed mostly in how strong a script each one played. Phase 3 balanced
  the scripts, and timing alone turned out not to change results much.
- **Hard is uncapped.** It plays Economy-Boom with its full Foundry count and
  the sharpest timing.
- **What difficulty never does.** It never gives the AI information or
  resources, and it never changes the rules.
- **Easy's default is Turtle-and-Tech.** It's a patient opponent: a player who
  builds a basic defense survives it, which in the balance runs meant holding
  out to the 30:00 limit in 33 of 40 games. But it punishes an early all-in
  rush. See [BALANCE.md](BALANCE.md).

### How the AI works

- **Where it comes from.** The AI is the Phase 1 scripted test bot grown into an
  execution engine (`src/ai/engine.js`).
- **How it acts.** It reads the world and acts **only through `world.issue()`**,
  the same command API the mouse and keyboard use. Its own team is stamped on
  every command, and a whitelist excludes anything a player can't do. The tests
  run whole matches with the AI holding a recursively *read-only* view of the
  game, which fails on any direct state change.
- **Strategies.** Each is a scripted sequence of build and train priorities with
  simple branches. They live as data in `src/data/strategies.js`, with Phase 3's
  tuned numbers.
  - **Rush:** a lean economy and up to five Foundries of Strikers and Sparkers
    with a few Lancers. It sends waves of about 14, then 10, and reinforces in
    groups.
  - **Economy-Boom:** a greedy opening of ten Drones and two Depots before its
    first Foundry, then a mixed army. It attacks at about 34 army supply and
    retreats when a wave is broken.
  - **Turtle-and-Tech:** two Sentry Spires in its opening and up to four in
    all, two Foundries, and a Sparker/Bulwark/Lancer army that attacks at
    about 30 army supply.
  - **Wave timing varies.** Each wave's size threshold varies by ±30%, drawn
    from the AI's own seeded RNG, so the timing can't be learned and
    exploited.
- **Expansion (Phase 3).** Home fields run dry by about 5 minutes. Each strategy
  then claims an uncontested middle field when its data-defined trigger fires:
  a timer plus a minimum Drone count or army size, or the home field dropping
  below 35%. It builds a Depot there, moves Drones over and defends the field:
  - **Rush:** 3 guard units
  - **Boom:** a Spire and 2 guards
  - **Turtle:** 2 Spires

  It never expands where it has seen enemy buildings or recent enemy combat
  units, and it moves on when a field is mined out.
- **Attack targeting (Phase 3).** Waves go for the nearest enemy Command Core
  the AI has actually *seen*. If none is known, they go to the enemy start. If
  that turns out empty, they go to the enemy buildings it remembers, and
  otherwise sweep the enemy half.
- **Scouting and reactions** (`src/ai/scout.js`). The AI only knows what it sees:
  enemies within 16 tiles of its buildings or 7 tiles of its units, plus one scout
  Drone sent to your base. It remembers unit sightings for 90 s, and remembers
  buildings until it sees their spot empty. It reacts in two ways:
  - An **early rush** (2+ of your combat units at its base before 5:00) sends it
    into defend mode. It recalls its wave, fights at home, builds counters and adds
    a Spire.
  - **Massing** one unit type (5+ of it, and a majority of what it has seen) makes
    70% of its production that type's counter from the counter table.

## Controls

The game takes mouse and keyboard, or touch; both work in the same build. On a
touch device an **action bar** appears on the right of the screen (see
[Touch controls](#touch-controls-phones-and-tablets)).

### Mouse and keyboard

| Input | Action |
|---|---|
| Left-click / Shift+click | Select, or add to / remove from the selection |
| Left-drag | Box-select your units (Shift adds) |
| Right-click | Context command: move in formation, **attack** an enemy or test target, **gather** a crystal (Drones), return cargo at a Depot, help build an unfinished building. With a Core or Foundry selected, it sets the rally point. |
| **A**, then left-click | Attack-move |
| **S** | Stop |
| **Shift+1–9** (or Ctrl+1–9) | Assign a control group. Desktop Chrome swallows Ctrl+1–8 for tab switching, so Shift is the primary key. The **Fullscreen** button turns on Keyboard Lock so Ctrl works too, and the HUD group bar assigns on right-click or Shift-click. |
| **1–9** / click a group slot | Select a control group (press twice to center the camera) |
| **Q W E R** with a Drone selected | Place a Command Core, Lumen Depot, Foundry or Sentry Spire. Left-click places it, Shift+click places several, and Esc or right-click cancels. |
| **Q** with the Core selected | Train a Drone |
| **Q W E R** with the Foundry selected | Train a Striker, Sparker, Bulwark or Lancer |
| Click a queue slot / **Backspace** | Cancel that item / the last queued item (100% refund) |
| **X** | Cancel an unfinished building (75% refund) |
| Arrow keys, screen edge, middle-drag | Pan the camera. **Home** recenters on the Core. |
| Mouse wheel | Zoom in and out about the cursor (0.35×–1.6×, the same range as pinch on touch) |
| **Space** | Jump the camera to where your base was last attacked |
| **M** | Mute or unmute |
| **Help** (top bar) | Show the first-run tutorial hints again |
| **\`** (backtick) | Dev panel. It spawns **test targets** and team-2 test units, for verification only. |

### Touch controls (phones and tablets)

Right-click has no touch equivalent, so orders are given with the **action
bar**. Tap **➜ Order** (or **⚔ Attack**), then tap where to go.

| Touch | Action |
|---|---|
| **Tap** a unit or building | Select it. Tap empty ground to deselect. |
| **Double-tap** one of your units | Select every unit of that type on screen |
| **Drag** with one finger | Look around (pan the camera) |
| **Pinch** | Zoom in and out (0.35×–1.6×) |
| **▭ Box**, then drag | Box-select your units |
| **➜ Order**, then tap | The same smart order as a right-click: move there, attack the enemy you tapped, mine the crystal you tapped, help build a site, or set a Core/Foundry rally point |
| **⚔ Attack**, then tap | Attack-move there |
| **■ Stop** / **✕ Cancel** | Stop the selected units / disarm the armed order or a placement |
| **⌂ Base** | Center the camera on your Command Core |
| Build button (Drone selected), then touch and drag | The building's outline follows your finger; lift to place it |
| Unit button (Core/Foundry selected) | Train that unit |
| Group slot: **tap** / **press and hold** | Select that group (tap twice to jump to it) / save the selection as that group |
| The under-attack alert | Tap it to jump there |
| **Sound on/off**, **Fullscreen**, **Help** | Toggle sound, go fullscreen, replay the tutorial |

**While an order is armed,** the button glows, a banner at the top says what
the next tap will do, and the selected units pulse.

**First visit.** The tutorial teaches whichever controls you're using, and the
panel at the bottom always says what the selection can do.

**Testing so far.** Touch was tested in Chrome's mobile emulation
(Playwright), not on real phones. See the Phase 4 notes below.

### Art

Every sprite is drawn in code (`src/art/`) and baked into textures when the
game starts; there are no image files. This covers:

- the units, in each team's colour
- the buildings, in each construction state
- the crystals and the terrain

**Reference sheet.** It shows everything side by side at the in-game zoom
levels:

- **Saved image:** [`docs/reference-sheet.png`](docs/reference-sheet.png)
- **Live page:** https://piratekinginc.github.io/test-m8/sheet.html
- **Regenerate it:** `node tools/reference-sheet.mjs`

## Roster

The single resource is **Lumen**. Drones mine 8 Lumen per 2 s trip at a crystal and carry it to a **Lumen Depot**; the Core is not a drop-off.

| Unit | Role | HP | Armor | Damage / cooldown | Range | Speed | Cost | Train |
|---|---|---|---|---|---|---|---|---|
| Drone | worker | 40 | light | 4 blade / 1.0 s | melee | 72 | 50 | 10 s (Core) |
| Striker | light melee | 100 | light | 10 blade / 0.6 s | melee | 85 | 60 | 12 s (Foundry) |
| Sparker | ranged | 65 | light | 15 bolt / 0.75 s | 176 | 70 | 70 | 14 s (Foundry) |
| Bulwark | heavy | 300 | heavy | 14 crush / 1.0 s | melee | 50 | 150 | 22 s (Foundry) |
| Lancer | anti-heavy | 120 | light | 26 lance / 1.4 s | 128 | 60 | 110 | 18 s (Foundry) |

| Building | Size | HP | Cost | Build | Role |
|---|---|---|---|---|---|
| Command Core | 4×4 | 1500 | 400 | 60 s | Base; trains Drones |
| Lumen Depot | 3×3 | 600 | 100 | 20 s | Resource drop-off |
| Foundry | 3×3 | 800 | 150 | 30 s | Trains combat units |
| Sentry Spire | 2×2 | 500 | 120 | 25 s | Turret: 14 bolt / 0.8 s, 224 range |

**Counters:**
- A Striker beats a Sparker up close, and a Sparker beats a Striker at range.
- A Bulwark beats both of them.
- A Lancer beats a Bulwark.
- Strikers and Sparkers both beat Lancers.

The full damage table is in [SPEC.md](SPEC.md).

## Run locally

```bash
npm install          # dev dependencies only (tests); the game itself needs nothing
npm run serve        # http://localhost:8080 (or open index.html via any static server)
```

## Tests

```bash
npm test             # headless sim tests (node --test)
npm run test:e2e     # Playwright browser tests, desktop and mobile emulation (npx playwright install chromium first)
```

Add `?speed=N` to the URL to run the game N× faster (up to 16×). The mobile
playthrough test uses it.

```bash
npm run test:fairness  # bot-vs-difficulty win rates (about 2.5 min, 108 full matches)
npm run balance -- --seeds 100 --out balance/latest.json    # full strategy matrix (1,800 matches, ~20 min on 4 CPUs)
npm run balance -- --seeds 150 --mirrors --out balance/m.json  # side-bias check: mirror matches only
npm run balance -- --seeds 100 --offset 1000 --tiers hard   # a disjoint seed set, one tier
```

CI runs the headless, browser and fairness suites on every push and PR, with
fairness as a parallel job. The headless suite includes one full bot-vs-bot
match played to a result. The batch runner is a tool, not a CI job; its
results are committed in `balance/` and reported in [BALANCE.md](BALANCE.md).
Every merge to `main` runs the tests, deploys to GitHub Pages, and polls the
live URL until it serves that exact commit.

| Suite | What it proves |
|---|---|
| `test/pathfinding.test.js` | Units route around rock, buildings and blocked or unreachable goals, and nobody stays stuck forever |
| `test/stress.test.js` | 40 units cross the map, 20 vs 20 cross head-on through a chokepoint, and 35 units handle 6 random orders. All arrive with no lasting overlap, at about 0.2 ms per sim step. |
| `test/economy.test.js`, `test/production.test.js`, `test/construction.test.js` | The gather rate matches the spec formula, costs, build times, FIFO queues and refunds |
| `test/counters.test.js` | Each counter row is checked with 50 seeded 1v1s (≥ 80% required, and each currently wins 100%) |
| `test/selection.test.js`, `e2e/selection.spec.js`, `e2e/combat.spec.js` | Drag-box, control groups, formation moves, attack and attack-move |
| `test/bot.test.js` | The Phase 1 sandbox bot (now a preset of the AI engine) builds every building, trains one of each unit, and beats a squad of test targets |
| `test/supply.test.js` | Both teams are capped identically. Depots raise the cap to the max of 60, and queued production reserves supply. |
| `test/match.test.js`, `e2e/match.spec.js` | Map symmetry. Destroying either Core ends the match with the right result screen; mutual loss is a draw; the time limit always decides. |
| `test/spatial.test.js` | Enemy scanning via the spatial index matches brute force exactly. A 200-unit battle runs at about 1.8 ms per step. |
| `test/ai.test.js` | The AI acts only through `world.issue()`, and five deliberately cheating AIs are caught by the read-only guard |
| `test/playthrough.test.js` | Each strategy plays a full match against a fixed player script, and wins by destroying an undefended Core |
| `test/scouting.test.js` | Early-rush and massing reactions for every unit type trigger when they should and not otherwise, within the AI's limited sight |
| `test/difficulty.test.js`, `e2e/menu.spec.js` | Harder tiers execute the same script faster and react sooner. The start screen launches matches. |
| `test/fairness/` | Scripted player policies vs every tier over 12 seeds (see below) |
| `test/sidebias.test.js` | East-half tie-breaks are the mirror image of the west: spiral order, A* paths and spawn side. Jitter-free mirror matches of each strategy stay an exact mirror for 90 s. |
| `test/expansion.test.js` | Each strategy expands under its trigger with Drones and a defense; it never builds in a field the enemy holds; waves find and destroy a relocated, scouted Core |
| `test/balance.test.js` | The batch runner's pieces, plus one full bot-vs-bot match played to a result |
| `test/audio.test.js`, `test/stats.test.js`, `test/tutorial.test.js`, `e2e/polish.spec.js` | Every sim event has a sound; the result-screen stats add up; the first-run tutorial advances, persists, and works with storage blocked |
| `test/freeze.test.js` | Phase 4 freeze: `src/data`, `src/sim` and `src/ai` are byte-identical to Phase 3, and fixed-seed games (positions, HP, orders) play out exactly as before |
| `e2e/touch.spec.js` | Real touch events in mobile emulation: tap, double-tap, Box, pan, pinch, Order (move, attack, gather, rally), Attack-move, Stop, Cancel, placement, group hold/tap, the alert tap, and the whole touch tutorial |
| `e2e/art.spec.js` | Unit silhouettes differ from each other at 0.5× and 0.35× zoom (buildings too). Every building differs across its construction states, and Depot and Foundry differ in every state. Team colours are present and not mixed. The reference sheet renders. |
| `e2e/mobile-playthrough.spec.js` (`npm run test:mobile`, its own CI job) | A whole match against the Easy AI played with touch events only, to its end. It uses every touch control: placement, training, rally, Box plus group hold, pinch, Order and Attack. This simple scripted player usually *loses*; the test proves touch can play a whole game, not that it wins one. |
| `e2e/groups.spec.js` | Control groups without the browser's reserved Ctrl+1–8: Shift+digit, the HUD group bar, and Fullscreen with Keyboard Lock |

### Fairness: can the AI be beaten?

Three scripted player policies run on the same engine and play 12 fixed seeds
against each tier. The sim is deterministic, so CI reproduces these exact numbers.

- **competent:** Boom at Hard timing
- **intermediate:** Turtle at Easy timing
- **novice:** Rush, deliberately *slower* than the Easy AI (see below)

| Player win rate | competent | intermediate | novice |
|---|---|---|---|
| vs **Easy** | 100% | 50% | 0% |
| vs **Normal** | 100% | 17% | 0% |
| vs **Hard** | 67% | 0% | 0% |

A competent player beats every tier, a novice loses to all three, and each
policy's win rate falls from Easy to Hard.

**Phase 3 change to the novice.** Phase 2 defined the novice as "Rush at Easy
timing", which is exactly the Easy AI's own script and timing. Once the side
bias was fixed, novice-vs-Easy became a pure mirror, a coin flip. The novice is
now slower than the Easy AI on every axis:

- a decision every 4 s (Easy: 2.5 s)
- 6 s after each opening step (Easy: 2 s)
- reactions after 40 s (Easy: 25 s)
- 60% of the worker target (Easy: 70%)

## Balance notes

The full numbers and method are in [BALANCE.md](BALANCE.md).

- **Before Phase 3.** The strategies formed a strict hierarchy (Boom > Turtle
  > Rush), with every matchup 94–100% one way.
- **Tuning.** Phase 3 tuned the strategy data to within about 40–60% in 17 of
  18 matchups across the three tiers, before the difficulty cap below. The exception is **Turtle beating Rush
  about 80% at Hard** (77% on seeds 1–100, 81% pooled over 200 seeds): three strategies form a rock-paper-scissors triangle, and
  every lever that fixed that cell broke another. At Hard, part of the
  difficulty comes from which matchup you draw. That is a documented design
  trade-off, and you can pick the AI's strategy on the start screen.
- **Balance vs difficulty.** Balanced strategies removed the strength gap the
  difficulty tiers relied on. Difficulty now also caps the AI's Foundries
  (Easy 1, Normal 2). That keeps the fairness table above true, at the cost
  of strategy balance at Easy and Normal, where Rush suffers most under the
  cap (Turtle beats it 99% at Easy).
- **Side bias.** The Boom mirror's east skew came from unmirrored tie-breaks.
  It is fixed, and mirror matches now split 50/50.

The headless tests load the exact PathFinding.js bundle the CDN serves, so they exercise the library build that ships.
