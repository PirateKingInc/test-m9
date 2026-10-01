# Phase 12 — Scale validation: how high can the supply cap go?

Player feedback, the same in single-player and multiplayer: once a camp
reaches the supply cap (60), more Storehouses buy nothing, so a strong
economy has nothing left to spend on. The fix asked for is a much higher cap
(about 200 was mentioned, explicitly **not** a committed number). This phase
finds the number the engine actually supports, by measurement, then resizes
the economy and the maps to match it.

**Scope:** quantity and space only. No new units, abilities, upgrades or
Castle levels (Phases 13 and 14 build on this phase's numbers); no change to
unit stats, costs or counters; no UI work. All new numbers live in
`src/data`.

## Part A — the performance budget (set before measuring)

### What is measured

`tools/scale-scenario.js` builds the worst realistic moment of a big match:
a real match with **every camp's AI running**, each camp filled to the
tested supply cap around its home (20 Peasants, then soldiers), and at 5 s
every camp's soldiers attack-move to the map centre (free-for-all) or to the
enemy Castle (1v1): every army pathfinds through the gates and chokepoints at
once and fights. Two army compositions, because the cap limits supply, not
unit count:

- **mix**: a realistic late-game army, mostly 1-supply units with a share of
  Dragon Riders (2) and Shield Knights (3), 1.5 supply a unit;
- **swarm**: the worst case for unit count, every soldier 1 supply (a player
  is free to build only Horsemen and Archers).

Both maps (1v1: 2 camps; free-for-all: 4 camps). At a cap of 200 the
free-for-all swarm is 4 × 200 = 800 units, eight times the ~100-unit scale
Phase 6 stress-tested.

Three environments:

1. **Headless sim** (`node tools/scale.mjs`): the CI-class container, Node,
   one process, nothing else running. 150 s of simulation per run; every
   tick (world step plus every AI brain) and every pathfinding call timed.
   Sim cost does not depend on the screen, so this is the environment-
   independent number.
2. **Mobile proxy** (`SCALE=1 npx playwright test e2e/scale-mobile.spec.js`):
   the real game page in Chromium at a 844 × 390 phone viewport (touch, DPR 3)
   with the **CPU throttled 4×** (Chrome DevTools' "mid-tier mobile" preset),
   the camera zoomed all the way out over the battle (the most units on
   screen). 20 s measured, starting 3 s after the clash order.
3. **Desktop browser**: the same page at 1280 × 800, unthrottled.

**Limitation, stated plainly:** a 4× throttled desktop CPU is a proxy for a
phone, not a phone. It slows JavaScript but not the GPU, memory bandwidth or
thermal throttling of a real device, and headless Chromium draws with a
software GPU, so its frame rate says little about a phone's. No measurement
in this project has been taken on a physical device.

### The budget

| Environment | Measure | Budget | Why |
|---|---|---|---|
| Headless sim | mean tick | ≤ 5 ms | The Phase 3 stress budget: at 20 ticks/s the sim stays at about a tenth of one core, leaving the frame to rendering. |
| Headless sim | 99th-percentile tick | ≤ 16.7 ms | One 60 fps frame: at most one tick in a hundred can cost a frame. |
| Headless sim | slowest tick | ≤ 50 ms | One sim period (0.05 s): no tick may take longer than the time it simulates. In lockstep multiplayer a longer one stalls every player. |
| Mobile proxy | sim rate | ≥ 19 ticks/s | The game must not run in slow motion (20 is real time). In multiplayer the slowest phone sets every player's pace. |
| Mobile proxy | frame main-thread JS, median | ≤ 33.3 ms | Enough for 30 fps, the floor for an RTS on a phone. |
| Mobile proxy | frame main-thread JS, 95th percentile | ≤ 66.7 ms | Bad frames no worse than 15 fps. |
| Desktop browser | sim rate | ≥ 19.5 ticks/s | Real time. |
| Desktop browser | frame main-thread JS, median / 95th | ≤ 16.7 / 33.3 ms | 60 fps, bad frames no worse than 30 fps. |

Frame rate is **reported but not judged**: with a software GPU it measures the
container more than the game (Phase 3 made the same call).

**The rule for the cap:** a cap passes when every budget holds for **both**
compositions on **both** maps. The new cap is the highest tested cap that
passes; nothing is extrapolated beyond a tested point (if the highest tested
cap passes, higher caps are tested until one fails). Caps tested: 60 (today,
the baseline), 100, 150, 200, 250, 300.

### Amendments made after the first sweeps (and why)

The budget above was written before any measurement and is not changed. Three
things about *how* it is measured were changed after the first runs showed
problems with the measurement itself. Each is stated here so the reader can
judge it, and the numbers under the original method are reported too.

1. **Three seeds, the median.** The first single-seed headless sweep gave
   99th-percentile ticks that moved by up to 2x between identical reruns of the
   same seed (a shared container). Every headless cell is now three seeds
   (1, 2, 3); the mean, 95th and 99th percentiles are the median of the
   three runs, with the range of the three 99th percentiles beside them, and
   the slowest tick is the worst of the three runs (with the count of ticks
   over 50 ms in each run), so a single bad run is visible rather than hidden.
2. **The first tick is reported apart.** It builds the map's pathfinding grids
   and JIT-compiles that map's code while a full-cap army stands at home and
   the AI orders it out in the same tick, which no real match does (no camp
   has an army at 0:00). It is printed as "first" in every row; it never
   decides a cap.
3. **A frame that carries one tick (browser).** The container draws with a
   software GPU that holds the frame rate near 20 fps *whatever the game
   does* (the desktop run at cap 60 spends 1.7 ms of JavaScript a frame and
   still shows 20 fps). The sim runs on a fixed 20 Hz clock, so the slower the
   frames, the more sim ticks each frame must catch up on, and the
   "frame main-thread JS" budget then measures the software GPU as much as the
   game: at 4x throttle frames carried 2-5 ticks each. The browser harness
   therefore also times every sim tick on its own and reports the **one-tick
   frame**: each frame's non-sim work plus one of its ticks (its ticks'
   average), the cost of a frame on a device that keeps up with 20 fps or
   better. The 33.3 / 66.7 ms (mobile) and 16.7 / 33.3 ms (desktop) limits
   apply to it unchanged. The raw frame numbers are reported beside it, and
   the cap is stated under both.

## Results

### 1. Baseline: the Phase 11 code (issue #188)

The harness run against the code as Phase 11 shipped it (main at `45fcc6d`),
caps 60 to 200, before any change. `perf/scale-headless-before.json` and
`perf/scale-browser-before.json`; the tables are printed by
`node tools/scale-table.mjs`. A miss against the budget is **bold**.

**Headless** (ms per tick; three seeds, median; the slowest tick is the worst of the three runs):

| Map | Army | Cap | Units | Tick mean (≤ 5) | p95 | p99 (≤ 16.7) | p99 range | Slowest (≤ 50) | Ticks > 50 ms per run | First tick |
|---|---|---|---|---|---|---|---|---|---|---|
| 1v1 | mix | 60 | 96 | 0.25 | 0.7 | 3.4 | 2.9–3.5 | 46.1 | 0 / 0 / 0 | 93.7 |
| 1v1 | mix | 100 | 150 | 1.05 | 4.1 | 9.6 | 6.0–9.7 | **93.6** | 1 / 1 / 1 | 150.6 |
| 1v1 | mix | 150 | 216 | 1.89 | 7.8 | 14.7 | 12.1–17.6 | **201.4** | 1 / 1 / 1 | 259.3 |
| 1v1 | mix | 200 | 280 | 2.74 | 9.5 | **18.9** | 15.5–20.3 | **242.2** | 1 / 1 / 1 | 334.3 |
| 1v1 | swarm | 60 | 120 | 0.72 | 3.0 | 7.8 | 7.6–11.4 | **95.2** | 1 / 1 / 1 | 195.0 |
| 1v1 | swarm | 100 | 200 | 2.39 | 10.1 | **17.9** | 15.7–20.7 | **131.8** | 1 / 1 / 1 | 222.4 |
| 1v1 | swarm | 150 | 300 | 4.20 | 16.5 | **24.9** | 24.8–27.3 | **209.3** | 1 / 1 / 1 | 416.5 |
| 1v1 | swarm | 200 | 400 | **5.63** | 19.6 | **34.0** | 30.2–34.6 | **353.6** | 1 / 2 / 1 | 489.9 |
| ffa | mix | 60 | 192 | 0.51 | 1.8 | 4.2 | 3.2–4.3 | **82.0** | 1 / 1 / 1 | 126.7 |
| ffa | mix | 100 | 300 | 1.11 | 3.8 | 7.3 | 6.7–7.5 | **211.0** | 1 / 2 / 1 | 233.5 |
| ffa | mix | 150 | 432 | 2.47 | 7.8 | 16.5 | 12.4–17.3 | **266.5** | 2 / 2 / 2 | 433.3 |
| ffa | mix | 200 | 560 | 2.34 | 9.9 | **16.8** | 16.5–17.3 | **339.1** | 4 / 4 / 4 | 678.6 |
| ffa | swarm | 60 | 240 | 0.80 | 3.0 | 7.2 | 7.0–7.6 | **134.9** | 2 / 1 / 2 | 251.3 |
| ffa | swarm | 100 | 400 | 1.65 | 6.9 | 15.0 | 12.7–16.0 | **268.1** | 3 / 3 / 4 | 523.1 |
| ffa | swarm | 150 | 600 | 3.41 | 13.9 | **23.1** | 19.3–24.6 | **371.6** | 2 / 3 / 5 | 685.0 |
| ffa | swarm | 200 | 800 | **5.98** | 21.9 | **35.4** | 33.9–36.2 | **530.6** | 8 / 3 / 6 | 979.9 |

**Mobile proxy (844 × 390, touch, 4x CPU throttle)** — ms of main-thread JavaScript; budget p50 ≤ 33.3, p95 ≤ 66.7, sim ≥ 19 ticks/s

| Map | Army | Cap | Units | Sim ticks/s | One-tick frame p50 | One-tick frame p95 | Raw frame p50 | Raw frame p95 | Ticks per frame | Tick p50 / p95 | fps (not judged) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1v1 | mix | 60 | 96 | 20.0 | 8.3 | 28.7 | 7.9 | 29.8 | 1.1 | 2.5 / 10.3 | 18.3 |
| 1v1 | mix | 100 | 150 | 20.0 | 14.4 | 38.0 | 15.0 | 52.6 | 1.4 | 4.2 / 17.7 | 14.1 |
| 1v1 | swarm | 60 | 120 | 20.0 | 7.9 | 31.1 | 7.3 | 40.0 | 1.1 | 3.2 / 12.4 | 18.7 |
| 1v1 | swarm | 100 | 200 | 20.0 | 11.5 | 52.3 | 11.9 | **90.7** | 1.5 | 5.7 / 24.8 | 13.1 |
| ffa | mix | 60 | 192 | 20.0 | 13.6 | 31.0 | 14.5 | 36.9 | 1.3 | 5.1 / 12.7 | 15.8 |
| ffa | mix | 100 | 300 | 19.8 | 23.5 | 50.4 | 31.3 | **92.3** | 2.0 | 10.2 / 24.6 | 10.0 |
| ffa | swarm | 60 | 240 | 19.9 | 19.0 | 43.9 | 22.7 | 62.1 | 1.7 | 8.0 / 19.3 | 11.9 |
| ffa | swarm | 100 | 400 | 19.6 | 29.3 | 63.6 | **49.5** | **143.4** | 2.5 | 15.3 / 32.4 | 7.8 |

**Desktop (1280 × 800)** — ms of main-thread JavaScript; budget p50 ≤ 16.7, p95 ≤ 33.3, sim ≥ 19.5 ticks/s

| Map | Army | Cap | Units | Sim ticks/s | One-tick frame p50 | One-tick frame p95 | Raw frame p50 | Raw frame p95 | Ticks per frame | Tick p50 / p95 | fps (not judged) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1v1 | mix | 60 | 96 | 20.0 | 2.0 | 5.1 | 2.0 | 5.5 | 1.0 | 0.5 / 2.1 | 20.5 |
| 1v1 | mix | 100 | 150 | 20.0 | 3.3 | 8.1 | 3.3 | 8.8 | 1.1 | 0.9 / 3.8 | 18.1 |
| 1v1 | swarm | 60 | 120 | 20.0 | 1.8 | 7.1 | 1.6 | 7.4 | 1.0 | 0.7 / 2.6 | 20.8 |
| 1v1 | swarm | 100 | 200 | 20.0 | 2.7 | 12.8 | 2.7 | 16.6 | 1.2 | 1.5 / 5.9 | 16.8 |
| ffa | mix | 60 | 192 | 20.0 | 3.5 | 7.8 | 4.3 | 11.0 | 1.8 | 1.2 / 3.1 | 11.4 |
| ffa | mix | 100 | 300 | 20.0 | 5.2 | 11.3 | 7.1 | 16.0 | 2.0 | 2.0 / 4.8 | 10.2 |
| ffa | swarm | 60 | 240 | 20.0 | 3.8 | 8.4 | 5.0 | 11.5 | 1.7 | 1.6 / 3.9 | 11.5 |
| ffa | swarm | 100 | 400 | 20.0 | 6.4 | 15.3 | 9.2 | 24.2 | 2.2 | 2.9 / 6.3 | 9.2 |

**What the baseline says.**

- **Today's cap already misses the slowest-tick budget.** At cap 60 the
  free-for-all has 1-2 ticks per run over 50 ms (up to 135 ms) and the 1v1
  swarm one (95 ms). Each is the tick in which a whole army is ordered out:
  every unit plans its route in that same tick. That cost grows with the army,
  to 0.25-0.5 s at cap 150-200, a visible hitch in single-player and a stall of
  every player in lockstep multiplayer.
- **Behind the hitch, the steady cost is moderate.** Mean ticks stay under the
  5 ms budget to cap 150 everywhere (the two swarms miss at 200: 5.6 and
  6.0 ms); 99th percentiles pass to cap 100-150, except the 1v1 swarm, which
  misses already at 100 (17.9 ms).
- **The phone is the tightest place.** At 4x throttle, cap 100 is the first
  cap where frames miss (raw frame p95 91-143 ms in the 1v1 swarm and both
  free-for-all armies); the one-tick frame passes at 100, barely (63.6 ms
  against 66.7 in the free-for-all swarm).

So the first finding of the phase is that the ceiling is set by **route
planning bursts** in the sim, then by **per-tick sim cost on a phone**, not by
drawing: render time per frame stays at 1-10 ms everywhere.

### 2. Making the sim scale, without changing the game (issue #189)

Four changes, all in `src/sim`, guided by CPU profiles of the clash:

| Change | What it removes | Behaviour |
|---|---|---|
| The pathfinder resets only the nodes the last search touched (A* reaches a node only through `getNodeAt`/`getNeighbors`, both recorded) | a sweep of all 9,216 free-for-all nodes before every search: 73% of the clash tick | identical routes |
| Route smoothing's clearance check reads a flat walkability array | an object per sample point | identical routes |
| Separation hashes cells by number, `canStand` allocates nothing | thousands of short strings and arrays per tick | identical pushes, same order |
| **At most 96 route searches a tick**; past that a unit keeps its new destination with its route pending and plans it in a following tick, in unit order | the whole-army planning burst | a 400-unit order sets off over about four ticks (0.2 s) instead of one |

The first three cannot change anything a player sees: they compute the same
values, and `test/path-budget.test.js` checks 600 random routes on both maps
against a fresh-grid query. The search budget is the one deliberate behaviour
change, sized so that it **never triggers at the Phase 11 scale**: across 36
full 1v1 matches and 18 full free-for-alls at cap 60 the busiest tick planned
90 routes. Every fixed-seed fingerprint in `test/freeze.test.js` (Phases 3,
5, 6, 8, 9) and the fairness suite are unchanged; only the three file hashes
are re-pinned, with this justification beside them.

**Headless after** (`perf/scale-headless.json`, caps 60-300):

| Map | Army | Cap | Units | Tick mean (≤ 5) | p95 | p99 (≤ 16.7) | p99 range | Slowest (≤ 50) | Ticks > 50 ms per run | First tick |
|---|---|---|---|---|---|---|---|---|---|---|
| 1v1 | mix | 60 | 96 | 0.13 | 0.4 | 1.3 | 1.3–2.2 | 25.5 | 0 / 0 / 0 | 67.9 |
| 1v1 | mix | 100 | 150 | 0.48 | 1.6 | 3.1 | 3.0–3.3 | 46.0 | 0 / 0 / 0 | 54.3 |
| 1v1 | mix | 150 | 216 | 0.45 | 1.8 | 4.7 | 3.8–4.9 | 38.2 | 0 / 0 / 0 | 47.9 |
| 1v1 | mix | 200 | 280 | 1.41 | 4.2 | 7.5 | 7.0–7.9 | **51.1** | 0 / 1 / 0 | 62.0 |
| 1v1 | mix | 250 | 350 | 2.03 | 5.8 | 10.8 | 9.7–12.1 | **57.5** | 1 / 2 / 0 | 65.9 |
| 1v1 | mix | 300 | 414 | 0.90 | 4.4 | 8.8 | 8.3–11.0 | **51.9** | 1 / 0 / 1 | 65.9 |
| 1v1 | swarm | 60 | 120 | 0.32 | 1.4 | 3.4 | 2.3–3.5 | 25.6 | 0 / 0 / 0 | 39.5 |
| 1v1 | swarm | 100 | 200 | 1.12 | 3.5 | 6.8 | 6.2–7.5 | 45.8 | 0 / 0 / 0 | 61.0 |
| 1v1 | swarm | 150 | 300 | 1.84 | 5.8 | 9.5 | 7.2–13.6 | **53.7** | 1 / 0 / 0 | 80.3 |
| 1v1 | swarm | 200 | 400 | 2.65 | 8.4 | 16.2 | 12.7–17.1 | **71.6** | 1 / 2 / 3 | 53.2 |
| 1v1 | swarm | 250 | 500 | 4.33 | 12.3 | **29.6** | 29.2–33.8 | **63.8** | 1 / 0 / 2 | 78.8 |
| 1v1 | swarm | 300 | 600 | 4.73 | 14.6 | **36.4** | 34.5–38.6 | **68.0** | 0 / 5 / 3 | 74.8 |
| ffa | mix | 60 | 192 | 0.30 | 1.1 | 1.9 | 1.4–3.1 | 21.2 | 0 / 0 / 0 | 35.6 |
| ffa | mix | 100 | 300 | 0.52 | 2.1 | 3.7 | 3.6–3.8 | 22.0 | 0 / 0 / 0 | 36.5 |
| ffa | mix | 150 | 432 | 1.15 | 4.2 | 7.1 | 6.0–8.9 | 29.1 | 0 / 0 / 0 | 46.3 |
| ffa | mix | 200 | 560 | 1.46 | 6.5 | 10.7 | 10.5–11.0 | 27.2 | 0 / 0 / 0 | 48.1 |
| ffa | mix | 250 | 700 | 2.19 | 7.5 | 12.9 | 12.0–16.5 | 32.7 | 0 / 0 / 0 | 39.2 |
| ffa | mix | 300 | 828 | 3.69 | 11.2 | **20.0** | 19.4–20.3 | 41.7 | 0 / 0 / 0 | 47.3 |
| ffa | swarm | 60 | 240 | 0.36 | 1.1 | 2.1 | 2.1–2.7 | 15.4 | 0 / 0 / 0 | 25.2 |
| ffa | swarm | 100 | 400 | 0.70 | 3.3 | 5.9 | 5.8–7.0 | 21.9 | 0 / 0 / 0 | 36.1 |
| ffa | swarm | 150 | 600 | 1.74 | 7.1 | 12.7 | 12.1–13.5 | 28.8 | 0 / 0 / 0 | 38.9 |
| ffa | swarm | 200 | 800 | 2.74 | 11.2 | **17.5** | 17.4–18.7 | 41.1 | 0 / 0 / 0 | 93.7 |
| ffa | swarm | 250 | 1000 | 4.02 | 16.4 | **28.5** | 19.7–28.9 | **56.0** | 0 / 0 / 1 | 70.2 |
| ffa | swarm | 300 | 1200 | 4.46 | 17.9 | **26.2** | 25.3–27.3 | **59.9** | 1 / 0 / 2 | 67.6 |

**Mobile proxy (844 × 390, touch, 4x CPU throttle)** — ms of main-thread JavaScript; budget p50 ≤ 33.3, p95 ≤ 66.7, sim ≥ 19 ticks/s

| Map | Army | Cap | Units | Sim ticks/s | One-tick frame p50 | One-tick frame p95 | Raw frame p50 | Raw frame p95 | Ticks per frame | Tick p50 / p95 | fps (not judged) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1v1 | mix | 60 | 96 | 20.0 | 8.4 | 22.8 | 7.9 | 22.9 | 1.1 | 1.5 / 7.0 | 18.6 |
| 1v1 | mix | 100 | 150 | 20.0 | 15.3 | 39.8 | 16.3 | 50.2 | 1.5 | 3.2 / 14.7 | 13.2 |
| 1v1 | mix | 150 | 216 | 20.0 | 25.2 | 64.2 | 28.8 | **94.8** | 2.2 | 5.4 / 24.6 | 9.3 |
| 1v1 | mix | 200 | 280 | 19.9 | 32.0 | 66.0 | **38.2** | **123.2** | 2.6 | 6.9 / 22.0 | 7.7 |
| 1v1 | swarm | 60 | 120 | 20.0 | 7.3 | 27.7 | 6.8 | 31.5 | 1.1 | 2.2 / 9.6 | 18.3 |
| 1v1 | swarm | 100 | 200 | 20.1 | 10.3 | 52.6 | 11.2 | **71.8** | 1.6 | 3.8 / 19.1 | 12.9 |
| 1v1 | swarm | 150 | 300 | 19.6 | 11.4 | **69.7** | 14.5 | **134.9** | 2.0 | 7.6 / 30.2 | 10.0 |
| 1v1 | swarm | 200 | 400 | **16.9** | **38.9** | **135.7** | **57.3** | **279.3** | 3.3 | 14.4 / 46.0 | 5.2 |
| ffa | mix | 60 | 192 | 20.0 | 12.8 | 28.1 | 13.0 | 31.7 | 1.3 | 3.6 / 8.8 | 16.0 |
| ffa | mix | 100 | 300 | 20.0 | 19.7 | 45.6 | 22.3 | 59.1 | 1.7 | 6.1 / 14.7 | 11.9 |
| ffa | mix | 150 | 432 | 19.9 | **34.7** | **70.9** | **53.7** | **126.5** | 2.7 | 11.3 / 25.1 | 7.4 |
| ffa | mix | 200 | 560 | **17.7** | **40.7** | **113.5** | **93.2** | **223.6** | 3.5 | 18.8 / 35.5 | 5.1 |
| ffa | swarm | 60 | 240 | 20.0 | 16.2 | 36.3 | 18.6 | 44.1 | 1.5 | 5.0 / 11.9 | 13.2 |
| ffa | swarm | 100 | 400 | 20.0 | 22.0 | 55.6 | 28.5 | **95.2** | 2.1 | 9.9 / 21.4 | 9.5 |
| ffa | swarm | 150 | 600 | **18.7** | **45.9** | **95.8** | **88.0** | **198.4** | 3.6 | 17.8 / 36.3 | 5.2 |
| ffa | swarm | 200 | 800 | **15.7** | **80.2** | **106.5** | **206.4** | **265.8** | 4.8 | 28.8 / 55.2 | 3.3 |

**Desktop (1280 × 800)** — ms of main-thread JavaScript; budget p50 ≤ 16.7, p95 ≤ 33.3, sim ≥ 19.5 ticks/s

| Map | Army | Cap | Units | Sim ticks/s | One-tick frame p50 | One-tick frame p95 | Raw frame p50 | Raw frame p95 | Ticks per frame | Tick p50 / p95 | fps (not judged) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1v1 | mix | 60 | 96 | 20.0 | 1.8 | 5.5 | 1.7 | 5.5 | 1.0 | 0.4 / 1.9 | 20.9 |
| 1v1 | mix | 100 | 150 | 20.0 | 3.1 | 8.2 | 3.2 | 9.8 | 1.2 | 0.8 / 3.0 | 17.0 |
| 1v1 | mix | 150 | 216 | 20.0 | 4.3 | 11.5 | 4.6 | 13.1 | 1.3 | 1.2 / 5.0 | 14.8 |
| 1v1 | mix | 200 | 280 | 20.0 | 6.8 | 14.2 | 7.5 | 19.1 | 1.6 | 1.8 / 6.4 | 12.2 |
| 1v1 | swarm | 60 | 120 | 20.0 | 1.8 | 6.3 | 1.7 | 6.5 | 1.0 | 0.6 / 2.6 | 20.0 |
| 1v1 | swarm | 100 | 200 | 20.0 | 3.1 | 11.7 | 3.1 | 13.8 | 1.2 | 1.0 / 4.6 | 16.6 |
| 1v1 | swarm | 150 | 300 | 20.0 | 3.7 | 15.8 | 4.0 | 21.7 | 1.4 | 1.7 / 6.2 | 14.1 |
| 1v1 | swarm | 200 | 400 | 20.0 | 5.6 | 18.5 | 6.5 | 29.6 | 1.6 | 2.8 / 8.9 | 12.4 |
| ffa | mix | 60 | 192 | 20.0 | 2.7 | 6.2 | 3.3 | 8.1 | 1.6 | 0.8 / 2.2 | 12.2 |
| ffa | mix | 100 | 300 | 20.0 | 5.1 | 10.0 | 6.7 | 13.6 | 2.1 | 1.5 / 3.4 | 9.6 |
| ffa | mix | 150 | 432 | 20.0 | 7.9 | 16.6 | 11.8 | 23.4 | 2.5 | 2.3 / 5.3 | 8.0 |
| ffa | mix | 200 | 560 | 20.0 | 10.7 | 21.1 | **16.9** | 31.5 | 2.9 | 3.1 / 6.5 | 6.8 |
| ffa | swarm | 60 | 240 | 20.0 | 3.5 | 9.1 | 4.5 | 11.0 | 1.8 | 1.1 / 2.7 | 11.1 |
| ffa | swarm | 100 | 400 | 20.0 | 6.4 | 13.9 | 9.2 | 19.1 | 2.3 | 2.1 / 5.6 | 8.7 |
| ffa | swarm | 150 | 600 | 20.0 | 10.6 | 25.5 | **18.2** | **42.4** | 3.1 | 3.8 / 8.0 | 6.5 |
| ffa | swarm | 200 | 800 | 19.8 | **17.4** | 30.2 | **35.5** | **72.2** | 4.1 | 6.1 / 12.3 | 4.9 |

### 3. The supported cap

Under the rule set before measuring (every budget, both armies, both maps):

| Environment | Highest passing cap | First failing cap and why |
|---|---|---|
| Headless sim | **100** (150 if the slowest tick were taken as the median of the three runs) | 150: one tick of 53.7 ms in one of three 1v1 swarm runs; 200: free-for-all swarm 99th percentile 17.5 ms in all three seeds |
| Desktop browser | **100** raw; 150 one-tick | 150 raw: free-for-all swarm frame p50 18.2 / p95 42.4 ms; 200 one-tick: free-for-all swarm p50 17.4 ms |
| Mobile proxy, one-tick frame | **100** | 150: one-tick p95 70-96 ms in three of four cells, swarm sim rate 18.7 ticks/s |
| Mobile proxy, raw frame (the budget's literal reading) | **60** | 100: raw p95 71.8 ms (1v1 swarm) and 95.2 ms (free-for-all swarm) against 66.7 |

**The new cap is 100.** It is the highest cap every environment passes
under the measure that tests the game rather than the container's software
GPU (amendment 3), and it is also what the headless sim (strictly) and the
desktop give under the raw measure. The one reading that does not support it
is stated plainly: under the raw frame measure, the 4x-throttled phone proxy
misses at 100 in the two **swarm** cells (every camp an all-1-supply army),
by 5 ms in the 1v1 and 29 ms in the free-for-all, while those frames each
carried 1.6-2.1 ticks because the software GPU held the frame rate at 9-13
fps. The realistic mixed armies pass at 100 under both measures.

Cap 200, the number discussed before this phase, fails everywhere except
headless, by wide margins on the phone (one-tick p95 66-136 ms, sim rate down
to 15.7 ticks/s). 150 is not supported on a phone by either measure.

**Confidence.** The headless and desktop numbers are solid for this
container. The phone numbers are an emulation: a desktop CPU slowed 4x,
which models a mid-range phone's JavaScript speed but not its GPU, memory,
thermal throttling or browser. No physical phone has run any of this, in
this phase or any earlier one.

### 4. The cap and the Storehouse (issue #190)

- **`SUPPLY.max` 60 → 100**, for every mode: 1v1, single-player
  free-for-all and multiplayer read the same value, and nothing in the data
  called for an exception (the free-for-all, with four armies, is the
  heavier case and still passes at 100).
- **Storehouse 8 → 10 supply.** With the Castle's 10, **9 Storehouses**
  reach the cap. For the old cap it took 7. With 8 supply each, it would take 12 (1,200
  gold and twelve 3 × 3 footprints in the base); with 10, a player builds two
  more Storehouses than before and every one of them still raises the army
  ceiling, which is the feedback this phase answers. 10 is also a number a
  player can count with: Castle + 9 Storehouses = 100. The price stays 100
  gold, so housing costs 10 gold a supply instead of 12.5.
- **The AI** now builds Storehouses up to `SUPPLY.max` instead of a literal
  60 (`src/ai/engine.js`), so its camps can house a bigger army. Its attack
  thresholds (waves at about 30 supply) are unit design and not touched;
  whether an economy-focused camp actually approaches the cap is measured on
  the resized maps (section 5).
- **Equivalence.** `test/phase11-data.js` holds the Phase 11 values of
  exactly the fields this phase changes. With them put back, the gameplay
  hash is the Phase 4 release's and every fixed-seed fingerprint from
  Phases 3-9 reproduces. So the code changes alter nothing except through these
  values. The fingerprints with the new values are pinned beside them
  (`GOLDEN_PHASE12`, `GAMEPLAY_HASH_PHASE12`).

### 5. Maps, gold and travel (issue #191)

**Why resize.** At cap 100 a full army is 1.67x the Phase 11 one. Both maps
grow by **1.25 in each direction** (area 1.56x), which keeps the open ground
per unit of a full-cap army at 94% of Phase 11's. Chokepoints and gates widen
by the same factor. Each base keeps its exact layout around its Castle, so
every AI build spot (written relative to the Castle) is unchanged.

| | Phase 11 | Phase 12 |
|---|---|---|
| 1v1 map | 80 × 60 | **100 × 75** |
| 1v1 ridges / chokepoints | x 30-31 and 48-49; gaps 6 tiles (y 18-23, 36-41) | x 38-39 and 60-61; gaps **8** tiles (y 22-29, 44-51) |
| 1v1 Castles | (8,27), (68,27) | (8,35), (88,35) |
| Free-for-all map | 96 × 96, 32-tile zones | **120 × 120, 40-tile zones** |
| Free-for-all gates (camp east / camp south / centre) | 7 / 8 / 8 tiles | **9 / 10 / 10** tiles |
| Gold per mine (both maps) | 1,500 | **2,500** (× 5/3, the cap's growth) |
| Mines | 20 (1v1), 46 (free-for-all) | unchanged |

The AI's 1v1 data that names map tiles (the two middle fields' Depot, Spire
and guard spots, and the enemy-half search points) moved with the map; the
free-for-all AI derives everything from the zones.

**Travel (Phase 6's method, `test/travel.test.js`, `tools/travel.mjs`).** The
same 20-unit army, each march the median of 12 shifted marches, both
directions averaged:

| Camp pair | Phase 11 one-way | Phase 12 one-way | Phase 12 round trip |
|---|---|---|---|
| NW-SW (nearest) | 40.7 s | **54.3 s** | 108.6 s |
| NW-NE | 49.5 s | **64.4 s** | 125.6 s |
| NW-SE (diagonal) | 66.6 s | **88.1 s** | 176.7 s |
| 1v1 west-east (for comparison) | | | 100.7 s |

An undefended Castle still falls to the 14-unit raid in **9.0 s**, so the
nearest round trip is **12x** its lifetime (9x in Phase 11): leaving home
undefended is, if anything, a bigger risk than before, and every leg stays
well under the 2-minute ceiling Phase 6 set. Mirror pairs agree to 0.1 s.
`CAMP_TRAVEL` (which the AI's rival ranking uses) holds the new numbers.

**Economy: does a dedicated economy player approach the cap?**
(`node tools/economy.mjs`, three seeds, hard; `--phase11` for the old values.)

| | Phase 11 (cap 60) | Phase 12 (cap 100) |
|---|---|---|
| Sentinel (economy, never attacks), 30 minutes: peak supply | 60, reached at **5.7 min** | 99, reached at **8.7 min** |
| Sentinel: reaches 50 / 75 / 90% of the cap at | 3.3-3.5 / 4.3 / 5.2 min | 4.8 / 6.7 / 8.2 min |
| Sentinel: gold mined in 30 minutes | 12.5k | 16.6k |
| AI strategies in real 1v1 fights (9 matches, 18 camps): peak supply | 34-60, median 55; 6 camps at the cap | 39-77, median 67; none at the cap |
| AI strategies: gold mined by the longest-lasting camps | up to 15.1k | up to 24.8k |

So a dedicated economy still reaches the cap, but at about 9 minutes into a
30-minute match instead of under 6, and with every Storehouse up to the ninth
still adding to its army. The AI scripts, which attack in waves of about 30
supply, peak at a median 67 supply instead of 55, and none is held at the
cap any more (6 of 18 camps were). The cap, not gold, still decides the late game for a player who
only builds, because the cap is set by what a phone can run, not by the
economy.

**The route-search budget, revisited.** On the larger maps a route costs
more: crossing the 1v1 map touches about 4,500 pathfinding nodes against
about 1,200 for the free-for-all's camp-to-centre march. The first headless run at cap
100 on the new 1v1 map went back over the slowest-tick budget (85 ms: 96
long searches in one tick). A count of searches was the wrong unit, so the
budget is now **pathfinding work**: the nodes A* touches plus the flood fill
toward an unreachable goal, which is what costs time and is just as
deterministic. Measured cost is 0.36-0.58 ms per 1,000 nodes, so the budget
is **50,000 nodes a tick** (about 18-29 ms), held as data in
`src/data/scale.js`.

Unlike the count, this budget does bind in ordinary play. With no budget,
the busiest tick of 45 full AI matches (27 1v1, 18 free-for-all) touched
92,000-101,000 nodes at cap 60 on the Phase 11 maps, and up to 208,000 at
cap 100 on the new free-for-all. So the
fixed-seed games move, and they are re-pinned. The Phase 11 replays put back
an unlimited budget, which is exactly what Phase 11 had, and every earlier
fingerprint reproduces. What a player sees: a full-cap 1v1 army ordered
across the map has every route planned within **0.35 s** (7 ticks; the
free-for-all, 0.1 s), the first units setting off at once. That busiest
free-for-all tick, about 0.1 s of planning in one tick, is now spread over
about four.

**Performance on the resized maps, re-verified** (the shipped code and data;
`perf/scale-headless-maps.json`, `perf/scale-browser-maps.json`):

| Map | Army | Cap | Units | Tick mean (≤ 5) | p95 | p99 (≤ 16.7) | p99 range | Slowest (≤ 50) | Ticks > 50 ms per run | First tick |
|---|---|---|---|---|---|---|---|---|---|---|
| 1v1 | mix | 60 | 96 | 0.23 | 0.7 | 2.2 | 1.1–2.7 | 19.6 | 0 / 0 / 0 | 19.5 |
| 1v1 | mix | 100 | 150 | 0.59 | 2.1 | 8.8 | 8.1–9.2 | 12.3 | 0 / 0 / 0 | 12.3 |
| 1v1 | mix | 150 | 216 | 0.99 | 4.1 | 9.5 | 9.3–9.7 | 17.1 | 0 / 0 / 0 | 16.2 |
| 1v1 | swarm | 60 | 120 | 0.49 | 1.6 | 8.2 | 7.9–8.6 | 20.4 | 0 / 0 / 0 | 19.3 |
| 1v1 | swarm | 100 | 200 | 1.13 | 4.6 | 9.7 | 9.7–12.6 | 17.4 | 0 / 0 / 0 | 13.3 |
| 1v1 | swarm | 150 | 300 | 2.24 | 9.5 | 15.3 | 10.7–16.6 | 20.5 | 0 / 0 / 0 | 17.0 |
| ffa | mix | 60 | 192 | 0.34 | 1.1 | 2.2 | 1.9–2.4 | 27.3 | 0 / 0 / 0 | 46.0 |
| ffa | mix | 100 | 300 | 0.75 | 2.1 | 4.1 | 3.8–4.3 | 39.2 | 0 / 0 / 0 | 29.7 |
| ffa | mix | 150 | 432 | 0.94 | 3.0 | 5.6 | 5.4–5.9 | 32.0 | 0 / 0 / 0 | 38.9 |
| ffa | swarm | 60 | 240 | 0.40 | 1.4 | 2.5 | 2.4–2.8 | 27.1 | 0 / 0 / 0 | 31.0 |
| ffa | swarm | 100 | 400 | 0.91 | 3.3 | 6.3 | 5.4–8.1 | 23.1 | 0 / 0 / 0 | 26.9 |
| ffa | swarm | 150 | 600 | 1.45 | 5.4 | 12.0 | 10.4–12.1 | 32.5 | 0 / 0 / 0 | 50.8 |

**Mobile proxy (844 × 390, touch, 4x CPU throttle)** — ms of main-thread JavaScript; budget p50 ≤ 33.3, p95 ≤ 66.7, sim ≥ 19 ticks/s

| Map | Army | Cap | Units | Sim ticks/s | One-tick frame p50 | One-tick frame p95 | Raw frame p50 | Raw frame p95 | Ticks per frame | Tick p50 / p95 | fps (not judged) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1v1 | mix | 60 | 96 | 20.0 | 6.3 | 21.6 | 5.6 | 24.1 | 1.0 | 1.7 / 7.3 | 20.9 |
| 1v1 | mix | 100 | 150 | 20.0 | 11.3 | 34.6 | 11.9 | 43.9 | 1.3 | 3.1 / 15.2 | 14.8 |
| 1v1 | mix | 150 | 216 | 20.0 | 14.6 | 51.4 | 17.5 | **85.3** | 1.8 | 5.5 / 23.9 | 11.1 |
| 1v1 | swarm | 60 | 120 | 20.0 | 7.0 | 30.3 | 6.3 | 31.4 | 1.1 | 2.3 / 11.2 | 18.7 |
| 1v1 | swarm | 100 | 200 | 20.0 | 10.6 | 54.3 | 12.0 | **90.7** | 1.6 | 5.3 / 26.0 | 12.2 |
| 1v1 | swarm | 150 | 300 | 19.3 | 16.1 | **77.0** | 24.2 | **172.8** | 2.4 | 9.3 / 38.3 | 8.0 |
| ffa | mix | 60 | 192 | 20.0 | 8.5 | 20.2 | 7.6 | 21.4 | 0.9 | 3.3 / 7.8 | 22.5 |
| ffa | mix | 100 | 300 | 19.9 | 13.2 | 31.4 | 12.8 | 38.0 | 1.1 | 6.4 / 14.2 | 17.9 |
| ffa | mix | 150 | 432 | 19.8 | 20.4 | 48.5 | 24.0 | **79.3** | 1.6 | 11.2 / 23.2 | 12.5 |
| ffa | swarm | 60 | 240 | 20.0 | 11.7 | 33.8 | 11.6 | 43.2 | 1.2 | 5.4 / 12.7 | 17.2 |
| ffa | swarm | 100 | 400 | 19.9 | 18.4 | 46.4 | 22.0 | **73.1** | 1.6 | 11.1 / 22.4 | 12.5 |
| ffa | swarm | 150 | 600 | 19.5 | 30.6 | **70.3** | **50.1** | **154.8** | 2.4 | 18.9 / 35.5 | 8.3 |

**Desktop (1280 × 800)** — ms of main-thread JavaScript; budget p50 ≤ 16.7, p95 ≤ 33.3, sim ≥ 19.5 ticks/s

| Map | Army | Cap | Units | Sim ticks/s | One-tick frame p50 | One-tick frame p95 | Raw frame p50 | Raw frame p95 | Ticks per frame | Tick p50 / p95 | fps (not judged) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1v1 | mix | 60 | 96 | 20.0 | 1.7 | 4.7 | 1.7 | 5.2 | 1.2 | 0.4 / 1.7 | 17.0 |
| 1v1 | mix | 100 | 150 | 20.0 | 2.6 | 8.6 | 3.0 | 10.2 | 1.4 | 0.8 / 3.6 | 14.4 |
| 1v1 | mix | 150 | 216 | 20.0 | 4.2 | 13.1 | 4.5 | 17.3 | 1.6 | 1.3 / 5.6 | 12.5 |
| 1v1 | swarm | 60 | 120 | 20.0 | 1.5 | 6.9 | 1.7 | 7.9 | 1.2 | 0.5 / 2.5 | 16.3 |
| 1v1 | swarm | 100 | 200 | 20.0 | 3.9 | 11.6 | 4.3 | 15.6 | 1.5 | 1.2 / 6.0 | 13.0 |
| 1v1 | swarm | 150 | 300 | 20.0 | 6.5 | 17.1 | 8.1 | 29.4 | 2.0 | 2.4 / 7.8 | 10.2 |
| ffa | mix | 60 | 192 | 20.0 | 2.3 | 4.5 | 2.7 | 5.6 | 1.6 | 0.8 / 1.9 | 12.6 |
| ffa | mix | 100 | 300 | 20.0 | 3.4 | 8.0 | 4.9 | 10.5 | 1.9 | 1.5 / 3.1 | 10.5 |
| ffa | mix | 150 | 432 | 20.0 | 4.5 | 12.4 | 6.8 | 19.4 | 2.1 | 2.1 / 4.5 | 9.3 |
| ffa | swarm | 60 | 240 | 20.0 | 2.7 | 7.3 | 3.7 | 9.7 | 1.7 | 1.1 / 3.1 | 11.4 |
| ffa | swarm | 100 | 400 | 20.0 | 4.5 | 11.5 | 7.4 | 16.7 | 2.2 | 2.2 / 4.4 | 9.3 |
| ffa | swarm | 150 | 600 | 19.9 | 5.9 | 18.1 | 11.7 | 31.2 | 2.5 | 3.5 / 6.9 | 7.9 |

At **cap 100** every budget holds headless, on the desktop and on the phone
proxy's one-tick frame (worst p95 54.3 ms against 66.7). The raw phone frame
still misses in the two swarm cells only (1v1 90.7 ms, free-for-all 73.1 ms
p95, at 1.6 ticks a frame); every mixed-army cell passes it. The work budget
made the headless sim pass even at 150 (slowest tick 33 ms at most) and the
desktop too, but the phone proxy still fails at 150 under both measures
(one-tick p95 77.0 ms in the 1v1 swarm, 70.3 ms in the free-for-all swarm).
**The cap stays at 100.**
