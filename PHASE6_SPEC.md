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
- **Stone walls** run along the zone borders with a gate in every border, so
  armies move from zone to zone through gates. A camp's gates sit beside its
  Castle and just past the end of its gold-mine arc (as the 1v1 map's
  chokepoints do): a first layout with the gate behind the middle of the arc
  made armies squeeze between the mines, and the travel measurement caught
  Shield Knights wedged there.
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

Placement was checked with the sim's own pathfinding, steering and gates,
not straight-line distance. `test/travel.test.js` (and `node
tools/travel.mjs`) form a **full army** in front of one Castle (20 units, five
of each combat type, so the slowest, the 50 px/s Shield Knight, sets the
pace), march it to just outside a rival Castle and back, and time the last
unit to arrive each way. A second measurement puts a **Warband Raid first
wave** (6 Horsemen, 6 Archers, 2 Dragon Riders) at an undefended Castle and
times how long the Castle lasts.

| Route | Path | There | Back | Round trip |
|---|---|---|---|---|
| NW – SW (nearest pair) | 61 tiles | 41.2 s | 40.7 s | **81.9 s** |
| NE – SE (its mirror) | 61 tiles | | | 84.4 s |
| NW – NE | 75 tiles | 49.9 s | 48.1 s | 98.0 s |
| NW – SE (diagonal) | 100 tiles | 65.8 s | 65.4 s | 131.2 s |
| 1v1 map, west – east (for comparison) | 57 tiles | | | 73.5 s |

An undefended Castle lasts **9.0 s** against that raid.

**Why that is enough.** An army that marches on the nearest rival is away
from home for about 82 s. A raid of the size the Warband Raid script sends
first razes an undefended Castle in 9 s, so the attacker's own Castle could
fall nine times over while its army is out, and the outbound leg alone (41 s)
is 4.5 Castle lifetimes. Attacking is therefore a real gamble: the raider can
come home to nothing if a third camp notices. It is also not so far that
matches become marching: the nearest round trip is only 11 % longer than the
1v1 map's, which the Phase 3 balance was tuned on. The test asserts the
nearest round trip is at least 5× the Castle's lifetime, each leg at least
3×, the mirror pairs match within 3 s, and nothing takes more than 2 minutes.

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
  and offers to watch the rest or play again. That card pops up mid-play, so
  its buttons ignore taps for their first 0.8 s: a tap meant for the map must
  not restart the game (the touch playthrough once did exactly that in CI).

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

## Results

- **Equivalence (a).** Eleven fingerprints recorded on the Phase 5 code before
  any refactor (all nine strategy pairs across the three tiers played to their
  result, the browser's AI-only match, and a match decided at 30:00) are
  reproduced exactly by the N-team code, as are the Phase 3 fingerprints and
  the gameplay-values hash. The fairness table is unchanged (Easy 100/50/0,
  Normal 100/17/0, Hard 67/0/0).
- **Tap-to-zoom (b).** Four rapid taps on a train button queue four units;
  six on the map select; page and camera zoom never change; pinch still zooms.
- **Spacing (c).** Nearest round trip 81.9 s against a 9.0 s Castle
  lifetime (table above).
- **Territory (d).** Capture after 5 s of sole presence, contested and empty
  zones, Peasants and home locks are tested in the sim; in the browser the
  border of each owned zone reads as its owner's colour (nearest of the four,
  within ΔRGB 90) at 1× and 0.35×, and a neutral border reads as no team.
- **Capture and loot (e).** 777 gold and 3 zones went to the conqueror
  exactly; the two other camps' gold and land were untouched; a same-tick
  double fall loses the loot and neutralises the land.
- **Win (f).** Last camp standing, simultaneous falls, and every time-limit
  case (land beats gold, score breaks land ties, full tie is a draw, three
  camps alive) end with a declared, ranked result.
- **Full free-for-all (g).** Seed 1, all four camps scripted at Hard (the
  player's camp plays Merchant Kingdom), through the read-only AI guard:
  14 zone captures; Jade fell to Azure at 441 s (958 gold and its home zone
  taken), Crimson fell to Rose at 591 s, Azure fell to Rose at 783 s (5,262
  gold and five zones); Rose won as the last camp standing. About 13 s of CI
  time.
- **Touch (h).** The touch-only bot plays the free-for-all on an emulated
  phone: builds its base, sends a wave, defends, saves a group by
  press-and-hold, pinches; Jade's first wave takes its Castle at about 7
  minutes, the bot taps "Watch on", and the match runs to Jade's
  last-standing win. As in Phases 4 and 5, it is not expected to win.

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
