# Phase 5 — Fantasy reskin and zoom range

Phase 5 was not in the original plan. Playtest feedback asked for two things:
the game should read as a **fantasy game of knights and dragons**, and the
camera should zoom out far enough to see a whole base and what surrounds it.

It is a **reskin**. Every unit, building and AI strategy keeps its exact
stats, costs, build and train times, damage, counters and behaviour. Only
names, descriptions and the code-drawn art change. The sim (`src/sim`), the AI
(`src/ai`) and every gameplay number in `src/data` stay frozen, and the freeze
guard proves it (see "Display text and gameplay data" below).

Out of scope, as ordered: any change to a stat, cost, time, damage number,
counter, AI strategy logic or threshold, or balance number; any change to the
touch or desktop controls beyond the zoom range; new gameplay features, units,
buildings or map changes; real device testing (Playwright emulation only, a
known and accepted limitation); the Phase 4 mobile-difficulty finding (it stays
in BACKLOG.md). No runtime dependencies, no build step, no image or audio
files: all art is still drawn in code.

## Naming

The game is now called **Dragonmarch**: two rival keeps on a borderland march,
each with knights, archers and a dragon rider. Internal identifiers (`drone`,
`core`, `rush`, the `Lumen` wording inside `src/sim` and `src/ai`, file and
test names) do not change: they are code, not what the player reads. Every
player-facing string comes from `src/theme/`.

| Internal id | Phase 1–4 name | Fantasy name | Role, as the art shows it |
|---|---|---|---|
| resource | Lumen | **Gold** | Coins in the top bar; gold ore in the mines |
| node | Lumen Crystal | **Gold Mine** | A rocky outcrop with gold veins; shrinks as it is mined |
| `core` | Command Core | **Castle** | Stone keep with four corner towers and a team banner; trains Peasants |
| `depot` | Lumen Depot | **Storehouse** | Timber granary with a thatched roof; drop-off for gold, adds supply |
| `foundry` | Foundry | **Barracks** | Long timber hall with a team-coloured roof and a weapon rack; trains the army |
| `spire` | Sentry Spire | **Watchtower** | Round stone tower with battlements; shoots arrows |
| `drone` | Drone | **Peasant** | Worker in a plain tunic with a pickaxe; carries a gold sack |
| `striker` | Striker | **Horseman** | Light cavalry: a horse with a sword-armed rider. Fast, strikes hard up close |
| `sparker` | Sparker | **Archer** | Hooded archer with a longbow. Fragile, shoots from range |
| `bulwark` | Bulwark | **Shield Knight** | Plate-armoured knight behind a tower shield, with a mace. Big, slow, tough |
| `lancer` | Lancer | **Dragon Rider** | A small dragon with spread wings and a rider. Its dragonfire melts plate |
| `dummy` | Test Target | **Training Dummy** | Verification only (dev panel) |

Attack and armour words in tooltips:

| Internal | Fantasy word |
|---|---|
| `blade` (Peasant, Horseman) | sword |
| `bolt` (Archer, Watchtower) | arrow |
| `crush` (Shield Knight) | mace |
| `lance` (Dragon Rider) | dragonfire |
| armour `light` / `heavy` / `structure` | light / plate / stone |

AI strategies get display names only. Their ids (`rush`, `boom`, `turtle`) and
logic are unchanged in code, tests and data files.

| Internal id | Phase 2–4 name | Fantasy name |
|---|---|---|
| `rush` | Rush | **Warband Raid** |
| `boom` | Economy-Boom | **Merchant Kingdom** |
| `turtle` | Turtle-and-Tech | **Stone Bastion** |

Difficulty names (Easy, Normal, Hard) and the word *supply* stay: both are
already neutral. The player's team is **Azure** (royal blue), the opponent's
**Crimson** (a vermilion red).

## Art direction

- **Palette.** Medieval and muted: meadow green-brown ground, grey stone,
  warm timber, straw thatch, iron, and gold as the one bright accent (it is the
  resource). Team colour appears on banners, roofs, tabards and shields.
  Azure `#3f86e8` against Crimson `#e0472f` differ in hue and lightness for
  red-green colour-blind players, and both stand apart from the green ground.
- **Architecture.** Stone for the Castle and Watchtower, timber and thatch for
  the Storehouse and Barracks. Every building carries a team banner or roof.
  The three construction states from Phase 4 stay (foundation, frame,
  complete), redrawn as a staked, roped-off plot marked with the building's
  sign (a keep, a grain sack, crossed swords, a tower), the lower half going up
  inside a timber scaffold, and the finished building.
- **Units** keep one silhouette each, readable at the minimum zoom: the
  Horseman is long (a horse), the Archer is a thin figure with a bow arc,
  the Shield Knight is wide (a tower shield), the Dragon Rider has spread
  wings, the Peasant is small with a pickaxe.
- **Dragon motif.** The Dragon Rider is the most striking unit, and a dragon
  emblem drawn in code heads the title screen above the game name.
- **Terrain.** Grassy ground with dirt patches; impassable rock becomes grey
  stone cliffs; gold mines replace the crystals.
- **UI.** Dark wood panels, parchment-coloured text, gold accents and a serif
  system font stack (no web fonts: no external assets).
- **Effects.** Arrows for Archers and Watchtowers, a flame bolt for the Dragon
  Rider, the existing hit flashes and rubble. Effects stay visual only.

## Zoom range (measured)

The new **minimum zoom is 0.35×** (was 0.5×). The maximum stays 1.6×. Pan,
pinch and edge-pan are unchanged.

How it was measured:

1. **Base footprint.** Headless matches let each AI strategy build its full
   home base for 600 s on Hard against the passive `sentinel` script (seeds
   1–3). The bounding box of the home buildings plus the six home gold mines
   was at most **832 × 704 world px** (Stone Bastion, seed 2: 832 × 672;
   Warband Raid: 608 × 704). With one tile (32 px) of margin on each side the
   target is **896 × 768 world px**.
2. **Free viewport.** The screen area not covered by the HUD, measured in
   Chromium:
   - Phone landscape, 844 × 390: top bar 29 px, bottom panel 88 px, touch
     action bar from x = 726. Free area **726 × 273 px**.
   - Desktop 1280 × 720 (a small laptop window): top bar 29 px, bottom panel
     104 px. Free area **1280 × 587 px**. (1280 × 800: 1280 × 667.)
3. **Zoom that fits.** Phone: min(726 / 896, 273 / 768) = **0.355**. Desktop
   1280 × 720: min(1280 / 896, 587 / 768) = 0.76. The phone is the binding
   case, so the minimum is 0.35×.

At 0.35× the whole map width (2560 px) is almost visible on a phone.

**Desktop zoom.** Desktop had no zoom at all (a fixed 1×, and mouse-wheel zoom
was a Phase 4 backlog item). At 1× a desktop window cannot fit a full base
either (667 px of free height against 768 px). So that the zoom range
"applies to desktop and touch equally", Phase 5 adds **mouse-wheel zoom**
about the cursor, with the same 0.35×–1.6× range. It is the only control
change, and it only adds the zoom range; every existing mouse and keyboard
binding is unchanged.

**Camera bounds.** The camera may scroll a little past the map edges so the
HUD never hides them. Those margins were fixed world pixels (28 above, 104
below), which at 0.35× no longer covered the HUD. They are now the HUD's
screen size divided by the zoom (identical to Phase 4 at 1×), plus the width
of the touch action bar on touch devices. The phone base-fits test found this:
without it the east base stayed partly under the action bar.

**Legibility.** Units are drawn larger when zoomed out (visual only, from
Phase 4). The enlargement cap rises from 1.6× to 2×, so at 0.35× a unit
covers about as many screen pixels as it did at 0.5× in Phase 4. The Phase 4
distinctness tests (unit silhouettes, building states, team colours) run again
at the new minimum zoom.

## Display text and gameplay data

In Phase 1–4 the data files in `src/data` mixed gameplay numbers with display
text (`name`, `role`, `description`). A rename would have touched them, and
the freeze guard hashed whole files, so it would have failed. Phase 5 splits
them once, as its first slice:

- `src/data/*.js` keeps **only gameplay values**: stats, costs, times,
  footprints, counters, strategy scripts and thresholds, difficulty timings,
  the map. The `name`, `role` and `description` fields are removed. No number
  changes.
- `src/theme/` holds **every player-facing word**: unit, building, resource,
  strategy and difficulty names, roles, descriptions, attack and armour words,
  and the translation of the sim's rejection messages (for example the sim's
  `Not enough Lumen` is shown as "Not enough gold"). `src/sim` and `src/ai` are
  not touched, so their internal strings stay as they were.
- **Freeze guard** (`test/freeze.test.js`), strengthened rather than relaxed:
  - `src/sim` and `src/ai` stay pinned byte for byte to the Phase 3/4 hashes.
  - `src/data` files are pinned byte for byte to their new, split contents.
  - A **canonical gameplay hash**: every export of every `src/data` module,
    keys sorted, display fields dropped. It was recorded on the Phase 4
    release (commit f08f2d8) *before* the split and must match after it, so
    the split provably moved no number. Any later edit to a gameplay value
    fails it even if someone re-pins the file hashes.
  - The fixed-seed match fingerprints (positions, HP, orders, tick, resources)
    recorded on the Phase 3 release must still match exactly.

## Verification

- Full regression: `npm test`, `npm run test:e2e`, `npm run test:mobile`,
  `npm run test:fairness`, all green; the freeze guard passes.
- A browser test builds a full base and checks that it fits the free viewport
  at 0.35× on desktop and on a phone in landscape.
- The distinctness checks run at 0.35×.
- A test scans every player-facing surface (the menu, HUD, tooltips, tutorial
  steps, result screen, toasts, the reference sheet labels, README) for the old
  names (Lumen, Drone, Striker, Sparker, Bulwark, Lancer, Command Core, Depot,
  Foundry, Spire, Crystal, Prism Outpost, and the old strategy names).
- `docs/reference-sheet.png` is regenerated.
- The headless bot playthrough and the mobile touch playthrough re-run.

## Results

- **Gameplay unchanged.** The canonical gameplay hash
  `9fd621ee00b78dd2e7123d0492c21ba28d79c1e80cf0b60046ad1f92a0f11900` was
  recorded on the Phase 4 release (f08f2d8) before the split and still
  matches; `src/sim` and `src/ai` match their Phase 3 hashes; the fixed-seed
  fingerprints are unchanged (`sandboxBot 109126657f0ba006`,
  `rush-boom-hard-1 bf6f9c44c89a7af7`, `turtle-rush-normal-2 aa2d62efa10a9089`,
  `boom-turtle-easy-3 2aa5e3de88611963`). The fairness table is the same as
  Phase 4 (Easy 100/50/0, Normal 100/17/0, Hard 67/0/0).
- **Zoom.** A real AI-built base (600 s, Hard) fits the free screen at 0.35×
  on a 1280 × 720 desktop (wheel) and an 844 × 390 phone (pinch);
  `test/footprint.test.js` keeps every strategy's base inside 832 × 704.
- **Distinctness at 0.35×.** Unit silhouettes, building states, Storehouse vs
  Barracks and team colours pass the Phase 4 thresholds unchanged.
- **Old names.** None in the UI sources, the HTML, the theme strings, the
  translated sim messages, the running game's screens or the README.
- **Playthroughs.** The headless bot playthrough (`test/bot.test.js`) and the
  mobile touch playthrough (`npm run test:mobile`) pass. The touch bot still
  usually loses to Easy, which is the Phase 4 finding kept in BACKLOG.md.
- **Also fixed.** The touch tutorial e2e test had two timing races at 8×
  speed (reproduced on the Phase 4 code): the opponent's scout made a new
  Striker auto-attack before the touch order, and a short attack-move could
  finish between two tutorial checks. The test now idles the opponent (setup
  only), retries the unit tap, and marches farther.

## Slices

| # | Slice |
|---|---|
| 0 | Display-text / gameplay-data split and the strengthened freeze guard |
| 1 | Zoom range 0.35×, desktop mouse-wheel zoom, base-fits test, distinctness at 0.35× |
| 2 | Building art (Castle, Storehouse, Barracks, Watchtower) |
| 3 | Unit art (Peasant, Horseman, Archer, Shield Knight, Dragon Rider) and effects |
| 4 | Terrain, gold mines and the team palette |
| 5 | UI text pass (HUD, tooltips, tutorial, strategy text, result screen, toasts) and the old-name scan |
| 6 | Title screen with the dragon emblem, and the UI look |
| 7 | Reference sheet regenerated |
| 8 | README and docs, playthroughs, deploy |
