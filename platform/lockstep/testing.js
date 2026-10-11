// FakeNet: test a lockstep game's multiplayer in one process. Several Session
// peers on a virtual clock and network: per-message latency, links that can
// be cut and restored, tabs that close and come back (rejoining from a
// snapshot), and a stand-in for presence (gone a little after a tab closes,
// not on a mere network blip). No browser, no timers: run(ms) advances
// everything in 10 ms frames, deterministically for a given seed.
//
//   const net = new FakeNet({
//     players: [1, 2, 3],
//     newGame: () => new MyGame(seed),            // every peer builds the same game
//     restoreGame: (data) => MyGame.restore(data), // for rejoining
//     timing: { ...DEFAULT_TIMING, graceMs: 4000 },
//     onTick: (peer) => { ... },                   // e.g. a scripted player submits commands
//   });
//   net.run(30000);
//   assert.ok(net.compare().ok);                   // identical state at every tick
//   net.close(3); net.run(10000); net.reopen(3);   // a disconnect and a rejoin
import { Lockstep } from './core.js';
import { Session } from './session.js';
import { DEFAULT_TIMING } from './timing.js';
import { SeededRng } from './rng.js';

export class FakeNet {
  constructor({ players, newGame, restoreGame, timing = DEFAULT_TIMING, latency = [20, 80], seed = 1, presenceLagMs = 800,
    names = {}, onTick = null, fingerprint = (ls) => ls.stateHash(), SessionClass = Session, sessionOptions = {} }) {
    Object.assign(this, { newGame, restoreGame, timing, latency, presenceLagMs, names, onTick, fingerprint, SessionClass, sessionOptions });
    this.players = [...players].sort((a, b) => a - b);
    this.rnd = new SeededRng(seed * 977);
    this.clock = 0;
    this.queue = []; // { at, from, to, msg }
    this.cut = new Set(); // "a-b" pairs with the link down
    this.online = new Map(this.players.map((s) => [s, true])); // reaches the arbiter (Firebase)
    this.presence = new Map(this.players.map((s) => [s, true])); // the arbiter sees them
    this.peers = new Map(); // slot -> { me, session, acc, fp: Map(tick -> hash), alive, events }
    this.timers = [];
    this.log = [];
    for (const s of this.players) this.open(s, this.newLockstep(s));
  }

  newLockstep(me) { return new Lockstep({ game: this.newGame(me), players: this.players, me, delay: this.timing.inputDelay }); }

  key(a, b) { return a < b ? `${a}-${b}` : `${b}-${a}`; }
  up(a, b) { return this.peers.get(a)?.alive && this.peers.get(b)?.alive && !this.cut.has(this.key(a, b)); }

  transport(me) {
    return {
      now: () => this.clock,
      connected: (s) => this.up(me, s),
      send: (s, msg) => {
        if (!this.up(me, s)) return false;
        const [lo, hi] = this.latency;
        this.queue.push({ at: this.clock + lo + this.rnd.next() * (hi - lo), from: me, to: s, msg: JSON.stringify(msg) });
        return true;
      },
    };
  }

  arbiter(me) { return { online: () => this.online.get(me), present: (s) => this.presence.get(s) }; }

  // A tab: a new Session, playing (with a lockstep) or rejoining (without).
  open(me, lockstep = null) {
    const restore = (snap) => Lockstep.restore(snap, { restoreGame: this.restoreGame, players: this.players, me, delay: this.timing.inputDelay });
    const session = new this.SessionClass({ lockstep, restore, me, players: this.players, names: this.names, transport: this.transport(me), arbiter: this.arbiter(me), timing: this.timing, ...this.sessionOptions });
    const peer = { me, session, acc: 0, fp: new Map(), alive: true, events: [] };
    const record = (name) => (...a) => { peer.events.push({ name, args: a, at: this.clock }); this.log.push(`${this.clock}ms ${me}: ${name} ${JSON.stringify(a)}`); };
    for (const name of ['held', 'returned', 'heldOut', 'desync', 'restored', 'rejoined', 'message']) session[`on${name[0].toUpperCase()}${name.slice(1)}`] = record(name);
    this.peers.set(me, peer);
    for (const s of this.peers.keys()) if (s !== me && this.up(me, s)) this.peers.get(s).session.linkUp(me);
    return peer;
  }

  // The tab closes: gone at once from the network; presence notices a moment later.
  close(me) {
    this.peers.get(me).alive = false;
    this.queue = this.queue.filter((q) => q.to !== me && q.from !== me);
    this.at(this.clock + this.presenceLagMs, () => this.presence.set(me, false));
  }

  // The tab comes back (a reload): same slot, a new Session that rejoins.
  reopen(me) {
    this.presence.set(me, true);
    const peer = this.open(me, null);
    for (const s of this.peers.keys()) if (s !== me && this.up(me, s)) peer.session.linkUp(s);
    return peer;
  }

  // Cut or restore every link of `me` (the tab stays alive).
  cutLinks(me, down = true) {
    for (const s of this.players) {
      if (s === me) continue;
      if (down) this.cut.add(this.key(me, s));
      else { this.cut.delete(this.key(me, s)); this.peers.get(me)?.session.linkUp(s); this.peers.get(s)?.session.linkUp(me); }
    }
  }

  at(t, fn) { this.timers.push({ t, fn }); }

  // Advance the virtual clock in 10 ms frames. until(net) -> true stops early.
  run(ms, { until } = {}) {
    const end = this.clock + ms;
    while (this.clock < end) {
      this.clock += 10;
      for (const tm of this.timers.filter((x) => x.t <= this.clock)) { tm.fn(); this.timers.splice(this.timers.indexOf(tm), 1); }
      const due = this.queue.filter((q) => q.at <= this.clock);
      this.queue = this.queue.filter((q) => q.at > this.clock);
      for (const q of due) { const p = this.peers.get(q.to); if (p?.alive && this.up(q.from, q.to)) p.session.receive(q.from, JSON.parse(q.msg)); }
      for (const p of this.peers.values()) if (p.alive) this.frame(p, 10);
      if (until?.(this)) return true;
    }
    return false;
  }

  // One frame of one peer, as the browser runner does it.
  frame(p, dt) {
    const s = p.session;
    s.pump();
    if (s.mode !== 'play' || s.desync) return;
    const tickMs = this.timing.tickMs;
    p.acc = Math.min(p.acc + dt, 10 * tickMs);
    let budget = s.stepBudget(Math.floor(p.acc / tickMs));
    while (budget-- > 0) {
      if (!s.lockstep.step()) { p.acc = Math.min(p.acc, tickMs); break; }
      p.acc = Math.max(0, p.acc - tickMs);
      p.fp.set(s.lockstep.tick, this.fingerprint(s.lockstep));
      this.onTick?.(p, s.lockstep);
    }
  }

  // Every tick that two or more live, playing peers recorded: identical?
  compare({ from = 1 } = {}) {
    const live = [...this.peers.values()].filter((p) => p.alive && p.session.mode === 'play');
    const upto = Math.min(...live.map((p) => p.session.tick));
    let compared = 0;
    for (let t = from; t <= upto; t++) {
      const hs = live.filter((p) => p.fp.has(t)).map((p) => [p.me, p.fp.get(t)]);
      if (hs.length < 2) continue;
      compared++;
      if (hs.some(([, h]) => h !== hs[0][1])) return { tick: t, hashes: hs };
    }
    return { ok: true, compared, upto };
  }

  s(me) { return this.peers.get(me).session; }
  events(me, name) { return this.peers.get(me).events.filter((e) => e.name === name); }
}
