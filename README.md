# Dragonmarch

A mini real-time strategy game of knights and dragons that runs in the browser.
Raise a Castle, dig gold, train Horsemen, Archers, Shield Knights and Dragon
Riders, and **storm the enemy Castle** before the scripted AI opponent takes
yours. The **sandbox** (no opponent) is still available from the start screen.
See [PROJECT.md](PROJECT.md) for the roadmap and scope. It was built in phases:
a sandbox, an AI opponent, balance and polish, touch controls with sprite art
drawn in code (Phase 4), the fantasy reskin with a wider zoom range
(Phase 5), and a **four-camp free-for-all** with territory and conquest
(Phase 6).

**Play:** https://piratekinginc.github.io/test-m8/ (desktop with mouse and keyboard, or a phone/tablet with touch; landscape recommended)

It's a static site with no build step. [Phaser 3](https://phaser.io) and
[PathFinding.js](https://github.com/qiao/PathFinding.js) load from the jsDelivr CDN.
All art is drawn in code, and all audio is synthesized with the Web Audio API.

## Playing against the AI

The start screen asks for a **difficulty** and, optionally, which **strategy** the AI
plays (Auto uses the tier's default). Both sides play the same mirrored map with the
same units, buildings, costs, build times, pathing and a **60-supply population
cap**, so the AI gets no special treatment. You win by destroying the enemy's last
completed **Castle**, and you lose if yours falls. At **30:00** the match ends
on score.

| Difficulty | Default AI strategy | Execution |
|---|---|---|
| Easy | Stone Bastion | at most 1 Barracks; decides every 2.5 s, +2 s after each opening step, reacts to scouting after 25 s, 70% of its worker target |
| Normal | Warband Raid | at most 2 Barracks; every 1.2 s, +2 s per step, reacts after 10 s, 90% of workers |
| Hard | Merchant Kingdom | the strategy's own Barracks count; every 0.5 s, no step delay, reacts after 3 s, full economy |

**Easy and Normal are handicapped, not just "playing worse".**
- **The cap.** The Easy AI may run only **one Barracks**, and the Normal AI
  **two**. Your own production is never capped. That is an economic handicap
  on the AI: it can't turn its income into an army as fast as you can.
- **Why.** It's the main thing that makes Easy easy. In Phase 2 the tiers
  differed mostly in how strong a script each one played. Phase 3 balanced
  the scripts, and timing alone turned out not to change results much.
- **Hard is uncapped.** It plays Merchant Kingdom with its full Barracks count
  and the sharpest timing.
- **What difficulty never does.** It never gives the AI information or
  resources, and it never changes the rules.
- **Easy's default is Stone Bastion.** It's a patient opponent: a player who
  builds a basic defense survives it, which in the balance runs meant holding
  out to the 30:00 limit in 33 of 40 games. But it punishes an early all-in
  raid. See [BALANCE.md](BALANCE.md).

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
  - **Warband Raid:** a lean economy and up to five Barracks of Horsemen and
    Archers with a few Dragon Riders. It sends raids of about 14, then 10, and
    reinforces in groups.
  - **Merchant Kingdom:** a greedy opening of ten Peasants and two Storehouses
    before its first Barracks, then a mixed army. It attacks at about 34 army
    supply and falls back when an attack is broken.
  - **Stone Bastion:** two Watchtowers in its opening and up to four in all,
    two Barracks, and an Archer / Shield Knight / Dragon Rider army that
    attacks at about 30 army supply.
  - **Attack timing varies.** Each attack's size threshold varies by ±30%, drawn
    from the AI's own seeded RNG, so the timing can't be learned and
    exploited.
- **Expansion (Phase 3).** Home gold mines run dry by about 5 minutes. Each
  strategy then claims an uncontested middle gold field when its data-defined
  trigger fires: a timer plus a minimum Peasant count or army size, or the
  home field dropping below 35%. It builds a Storehouse there, moves Peasants
  over and defends the field:
  - **Warband Raid:** 3 guard units
  - **Merchant Kingdom:** a Watchtower and 2 guards
  - **Stone Bastion:** 2 Watchtowers

  It never expands where it has seen enemy buildings or recent enemy soldiers,
  and it moves on when a field is mined out.
- **Attack targeting (Phase 3).** Attacks go for the nearest enemy Castle the
  AI has actually *seen*. If none is known, they go to the enemy start. If
  that turns out empty, they go to the enemy buildings it remembers, and
  otherwise sweep the enemy half.
- **Scouting and reactions** (`src/ai/scout.js`). The AI only knows what it sees:
  enemies within 16 tiles of its buildings or 7 tiles of its units, plus one scout
  Peasant sent to your lands. It remembers unit sightings for 90 s, and remembers
  buildings until it sees their spot empty. It reacts in two ways:
  - An **early raid** (2+ of your soldiers at its base before 5:00) sends it
    into defend mode. It recalls its attack, fights at home, builds counters
    and adds a Watchtower.
  - **Massing** one unit type (5+ of it, and a majority of what it has seen) makes
    70% of its production that type's counter from the counter table.

## Free-for-all (Phase 6)

Pick **Free-for-all (4 camps)** on the start screen. You are one of four camps
on a larger map; the other three are AI camps at the chosen difficulty.

- **The map.** 96 × 96 tiles, a 3 × 3 grid of zones walled off from each other
  with gates. The four camps sit in the corners, each laid out like the 1v1
  base: you are **Azure** (north-west), **Crimson** (north-east) plays Warband
  Raid, **Rose** (south-east) plays Merchant Kingdom, **Jade** (south-west)
  plays Stone Bastion. The five other zones are neutral, each with a gold field
  (four mines on the edges, six in the Centre).
- **Territory.** Every zone has an owner, shown as a tint and border in the
  owner's colour with a banner (visible down to the 0.35× zoom). Your home zone
  is yours while your Castle stands. Any other zone becomes yours once you are
  the **only** camp with military presence there (soldiers, a finished
  Watchtower or a Castle; Peasants don't count) for **5 seconds**. A zone with
  two camps in it is contested and flashes; an empty zone keeps its owner.
- **Conquest and loot.** A camp whose last Castle falls is eliminated: its
  units and buildings are razed. The camp that landed the killing blow on that
  Castle **takes its banked gold and every zone it owned**, at once. (Taking
  buildings intact or turning units is not in the game yet.)
- **Winning.** The last camp standing wins. At **30:00** the camp with the most
  zones wins, then the higher score; a tie on both is a draw. If your camp falls,
  the match goes on without you: watch the rest or play again.
- **The top bar** shows your zones and how many camps remain; toasts announce
  zones you take or lose and every fall, with the loot.
- **Spacing.** The nearest camps are an 82-second round trip apart for a full
  army (measured with the game's own pathfinding), while an undefended Castle
  falls to a 14-unit raid in 9 seconds: marching out leaves home open.
  Details in [PHASE6_SPEC.md](PHASE6_SPEC.md).
- **How the AI camps choose a target (Phase 7).** Each AI camp ranks every
  living rival from what it has **actually scouted**: the army it has seen
  (and seen die), the rival's zones, whether it **watched** that rival fight a
  third camp, whether the rival is hitting it, how damaged the rival's Castle
  looked, and the measured march time. It piles on a rival it saw weakened or
  busy elsewhere; it will not march on a rival that is clearly stronger
  (1.5× its own army), and uses a ready army to **claim a free zone** instead,
  or stays home. It sends a small squad to defend a zone it holds, or to
  retake one it just lost. The exact formula is in
  [PHASE7_SPEC.md](PHASE7_SPEC.md). The AI camps still build and train
  exactly as before.
- **Fresh intel and attacks (Phase 8).** A camp's read on a rival goes stale:
  after 45 s without seeing any of the rival's units or buildings it trusts
  it less and less, and after 150 s it treats that rival as an unknown equal
  again. So once its first scout is back, a camp sends a Peasant to look
  again at the rival it knows least about (its current target first), at
  most every 2 minutes. Boom (Merchant Kingdom) and Turtle (Stone Bastion)
  camps also attack early, with a smaller army, when their target is an
  opportunity: seen weakened, busy fighting someone else, or with a damaged
  Castle.
- **Balance.** Every corner arrangement of the three strategies has been
  played 200 times each (1,800 matches at Hard): no strategy wins more than
  about half of the free-for-alls (Warband Raid 25%, Merchant Kingdom 29%,
  Stone Bastion 46%; with one strategy doubled in each game, an even share
  is 33%) and no corner more than 28%. See [BALANCE.md](BALANCE.md).
- **Watching the AI think.** Press <kbd>`</kbd> (backtick) in a free-for-all to
  open the dev panel: it lists each AI camp's posture (attacking, claiming,
  holding, any zone squad) and its ranking of rivals, best first, with the
  score and the reasons. It is a verification view, not part of the HUD.

## Controls

The game takes mouse and keyboard, or touch; both work in the same build. On a
touch device an **action bar** appears on the right of the screen (see
[Touch controls](#touch-controls-phones-and-tablets)).

### Mouse and keyboard

| Input | Action |
|---|---|
| Left-click / Shift+click | Select, or add to / remove from the selection |
| Left-drag | Box-select your units (Shift adds) |
| Right-click | Context command: move in formation, **attack** an enemy, **dig** at a gold mine (Peasants), return gold at a Storehouse, help build an unfinished building. With a Castle or Barracks selected, it sets the rally point. |
| **A**, then left-click | Attack-move |
| **S** | Stop |
| **Shift+1–9** (or Ctrl+1–9) | Assign a control group. Desktop Chrome swallows Ctrl+1–8 for tab switching, so Shift is the primary key. The **Fullscreen** button turns on Keyboard Lock so Ctrl works too, and the HUD group bar assigns on right-click or Shift-click. |
| **1–9** / click a group slot | Select a control group (press twice to center the camera) |
| **Q W E R** with a Peasant selected | Place a Castle, Storehouse, Barracks or Watchtower. Left-click places it, Shift+click places several, and Esc or right-click cancels. |
| **Q** with the Castle selected | Train a Peasant |
| **Q W E R** with the Barracks selected | Train a Horseman, Archer, Shield Knight or Dragon Rider |
| Click a queue slot / **Backspace** | Cancel that item / the last queued item (100% refund) |
| **X** | Cancel an unfinished building (75% refund) |
| Arrow keys, screen edge, middle-drag | Pan the camera. **Home** recenters on the Castle. |
| **Mouse wheel** | Zoom in and out about the cursor (0.35×–1.6×, the same range as pinch on touch) |
| **Space** | Jump the camera to where your lands were last attacked |
| **M** | Mute or unmute |
| **Help** (top bar) | Show the first-run tutorial hints again |
| **\`** (backtick) | Dev panel, for verification only: spawns **training dummies** and team-2 units; in a free-for-all it also shows each AI camp's rival ranking (Phase 7). |

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
| **➜ Order**, then tap | The same smart order as a right-click: move there, attack the enemy you tapped, dig at the gold mine you tapped, help build a site, or set a Castle/Barracks rally point |
| **⚔ Attack**, then tap | Attack-move there |
| **■ Stop** / **✕ Cancel** | Stop the selected units / disarm the armed order or a placement |
| **⌂ Base** | Center the camera on your Castle |
| Build button (Peasant selected), then touch and drag | The building's outline follows your finger; lift to place it |
| Unit button (Castle/Barracks selected) | Train that unit |
| Group slot: **tap** / **press and hold** | Select that group (tap twice to jump to it) / save the selection as that group |
| The under-attack alert | Tap it to jump there |
| **Sound on/off**, **Fullscreen**, **Help** | Toggle sound, go fullscreen, replay the tutorial |

**While an order is armed,** the button glows, a banner at the top says what
the next tap will do, and the selected units pulse.

**First visit.** The tutorial teaches whichever controls you're using, and the
panel at the bottom always says what the selection can do.

**Testing so far.** Touch was tested in Chrome's mobile emulation
(Playwright), not on real phones.

### Zoom (Phase 5)

The camera zooms from **0.35×** out to **1.6×** in, with pinch on touch and
the mouse wheel on desktop. The minimum was measured, not guessed: a fully
built home base (every building an AI strategy put up in 600 s on Hard, plus
its six gold mines) is at most 832 × 704 world pixels; with a tile of margin
that is 896 × 768. A phone in landscape (844 × 390) leaves 726 × 273 pixels
between the top bar, the bottom panel and the action bar, which fits that box
at 0.355×. A 1280 × 720 desktop window fits it at 0.76×. So 0.35× shows a
whole base on both. Zoomed out, units are drawn up to 2× larger so they stay
readable (visual only). Details in [PHASE5_SPEC.md](PHASE5_SPEC.md).

### Art

Every sprite is drawn in code (`src/art/`) and baked into textures when the
game starts; there are no image files. The look is medieval: stone castles and
watchtowers, timber and thatch, banners in the team colour (**Azure** for you,
**Crimson** for the AI), a meadow with stone cliffs, and gold mines. This
covers:

- the units, in each team's colour, with arrows for Archers and Watchtowers
  and fire for the Dragon Rider
- the buildings, in each construction state (a roped-off plot, a timber
  scaffold, the finished building)
- the gold mines, which thin out as they are worked, and the terrain
- the title-screen emblem: a gold dragon on a shield of both team colours

**Reference sheet.** It shows everything side by side at the in-game zoom
levels 1×, 0.5× and the 0.35× minimum:

- **Saved image:** [`docs/reference-sheet.png`](docs/reference-sheet.png)
- **Live page:** https://piratekinginc.github.io/test-m8/sheet.html
- **Regenerate it:** `node tools/reference-sheet.mjs`

## Roster

The single resource is **gold**. Peasants dig 8 gold per 2 s trip at a gold
mine and carry it to a **Storehouse**; the Castle is not a drop-off.

| Unit | Role | HP | Armour | Damage / cooldown | Range | Speed | Cost | Train |
|---|---|---|---|---|---|---|---|---|
| Peasant | worker | 40 | light | 4 sword / 1.0 s | melee | 72 | 50 | 10 s (Castle) |
| Horseman | light cavalry | 100 | light | 10 sword / 0.6 s | melee | 85 | 60 | 12 s (Barracks) |
| Archer | ranged | 65 | light | 15 arrow / 0.75 s | 176 | 70 | 70 | 14 s (Barracks) |
| Shield Knight | heavy infantry | 300 | plate | 14 mace / 1.0 s | melee | 50 | 150 | 22 s (Barracks) |
| Dragon Rider | anti-armour | 120 | light | 26 dragonfire / 1.4 s | 128 | 60 | 110 | 18 s (Barracks) |

| Building | Size | HP | Cost | Build | Role |
|---|---|---|---|---|---|
| Castle | 4×4 | 1500 | 400 | 60 s | Your seat; trains Peasants |
| Storehouse | 3×3 | 600 | 100 | 20 s | Gold drop-off, +8 supply |
| Barracks | 3×3 | 800 | 150 | 30 s | Trains the army |
| Watchtower | 2×2 | 500 | 120 | 25 s | Tower: 14 arrow / 0.8 s, 224 range |

**Counters:**
- A Horseman beats an Archer up close, and an Archer beats a Horseman at range.
- A Shield Knight beats both of them.
- A Dragon Rider's fire melts a Shield Knight's plate.
- Horsemen and Archers both beat Dragon Riders.

The full damage table is in [SPEC.md](SPEC.md) (under the internal names below).

## Display text and gameplay data (Phase 5)

Phase 5 is a **reskin**: every unit, building and strategy kept its exact
stats, costs, times, damage, counters and behaviour; only names, descriptions
and art changed. To keep that provable, the two kinds of data live apart:

- **`src/data/`** holds only gameplay values: stats, costs, times, counters,
  strategy scripts and thresholds, difficulty timings, the map. It is frozen.
- **`src/theme/names.js`** holds every player-facing word: unit, building,
  resource, strategy and difficulty names, roles and descriptions, the attack
  and armour words, and the translation of the sim's messages. A reskin
  changes only this file (and the art).
- **`test/freeze.test.js`** pins `src/sim` and `src/ai` byte for byte, pins
  the gameplay data files, and checks a canonical hash of every gameplay value
  that was recorded on the Phase 4 release before the split, plus fixed-seed
  match fingerprints (positions, HP, orders) from Phase 3.

<!-- internal-names -->
### Internal names

The code, the tests, the data files and the design docs (SPEC.md, BALANCE.md,
PROJECT.md) keep the internal ids and the Phase 1–4 codenames. They map to what
the player sees like this:

| Internal id | Codename (Phase 1–4) | Player sees |
|---|---|---|
| resource | Lumen | Gold |
| node | Lumen Crystal | Gold Mine |
| `core` | Command Core | Castle |
| `depot` | Lumen Depot | Storehouse |
| `foundry` | Foundry | Barracks |
| `spire` | Sentry Spire | Watchtower |
| `drone` | Drone | Peasant |
| `striker` | Striker | Horseman |
| `sparker` | Sparker | Archer |
| `bulwark` | Bulwark | Shield Knight |
| `lancer` | Lancer | Dragon Rider |
| `dummy` | Test Target | Training Dummy |
| attack `blade` / `bolt` / `crush` / `lance` | – | sword / arrow / mace / dragonfire |
| armour `light` / `heavy` / `structure` | – | light / plate / stone |
| strategy `rush` / `boom` / `turtle` | Rush / Economy-Boom / Turtle-and-Tech | Warband Raid / Merchant Kingdom / Stone Bastion |
| game | Prism Outpost | Dragonmarch |
<!-- /internal-names -->

## Run locally

```bash
npm install          # dev dependencies only (tests); the game itself needs nothing
npm run serve        # http://localhost:8080 (or open index.html via any static server)
```

## Tests

```bash
npm test             # headless sim tests (node --test)
npm run test:e2e     # Playwright browser tests, desktop and mobile emulation (npx playwright install chromium first)
npm run test:mobile  # the touch-only playthroughs, 1v1 and free-for-all (their own CI job)
node tools/travel.mjs  # the free-for-all camp spacing measurement
node tools/symmetry.mjs  # every free-for-all march vs its mirror twins (median of 24)
node tools/mirror-trace.mjs boom 120  # first tick a camp and its mirror twin differ
node tools/ffa-balance.mjs --seeds 100 --out balance/ffa-latest.json  # four-camp balance, 900 matches (about an hour)
```

Add `?speed=N` to the URL to run the game N× faster (up to 16×). The mobile
playthrough test uses it.

```bash
npm run test:fairness  # bot-vs-difficulty win rates (about 2.5 min, 108 full matches)
npm run balance -- --seeds 100 --out balance/latest.json    # full strategy matrix (1,800 matches, ~20 min on 4 CPUs)
npm run balance -- --seeds 150 --mirrors --out balance/m.json  # side-bias check: mirror matches only
npm run balance -- --seeds 100 --offset 1000 --tiers hard   # a disjoint seed set, one tier
```

CI runs the headless, browser and fairness suites and the mobile playthrough
on every push and PR, with fairness and the playthrough as parallel jobs. The
headless suite includes one full bot-vs-bot match played to a result. The
batch runner is a tool, not a CI job; its results are committed in `balance/`
and reported in [BALANCE.md](BALANCE.md). Every merge to `main` runs the
tests, deploys to GitHub Pages, and polls the live URL until it serves that
exact commit.

| Suite | What it proves |
|---|---|
| `test/pathfinding.test.js` | Units route around rock, buildings and blocked or unreachable goals, and nobody stays stuck forever |
| `test/stress.test.js` | 40 units cross the map, 20 vs 20 cross head-on through a chokepoint, and 35 units handle 6 random orders. All arrive with no lasting overlap, at about 0.2 ms per sim step. |
| `test/economy.test.js`, `test/production.test.js`, `test/construction.test.js` | The gather rate matches the spec formula, costs, build times, FIFO queues and refunds |
| `test/counters.test.js` | Each counter row is checked with 50 seeded 1v1s (≥ 80% required, and each currently wins 100%) |
| `test/selection.test.js`, `e2e/selection.spec.js`, `e2e/combat.spec.js` | Drag-box, control groups, formation moves, attack and attack-move |
| `test/bot.test.js` | The Phase 1 sandbox bot (now a preset of the AI engine) builds every building, trains one of each unit, and beats a squad of training dummies |
| `test/supply.test.js` | Both teams are capped identically. Storehouses raise the cap to the max of 60, and queued production reserves supply. |
| `test/match.test.js`, `e2e/match.spec.js` | Map symmetry. Destroying either Castle ends the match with the right result screen; mutual loss is a draw; the time limit always decides. |
| `test/spatial.test.js` | Enemy scanning via the spatial index matches brute force exactly. A 200-unit battle runs at about 1.8 ms per step. |
| `test/ai.test.js` | The AI acts only through `world.issue()`, and five deliberately cheating AIs are caught by the read-only guard |
| `test/playthrough.test.js` | Each strategy plays a full match against a fixed player script, and wins by destroying an undefended Castle |
| `test/scouting.test.js` | Early-raid and massing reactions for every unit type trigger when they should and not otherwise, within the AI's limited sight |
| `test/difficulty.test.js`, `e2e/menu.spec.js` | Harder tiers execute the same script faster and react sooner. The start screen launches matches and shows the title and the dragon emblem. |
| `test/fairness/` | Scripted player policies vs every tier over 12 seeds (see below) |
| `test/sidebias.test.js` | East-half tie-breaks are the mirror image of the west: spiral order, A* paths and spawn side. Jitter-free mirror matches of each strategy stay an exact mirror for 90 s. |
| `test/expansion.test.js` | Each strategy expands under its trigger with Peasants and a defense; it never builds in a field the enemy holds; attacks find and destroy a relocated, scouted Castle |
| `test/balance.test.js` | The batch runner's pieces, plus one full bot-vs-bot match played to a result |
| `test/audio.test.js`, `test/stats.test.js`, `test/tutorial.test.js`, `e2e/polish.spec.js` | Every sim event has a sound; the result-screen stats add up; the first-run tutorial advances, persists, and works with storage blocked |
| `test/freeze.test.js` | The freeze guard: `src/sim` and `src/ai` byte-identical to Phase 3, the gameplay data files pinned, a canonical hash of every gameplay value unchanged since the Phase 4 release, and fixed-seed games (positions, HP, orders) playing out exactly as before |
| `test/theme.test.js` | Every unit, building, strategy and difficulty has display text in `src/theme`, and `src/data` carries none |
| `test/oldnames.test.js`, `e2e/oldnames.spec.js` | No Phase 1–4 name reaches the player: UI string literals, the HTML pages, every theme string and translated sim message, the running game's menu, HUD, tooltips, toasts and result screens, every tutorial step, and this README outside the internal-names table |
| `test/footprint.test.js`, `e2e/zoom.spec.js` | Every strategy's full base fits the measured footprint; the wheel zooms about the cursor between 0.35× and 1.6×; at 0.35× a real AI-built base fits the free screen on a 1280 × 720 desktop and an 844 × 390 phone |
| `e2e/touch.spec.js` | Real touch events in mobile emulation: tap, double-tap, Box, pan, pinch, Order (move, attack, gather, rally), Attack-move, Stop, Cancel, placement, group hold/tap, the alert tap, and the whole touch tutorial |
| `e2e/art.spec.js` | Unit silhouettes differ from each other at 0.5× and 0.35× zoom. Every building differs across its construction states, and Storehouse and Barracks differ in every state. Team colours are present and not mixed. The reference sheet renders. |
| `e2e/mobile-playthrough.spec.js` (`npm run test:mobile`, its own CI job) | A whole match against the Easy AI played with touch events only, to its end, in the 1v1 and in the free-for-all (where the bot watches the rest if its camp falls). It uses every touch control: placement, training, rally, Box plus group hold, pinch, Order and Attack. This simple scripted player usually *loses*; the test proves touch can play a whole game, not that it wins one. |
| `test/teams.test.js` | The team model is a list: a three-way fight resolves; the AI treats every other team as a rival and retargets when its target falls |
| `test/freeze.test.js` (Phase 6 part) | The 1v1 match run through the N-team code reproduces eleven full-match fingerprints recorded on the Phase 5 code before the refactor |
| `test/ffa-map.test.js`, `test/travel.test.js` | The free-for-all map: size, symmetry in both axes, no overlaps, everything reachable; the nearest camps' army round trip is at least 5 times an undefended Castle's lifetime |
| `test/territory.test.js`, `e2e/ffa.spec.js` | Zone capture by sole military presence after 5 s, contested zones, empty zones keep their owner, Peasants don't capture, home zones locked; the overlay shows each owner's colour at 1× and 0.35×; the free-for-all HUD, fall screen and standings |
| `test/capture.test.js` | Eliminating a camp with X gold and Y zones gives the conqueror exactly +X gold and +Y zones, and no other camp anything |
| `test/ffa-win.test.js` | Last camp standing, simultaneous falls, and every time-limit case end with a declared result |
| `test/ffa-playthrough.test.js` | A full four-camp free-for-all, every camp scripted, played to its result with eliminations that capture land and loot |
| `test/rivals.test.js` | Phase 7 rival assessment: scripted opportunism (a rival seen at 20% after fighting another outranks the nearest full-strength one; engaged, damaged-Castle and seen-dying rivals score up) and caution (a clearly stronger rival is never the target); only what is inside the camp's eyes counts; the travel table matches a fresh measurement |
| `test/targeting.test.js` | Waves march on the pick, turn on a rival seen weakened (not on noise, not within 20 s), claim free zones when every rival is clearly stronger, hold with nothing to claim; the read-only guard catches the targeting code writing game state |
| `test/defense-ffa.test.js`, `test/zones-hold.test.js` | Early-rush defense with raiders from two camps and for every corner; massing judged per rival; zone squads defend a zone being taken, retake a zone lost in the last 90 s, don't take on a much bigger force, and go home |
| `test/ffa-rivals.test.js`, `test/devai.test.js`, `e2e/ffa.spec.js` | Full free-for-alls with the Phase 7 AI compared with Phase 6 on the same seeds; the dev panel targeting view |
| `test/symmetry-ns.test.js` | Phase 8: the free-for-all's north-south mirror — spiral, A* under both mirrors, approach tile, spawn corner, 90 s mirror-exact games for each strategy, diagonal marches equal |
| `test/stale-intel.test.js`, `test/attack-trigger.test.js` | Phase 8: intel confidence over time, no acting on a stale "weak" read, a re-scout that catches a rebuilt army; Boom/Turtle opportunity waves |
| `test/ffa-balance.test.js` | Phase 8: the four-camp batch runner's arrangements, mirror classes and match records |
| `e2e/tapzoom.spec.js` | Rapid taps never trigger the browser's double-tap zoom and each counts; the game's pinch still works |
| `e2e/groups.spec.js` | Control groups without the browser's reserved Ctrl+1–8: Shift+digit, the HUD group bar, and Fullscreen with Keyboard Lock |

### Fairness: can the AI be beaten?

Three scripted player policies run on the same engine and play 12 fixed seeds
against each tier. The sim is deterministic, so CI reproduces these exact numbers.

- **competent:** Merchant Kingdom at Hard timing
- **intermediate:** Stone Bastion at Easy timing
- **novice:** Warband Raid, deliberately *slower* than the Easy AI (see below)

| Player win rate | competent | intermediate | novice |
|---|---|---|---|
| vs **Easy** | 100% | 50% | 0% |
| vs **Normal** | 100% | 17% | 0% |
| vs **Hard** | 67% | 0% | 0% |

A competent player beats every tier, a novice loses to all three, and each
policy's win rate falls from Easy to Hard.

**Phase 3 change to the novice.** Phase 2 defined the novice as "Warband Raid
at Easy timing", which is exactly the Easy AI's own script and timing. Once
the side bias was fixed, novice-vs-Easy became a pure mirror, a coin flip. The
novice is now slower than the Easy AI on every axis:

- a decision every 4 s (Easy: 2.5 s)
- 6 s after each opening step (Easy: 2 s)
- reactions after 40 s (Easy: 25 s)
- 60% of the worker target (Easy: 70%)

## Balance notes

The full numbers and method are in [BALANCE.md](BALANCE.md) (under the
internal names).

- **Before Phase 3.** The strategies formed a strict hierarchy (Merchant
  Kingdom > Stone Bastion > Warband Raid), with every matchup 94–100% one way.
- **Tuning.** Phase 3 tuned the strategy data to within about 40–60% in 17 of
  18 matchups across the three tiers, before the difficulty cap below. The
  exception is **Stone Bastion beating Warband Raid about 80% at Hard** (77% on
  seeds 1–100, 81% pooled over 200 seeds): three strategies form a
  rock-paper-scissors triangle, and every lever that fixed that cell broke
  another. At Hard, part of the difficulty comes from which matchup you draw.
  That is a documented design trade-off, and you can pick the AI's strategy on
  the start screen.
- **Balance vs difficulty.** Balanced strategies removed the strength gap the
  difficulty tiers relied on. Difficulty now also caps the AI's Barracks
  (Easy 1, Normal 2). That keeps the fairness table above true, at the cost
  of strategy balance at Easy and Normal, where Warband Raid suffers most
  under the cap (Stone Bastion beats it 99% at Easy).
- **Side bias.** The Merchant Kingdom mirror's east skew came from unmirrored
  tie-breaks. It is fixed, and mirror matches now split 50/50.

The headless tests load the exact PathFinding.js bundle the CDN serves, so they exercise the library build that ships.
