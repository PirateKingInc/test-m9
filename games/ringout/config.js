// Ringout's settings for the DragonMarch platform's hosted backend: the same
// Firebase project and TURN credential Worker as every game on the platform.
// The Firebase web config is public by design (it names the project; the
// security rules on the server decide what a client may do). The Worker's URL
// is public; the TURN key stays in the Worker.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCJTenrjd6oyegULX7fO1lsDHczT5CxXkQ',
  authDomain: 'dragonmarch-7e5b8.firebaseapp.com',
  databaseURL: 'https://dragonmarch-7e5b8-default-rtdb.firebaseio.com/',
  projectId: 'dragonmarch-7e5b8',
  storageBucket: 'dragonmarch-7e5b8.firebasestorage.app',
  messagingSenderId: '596451181898',
  appId: '1:596451181898:web:3d4cd0a3271fdbc2f96db3',
};
export const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/12.19.0';

export const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
export const TURN = {
  endpoint: 'https://dragonmarch-turn.piratekinginc.workers.dev/ice',
  timeoutMs: 4000, retryMs: 60000, refreshMarginMs: 3600000,
};

// The deployed lobby rules (see PLATFORM_SPEC.md, "The deployed backend's
// shape") hold up to 4 players and a three-level setting named `difficulty`,
// which Ringout uses for its pace.
export const LOBBY = { slots: 4, minPlayers: 2 };
export const CHANNEL = 'ringout';
export const APP = 'ringout';
