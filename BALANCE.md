# Balance report (Phase 3; four-camp free-for-all: Phase 8)

This file records how the three AI strategies fare against each other, before
and after Phase 3 tuning, how the Economy-Boom mirror's side bias was found
and fixed, and which balance targets were **not** met, and why. Every number here comes from the headless batch runner and is
reproducible: the sim is deterministic, so the same code and seeds give the same
results on any machine.

## How the matrix is measured

```bash
node tools/balance.mjs --seeds 100 --out balance/latest.json            # full matrix, 1,800 matches
node tools/balance.mjs --seeds 150 --mirrors --out balance/mirrors.json  # mirror matches only
node tools/balance.mjs --seeds 100 --offset 1000 --tiers hard            # a disjoint seed set, one tier
```

- **Cells.** Each unordered strategy pair, mirrors included, is played at each
  difficulty's timing, with **both sides on that tier**. That gives 6 pairs × 3
  tiers.
- **Seeds and sides.** Seeds run 1..N. Odd seeds put the row strategy in the
  west and even seeds put it in the east, so each off-diagonal cell is played
  equally from both sides and side bias cancels out.
- **Diagonal cells.** A mirror has no row/column winner, so the diagonal shows
  the **west side's** win rate. It is the side-bias measurement.
- **Confidence.** Brackets are 95% Wilson score intervals.
- **Speed.** The runner forks one worker per CPU. The full 1,800-match matrix
  takes about 12 minutes on the 4-CPU development container.
- **Raw data.** Every per-match result (winner, side, end reason, time and
  scores) is saved as JSON in `balance/`.

## Baseline: Phase 2 data (before tuning)

`balance/baseline.json` holds this run: 100 seeds per cell, 1,800 matches, on
the Phase 2 code at the start of Phase 3.

**Easy timing** (row's win rate vs column; diagonal = mirror, west side's win rate)

| | Rush | Boom | Turtle |
|---|---|---|---|
| **Rush** | 50% west | **0%** (0–4%) | **0%** (0–4%) |
| **Boom** | **100%** (96–100%) | 27% west | **100%** (96–100%) |
| **Turtle** | **100%** (96–100%) | **0%** (0–4%) | 60% west |

**Normal timing**

| | Rush | Boom | Turtle |
|---|---|---|---|
| **Rush** | 54% west | **0%** (0–4%) | **0%** (0–4%) |
| **Boom** | **100%** (96–100%) | 33% west | **97%** (92–99%) |
| **Turtle** | **100%** (96–100%) | **3%** (1–8%) | 55% west |

**Hard timing**

| | Rush | Boom | Turtle |
|---|---|---|---|
| **Rush** | 54% west | **0%** (0–4%) | **0%** (0–4%) |
| **Boom** | **100%** (96–100%) | 26% west | **94%** (88–97%) |
| **Turtle** | **100%** (96–100%) | **6%** (3–12%) | 57% west |

**What the baseline shows:**

- **A strict hierarchy, not a triangle.** Boom beats Turtle, which beats Rush,
  and Boom also beats Rush. Every cross-strategy cell is 94–100% one way. The
  60% ceiling is broken in all 9 cross cells.
- **Rush never wins.** Its first wave of 6 light units reaches a base that is
  already reacting to the early aggression: Turtle behind two Sentry Spires,
  Boom with a bigger economy. Both win the fight at home and then out-produce
  Rush.
- **Boom mirrors lean east** at every tier: 27%, 33% and 26% west. Over 300
  games that is 86 west to 214 east. See [Side bias](#side-bias) below.
- **Match length.** Rush-vs-X games end at about 6 minutes. Turtle games run
  11–13 minutes. The 30:00 time limit decided just 5 of 1,800 games, all of
  them Turtle mirrors.

## After: the shipped data

`balance/after.json` holds this run: 100 seeds per cell, 1,800 matches, on the
final Phase 3 data (strategies, difficulty caps, expansion, targeting).

**Easy timing** (row's win rate vs column; diagonal = mirror, west side's win rate)

| | Rush | Boom | Turtle |
|---|---|---|---|
| **Rush** | 54% west | **68%** (58–76%) | **1%** (0–5%) |
| **Boom** | **32%** (24–42%) | 53% west | **41%** (32–51%) |
| **Turtle** | **99%** (95–100%) | **59%** (49–68%) | 48% west |

**Normal timing**

| | Rush | Boom | Turtle |
|---|---|---|---|
| **Rush** | 46% west | **49%** (39–59%) | **19%** (13–28%) |
| **Boom** | **51%** (41–61%) | 54% west | **51%** (41–61%) |
| **Turtle** | **81%** (72–87%) | **49%** (39–59%) | 52% west |

**Hard timing**

| | Rush | Boom | Turtle |
|---|---|---|---|
| **Rush** | 54% west | **55%** (45–64%) | **23%** (16–32%) |
| **Boom** | **45%** (36–55%) | 57% west | **49%** (39–59%) |
| **Turtle** | **77%** (68–84%) | **51%** (41–61%) | 49% west |

### Stability (verification e)

These are sensitivity reruns, not tuning. Nothing was changed after them.

1. **An identical rerun.** The same 100 seeds were run with 3 workers instead
   of 4. All 1,800 results (winner, reason and end time) are **bit-identical**,
   so the sim is deterministic regardless of how matches are spread across
   processes. The fairness suite was also run twice with identical tables (see
   the final report).
2. **A disjoint seed set** (seeds 1001–1100, `balance/after-seeds1001.json`):

   | Cell (row's win rate) | Seeds 1–100 | Seeds 1001–1100 | Pooled (200) |
   |---|---|---|---|
   | Easy: Rush vs Boom | 68% | 62% | **65%** (58–71) |
   | Easy: Turtle vs Rush | 99% | 99% | **99%** (96–100) |
   | Easy: Turtle vs Boom | 59% | 62% | **61%** (54–67) |
   | Normal: Boom vs Rush | 51% | 63% | **57%** (50–64) |
   | Normal: Turtle vs Rush | 81% | 89% | **85%** (79–89) |
   | Normal: Turtle vs Boom | 49% | 62% | **56%** (49–62) |
   | Hard: Rush vs Boom | 55% | 49% | **52%** (45–59) |
   | Hard: Turtle vs Rush | 77% | 84% | **81%** (74–85) |
   | Hard: Turtle vs Boom | 51% | 59% | **55%** (48–62) |
   | Mirrors, west side | 46–57% | 46–54% | 49–54% |

**What the reruns show:**
- **No matchup flips.** No cell changes which strategy clearly wins, and the
  side-bias result holds.
- **The shifts lean one way.** Several cells moved by 6–13 points between the
  two 100-seed sets, and **almost all toward Turtle**. Each shift is within
  about 2 standard errors of the difference between two 100-game samples.
  Taken together, they suggest Turtle is **somewhat stronger than seeds 1–100
  alone show**.
- **Which numbers to use.** The pooled 200-seed numbers are the best estimate.
  With them, the Hard exception is Turtle vs Rush at **81%** (not 77%).
- **How precise a single set is.** One 100-seed set pins a cell to about ±10
  points, so an individual cell near the 60% line can land on either side of
  it.

### Against the 60% ceiling

| Cross cells within ~60% | Baseline | Best strategy balance (not shipped; seeds 1–100) | Shipped (pooled 200 seeds) |
|---|---|---|---|
| Easy | 0 of 3 | 3 of 3 (39–61%) | 1 of 3 (Turtle vs Boom 61%) |
| Normal | 0 of 3 | 3 of 3 (39–61%) | 2 of 3 |
| Hard | 0 of 3 | 2 of 3 | 2 of 3 |
| Worst cell | 100% | 77% (Hard, Turtle vs Rush) | 99% (Easy, Turtle vs Rush) |

The shipped data does **not** meet the 60% ceiling everywhere. Two things
account for the gap:

- **Hard (the rock-paper-scissors exception).** Turtle beats Rush 77% at Hard
  on seeds 1–100, and **81% pooled over 200 seeds**.
  This is accepted as a documented exception, not an open bug; see below.
- **Easy and Normal.** These are a deliberate trade against the difficulty
  table; see "Balance vs difficulty".

Every mirror cell is within 46–57% west: the side-bias fix holds on the final
data.

### Best strategy balance, measured (not shipped)

Before the difficulty cap described below, the same strategy data measured
**17 of 18 cross cells within 39–61%**. Only Hard Turtle vs Rush was out, at
77%.

- **Easy:** Rush 39% vs Boom, Rush 53% vs Turtle, Boom 39% vs Turtle.
- **Normal:** 42%, 40% and 39% respectively.
- **Hard:** 55%, 23% and 49%.

That state failed the Phase 2 difficulty table, so it is not what ships.

### The rock-paper-scissors finding

With exactly three strategies, each one's strength is defined against the other
two, and the tuning passes showed the three form a tight triangle.

- **Rush** wins by hitting before the enemy army exists. Only an early,
  greedy **Boom** is vulnerable to it.
- **Turtle** exists to stop an early attack: Spires, a quick defend reaction,
  and a Sparker-heavy army.
- **Boom** out-produces a Turtle that sits back.

Every lever that moved **Rush vs Turtle** at Hard moved **Rush vs Boom** or
**Boom vs Turtle** just as much, because it also changed how Rush or its
defender fares against the third strategy. Levers tried, measured on 48–100
fresh seeds each:

- Turtle's Spire count and defend reaction
- Turtle's Foundry count and composition
- Rush's supply buffer, wave size, retreat and composition
- Boom's opening, Foundry count, defensive Spires and composition
- Hard's reaction delay, decision interval, jitter and worker factor

Three examples of the trade:

| Change | Rush vs Turtle | Rush vs Boom | Boom vs Turtle |
|---|---|---|---|
| Sparker-heavy Rush | 60% | 81% | – |
| Plus a 4th Boom Foundry | – | 33% | 83% |
| Rush retreats when losing | 35% | 83% | – |

Whichever cell is fixed, another breaks. Three strategies in a triangle can't
all be pulled to 50/50 at once with these levers. A real fix needs a new lever
the scripts don't have, such as Sparker kiting, AI micro or a fourth strategy.
Those are all out of scope, and are recorded in BACKLOG.md.

**Design decision.** A uniform 60% ceiling across all pairings is **not
enforced at Hard**. At Hard, part of the difficulty a player experiences comes
from which matchup they draw. That is a documented design trade-off, not a
defect. The player can pick the AI's strategy on the start screen.

### Balance vs difficulty

The Phase 2 difficulty table must hold:

- a competent player beats every tier
- a novice loses at every tier
- harder tiers are harder

In Phase 2 that ordering came from **strategy strength**: Easy played the
weakest script and Hard the strongest. Balancing the strategies removed that
source. The best-balance state failed the table, and a policy × tier × strategy
measurement (12 fairness seeds each) showed why:

- The timing knobs barely move outcomes: decision interval, step delay,
  reaction delay and jitter.
- A lower worker factor can even *help*, because fewer Drones means an earlier
  army.

So difficulty now also caps **production**: the AI may run at most 1 Foundry
at Easy and 2 at Normal.

**Plainly:** Easy and Normal are now partly an **economic handicap on the AI**,
not just a weaker script.

- **What the cap does.** The capped AI can't convert its income into an army
  as fast as an uncapped player. The player is never capped.
- **How Phase 2 differs.** Phase 2 described difficulty as purely which
  script runs and how sharply it is timed. That is no longer the whole story:
  at Easy and Normal the cap is the main source of the difference.
- **What stays true.** The AI gets no extra resources or information, and the
  rules are the same for both sides. With the cap, the default strategies were re-picked from the
same measurement: Easy Turtle, Normal Rush, Hard Boom.

- **A milder cap fails.** A cap of 2 at Easy and 3 at Normal was measured
  once, and no choice of default strategies then satisfied the table.
- **The cost.** The balance matrix plays both sides at the same tier, so the
  cap binds both. It hurts Rush most, since Rush wins by running many
  Foundries. That produces Turtle vs Rush at 99% (Easy) and 81% (Normal).
- **The ranking.** Of the states measured, this is the only one that meets the
  hard requirement (the difficulty table) and has the best balance at Hard.

### The novice's 0% at Easy: overtuned?

The fairness harness shows the novice policy winning 0 of 12 at every tier. On
100 seeds against Easy it wins **1 of 100**, with a median game of 9:20.

That number is real, but it says more about **what the scripted novice does**
than about how hard Easy is:

- **The novice is an all-in Rush,** slower than the Easy AI.
- **Easy's default AI is Turtle-and-Tech,** and Turtle vs Rush is the worst
  matchup in the triangle. Under the Foundry cap it is 99% Turtle at Easy.
  The novice is attacking into the one opponent built to stop exactly that.

To check whether Easy is learnable by a real beginner, the `sentinel` script
was run against each tier. It is a fixed, never-adapting script that builds a
Depot, a Foundry, a Spire and a mixed army, and never attacks.

| `sentinel` (defends, never attacks) vs | Player wins | Survived to 30:00 | Median length |
|---|---|---|---|
| Easy | 1 / 40 | **33 / 40** | 30:00 |
| Normal | 0 / 40 | 0 / 40 | 7:10 |
| Hard | 0 / 40 | 0 / 40 | 7:46 |

**Judgment.**
- **Survivable.** Easy is survivable by a player who does little more than
  build a defense. Normal and Hard break the same defense in about 7 minutes.
- **Winnable with basics.** The intermediate policy is a capped Turtle with
  no attack plan beyond its script, and it wins 50% at Easy. The competent
  policy wins 100%.
- **Fair, not a coin flip.** So Easy is a fair fight for a weak but cautious
  player. The novice's 0% is not a sign of an unwinnable tier.

**The trade-off.**
- **What Easy teaches.** Easy is forgiving to a beginner who turtles and
  unforgiving to a beginner who rushes early. A new player's first instinct
  of sending everything at the enemy base will usually fail against Easy's
  Turtle.
- **The accidental 30:00 loss.** A beginner who only defends can survive yet
  still lose on score at 30:00. The sentinel won just 1 of those 33 games.
- **Mitigations.** The first-run tutorial's last hint points the player at
  the enemy Core. The start screen lets a player pick a different AI
  strategy, for example Rush, which is weaker at Easy under the cap. No real
  players were tested, so this is a judgment from scripted proxies.

### Tuned numbers

All balance changes are data in `src/data/strategies.js` and `src/data/difficulty.js`.

| Data | Phase 2 | Phase 3 |
|---|---|---|
| Rush workers / Foundries / float | 8 / 3 / 250 | 10 / 5 / 200 |
| Rush army mix | Striker 3 : Sparker 1 | Striker 2 : Sparker 2 : Lancer 0.5 |
| Rush first wave / waves / reinforce group | 6 / 5 / 3 | 14 / 10 / 4 |
| Boom opening | Foundry after 8 Drones | Foundry after 10 Drones (greedier) |
| Boom 2nd Foundry at / waves | 12 Drones / 14 then 10 units | 15 Drones / 34 then 26 army supply |
| Boom defend Spires | 1 | 0 |
| Turtle army mix | Bulwark 3 : Lancer 2 : Sparker 2 | Sparker 2 : Bulwark 2 : Lancer 1 |
| Turtle Foundries | 1, then a 2nd when Lumen floats | 2nd at 8 Drones, up to 3 |
| Turtle first wave | 36 army supply | 30 army supply |
| Wave-size jitter (all) | none | ±30% (seeded) |
| Easy step delay | 6 s | 2 s |
| Difficulty Foundry cap | none | Easy 1, Normal 2 |
| Default strategies (Easy / Normal / Hard) | Rush / Turtle / Boom | Turtle / Rush / Boom |
| Expansion | none | per strategy (SPEC.md "AI expansion") |

**Unit and building stats are unchanged.** Bulwark and Spire cost changes were
measured and rejected: they moved Rush-vs-Turtle and Boom-vs-Turtle together.
`test/counters.test.js`, the 1v1 counter table, still passes 100% in every row.

### Sudden death (30:00)

In the final matrix, **86 of 1,800 games (4.8%)** reached the 30:00 limit and
were decided on score. The baseline had 5.

- **Where.** Mostly mirror and Boom/Turtle games: 53 mirror games (Boom and Turtle mirrors), 20
  Boom-vs-Turtle and 13 involving Rush, spread across all three tiers. Once
  every field is mined out, both economies stall and neither army can finish
  the other.
- **Side.** Score decided 38 for the west and 48 for the east, which is 44%
  west with a 95% interval of 34–55%. That is consistent with no side bias,
  and none of these ended in a draw.

The data gives no reason to move the limit. It stays at 30:00. The rise
reflects longer, more even games, not a flaw in the score tiebreak.

## Side bias

### Finding

In the baseline, Boom mirrors went **86 west / 214 east** over 300 games: 27%,
33% and 26% west by tier. Rush and Turtle mirrors stayed within noise.

The map is an exact mirror image and both sides run the same script, so a skew
this large meant **some rule in the sim wasn't mirror-symmetric**.

### Method: the mirror trace

- **Setup.** Run a mirror match with the AI's timing jitter set to 0 and
  compare every tick: team 1's state against the mirror image of team 2's
  (units, buildings and Lumen).
- **What divergence means.** In a symmetric sim the two stay identical forever.
  The first tick where they differ points at the asymmetric rule.
- **The loop.** Fix that rule, re-run, and find the next divergence. This took
  the first divergence from **10 s** to 69 s, then 77 s, then (without the
  scout) about 120 s. What remains is float rounding (0.01 px) plus the
  scouts' exact head-on meeting at mid-map, an inherently symmetric tie.

### Root causes, fixed

1. **Spawn side.** A building with no rally point spawned units at its
   bottom-*right* corner on both sides. For the west base that faces the
   field; for the east base it faces away, into its own back corner. Boom
   trains 12+ Drones, so it felt this most. East now mirrors the west
   (bottom-left).
2. **Keep-right steering.** Movers meeting head-on both sidestepped to their
   own right, which is chirality, not symmetry: a mirrored pair should step in
   mirror image. They now step away from the side the other unit is on.
3. **Tie-break order.** These searches all broke ties west-to-east on both
   sides:
   - the spiral that picks the nearest free tile (formation slots, gather and
     build approach)
   - the BFS for the nearest reachable tile
   - the AI's building-placement search
   - A*'s choice between equal-cost paths

   The east half now searches in the mirror-image order, and east-half units
   plan paths in a mirrored frame (flip, plan with the west-half code, flip
   back).

West-side behaviour is unchanged from Phase 1: the sandbox bot's fight still
finishes in 42.9 s with the same survivors. `test/sidebias.test.js` locks each
fix in: spiral, path and spawn equivariance, plus a 90 s exact-mirror check for
each strategy. Against the pre-fix code, all 6 of its tests fail.

### Result: mirror matches after the fix

`balance/mirrors-after.json`: 150 seeds per strategy per tier, 1,350 matches.

| West win rate | Rush | Boom | Turtle |
|---|---|---|---|
| Easy | 47% (70/80) | 49% (74/76) | 53% (79/71) |
| Normal | 48% (72/78) | **50% (75/75)** | 57% (85/65) |
| Hard | 50% (75/75) | 51% (76/74) | 49% (73/77) |
| **All tiers** | 48% | **50% (225/225)** | 53% |

- **Boom.** It went from 86/214 to **225/225**.
- **Overall.** Across all 1,350 mirrors it's 679 west / 671 east.
- **The one cell above 55%.** Turtle at Normal was 85/65, and its 95%
  interval (49–64%) includes 50%. I re-ran it on 300 disjoint seeds (151–450)
  and got **150/150**. Over 450 games that's 235/215 (52%), so the 57% was
  sampling noise.
- **Effect on the fairness table.** The Phase 2 competent player runs as team
  1 (west). Against Hard (Boom) it rose from 25% to 58% once the west side
  was no longer handicapped. The table still holds: competent beats every
  tier, novice loses at every tier, and win rates fall from Easy to Hard.

## Four-camp free-for-all (Phase 8)

Phase 3 measured and tuned the 1v1 only. Phase 8 measures the four-camp
free-for-all for the first time ([PHASE8_SPEC.md](PHASE8_SPEC.md) "Part B").

### How it is measured

```bash
node tools/ffa-balance.mjs --seeds 100 --out balance/ffa-baseline.json   # 900 matches, Hard timing
```

- **Arrangements.** Four camps, three strategies: one strategy plays two
  camps. The 36 ways to place them fall into **9 classes** of 4 mirror images
  (which strategy is doubled, and whether its two camps are north-south
  neighbours, east-west neighbours or diagonal). The map is symmetric under
  both mirrors and the half turn, not under a quarter turn, so these are the
  meaningful permutations.
- **Seeds.** 100 per class, spread 25 per mirror image, so every corner hosts
  every role equally. 900 matches per run, every camp scripted at **Hard**
  timing, each played to its declared result (last camp standing, or the
  30:00 ranking).
- **What counts.** A strategy's win rate is the share of free-for-alls won by
  a camp playing it; each strategy is doubled in a third of the matches, so
  **chance is 33%** of matches (25% per camp). A corner's is the share won
  from that corner (chance 25%). Brackets are 95% Wilson intervals.
- **Targets (the bounded stop condition, set in advance):** no strategy above
  ~50%, no corner above ~35%. One tuning pass; if a target is still missed,
  at most 3 hypothesis-driven adjustments and one re-measurement; then stop
  and record any miss here as an accepted exception.
- **Speed.** About 14 s a match headless; a 900-match run takes about an
  hour on the 4-CPU development container. Raw per-match records are in
  `balance/ffa-*.json`.

### Baseline (before any Phase 8 tuning)

`balance/ffa-baseline.json`: the Phase 7 AI on the Phase 8 pathfinding fix,
no other change.

| Strategy | FFAs won (chance 33%) | Per camp (chance 25%) | Avg place | Avg elimination | Attacks per camp (mean / median) | Camps attacking ≥ once | Retargets per camp |
|---|---|---|---|---|---|---|---|
| Rush | **14%** (12–17%) | 11% | 3.07 | 9.0 min | 2.09 / 2 | 100% | 3.13 |
| Boom | **42%** (39–45%) | 31% | 2.25 | 11.2 min | 1.87 / 1 | 73% | 0.93 |
| Turtle | **44%** (41–47%) | 33% | 2.19 | 11.4 min | 1.91 / 2 | 84% | 1.10 |

| Corner | FFAs won (chance 25%) | Avg place |
|---|---|---|
| NW | 27% (24–30%) | 2.52 |
| NE | 24% (21–27%) | 2.50 |
| SE | 20% (18–23%) | 2.53 |
| SW | 29% (26–32%) | 2.44 |

| Class (100 seeds each) | Rush wins | Boom wins | Turtle wins |
|---|---|---|---|
| Rush ×2, east-west neighbours | 13 | 36 | 51 |
| Rush ×2, diagonal | 26 | 24 | 50 |
| Rush ×2, north-south neighbours | 32 | 44 | 24 |
| Boom ×2, east-west neighbours | 18 | 70 | 12 |
| Boom ×2, diagonal | 18 | 69 | 13 |
| Boom ×2, north-south neighbours | 13 | 62 | 25 |
| Turtle ×2, east-west neighbours | 5 | 23 | 72 |
| Turtle ×2, diagonal | 1 | 31 | 68 |
| Turtle ×2, north-south neighbours | 4 | 17 | 79 |

900 matches, no draws, 15 decided at the 30:00 limit, 14.1 minutes on
average.

**What the baseline shows:**

- **Both targets are already met:** the strongest strategy (Turtle) wins 44%
  of free-for-alls, the strongest corner (SW) 29%.
- **Rush is weak in a four-way game:** 14% of wins against a 33% chance level,
  last on average, and out first (9.0 min). Its waves never retreat; in a 1v1
  a lost wave only hands the initiative back, but in a free-for-all a camp
  that throws its army away is open to two other rivals. When Rush is doubled
  and its two camps are north-south neighbours (the closest pair, 41 s), it
  does best (32%): they often go at each other's rivals rather than being
  picked apart.
- **Doubling a strategy helps it**, as expected (two camps, two chances):
  Boom wins 62–70% when doubled, Turtle 68–79%.
- **An east-west lean.** The west corners win 56% (NW 27% + SW 29%) and the
  east 44%, about 3.7 standard deviations from even; every strategy leans
  the same way (Rush 84 west / 46 east, Boom 209 / 167, Turtle 208 / 186).
  North vs south is even (51 / 49). The pathfinding is mirror-equivariant in
  both axes (Phase 8 Part A), but a long east-west march is still about 1.3 s
  slower westward than eastward (median of 24, PHASE8_SPEC.md), which is
  crowd behaviour on the way, not route choice. It stays inside the corner
  target; it is recorded in the backlog.
- **Attacks are not as lopsided as Phase 7 thought; decisions are.** Every
  strategy launches about two attacks per camp (medians 2 / 1 / 2), but a
  quarter of Boom camps and a sixth of Turtle camps never attack at all, and
  Rush makes about three times as many target *changes* (3.1 per camp vs
  0.9–1.1): it has waves out most of the time, so its ranking shows.

### After Parts C and D (attack triggers, stale intel and re-scouting)

`balance/ffa-after-cd.json`: the same 900 seeds after the Boom/Turtle
opportunity trigger (Part C), intel staleness with re-scouting (Part D) and
the mirrored separation order. No balance tuning yet.

| Strategy | FFAs won | Per camp | Avg place | Avg elimination | Attacks per camp (mean / median) | Camps attacking ≥ once | Retargets per camp | Re-scouts per camp |
|---|---|---|---|---|---|---|---|---|
| Rush | **24%** (22–27%) | 18% | 2.80 | 9.1 min | 1.76 / 2 | 99% | 2.33 | 2.67 |
| Boom | **31%** (28–34%) | 23% | 2.64 | 9.2 min | 4.06 / 3 | 100% | 1.23 | 2.69 |
| Turtle | **45%** (41–48%) | 33% | 2.06 | 11.7 min | 4.36 / 4 | 99% | 1.83 | 2.34 |

Corners: NW 28%, NE 22%, SE 23%, SW 28% (west 55%, east 45%). No draws, none
at the time limit, 13.4 minutes on average.

**Attack frequency (Part C), before → after:**

| Strategy | Attacks per camp, mean | Median | Camps that attack at least once | Target changes per camp |
|---|---|---|---|---|
| Rush | 2.09 → 1.76 | 2 → 2 | 100% → 99% | 3.13 → 2.33 |
| Boom | 1.87 → **4.06** | 1 → **3** | 73% → **100%** | 0.93 → 1.23 |
| Turtle | 1.91 → **4.36** | 2 → **4** | 84% → **99%** | 1.10 → 1.83 |

Every strategy now acts in essentially every match, and Boom and Turtle
change targets far more often, so their rankings show. The lopsidedness
reversed on raw launches (Boom and Turtle now launch more, smaller waves than
Rush), but decisions are much closer to even (Rush 1.9× Turtle, was 2.8×).

**Effect on balance:** Rush rose from 14% to 24% (other camps now attack
earlier and more, so Rush is less often the one caught out), Boom fell from 42%
to 31% (its early opportunity waves cost it: out 2 minutes sooner on
average), Turtle is unchanged at 45%. Both targets are still met.

### The tuning pass (one pass, rejected)

After Parts C and D both targets were met (worst strategy Turtle 45%, worst
corner 28%), so the stop condition did not require tuning. The one tuning
pass allowed by the procedure was used on the remaining spread (Turtle 45% /
Boom 31% / Rush 24%, 21 points), under a rule fixed **before** measuring:
keep the pass only if the targets stay met **and** the strategy spread
narrows; otherwise revert to the Part C/D values. Three changes in one batch,
each with its hypothesis:

1. **Boom's opportunity threshold 16 → 22 supply.** Its early opportunity
   waves cost it: after Part C it fell 2 minutes sooner and its win share
   dropped from 42% to 31%.
2. **A known Tower counts 2 army value in a rival's strength instead of 3.**
   Turtle's visible Towers make rivals rate it "clearly stronger" and leave it
   alone to grow.
3. **Rush retreats at 35% of its wave in the free-for-all** (it never
   retreats in the 1v1): throwing its army away leaves it open to two rivals.

`balance/ffa-tuning-pass.json`, the same 900 seeds:

| Strategy | Before the pass (C+D) | After the pass |
|---|---|---|
| Rush | 24% | 20% |
| Boom | 31% | **50%** |
| Turtle | 45% | 31% |
| Spread | 21 points | **30 points** |

Corners after the pass: NW 27%, NE 20%, SE 23%, SW 29%.

**Rejected.** Both targets were technically still met, but Boom landed exactly
on the ~50% ceiling and the spread widened from 21 to 30 points: change 1
overshot (Boom +19 points; it is by far the most sensitive lever measured),
and Rush did not gain from retreating. The pass was reverted in full; the
shipped values are the Part C/D ones above. Since both targets are met with
them, the procedure's "up to 3 further adjustments" step (which applies only
to a missed target) was not triggered, and tuning stopped here, as the stop
condition requires. No open-ended search was run.
