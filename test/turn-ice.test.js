// Phase 12b: src/net/ice.js, the ICE servers every peer connection uses.
// STUN always first; the Worker's relay appended after it; STUN-only, with no
// error, whenever the Worker cannot help.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { iceServers, ready, _reset } from '../src/net/ice.js';
import { ICE_SERVERS, TURN } from '../src/net/config.js';

const RELAY = { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' };
const realFetch = globalThis.fetch;
let calls;
const stub = (impl) => { calls = []; globalThis.fetch = async (url, init) => { calls.push({ url, init }); return impl(url, init); }; };
const ok = (ttl = 7200) => () => new Response(JSON.stringify({ iceServers: [RELAY], ttl }), { status: 200 });
beforeEach(() => _reset());
afterEach(() => { globalThis.fetch = realFetch; });

test('STUN first, then the minted relay; one POST to the Worker, no credentials sent', async () => {
  stub(ok());
  const servers = await ready();
  assert.deepEqual(servers, [...ICE_SERVERS, RELAY]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, TURN.endpoint);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers, undefined, 'the page holds nothing to authenticate with');
});

test('one credential serves every connection while it has life left', async () => {
  stub(ok());
  await ready();
  for (let i = 0; i < 6; i++) assert.deepEqual(iceServers(), [...ICE_SERVERS, RELAY]); // a 4-player mesh, and reopened links
  await ready();
  assert.equal(calls.length, 1);
});

test('Worker refusing, failing or unreachable: STUN only, no error, and not asked again at once', async () => {
  for (const impl of [() => new Response('{}', { status: 429 }), () => new Response('{}', { status: 502 }), () => { throw new TypeError('Failed to fetch'); }, () => new Response('not json')]) {
    _reset();
    stub(impl);
    assert.deepEqual(await ready(), ICE_SERVERS);
    assert.deepEqual(iceServers(), ICE_SERVERS);
    await ready();
    assert.equal(calls.length, 1, 'backs off after a failure');
  }
});

test('a slow Worker does not hold up the connections past the timeout', async () => {
  stub((url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))));
  const keep = setTimeout(() => {}, 10000); // Node: AbortSignal.timeout alone does not keep the process alive
  const t0 = performance.now();
  assert.deepEqual(await ready(), ICE_SERVERS);
  clearTimeout(keep);
  const waited = performance.now() - t0;
  assert.ok(waited >= TURN.timeoutMs - 50 && waited < TURN.timeoutMs + 1500, `waited ${waited} ms`);
});

test('a credential with little life left is not used for a new connection', async () => {
  stub(ok(60)); // 60 s: used while more than half its life is left
  assert.deepEqual(await ready(), [...ICE_SERVERS, RELAY]);
  stub(ok(1)); // 1 s: its half-life margin passes quickly
  _reset();
  await ready();
  await new Promise((r) => setTimeout(r, 600));
  stub(() => new Response('{}', { status: 502 }));
  assert.deepEqual(iceServers(), ICE_SERVERS, 'stale: STUN only while a fresh one is asked for');
  assert.equal(calls.length, 1, 'and a fresh one was asked for');
});
