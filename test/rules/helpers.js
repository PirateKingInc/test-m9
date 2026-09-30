// Phase 10: talk to the Firebase Local Emulator Suite over REST (no SDK, no
// production credentials). Run under `npm run test:rules`, which starts the
// auth and database emulators with database.rules.json loaded.
export const DB = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000'}`;
export const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`;
export const NS = 'demo-dragonmarch-default-rtdb';
export const TS = { '.sv': 'timestamp' }; // the server's clock, like serverTimestamp()
export const HOUR = 3600000;

// A fresh anonymous user, exactly what signInAnonymously() creates.
export async function user() {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"returnSecureToken":true}',
  });
  const j = await r.json();
  return { uid: j.localId, token: j.idToken };
}

// who: a user, null (signed out) or 'owner' (the emulator's admin, bypasses
// the rules: only for setting up a state, never for what is being tested).
export async function call(method, path, who, body, query = '') {
  const auth = who && who !== 'owner' ? `&auth=${who.token}` : '';
  const headers = { 'content-type': 'application/json' };
  if (who === 'owner') headers.authorization = 'Bearer owner';
  const r = await fetch(`${DB}/${path}.json?ns=${NS}${auth}${query}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, ok: r.ok, body: text ? JSON.parse(text) : null };
}
export const read = (path, who, query) => call('GET', path, who, undefined, query);
export const put = (path, who, body) => call('PUT', path, who, body);
export const patch = (path, who, body) => call('PATCH', path, who, body);
export const del = (path, who) => call('DELETE', path, who);

let n = 0;
// A fresh valid match code per test, so tests never share a lobby.
export function code() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let x = Date.now() * 7 + n++ * 7919 + Math.floor(Math.random() * 1e6), s = '';
  for (let i = 0; i < 6; i++) { s += A[x % 32]; x = Math.floor(x / 32); }
  return s;
}

// The client's own create and join writes (src/net/lobby.js does the same).
export const create = (c, host, name = 'Host') => patch(`lobbies/${c}`, host, {
  meta: { host: host.uid, created: TS, status: 'open' },
  'slots/1': { uid: host.uid, name, joined: TS },
  [`members/${host.uid}`]: '1',
});
export const join = (c, who, slot, name = 'Guest') => patch(`lobbies/${c}`, who, {
  [`slots/${slot}`]: { uid: who.uid, name, joined: TS },
  [`members/${who.uid}`]: String(slot),
});
export const start = (c, host, lineup, seed = 4242) => patch(`lobbies/${c}/meta`, host, { status: 'started', seed, lineup });
