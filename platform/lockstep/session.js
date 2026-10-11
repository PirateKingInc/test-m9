// The peer protocol: drives one peer's Lockstep over any transport (data
// channels in a browser, FakeNet in tests): heartbeats, asking for late turns,
// disconnect detection and the vote that holds a slot, desync checks,
// snapshots, rejoining from a snapshot, and handing a slot back. No browser
// APIs here. (From Dragonmarch Phase 11.)
//
// transport: { send(slot, msg) -> bool, connected(slot) -> bool, now() -> ms }
// arbiter:   { online() -> bool, present(slot) -> bool }: a peer only holds a
//            slot while it is itself online and the other player's presence
//            is gone (Firebase presence in the browser), so the side that lost
//            its connection freezes instead of carrying on alone.
// restore:   (snapshot) -> Lockstep, for rejoining (Lockstep.restore with the
//            game's restore function).
//
// Events: emit(name, ...args) calls this.on<Name>(...args) if set; a subclass
// can override emit() to react first. held(slot, fromTick), returned(slot,
// tick), heldOut(), desync(info, source), restored(info) then rejoined(info)
// (restored comes before the hash comparison's desync), message(slot, msg)
// for any message type the protocol does not use.
import { DEFAULT_TIMING } from './timing.js';

// Message types the protocol uses; anything else is the game's (onMessage).
export const PROTOCOL_MESSAGES = Object.freeze(['hb', 'turn', 'need', 'vote', 'yield', 'hold', 'hash', 'snapreq', 'snap', 'nosnap']);

export class Session {
  constructor({ lockstep = null, restore = null, me, players, names = {}, transport, arbiter, timing = DEFAULT_TIMING }) {
    this.lockstep = lockstep;
    this.restore = restore;
    this.me = me;
    this.players = [...players].sort((a, b) => a - b);
    this.names = names;
    this.transport = transport;
    this.arbiter = arbiter;
    this.config = timing;
    const now = transport.now();
    this.peers = new Map(this.players.filter((s) => s !== me).map((s) => [s, { heard: now, since: now, gapMax: 0, tick: -1, caughtUp: false }]));
    this.lastBeat = -Infinity;
    this.waitSince = null; // when the current tick started waiting for a turn
    this.lastNeed = -Infinity;
    this.votes = new Map(); // x -> Map(voter -> last) (collected by the leader)
    this.voted = new Set(); // x this peer has voted about
    this.frozen = new Map(); // x -> last turn tick of x this peer accepts (after voting)
    this.decisions = []; // [{ x, from, at }] every hold decided, for catch-up
    this.snapshots = []; // [{ tick, state }], newest last (at most 2)
    this.hashes = new Map(); // tick -> hash (own, recent)
    this.backSent = new Set(); // x handed back by this peer (leader), per hold
    this.desync = null;
    this.mode = lockstep ? 'play' : 'rejoining'; // play | rejoining | waiting | held-out
    this.snapWanted = null;
    this.snapParts = new Map();
    this.caughtUpAt = null; // (rejoiner) { tick, hash, serverHash, server }
    if (lockstep) this.attach(lockstep);
  }

  attach(ls) {
    this.lockstep = ls;
    ls.onTick = (T) => this.afterTick(T);
    ls.onSys = (ev, T) => { if (ev.kind === 'back') this.emit('returned', ev.slot, T); };
  }

  // Events: the on<Name> callback, if any. Subclasses may override.
  emit(name, ...args) { return this[`on${name[0].toUpperCase()}${name.slice(1)}`]?.(...args); }

  get tick() { return this.lockstep?.tick ?? -1; }
  name(s) { return this.names[s] || `Player ${s}`; }

  // ---- sending --------------------------------------------------------------

  send(slot, msg) { return this.transport.send(slot, msg); }
  broadcast(msg) { for (const s of this.peers.keys()) this.transport.send(s, msg); }

  // ---- the heartbeat of the peer: call often (every frame) ------------------

  pump() {
    const now = this.transport.now();
    if (now - this.lastBeat >= this.config.heartbeatMs) {
      this.lastBeat = now;
      this.broadcast({ t: 'hb', s: this.me, k: this.tick, held: this.lockstep ? this.lockstep.held() : [], up: this.mode === 'play' });
    }
    if (this.mode === 'rejoining' || this.mode === 'waiting') return this.pumpRejoin(now);
    if (this.mode !== 'play') return;
    for (const turn of this.lockstep.commit()) this.broadcast(turn);
    this.pumpWaiting(now);
    this.pumpTakeover(now);
    this.pumpHandback(now);
  }

  // Waiting for a turn: after a moment, ask everyone for it (a partial
  // partition: another peer may have it).
  pumpWaiting(now) {
    const missing = this.lockstep.done ? [] : this.lockstep.missing();
    if (!missing.length) { this.waitSince = null; return; }
    this.waitSince ??= now;
    if (now - this.waitSince >= this.config.needAfterMs && now - this.lastNeed >= this.config.needAfterMs) {
      this.lastNeed = now;
      // Ask for the whole gap: up to the furthest tick any peer has reported.
      const to = Math.max(this.tick, this.maxPeerTick()) + this.lockstep.delay;
      for (const x of this.players) if (x !== this.me) this.broadcast({ t: 'need', s: this.me, x, from: this.tick, to });
    }
  }

  maxPeerTick() { let m = -1; for (const [s, p] of this.peers) if (this.transport.connected(s)) m = Math.max(m, p.tick); return m; }

  // How many ticks this peer may run this frame: real time normally, faster
  // when it is behind the others (after a gap or a rejoin).
  stepBudget(realtime) {
    // The others' turns (each sent up to `delay` ticks ahead of its sender's
    // tick, the moment it is committed) say where they are more freshly than
    // their heartbeats, which can be half a second old: a held, returning
    // player paced only by heartbeats could stay ~10 ticks behind for good,
    // never close enough to be handed back (Phase 12 CI).
    let latest = this.maxPeerTick();
    for (const k of this.lockstep.turns.keys()) latest = Math.max(latest, k - this.lockstep.delay);
    const behind = latest - this.tick;
    return behind > this.lockstep.delay * 2 ? Math.max(realtime, 60) : realtime;
  }

  // Players in control this peer believes are gone: silent for the grace
  // period, and Firebase agrees (their presence is gone, and we are online).
  gone(x) {
    const p = this.peers.get(x);
    return !!p && this.transport.now() - p.heard >= this.config.graceMs && !this.arbiter.present(x) && this.arbiter.online();
  }

  // The leader collects votes: the lowest-slot player in control not gone.
  leader() {
    const T = this.tick;
    return this.players.find((s) => this.lockstep.inControl(s, T) && (s === this.me || !this.gone(s)));
  }

  pumpTakeover(now) {
    const T = this.tick;
    for (const x of this.peers.keys()) {
      if (!this.lockstep.inControl(x, T) || this.voted.has(x) || !this.gone(x)) continue;
      const last = this.lastTurnOf(x);
      this.voted.add(x);
      this.frozen.set(x, last);
      const vote = { t: 'vote', s: this.me, x, last };
      const L = this.leader();
      if (L === this.me) this.onVote(vote); else this.transport.send(L, vote);
    }
    void now;
  }

  // The highest tick for which this peer holds a turn of x (executed or not).
  lastTurnOf(x) {
    let last = -1;
    for (const [k, m] of this.lockstep.turns) if (m.has(x)) last = Math.max(last, k);
    if (last >= 0) return last;
    for (let i = this.lockstep.executed.length - 1; i >= 0; i--) {
      const [k, used] = this.lockstep.executed[i];
      if (used.some((u) => u.s === x)) return k;
    }
    return this.tick - 1;
  }

  // A player whose tab came back (after a reload) has lost its state: it
  // asks to be taken over now, so the cut between its old turns and its new
  // ones is agreed by everyone, like any takeover. No grace period: the
  // player itself says its old session is gone.
  onYield(m) {
    if (!this.lockstep || this.mode !== 'play' || !this.lockstep.inControl(m.x, this.tick) || this.voted.has(m.x)) return;
    if (!this.yielded?.has(m.x)) { (this.yielded ||= new Set()).add(m.x); this.broadcast({ t: 'yield', s: this.me, x: m.x }); }
    const last = this.lastTurnOf(m.x);
    this.voted.add(m.x);
    this.frozen.set(m.x, last);
    const vote = { t: 'vote', s: this.me, x: m.x, last };
    const L = this.leader();
    if (L === this.me) this.onVote(vote); else this.transport.send(L, vote);
  }

  onVote(v) {
    if (this.leader() !== this.me) return;
    const box = this.votes.get(v.x) || new Map();
    box.set(v.s, v.last);
    this.votes.set(v.x, box);
    // Every player in control who is not gone must have voted.
    const T = this.tick;
    const voters = this.players.filter((s) => s !== v.x && this.lockstep.inControl(s, T) && (s === this.me || !this.gone(s)));
    if (!voters.every((s) => box.has(s))) return;
    const from = Math.max(...box.values()) + 1;
    this.votes.delete(v.x);
    const d = { t: 'hold', s: this.me, x: v.x, from };
    this.broadcast(d);
    this.onHold(d);
  }

  onHold(d) {
    if (this.decisions.some((q) => q.x === d.x && q.from === d.from)) return;
    if (!this.lockstep.inControl(d.x, d.from)) return;
    // The freeze (set when voting) has done its job: from here the control
    // history decides whether x's turns are needed, and after a handback they are.
    this.frozen.delete(d.x);
    // Drop any turn of x at or after the decision (it will never be used).
    for (const [k, m] of this.lockstep.turns) if (k >= d.from) m.delete(d.x);
    this.lockstep.hold(d.x, d.from);
    this.decisions.push({ x: d.x, from: d.from, at: this.tick });
    this.backSent.delete(d.x);
    this.voted.delete(d.x);
    this.emit('held', d.x, d.from);
  }

  // The leader hands a camp back once its player is caught up and their link
  // has been steady for handbackStableMs.
  pumpHandback(now) {
    if (this.leader() !== this.me) return;
    for (const x of this.lockstep.held()) {
      const p = this.peers.get(x);
      if (!p || this.backSent.has(x) || !p.caughtUp || !this.transport.connected(x)) continue;
      // Not at the live edge yet: compared with where this peer was when that
      // heartbeat arrived, so its age (up to heartbeatMs) does not count as lag.
      if (p.tick < (p.tickAt ?? this.tick) - this.lockstep.delay * 2) continue;
      if (now - p.since < this.config.handbackStableMs) continue;
      this.backSent.add(x);
      this.lockstep.system({ kind: 'back', slot: x });
    }
  }

  // ---- receiving --------------------------------------------------------------

  receive(from, msg) {
    const now = this.transport.now();
    const p = this.peers.get(from);
    if (p) {
      const gap = now - p.heard;
      // A steady link: no gap longer than handbackMaxGapMs since `since`.
      if (gap > this.config.handbackMaxGapMs) p.since = now;
      p.heard = now;
    }
    switch (msg.t) {
      case 'hb':
        // Caught up: playing, and aware of its own hold, which only a player
        // restored from a snapshot can be (a partitioned player that ran on
        // alone is not, and is never handed back until it rejoins).
        if (p) { p.tick = msg.k; p.tickAt = this.tick; p.caughtUp = !!msg.up && !!msg.held?.includes(from); }
        // Held at the sender's tick, while my own history says I was in
        // control then: I was taken over without knowing (a partition).
        // (A peer that simply has not reached my handback yet still lists me
        // as held at its tick, and my history agrees: nothing to do.)
        if (this.mode === 'play' && msg.held?.includes(this.me) && this.lockstep.inControl(this.me, msg.k)) this.heldOut();
        break;
      case 'turn': {
        if (this.mode !== 'play') { this.pendingTurns?.push(msg); break; }
        const f = this.frozen.get(msg.s);
        if (f != null && msg.k > f) break; // after a vote or decision about its sender
        this.lockstep.accept(msg);
        break;
      }
      case 'need': this.serveTurns(from, msg); break;
      case 'vote': this.onVote(msg); break;
      case 'yield': this.onYield(msg); break;
      case 'hold': if (this.mode === 'play') this.onHold(msg); else this.pendingDecisions?.push(msg); break;
      case 'hash': this.checkHash(msg); break;
      case 'snapreq': this.serveSnapshot(from); break;
      case 'snap': this.onSnapChunk(from, msg); break;
      case 'nosnap': if (this.snapWanted?.from === from) this.snapWanted.at = this.transport.now() - 4000; break; // ask again in a second
      default: this.emit('message', from, msg); break; // the game's own messages
    }
  }

  serveTurns(to, { x, from, to: upto }) {
    if (!this.lockstep) return;
    for (let k = from; k <= upto; k++) { const t = this.lockstep.turns.get(k)?.get(x); if (t) this.transport.send(to, t); }
    for (const [k, used] of this.lockstep.executed) if (k >= from && k <= upto) for (const t of used) if (t.s === x) this.transport.send(to, t);
  }

  // This player was taken over while its tab was alive (a partition): its
  // local world may have run ahead on its own turns, so it starts again from
  // a snapshot, like a reload.
  heldOut() {
    this.mode = 'held-out';
    this.emit('heldOut');
  }

  // ---- after every tick: desync check, snapshots ----------------------------

  afterTick(T) {
    if (T % this.config.hashEvery === 0 && this.mode === 'play') {
      const h = this.lockstep.stateHash();
      this.hashes.set(T, h);
      for (const k of this.hashes.keys()) if (k < T - this.config.hashEvery * 20) this.hashes.delete(k);
      this.broadcast({ t: 'hash', s: this.me, k: T, h });
      const early = this.earlyHashes?.get(T);
      if (early) for (const m of early) this.checkHash(m);
    }
    if (T % this.config.snapshotEvery === 0) this.takeSnapshot();
  }

  takeSnapshot() {
    this.snapshots.push(this.lockstep.snapshot());
    if (this.snapshots.length > 2) this.snapshots.shift();
    const oldest = this.snapshots[0].tick;
    this.lockstep.executed = this.lockstep.executed.filter(([k]) => k >= oldest);
  }

  checkHash(m) {
    const mine = this.hashes.get(m.k);
    if (mine == null) { // not there yet: check when we are
      if (m.k > this.tick) { (this.earlyHashes ||= new Map()).set(m.k, [...(this.earlyHashes.get(m.k) || []), m]); }
      return;
    }
    if (mine !== m.h && !this.desync) {
      this.desync = { tick: m.k, with: m.s, mine, theirs: m.h };
      this.emit('desync', this.desync, 'hash');
    }
  }

  // ---- snapshots for a rejoining player -------------------------------------------

  serveSnapshot(to) {
    // Only once the requester's camp is held (its old turns cut off): until
    // then it could still be sent turns from its old session.
    const held = this.lockstep && !this.lockstep.inControl(to, Number.MAX_SAFE_INTEGER);
    if (this.mode !== 'play' || !this.snapshots.length || !held) { this.transport.send(to, { t: 'nosnap', s: this.me }); return; }
    const snap = this.snapshots.at(-1);
    const turns = [];
    for (const [k, used] of this.lockstep.executed) if (k >= snap.tick) turns.push(...used);
    for (const [, m] of this.lockstep.turns) turns.push(...m.values());
    const payload = JSON.stringify({
      tick: snap.tick, state: snap.state, turns,
      decisions: this.decisions.filter((d) => d.from >= snap.tick).map(({ x, from }) => ({ x, from })),
      at: this.tick, hash: this.lockstep.stateHash(),
    });
    const n = Math.ceil(payload.length / this.config.chunkChars);
    const id = `${this.me}-${this.tick}`;
    for (let i = 0; i < n; i++) this.transport.send(to, { t: 'snap', s: this.me, id, i, n, d: payload.slice(i * this.config.chunkChars, (i + 1) * this.config.chunkChars) });
  }

  // A rejoining peer: ask one connected player at a time for a snapshot.
  pumpRejoin(now) {
    const connected = [...this.peers.keys()].filter((s) => this.transport.connected(s));
    if (!connected.length) { this.mode = 'waiting'; return; }
    if (this.mode === 'waiting') this.mode = 'rejoining';
    if (this.snapWanted && now - this.snapWanted.at < 5000 && this.transport.connected(this.snapWanted.from)) return;
    const next = connected[(connected.indexOf(this.snapWanted?.from) + 1) % connected.length];
    this.snapWanted = { from: next, at: now };
    this.pendingTurns = [];
    this.pendingDecisions = [];
    for (const s of connected) this.transport.send(s, { t: 'yield', s: this.me, x: this.me });
    this.transport.send(next, { t: 'snapreq', s: this.me });
  }

  onSnapChunk(from, m) {
    if (this.mode !== 'rejoining' || this.snapWanted?.from !== from) return;
    const parts = this.snapParts.get(m.id) || [];
    parts[m.i] = m.d;
    this.snapParts.set(m.id, parts);
    if (parts.filter((x) => x != null).length < m.n) return;
    this.snapParts.clear();
    this.restoreFrom(from, JSON.parse(parts.join('')));
  }

  restoreFrom(server, payload) {
    const ls = this.restore({ tick: payload.tick, state: payload.state });
    for (const d of payload.decisions) ls.hold(d.x, d.from);
    // Every turn of mine before my hold came from my old session: never send another.
    const lastHold = [...(ls.shared.control.get(this.me) || [])].reverse().find((e) => e.held);
    if (lastHold) ls.nextCommit = Math.max(ls.nextCommit, lastHold.k);
    for (const t of [...payload.turns, ...(this.pendingTurns || [])]) ls.accept(t);
    this.attach(ls);
    this.mode = 'play';
    // Fast-forward to the server's tick and compare the whole state there.
    let hashAt = null;
    while (ls.tick < payload.at && ls.step()) { /* catch up */ }
    if (ls.tick === payload.at) hashAt = ls.stateHash();
    for (const d of this.pendingDecisions || []) this.onHold(d);
    this.pendingTurns = null;
    this.pendingDecisions = null;
    this.decisions = payload.decisions.map((d) => ({ ...d, at: payload.tick }));
    this.snapshots = [{ tick: payload.tick, state: payload.state }];
    this.caughtUpAt = { tick: payload.at, hash: hashAt, serverHash: payload.hash, server, match: hashAt === payload.hash };
    this.emit('restored', this.caughtUpAt);
    if (hashAt !== payload.hash && !this.desync) { this.desync = { tick: payload.at, with: server, mine: hashAt, theirs: payload.hash }; this.emit('desync', this.desync, 'rejoin'); }
    this.emit('rejoined', this.caughtUpAt);
  }

  // ---- links (the transport reports them) --------------------------------------

  linkUp(slot) {
    const p = this.peers.get(slot);
    if (p) { p.since = this.transport.now(); p.heard = this.transport.now(); }
  }

  // What the UI shows while the game waits.
  status() {
    const now = this.transport.now();
    const waiting = this.mode === 'play' && !this.lockstep.done ? this.lockstep.missing().map((s) => ({ s, name: this.name(s), silentMs: now - (this.peers.get(s)?.heard ?? now) })) : [];
    return { mode: this.mode, tick: this.tick, waiting, held: this.lockstep ? this.lockstep.held() : [], desync: this.desync };
  }
}
