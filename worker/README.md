# TURN credential Worker (Phase 12b)

A Cloudflare Worker that mints **short-lived** Cloudflare Realtime TURN
credentials for the game's peer connections. The TURN key's API token is a
Worker secret; it is never in this repository, the static site, or a browser.
See [PHASE12B_SPEC.md](../PHASE12B_SPEC.md) Part B.

- **Live:** `https://dragonmarch-turn.piratekinginc.workers.dev/ice`
- **Request:** `POST /ice` with no body, from an allowed origin (`ALLOWED_ORIGINS`
  in `wrangler.toml`: the live site and the browser tests' local server).
- **Answer:** `{ "iceServers": [...], "ttl": 7200 }`: Cloudflare's own
  `generate-ice-servers` answer (STUN, then TURN over UDP, TCP and TLS, with a
  username and credential that expire after `ttl` seconds), minus port-53 URLs.
- **Refused:** 403 for any other origin or none, 405 for anything but POST,
  429 past 30 requests a minute from one IP (per Cloudflare location), 502 if
  Cloudflare's TURN API fails (the game then connects STUN-only).

The `Origin` check keeps other websites from using the endpoint. It is not
authentication: a non-browser client can send any `Origin`. What bounds misuse
is the rate limit and the credential lifetime.

## Deploy

Needs a Cloudflare API token that can edit Workers on the account, and the
TURN key (Cloudflare dashboard > Realtime > TURN) with its API token.

```sh
cd worker
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
npx wrangler@4.146.0 deploy
printf %s "$TURN_KEY_ID"        | npx wrangler@4.146.0 secret put TURN_KEY_ID
printf %s "$TURN_KEY_API_TOKEN" | npx wrangler@4.146.0 secret put TURN_KEY_API_TOKEN
```

Rotating the TURN key: create a new key in the dashboard, `secret put` both
values, then delete the old key (which also invalidates every credential
minted from it). Individual credentials can be revoked with
`POST https://rtc.live.cloudflare.com/v1/turn/keys/$TURN_KEY_ID/credentials/$USERNAME/revoke`.

Tests: `test/turn-worker.test.js` (in `npm test`, Cloudflare stubbed) and
`e2e/mp-relay.spec.js` (`npm run test:relay`, the deployed Worker and the
real TURN service; CI's `relay` job).
