# Phase 6 — Free-for-all foundation

Player feedback asked for free-for-all play: several camps on one larger map,
each fighting for territory and resources. Eliminating a rival should pay: the
camp that lands the killing blow takes the loser's banked gold and its land.

Phase 6 builds the **foundation** for that: the N-team model, the map, the
zones and their ownership, and capture on elimination. It does **not** build
smart multi-rival AI (which rival to attack, piling on a weakened camp): that
is Phase 7. AI camps run the existing scripts with a deliberately simple,
**placeholder** targeting rule (below). N-way balance tuning is Phase 8.

The classic 1v1 match, the sandbox and every rule in them are unchanged. The
free-for-all is a new mode (`?mode=ffa`, "Free-for-all" on the start screen).

It also fixes an unrelated bug: rapid taps on a phone were read as the
browser's double-tap-to-zoom.

## Camp count: 4

- **Symmetry is fairness.** Four camps sit in the four corners of a square
  map that is mirror-symmetric in both axes, so every camp's position is the
  mirror image of every other's: same distances, same mines, same
  chokepoints. Five camps cannot be placed that way on a tile grid; one of
  them would always have a different neighbourhood.
- **Colours stay readable.** Four team colours can be kept far apart for
  every kind of colour vision (below) and from the grass and stone. A fifth
  colour would have to be close to one of the four or to the terrain.
- **The HUD and performance.** Four camps of up to 60 supply is at most 240
  units, inside the 200-unit battle budget measured in Phase 2 (1.8 ms a step)
  with room to spare, and a "3 rivals" readout fits the phone top bar.

## Team colours

| Team | Name | Colour | Camp |
|---|---|---|---|
| 1 | Azure | `#3f86e8` | north-west (the player) |
| 2 | Crimson | `#e0472f` | north-east |
| 3 | Rose | `#d45aa8` | south-east |
| 4 | Jade | `#40d0a0` | south-west |

Azure and Crimson are the Phase 5 colours, unchanged. Rose and Jade were
chosen by searching candidate colours for the largest worst-case difference
(CIELAB ΔE) between any two teams under normal vision and simulated
protanopia, deuteranopia and tritanopia (Machado 2009): the worst pair is
ΔE 26 (Azure vs Rose under protanopia), and Jade is at least ΔE 15 from the
grass, the stone, the thatch and the gold. An ivory white scored as well on
paper and was tried first, but in the sprites it could not be told apart
from lit steel and stone highlights, so the art test rejected it; Jade has a
hue of its own. The art distinctness test checks all four teams the way
Phase 4 checked two: each team's buildings carry its colour and none of the
others', and each unit's dominant team colour is its own, at 0.5× and 0.35×.

## Team model

- `world.teams` lists the camps in play: `[1]` in the sandbox, `[1, 2]` in
  the 1v1 match, `[1, 2, 3, 4]` in the free-for-all. Each team has its own
  stockpile (`world.resources[team]`), buildings and units, as before.
- Everything that asked "the other team" now asks "any other team": combat
  already did; the AI's scouting, intruder checks, attack targets and
  expansion contests do now.
- **Equivalence proof.** The 1v1 match runs through the same N-team code, with
  `teams = [1, 2]` and the same camp placement. Before any refactor, extra
  fixed-seed fingerprints were recorded on the Phase 5 code (more strategy
  pairs, every tier, longer matches, matches played to their result). The
  freeze guard requires the refactored code to reproduce every one of them
  exactly, alongside the Phase 3 fingerprints and the gameplay-values hash.
  `src/sim` and `src/ai` can no longer be byte-pinned to Phase 3 (they had to
  change); the fingerprints are the proof that behaviour did not.

## The free-for-all map (`src/data/ffa.js`)

- **96 × 96 tiles** (3072 × 3072 px), a 3 × 3 grid of 32 × 32-tile zones.
- **Camps** in the corner zones. Each camp is laid out exactly like the 1v1
  west base (Castle, four Peasants, six gold mines in an arc, the same build
  spots), mirrored to face the map centre:
  NW Castle at (8, 12), NE (84, 12), SE (84, 80), SW (8, 80).
- **Neutral zones** in the other five: North, West, East and South between
  each pair of neighbouring camps, and the Centre. Each has a gold field in
  the middle: four mines (the 1v1 middle-field layout) in the four edge zones,
  six in the Centre.
- **Stone walls** run along the zone borders with an 8-tile gap in the middle
  of every border, so armies move from zone to zone through gates.
- The map is mirror-symmetric in both axes.

```
+----------+----------+----------+
| NW camp  |  North   | NE camp  |
|  Azure   |  field   | Crimson  |
+---  ---- +---  ---- +---  -----+
|  West    |  Centre  |  East    |
|  field   |  field   |  field   |
+---  ---- +---  ---- +---  -----+
| SW camp  |  South   | SE camp  |
|   Jade   |  field   |  Rose    |
+----------+----------+----------+
```

### Spacing, measured by travel time

Placement was checked with the sim's own pathfinding, not straight-line
distance: `test/travel.test.js` (and `node tools/travel.mjs`) send a full army
from one Castle to the nearest rival Castle and back and time the last unit
home. The numbers and why they are enough are in "Results" below.

## Territory

- **Zones** are the nine map squares. Every zone has an owner at all times: a
  camp, or neutral.
- **Home zones** start owned by their camp and stay locked to it while its
  Castle stands. Neutral zones start neutral.
- **Military control.** Once a second (every 20 sim ticks) each unlocked zone
  counts which camps have *military presence* inside it: a combat unit, a
  completed Watchtower or a completed Castle. Peasants alone don't count (as
  in Phase 3's contested-field rule).
  - Exactly one camp present, and it isn't the owner: after it has held the
    zone alone for **5 s**, it becomes the owner (`zoneCaptured` event).
  - Two or more camps present: the zone is **contested**; the owner doesn't
    change and any capture in progress resets.
  - Nobody present: the owner stays. Land is kept until someone takes it.
- **Shown on the map**: each owned zone is tinted in its owner's colour with
  a thick border and a banner at its centre; contested zones flash their
  border. Borders and banners are drawn thicker as the camera zooms out so
  they read at 0.35×.

## Elimination, capture and loot

- A camp is **eliminated** when it has no completed Castle (the same rule as a
  1v1 defeat).
- The camp whose attack destroyed that last Castle is the **conqueror**:
  - it gets the eliminated camp's **banked gold** at that moment, added to its
    own stockpile (gold already spent on queued units or buildings is gone);
  - it gets **every zone the eliminated camp owned**, including its home zone,
    in one instantaneous transfer (no re-capture needed). The home zone then
    follows the military-control rule like any other zone.
- Everything the eliminated camp still had is **removed**: its units and its
  buildings are razed. Capturing buildings intact or turning units is out of
  scope (BACKLOG).
- If the conqueror is itself eliminated in the same tick, or the Castle fell
  to something with no team, the gold is lost and the zones go neutral.
- In the 1v1 match none of this runs: losing the last Castle ends the match,
  as in Phase 2.

## Win condition

- **Last camp standing wins** (`reason: 'last-standing'`).
- If the last two camps lose their Castles in the same tick, it is a draw.
- **Time limit (30:00).** The camp that owns the most zones wins; ties go to
  the higher score (the Phase 2 score: banked gold plus the cost of units and
  buildings); a tie on both is a draw. Every match therefore ends with a
  declared result, with a ranking of every camp.
- The player's camp is one of the four, treated like the others. If the
  player is eliminated the match goes on without them; the screen says so
  and offers to watch the rest or play again.

## AI in the free-for-all (placeholder targeting)

- Camps 2–4 run the existing scripts: **NE Crimson = Warband Raid, SE Rose =
  Merchant Kingdom, SW Jade = Stone Bastion**, at the chosen difficulty.
- **PLACEHOLDER — Phase 7 replaces this.** Each AI attacks, scouts and
  rallies toward the **nearest living rival camp** (straight-line distance
  between Castle positions, ties to the lower team number). When that camp is
  eliminated it moves on to the next nearest. It does not weigh threats,
  strength or opportunity. The rule lives in one function,
  `AiEngine.targetCamp()`, marked as a placeholder in the code.
- Expansion uses the neutral zones' gold fields (nearest uncontested first),
  with the Phase 3 contest rule, now counting sightings of any rival.

## Tap-to-zoom fix

- Every element outside the game canvas has `touch-action: manipulation`
  (panning and pinching the page still work, double-tap-to-zoom does not); the
  canvas keeps `touch-action: none` and handles its own pinch.
- The viewport meta tag disallows page scaling.
- iOS Safari's own gesture events and double-click zoom are cancelled
  (`src/game/nozoom.js`); the game's pinch uses pointer events and is not
  affected.
- `e2e/tapzoom.spec.js` fires rapid taps on a train button and on the map and
  asserts every tap counts and neither the page zoom nor the camera zoom
  changes; `e2e/touch.spec.js` still proves the game's pinch works.
  Chromium's emulation does not reproduce iOS's double-tap zoom itself, so
  the test also asserts the conditions browsers use to disable it.

## Verification

a) The Phase 1–5 suite, with the extended equivalence fingerprints.
b) `e2e/tapzoom.spec.js`.
c) Travel time between the closest camps (Results).
d) Territory: ownership changes on control shifts; the overlay renders in
   each owner's colour, distinctly, at 1× and 0.35×.
e) Capture/loot: exact gold and zone transfer, no side effects.
f) Win: last camp standing; the time limit always gives a result.
g) A full scripted 4-camp free-for-all, with at least one elimination and
   capture, run to its result in CI.
h) The touch-only bot plays the free-for-all to its end.

## Slices

| # | Slice |
|---|---|
| 0 | Tap-to-zoom fix |
| 1 | N-team refactor with the 1v1 equivalence fingerprints (gate) |
| 2 | Four team colours and their distinctness tests |
| 3 | The free-for-all map, camps and the travel-time measurement |
| 4 | Neutral zones and territory ownership in the sim |
| 5 | Territory overlay on the map |
| 6 | Elimination, capture and loot |
| 7 | Win condition and time-limit fallback |
| 8 | AI camps with the placeholder targeting, and the full FFA playthrough |
| 9 | HUD, start screen and the mobile playthrough for the free-for-all |
| 10 | Docs |
