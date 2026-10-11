# Platform Milestone 1 — the lockstep core, extracted and proven

Dragonmarch's multiplayer (Phases 10, 11 and 12b) works: browsers find each
other through Firebase, connect directly over WebRTC (with a Cloudflare TURN
relay when they cannot), and run the same deterministic simulation in
lockstep, with desync detection, AI hold on disconnect and snapshot
reconnection. All of it lives inside `src/net/`, written for one game.

This milestone turns that code into **a documented, game-agnostic module**,
rebuilds Dragonmarch on top of it with no change in behaviour, and proves the
module is reusable by building a second, unrelated game against its public
API only. It is Platform Milestone 1 of the DragonMarch Multiplayer Platform;
the rest of the platform is the roadmap in [PROJECT.md](PROJECT.md).

**Scope:** the networking plumbing only. Dragonmarch's sim, AI, balance,
territory, rendering and UI do not change. No new cloud infrastructure: the
same Firebase project (with its deployed rules, unchanged), the same TURN
Worker, the same Firebase emulator in CI. No new runtime dependency.

## Where things live

```
platform/lockstep/        the module (game-agnostic; imports nothing outside itself)
  index.js                the public API: everything a game may use
  core.js                 Lockstep: turns, input delay, control history, the tick order
  session.js              Session: the peer protocol (heartbeats, takeover votes,
                          desync checks, snapshots, rejoin, handback, app messages)
  timing.js               DEFAULT_TIMING, the protocol's tunable defaults
  codec.js                createCodec(): exact graph serialisation; hashText()
  rng.js                  SeededRng: a storable mulberry32
  detmath.js              deterministic sin/cos/atan2/hypot, installDetMath()
  detmath-golden.js       the cross-engine fingerprint
  testing.js              FakeNet: many Sessions in one process on a virtual network
  browser/                the browser transport (needs WebRTC, Firebase)
    firebase.js           connectFirebase(): SDK on demand, anonymous auth, emulator
    code.js               createCodes(): match codes and display names
    lobby.js              Lobby: create/join/watch/leave/start by match code
    presence.js           presence(): Firebase presence, the split-brain arbiter
    ice.js                IceServers: STUN, plus TURN minted by a credential endpoint
    mesh.js               Mesh: the first connection to every peer, verified
    links.js              Links: the match's data channels, reopened when they die
    match.js              startMatch()/rejoinMatch()/runMatch(): the browser loop
  README.md               the integration guide (for a developer new to all of this)
src/net/                  Dragonmarch's adapters (stay; see "What moves")
games/ringout/            the second game (uses platform/lockstep/index.js only)
```

`platform/` sits beside `src/` so the boundary is visible in the tree, and is
served from the same Pages site (pages.yml copies `platform/` and `games/`).

## Part A — the public API

Everything below is exported by `platform/lockstep/index.js`. Nothing in it
names a unit, camp, zone, team, map, AI or any other Dragonmarch concept.

### Vocabulary

- **Slot**: a player seat, an integer `1..N` (N ≤ 4 with the deployed
  backend). Every peer agrees on the slots before the match starts.
- **Tick**: one fixed simulation step (`timing.tickMs`, default 50 ms). Ticks
  are numbered from 0.
- **Command**: anything JSON-serialisable your game understands (`{ type:
  'steer', dir: 3 }`). Commands are what a player does; the game turns them
  into state changes.
- **Turn**: one slot's commands for one tick. A peer *commits* its turn for
  tick `T + delay` while at tick `T`, so every command runs `delay` ticks
  after it is given, on every peer at the same tick.
- **In control / held**: a slot is in control of its player, or held (its
  player is gone; the game decides what that means).

### The game contract (what the consuming game supplies)

```js
const game = {
  step(tick, inputs) {},  // advance exactly one tick. inputs: [{ slot, commands: [...] }]
                          // for every slot in control at `tick`, in slot order.
  hash() {},              // a string digest of the whole state (desync detection)
  serialize() {},         // the whole state as JSON-able data (snapshots)
  isOver() {},            // optional: true once the match has a result
  validate(command) {},   // optional: a string reason to refuse a local command
  hold(slot, tick) {},    // optional: `slot`'s player is gone from this tick
  release(slot, tick) {}, // optional: `slot`'s player is back in control
};
const restoreGame = (data) => game; // the inverse of serialize(), for rejoining
```

The engine guarantees: `step` is called with the same inputs at the same tick
on every peer; `hold`/`release` are called on every peer at the same tick,
before that tick's `step`; `hash` is compared across peers every
`timing.hashEvery` ticks. The game guarantees determinism: the same calls give
the same state, bit for bit, on every peer and engine (`installDetMath()` and
`SeededRng` help).

### Lockstep (one peer's engine, no networking)

```js
const ls = new Lockstep({ game, players: [1, 2, 3], me: 2, delay: 4 });
ls.submit(command)      // a local command -> { ok, pending } or { ok: false, reason }
ls.commit()             // this peer's turns up to tick + delay, to broadcast
ls.accept(turn)         // a turn from anyone; false if not needed or duplicate
ls.step()               // run one tick if every needed turn is here; false otherwise
ls.tick, ls.done, ls.game, ls.players, ls.me, ls.delay
ls.inControl(slot, k)   // in control at tick k (not held)?
ls.held(k), ls.missing(k), ls.ready()
ls.hold(slot, fromTick) // the agreed decision that a slot is held (Session calls this)
ls.snapshot()           // { tick, state }: game.serialize() plus the engine's state
ls.stateHash()          // game.hash() plus the engine's agreed state at this tick
Lockstep.restore(snapshot, { restoreGame, players, me, delay })
ls.onTick = (tick) => {}
```

### Session (the peer protocol over any transport)

```js
const session = new Session({
  lockstep,                     // null when rejoining (it comes from a snapshot)
  restore: (snap) => Lockstep.restore(snap, { restoreGame, players, me, delay }),
  me, players, names,           // names: { slot: display name } (status, optional)
  transport: { send(slot, msg) -> bool, connected(slot) -> bool, now() -> ms },
  arbiter: { online() -> bool, present(slot) -> bool },
  timing,                       // DEFAULT_TIMING or your overrides
});
session.pump()                  // call every frame: heartbeats, turns, votes, handback
session.receive(slot, msg)      // every message from the transport
session.linkUp(slot)            // the transport reports a link (re)opened
session.stepBudget(realtimeTicks) // how many ticks to run this frame (catch-up aware)
session.send(slot, msg), session.broadcast(msg) // app messages (e.g. chat)
session.status()                // { mode, tick, waiting: [{ s, name, silentMs }], held, desync }
session.mode                    // 'play' | 'rejoining' | 'waiting' | 'held-out'
session.lockstep, session.desync, session.caughtUpAt
// events: assign a function, or override emit(name, ...args) in a subclass
session.onHeld = (slot, fromTick) => {}
session.onReturned = (slot, tick) => {}
session.onDesync = ({ tick, with, mine, theirs }) => {}
session.onRejoined = ({ tick, hash, serverHash, server, match }) => {}
session.onHeldOut = () => {}    // this peer was held while it still ran: start again
session.onMessage = (slot, msg) => {} // any message type the protocol does not use
```

**Disconnects, generic over "hold":** a slot silent for `timing.graceMs`, whose
presence the arbiter says is gone (while this peer is itself online), is voted
held; the leader (lowest slot in control) collects every remaining peer's
last turn of it and broadcasts the decision tick; every peer calls
`game.hold(slot, tick)` at that tick. Dragonmarch's hold is an AI that
garrisons the camp; Ringout's is an anchored puck. The engine does not care.

**Reconnection:** a returning peer asks to be held (if it is not already),
then asks connected peers in turn for a snapshot; it restores it through
`restore`, replays the turns since, compares the whole-state hash at the
server's tick, and plays on held until the leader hands the slot back after
`timing.handbackStableMs` of steady link; then `game.release(slot, tick)`.

**Reserved message types** (the `t` field): `hb turn need vote yield hold hash
snapreq snap nosnap`. Everything else reaches `onMessage`.

### Determinism helpers

- `installDetMath()` replaces `Math.sin/cos/atan2/hypot` with bit-exact
  fdlibm ports for the duration of a match; returns the uninstaller.
  `detMathFingerprint()` and `DETMATH_GOLDEN` check an engine.
- `SeededRng(seed)`: mulberry32 with its state in a field (`.s`), so it
  serialises and restores exactly; `next()`, `range(a, b)`, `int(a, b)`.
- `createCodec({ classes, skip, fixups, constants })`: exact serialisation of
  object graphs (Map, Set, typed arrays, class instances, shared references,
  cycles, -0/NaN/Infinity/undefined), with named constant data written by
  reference; `codec.encode/decode/serialize/deserialize/hash`.
- `hashText(string)`: 64-bit FNV-1a as 16 hex digits.

### Browser transport

```js
const fb = await connectFirebase({ config, sdk, appName, emulator });
const codes = createCodes({ alphabet, length, nameMax });
const lobby = new Lobby(fb, { slots: 4, minPlayers: 2, ttlMs, codes });
await lobby.create(name, settings)  // settings: extra fields of the lobby record
await lobby.join(code, name); lobby.onChange(fn); await lobby.start(); await lobby.leave();
lobby.meta = { host, created, status, seed, lineup, ...settings }; lobby.slots; lobby.players()
const ice = new IceServers({ stun, turn: { endpoint, timeoutMs, retryMs, refreshMarginMs } });
const mesh = new Mesh(lobby, onUpdate, { channel, app, timeoutMs, helloRetryMs, iceServers: () => ice.iceServers() });
mesh.start(); mesh.peers // uid -> { slot, name, state: waiting|connecting|open|verified|failed, rtt, ... }
const run = await startMatch({ lobby, mesh, buildGame, restoreGame, timing, store, ice, SessionClass });
const run = await rejoinMatch({ fb, saved, restoreGame, timing, store, ice, SessionClass });
run.session, run.links, run.presence, run.stop()
run.onFrame = (session) => {}       // after every metronome beat (draw, status)
matchStore(key) -> { load(), save(m), forget() } // sessionStorage, for rejoin after reload
```

`lineup` is the seat map written at the start: one letter per slot, `H` for a
player, `A` for an open seat (the deployed rules' alphabet: Dragonmarch gives
open seats to its AI; Ringout leaves them empty). `playersOf(lineup)` gives
the player slots.

## Part B — what moves and what stays

| File (Phase 10–12b) | Goes to | What stays in Dragonmarch |
|---|---|---|
| `src/net/lockstep.js` (Lockstep) | `platform/lockstep/core.js` | `src/net/lockstep.js`: `DragonmarchGame` (the game contract over `Match`: commands as `world.issue` with the sender's team, the HoldBrain as `hold`, `PLAYER_COMMANDS` as `validate`), `lobbyMatch`, `humansOf`, and `Lockstep` (a subclass keeping the Phase 11 constructor `{ match, humans, ... }` and names `world`, `match`, `isHuman`, `local`). |
| `src/net/session.js` (Session) | `platform/lockstep/session.js` | `src/net/session.js`: a `Session` subclass: the player-facing notices ("… is disconnected: the AI holds their camp."), chat (rate limit, log) as app messages, and the Phase 11 names (`ls`, `humans`, `net`, `t`). |
| `src/net/net-rules.js` (timings) | `platform/lockstep/timing.js` (protocol defaults) | `src/net/net-rules.js`: Dragonmarch's values (unchanged), the chat limits, the test override global. |
| `src/net/snapshot.js` (graph codec, hash, SerialRng) | `platform/lockstep/codec.js`, `rng.js` | `src/net/snapshot.js`: Dragonmarch's codec instance (its classes, data modules, caches to skip and rebuild), `adoptRng(s)` (Dragonmarch's closure RNG), `quickHash(world)`. Same exports. |
| `src/net/detmath.js`, `detmath-golden.js` | `platform/lockstep/` | Re-exports (tests and pages import them by the old paths). |
| `src/net/mesh.js`, `links.js` | `platform/lockstep/browser/` | Re-exports bound to Dragonmarch's channel label and ICE servers. |
| `src/net/ice.js` | `platform/lockstep/browser/ice.js` (IceServers) | `src/net/ice.js`: one IceServers over Dragonmarch's config; `iceServers`, `ready`, `_reset` as before. |
| `src/net/firebase.js` | `platform/lockstep/browser/firebase.js` | `src/net/firebase.js`: `connect()` with Dragonmarch's config and emulator global. |
| `src/net/lobby.js` | `platform/lockstep/browser/lobby.js` | `src/net/lobby.js`: `Lobby` subclass, `create(name, difficulty)`. |
| `src/net/presence.js`, `code.js`, `lineup.js` (lineup part) | `platform/lockstep/browser/` | `src/net/code.js` binds the codes to `LOBBY`; `src/net/lineup.js` keeps `campsFor` (AI fill-in). |
| `src/net/play.js` (start, rejoin, metronome, pacing) | `platform/lockstep/browser/match.js` | `src/net/play.js`: the game screen, chat panel, status panel, notices. |
| `src/net/config.js`, `hold.js`, `menu.js`, `lobby.css` | — | Unchanged in substance: Dragonmarch's config, AI hold and screens. |

Every old import path keeps working (the tests import them), so every
existing test runs unchanged. Wire messages are unchanged, so a Phase 12b
browser and a Milestone 1 browser even speak the same protocol.

**Zero regression is shown by the existing suites, unchanged:** the 356 unit
tests (the fingerprints, the lockstep gate, the session tests on the fake
network, snapshots, the freeze guard, fairness), the browser e2e and mobile
playthrough, the rules tests, the multiplayer, cross-engine and relay
suites.

## Part C — the second game: Ringout

**What it is.** A 2–4 player arena brawler: each player steers a puck around
a circular ring that slowly shrinks; pucks collide elastically; a puck whose
centre leaves the ring is out for the round. Last puck on the ring scores;
first to 3 wins the match. Controls: arrow keys/WASD to thrust, Space to
dash (a short impulse with a cooldown); on a phone, drag to steer and tap to
dash. Pace (easy/normal/hard) sets how fast the ring shrinks.

**Why this game.** It is as unlike an RTS as a small game can be, in exactly
the ways that test the module:

- **Continuous physics in floating point**, with `cos`, `sin` and `hypot` at
  every tick, where Dragonmarch's state is mostly tile-based. One last-bit
  difference between engines would show within seconds: a hard test of the
  determinism helpers across Chromium, Firefox and WebKit.
- **Twitch input**: a player changes direction many times a second, so input
  delay and turn delivery are felt directly, unlike RTS orders.
- **A different meaning of "hold"**: no AI. A disconnected player's puck is
  *anchored* (it brakes and stays put, still pushable) until they return.
- **Tiny state, no classes**: a plain object serialised by `createCodec()`
  with no registrations, where Dragonmarch needs class registries, static
  data by reference and cache rebuilding.
- **Rounds that reset**: the state is torn down and rebuilt mid-match,
  which a snapshot taken across a round boundary must survive.

A turn-based game was the other candidate. It would exercise less: lockstep
with one command every few seconds hides delivery and determinism problems
that continuous physics exposes at once.

**Rules (all integers or exact floats, all in `games/ringout/sim.js`):** ring
radius 300 shrinking to 90 (easy 0.25, normal 0.5, hard 1.0 units a tick,
after a 3 s grace); pucks radius 18, start on a circle of radius 180 at their
slot's compass point; thrust 1100 u/s² in one of 16 directions, drag 0.92
per tick, top speed 260 u/s; dash +360 u/s, 30-tick cooldown; collisions in
slot order, restitution 0.9; a round ends with at most one puck left (or
after 90 s: no point) and the next starts after 1.5 s; first to 3 points
wins, or the most points after 9 rounds.

**Boundary.** Ringout imports only `platform/lockstep/index.js` and its own
files; a test enforces this. It shares the platform's hosted backend (the
Firebase project and the TURN Worker) through its own public config file.

**Found by building it (fixed in the module, not the game):** recorded in
the verification record below as they come up.

## The deployed backend's shape (a constraint, logged)

The Realtime Database rules deployed for Dragonmarch (`database.rules.json`)
are part of the hosted backend, not of the module. They require a lobby
record to carry `difficulty` (`easy`/`normal`/`hard`) and a 4-seat `lineup`
of `H`/`A`. The module's API is generic (`settings` are any fields, `slots`
any count), but this milestone deploys no rules (no infrastructure change),
so Ringout writes its pace as `difficulty` and plays 2–4 players. Generalising
the rules (a game id, free-form settings, more seats) is the first item of
the roadmap; it needs one `firebase deploy --only database` by the project
owner.

## Verification

a) **Regression.** Every existing test-m8 test passes unchanged, Dragonmarch
running on the module: `npm test`, `test:e2e`, `test:mobile`,
`test:fairness`, `test:rules`, `test:mp`, `test:engines`, `test:relay`.

b) **Module tests** (`platform/lockstep/test/`), no Dragonmarch fixture: a
mock game (a seeded counter) on `FakeNet`: lockstep identity under latency
and reordering, input delay, validation, desync detection, hold and release
at an agreed tick, rejoin from a snapshot with a hash match, handback after a
steady link, app messages; codec round trips; the detmath fingerprint.

c) **Second-game proof.** Ringout headless (`games/ringout/test/`): peers on
`FakeNet` identical at every tick through whole matches, snapshot restore
identical to the end, a disconnect and rejoin. In real browsers against the
emulator (`e2e/mp-ringout.spec.js`): a 3-player match played to its result
with identical hashes, a reload and rejoin; across Chromium, Firefox and
WebKit (`e2e/mp-engines-ringout.spec.js`); and relay-forced through the real
TURN relay (`e2e/mp-relay-ringout.spec.js`).

d) **API review.** A test (`platform/lockstep/test/boundary.test.js`) checks
that the module imports nothing outside itself, that its code names no
Dragonmarch concept, and that Ringout imports only the public index. Plus a
read-through, recorded below.

## Verification record

(Filled in as the slices land.)
