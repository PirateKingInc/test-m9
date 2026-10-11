// Presence, the arbiter against split brain. Each player in a match keeps
// <root>/<code>/presence/<uid> = true while connected to Firebase; the
// Firebase server removes it when that connection ends. A Session holds a
// slot only when its player's presence is gone, and only from a peer that is
// itself connected. (From Dragonmarch Phase 11.)
export function presence(fb, code, uid, { root = 'lobbies' } = {}) {
  const { ref, set, onValue, onDisconnect, db } = fb;
  const mine = ref(db, `${root}/${code}/presence/${uid}`);
  let online = false;
  let present = new Set();
  const stops = [];
  stops.push(onValue(ref(db, '.info/connected'), (s) => {
    online = s.val() === true;
    // (Re)announce on every (re)connection; the server removes it on the next drop.
    if (online) onDisconnect(mine).remove().then(() => set(mine, true)).catch(() => {});
  }));
  stops.push(onValue(ref(db, `${root}/${code}/presence`), (s) => { present = new Set(Object.keys(s.val() || {})); }, () => {}));
  return {
    online: () => online,
    present: (id) => present.has(id),
    stop() { for (const f of stops) f(); },
  };
}
