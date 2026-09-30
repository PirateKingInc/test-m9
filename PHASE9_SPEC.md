# Phase 9 — Auto-defend, moving structures, hopeless camps

Three pieces of player feedback:

1. When a camp was raided, players had to mobilise every idle unit by hand.
   Idle defenders should engage on their own.
2. Players want to move a building they already built, not only build new
   ones.
3. A camp with a Castle, no army and no way to ever produce one again just
   watches itself lose, slowly. With multiplayer as the long-term direction,
   nobody should be stuck in an unwinnable, unwatchable holding pattern.

Out of scope (dropped by decision): a starting Storehouse for every camp,
units walking through their own buildings. Also a 5th camp, difficulty
scaling, theory-of-mind AI, and any change to 1v1 unit stats, costs or the
economy beyond what the three parts need.

All new numbers live in `src/data/camp-rules.js`.

## Part A — Auto-defend

### Rules

- **Who.** A camp's combat units (not Peasants; the same rule as Phase 6's
  military presence), standing in a zone the camp **currently owns**: any
  owned zone, not only the home zone.
- **Idle means** the unit has no order of its own: its order is `idle`, or it
  is already under automatic control (Phase 1's idle auto-acquire, an
  auto-defend engagement, or an auto-defend walk back to its post). A unit
  executing any order its owner gave it (move, attack, attack-move, gather,
  build, AI strategy orders alike) is **never** touched, and auto-defend never
  reaches outside the zone: nothing is recalled from elsewhere on the map.
- **Trigger.** Every 0.5 s (tick-aligned, deterministic), in every zone a camp
  owns, if a hostile unit (any unit of another camp) stands in that zone,
  each of the camp's idle combat units in the zone engages the nearest such
  hostile unit. Towers already shoot anything in range; Castles have no
  weapon.
- **The fight.** An engaged unit fights exactly like any unit with an attack
  order (chasing, range, damage). It is not leashed by Phase 1's chase range;
  instead it keeps the zone: when its target dies or leaves the zone it takes
  the nearest remaining intruder in the zone.
- **Afterwards.** When no hostile unit is left in the zone, each engaged unit
  walks back to its **post**: the spot where it stood idle when it was first
  pulled in. It does not go back if its post is now in a zone the camp no
  longer owns, or in a contested zone (a hostile tile); then it stays where
  the fight ended. The walk back is itself automatic, so a new intruder
  interrupts it.
- **Any order cancels it.** An order from the unit's owner (player or AI)
  replaces the automatic one and forgets the post.
- **Symmetric.** It is a sim rule, applied to every camp alike, player and AI.
- **Where.** Only worlds with zones: the free-for-all. The 1v1 map has no
  territory, so there the Phase 1 rule (idle units attack enemies within
  200 px and give up past 320 px) is unchanged, and so are the 1v1
  fingerprints.

## Part B — Moving a structure

### Rules

- **The command.** Select one of your completed buildings, choose **Move**,
  then tap or click the new spot. The same placement rule as building applies
  (the footprint must be free; the building's own old footprint counts as
  free).
- **What can move.** A completed Storehouse, Barracks or Watchtower with an
  empty training queue. **The Castle cannot move:** it is the camp's life
  (losing the last completed Castle eliminates the camp), and a Castle in
  transit would either be an instant elimination or a special case that no
  other building has. Training must be finished or cancelled first, so no
  unit or gold is lost in transit.
- **Cost:** 50% of the building's cost, rounded down (Storehouse 50,
  Barracks 75, Watchtower 60), paid when the move is confirmed.
- **Time:** 50% of its build time (Storehouse 10 s, Barracks 15 s,
  Watchtower 12.5 s).
- **In transit** the building is an ordinary construction site: not built,
  so no training, no supply, no drop-off, no Tower fire, no military
  presence. It starts at 10% health and gains health as it goes up, exactly
  like a new site. The difference: the crew moves with the building, so it
  rebuilds itself without a Peasant (Peasants cannot speed it up).
- **The old building is removed at confirmation**, not when the new one is
  finished. Reasons: a building must never be in two places (two supply
  providers, two drop-offs, two Towers for a moment); the move then reads
  exactly like demolishing and rebuilding at a discount; and it is the only
  rule that is also safe for a Storehouse in a camp near its supply cap
  (the lost supply is visible at once, not a surprise later).
- **Into hostile ground.** A site gives no military presence, so moving a
  building into a zone another camp holds is no capture at all: the zone
  changes hands only by Phase 6's rules (sole military presence for 5 s). The
  site can be attacked and destroyed while it goes up, like any site. Once a
  moved Watchtower is finished it counts as presence, so moving it into an
  enemy zone makes the zone contested, as walking an army in would.

## Part C — Hopeless camps

### The predicate

A camp is **hopeless** when all of these hold:

1. **No combat units** (Peasants do not count).
2. **No unit in production** in any of its buildings (it would come out).
3. **No completed Storehouse** (the literal "no income structure" check, kept
   as an extra safeguard even though the search below already covers it).
   Only a Storehouse takes in gold in this game; the Castle does not.
4. **No Peasant while gold is left in any mine.** A Peasant that could still
   reach a mine keeps the camp in the game even when the search shows it
   could never deliver (no Storehouse and not enough gold for one): the rule
   errs toward under-triggering.
5. **No reachable future:** a search over an abstract model of the camp
   proves that **no sequence of actions** produces a unit or income:

   The abstract state is: banked gold; whether the camp has a Peasant;
   whether it has a completed Castle, Barracks and drop-off; the unfinished
   sites it owns. The moves are everything the rules allow: train a Peasant
   (completed Castle, 50 gold) or a soldier (completed Barracks, 60 gold) —
   **success**; gather (a Peasant, a drop-off, and gold left in any mine on
   the map) — **success**; place a building (a Peasant and its cost, into any
   of the four types); finish a site (a Peasant); cancel a site (75% refund).
   The search explores every reachable state; the camp is hopeless only if
   none of them reaches a success.

   The model **over-approximates** what the camp can do, so it can only
   under-trigger: it ignores supply limits, assumes a placement spot always
   exists, assumes any gold mine anywhere is reachable, and assumes a
   Peasant always survives to do the job.

A camp that meets the predicate **continuously for 5 s** (the confirmation
window) is eliminated. It is checked once a second.

### False-positive safeguards (each has a scripted test)

- A Peasant alive and any gold left in any mine: not hopeless (whether or
  not it could get a drop-off).
- Enough gold for the cheapest unit (a Peasant at a completed Castle, a
  soldier at a completed Barracks): not hopeless.
- A unit in a training queue: not hopeless.
- Any combat unit alive: not hopeless.
- An unfinished site whose cancel refund would buy something: not hopeless.
- A completed Storehouse: never flagged.
- A camp that is hopeless for less than the 5 s window (for example a
  Peasant that dies a moment before a new one finishes training) is not
  eliminated.

### Elimination

- **Free-for-all:** the camp goes through Phase 6's elimination pipeline
  exactly as if its last Castle had fallen (its buildings are razed, it
  leaves the standings as eliminated, reason `hopeless`). No camp landed a
  killing blow, so **nothing is transferred to anyone**: its zones become
  neutral and capturable under the normal rules, and whatever gold it still
  had banked is left in its home zone, paid to the camp that next captures
  that zone.
- **1v1:** the other camp wins, reason `hopeless`.
- **No double firing.** The Castle check runs first in the same tick: a camp
  whose Castle falls is eliminated by Castle destruction, and the hopeless
  check only ever looks at camps still standing.
- Everyone alike: player and AI camps.

## Results

### Auto-defend (`test/auto-defend.test.js`, 10 tests)

An idle soldier engages an intruder anywhere in its home zone, beyond the
old 200 px aggro range; any owned zone counts, not only home; nothing
happens in a zone the camp does not own and nothing is pulled in from
another zone; a unit carrying out an order is never interrupted; Peasants
never engage; after the fight the unit walks back to its post, but not into a
zone that has turned hostile; an owner's order cancels the automatic one and
forgets the post; AI camps defend the same way; the 1v1 is unchanged.

### Moving a structure (`test/relocate.test.js`, 6 tests; `e2e/relocate.spec.js`, 3)

Half cost paid at confirmation and half build time with no Peasant, for all
three movable types; the old building is gone at once; in transit there is
no training, supply, drop-off or Tower fire; the Castle, a training
building, an unfinished one, an unaffordable move and a blocked spot are all
refused with nothing charged; a building can shift onto its own old
footprint. **Contested zones:** moving a Watchtower into a zone a rival holds
does not capture it, and the rival's guards destroy the site while it goes
up; a moved Watchtower that finishes in a rival's zone makes it contested
without taking it. In the browser: mouse (select, **V**, click), the Castle
has no Move button, and touch (tap, Move, drag, lift).

### Hopeless camps (`test/hopeless.test.js`, 16 tests; `e2e/hopeless.spec.js`, 1)

False-positive safeguards, each its own scenario, none flagged: a Peasant
with gold left in a mine; a Peasant on a mined-out map with gold for a
Storehouse; exactly enough gold for a Peasant at the Castle (49 gold is
flagged, 50 is not); a Barracks with gold for a soldier (60 / 59); a queued
unit; any combat unit; an unfinished site whose refund buys something; a
completed Storehouse; a camp hopeless for less than the window. The search
chains actions (cancel a site, build a Storehouse with the refund, mine).
Positive cases: a genuinely hopeless camp goes out after the window with no
conqueror, its zones neutral, nothing razed left, its gold left as loot in
its home zone and nothing paid to anyone; whoever next captures that zone
gets the gold; a same-tick Castle loss is an ordinary conquest, eliminated
once; the player's camp is judged the same way; in the 1v1 the other camp
wins with reason `hopeless`, and the result card says so.

In the 900-match re-measurement the rule **never fired**: all 2,697 falls
were Castle losses. Scripted AI camps always keep a Peasant, gold or a queued
unit until their Castle falls. It is a safety net for human play.

### Fingerprints

- 1v1 (`GOLDEN`, `GOLDEN_PHASE5`, `GAMEPLAY_HASH` pins): **unchanged**. The
  1v1 has no zones, and the hopeless rule never fires in those matches.
- Phase 6 and Phase 8 free-for-all fingerprints: **reproduced unchanged** with
  the Phase 9 rules switched off (`world.autoDefend = world.hopelessCheck =
  false`), proving build and train logic are untouched.
- **New `GOLDEN_PHASE9_FFA`** (seeds 1–3, 600 s): auto-defend changes who
  fights where, so the free-for-all production logs with the rules on are
  different by design and re-pinned under their own name.
- `test/ffa-rivals.test.js` "claims": the Phase 7 check that a zone claim
  *completes* was relaxed to "the AI issues claims": auto-defending units
  now contest those zones, so on the fixed seed the claims are fought over
  instead of walked in.

### Balance

See BALANCE.md "Phase 9 re-measurement": Rush 24%, Boom 28%, Turtle 48%;
corners 22–28%. No severe outlier (~65% / ~45%), so no intervention.

### Free-for-all playthroughs (`node tools/ffa-playthrough.mjs 2 3 5 7 11 13`)

Camp 1 is a scripted Boom player that moves its first finished building at
5:00; the others are the Hard AI (2 Rush, 3 Boom, 4 Turtle).

| Seed | Result | Falls (all to a conqueror) | Auto-defend engagements (camps 1/2/3/4) | Walks back | The player's move |
|---|---|---|---|---|---|
| 2 | Turtle (4) last standing, 14.6 min | 1 by 2 @7.8, 3 by 4 @12.8, 2 by 4 @14.6 | 8 / 37 / 86 / 21 | 12 | Storehouse, up in 10.0 s |
| 3 | Turtle (4), 13.1 min | 3 by 2 @7.2, 1 by 4 @7.2, 2 by 4 @13.1 | 0 / 53 / 2 / 3 | 2 | Storehouse, 10.0 s |
| 5 | Boom (3), 15.6 min | 2 by 3 @7.2, 4 by 1 @12.3, 1 by 3 @15.6 | 87 / 24 / 114 / 0 | 9 | Storehouse, 10.0 s |
| 7 | Rush (2), 20.5 min | 3 by 2 @4.5, 1 by 4 @5.7, 4 by 2 @20.5 | 0 / 91 / 0 / 27 | 2 | Storehouse, 10.0 s |
| 11 | Boom (3), 13.9 min | 2 by 3 @6.1, 1 by 3 @11.9, 4 by 3 @13.9 | 18 / 9 / 91 / 46 | 8 | Storehouse, 10.0 s |
| 13 | Turtle (4), 13.9 min | 3 by 2 @5.1, 1 by 2 @10.4, 2 by 4 @13.9 | 8 / 67 / 4 / 29 | 6 | Storehouse, 10.0 s |

Every match reached a last-standing result; auto-defend engaged in every
match (a camp showing 0 had no idle soldier in an owned zone when raided); the
move completed in exactly half the Storehouse's build time in every match.
No hopeless elimination fired. Touch play: `npm run test:mobile` (1v1 and
free-for-all) passes on the final code.
