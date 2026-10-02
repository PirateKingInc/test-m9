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

## Part B — the TURN relay (done)

### What has to be true

- TURN is an **additional** ICE server next to the public STUN servers, so
  direct connections stay direct and only the pairs that need it are relayed.
- The relay credentials are **short-lived and minted server-side**. The
  Cloudflare API token that mints them is a real secret and never reaches the
  static site. A static, non-rotating credential is not acceptable, not even
  temporarily (project owner's decision).

### The credential model (confirmed against Cloudflare's docs, 2 October 2026)

This section was first written from prior knowledge, while this environment
could not reach Cloudflare's documentation, and was marked unverified. It has
now been checked against Cloudflare's current pages ("Generate Credentials",
last updated 25 September 2026, and the TURN FAQ, 14 July 2026) and against
the real API with this project's TURN key.

**Confirmed as first written:**

- A **TURN key** (dashboard: Realtime > TURN, or the API) has a key ID and its
  own API token. Cloudflare calls the key "a long-term secret" to be kept server
  side. It cannot itself be used as a credential with `turn.cloudflare.com`.
- Short-lived credentials are minted with
  `POST https://rtc.live.cloudflare.com/v1/turn/keys/$TURN_KEY_ID/credentials/generate-ice-servers`,
  `Authorization: Bearer $TURN_KEY_API_TOKEN`, body `{"ttl": <seconds>}`. The
  real call answered **201 Created**.
- Credentials can be revoked one by one:
  `POST .../credentials/$USERNAME/revoke`, answering 204.

**Corrected or added:**

- The answer is an `iceServers` **array of two entries**, not one: a STUN entry
  (`stun:stun.cloudflare.com:3478`, free and unlimited) and the TURN entry.
  The TURN entry has six URLs: `turn:` on 3478/UDP, 443/UDP, 3478/TCP and
  80/TCP, and `turns:` on 5349/TCP and 443/TCP. The docs warn that an alternate
  port 53 URL, which browsers block, can also appear. The Worker filters it out.
  It was not in the answers seen here.
- **The TTL has a ceiling of 48 hours.** More important: **when a credential
  expires while its allocation is in use, Cloudflare disconnects the relay
  after a short delay.** So the TTL must outlast the longest connection. That
  is why it is 2 hours here. A lobby is inert after 1 hour, and a 30-minute
  match fits well inside. The game never uses a credential for a new
  connection when it has less than an hour left. Credentials can also be
  swapped on a live connection with `RTCPeerConnection.setConfiguration()`.
  That isn't needed at this TTL.
- **Issuance:** no set rate limit ("start at 500 credentials/sec"). Cloudflare
  asks that more than 50% of issued credentials be used. So the game asks only
  when a lobby starts connecting (or a match is rejoined), never on page load.
- **Billing** counts only traffic from Cloudflare's TURN server **to** a TURN
  client, TURN overhead included, at $0.05/GB after a free 1,000 GB a month.
  Client-to-server traffic is free.
- **Relaying** is UDP only. Cloudflare doesn't implement TCP relaying
  (RFC 6062). Clients can still reach the server over TCP or TLS on 443, which
  is what gets through strict firewalls. WebRTC data channels run over UDP, so
  this costs nothing here.
- Cloudflare refuses CreatePermission to private addresses. Relayed paths
  therefore always end at a public address. That matters for tests that run
  both peers on one machine.
- Cloudflare can't read relayed WebRTC traffic: DTLS encrypts it end to end.

### The chosen approach: a Cloudflare Worker (Blaze is the fallback, not needed so far)

A small **Cloudflare Worker** (free tier; `worker/`, deployed as
`https://dragonmarch-turn.piratekinginc.workers.dev/ice`) holds the TURN key's
ID and API token as Worker secrets and exposes one endpoint. The game calls it when a
multiplayer lobby starts connecting, and it returns freshly minted ICE
servers with a short TTL (the length of a match, plus margin). It answers
only the game's own origin (CORS for `piratekinginc.github.io`, plus the
browser tests' `http://localhost:4173`). Each client IP is rate-limited to 30
requests a minute per Cloudflare location, using the Workers Rate Limiting
binding. The limit is generous because carrier-grade NAT puts many phones
behind one address. The `Origin` check isn't authentication, since any
non-browser client can send any `Origin`. The rate limit and the short TTL
are what bound misuse. If the Worker cannot be reached, the game falls
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

These tests reach the real Cloudflare TURN service and the deployed Worker,
so they run in GitHub Actions (the `relay` job, `npm run test:relay`). This
build environment can now reach Cloudflare's docs and API, but not
`turn.cloudflare.com` (no relay candidate could be gathered on any of its six
URLs, with or without the proxy) or `*.workers.dev` (refused by its network
policy).

## Part C — results

Measured in GitHub Actions, the `relay` job (`npm run test:relay`,
`e2e/mp-relay.spec.js`). The players' browsers asked the deployed Worker for
credentials, as the live site does, and connected through the real
Cloudflare TURN service. "Relay-only" players had `iceTransportPolicy:
'relay'`. Every path below is the ICE candidate pair the browser itself
reported as selected (`getStats`), not an assumption. Numbers are from the
final run, on commit `8dd88f5` (Actions run 36949782139, 9 of 9 passed;
the second run on that commit passed too). The relay-forced lobbies, the
cross-engine match and bandwidth gave the same results in all six earlier
runs on this branch.

**Relay-forced lobbies.** Each player was given a credential (Worker: HTTP
200 for every page). Every link was verified by the Phase 10 test message
both ways, then the match started and was played by scripted players at 8x.

| Lobby | Relay-only | Selected paths | Test-message round trips | Result |
|---|---|---|---|---|
| 2 players | Bram | Bram's link relayed (UDP), 5–8 ms | 5–8 ms | 21 shared hash checkpoints identical to tick 2471 |
| 2 players, UDP blocked | Bram, allowed **only TURN over TLS on port 443** | Bram's link relayed over **TLS**, 11 ms | 6–7 ms | 21 identical to tick 2463 |
| 3 players | Bram, Cora | every link of Bram's and Cora's relayed; Bram–Cora relay to relay | 6–12 ms | 42 identical to tick 2481 |
| 4 players | all four | all 6 links relay to relay (UDP), 5–8 ms | 9–23 ms | 63 identical to tick 2518 |

(Each peer keeps its ~20 latest hashes, so the number of shared checkpoints
is ~20 per compared pair.)

**TURN is a fallback, not a replacement.** In a 2-player lobby where nobody
is forced, both pages were given the TURN server (it is in each connection's
ICE configuration), and both still connected host to host (0–1 ms). Whether
a relay is even allocated depends on timing. Chrome stops gathering once a
pair is writable, so in one run neither page gathered a relay candidate
(`{host: 1, srflx: 1}`). In the final run Ava gathered 10 and Bram none.
Either way the selected path was direct and no traffic crossed the relay.
Cloudflare bills only relayed data, so a direct pair costs nothing. In the mixed lobbies above, non-forced
pairs stayed direct too (Ava–Bram host to host while Cora was relayed).

**Determinism across engines, relay-only WebKit.** This is the Phase 11
cross-engine proof re-run with the WebKit player (Safari's engine, the
iPhone case) relay-only. Chromium, Firefox and WebKit played one match:
**42 shared hash checkpoints, all identical, up to tick 3186** (commands sent
68, 39, 46). WebKit's links were relayed over UDP at 7–11 ms.

**The 200 ms input delay under a relay.** Three players, with Cora
relay-only. UI commands went through the game screen's own path on all three
pages. The time between a command being given and executing was recorded on
every page as each tick ran.

| Condition | Speed | Commands | Given → carried out |
|---|---|---|---|
| relay + 40–150 ms uneven latency per message, real time, 60 s | **20.0 ticks/s** on the relay-only peer (full speed) | 120 | **5 ticks** (250 ms) for every one, same tick on every page |
| relay + 20–250 ms per message + 700 ms stalls every 2.5 s (bursts), 8x, and the relay-only tab frozen 1.5 s four times (catching up up to 40 ticks a frame) | the stalls deliberately hold the lockstep (tick 427 after ~30 s) | 150 | **5 ticks** for every one, same tick on every page |

No command ever ran sooner than the input delay (4 ticks). The Phase 12 bug
(a command given and run in the same tick when a frame runs more ticks than
the delay) did not reappear under relay timing, bursts or catch-up. Hashes
stayed identical throughout. The relay itself added 4–30 ms round trip
across all runs, well inside the 200 ms delay. Both input-delay results were
the same in the two runs after the test harness was corrected.

**Bandwidth.** Four relay-only players, real time, 120 s of play after the
opening: 4,459,947 bytes in 42,287 packets received over the 12 link ends.
That's about 29 packets a second per link (20 turns, heartbeats, SCTP acks),
averaging 105 bytes each. Earlier runs measured 4.15–4.37 MB; the highest
figure is used here. Cloudflare bills what the relay sends to each
relayed client, TURN overhead included. Allowing a 4-byte ChannelData header
plus 28 bytes of IPv4 and UDP header per packet as a ceiling:

- per relayed client: **11.8 KiB/s**, so **21.8 MB per 30-minute match**;
- worst case, all four players relayed: **87.2 MB per match**, so the
  1,000 GB monthly free allowance covers **~11,500 fully relayed 4-player
  matches a month** (~380 a day);
- the case seen in the live test, one player on cellular: ~21.8 MB, so
  **~46,000 such matches a month**;
- beyond the allowance, a fully relayed 4-player match would cost about
  $0.004.

The traffic is set by the tick rate, not army size: turns are sent every
tick whether or not they carry commands, and commands are small. The
measurement covers the early middle game. Even with a 3x margin for a busier
late game, ~3,800 fully relayed matches a month fit in the free tier.

**Credential security.** `tools/check-bundle.mjs` inspects every file of the
site exactly as `pages.yml` assembles it. It looks for any of the four
secret values (compared exactly when present), Cloudflare's credential API,
a bearer token, a static TURN address or username/credential literal, a
32+ character hex token, and any Cloudflare or workers.dev address other
than the Worker. Locally, with all four real secret values compared: 81
files, 441 KiB, clean, with the Worker URL appearing once. Each of eight
planted leaks (the API token in JS and in a binary, the key ID in a PNG, a
direct API call, a static TURN server with credentials, a bearer header, a
hex key, another workers.dev host) was caught. CI runs it in `npm test`
(`test/bundle.test.js`), before each deploy, and against the live site after
each deploy, fetching every file. The Worker never echoes Cloudflare's
errors, and its answers carry only the minted 2-hour credential
(`test/turn-worker.test.js` checks that no answer, including error answers,
contains the API token).

**What this does not prove.** No test here runs on a real cellular network.
`iceTransportPolicy: 'relay'` reproduces the *outcome* of carrier-grade NAT
(no host or server-reflexive path works, so only the relay can carry the
traffic). It doesn't reproduce a carrier's own behaviour: UDP throttling or
blocking, port restrictions, or IPv6-only networks. Networks that block UDP
are covered as far as a test can go: with only TURN over TLS on 443
allowed, the relay still carried a synced match.
