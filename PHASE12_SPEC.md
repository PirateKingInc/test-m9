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

(Results after the pathfinding work, and the chosen cap, follow in section 2.)
