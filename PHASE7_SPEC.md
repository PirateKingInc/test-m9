# Phase 7 — Multi-rival AI

Phase 6 built the free-for-all: four camps, zones, capture on elimination. Its
AI camps used a deliberately simple **placeholder** rule: attack the nearest
living rival. Phase 7 replaces that rule with real multi-rival decisions. Each
AI camp now assesses every living rival, ranks them, and picks its target for
reasons it can state: a rival it saw fighting someone else, a rival it saw
lose its army, a rival that is hitting it. It holds back from a rival that is
clearly stronger, and uses its army to claim empty land instead. It defends
the zones it holds, and tries to take back one it just lost.

Still 4 camps (a 5th is deferred to a future difficulty-scaling phase). The
strategies' build and train scripts, unit stats, costs and every balance
number are **unchanged**; N-way balance tuning is Phase 8.

## What stays the same, and how that is proven

- **The 1v1 match is untouched.** Everything below runs only when there is
  more than one rival (`world.camps.length > 2`). With one rival there is
  nothing to rank, and the engine runs exactly its Phase 6 code path. The
  Phase 3 and Phase 5 fixed-seed fingerprints in the freeze guard must stay
  byte-identical.
- **Build, train and economy are untouched in the free-for-all.** The engine
  keeps the Phase 6 rule behind an option, `targeting: 'nearest'`. The freeze
  guard records the Phase 6 free-for-all *production log* (every build and
  train order every camp issued, with its tick) for three seeds, and a
  free-for-all run with `targeting: 'nearest'` must reproduce it exactly. The
  new targeting (`targeting: 'assess'`, the default) is then the only thing
  that differs.
- The AI still reads the world only through its view and acts only through
  `world.issue()`. The new code runs under the read-only proxy in the tests,
  and a guard test proves a write from the targeting code is caught.

## What an AI camp knows about a rival

No free full-map vision. A camp's knowledge of a rival comes from the Phase 2
scouting rules: its **eyes** are a 16-tile base watch around each of its
buildings and a 7-tile sight around each of its units (the scout Peasant,
armies on the march, expansion guards, zone squads). Every 2 s scan records
what is inside the eyes. On top of what Phase 2 recorded (type, position,
time), a scan now also records each sighting's **health** (hp / max hp).

Public information, which the HUD shows the human player too, may be used
without being seen: which camps are still alive, and who owns each zone.

### Military strength

For each living rival *r*:

- **Seen army** `M_r` = sum over the rival's combat units remembered from the
  last 90 s (the Phase 2 memory) of `supply × health fraction when last seen`,
  plus 3 for each of its Towers (Spires) we know is standing. A remembered
  unit that is **seen gone** (its last position is inside our eyes again and
  it is not there) no longer counts: we watched it die or leave.
- **Own army** `M_self` = the same sum over our own combat units (exact).
- **Strength ratio** `R_r = (M_r + 4) / (M_self + 4)`. The `+ 4` (two units'
  worth) keeps early numbers sane: two unscouted armies of zero are equal.
- A rival whose army we have **never seen** (no unit sighting in memory) is
  **unscouted** and assumed our equal: `R_r = 1`.

### Economic strength

`Z_r` = the number of zones rival *r* owns (public: the territory tint).

### Engaged with a third camp: what "witnessed" means

A rival is **engaged** when, in one of our scans within the last **45 s**, we
saw one of its units or Towers **inside our eyes** attacking an entity of a
third camp, or saw a third camp's unit or Tower inside our eyes attacking
one of its entities. "Attacking" means the visible attacker's current order
has that target (a unit's `attack` / `attackMove` target, a Tower's target):
the fight is inside the attacker's weapon range, so it is in view. Both
sides of a witnessed fight count as engaged. Fights we did not see do not
count, however loud: no event feed, no global battle list.

### Hitting us

`H_r` = 1 if, within the last 45 s, we saw one of the rival's units or Towers
attacking one of ours (anywhere in our eyes), else 0.

### Castle damage

`C_r = 1 − (health fraction of the rival's Castle when last seen)`, or 0 if
we have never seen it. A Castle at 20 % health gives 0.8.

### Travel time

`T_r` = the **measured** one-way march time in seconds between the two camps'
Castles, from the Phase 6 travel measurement (`test/travel.js`: a 14-unit
army's real path, walls and gates included). It is a data table,
`CAMP_TRAVEL` in `src/data/ffa.js`, and a test re-measures it and fails if
the table drifts by more than 1 s.

| | NE (2) | SE (3) | SW (4) |
|---|---|---|---|
| **NW (1)** | 49.0 | 65.6 | 41.0 |
| **NE (2)** | | 42.2 | 65.6 |
| **SE (3)** | | | 48.1 |

## Priority formula

Each camp scores every living rival *r* once per decision round:

```
P_r =   1.0 · (1 − min(R_r, 2))        weakness: below our strength scores up
      − 1.2 · max(0, R_r − 1)          overmatch: above it scores down, harder
      + 0.8 · E_r                      engaged with a third camp (0 or 1)
      + 0.6 · C_r                      Castle damage
      + 0.4 · H_r                      it is hitting us (0 or 1)
      + 0.15 · (Z_r − 1)               extra zones: a richer prize
      − 0.01 · T_r                     travel time, s
      + 0.2 · [r is our current target] stickiness: no flip-flopping on noise
```

All weights and thresholds live in `RIVALS` in `src/data/rivals.js`.

The **target** is the highest-scoring rival that is not clearly stronger
(`R_r < 1.5`). Ties go to the lower team number. When every living rival is
clearly stronger (`R_r ≥ 1.5` for all), the camp is **cautious**: it has no
target, launches no attack wave, and uses a ready wave to claim land (below).

With no intel at all (the opening minutes) every rival scores
`1.0 · 0 − 0.01 · T_r`, so the target is the nearest by measured travel time:
the same camp the Phase 6 placeholder picked.

**Hysteresis.** A rival that reached `R ≥ 1.5` stays *avoided* until its
`R` drops below **1.2**, so a ratio hovering around the line does not flip
the decision every scan.

The ranking is re-evaluated every decision round. A wave that is out
changes rival only when (a) its target fell, (b) its target became clearly
stronger (avoided), or (c) the new pick scores at least **0.75** more (about
one "engaged" bonus) and the wave has held its target for at least **20 s**.
It is then redirected by an attack-move from where it stands; when no rival
is left to attack it turns to a claim, or with nothing to claim it comes
home. The strategies' own wave sizes, retreat rules and reinforcement rules
are untouched. (These three numbers were added after the first full
playthroughs showed waves turning round every few seconds as "hitting us"
and seen strengths flickered; `switchMargin`, `commitTime` and
`cautionRelease` in `RIVALS`.)

### Caution: claim instead of attack

A cautious camp's ready wave marches to the nearest neutral or rival-owned
**non-home zone** that is **uncontested** (no rival building known there, no
rival combat unit seen within 12 tiles of its field in the last 60 s: the
Phase 3 `contested()` rule) and holds its gold field until military control
takes it (5 s alone there). With no such zone the army stays home at its
rally point (turtles). As soon as a rival drops below the caution line, the
camp targets it again.

## Reactive defense in the free-for-all

- **Early aggression** (Phase 2) counts hostile combat units from **all**
  rivals inside our base watch together: two raiders from two different
  camps are still two raiders in our base. Defend mode, its Towers and its
  recall of the wave work as before.
- **Massing** is evaluated **per rival**: a unit type counts as massed when
  one rival fields at least 5 of it and it is a majority of *that rival's*
  seen army. (Pooling rivals hid a massed army: 5 Horsemen from one camp and
  5 Shield Knights from another are 50 % each of the pool, and the pooled
  rule picked whichever came first.) When several rivals mass, the one we
  react to is our current target if it is massing, else the one hitting us,
  else the one with the largest seen army. The counter picks and the counter
  share of production are the Phase 2 values.

## Zone holding

Each AI camp keeps the non-home zones it owns, with a small **zone squad**
taken from its home army (never from a wave or the expansion guards):

- **Defend.** When a non-home zone it owns is being taken (a rival is its
  capture holder, which the banner shows) or rival combat units are seen in
  it, the camp sends a squad of up to **4** home combat units (at least 2) to
  its gold field, if the rival force seen there is at most 1.5× the squad's
  army value.
- **Recapture.** When it lost a non-home zone to a rival in the last **90 s**
  and the rival force seen there is at most the squad's value, it sends the
  squad to retake it (military control takes it back in 5 s).
- One squad at a time. It returns to the home army once the zone is ours
  with no rival seen there for 10 s, or after 60 s, or when defend mode
  needs everyone.

## Dev panel: targeting view

Behind the existing dev panel toggle (<kbd>`</kbd>), not the normal HUD, a
free-for-all shows each AI camp's current **ranking**: one row per rival,
best first, with its score, `R` (or "unscouted"), and the reasons that moved
it ("engaged with Azure", "Castle 20 %", "hitting us", "2 zones",
"clearly stronger"). Each camp's line starts with its posture: its target,
"cautious: claiming <zone>", or "holding". It refreshes twice a second while
the panel is open.

## Pathfinding asymmetry (flag only)

The north-south difference noted in Phase 6 is still present: in the
travel measurement the NE→SE leg takes 40.1 s and SE→NE 44.2 s, while the
NW↔SW legs are 41.2 / 40.7 s. It does not block this phase (the travel
table uses the round-trip average), so it stays in the backlog.
