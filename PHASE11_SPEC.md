# Phase 11 — Lockstep play, disconnects, reconnection, chat

Phase 10 gave every pair of players a proven WebRTC data channel. This phase
plays a real free-for-all over those channels: **deterministic lockstep**
(every browser runs the same simulation from the same commands at the same
ticks), **AI hold** of a camp whose player disconnects, **reconnection** from
a snapshot served by any connected player, and **chat**.

**The principle:** every browser's simulation must be byte-identical at every
tick. A desync is a broken feature, not a degraded one. Timing constants below
are tunable (in `src/net/net-rules.js`); determinism is not, and it is proven by
tests, including a permanent in-game desync check.

Out of scope: a TURN relay (players who cannot connect directly can neither
play nor reconnect; Phase 10's limitation), any change to sim, AI, balance,
territory or capture logic, spectating beyond Phase 6's, matchmaking,
persistent identity.

## Layering

```
src/net/menu.js, lobby.js, mesh.js, firebase.js   Phase 10: lobby, signaling, connections
src/net/play.js        starts or rejoins a match, the metronome, the game screen, the panel
src/net/links.js       the data channels under a match (reopened through Phase 10's signaling)
src/net/presence.js    Firebase presence: the arbiter against split brain
src/net/session.js     the protocol: turns, heartbeats, votes, snapshots, chat (no browser APIs)
src/net/lockstep.js    the tick engine: turns in, Match steps out (no network at all)
src/net/snapshot.js    whole-match serialization, restore, state hash
src/net/hold.js        the AI hold behaviour
src/net/detmath.js     deterministic Math functions for multiplayer
src/game/*             unchanged rendering, with a settable local player team
```

The lockstep engine and the protocol have no browser dependencies, so the
whole protocol (several peers, latency, drops, votes, takeover, snapshots,
rejoin) is tested in one Node process first (Part A's gate) and only then
wired to real data channels.

## Determinism

The sim is already deterministic in one engine (seeded RNG, fixed step, Phase 3
onwards). Across machines and browsers two things were audited:

- **Plain arithmetic** (`+ - * /`, comparisons, `Math.floor/abs/min/max/imul`,
  integer `**`) is exactly specified by IEEE 754 and ECMAScript: identical
  everywhere. Sorts are stable (ES2019); `Map`, `Set` and object key order are
  specified; JSON round-trips every double exactly.
- **`Math.hypot`, `Math.atan2`, `Math.cos`, `Math.sin`** (used by the sim) are
  "implementation-approximated" in ECMAScript: engines may differ in the last
  bit (V8 and SpiderMonkey use fdlibm ports; JavaScriptCore uses the platform
  library). **Fix:** for the duration of a multiplayer match, `detmath.js`
  replaces these four with pure-arithmetic implementations (fdlibm algorithms
  over `+ - * /` and `Math.sqrt`, which IEEE 754 requires to be correctly
  rounded and every engine computes in hardware). Every peer then evaluates
  exactly the same operations. Single-player keeps the native functions, so
  every existing fingerprint is untouched.
- Nothing in the sim or AI reads rendering state: `world.events` is only read
  by the renderer; the UI never writes game state except through commands.
- A permanent check: every 100 ticks each peer broadcasts a hash of its whole
  match state; any mismatch stops the match with "Desync detected" (and fails
  every test).

## The tick loop

- One **tick** = one `SIM_DT` step (0.05 s, 20 per second). Every peer starts
  from the same seed and lineup (Phase 10), so tick numbers agree by
  construction.
- To execute tick *T* a peer needs the **turn** for *T* from every human
  player currently in control of a camp. A turn is that player's commands
  scheduled for *T* (usually none).
- **Input delay: 4 ticks (200 ms).** A command issued while the peer is about
  to execute tick *T* is scheduled for *T + 4*. When a peer executes tick *T*
  it first sends its turn for *T + 4*. Rationale: one-way latency between
  players is typically 20–120 ms on broadband or 4G, plus up to one tick of
  quantisation and a little jitter; 200 ms covers that, so turns normally
  arrive before they are needed and play never waits. Anything slower makes
  the game pause for a moment, never desync. 100–250 ms is the usual range for
  lockstep RTS games, and 200 ms of command delay is below what players
  perceive as unresponsive for unit orders.
- Executing tick *T*, in this exact order on every peer: (1) system events for
  *T* (AI hold starts and ends), sorted by kind then camp; (2) human commands
  of *T*, by slot ascending, each as `world.issue(cmd)` with `team` forced to
  the sender's slot; (3) AI-hold brains; (4) `Match.step()` (the world, then
  the free-for-all AI camps, exactly as single-player).
- The UI sends commands through the same `world.issue()` call as before; in a
  multiplayer match that call is routed to the lockstep's outbox instead of the
  world (the Phase 4 command layer, unchanged).

## Messages

All JSON over the Phase 10 data channel (`dragonmarch`, reliable and ordered).
`s` is the sender's slot.

| `t` | Fields | Meaning |
|---|---|---|
| `turn` | `s`, `k` tick, `c` commands, `y` system commands | `s`'s commands for tick `k` |
| `hb` | `s`, `k` current tick | heartbeat, every 500 ms |
| `need` | `s`, `x` slot, `from`, `to` | "send me `x`'s turns for these ticks" |
| `vote` | `s`, `x` slot, `last` | "`x` is gone; the last turn of `x` I hold is `last`" |
| `hold` | `s`, `x` slot, `from` | the vote's outcome: `x` is held from tick `from` |
| `yield` | `s`, `x` slot | a returning player asks to be held first (see Rejoining) |
| `hash` | `s`, `k`, `h` | state hash after tick `k` |
| `snapreq` | `s` | "send me a snapshot" (a rejoining player) |
| `snap` | `s`, `id`, `i`, `n`, `d` | chunk `i` of `n` of a snapshot |
| `nosnap` | `s` | "not yet": the requester is not held yet; it asks again |
| `chat` | `s`, `id`, `text` | a chat line |

A command is the object the UI or AI passes to `world.issue`, e.g.
`{ type: 'move', ids: [12, 14], x: 812.5, y: 640 }`: numbers, strings and
arrays only, so it survives JSON exactly.

## Disconnects and AI hold

- **Heartbeat** every 500 ms on every channel (turns count too). A player is
  **quiet** from the moment nothing has arrived from them for 2 s (shown as
  "waiting for …" when the game needs their turn).
- **Grace period: 50 s** (`graceMs`). Reasoning: long enough for a phone
  switching networks, a train tunnel or a router restart to come back without
  consequences; short enough that the others are not left waiting a whole
  minute. It also sits just above the time Firebase takes to notice a dropped
  connection, which the takeover rule needs.
- **Takeover rule.** A peer votes that player X is gone only when all of these
  hold: nothing from X for the grace period; Firebase's presence record for X
  is gone (the Firebase server, not just this peer, has lost X); and this peer
  is itself connected to Firebase. The Firebase checks are the arbiter against
  **split brain**: without them, two players who lose each other would each
  continue with the other's camp held by AI and see different realities. The
  player whose own connection died can't reach Firebase, so it freezes and
  shows "Connection lost. Reconnecting…" instead of continuing alone.
- **Agreement.** Voters are the players still in control who are not
  themselves gone. When a peer holds votes about X from all of them, X is held
  from tick `C = max(last) + 1`. Every peer computes the same `C` from the same
  votes. Nobody can have executed tick `C` (it needs X's turn), so all agree.
  A peer missing some of X's turns up to `C - 1` fetches them (`need`) from a
  peer that has them.
- **Debounce:** a player who comes back before the grace period ends was never
  taken over: the game simply waited, and continues with their turns.
- **The hold behaviour** (a new mode, not Rush, Boom or Turtle): at tick `C`,
  every combat unit of the camp that is outside its home zone is ordered home
  (to the home zone's centre); combat units inside it that were attacking stop;
  every production building's rally point is set to the home zone's centre (so
  units finishing in the queue stay home). After that it gives **no orders at
  all**: queued production completes, Peasants keep doing what they were told,
  nothing new is trained or built, and Phase 9's auto-defend makes the idle
  garrison fight whatever enters the camp's zones. To the others it looks like
  a camp whose player stopped playing.
- **Handback (hysteresis):** the returning player must first be caught up
  (below), then have a **stable link for 5 s** (`handbackStableMs`: heartbeats
  with no gap over 1.5 s). Only then does the lowest-slot connected player put
  a `back` system command in its turn for tick *T*, returning the camp to its
  player from tick *T + 5* (one tick after the input delay, so every peer,
  the returning one included, has the decision before it takes effect). One
  heartbeat is never enough. "Caught up" means the returning player's own
  heartbeats show it at the live edge and holding the same view of who is
  held.
- Every takeover and handback is announced to everyone ("Rose is disconnected:
  the AI holds their camp" / "Rose is back in control").

## Snapshots and reconnection

- **Every 600 ticks (30 s of game time)** each peer serialises the whole match
  (world, AI brains, hold brains, lockstep state) with the tick number. It keeps
  the last two, plus every turn after the older one. Snapshots are the same on
  every peer, by determinism.
- **Format:** a graph serialisation of the live objects: plain data, `Map`,
  `Set`, typed arrays, class instances by name, shared references and exact
  numbers (`-0`, `NaN`, `undefined` kept). Static game data (unit tables, the
  map) is referenced by name, not copied. Two things are rebuilt rather than
  stored: the pathfinder's caches (rebuilt from the grid) and function
  closures. The two RNGs are replaced at match start by an identical generator
  (same algorithm and outputs) whose state can be stored.
- **Any peer serves.** A rejoining player asks every peer it reconnects to;
  the first to answer (any player currently in the match; the lobby host has
  no special role) sends its latest snapshot and the turns after it, in 16 KB
  chunks over the data channel. Firebase carries only the signaling to reopen
  the connection, as in Phase 10.
- **Rejoining:** the player reloads (or their tab reconnects); the same tab
  keeps its anonymous identity (session persistence) and is still a lobby
  member; it re-signals every other player through Phase 10's signal paths.
  **Clean cutover:** it first sends `yield` (asking to be held), because a
  reload inside the grace period would otherwise leave turns its old tab sent
  and turns its new tab will send competing for the same ticks. A snapshot is
  only served to a player already held (else `nosnap`, and it asks again), so
  the new tab's first turn is always after the hold. It then receives the
  snapshot, restores it, replays the turns after it (catching up at up to 60
  ticks per frame), compares its whole-state hash at the snapshot tick with
  the server's, and is live, then handed back as above.
- **No one to serve:** if no other player is connected, the screen shows
  "Waiting for another player to come back…" and keeps trying.
- The lobby must outlive a disconnect during a match, so at the start the host
  cancels Phase 10's "remove the lobby when I disconnect" (the lobby then
  expires by the rules' age limit). Signaling in a started lobby is allowed for
  3 hours from creation (was 1 hour), long enough for a waiting lobby plus a
  30-minute match.

## Chat

`{ t: 'chat', s, id, text }`: at most 200 characters, at most 5 lines per 5 s
per player; shown with the lobby display names; kept only in memory for the
match; never touches the simulation.

## Tests

- **Part A gate (Node, no network code):** 2–4 lockstep peers in one process,
  fed the same command streams (scripted players whose commands travel as JSON
  turns), byte-identical state at every tick, over the fixed-seed scenarios of
  Phases 3, 6 and 8, with random latency and reordering.
- **Protocol (Node, fake network):** heartbeats, a drop shorter than the grace
  period (no takeover), takeover after it, the hold behaviour, agreement on the
  takeover tick, snapshot restore equal to the live state, rejoin and handback
  with the 5 s hysteresis, the host as the one who leaves and rejoins, a match
  with a held camp resolving through the normal win conditions, chat.
- **Browsers (real WebRTC, emulator):** a full match in 2–4 browser contexts
  with identical final state; injected latency; a real disconnect, AI hold,
  reconnect with byte-identical state after catch-up, including the host; chat.
- **Cross-engine (CI):** Chromium, Firefox and WebKit peers in one match.

## Results

Phase 11 shipped in PRs #174–#179 and the docs PR that follows them. The
numbers below come from the test runs; each test prints its own line (`# ...`).

**Part A gate, Node, one process** (`test/lockstep-gate.test.js`). Scripted
players' commands travel as JSON turns with random latency and reordering, and
peers compare whole-state hashes every 250 ticks and per-tick quick hashes at
every tick:

- 1v1 (Phase 3 scenarios), seeds 1–3: rush vs boom (hard), turtle vs rush
  (normal), boom vs turtle (easy). 2 peers identical over 3,000 ticks each.
- Free-for-all (Phases 6 and 8), seeds 1–3 × lineups HHAA, HHHA, HHHH: 2, 3
  and 4 peers identical over 2,400 ticks each.
- Free-for-all seed 5, HHHH, to the end: 4 peers identical over 18,965 ticks
  (76 whole-state checks, 1,144 player commands), ending by last camp
  standing.
- Controls prove the gate isn't vacuous:
  - different seeds end in different states;
  - a peer built from another seed is caught;
  - one command lost on one peer is caught at the next tick.

**Protocol, Node, simulated network** (`test/session.test.js`, 13 tests):
- 3 players with latency are identical at every tick.
- A drop shorter than the grace period: the game waits, then continues, with
  no takeover.
- No takeover while Firebase still sees the player.
- The side that lost its connection freezes.
- Takeover after the grace period: every peer agrees on the tick, and the AI
  holds the camp.
- Rejoin: byte-identical at the catch-up tick, then handed back after a
  steady link.
- The host leaves and rejoins.
- A flapping link resets the handback clock (hysteresis).
- Nobody to serve a snapshot: "waiting", then a rejoin once someone is back.
- A camp held for good: the match still ends by last camp standing (at 392 s).
- Chat changes nothing in the game.
- A corrupted peer is caught as a desync.
- A reload within the grace period never mixes the old tab's turns with the
  new tab's.

The AI hold (`test/hold.test.js`): the army goes home, rallies point home,
queued work finishes, nothing is decided for 60 s, and the idle garrison
defends by itself.

**Real browsers over WebRTC** (Chromium contexts, Firebase emulator,
`npm run test:mp`):

| Test | Result |
|---|---|
| 2 players, whole match (8x speed) | last-standing at tick 8,054 (CI: 9,969); the same final hash on both |
| 4 players, whole match (8x speed) | last-standing at tick 16,768 (CI: 13,868, 63 shared checkpoints); the same final hash on all four |
| A command from the game screen | issued at tick 15, carried out at tick 20 on both pages |
| 40–150 ms per message, 1x speed | 20.0 ticks/s (full speed) for 60 s; 42 shared checkpoints identical |
| 150–400 ms per message, 1x speed | 11.7 ticks/s (the game waits for late turns) for 60 s; 30 checkpoints identical |
| A guest leaves (tab gone) | held 6.0 s later (5 s test grace); snapshot from slot 1; the same hash at the catch-up tick; back in control 4.3 s after returning; 32 checkpoints identical |
| The host leaves | held 6.0 s later; snapshot from slot 2; the same hash; back 4.3 s after returning; 22 checkpoints identical |
| A brief drop (peer connections closed, tab and Firebase up) | links reopened in about 4 s; no takeover; 42 checkpoints identical |
| Chat | 9 lines, seen by all three players under lobby names; a burst of 8 cut to 5; checkpoints identical; empty after a reload |

**Cross-engine** (CI job `cross-engine`, first run on PR #179):
- Chromium, Firefox and WebKit all compute deterministic-Math fingerprint
  `cc6ed4f6` (the golden value).
- A Chromium, a Firefox and a WebKit player, each in their own engine,
  play one match together: 42 shared hash checkpoints up to tick 3,062, all
  identical.
- The few native `Math` samples logged happened to agree too. That is not
  a guarantee (the specification allows them to differ), which is why the
  deterministic replacements stay.

**Regression:**
- `npm test` passes 331/331, including every single-player fingerprint
  unchanged.
- `npm run test:e2e` passes 61/61.
- The Phase 10 rules (10/10) and lobby/connection specs pass.
- The mobile touch playthrough (1v1 and free-for-all) passes.

**What is not covered:**
- Every browser test runs on one machine. Connections use host candidates,
  latency is injected, and real NAT is absent. There is no TURN relay, so a
  player who can't connect directly can neither play nor rejoin.
- Players on different real networks and physical phones have not been
  tested.
