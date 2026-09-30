// Phase 10 multiplayer settings (PHASE10_SPEC.md). The Firebase web config is
// public by design: it identifies the project and is not a credential. What
// clients may read or write is decided by the server-side rules in
// database.rules.json.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCJTenrjd6oyegULX7fO1lsDHczT5CxXkQ',
  authDomain: 'dragonmarch-7e5b8.firebaseapp.com',
  databaseURL: 'https://dragonmarch-7e5b8-default-rtdb.firebaseio.com/',
  projectId: 'dragonmarch-7e5b8',
  storageBucket: 'dragonmarch-7e5b8.firebasestorage.app',
  messagingSenderId: '596451181898',
  appId: '1:596451181898:web:3d4cd0a3271fdbc2f96db3',
};

// Google's standard modular web SDK, pinned (the same version is the `firebase`
// dev dependency, which the browser tests serve in place of the CDN).
export const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/12.19.0';

export const LOBBY = {
  slots: 4, // one per free-for-all camp
  minHumans: 2, // to start; one human is single-player
  nameMax: 16,
  ttlMs: 3600000, // a lobby older than this is inert (database.rules.json)
  codeLength: 6,
  alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', // no 0/O, no 1/I
};

// Public STUN servers for NAT traversal. No TURN relay in this phase: a
// minority of restrictive networks cannot connect directly (BACKLOG.md).
export const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

export const CONNECT = {
  channel: 'dragonmarch', // the data channel's label
  timeoutMs: 25000, // a pair not verified by then is reported as failed
  helloRetryMs: 300, // the test message is resent until acknowledged
};
