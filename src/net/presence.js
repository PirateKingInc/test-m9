// Phase 11: Firebase presence, the arbiter against split brain (PHASE11_SPEC.md
// "Disconnects and AI hold"). Each player in a match keeps
// lobbies/<code>/presence/<uid> = true while connected to Firebase; the
// Firebase server removes it when that connection ends. A camp is only taken
// over when its player's presence is gone, and only by a peer that is itself
// connected to Firebase.
export function presence(fb, code, uid) {
  const { ref, set, onValue, onDisconnect, db } = fb;
  const mine = ref(db, `lobbies/${code}/presence/${uid}`);
  let online = false;
  let present = new Set();
  const stops = [];
  stops.push(onValue(ref(db, '.info/connected'), (s) => {
    online = s.val() === true;
    // (Re)announce on every (re)connection; the server removes it on the next drop.
    if (online) onDisconnect(mine).remove().then(() => set(mine, true)).catch(() => {});
  }));
  stops.push(onValue(ref(db, `lobbies/${code}/presence`), (s) => { present = new Set(Object.keys(s.val() || {})); }, () => {}));
  return {
    online: () => online,
    present: (id) => present.has(id),
    stop() { for (const f of stops) f(); },
  };
}
