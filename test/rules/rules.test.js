// Phase 10 verification (b): the Realtime Database Security Rules
// (database.rules.json, PHASE10_SPEC.md "Security rules") against the Firebase
// emulator. Every write outside a client's own lobby path, every oversized
// field and every malformed record is rejected; the legitimate flow works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { user, read, put, patch, del, code, create, join, start, TS, HOUR } from './helpers.js';

const denied = (r, what) => assert.ok(r.status === 401 || r.status === 403, `${what}: expected a denial, got ${r.status} ${JSON.stringify(r.body)}`);
const allowed = (r, what) => assert.ok(r.ok, `${what}: expected success, got ${r.status} ${JSON.stringify(r.body)}`);

test('signed out: nothing is readable or writable', async () => {
  const host = await user(), c = code();
  allowed(await create(c, host), 'create');
  denied(await read('', null), 'read the root');
  denied(await read(`lobbies/${c}/meta`, null), 'read a lobby');
  denied(await put(`lobbies/${code()}/meta`, null, { host: 'x', created: TS, status: 'open' }), 'create a lobby');
});

test('nothing outside /lobbies/<code>/{meta,slots,members,signal} exists for a client', async () => {
  const u = await user(), c = code();
  denied(await read('', u), 'read the root');
  denied(await read('lobbies', u), 'list every lobby');
  denied(await put('anything', u, 1), 'write a new top-level path');
  denied(await put('users/me', u, { name: 'x' }), 'write a profile');
  allowed(await create(c, u), 'create');
  denied(await put(`lobbies/${c}/chat`, u, 'hi'), 'an unknown lobby field');
  denied(await put(`lobbies/${c}/meta/extra`, u, 1), 'an unknown meta field');
  denied(await read(`lobbies/${c}/members`, u), 'the member index is write-only');
});

test('create: a well-formed lobby by its own host only', async () => {
  const host = await user(), other = await user();
  allowed(await create(code(), host), 'a well-formed create');
  denied(await patch(`lobbies/${code()}`, host, { meta: { host: other.uid, created: TS, status: 'open' } }), 'a lobby in someone else\'s name');
  denied(await patch(`lobbies/${code()}`, host, { meta: { host: host.uid, created: 12345, status: 'open' } }), 'a made-up creation time');
  denied(await patch(`lobbies/${code()}`, host, { meta: { host: host.uid, created: TS, status: 'started' } }), 'created already started');
  denied(await create('ABC0O1', host), 'a code with ambiguous characters');
  denied(await create('ABCDEFG', host), 'a code of the wrong length');
  const c = code();
  allowed(await create(c, host), 'create');
  denied(await create(c, other), 'take over an existing code');
  denied(await put(`lobbies/${c}/meta/host`, other, other.uid), 'rewrite the host');
  denied(await put(`lobbies/${c}/meta/status`, other, 'started'), 'start someone else\'s lobby');
  denied(await put(`lobbies/${c}/meta/created`, host, 1), 'even the host cannot backdate it');
  const meta = (await read(`lobbies/${c}/meta`, other)).body;
  assert.equal(meta.host, host.uid, 'anyone holding the code can read the lobby');
  assert.equal(meta.status, 'open');
});

test('join: one slot per player, only a free one, with a short name', async () => {
  const host = await user(), a = await user(), b = await user(), c = code();
  allowed(await create(c, host), 'create');
  denied(await join(c, a, 1), 'slot 1 is the host\'s');
  denied(await join(c, a, 5), 'there is no slot 5');
  denied(await join(c, a, 2, ''), 'an empty name');
  denied(await join(c, a, 2, 'x'.repeat(17)), 'a 17-character name');
  denied(await join(c, a, 2, 42), 'a name that is not text');
  allowed(await join(c, a, 2, 'x'.repeat(16)), 'a 16-character name');
  denied(await join(c, a, 3), 'a second slot for the same player');
  denied(await join(c, b, 2), 'an occupied slot');
  denied(await patch(`lobbies/${c}`, b, { 'slots/3': { uid: a.uid, name: 'Imp', joined: TS }, [`members/${b.uid}`]: '3' }), 'a slot in someone else\'s name');
  denied(await patch(`lobbies/${c}`, b, { 'slots/3': { uid: b.uid, name: 'B', joined: TS, admin: true }, [`members/${b.uid}`]: '3' }), 'an extra field');
  denied(await patch(`lobbies/${c}`, b, { 'slots/3': { uid: b.uid, name: 'B', joined: 5 }, [`members/${b.uid}`]: '3' }), 'a made-up join time');
  denied(await put(`lobbies/${c}/slots/3`, b, { uid: b.uid, name: 'B', joined: TS }), 'a slot without the member index');
  denied(await put(`lobbies/${c}/members/${b.uid}`, b, '3'), 'the member index without a slot');
  allowed(await join(c, b, 3), 'the next free slot');
});

test('a full lobby (4 players) takes no fifth', async () => {
  const host = await user(), c = code();
  allowed(await create(c, host), 'create');
  for (const slot of [2, 3, 4]) allowed(await join(c, await user(), slot), `slot ${slot}`);
  const fifth = await user();
  for (const slot of [1, 2, 3, 4, 5]) denied(await join(c, fifth, slot), `a fifth player in slot ${slot}`);
});

test('leave: players remove only themselves; the host can close the lobby', async () => {
  const host = await user(), a = await user(), b = await user(), c = code();
  allowed(await create(c, host), 'create');
  allowed(await join(c, a, 2), 'a joins');
  allowed(await join(c, b, 3), 'b joins');
  denied(await patch(`lobbies/${c}`, a, { 'slots/3': null, [`members/${b.uid}`]: null }), 'remove another player');
  denied(await del(`lobbies/${c}/members/${a.uid}`, a), 'drop the member index but keep the slot');
  denied(await del(`lobbies/${c}`, a), 'a guest deletes the lobby');
  allowed(await patch(`lobbies/${c}`, a, { 'slots/2': null, [`members/${a.uid}`]: null }), 'leave');
  allowed(await join(c, a, 2), 'and come back');
  allowed(await del(`lobbies/${c}`, host), 'the host closes it');
  assert.equal((await read(`lobbies/${c}/meta`, a)).body, null);
});

test('start: the host only, with at least two players, a lineup that matches the slots, then closed to joins', async () => {
  const host = await user(), a = await user(), c = code();
  allowed(await create(c, host), 'create');
  denied(await start(c, host, 'HAAA'), 'alone');
  denied(await start(c, host, 'HHAA'), 'a lineup naming an empty slot');
  allowed(await join(c, a, 2), 'a joins');
  denied(await start(c, a, 'HHAA'), 'a guest starts');
  denied(await start(c, host, 'HHHA'), 'a lineup that does not match');
  denied(await start(c, host, 'HHAX'), 'a malformed lineup');
  denied(await start(c, host, 'HHAA', 0), 'a seed out of range');
  allowed(await start(c, host, 'HHAA'), 'start');
  denied(await join(c, await user(), 3), 'join after the start');
  denied(await put(`lobbies/${c}/meta/lineup`, host, 'HHHH'), 'change the lineup after the start');
  denied(await put(`lobbies/${c}/meta/status`, host, 'open'), 'reopen');
});

test('signaling: only between members of a started lobby, in bounded, well-formed pieces', async () => {
  const host = await user(), a = await user(), outsider = await user(), c = code();
  const offer = { type: 'offer', sdp: 'v=0\r\n'.repeat(20) };
  const ice = { c: 'candidate:1 1 udp 2122260223 192.0.2.1 54321 typ host', m: '0', i: 0 };
  allowed(await create(c, host), 'create');
  allowed(await join(c, a, 2), 'a joins');
  denied(await put(`lobbies/${c}/signal/${a.uid}/${host.uid}/desc`, host, offer), 'before the start');
  allowed(await start(c, host, 'HHAA'), 'start');
  allowed(await put(`lobbies/${c}/signal/${a.uid}/${host.uid}/desc`, host, offer), 'an offer to a member');
  allowed(await patch(`lobbies/${c}/signal/${a.uid}/${host.uid}/ice`, host, { k1: ice }), 'an ICE candidate');
  allowed(await put(`lobbies/${c}/signal/${host.uid}/${a.uid}/desc`, a, { type: 'answer', sdp: 'v=0' }), 'the answer');
  denied(await put(`lobbies/${c}/signal/${a.uid}/${outsider.uid}/desc`, outsider, offer), 'from a non-member');
  denied(await put(`lobbies/${c}/signal/${outsider.uid}/${host.uid}/desc`, host, offer), 'to a non-member');
  denied(await put(`lobbies/${c}/signal/${a.uid}/${outsider.uid}/desc`, host, offer), 'in someone else\'s name');
  denied(await put(`lobbies/${c}/signal/${host.uid}/${host.uid}/desc`, host, offer), 'to oneself');
  denied(await put(`lobbies/${c}/signal/${a.uid}/${host.uid}/desc`, host, { type: 'offer', sdp: 'x'.repeat(10001) }), 'an oversized SDP');
  denied(await put(`lobbies/${c}/signal/${a.uid}/${host.uid}/desc`, host, { type: 'pranswer', sdp: 'v=0' }), 'an unknown description type');
  denied(await put(`lobbies/${c}/signal/${a.uid}/${host.uid}/desc`, host, { type: 'offer', sdp: 'v=0', x: 1 }), 'an extra field');
  denied(await patch(`lobbies/${c}/signal/${a.uid}/${host.uid}/ice`, host, { k2: { c: 'x'.repeat(1001) } }), 'an oversized candidate');
  denied(await patch(`lobbies/${c}/signal/${a.uid}/${host.uid}/ice`, host, { k3: { c: 'x', i: 99 } }), 'a bad media line index');
  denied(await patch(`lobbies/${c}/signal/${a.uid}/${host.uid}/ice`, host, { k4: { c: 'x', evil: 'y' } }), 'an extra candidate field');
  denied(await put(`lobbies/${c}/signal/${a.uid}/${host.uid}/data`, host, 'game state'), 'anything but a description or candidates');
  const inbox = await read(`lobbies/${c}/signal/${a.uid}`, a);
  allowed(inbox, 'the recipient reads its inbox');
  assert.equal(inbox.body[host.uid].desc.type, 'offer');
  denied(await read(`lobbies/${c}/signal/${a.uid}`, host), 'nobody else reads it');
  denied(await read(`lobbies/${c}/signal/${a.uid}`, outsider), 'certainly not an outsider');
  denied(await read(`lobbies/${c}/signal`, host), 'nor the whole signal tree');
  allowed(await del(`lobbies/${c}/signal/${a.uid}`, a), 'the recipient clears its inbox once connected');
  denied(await del(`lobbies/${c}/signal/${host.uid}`, a), 'but not someone else\'s');
});

test('expiry: a lobby older than an hour is inert, and anyone may delete it; no one may list lobbies', async () => {
  const host = await user(), a = await user(), sweeper = await user();
  const old = code(), fresh = code();
  // Set up an hour-old lobby directly (the emulator's admin: time travel).
  const t = Date.now() - HOUR - 60000;
  allowed(await put(`lobbies/${old}`, 'owner', {
    meta: { host: host.uid, created: t, status: 'open' },
    slots: { 1: { uid: host.uid, name: 'Old', joined: t }, 2: { uid: a.uid, name: 'A', joined: t } },
    members: { [host.uid]: '1', [a.uid]: '2' },
  }), 'set up an expired lobby');
  allowed(await create(fresh, host), 'a fresh lobby');
  denied(await join(old, sweeper, 3), 'join an expired lobby');
  denied(await start(old, host, 'HHAA'), 'start an expired lobby');
  allowed(await put(`lobbies/${old}/meta/status`, 'owner', 'started'), 'set it started');
  denied(await put(`lobbies/${old}/signal/${a.uid}/${host.uid}/desc`, host, { type: 'offer', sdp: 'v=0' }), 'signal in an expired lobby');
  denied(await read('lobbies', sweeper), 'list lobbies');
  denied(await read('lobbies', sweeper, `&orderBy=${encodeURIComponent('"meta/created"')}&limitToFirst=25`), 'list lobbies with a query');
  denied(await del(`lobbies/${fresh}`, sweeper), 'delete a live lobby');
  allowed(await del(`lobbies/${old}`, sweeper), 'anyone deletes the expired one');
  allowed(await put(`lobbies/${old}/members/x`, 'owner', '2'), 'leftovers without a meta record');
  allowed(await del(`lobbies/${old}`, sweeper), 'are deletable too');
});
