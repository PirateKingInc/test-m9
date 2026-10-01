# Phase 12b — Relay fallback: playing from a restrictive network

In the first live multi-person test a player on a cellular network could not
connect to anyone: every one of their pairwise WebRTC links failed, while the
other three players connected to each other. The likely cause is
carrier-grade NAT, which public STUN (all Phase 10 uses) cannot get through.
This game has been built for phones since Phase 4, so cellular play is a core
case, not an edge one. This phase adds a **TURN relay** as a fallback, and
fixes the raw error that player saw.

Numbered 12b so that Castle leveling and the heavy unit keep the numbers
Phase 12 gave them (13 and 14).

**Scope:** how peers find each other when a direct connection fails, and
what the player sees when it does. No change to the sim, AI, balance,
territory or the lockstep protocol.

## Part A — the raw error (done first, ships on its own)

**What the player saw:** "null is not an object (evaluating 'ch.onmessage')"
(Safari's wording; Chromium: "Cannot read properties of null (reading
'onmessage')"), under the connection list.

**Root cause, reproduced.** `renderLinks` (src/net/menu.js) started the match
when "verified pairs = pairs". The connection screen is first drawn before
the mesh has added its peers, so 0 of 0 counted as everyone connected and the
start was scheduled at once, on every player's screen. 2.5 s later
`startMatch` handed each peer's data channel to the match. Players whose
connections had been verified by then never noticed; a player whose
connections were failing had none (`null`), and the start threw, its message
shown raw.

**Fix:**
- the start needs a non-empty list with every pair verified;
- `startMatch` checks again at that moment (every pair verified, every
  channel open) and otherwise starts nothing and returns false; the screen
  then shows the existing "The match cannot start without a direct
  connection to every player.";
- `Links.adopt` refuses a missing channel instead of throwing.

**Test:** `e2e/mp-fail.spec.js`. Four players; Dunn's browser never sends its
own ICE candidates and ignores everyone else's, so no network path can
form, as when NAT blocks every one. It asserts Dunn sees "Connected to 0 of
3. 3 could not connect directly (a strict network or firewall)." and the
"cannot start" note, the others see "Connected to 2 of 3. 1 could not
connect directly", and no player has an uncaught error, a console error, or
error text on the page. It failed on the old code with exactly the reported
error, and passes with the fix.

## Part B — the TURN relay (blocked: credentials and network access)

### What has to be true

- TURN is an **additional** ICE server next to the public STUN servers, so
  direct connections stay direct and only the pairs that need it are relayed.
- The relay credentials are **short-lived and minted server-side**. The
  Cloudflare API token that mints them is a real secret and never reaches the
  static site. A static, non-rotating credential is not acceptable, not even
  temporarily (project owner's decision).

### The credential model (to be confirmed against Cloudflare's docs)

Cloudflare's documentation could not be read from this environment (its
network policy blocks developers.cloudflare.com), so the following is from
prior knowledge of Cloudflare Realtime TURN and **must be checked against the
current docs before anything is built on it**:

- A **TURN key** is created in the Cloudflare dashboard (Realtime > TURN). It
  has a key ID and its own API token.
- Short-lived credentials are minted with an authenticated POST to the
  Realtime API for that key (an endpoint under `rtc.live.cloudflare.com`,
  bearer-authenticated with the key's API token, with a `ttl` in seconds in
  the body). The response is an `iceServers` entry: TURN URLs
  (`turn.cloudflare.com` over UDP, TCP and TLS) with a username and credential.
- Credentials can be revoked individually.

### The chosen approach: a Cloudflare Worker (Blaze is the fallback, not needed so far)

A small **Cloudflare Worker** (free tier) holds the TURN key's API token as
a Worker secret and exposes one endpoint. The game calls it when a
multiplayer lobby starts connecting, and it returns freshly minted ICE
servers with a short TTL (the length of a match, plus margin). It answers
only the game's own origin (CORS for `piratekinginc.github.io`) and is
rate-limited per client. If the Worker cannot be reached, the game falls
back to STUN-only, as today: the relay only adds paths. Firebase Blaze plus
a Cloud Function is the documented second option and is used only if the
Worker path is genuinely blocked.

### ICE configuration

`src/net/config.js` keeps the public STUN servers. Phase 10's Mesh and
Phase 11's Links ask for the minted TURN entry and append it, so a peer
connection's `iceServers` is STUN first, then TURN. The ICE agent tries
direct and reflexive candidates as before; relayed candidates are used only
when nothing else connects.

## Part C — verifying the relay (after Part B)

- **Relay-forced connections:** `iceTransportPolicy: 'relay'` on one or more
  players' peer connections forces every one of their paths through TURN.
  Lobbies of 2, 3 and 4 players with one or more forced players must
  connect, verify a test message over every data channel, start the match
  and play.
- **Determinism:** the existing real cross-browser lockstep proof, re-run with
  one peer relay-only: state byte-identical at every shared hash checkpoint.
- **Input delay under a relay:** the 200 ms input-delay guarantee (the
  `src/net/play.js` per-tick commit fixed in Phase 12) re-tested with relayed
  peers, under the existing latency injection with uneven, bursty delays and
  the fast catch-up condition.
- **Bandwidth:** match traffic measured, and the relay-only worst case
  compared with Cloudflare's 1,000 GB monthly free allowance.
- **Credential security:** the shipped site inspected directly to confirm it
  contains no API token, only the Worker's URL, and that only short-lived
  minted credentials ever reach a browser.

These tests reach the real Cloudflare TURN service, so they run in GitHub
Actions (whose runners can reach it); this container's network policy
cannot.
