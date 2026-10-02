// Phase 12b (PHASE12B_SPEC.md Part B): the ICE servers every peer connection
// uses. The public STUN servers always come first; the TURN relay minted by
// the Worker (worker/src/index.js) is appended after them, so direct and
// reflexive paths are tried as before and only a pair that cannot connect any
// other way is relayed. If the Worker cannot be reached, it is STUN-only, as
// before Phase 12b, with no error.
//
// Only a short-lived credential ever reaches this page: the Worker holds the
// TURN key's API token. One credential serves this tab's connections until it
// is close to expiring, then the next connection asks for a fresh one.
import { ICE_SERVERS, TURN } from './config.js';

let cached = null; // { servers, expires, margin } (performance.now() ms)
let pending = null;
let retryAt = 0; // after a failed request, not again before this

const fresh = () => cached && cached.expires - performance.now() > cached.margin;

// STUN first, then whatever relay is known now. Never waits.
export function iceServers() {
  if (!fresh()) refresh(); // for the next connection
  return fresh() ? [...ICE_SERVERS, ...cached.servers] : [...ICE_SERVERS];
}

// Wait (briefly) for a relay credential, before opening connections.
export async function ready() {
  if (!fresh()) await refresh();
  return iceServers();
}

function refresh() {
  if (performance.now() < retryAt) return Promise.resolve();
  return (pending ||= mint().then((r) => {
    if (r) cached = r;
    else retryAt = performance.now() + TURN.retryMs;
  }).finally(() => { pending = null; }));
}

async function mint() {
  try {
    const res = await fetch(TURN.endpoint, { method: 'POST', signal: AbortSignal.timeout(TURN.timeoutMs), cache: 'no-store' });
    if (!res.ok) return null;
    const { iceServers: servers, ttl } = await res.json();
    if (!Array.isArray(servers) || !(ttl > 0)) return null;
    // Used for new connections while at least the margin (or half its life) is left.
    return { servers: servers.filter((s) => s && s.urls), expires: performance.now() + ttl * 1000, margin: Math.min(TURN.refreshMarginMs, ttl * 500) };
  } catch {
    return null; // unreachable, refused or slow: STUN only
  }
}

// For the tests: forget the credential.
export const _reset = () => { cached = null; pending = null; retryAt = 0; };
