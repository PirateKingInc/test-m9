// Phase 10: Firebase, loaded on demand (PHASE10_SPEC.md "The exception"), now
// through the lockstep module (platform/lockstep/browser/firebase.js). Only
// the Multiplayer screen calls connect(); single-player never loads it.
//
// Tests point the client at the Firebase Local Emulator Suite by defining
// globalThis.__DM_FIREBASE_EMULATOR__ = { auth: 'host:port', db: 'host:port',
// projectId, ns } before the page loads (a Playwright init script). The
// shipped site never defines it and talks to the real project.
import { connectFirebase } from '../../platform/lockstep/index.js';
import { FIREBASE_CONFIG, FIREBASE_SDK } from './config.js';

export { isDenied } from '../../platform/lockstep/index.js';

let connecting = null;
export function connect() {
  connecting ??= connectFirebase({ config: FIREBASE_CONFIG, sdk: FIREBASE_SDK, appName: 'dragonmarch', emulator: globalThis.__DM_FIREBASE_EMULATOR__ })
    .catch((e) => { connecting = null; throw e; });
  return connecting;
}
