// Running a lockstep match in the browser: start it once the Mesh has verified
// every pair (or rejoin it after a reload), and drive it. A metronome in a
// worker keeps time even in a background tab; every beat pumps the Session,
// runs as many ticks as real time (or catching up) allows, and commits this
// player's turns after every tick. (From Dragonmarch Phases 11 and 12.)
//
//   const store = matchStore('mygame-match');      // for rejoining after a reload
//   const run = await startMatch({ lobby, mesh, store, ice, channel,
//     buildLockstep: ({ meta, me, players }) => new Lockstep({ game: newGame(meta.seed), players, me, delay }),
//     restore: (snap, { me, players }) => Lockstep.restore(snap, { restoreGame, players, me, delay }),
//     timing });
//   // after a reload: await rejoinMatch({ fb, saved: store.load(), store, ice, channel, restore, timing })
//   run.session; run.onFrame = (session) => draw(); run.canStep = () => screenReady;
import { Lockstep } from '../core.js';
import { Session } from '../session.js';
import { DEFAULT_TIMING } from '../timing.js';
import { installDetMath } from '../detmath.js';
import { Links } from './links.js';
import { presence } from './presence.js';
import { playersOf } from './lobby.js';

// This tab's match, in sessionStorage (it survives a reload, not the tab).
export function matchStore(key) {
  return {
    load() { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } },
    save(m) { try { sessionStorage.setItem(key, JSON.stringify(m)); } catch { /* private mode */ } },
    forget() { try { sessionStorage.removeItem(key); } catch { /* ignore */ } },
    has() { try { return !!sessionStorage.getItem(key); } catch { return false; } },
  };
}

// A metronome: a tiny worker posting a message every `ms` (a page's own
// timers are throttled or stopped in a background tab); a page timer if
// workers are unavailable. Returns a function that stops it.
export function metronome(ms, fn) {
  try {
    const src = `setInterval(() => postMessage(0), ${ms});`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = fn;
    return () => w.terminate();
  } catch { /* no workers */ }
  const t = setInterval(fn, ms);
  return () => clearInterval(t);
}

const defaultSession = (o) => new Session(o);

// Right after the Mesh verified every pair: start the match. Returns null
// (and starts nothing) unless every pair is verified with an open channel at
// this moment.
export async function startMatch({ lobby, mesh, buildLockstep, store = null, ice = null, channel, fallbackName = (s) => `Player ${s}`, ...run }) {
  const peers = [...(mesh.peers?.values() || [])];
  if (!peers.length || !peers.every((p) => p.state === 'verified' && p.channel?.readyState === 'open')) return null;
  const { meta, slot: me, fb, code } = lobby;
  const players = playersOf(meta.lineup);
  const names = {}, uids = {};
  for (const s of players) { names[s] = lobby.slots[s]?.name || fallbackName(s); uids[s] = lobby.slots[s]?.uid; }
  const { host, created, status, ...settings } = meta; // eslint-disable-line no-unused-vars
  store?.save({ code, slot: me, names, uids, meta: settings, root: lobby.opts.root });
  await lobby.keepForMatch();
  mesh.close = () => {}; // the links own the channels now
  const others = Object.fromEntries(Object.entries(uids).filter(([s]) => Number(s) !== me));
  const links = new Links({ fb, code, me, uid: fb.uid, slots: others, channel, iceServers: () => ice?.iceServers() ?? [], root: lobby.opts.root });
  for (const p of mesh.peers.values()) links.adopt(p.slot, p.pc, p.channel);
  const uninstall = installDetMath(); // before the game is built: every peer alike
  const lockstep = buildLockstep({ meta, me, players });
  return runMatch({ fb, code, me, names, uids, links, lockstep, store, uninstall, root: lobby.opts.root, ...run });
}

// After a reload: the same tab (same anonymous id) rejoins its match from a
// snapshot served by another player. Returns null if that match is over.
export async function rejoinMatch({ fb, saved, store = null, ice = null, channel, ...run }) {
  const { code, slot: me, names, uids, root = 'lobbies' } = saved;
  const status = (await fb.get(fb.ref(fb.db, `${root}/${code}/meta/status`))).val();
  if (status !== 'started') { store?.forget(); return null; }
  const others = Object.fromEntries(Object.entries(uids).filter(([s]) => Number(s) !== me));
  await ice?.ready(); // a fresh relay credential (this is a new page)
  const links = new Links({ fb, code, me, uid: fb.uid, slots: others, returning: true, channel, iceServers: () => ice?.iceServers() ?? [], root });
  const uninstall = installDetMath();
  return runMatch({ fb, code, me, names, uids, links, lockstep: null, store, uninstall, root, ...run });
}

// Drive a match: presence, the Session over the links, the metronome loop.
// restore(snapshot, { me, players }) -> Lockstep, for rejoining.
// createSession(options) -> a Session (or a subclass of it).
export function runMatch({ fb, code, me, names, uids, links, lockstep, restore, timing = DEFAULT_TIMING, store = null, uninstall = () => {},
  root = 'lobbies', createSession = defaultSession }) {
  const pres = presence(fb, code, fb.uid, { root });
  const players = Object.keys(uids).map(Number).sort((a, b) => a - b);
  const session = createSession({
    lockstep, me, players, names, timing,
    restore: (snap) => restore(snap, { me, players }),
    transport: { send: (s, m) => links.send(s, m), connected: (s) => links.connected(s), now: () => performance.now() },
    arbiter: { online: pres.online, present: (s) => pres.present(uids[s]) },
  });
  links.onMessage = (s, m) => session.receive(s, m);
  links.onUp = (s) => session.linkUp(s);
  links.start();

  const run = { session, links, presence: pres, canStep: () => true, onFrame: null, stop: null };
  const T = timing.tickMs;
  let last = performance.now(), acc = 0;
  const beat = () => {
    const now = performance.now();
    acc = Math.min(acc + (now - last) * timing.speed, 2000 * timing.speed);
    last = now;
    session.pump();
    if (session.mode === 'play' && !session.desync && run.canStep()) {
      let budget = session.stepBudget(Math.floor(acc / T));
      // This beat's pace: a player whose turns are needed runs up to the
      // turns it had committed when the beat began (a held, returning player
      // is not limited by its own turns). Handback relies on that pace.
      const ls = session.lockstep, limit = ls.nextCommit;
      while (budget-- > 0) {
        if (ls.inControl(ls.me, ls.tick) && ls.tick >= limit) { acc = Math.min(acc, T); break; }
        if (!ls.step()) { acc = Math.min(acc, T); break; }
        acc = Math.max(0, acc - T);
        // Keep this player's turns committed `delay` ticks ahead after every
        // tick, not only once a beat: a beat that runs more ticks than the
        // delay could otherwise reach a tick whose turn was still open, and a
        // command given then would run with no input delay.
        for (const turn of ls.commit()) session.broadcast(turn);
      }
      if (session.lockstep.done) store?.forget();
    }
    run.onFrame?.(session);
  };
  const stopBeat = metronome(T, beat);
  const stop = () => { stopBeat(); links.close(); pres.stop(); uninstall(); };
  run.stop = stop;
  addEventListener('pagehide', stop);
  return run;
}

