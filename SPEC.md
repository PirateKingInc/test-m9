# Spec: Phase 1 (sandbox) + Phase 2 (scripted AI opponent) + Phase 3 (balance & polish)

This file has the exact numbers for Phase 1, then Phase 2, then Phase 3. The code reads them from
`src/data/units.js`, `src/data/buildings.js` and `src/data/map.js`. If you
change a number here, change it there too; `test/data.test.js` checks that
the key values match.

Conventions: 1 tile = 32 px. Speeds are in px/s. Times are in seconds.
*Range* is the **edge-to-edge gap** between the two footprints (unit
circles and building rectangles). The simulation runs at a fixed
`SIM_DT = 0.05 s` (20 Hz). The renderer interpolates between steps.

## Resources

| Item | Value |
|---|---|
| Resource | **Lumen** (one type) |
| Starting stockpile | **250** |
| Crystal node | 2×2 tiles, **1500** Lumen each, blocks movement, disappears when empty |
| Drone carry | **8** Lumen per trip |
| Mining time | **2.0 s** at the node (the Drone must be within 8 px of the node edge) |
| Drop-off | instant when within 8 px of a **completed Lumen Depot** (the Command Core is *not* a drop-off) |
| Loop | node → nearest depot → same node. If that node is empty, the Drone moves to the nearest node within 12 tiles, or goes idle if there is none. |

Expected income per Drone ≈ `8 / (2.0 + roundTripPx / 72)` Lumen/s.
`test/economy.test.js` checks this within ±15%.

## Units

| id | Name | Role | HP | Armor | Attack | Damage | Cooldown | Range | Speed | Radius | Cost | Train time | Trained at |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| drone | Drone | worker | 40 | light | blade | 4 | 1.0 | 8 | 72 | 9 | 50 | 10 | Command Core |
| striker | Striker | light melee | 100 | light | blade | 10 | 0.6 | 8 | 85 | 11 | 60 | 12 | Foundry |
| sparker | Sparker | ranged | 65 | light | bolt | 15 | 0.75 | 176 | 70 | 10 | 70 | 14 | Foundry |
| bulwark | Bulwark | heavy | 300 | heavy | crush | 14 | 1.0 | 8 | 50 | 15 | 150 | 22 | Foundry |
| lancer | Lancer | anti-heavy specialist | 120 | light | lance | 26 | 1.4 | 128 | 60 | 11 | 110 | 18 | Foundry |

- Each hit deals `damage × multiplier(attack, armor) × U(0.9, 1.1)`. The
  random factor comes from the seeded RNG.
- Combat units auto-acquire enemies within **200 px** gap when idle or
  attack-moving. Drones never auto-acquire, but they attack when ordered.
- A chase ends when the target dies or the gap grows past **320 px**.
- Test targets and test units (verification only) belong to team 2.

### Damage multipliers

| Attack ↓ / Armor → | light | heavy | structure |
|---|---|---|---|
| blade | 1.00 | 0.40 | 0.50 |
| bolt | 1.00 | 0.40 | 0.50 |
| crush | 1.00 | 0.60 | 1.00 |
| lance | 0.35 | 2.50 | 1.50 |

### Counter table

`test/counters.test.js` checks each row with **N = 50** seeded fights. The
intended winner must win **at least 80%** of them.

| # | Matchup (A vs B) | Start gap | Intended winner | Nominal time to kill (A→B / B→A) |
|---|---|---|---|---|
| 1 | Striker vs Sparker | 4 px (melee) | Striker | 3.6 s / 4.5 s |
| 2 | Striker vs Sparker | 176 px (Sparker range) | Sparker | ≈2.0 + 3.6 s / 4.5 s |
| 3 | Bulwark vs Striker | 4 px and 176 px | Bulwark | 7.0 s / 44 s |
| 4 | Bulwark vs Sparker | 4 px and 176 px | Bulwark | 4.0 s (+3 s closing) / 36.8 s |
| 5 | Lancer vs Bulwark | 4 px and 128 px | Lancer | 5.6 s / 8.0 s |
| 6 | Striker vs Lancer | 4 px and 128 px | Striker | 6.6 s / 14 s |
| 7 | Sparker vs Lancer | 4 px and 176 px | Sparker | 5.25 s / 9.8 s |
| 8 | each combat unit vs Drone | 4 px | combat unit | — |

## Buildings

| id | Name | Footprint | HP | Armor | Cost | Build time | Function |
|---|---|---|---|---|---|---|---|
| core | Command Core | 4×4 | 1500 | structure | 400 | 60 | Trains Drones. The player starts with one. |
| depot | Lumen Depot | 3×3 | 600 | structure | 100 | 20 | Resource drop-off |
| foundry | Foundry | 3×3 | 800 | structure | 150 | 30 | Trains Striker, Sparker, Bulwark and Lancer |
| spire | Sentry Spire | 2×2 | 500 | structure | 120 | 25 | Defensive turret: bolt 14 dmg, 0.8 s cooldown, 224 px range |

- **Placement** follows the tile grid. A spot is valid only when every
  footprint tile is inside the map and free of rock, other buildings and
  crystal nodes. Units standing on a new footprint are pushed to the nearest
  free tile.
- **Construction:** the cost is paid when the site is placed. The ordering
  Drone walks to the site. Progress advances only while at least one Drone
  is building next to it (gap ≤ 8 px). Extra builders do not speed it up.
  HP grows from 10% to 100% of max as the site progresses. Cancelling an
  unfinished site refunds **75%**.
- **Production queue:** up to **5** items per building. The cost is paid
  when an item is queued, and items train one at a time in FIFO order.
  Cancelling any queued item, including the one in progress, refunds
  **100%**. A trained unit appears on the nearest free tile next to the
  building and walks to the rally point if one is set.
- No debt is allowed. Costs are paid up front (on placement or on queueing),
  and a command that costs more than the stockpile is rejected with an
  "insufficient Lumen" cue.

## Map (`src/data/map.js`)

- **80 × 60 tiles** (2560 × 1920 px), which is larger than one screen.
- Since Phase 2 the map is **mirror-symmetric about the vertical center line**
  so both starts are equally fair: a feature of width `w` at tile `x` has a twin
  at `80 − x − w`. The west half is unchanged from Phase 1.
- **Player start (team 1, west):** Command Core at tile (8,27). Four Drones at
  tiles (13,27)–(13,30). The camera starts centered on the Core.
- **AI start (team 2, east, match mode only):** Command Core at (68,27). Four
  Drones at (66,27)–(66,30).
- **Rock (impassable):**
  - Ridge A at x=30–31 and its mirror Ridge B at x=48–49, each covering
    y 0–17, 24–35 and 42–59. The gaps at y 18–23 and 36–41 are chokepoints.
  - Outcrops at (14,10) 4×3, (12,46) 5×3 and their mirrors (62,10) 4×3 and
    (63,46) 5×3. The center plateau is at (38,26) 4×8.
- **Crystal nodes (20 × 1500 Lumen):**
  - West home field: (20,21), (22,24), (23,27), (23,30), (22,33) and (20,36)
  - East home field (mirror): (58,21), (56,24), (55,27), (55,30), (56,33) and (58,36)
  - North-middle: (37,6), (41,6), (39,3) and (39,9)
  - South-middle: (37,51), (41,51), (39,48) and (39,54)

### Side symmetry (Phase 3)

The map is a mirror image, so every tie-break in the sim must be one too, or one
side gets a hidden edge. Before Phase 3, Economy-Boom mirrors went 26–33% west.
The rules now:

- **A\* and nearest-tile searches.** A unit in the east half plans in a mirrored
  frame: its start, goal and grid are flipped, the path is found with the
  west-half code, and the result is flipped back. Tie-breaks between equal-cost
  paths, the BFS "nearest reachable" order and the grid spiral order are
  therefore mirror images across the center line.
- **Spawn side.** A building without a rally point spawns units at its bottom
  corner nearest the map center: bottom-right in the west (as in Phase 1),
  bottom-left in the east.
- **AI build placement** searches outward from a spot in mirror-image order.
- `test/sidebias.test.js` asserts these rules. It also plays jitter-free mirror
  matches of each strategy and requires them to stay an exact mirror image for
  90 s.

## Movement & pathfinding

- **Library:** PathFinding.js 0.4.18 (`PF.AStarFinder`) routes on the 80×60 tile
  grid. Diagonals are allowed only when no corner is cut (`allowDiagonal` +
  `dontCrossCorners`; the CDN browser bundle uses these legacy option names).
  Headless tests load that exact CDN bundle.
- **Smoothing:** the A* tile path is string-pulled greedily. A shortcut is kept
  only if a band **±12 px** either side of the segment is walkable, so units
  don't hug rock corners. Intermediate waypoints count as reached within
  **12 px**; the final one within 2 px.
- **Blocked or unreachable goals** resolve to the nearest walkable tile, or to
  the nearest tile *reachable* from the unit (found by BFS flood fill).
- **Group moves keep the group's shape.** Each unit aims at `goal + (its
  offset from the group centroid)`. The offsets are compressed to about
  `0.75·√n` tiles if the group is spread out. Each target then snaps to the
  nearest free walkable tile, so every unit gets a distinct destination and
  paths rarely cross.
- **Separation (spatial hash, 2 passes per tick):**
  - Overlapping units push apart.
  - A moving unit shoves an idle one **sideways**, off its heading, rather than
    bulldozing it.
  - Movers meeting roughly head-on each sidestep **away from the side the
    other is on** (so a mirrored pair sidesteps in mirror image). Only an exact
    head-on tie falls back to both stepping right.
  - Moving-vs-moving collisions are **soft** (25% of the overlap is resolved per
    tick), so crowds flow through chokepoints. Idle units separate fully.
  - Drones on the gather loop pass through each other.
  - A settled unit drifts back to where it stopped if it gets jostled up to 96 px.
  - Positions never enter blocked tiles; units slide along walls.
- **Stuck recovery:**
  - Progress is measured as the shrinkage of the remaining path length, so a
    unit jostled back and forth doesn't count as moving.
  - Less than 4 px of progress in 1.0 s triggers a re-plan. Every 0.5 s a unit
    also re-plans if it has been pushed behind an obstacle relative to its next
    waypoint.
  - Re-plans while pressed against moving traffic don't count as failures, for
    up to 15 s of waiting. After 3 counted failures the unit stops, so it is
    never stuck forever.
- **Performance budget:** 40 units moving at once must average **< 5 ms per sim
  step** in CI (`test/stress.test.js`). They currently average about 0.2 ms.

## Controls

| Input | Action |
|---|---|
| Left-click | Select a unit or building (Shift = add or remove) |
| Left-drag | Box-select your own units (Shift = add) |
| Right-click enemy / test target | Attack it |
| Right-click crystal (with Drones) | Gather |
| Right-click Depot (with carrying Drones) | Return cargo |
| Right-click own unfinished building (with Drones) | Help construct |
| Right-click ground | Move in formation. With a Core or Foundry selected, this sets the rally point. |
| **A** then left-click | Attack-move (engage enemies met on the way) |
| **S** | Stop |
| **Ctrl + 1–9** (or **Shift + 1–9**) | Assign a control group. Desktop Chrome reserves Ctrl+1–8 for switching tabs, so Shift is the reliable choice there. |
| **1–9** | Select a control group (press twice to center the camera on it) |
| **Q W E R** (Drone selected) | Place a Command Core, Depot, Foundry or Sentry Spire. Left-click places it, and Esc or right-click cancels. |
| **Q** (Core selected) | Train a Drone |
| **Q W E R** (Foundry selected) | Train a Striker, Sparker, Bulwark or Lancer |
| Click a queue slot / **Backspace** | Cancel that item / the last queued item (full refund) |
| **X** (unfinished building selected) | Cancel construction (75% refund) |
| Arrow keys, screen-edge mouse, middle-drag | Pan the camera |
| **Home** | Center the camera on the Command Core |
| **M** | Mute or unmute |
| **\`** (backtick) | Toggle the dev panel. It spawns **test targets** and team-2 test units for verification. This is not a game feature. |

## Verification

1. **Pathfinding** (`test/pathfinding.test.js`, `test/stress.test.js`):
   units route around rocks and buildings, and no unit stays stuck. 40 units
   crossing the map finish within the time budget without lasting overlap.
2. **Economy** (`test/economy.test.js`, `test/production.test.js`): the
   gathering rate matches the formula, costs are deducted, queues run in
   FIFO order, and cancels refund correctly.
3. **Counters** (`test/counters.test.js`): N=50 fights per row of the counter table.
4. **Selection and control** (`test/selection.test.js`, `test/e2e`):
   box-select, control groups and attack-move.
5. **Bot sandbox** (`test/bot.test.js`): a scripted bot builds every
   building, trains one of each unit and wins a fight against test targets.

---

# Phase 2: Scripted AI opponent

Everything below is **match mode** (`World({ setup: 'match' })`). The Phase 1
sandbox (`setup: 'start'`, player only) still exists, and all Phase 1 tests run
in it.

## Population (supply)

This applies identically to every team; the rules are in the sim, not in the AI.

| Item | Value |
|---|---|
| Supply per unit | Drone 1, Striker 1, Sparker 1, Lancer 2, Bulwark 3 |
| Supply provided | Command Core **10**, Lumen Depot **10** (completed buildings only; 8 until Phase 12) |
| Hard maximum | **100** per team, however many providers (60 until Phase 12, PHASE12_SPEC.md) |
| Starting use | 4 / 10 |

- `used` = the supply of living units **plus queued production** (reserved when
  queued, released on cancel).
- `train` is rejected with "Not enough supply" when `used + unit supply > cap`.
- Losing a provider never kills units. It only blocks new training until
  supply is back under the cap.
- The HUD shows `Supply used / cap`.

## Win / lose

- A team is **defeated** the moment it has no *completed* Command Core. The
  other team **wins**.
- If both teams lose their last Core in the same tick, the result is a **draw**.
- **Sudden death:** at **30:00** of game time the match ends on score. Score =
  banked Lumen + the cost of every living unit and completed building (plus the
  cost already paid for unfinished ones). The higher score wins; equal scores draw.
- Together these rules guarantee every match ends with a declared result.
- When the result is set, `world.result = { winner, loser, reason, time }`
  (`winner` is `null` for a draw), a `gameOver` event fires, and the sim freezes:
  `step()` does nothing and `issue()` rejects every command. The browser shows
  a Victory, Defeat or Draw screen.

## Enemy scanning (combat target acquisition)

- Every tick the sim rebuilds a **spatial index**: a uniform grid of 128 px
  cells. Units go into the cell holding their center. Buildings go into every
  cell their footprint overlaps.
- `findEnemy(e, range)` only visits the cells within `range` plus the largest
  footprint. Each scan therefore costs about the number of entities *near* the
  unit, not the number in the whole world.
- Results are identical to the old brute-force scan: the nearest enemy unit,
  then buildings. A test checks this against brute force.
- Budget: a **200-unit** battle (100 vs 100) must average **< 8 ms per sim step** in CI.

## AI architecture

- `src/ai/engine.js` is the **AI execution engine**. It grew directly out of the
  Phase 1 scripted bot (`test/bot.js`, now `src/ai/engine.js`; the bot test still
  runs through it).
- The engine reads the world and acts **only through `world.issue(cmd)`**, with
  its own team stamped on every command. Its whitelist of commands has no
  `devSpawn`. A test runs full matches with the engine given a recursively
  read-only view of the world, and fails on any direct mutation.
- The engine runs outside the `World` (the match loop calls
  `world.step()` then `ai.update()`), so it is headless-testable and never
  touches Phaser or the DOM.
- **Data files:**
  - `src/data/strategies.js` has every strategy's opening, macro loop, army
    composition, attack thresholds and scouting triggers.
  - `src/data/difficulty.js` has each tier's timing parameters.
  - Phase 3 tunes these without touching engine code.

### Engine loop (every `decisionInterval` seconds)

1. **Bookkeeping:** track pending construction.
2. **Scout:** update what the AI knows and evaluate triggers (see below).
3. **Gather:** put idle Drones on the nearest crystal to their own base.
4. **Opening:** issue the next step of the strategy's `opening` list. A step
   waits until it's affordable and has supply. After a step succeeds, the
   engine waits the difficulty's `stepDelay` before the next.
5. **Macro loop** (after the opening), in this order:
   1. Build a Depot when `cap − used ≤ supplyBuffer` and none is under construction.
   2. Train Drones up to `workerTarget × workerFactor`, at most 1 queued at the Core.
   3. Build the strategy's extra `structures` once their conditions hold.
   4. Keep each Foundry's queue at 2 or fewer, picking units from the
      composition weights. Scouting overrides can shift the weights.
6. **Army control:**
   - Units gather at the rally point in front of the base.
   - When the army reaches `firstWave` (then `wave`), it **attack-moves to the
     enemy Command Core**. Near the Core with no enemy units within 200 px, it
     issues a direct `attack` on the Core.
   - If the army falls below `retreatBelow` of its wave size, it pulls back to
     the rally point. Rush never retreats.
   - While a wave is out, new units reinforce it if `reinforce` is set.

Building spots are offsets from the team's own Core, given for the west base
and mirrored for the east base. If a spot is taken, the engine searches nearby
tiles in a spiral and keeps a 1-tile margin free around each building, so it
never walls itself in.

### Strategies (`src/data/strategies.js`)

These are the tuned values from the playthroughs in slices 6–8. The data file
is authoritative, and `test/playthrough.test.js` exercises each strategy.

| | **Rush** | **Economy-Boom** | **Turtle-and-Tech** |
|---|---|---|---|
| Opening | drone, depot, drone, foundry, striker, striker, drone | drone, drone, depot, drone, drone, depot, drone, drone, foundry, drone | drone, drone, depot, drone, foundry, spire, drone, spire |
| Worker target | 8 | 16 | 12 |
| Extra structures | Foundries up to 3 whenever Lumen ≥ 250 | 2nd Foundry once 12+ Drones; 3rd Depot once 14+ Drones; 3rd Foundry whenever Lumen ≥ 600 | Spires up to 4 (a new one per 2 army units); 2nd Foundry whenever Lumen ≥ 400 |
| Composition (weights) | Striker 3, Sparker 1 | Striker 2, Sparker 2, Bulwark 1, Lancer 1 | Bulwark 3, Lancer 2, Sparker 2 |
| First wave / later waves | 6 / 5 units | 14 / 10 units | army supply 36 / 30 (it builds up by supply) |
| Retreat below | never | 35% of the wave | 30% of the wave |
| Reinforce a wave | yes, in groups of 3 or more | no | no |
| Scout drone sent at | 30 s | 60 s | 90 s |

**Macro loop details:**
- A Depot goes up when `free ≤ supplyBuffer + number of producers`.
- Idle Drones spread over the four crystals nearest the base, least-busy first.
- Any unfinished site of the AI's with no builder (for example, because the
  builder died) is reassigned a Drone, so construction can never stall.

Every strategy also defends: enemy combat units within 16 tiles of its
buildings pull the army home, whatever the wave state.

### Scouting: what the AI can see

This is a *lightweight scan* of AI perception, not a fog-of-war game mechanic:
the player still sees the whole map, as PROJECT.md requires.

- Every **2 s** the AI records enemy units and buildings that are:
  - within **16 tiles (512 px)** of any of its own buildings (base watch), or
  - within **7 tiles (224 px)** of any of its own units, including one **scout
    Drone** that walks to the enemy start at the time in the strategy table and
    then returns to mining.
- It remembers each sighting (type, position, time) for **90 s**, including
  units that have since died: "the enemy fielded six Strikers" is still true.
- The scan uses plain loops over entities. It never queries the sim's spatial
  index, which writes bookkeeping onto entities.
- From that memory it derives: the enemy combat units seen by type, the enemy
  buildings known, and the enemy units currently near its base.

### Scouting-triggered reactions

| Trigger | Condition | Reaction |
|---|---|---|
| **Early aggression** | Before **5:00**, at least **2** enemy combat units inside base watch | Enter **defend** mode: recall any wave, attack-move the army to the threat, bias production 70% toward counters of the attacking types, and build Spires up to 1 (Turtle: 2) as an *urgent* build, alongside any other construction. Defend mode ends after **20 s** with no enemy near the base. |
| **Massing** | An enemy combat type with at least **5** seen *and* a **majority (≥ 50%)** of the enemy army seen. A balanced army never trips it. | **Counter composition:** 70% of new production goes to that type's counter from the Phase 1 table. It lasts until the condition clears. |

A trigger takes effect only after its condition has **held for the
difficulty's reaction delay**. A raid wiped out faster than that isn't treated
as a rush.

The thresholds were first 4 seen and 40%. Playthroughs showed the scout Drone's
partial view of a balanced army tripping that repeatedly, and swinging
production away from the plan, so they were raised to the values above. All
thresholds live in `SCOUTING` in `src/data/strategies.js`.

Fixed player-side test scripts (`sentinel`) set `scouting: false`, so they
never adapt.

Counter picks (from the PROJECT.md counter table):
- Striker is countered by Bulwark (with Sparker).
- Sparker is countered by Bulwark (with Striker).
- Bulwark is countered by Lancer.
- Lancer is countered by Striker (with Sparker).

### Difficulty (`src/data/difficulty.js`)

Difficulty controls *which strategy runs*, *how well-timed the script is* and,
since Phase 3, *how much production it runs*. It never makes the AI smarter,
never changes the rules, and never gives it resources.

| | Easy | Normal | Hard |
|---|---|---|---|
| Default strategy | Turtle-and-Tech | Rush | Economy-Boom |
| Decision interval | 2.5 s | 1.2 s | 0.5 s |
| Extra delay after each opening step | 2 s | 2 s | 0 s |
| Reaction delay before a trigger takes effect | 25 s | 10 s | 3 s |
| Worker factor (× worker target) | 0.7 | 0.9 | 1.0 |
| Foundry cap (Phase 3) | 1 | 2 | strategy's own |
| Timing jitter (± share, seeded) | 30% | 20% | 10% |

**Phase 3 changes.**
- **Why the defaults moved.** Phase 2 picked the default strategies by
  measured strength: Easy = Rush, the weakest script, and Hard = Boom, the
  strongest. Phase 3 balanced the scripts against each other, which removed
  that source of difficulty.
- **Timing alone doesn't order the tiers.** Measured against the fairness
  policies, the timing knobs barely affect outcomes. A lower worker factor
  can even help, because fewer Drones means an earlier army.
- **The Foundry cap does.** A tier now handicaps the AI by capping how many
  Foundries it runs. That is an execution limit, not a rule change. Plainly,
  Easy and Normal are now partly an **economic handicap on the AI**: it can't
  convert income into an army as fast as the uncapped player. They are not
  just a weaker script.
- **New defaults.** They were re-picked from a policy × tier × strategy
  measurement: Easy = Turtle (a passive opponent a beginner can learn
  against), Normal = Rush, and Hard = Boom.
- **Easy step delay** went from 6 s to 2 s for strategy balance. At 6 s it
  punished long openings, such as Boom's 12 steps, far more than short ones.

The start screen also lets the player pick the strategy explicitly (Auto uses
the default above), or play the Phase 1 **Sandbox** with no opponent.

### Fairness protocol (`test/fairness/`)

- Three **player-side policies** run on the same engine as the AI, as team 1:
  - **competent:** Economy-Boom with Hard timing and scouting reactions
  - **intermediate:** Turtle-and-Tech with Easy timing
  - **novice:** Rush with Easy timing
- Each plays **12 fixed seeds** (1–12) against each tier with its default
  strategy. The sim is deterministic, so CI reproduces the exact numbers.
- Required:
  - The competent policy wins **at least 75% on Easy, 50% on Normal and 10% on
    Hard** (beatable at every tier).
  - Every policy's win rate falls monotonically from Easy to Normal to Hard.
  - The novice wins **at most 50%** at every tier, and Hard beats the
    intermediate policy **at least 75%** of the time (not a pushover).

## Controls added in Phase 2

- **Control groups:** Chrome reserves Ctrl+1–8 for tab switching, so pages
  never receive those keys. Phase 2 fixes this in three ways:
  - **Shift+1–9** is the primary assign key. Ctrl+1–9 still works wherever the
    browser delivers it.
  - A **control-group bar** in the HUD shows each group's size. Click a slot to
    recall it, and Shift-click or right-click to assign the current selection.
  - A **Fullscreen** button requests the Keyboard Lock API, which lets Chrome
    deliver Ctrl+1–9 to the game while in fullscreen.
- **Under attack:** when enemy fire hits your units or buildings, a toast and a
  two-tone alarm fire (at most once per 15 s of game time), and **Space** jumps
  the camera to the last attack.
- The result screen offers **Play again** (same setup) and **Change difficulty**
  (back to the start screen).

## Phase 2 verification

1. **Regression:** every Phase 1 test still passes, and the sandbox bot test
   now runs through the AI engine.
2. **Playthroughs:** each strategy plays a full match against the fixed
   `sentinel` script in CI, through the read-only guard. It completes its
   opening, trains an army, launches waves that cross into the enemy half and
   engage, and the match ends with a declared result. Separately, each strategy
   marches on an undefended base and wins by destroying the Command Core.
3. **Scouting:** scripted scenarios trigger early aggression and massing for
   each unit type, and the tests assert the branch taken.
4. **Supply:** both teams are capped identically, and Depots raise the cap (to
   the hard max of 60).
5. **Win/lose:** destroying either Core ends the match with the right result;
   simultaneous loss is a draw; the time limit always ends the match.
6. **Fairness:** repeated bot-vs-AI runs per difficulty with a competent and a
   novice player-side policy. Win rates are reported in the test output and
   the README.

# Phase 3: Balance & polish

## AI expansion (`EXPANSION` and each strategy's `expand` in `src/data/strategies.js`)

- **Fields.** North-middle (centered on tile 40,7) and south-middle (40,52).
  Each lies between the ridges and is mirror-symmetric. The field data is
  written for the west team, and the east mirrors x.
- **Trigger.** Each strategy has its own condition:
  - **Timer:** game time ≥ `after`, plus `minDrones` Drones and/or
    `minArmySupply` army supply.
  - **Home low:** the home field (nodes within 14 tiles of the Core) has less
    than `orHomeBelow` of its Lumen left.
  - Nothing triggers while in defend mode or within 120 s of losing an
    expansion.

  | Strategy | Timer | Home low | Drones sent | Defense |
  |---|---|---|---|---|
  | Rush | 420 s and 6 Drones | < 35% | 4 | 3 guard units |
  | Boom | 240 s and 13 Drones | – | 6 | 1 Spire + 2 guard units |
  | Turtle | 360 s and 14 army supply | < 35% | 5 | 2 Spires |

- **Uncontested only.** A field is contested if the AI has ever seen an enemy
  building within 12 tiles of it (and not since seen it gone), or enemy combat
  units there in the last 60 s. Drones don't count.
  - The AI takes the nearest uncontested field that still has crystals.
  - If the field turns out to be contested before the Depot finishes, the AI
    cancels the Depot (75% refund) and picks again.
- **Claiming a field:**
  - a Depot beside the field
  - its Spires
  - `drones` Drones moved from the home field (the worker target rises by the
    same number, so home is refilled)
  - `guards` combat units posted there, which defend it and never join waves
- **Afterwards.** When a field is mined out, the AI is free to take the next
  one. If its expansion Depot is destroyed, those Drones go home and it
  retries after 120 s.

## Attack targeting

- **Wave target.** Waves attack-move to the **nearest enemy Command Core the
  AI has seen**.
  - Cores are remembered until their spot is seen empty again. Since Phase 3,
    all enemy buildings are remembered that way: buildings don't move, so they
    no longer expire after 90 s like unit sightings.
- **With no Core known,** the target is the enemy start. If the start has been
  seen with no Core, the target is the nearest enemy building believed to be
  standing, and failing that, a sweep of the enemy half
  (`SCOUTING.searchPoints`). The sweep moves to the next point once one of the
  AI's units has it in sight.
- **Direct assault.** When a wave is near the target Core and no enemy combat
  units defend it, the wave attacks the Core directly (unchanged from Phase 2).

## Phase 3 verification

- `test/expansion.test.js`:
  - each strategy expands under its trigger, to a middle field, with its
    Drones and defense
  - no AI Depot is ever finished in a field the enemy holds
  - an AI wave finds a Core that was moved away from its start and destroys it
- `test/sidebias.test.js`: mirror equivariance (see "Side symmetry").
- `test/balance.test.js`: one full bot-vs-bot match to a result on every CI
  run.
- `tools/balance.mjs` produces the strategy matrix. BALANCE.md has the results.
