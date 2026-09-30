// Phase 10: Firebase, loaded on demand (PHASE10_SPEC.md "The exception").
// Only the Multiplayer screen calls connect(); single-player never loads it.
// Used for lobby records and the one-time WebRTC handshake, nothing else.
import { FIREBASE_CONFIG, FIREBASE_SDK } from './config.js';

// Tests point the client at the Firebase Local Emulator Suite by defining
// globalThis.__DM_FIREBASE_EMULATOR__ = { auth: 'host:port', db: 'host:port',
// projectId, ns } before the page loads (a Playwright init script). The
// shipped site never defines it and talks to the real project.
let connecting = null;
export function connect() {
  connecting ??= open().catch((e) => { connecting = null; throw e; });
  return connecting;
}

async function open() {
  const [app, auth, db] = await Promise.all([
    import(`${FIREBASE_SDK}/firebase-app.js`),
    import(`${FIREBASE_SDK}/firebase-auth.js`),
    import(`${FIREBASE_SDK}/firebase-database.js`),
  ]);
  const emu = globalThis.__DM_FIREBASE_EMULATOR__;
  const config = emu ? { ...FIREBASE_CONFIG, projectId: emu.projectId, databaseURL: `https://${emu.ns}.firebaseio.com` } : FIREBASE_CONFIG;
  const fbApp = app.initializeApp(config, 'dragonmarch');
  // Session persistence: the anonymous identity lives as long as this tab (a
  // reload keeps it, so a player can rejoin a match: Phase 11), and two tabs
  // are two different players. Nothing outlives the tab.
  const fbAuth = auth.initializeAuth(fbApp, { persistence: auth.browserSessionPersistence });
  const fbDb = db.getDatabase(fbApp);
  if (emu) {
    auth.connectAuthEmulator(fbAuth, `http://${emu.auth}`, { disableWarnings: true });
    const [host, port] = emu.db.split(':');
    db.connectDatabaseEmulator(fbDb, host, Number(port));
  }
  const cred = await auth.signInAnonymously(fbAuth);
  // The server clock, so lobby ages are judged the way the rules judge them.
  let offset = 0;
  db.onValue(db.ref(fbDb, '.info/serverTimeOffset'), (s) => { offset = s.val() || 0; });
  return {
    ...db, // ref, get, set, update, remove, onValue, onChildAdded, onDisconnect, push, serverTimestamp, ...
    db: fbDb,
    uid: cred.user.uid,
    now: () => Date.now() + offset,
  };
}

// Firebase reports a rules rejection as PERMISSION_DENIED.
export const isDenied = (e) => /permission.denied/i.test(`${e?.code} ${e?.message}`);
