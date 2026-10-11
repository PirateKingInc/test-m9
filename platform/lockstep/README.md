# DragonMarch Lockstep — integration guide

Add real-time multiplayer to a deterministic browser game without running a
game server. Every player's browser runs the whole game; the module makes
sure every browser runs it from the same inputs at the same moments, and
handles finding the other players, connecting to them (directly, or through
a relay when a network forbids that), noticing when one drops, and bringing
them back.

This guide assumes you know JavaScript and nothing about this module or the
games built on it. A complete small game that uses everything below is in
[`games/ringout/`](../../games/ringout/) (about 600 lines including its
screens).

- [How lockstep works](#how-lockstep-works-in-two-minutes)
- [Is lockstep right for my game?](#is-lockstep-right-for-my-game)
- [Step 1: write your game as a deterministic state machine](#step-1-the-game-contract)
- [Step 2: test it headless](#step-2-test-multiplayer-headless-with-fakenet)
- [Step 3: lobby and connections](#step-3-lobby-and-connections-in-the-browser)
- [Step 4: run the match](#step-4-run-the-match)
- [Disconnects and reconnection](#disconnects-and-reconnection)
- [Determinism checklist](#determinism-checklist)
- [Backend](#the-backend-firebase-and-a-turn-relay)
- [API reference](#api-reference)
- [Limits](#limits)

## How lockstep works, in two minutes

- The game advances in fixed **ticks** (20 a second by default).
- Players are **slots** `1..N`, fixed when the match starts.
- A player's input is a **command**: any JSON value your game understands,
  such as `{ type: 'steer', dir: 3 }`.
- Each slot sends a **turn** for every tick: its commands for that tick, often
  none. A turn for tick `T + delay` is sent at tick `T`, so a command runs
  `delay` ticks (200 ms by default) after it is given, on every browser at
  the same tick. That delay hides network latency.
- Tick `T` runs only when every slot's turn for `T` has arrived. Nobody
  guesses. A late player makes everyone wait ("Waiting for Bram…").
- Because every browser runs the same deterministic code on the same
  inputs, every browser has the same state. The module checks this by
  comparing a hash of the state every few seconds, and stops the match if
  they ever differ (a **desync**). That always means a determinism bug in
  the game.

Network traffic is tiny (the inputs, not the state), so the number of
objects in the game doesn't matter. The cost is that every browser must
simulate everything, and the game must be exactly deterministic.

## Is lockstep right for my game?

Good fit: games with lots of state and few inputs, where everyone sees
everything. Strategy games, physics toys, arena games, co-op puzzles. 2–4
players with the deployed backend.

Poor fit: games with hidden information that must stay secret (every
browser holds the whole state), games needing more than about 8 players, or
games that can't tolerate a short input delay. See the platform roadmap in
[PROJECT.md](../../PROJECT.md) for relay messaging and authoritative
servers.

## Step 1: the game contract

Your game is an object the module drives. Nothing else about it is the
module's business.

```js
class MyGame {
  constructor(seed, slots) { /* build the start state from the seed and the slots */ }

  // Advance exactly one tick. inputs: [{ slot, commands: [...] }] for each slot
  // that is in control at this tick, in slot order. Same calls -> same state.
  step(tick, inputs) {}

  hash() {}             // a string digest of the whole state
  serialize() {}        // the whole state as JSON-able data
  static restore(data) {} // the inverse of serialize()

  // Optional:
  isOver() {}           // true once the match has a result: no more ticks
  validate(command) {}  // a string reason to refuse a local command, else undefined
  hold(slot, tick) {}   // slot's player is gone: you decide what that means
  release(slot, tick) {} // slot's player is back
}
```

`hold` is where your game decides what a missing player means. Dragonmarch
gives the camp to a defensive AI. Ringout anchors the player's puck in
place. A card game might auto-pass. Every browser calls it at the same tick.

The module ships what most games need to meet the contract:

```js
import { createCodec, hashText, SeededRng } from '../../platform/lockstep/index.js';

const codec = createCodec({ classes: { MyGame, SeededRng } }); // classes to rebuild
class MyGame {
  constructor(seed) { this.rng = new SeededRng(seed); /* ... */ }
  serialize() { return codec.encode(this); }
  hash() { return hashText(JSON.stringify(this.serialize())); }
  static restore(data) { return codec.decode(data); }
}
```

`createCodec` handles plain data, `Map`, `Set`, typed arrays, class
instances, shared references, cycles and exact numbers (`-0`, `NaN`,
`Infinity`, `undefined`). For large games it can also write constant
tables by name instead of copying them (`constants`), and skip and rebuild
caches (`skip`, `fixups`).

## Step 2: test multiplayer headless with FakeNet

Before touching a browser, run several peers in one process on a virtual
network. This finds determinism bugs in seconds:

```js
import { FakeNet, DEFAULT_TIMING, installDetMath } from '../../platform/lockstep/index.js';

const off = installDetMath();
const net = new FakeNet({
  players: [1, 2, 3],
  newGame: () => new MyGame(42, [1, 2, 3]),
  restoreGame: MyGame.restore,
  timing: { ...DEFAULT_TIMING, graceMs: 4000 },
  latency: [20, 150],                                  // ms, random per message
  onTick: (peer, ls) => { if (Math.random() < 0.1) ls.submit({ type: 'jump' }); }, // a scripted player per peer
});
net.run(60_000);                                       // one minute of virtual time
console.log(net.compare());                            // { ok: true, compared: 1197, ... }

net.close(2); net.run(10_000);                         // player 2's tab closes: held after the grace period
net.reopen(2); net.run(10_000);                        // it comes back: snapshot, catch-up, handback
console.log(net.s(2).caughtUpAt, net.events(1, 'returned'));
off();
```

(Use a seeded RNG for scripted players in real tests, as
`platform/lockstep/test/session.test.js` does, so a failure reproduces.)

## Step 3: lobby and connections in the browser

```js
import { connectFirebase, createCodes, Lobby, IceServers, Mesh } from '../../platform/lockstep/index.js';

const fb = await connectFirebase({ config: FIREBASE_CONFIG, sdk: 'https://www.gstatic.com/firebasejs/12.19.0', appName: 'mygame' });
const codes = createCodes();                       // 6-letter match codes, no look-alike letters
const lobby = new Lobby(fb, { slots: 4, minPlayers: 2, codes });

await lobby.create('Ava', { difficulty: 'normal' }); // host: lobby.code -> share codes.formatCode(lobby.code)
// or: await lobby.join(codes.parseCode(typed).code, 'Bram');
lobby.onChange(() => render(lobby.players(), lobby.meta)); // live list; lobby.closed if it went away
await lobby.start();                               // host only: writes the seed and the seat lineup

// Every player, once lobby.meta.status === 'started':
const ice = new IceServers({ stun: STUN, turn: { endpoint: TURN_URL, timeoutMs: 4000, retryMs: 60000, refreshMarginMs: 3600000 } });
await ice.ready();                                 // a relay credential, if the endpoint answers in time
const mesh = new Mesh(lobby, onUpdate, { channel: 'mygame', app: 'mygame', iceServers: () => ice.iceServers() });
mesh.start();                                      // mesh.peers: uid -> { name, state, rtt, error }
```

Every pair of players connects directly over WebRTC when it can, and
through the TURN relay when it can't (a phone on carrier-grade NAT, strict
corporate Wi-Fi). Each connection is proven with a test message. `state`
goes `waiting → connecting → open → verified`, or `failed`.

The lobby record's fields beyond the module's own are your `settings`, and
the backend's security rules decide what they may be. With the
currently deployed rules a lobby must carry `difficulty: easy|normal|hard`
and has at most 4 seats (see [Limits](#limits)).

## Step 4: run the match

When every peer is `verified`:

```js
import { startMatch, rejoinMatch, matchStore, Lockstep, playersOf } from '../../platform/lockstep/index.js';

const store = matchStore('mygame-match');          // sessionStorage: survives a reload of this tab
const common = {
  ice, channel: 'mygame', store, timing: DEFAULT_TIMING,
  restore: (snap, { me, players }) => Lockstep.restore(snap, { restoreGame: MyGame.restore, players, me }),
};
const run = await startMatch({
  lobby, mesh, ...common,
  buildLockstep: ({ meta, me, players }) => new Lockstep({ game: new MyGame(meta.seed, players), players, me }),
});
// run === null: a connection dropped in the last moment. Show a message, let them retry.

run.session.lockstep.game                          // your game: draw it every animation frame
run.session.lockstep.submit({ type: 'jump' })      // a local command -> { ok, pending } or { ok: false, reason }
run.onFrame = (session) => showStatus(session.status()); // { mode, tick, waiting: [{ s, name, silentMs }], held, desync }
run.canStep = () => screenReady;                   // optional: hold the ticks until your screen is up
```

`startMatch` builds your game after installing deterministic Math, then
drives everything from a metronome in a Web Worker, so time keeps moving in
a background tab (everyone waits for a player whose tab stops). It also
catches up a peer that fell behind, faster than real time.

After a reload, the same tab rejoins its match:

```js
const saved = store.load();
if (saved) { const run = await rejoinMatch({ fb, saved, ...common }); /* null: the match is over */ }
```

Events you will want, as assignments on `run.session`:

```js
session.onHeld = (slot, fromTick) => toast(`${name(slot)} disconnected`);
session.onReturned = (slot) => toast(`${name(slot)} is back`);
session.onDesync = (info) => fatal('The games no longer match.');  // a determinism bug: report it
session.onHeldOut = () => location.reload();       // this tab was held while it ran on alone: rejoin
session.onRejoined = (info) => showGame();         // a rejoining tab is caught up and playing
session.onMessage = (slot, msg) => {};             // your own messages: session.broadcast({ t: 'emote', ... })
```

Your own messages (chat, emotes, pings) travel on the same connections with
`session.send(slot, msg)` and `session.broadcast(msg)`. They never touch
the game state. The protocol reserves the `t` values in
`PROTOCOL_MESSAGES`.

## Disconnects and reconnection

- **A short drop** (under `timing.graceMs`, 50 s by default): the game
  waits, then carries on. Nothing is lost.
- **A longer one:** if the player's Firebase presence is also gone (so it
  isn't just the direct link that broke), the remaining players vote. The
  lowest slot still in control collects everyone's last received turn, picks
  the tick after it, and every browser calls `game.hold(slot, tick)` at that
  same tick. A player who lost their own connection never takes anyone over:
  without Firebase they can't confirm, so they freeze instead of
  splitting off.
- **Coming back** (the same tab, reloaded, or the connection restored): the
  player asks to be held (if not already) and asks a connected player for a
  snapshot. They restore it with your `restore`, replay the turns since, and
  compare the whole-state hash with the serving player's. After
  `timing.handbackStableMs` of steady connection, everyone calls
  `game.release(slot, tick)` at the same tick and the player is back in
  control.

## Determinism checklist

The same inputs must give the same state, bit for bit, on every browser
engine and machine.

- **Math:** `Math.sin`, `cos`, `tan`, `atan2`, `hypot`, `exp`, `log`, `pow`
  may differ in the last bit between engines. The module swaps in exact
  ports of `sin`, `cos`, `atan`, `atan2` and `hypot` during a match
  (`installDetMath()`, done for you by `startMatch`). Avoid the others in
  game logic, or use integers. `+ - * /` and `Math.sqrt` are exact
  everywhere.
- **Randomness:** never `Math.random()` in game logic. Use `SeededRng`
  seeded from `meta.seed`, and keep it in your state so it is snapshotted.
- **Time:** never `Date.now()` or `performance.now()` in game logic. Time is
  the tick number.
- **Order:** iterate in a defined order (arrays, or sort keys). `Map` and
  `Set` keep insertion order, so they are fine if inserted alike. Process
  slots in slot order.
- **Inputs only through commands:** the UI reads the game but changes it
  only by `submit()`.
- **Test across engines:** run `detMathFingerprint()` in each engine (it
  must equal `DETMATH_GOLDEN`), and play one match with a Chromium, a
  Firefox and a WebKit player. See `e2e/mp-engines-ringout.spec.js`.

## The backend: Firebase and a TURN relay

The module needs a **Firebase Realtime Database** (lobbies, presence and
the one-time WebRTC handshake, never game traffic) with anonymous sign-in,
and optionally a **TURN credential endpoint**: an HTTPS `POST` returning
`{ iceServers, ttl }`. The DragonMarch platform hosts both (Firebase project
`dragonmarch-7e5b8`, and the Cloudflare Worker in `worker/`), and games on
the platform use them through their own public config file (see
`games/ringout/config.js`). The security rules are in
`database.rules.json`. Test against the Firebase Local Emulator Suite:
`connectFirebase({ ..., emulator: { auth, db, projectId, ns } })`.

## API reference

Everything below is exported by `platform/lockstep/index.js`.

| Export | What it is |
|---|---|
| `Lockstep` | One peer's engine: `new Lockstep({ game, players, me, delay })`; `submit`, `commit`, `accept`, `step`, `inControl`, `held`, `missing`, `snapshot`, `stateHash`, `Lockstep.restore(snap, { restoreGame, players, me, delay })`; `tick`, `done`, `game`, `onTick`. |
| `Session` | The peer protocol over any transport: `new Session({ lockstep, restore, me, players, names, transport, arbiter, timing })`; `pump`, `receive`, `linkUp`, `stepBudget`, `send`, `broadcast`, `status`; events `onHeld`, `onReturned`, `onDesync`, `onRestored`, `onRejoined`, `onHeldOut`, `onMessage` (or override `emit`). |
| `DEFAULT_TIMING` | `tickMs`, `inputDelay`, `heartbeatMs`, `graceMs`, `handbackStableMs`, `handbackMaxGapMs`, `snapshotEvery`, `hashEvery`, `needAfterMs`, `chunkChars`, `speed`. |
| `PROTOCOL_MESSAGES` | The message types the protocol uses. |
| `FakeNet` | Many Sessions in one process on a virtual network: `run`, `close`, `reopen`, `cutLinks`, `online`, `presence`, `compare`, `s(slot)`, `events(slot, name)`. |
| `createCodec`, `hashText` | Exact state serialisation; 64-bit FNV-1a. |
| `SeededRng` | `next()`, `range(a, b)`, `int(a, b)`; state in `.s`. |
| `installDetMath`, `sin`, `cos`, `atan`, `atan2`, `hypot`, `detMathFingerprint`, `DETMATH_GOLDEN` | Deterministic Math. |
| `connectFirebase`, `isDenied` | The signaling backend. |
| `createCodes` | `newCode`, `formatCode`, `parseCode`, `parseName`. |
| `Lobby`, `LobbyError`, `lineupOf`, `playersIn`, `playersOf` | Lobbies by match code. |
| `presence` | Firebase presence (the Session's arbiter). |
| `IceServers` | STUN plus TURN from a credential endpoint. |
| `Mesh` | The first verified connection to every player. |
| `Links` | The match's connections, reopened when they die. |
| `startMatch`, `rejoinMatch`, `runMatch`, `matchStore`, `metronome` | Running a match in the browser. |

## Limits

- **2–4 players** with the deployed backend rules (the module itself takes
  any count. The WebRTC mesh needs N(N−1)/2 connections, so stay under
  about 8).
- **Lobby settings** must fit the deployed rules: a `difficulty` of
  `easy`/`normal`/`hard`, nothing else. Generalising the rules is the first
  item of the platform roadmap.
- **Signaling lives 3 hours.** A lobby record expires after 1 hour unstarted,
  and reconnection signaling stops after 3. A match longer than that can't be
  rejoined.
- **Everyone sees everything**, so lockstep is not for hidden-information
  games.
- **No late joiners**: the players are fixed at the start (a rejoin is the
  same player returning).
