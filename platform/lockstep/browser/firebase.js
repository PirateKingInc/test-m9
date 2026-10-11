// Firebase, loaded on demand: the signaling backend. Used for lobby records,
// presence and the one-time WebRTC handshake (offers, answers, ICE
// candidates), never for game traffic, which goes directly between browsers.
// (From Dragonmarch Phase 10.)
//
//   const fb = await connectFirebase({
//     config,        // the project's public web config
//     sdk,           // the SDK's base URL, e.g. 'https://www.gstatic.com/firebasejs/12.19.0'
//     appName,       // a name for this Firebase app instance
//     emulator,      // optional { auth: 'host:port', db: 'host:port', projectId, ns } (tests)
//   });
//   fb.uid, fb.db, fb.now(), and the Realtime Database functions (ref, get,
//   set, update, remove, onValue, onChildAdded, onDisconnect, push, ...)
export async function connectFirebase({ config, sdk, appName = 'lockstep', emulator = null }) {
  const [app, auth, db] = await Promise.all([
    import(`${sdk}/firebase-app.js`),
    import(`${sdk}/firebase-auth.js`),
    import(`${sdk}/firebase-database.js`),
  ]);
  const cfg = emulator ? { ...config, projectId: emulator.projectId, databaseURL: `https://${emulator.ns}.firebaseio.com` } : config;
  const fbApp = app.initializeApp(cfg, appName);
  // Session persistence: the anonymous identity lives as long as this tab (a
  // reload keeps it, so a player can rejoin a match), and two tabs are two
  // different players. Nothing outlives the tab.
  const fbAuth = auth.initializeAuth(fbApp, { persistence: auth.browserSessionPersistence });
  const fbDb = db.getDatabase(fbApp);
  if (emulator) {
    auth.connectAuthEmulator(fbAuth, `http://${emulator.auth}`, { disableWarnings: true });
    const [host, port] = emulator.db.split(':');
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
