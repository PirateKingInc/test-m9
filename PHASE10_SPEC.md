# Phase 10 — Multiplayer foundation

The end goal is real multiplayer free-for-all: a lobby with a shareable match
code, live peer-to-peer play, and reconnection with an AI holding a
disconnected player's camp. That is split in two. **This phase builds only the
foundation: finding each other and opening a connection.** It sends no game
state, runs no lockstep commands, has no chat and does not handle a player
dropping out of a running match. Those are Phase 11's.

Out of scope here: lockstep or any real game state on the wire, AI takeover
on disconnect, mid-match reconnection or catch-up, chat, 1v1 multiplayer, a
TURN relay, persistent accounts, and any change to sim, AI or balance code.

## The exception: Firebase

Recorded in PROJECT.md "Logged exceptions". Firebase Realtime Database (free
Spark plan) plus Firebase anonymous authentication, loaded as Google's
standard modular web SDK from `https://www.gstatic.com/firebasejs/12.19.0/`
(the same pinned version is a dev dependency, so tests serve it offline, the
way they already serve Phaser). It is loaded **only when a player opens
Multiplayer**; single-player never touches it.

It carries exactly two things: **lobby records** keyed by match code, and the
**one-time WebRTC handshake** (an offer, an answer and ICE candidates per pair
of players). Nothing else, and nothing after the connections are open.

The web config (`src/net/config.js`) is **not a secret**: it names the
project, and Firebase's documentation says so explicitly. The security
boundary is the server-side rules (`database.rules.json`), below.

**Why anonymous auth.** The rules must know who is writing to enforce "a
client writes only to a lobby it created or joined". Firebase anonymous sign-in
gives each browser tab a random user id with no account, no e-mail and no
data: the rules key every write to `auth.uid`. Persistence is in memory only,
so the id dies with the tab: nothing survives the lobby or match, and two tabs
of the same browser are two different players.

## Match codes

- **6 characters** from a 32-letter alphabet: `A–Z` without `I` and `O`, and
  `2–9` (no `0`, `1`): `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. So `0/O` and `1/I`
  can never be confused, and every code is easy to read out loud.
- 32⁶ ≈ 1.07 billion codes; drawn with `crypto.getRandomValues`. A code is the
  only key to its lobby (lobbies cannot be listed), so guessing a live one at
  random is impractical.
- Shown as `ABC-DEF` for reading. Typing is forgiving: lower case is
  upper-cased and spaces and dashes are ignored. A code containing a letter
  outside the alphabet (such as `0`, `O`, `1` or `I`) is rejected in the join
  box with a message, before anything is sent.
- Creating a lobby retries with a fresh code if the drawn one is taken (the
  rules refuse to overwrite an existing lobby).

## Data model

```
/lobbies/<CODE>/
  meta:                     readable by any signed-in client holding the code
    host:    <uid>          the creator; immutable
    created: <server ms>    set to the server clock; immutable
    status:  "open" | "started"
    seed:    1..999999      written once, at start
    lineup:  "H?.."         written once, at start: camp n is Human or AI, e.g. "HHAA"
  slots/<1..4>:             readable by any signed-in client holding the code
    uid:    <uid>           the player in that slot; slot n plays camp n
    name:   1..16 chars     display name, session-only
    joined: <server ms>
  members/<uid>: "<slot>"   write-only index: which slot a user holds
  signal/<toUid>/<fromUid>/ the one-time handshake, readable only by <toUid>
    desc: { type: "offer" | "answer", sdp: ≤ 10,000 chars }
    ice/<pushId>: { c: candidate ≤ 1,000 chars, m: sdpMid ≤ 32 chars, i: 0..31 }
```

**Slots, not a player list.** The rules language cannot count children, so
capacity is enforced structurally: there are exactly four slots, `1`–`4`, one
per free-for-all camp. Slot 1 is the host's. A joiner claims the lowest free
slot; a fifth player finds none (and the rules refuse slot `5`). **Slot n plays
camp n** (1 NW, 2 NE, 3 SE, 4 SW, as in single-player).

## AI fill-in

At start, every empty slot n becomes an AI camp playing `FFA_STRATEGIES[n]`
(2 Rush, 3 Boom, 4 Turtle) at the difficulty chosen in the menu, which is
exactly how single-player free-for-all fills camps 2–4 today. The lineup is
turned into the same `ffa.camps` table that `Match` already takes, with no
change to `Match`, the AI or the data: `src/net/lineup.js`. There is no
separate "empty slot" concept. Slot 1 is always human (the host). The same
difficulty applies to every AI camp.

**Minimum 2 humans to start**, as asked: one human is single-player, which
the menu already offers.

## Security rules

`database.rules.json`, in full in the repository. What they enforce:

- **Default deny.** The root and everything not listed below: no read, no
  write. Unknown fields anywhere in a lobby are rejected (`$other: false`).
  `/lobbies` itself cannot be read, so lobbies cannot be listed or searched;
  holding the code is the invitation.
- **Signed in.** Every rule requires `auth != null` (anonymous is fine).
- **Create.** `meta` may be created only if no lobby has that code, with
  `host == auth.uid`, `created == now` (server time) and `status == "open"`,
  and the code must match `^[A-HJ-NP-Z2-9]{6}$`. Created together with slot 1
  and the host's member entry, in one atomic update.
- **Join.** A slot may be claimed only if it is free, the lobby is open and
  younger than an hour, the slot's `uid` is the writer, slot 1 is the host's
  and only the host's, the writer holds no other slot, and the member index is
  written in the same update. `name` is text of 1–16 characters; `joined` is
  server time.
- **Leave.** A player may delete only their own slot (with their member
  entry). The host may delete the whole lobby.
- **Start.** Only the host, only while open and younger than an hour, and
  only as `open → started` with a seed and a lineup that **matches the
  occupied slots** and has at least two humans. After that no one can join and
  the lineup cannot change.
- **Signal.** `signal/<to>/<from>` may be written only by `<from>`, only
  between two members of a started, unexpired lobby, never to oneself, only as
  a description (`offer`/`answer`, SDP ≤ 10,000 characters) or ICE candidates
  (≤ 1,000 characters, bounded fields). Only `<to>` can read its inbox, and
  only `<to>` can clear it.

### Lobby expiry

The Spark plan cannot run Cloud Functions (they need the paid Blaze plan), and
a scheduled cleaner elsewhere would need an admin credential stored somewhere.
So expiry is application-level, in three layers:

1. **The host's disconnect removes the lobby.** Right after creating it the
   host registers `onDisconnect().remove()` on the whole lobby. The Firebase
   server runs it when the host's connection ends for any reason (tab
   closed, crash, network loss after its timeout), so an abandoned lobby
   normally disappears within about a minute. Each guest likewise registers
   the removal of its own slot. (Only the slot: Firebase checks disconnect
   writes against the rules path by path when they are registered, and a
   member entry may only be deleted once its slot is gone. The leftover entry
   in the write-only member index is harmless, since the anonymous id dies
   with the tab.)
2. **A lobby older than one hour is inert.** The rules compare `meta/created`
   (server time) with `now`: nobody can join, start or signal in it.
3. **Anyone may delete an inert lobby**, and clients do: a join attempt that
   finds an expired lobby deletes it, and so does a host whose freshly drawn
   code collides with one.

The residue is lobbies whose host's disconnect handler never ran and whose
code is never tried again: rare, and about a kilobyte each, against a 1 GB
quota. A listing-based sweeper was tried first (a rule allowing only a query
for lobbies created before an hour ago), but the emulator does not evaluate
numeric comparisons on `query.endAt`, and a rule that cannot be tested is not
shipped. A scheduled sweeper with an admin credential is in the backlog.

## Connection sequence

1. **Start.** The host writes `status: started`, a random `seed` and the
   `lineup` in one update.
2. **Every member** sees `started` and knows its peers: the other occupied
   slots in the lineup.
3. **One offerer per pair:** for each pair, the player in the **lower slot**
   creates the `RTCPeerConnection` (public STUN servers:
   `stun:stun.l.google.com:19302`, `stun:stun1.l.google.com:19302`), opens a
   data channel `dragonmarch`, creates an offer and writes it to
   `signal/<peer>/<me>/desc`. Its ICE candidates go to
   `signal/<peer>/<me>/ice` as they are found (trickle ICE).
4. **The answerer** listens on its inbox `signal/<me>`, sets the offer,
   writes its answer to `signal/<offerer>/<me>/desc` and its candidates to
   `signal/<offerer>/<me>/ice`. Candidates that arrive before the remote
   description are queued.
5. **Proof.** When the data channel opens, each side sends
   `{ t: "hello", name, nonce }`; the other replies `{ t: "ack", nonce }`. A
   pair is **verified** when a side has received the other's hello and the
   ack of its own nonce, both over the data channel.
6. **Cleanup.** When every pair is verified or has failed, each player clears
   its inbox `signal/<me>`: the handshake (which includes IP addresses in the
   candidates) does not stay in the database.
7. A pair not verified within **25 s** is reported as failed.

With at most 4 players that is at most 6 connections, so a full mesh needs no
relay topology.

**No TURN relay.** Public STUN lets most home and mobile networks connect
directly. A minority of restrictive networks (symmetric NAT, some corporate or
campus firewalls) will fail to connect; this phase reports that plainly
("could not connect directly") and does not solve it. A TURN relay is a
backlog item.

## Lobby robustness (before a match starts)

- A guest leaving (Leave button, tab closed, network lost) removes its slot;
  everyone's list updates live.
- The host leaving closes the lobby; everyone left sees "The host closed the
  lobby" and can go back to the menu.
- A player who goes offline is removed by the server once Firebase notices
  (its disconnect handler); there is no reconnection into a lobby slot. Full
  reconnection is Phase 11, once there is a match to reconnect into.

## What the players see after the connections open

A connection screen: every other human player with the connection state and
the verified test-message round trip, and the camp lineup (who plays which
corner, and which corners are AI with their strategy). Synchronised play is
Phase 11; the screen says so.

## Tests

- `npm run test:rules` (emulator): the rules. Writes outside a client's own
  lobby path, oversized fields and malformed records are rejected, and the
  legitimate create/join/leave/start/signal flow works.
- `npm run test:mp` (emulator + Playwright): separate browser contexts create
  and join a lobby by code, see each other's names live, a fifth join on a
  full lobby is refused, a leaving player updates everyone's view, and after
  start every pair opens a real WebRTC data channel and exchanges the test
  message.
- `test/net-*.test.js` (plain `npm test`): match codes, the lineup and AI
  fill-in through the unchanged `Match`.

CI runs the emulator suites in their own job, with Java for the database
emulator. No production credentials anywhere in CI.

## Results

### Regression and fingerprints

Nothing in `src/sim`, `src/ai`, `src/data`, `src/game` or `src/theme` changed
in this phase, and `test/freeze.test.js` was not touched (nothing re-pinned).
On the final code: `npm test` 287/287 (the Phase 9 suite's 275 plus 12 new),
including every freeze and equivalence test (data and sim/AI byte pins, the
gameplay hash, the Phase 3/4 fixed-seed games, and the Phase 6, 7, 8 and 9
equivalence fingerprints); the Playwright suite 61/61; fairness passes; both
mobile playthroughs pass.

### Security rules (`npm run test:rules`, 9 suites)

Signed out: nothing. Signed in: nothing outside a lobby's `meta`, `slots`,
`members` and `signal`; no listing of lobbies; only a lobby's own host creates
(well-formed, server-timestamped), starts (2+ players, a lineup matching the
slots) or closes it; one free slot per player, a 1–16 character name, never a
fifth player in any slot; nobody removes anyone else; only members of a
started lobby signal each other, with bounded SDP (≤ 10,000) and candidates
(≤ 1,000), readable only by the recipient; an hour-old lobby is inert and
anyone may delete it. All against the emulator over REST, no production
credentials.

### Browser tests (`npm run test:mp`, 10 tests)

- **Lobby:** 2 and 4 independent browser contexts create and join by code and
  see each other's names appear live; 4 joining at once all see the same
  list; a fifth is refused ("That lobby is full (4 players).") and nobody is
  displaced; malformed and unknown codes are explained; if the lobby server
  refuses the connection (as the real project does until its one-time
  setup), the player gets a plain message.
- **Leaving:** a player leaving with the button, a closed guest tab (the
  server's disconnect handler) and a closed host tab (the lobby closes, the
  others are told, the code dies) all update the remaining players' views.
- **AI fill-in:** starting with 2 players, both see Merchant Kingdom and
  Stone Bastion AI in camps 3 and 4 (`HHAA`); a late joiner is refused.
  Headless: for every lineup with 2–4 humans the unchanged `Match` puts AI
  brains on exactly the empty camps with the single-player strategies.
- **Peer connections (the core proof):** 2, 3 and 4 players in separate
  browser contexts, and 2 players in separate Chromium processes, each end
  with one `connected` RTCPeerConnection per other player (6 pairs for 4), an
  open data channel, a hello received from the other side, and an
  independent probe per ordered pair found on the receiving side; offers and
  answers are cleared from the database afterwards.

### Reliability

The first version failed 6 of 80 repeated runs. Diagnostics showed two
Chromium races, both fixed in the protocol (see the connection sequence): a
channel arriving already open, and a hello dropped at channel open (now
resent until acknowledged). After the fixes: **all 8 multiplayer tests × 40
repeats, 320/320**, then 45/45 and 9/9 on the final branches and 9/9 in CI (a tenth test, the
refused-connection message, was added last).
The 160 repeated mesh setups (80 two-player, 40 three-player, 40 four-player)
were fully verified in 0.22 s, 0.41 s and 0.47 s on average (at most 1.0 s).

**Limits of that evidence:** every run is on one machine, so ICE always picks
host candidates over UDP. Connections across real networks (STUN
server-reflexive candidates through home routers and mobile carriers) are
not exercised by any automated test, and players behind symmetric NAT or
strict firewalls will fail without a TURN relay (backlog).

### Production setup (not done by this phase)

The live site loads the real project's config, but the project needs two
one-time steps by its owner in the Firebase console, which cannot be done
from this repository without the owner's credentials: enable **Anonymous**
sign-in (Authentication was never initialised: the API answers
`CONFIGURATION_NOT_FOUND`), and **publish `database.rules.json`** (the
database is still in locked mode, denying everything). Until then the
Multiplayer screen says "Multiplayer is not available right now" (tested);
single-player is unaffected.
README.md "Multiplayer" has the steps.
