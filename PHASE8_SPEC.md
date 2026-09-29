# Phase 8 — Symmetry, N-way balance, attack cadence, fresh intel

Phase 7 made the free-for-all's AI camps choose among rivals. Its own report
named four gaps, and this phase closes them:

1. **Pathfinding symmetry.** A tie-break asymmetry carried since Phase 6 made
   mirrored routes on the four-camp map measurably different.
2. **N-way balance.** Phase 3 measured and tuned the 1v1 only; the four-camp
   free-for-all had never been measured.
3. **Attack cadence.** Rush attacks far more often than Boom and Turtle, so
   most visible AI decisions came from one strategy.
4. **Stale intel.** A camp never re-scouted a rival after its first look.

Still 4 camps. Out of scope: a 5th camp, predicting what other camps will do
to each other (theory of mind), larger or several zone squads, capturing
buildings, new maps, sound/animation/real-device work, and any change to 1v1
unit stats, costs or the economy logic frozen since Phase 3.

**The 1v1 match stays byte-identical** through every part: the Phase 3
(`GOLDEN`) and Phase 5 (`GOLDEN_PHASE5`) fixed-seed fingerprints are checked on
every PR. Everything below applies only on the free-for-all map (the
pathfinding fix: maps mirrored north-south) or only with more than one rival
(the AI changes).

## Part A — Pathfinding symmetry

### Root cause (mirror trace)

Method: Phase 3's mirror trace ([BALANCE.md](BALANCE.md) "Side bias"),
extended to the free-for-all (`tools/mirror-trace.mjs`). Every camp plays the
same script with timing jitter off and no scout, and each tick a camp's state
is compared with the mirror image of its twin: NW against SW and NE against SE
across the east-west axis (y → H − y), NW against NE across the north-south
axis (x → W − x).

- **Before:** the east-west twins (NW/NE) stayed mirror-exact until 92–135 s
  (the crowd float rounding Phase 3 accepted), but the **north-south twins
  diverged at 0.1 s**, on the first Peasant's first step.
- **Cause 1, the approach tile.** A Peasant sent to a gold mine walks to the
  free tile beside it nearest to itself (`adjacentTile`). The first Peasant's
  two candidates were exactly equidistant (295.0 px each), and the tie went to
  the first tile in scan order: top row first, on both halves. Phase 3 mirrored
  every *east-west* tie-break (spiral order, flood fill, A* frame, spawn side,
  head-on steering) but the map it fixed was only mirrored east-west, so
  nothing mirrored ties in y.
- **Cause 2, A* and its helpers.** Path planning runs A* with PathFinding.js's
  fixed neighbour order. Phase 3 made east-half queries plan in an
  x-mirrored frame; nothing did the same for the south half, so a march
  starting in the south took a different equal-cost route from its northern
  twin. The flood fill (`nearestReachable`), the spiral search
  (`nearestWalkable`, formation slots, build placement) and the default
  spawn corner (always *below* a building, i.e. out of the back of a south
  camp) had the same gap.
- **Cause 3, found by the equivariance test.** Inside the pathfinder, the
  unmirrored frame used the grid's own (now half-aware) spiral order while the
  mirrored frames used the canonical order, so a goal snapped to the nearest
  walkable tile differently depending on the frame.

### The fix

On maps mirrored north-south (`map.mirrorY`, i.e. the free-for-all;
`grid.mirrorY` in the sim):

- the pathfinder plans south-half queries in a y-mirrored frame (and
  south-east ones in an x-and-y-mirrored frame); every frame, including the
  unmirrored one, is a view with the canonical north-west tie-break order;
- the spiral search, the approach-tile scan and the default spawn corner use
  the vertical mirror image of the north half's order in the south half (the
  approach-tile scan also mirrors in x there);
- the 1v1 map is not mirrored north-south, so none of it applies there and its
  fingerprints are unchanged.

After the fix, all four camps stay mirror-exact for 90 s for every strategy
(`test/symmetry-ns.test.js`): both mirrors now last as long as the east-west
one did.

### Measuring march symmetry

The Phase 6 measurement put the army in a fixed formation (Horsemen always on
the north row), so a southbound army and its northbound mirror twin did not
start from mirror-image states. Its reported 4.1 s gap between NE→SE (40.1 s)
and SE→NE (44.2 s) was **mostly that**: with the formation mirrored with the
camp, the *unfixed* code gives 40.50 s and 40.95 s. `test/travel.js` now lays
the formation out in the mirror image for mirrored camps.

A single 20-unit march is chaotic: float rounding (`W − x` is not bit-exact)
grows into a second or two in a crowd. `tools/symmetry.mjs` therefore takes
the **median of 24** slightly shifted marches for every one-way route.

| Mirror pair (north-south) | Before | After |
|---|---|---|
| NW→NE vs SW→SE | 48.90 / 48.70 s (0.20) | 48.90 / 48.70 s (0.20) |
| NW→SE vs SW→NE | 65.90 / 66.67 s (**0.77**) | 66.55 / 66.55 s (**0.00**) |
| NW→SW vs SW→NW | 40.75 / 40.45 s (0.30) | 40.90 / 40.45 s (0.45) |
| NE→NW vs SE→SW | 50.15 / 50.10 s (0.05) | 50.15 / 50.30 s (0.15) |
| NE→SE vs SE→NE | 40.50 / 40.95 s (0.45) | 40.67 / 40.95 s (0.27) |
| NE→SW vs SE→NW | 65.90 / 66.62 s (**0.72**) | 66.55 / 66.55 s (**0.00**) |

Every north-south mirror pair is now within 0.5 s. The diagonals, where A*'s
fixed neighbour order picked a different route for a south start, went from
0.72–0.77 s apart to identical. North-starting routes are unchanged; the
others moved by at most 0.2 s (noise, see the means in the tool's output).

**Still there, not Phase 8's:** the east-west twins of the long top and
bottom marches differ by 1.25 s (NW→NE 48.90 vs NE→NW 50.15) and 1.6 s
(SW→SE 48.70 vs SE→SW 50.30). Those numbers are the same before and after this
fix (the pathfinding is already x-mirrored there, and the means differ by only
0.17 s for the top pair), so it is crowd behaviour on those routes, not path
choice. It is recorded in the backlog.

`CAMP_TRAVEL` (Phase 7's travel term) is re-measured with the new method and
is now symmetric: 40.7 / 40.8 s (the short north-south neighbours), 49.5 s (the
east-west neighbours), 66.6 s (the diagonals).

### The gate

A pathfinding change is exactly what broke fixed-seed matches before, so this
part is gated like Phase 6's N-team refactor:

- `GOLDEN` and `GOLDEN_PHASE5` (1v1): **unchanged**, byte-identical.
- `GOLDEN_PHASE6_FFA` (the free-for-all production log, Phase 6/7): still
  reproduced exactly **with the north-south tie-breaks switched off**
  (`grid.mirrorY = false`), which proves the fix is the only thing that moved
  the free-for-all.
- `GOLDEN_PHASE8_FFA`: the same log with the fix on, pinned on the fix before
  any Part B–D change.

## Part B — N-way balance

### The batch runner

`tools/ffa-balance.mjs` (the Phase 3 runner's pattern: one worker per CPU,
deterministic seeds, raw results saved to `balance/`). Every match is a full
four-camp free-for-all at **Hard** timing, all four camps scripted, played to
its declared result.

- **Arrangements.** Four camps and three strategies: one strategy plays two
  camps. There are 36 ways to place them in the corners (3 choices of the
  doubled strategy × 12 placements).
- **Pooling.** The map is symmetric under both mirrors and the 180° turn (a
  group of 4), but not under a 90° turn (the north-south neighbours are 41 s
  apart, the east-west ones 49.5 s). The 36 arrangements fall into **9
  classes** of 4 mirror images each: which strategy is doubled, and whether
  its two camps are north-south neighbours, east-west neighbours or
  diagonal. Each class is one "meaningful permutation"; its 100 seeds are
  spread 25 per mirror image, so every class is played equally from every
  corner (as Phase 3 alternated sides). **900 matches** per full run.
- **Why that is enough.** 100 seeds pin a class's rates to about ±10 points;
  the headline numbers (by strategy, by corner) pool all 900 matches, about
  ±3 points.

### What is measured

- **Win rate by strategy:** the share of free-for-alls won by a camp playing
  it. Each strategy is doubled in a third of the matches, so the chance level
  is **33%** of matches (25% per camp).
- **Win rate by corner**, whatever strategy is there (chance: 25%).
- **Survival:** average time of elimination and finishing place per strategy.
- **Attacks:** waves launched at a rival camp, per camp, by strategy (Part C).

### Target ranges: the bounded stop condition

- No strategy wins more than **~50%** of free-for-alls.
- No corner wins more than **~35%**.

**Tuning procedure, fixed in advance** (the lesson of Phase 3's open-ended
search):

1. Baseline: measure the full matrix once, no tuning.
2. **One full tuning pass:** analyse the baseline, make one informed batch of
   adjustments, re-measure the full matrix once.
3. If a target is still missed: **at most 3 further adjustments**, each with a
   stated hypothesis (not a parameter sweep), then one re-measurement.
4. Then **stop**. A target still missed is recorded in BALANCE.md as an
   accepted exception, as Phase 3 did for Hard Turtle vs Rush.

**Levers:** only what Phase 3 established as tunable (strategy timing,
thresholds, composition weights) or Phase 7's targeting layer (scoring
weights, caution, attack triggers). No unit stats, costs or economy logic.
Free-for-all-only parameters live in `src/data` under an `ffa` key and are read
only with more than one rival, so the 1v1 fingerprints cannot move; the gate
checks that on every PR.

## Part C — Attack cadence

A strategy's win rate (Part B) and how often it acts are different things;
this part is about the second. Rush's waves are sized by unit count (14, then
10) and it reinforces; Boom and Turtle wait for an army *supply* (34/26 and
30/30) that, in a four-camp game where raids keep arriving, they rarely reach
at home. The change is free-for-all-only attack triggers for Boom and Turtle
(for example a wave threshold, or an opportunity trigger when the top-ranked
target is weaker or engaged), measured by **attacks launched per camp per
match, by strategy, before and after**. Target: every strategy launches at
least one attack in the median match, without changing what it builds.

## Part D — Stale intel and re-scouting

- **Freshness.** Each rival's intel has an age: the time since any of its units
  or buildings was last inside our eyes. Up to **45 s** it is trusted; from
  there its confidence falls linearly to 0 at **150 s**.
- **Scoring with uncertainty.** The strength ratio and the Castle-damage term
  are blended toward Phase 7's "assumed equal" default by that confidence:
  `R_used = 1 + confidence × (R − 1)`, `C_used = confidence × C`. Stale intel
  is labelled "stale" in the ranking.
- **Re-scouting.** After the first scout returns, a camp in a free-for-all
  sends a Peasant to re-look at the rival whose intel is stalest (its current
  target first), when that intel is older than **120 s** (or it was never
  scouted), at most one scout at a time and at most every **90 s**. It is the
  Phase 2 scout mechanism (walk to the rival's Castle start, loiter for two
  scans, return to mining), not a new vision system.

All numbers are in `RIVALS` (`src/data/rivals.js`).

## Results

### Part B: balance, against the stop condition

| Measurement (900 matches, Hard) | Rush | Boom | Turtle | Worst corner | Targets |
|---|---|---|---|---|---|
| Baseline (Part A only) | 14% | 42% | 44% | SW 29% | met |
| After Parts C and D (**shipped**) | 24% | 31% | 45% | NW/SW 28% | met |
| The tuning pass (rejected) | 20% | 50% | 31% | SW 29% | met, spread wider |

The baseline already met both targets. The one tuning pass (three
hypothesis-driven changes, BALANCE.md) widened the strategy spread and put
Boom on the ceiling, so it was reverted under the rule fixed before
measuring; with both targets met, no further adjustment was allowed or
needed. Details and every table are in BALANCE.md.

### Part C: attacks per camp, before → after

| Strategy | Mean | Median | Camps attacking at least once | Target changes per camp |
|---|---|---|---|---|
| Rush | 2.09 → 1.76 | 2 → 2 | 100% → 99% | 3.13 → 2.33 |
| Boom | 1.87 → 4.06 | 1 → 3 | 73% → 100% | 0.93 → 1.23 |
| Turtle | 1.91 → 4.36 | 2 → 4 | 84% → 99% | 1.10 → 1.83 |

Stability: the shipped values on disjoint seeds (1001–1100 per class): Rush
26%, Boom 27%, Turtle 47% (44–50%), corners 22–27%; pooled over 1,800
matches Rush 25%, Boom 29%, Turtle 46%, worst corner 27.5%. Both targets met
on both seed sets.

### Part A: symmetry

Every north-south mirror pair of marches within 0.5 s (median of 24); the
diagonals went from 0.72–0.77 s apart to identical; with the mirrored
separation order the north-south twin marches are exactly equal. All four
camps stay mirror-exact for 90 s for every strategy. The 1v1 fingerprints
(`GOLDEN`, `GOLDEN_PHASE5`) never moved; the Phase 6 free-for-all
production log is still reproduced with the fix switched off.

### Part D: stale intel

`test/stale-intel.test.js`: a rival seen weak once and then rebuilt out of
sight is trusted fully for 45 s, blended at 80 s, and not acted on after the
150 s window (assumed equal, no Castle bonus, not the target); a re-scout of
the current target sees the rebuilt army and the scoring flips to *clearly
stronger*. In full games each camp re-scouts 2–3 times a match.

### Full free-for-alls (the default layout, Hard)

Eight seeds on the shipped code (Azure Boom, Crimson Rush, Rose Boom, Jade
Turtle):

| Seed | Winner | Eliminations |
|---|---|---|
| 2 | Crimson (Rush), 10:28 | Rose to Crimson 6:01, Azure to Crimson 9:35, Jade to Crimson 10:28 |
| 3 | Jade (Turtle), 12:10 | Azure to Jade 6:45, Rose to Crimson 7:17, Crimson to Jade 12:10 |
| 5 | Azure (Boom), 17:09 | Rose to Crimson 9:32, Jade to Azure 10:20, Crimson to Azure 17:09 |
| 6 | Rose (Boom), 16:20 | Crimson to Rose 6:00, Azure to Jade 10:47, Jade to Rose 16:20 |
| 7 | Azure (Boom), 14:56 | Crimson to Rose 8:06, Rose to Azure 13:34, Jade to Azure 14:56 |
| 8 | Crimson (Rush), 7:33 | Rose to Crimson 5:36, Azure to Crimson 6:57, Jade to Crimson 7:33 |
| 9 | Jade (Turtle), 16:46 | Crimson to Rose 6:24, Rose to Jade 15:54, Azure to Jade 16:46 |
| 10 | Crimson (Rush), 15:54 | Rose to Crimson 4:43, Azure to Crimson 6:28, Jade to Crimson 15:54 |

Every corner and every strategy wins at least once; on Phase 7's four seeds
(2, 3, 5, 6) the winners were Crimson, Jade, Azure, Azure and are now
Crimson, Jade, Azure, Rose. Every camp acts in every game: Boom and Turtle
camps launched 1–10 opportunity waves each, all camps changed targets and
re-scouted.
