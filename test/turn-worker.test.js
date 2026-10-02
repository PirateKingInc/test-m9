// Phase 12b: the TURN credential Worker (worker/src/index.js), run in Node with
// Cloudflare's API stubbed. What reaches the browser, and what never does.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { dropPort53 } from '../worker/src/index.js';

const GAME = 'https://piratekinginc.github.io';
const SECRET = 'k'.repeat(64);
const env = (over = {}) => ({ ALLOWED_ORIGINS: `${GAME},http://localhost:4173`, TTL_S: '7200', TURN_KEY_ID: 'a'.repeat(32), TURN_KEY_API_TOKEN: SECRET, ...over });
const CF = { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u1', credential: 'c1' }] };
const req = (origin, { method = 'POST', path = '/ice', ip = '203.0.113.9' } = {}) =>
  new Request(`https://dragonmarch-turn.example.workers.dev${path}`, { method, headers: { ...(origin ? { origin } : {}), 'cf-connecting-ip': ip } });

const realFetch = globalThis.fetch;
let calls;
const stub = (impl) => { calls = []; globalThis.fetch = async (url, init) => { calls.push({ url, init }); return impl(url, init); }; };
afterEach(() => { globalThis.fetch = realFetch; });

test('the game origin gets freshly minted ICE servers, with the TTL the Worker chose', async () => {
  stub(() => new Response(JSON.stringify(CF), { status: 201 }));
  const res = await worker.fetch(req(GAME), env());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), GAME);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.ttl, 7200);
  assert.equal(body.iceServers[1].username, 'u1');
  // The upstream call: the key's endpoint, the token as a bearer, the TTL in the body.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://rtc.live.cloudflare.com/v1/turn/keys/${'a'.repeat(32)}/credentials/generate-ice-servers`);
  assert.equal(calls[0].init.headers.authorization, `Bearer ${SECRET}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { ttl: 7200 });
});

test('the API token never appears in any answer', async () => {
  stub(() => new Response(JSON.stringify(CF), { status: 201 }));
  for (const [r, e] of [[req(GAME), env()], [req('https://evil.example'), env()], [req(GAME, { method: 'GET' }), env()]]) {
    const text = await (await worker.fetch(r, e)).text();
    assert.ok(!text.includes(SECRET), text);
  }
  stub(() => new Response(`bad token ${SECRET}`, { status: 401 }));
  const text = await (await worker.fetch(req(GAME), env())).text();
  assert.ok(!text.includes(SECRET), 'upstream error detail is not echoed');
});

test('other origins, no origin, other paths and other methods mint nothing', async () => {
  stub(() => new Response(JSON.stringify(CF), { status: 201 }));
  assert.equal((await worker.fetch(req('https://evil.example'), env())).status, 403);
  assert.equal((await worker.fetch(req(null), env())).status, 403);
  assert.equal((await worker.fetch(req(GAME, { path: '/' }), env())).status, 404);
  assert.equal((await worker.fetch(req(GAME, { method: 'GET' }), env())).status, 405);
  const pre = await worker.fetch(req(GAME, { method: 'OPTIONS' }), env());
  assert.equal(pre.status, 204);
  assert.equal(calls.length, 0, 'Cloudflare was never asked');
});

test('the rate limit is per client IP, and a refused client gets no credential', async () => {
  stub(() => new Response(JSON.stringify(CF), { status: 201 }));
  const seen = new Map();
  const RATE_LIMITER = { limit: async ({ key }) => { seen.set(key, (seen.get(key) || 0) + 1); return { success: seen.get(key) <= 2 }; } };
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await worker.fetch(req(GAME), env({ RATE_LIMITER }))).status);
  codes.push((await worker.fetch(req(GAME, { ip: '198.51.100.7' }), env({ RATE_LIMITER }))).status);
  assert.deepEqual(codes, [200, 200, 429, 200]);
  assert.equal(calls.length, 3);
});

test('Cloudflare down or refusing: a clean 502 (the game then plays STUN-only)', async () => {
  stub(() => { throw new TypeError('network'); });
  assert.equal((await worker.fetch(req(GAME), env())).status, 502);
  stub(() => new Response('{}', { status: 500 }));
  assert.equal((await worker.fetch(req(GAME), env())).status, 502);
  stub(() => new Response('{"nope":1}', { status: 201 }));
  assert.equal((await worker.fetch(req(GAME), env())).status, 502);
});

test('port 53 URLs are dropped (browsers block them; Cloudflare docs)', () => {
  const out = dropPort53(CF.iceServers);
  assert.deepEqual(out[1].urls, ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp']);
  assert.deepEqual(dropPort53([{ urls: 'turn:x:53' }]), []);
});
