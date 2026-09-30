// Phase 11 test harness for the protocol: several Session peers in one process
// on a fake network with a virtual clock, per-message latency, links that can
// be cut and restored, tabs that close and come back, and a stand-in for
// Firebase presence (gone a little after a tab closes, not on a mere network
// blip). Scripted players (the AI engine) play the human camps, each only on
// its own peer while it is in control.
import { AiEngine } from '../src/ai/engine.js';
import { Lockstep, lobbyMatch, humansOf } from '../src/net/lockstep.js';
import { Session } from '../src/net/session.js';
import { NET_DEFAULTS } from '../src/net/net-rules.js';
import { quickHash } from '../src/net/snapshot.js';
import { createRng } from '../src/sim/rng.js';
import { FFA_STRATEGIES } from '../src/data/ffa.js';
import { PF } from './helpers.js';

export const TEST_NET = { ...NET_DEFAULTS, graceMs: 4000, handbackStableMs: 2000, snapshotEvery: 200, hashEvery: 50 };

export class NetSim {
  constructor({ seed = 1, lineup = 'HHHA', difficulty = 'hard', net = TEST_NET, latency = [20, 80], bots = true, presenceLagMs = 800, names } = {}) {
    this.cfg = { seed, lineup, difficulty };
    this.net = net;
    this.humans = humansOf(lineup);
    this.names = names || Object.fromEntries(this.humans.map((s) => [s, ['Ava', 'Bram', 'Cora', 'Dunn'][s - 1]]));
    this.rnd = createRng(seed * 977);
    this.latency = latency;
    this.clock = 0;
    this.queue = []; // { at, from, to, msg }
    this.cut = new Set(); // "a-b" pairs with the link down
    this.online = new Map(this.humans.map((s) => [s, true])); // reaches Firebase
    this.presence = new Map(this.humans.map((s) => [s, true])); // Firebase sees them
    this.presenceLagMs = presenceLagMs;
    this.botsOn = bots;
    this.peers = new Map(); // slot -> { session, bot, acc, fp: Map(tick -> hash), alive }
    this.log = [];
    for (const s of this.humans) this.open(s, lobbyMatch(this.cfg, PF));
  }

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

  // A tab: a new Session, playing (with a match) or rejoining (without).
  open(me, match = null) {
    const ls = match ? new Lockstep({ match, humans: this.humans, me, delay: this.net.inputDelay }) : null;
    const session = new Session({ ls, me, humans: this.humans, names: this.names, transport: this.transport(me), arbiter: this.arbiter(me), net: this.net });
    const peer = { me, session, bot: null, botWorld: null, acc: 0, fp: new Map(), alive: true, notices: [] };
    session.onNotice = (n) => { peer.notices.push(n); this.log.push(`${this.clock}ms ${me}: ${n.text}`); };
    this.peers.set(me, peer);
    for (const s of this.peers.keys()) if (s !== me && this.up(me, s)) this.peers.get(s).session.linkUp(me);
    return peer;
  }

  // The tab closes: gone at once from the network; Firebase notices a moment later.
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

  // Cut or restore links (the tabs stay alive).
  cutLinks(me, down = true) {
    for (const s of this.humans) if (s !== me) { if (down) this.cut.add(this.key(me, s)); else { this.cut.delete(this.key(me, s)); this.peers.get(me)?.session.linkUp(s); this.peers.get(s)?.session.linkUp(me); } }
  }

  timers = [];
  at(t, fn) { this.timers.push({ t, fn }); }

  // Advance the virtual clock in 10 ms frames.
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

  frame(p, dt) {
    const s = p.session;
    s.pump();
    if (s.mode !== 'play' || s.desync) return;
    p.acc = Math.min(p.acc + dt, 500);
    let budget = s.stepBudget(Math.floor(p.acc / 50));
    while (budget-- > 0) {
      if (!s.ls.step()) { p.acc = Math.min(p.acc, 50); break; }
      p.acc = Math.max(0, p.acc - 50);
      p.fp.set(s.ls.tick, quickHash(s.ls.world));
      this.botAct(p);
    }
  }

  // The scripted player acts only for a camp its peer controls.
  botAct(p) {
    const s = p.session, ls = s.ls;
    if (!this.botsOn || !ls.isHuman(p.me, ls.tick)) return;
    if (p.botWorld !== ls.world) {
      p.bot = new AiEngine(ls.world, { team: p.me, seed: 500 + p.me, strategy: FFA_STRATEGIES[p.me] || 'boom', difficulty: 'hard' });
      p.bot.issueFn = (cmd) => ls.local(cmd);
      p.botWorld = ls.world;
    }
    p.bot.update();
  }

  // Ticks every live peer has passed, with the peers that played them.
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
}
