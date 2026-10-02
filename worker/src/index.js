// Phase 12b (PHASE12B_SPEC.md Part B): mints short-lived Cloudflare Realtime
// TURN credentials for the game. The TURN key's API token is a Worker secret:
// it never reaches the static site or a browser. A browser gets only what
// Cloudflare's generate-ice-servers call returns, which stops working after
// TTL_S seconds.
//
// POST /ice  ->  200 { iceServers: [...], ttl }
// Only the game's own origins (ALLOWED_ORIGINS) get an answer, and each client
// IP is rate-limited (the RATE_LIMITER binding, wrangler.toml).

const API = 'https://rtc.live.cloudflare.com/v1/turn/keys';
const UPSTREAM_TIMEOUT_MS = 5000;

const json = (status, body, origin) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json',
    'cache-control': 'no-store', // every answer is a fresh credential
    vary: 'Origin',
    ...(origin ? { 'access-control-allow-origin': origin } : {}),
  },
});

// Cloudflare's docs: port 53 is blocked by browsers and only times out.
export const dropPort53 = (servers) => servers.map((s) => {
  const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u));
  return { ...s, urls };
}).filter((s) => s.urls.length);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
    if (url.pathname !== '/ice') return json(404, { error: 'not found' });
    // An Origin header is what a browser sends; it keeps other websites from
    // using this endpoint. It is not authentication (any non-browser client can
    // send one): the rate limit and the short TTL are what bound misuse.
    if (!origin || !allowed.includes(origin)) return json(403, { error: 'origin not allowed' });
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST', 'access-control-max-age': '86400', vary: 'Origin' } });
    }
    if (request.method !== 'POST') return json(405, { error: 'POST only' }, origin);

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (env.RATE_LIMITER) {
      const { success } = await env.RATE_LIMITER.limit({ key: `ice:${ip}` });
      if (!success) return json(429, { error: 'too many requests' }, origin);
    }

    const ttl = Number(env.TTL_S) || 7200;
    let res;
    try {
      res = await fetch(`${API}/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      return json(502, { error: 'relay service unreachable' }, origin);
    }
    if (!res.ok) return json(502, { error: 'relay service refused' }, origin); // never echo upstream detail
    const { iceServers } = await res.json();
    if (!Array.isArray(iceServers)) return json(502, { error: 'relay service answer malformed' }, origin);
    return json(200, { iceServers: dropPort53(iceServers), ttl }, origin);
  },
};
