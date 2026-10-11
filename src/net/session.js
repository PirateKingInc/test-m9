// Phase 11 protocol (PHASE11_SPEC.md "Messages", "Disconnects and AI hold",
// "Snapshots and reconnection"). Drives one peer's Lockstep over any transport:
// the browser's data channels (src/net/links.js) or a fake network in tests.
// No browser APIs here.
//
// transport: { send(slot, msg) -> bool, connected(slot) -> bool, now() -> ms }
// arbiter:   { online() -> bool, present(slot) -> bool } (Firebase presence in
//            the browser): a peer only takes a camp over while it is itself
//            online and the other player's presence is gone, so the side that
//            lost its connection freezes instead of carrying on alone.
import { NET } from './net-rules.js';
import { Lockstep } from './lockstep.js';

export class Session {
  constructor({ ls = null, me, humans, names = {}, transport, arbiter, net = NET }) {
    this.ls = ls;
    this.me = me;
    this.humans = [...humans].sort((a, b) => a - b);
    this.names = names;
    this.t = transport;
    this.arbiter = arbiter;
    this.net = net;
    const now = transport.now();
    this.peers = new Map(this.humans.filter((s) => s !== me).map((s) => [s, { heard: now, since: now, gapMax: 0, tick: -1, caughtUp: false }]));
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
    this.chatLog = [];
    this.chatTimes = [];
    this.notices = [];
    this.desync = null;
    this.mode = ls ? 'play' : 'rejoining'; // play | rejoining | waiting | held-out
    this.snapWanted = null;
    this.snapParts = new Map();
    this.caughtUpAt = null; // (rejoiner) { tick, hash, serverHash, server }
    this.onNotice = null;
    this.onChat = null;
    this.onDesync = null;
    if (ls) this.attach(ls);
  }

  attach(ls) {
    this.ls = ls;
    ls.onTick = (T) => this.afterTick(T);
    ls.onSys = (ev) => {
      if (ev.kind === 'back') this.notice(ev.slot === this.me ? 'You are back in control of your camp.' : `${this.name(ev.slot)} is back in control.`, 'back');
    };
  }

  get tick() { return this.ls?.tick ?? -1; }
  name(s) { return this.names[s] || `Camp ${s}`; }
  notice(text, kind = 'info') { const n = { text, kind, at: this.t.now() }; this.notices.push(n); this.onNotice?.(n); }

  // ---- sending --------------------------------------------------------------

  broadcast(msg) { for (const s of this.peers.keys()) this.t.send(s, msg); }

  // ---- the heartbeat of the peer: call often (every frame) ------------------

  pump() {
    const now = this.t.now();
    if (now - this.lastBeat >= this.net.heartbeatMs) {
      this.lastBeat = now;
      this.broadcast({ t: 'hb', s: this.me, k: this.tick, held: this.ls ? this.ls.held() : [], up: this.mode === 'play' });
    }
    if (this.mode === 'rejoining' || this.mode === 'waiting') return this.pumpRejoin(now);
    if (this.mode !== 'play') return;
    for (const turn of this.ls.commit()) this.broadcast(turn);
    this.pumpWaiting(now);
    this.pumpTakeover(now);
    this.pumpHandback(now);
  }

  // Waiting for a turn: after a moment, ask everyone for it (a partial
  // partition: another peer may have it).
  pumpWaiting(now) {
    const missing = this.ls.done ? [] : this.ls.missing();
    if (!missing.length) { this.waitSince = null; return; }
    this.waitSince ??= now;
    if (now - this.waitSince >= this.net.needAfterMs && now - this.lastNeed >= this.net.needAfterMs) {
      this.lastNeed = now;
      // Ask for the whole gap: up to the furthest tick any peer has reported.
      const to = Math.max(this.tick, this.maxPeerTick()) + this.ls.delay;
      for (const x of this.humans) if (x !== this.me) this.broadcast({ t: 'need', s: this.me, x, from: this.tick, to });
    }
  }

  maxPeerTick() { let m = -1; for (const [s, p] of this.peers) if (this.t.connected(s)) m = Math.max(m, p.tick); return m; }

  // How many ticks this peer may run this frame: real time normally, faster
  // when it is behind the others (after a gap or a rejoin).
  stepBudget(realtime) {
    // The others' turns (each sent up to `delay` ticks ahead of its sender's
    // tick, the moment it is committed) say where they are more freshly than
    // their heartbeats, which can be half a second old: a held, returning
    // player paced only by heartbeats could stay ~10 ticks behind for good,
    // never close enough to be handed back (Phase 12 CI).
    let latest = this.maxPeerTick();
    for (const k of this.ls.turns.keys()) latest = Math.max(latest, k - this.ls.delay);
    const behind = latest - this.tick;
    return behind > this.ls.delay * 2 ? Math.max(realtime, 60) : realtime;
  }

  // Players in control this peer believes are gone: silent for the grace
  // period, and Firebase agrees (their presence is gone, and we are online).
  gone(x) {
    const p = this.peers.get(x);
    return !!p && this.t.now() - p.heard >= this.net.graceMs && !this.arbiter.present(x) && this.arbiter.online();
  }

  // The leader collects votes: the lowest-slot player in control not gone.
  leader() {
    const T = this.tick;
    return this.humans.find((s) => this.ls.isHuman(s, T) && (s === this.me || !this.gone(s)));
  }

  pumpTakeover(now) {
    const T = this.tick;
    for (const x of this.peers.keys()) {
      if (!this.ls.isHuman(x, T) || this.voted.has(x) || !this.gone(x)) continue;
      const last = this.lastTurnOf(x);
      this.voted.add(x);
      this.frozen.set(x, last);
      const vote = { t: 'vote', s: this.me, x, last };
      const L = this.leader();
      if (L === this.me) this.onVote(vote); else this.t.send(L, vote);
    }
    void now;
  }

  // The highest tick for which this peer holds a turn of x (executed or not).
  lastTurnOf(x) {
    let last = -1;
    for (const [k, m] of this.ls.turns) if (m.has(x)) last = Math.max(last, k);
    if (last >= 0) return last;
    for (let i = this.ls.executed.length - 1; i >= 0; i--) {
      const [k, used] = this.ls.executed[i];
      if (used.some((u) => u.s === x)) return k;
    }
    return this.tick - 1;
  }

  // A player whose tab came back (after a reload) has lost its state: it
  // asks to be taken over now, so the cut between its old turns and its new
  // ones is agreed by everyone, like any takeover. No grace period: the
  // player itself says its old session is gone.
  onYield(m) {
    if (!this.ls || this.mode !== 'play' || !this.ls.isHuman(m.x, this.tick) || this.voted.has(m.x)) return;
    if (!this.yielded?.has(m.x)) { (this.yielded ||= new Set()).add(m.x); this.broadcast({ t: 'yield', s: this.me, x: m.x }); }
    const last = this.lastTurnOf(m.x);
    this.voted.add(m.x);
    this.frozen.set(m.x, last);
    const vote = { t: 'vote', s: this.me, x: m.x, last };
    const L = this.leader();
    if (L === this.me) this.onVote(vote); else this.t.send(L, vote);
  }

  onVote(v) {
    if (this.leader() !== this.me) return;
    const box = this.votes.get(v.x) || new Map();
    box.set(v.s, v.last);
    this.votes.set(v.x, box);
    // Every player in control who is not gone must have voted.
    const T = this.tick;
    const voters = this.humans.filter((s) => s !== v.x && this.ls.isHuman(s, T) && (s === this.me || !this.gone(s)));
    if (!voters.every((s) => box.has(s))) return;
    const from = Math.max(...box.values()) + 1;
    this.votes.delete(v.x);
    const d = { t: 'hold', s: this.me, x: v.x, from };
    this.broadcast(d);
    this.onHold(d);
  }

  onHold(d) {
    if (this.decisions.some((q) => q.x === d.x && q.from === d.from)) return;
    if (!this.ls.isHuman(d.x, d.from)) return;
    // The freeze (set when voting) has done its job: from here the control
    // history decides whether x's turns are needed, and after a handback they are.
    this.frozen.delete(d.x);
    // Drop any turn of x at or after the decision (it will never be used).
    for (const [k, m] of this.ls.turns) if (k >= d.from) m.delete(d.x);
    this.ls.hold(d.x, d.from);
    this.decisions.push({ x: d.x, from: d.from, at: this.tick });
    this.backSent.delete(d.x);
    this.voted.delete(d.x);
    this.notice(`${this.name(d.x)} is disconnected: the AI holds their camp.`, 'hold');
  }

  // The leader hands a camp back once its player is caught up and their link
  // has been steady for handbackStableMs.
  pumpHandback(now) {
    if (this.leader() !== this.me) return;
    for (const x of this.ls.held()) {
      const p = this.peers.get(x);
      if (!p || this.backSent.has(x) || !p.caughtUp || !this.t.connected(x)) continue;
      // Not at the live edge yet: compared with where this peer was when that
      // heartbeat arrived, so its age (up to heartbeatMs) does not count as lag.
      if (p.tick < (p.tickAt ?? this.tick) - this.ls.delay * 2) continue;
      if (now - p.since < this.net.handbackStableMs) continue;
      this.backSent.add(x);
      this.ls.system({ kind: 'back', slot: x });
    }
  }

  // ---- receiving --------------------------------------------------------------

  receive(from, msg) {
    const now = this.t.now();
    const p = this.peers.get(from);
    if (p) {
      const gap = now - p.heard;
      // A steady link: no gap longer than handbackMaxGapMs since `since`.
      if (gap > this.net.handbackMaxGapMs) p.since = now;
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
        if (this.mode === 'play' && msg.held?.includes(this.me) && this.ls.isHuman(this.me, msg.k)) this.heldOut();
        break;
      case 'turn': {
        if (this.mode !== 'play') { this.pendingTurns?.push(msg); break; }
        const f = this.frozen.get(msg.s);
        if (f != null && msg.k > f) break; // after a vote or decision about its sender
        this.ls.accept(msg);
        break;
      }
      case 'need': this.serveTurns(from, msg); break;
      case 'vote': this.onVote(msg); break;
      case 'yield': this.onYield(msg); break;
      case 'hold': if (this.mode === 'play') this.onHold(msg); else this.pendingDecisions?.push(msg); break;
      case 'hash': this.checkHash(msg); break;
      case 'snapreq': this.serveSnapshot(from); break;
      case 'snap': this.onSnapChunk(from, msg); break;
      case 'nosnap': if (this.snapWanted?.from === from) this.snapWanted.at = this.t.now() - 4000; break; // ask again in a second
      case 'chat': this.onChatMsg(msg); break;
      default: break;
    }
  }

  serveTurns(to, { x, from, to: upto }) {
    if (!this.ls) return;
    for (let k = from; k <= upto; k++) { const t = this.ls.turns.get(k)?.get(x); if (t) this.t.send(to, t); }
    for (const [k, used] of this.ls.executed) if (k >= from && k <= upto) for (const t of used) if (t.s === x) this.t.send(to, t);
  }

  // This player was taken over while its tab was alive (a partition): its
  // local world may have run ahead on its own turns, so it starts again from
  // a snapshot, like a reload.
  heldOut() {
    this.mode = 'held-out';
    this.notice('Your connection dropped for too long: the AI held your camp. Rejoining…', 'hold');
    this.onHeldOut?.();
  }

  // ---- after every tick: desync check, snapshots ----------------------------

  afterTick(T) {
    if (T % this.net.hashEvery === 0 && this.mode === 'play') {
      const h = this.ls.stateHash();
      this.hashes.set(T, h);
      for (const k of this.hashes.keys()) if (k < T - this.net.hashEvery * 20) this.hashes.delete(k);
      this.broadcast({ t: 'hash', s: this.me, k: T, h });
      const early = this.earlyHashes?.get(T);
      if (early) for (const m of early) this.checkHash(m);
    }
    if (T % this.net.snapshotEvery === 0) this.takeSnapshot();
  }

  takeSnapshot() {
    this.snapshots.push(this.ls.snapshot());
    if (this.snapshots.length > 2) this.snapshots.shift();
    const oldest = this.snapshots[0].tick;
    this.ls.executed = this.ls.executed.filter(([k]) => k >= oldest);
  }

  checkHash(m) {
    const mine = this.hashes.get(m.k);
    if (mine == null) { // not there yet: check when we are
      if (m.k > this.tick) { (this.earlyHashes ||= new Map()).set(m.k, [...(this.earlyHashes.get(m.k) || []), m]); }
      return;
    }
    if (mine !== m.h && !this.desync) {
      this.desync = { tick: m.k, with: m.s, mine, theirs: m.h };
      this.notice(`Desync detected at tick ${m.k} with ${this.name(m.s)}: the match cannot continue.`, 'error');
      this.onDesync?.(this.desync);
    }
  }

  // ---- snapshots for a rejoining player -------------------------------------------

  serveSnapshot(to) {
    // Only once the requester's camp is held (its old turns cut off): until
    // then it could still be sent turns from its old session.
    const held = this.ls && !this.ls.isHuman(to, Number.MAX_SAFE_INTEGER);
    if (this.mode !== 'play' || !this.snapshots.length || !held) { this.t.send(to, { t: 'nosnap', s: this.me }); return; }
    const snap = this.snapshots.at(-1);
    const turns = [];
    for (const [k, used] of this.ls.executed) if (k >= snap.tick) turns.push(...used);
    for (const [, m] of this.ls.turns) turns.push(...m.values());
    const payload = JSON.stringify({
      tick: snap.tick, state: snap.state, turns,
      decisions: this.decisions.filter((d) => d.from >= snap.tick).map(({ x, from }) => ({ x, from })),
      at: this.tick, hash: this.ls.stateHash(),
    });
    const n = Math.ceil(payload.length / this.net.chunkChars);
    const id = `${this.me}-${this.tick}`;
    for (let i = 0; i < n; i++) this.t.send(to, { t: 'snap', s: this.me, id, i, n, d: payload.slice(i * this.net.chunkChars, (i + 1) * this.net.chunkChars) });
  }

  // A rejoining peer: ask one connected player at a time for a snapshot.
  pumpRejoin(now) {
    const connected = [...this.peers.keys()].filter((s) => this.t.connected(s));
    if (!connected.length) { this.mode = 'waiting'; return; }
    if (this.mode === 'waiting') this.mode = 'rejoining';
    if (this.snapWanted && now - this.snapWanted.at < 5000 && this.t.connected(this.snapWanted.from)) return;
    const next = connected[(connected.indexOf(this.snapWanted?.from) + 1) % connected.length];
    this.snapWanted = { from: next, at: now };
    this.pendingTurns = [];
    this.pendingDecisions = [];
    for (const s of connected) this.t.send(s, { t: 'yield', s: this.me, x: this.me });
    this.t.send(next, { t: 'snapreq', s: this.me });
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
    const ls = Lockstep.restore({ tick: payload.tick, state: payload.state }, { humans: this.humans, me: this.me, delay: this.net.inputDelay });
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
    this.notice(`Rejoined from ${this.name(server)}'s snapshot${hashAt === payload.hash ? '' : ' (state mismatch!)'}.`, hashAt === payload.hash ? 'info' : 'error');
    if (hashAt !== payload.hash && !this.desync) { this.desync = { tick: payload.at, with: server, mine: hashAt, theirs: payload.hash }; this.onDesync?.(this.desync); }
    this.onRejoined?.(this.caughtUpAt);
  }

  // ---- chat -------------------------------------------------------------------

  chat(text) {
    const line = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, this.net.chatMax);
    if (!line) return false;
    const now = this.t.now();
    this.chatTimes = this.chatTimes.filter((t) => now - t < this.net.chatWindowMs);
    if (this.chatTimes.length >= this.net.chatBurst) return false;
    this.chatTimes.push(now);
    const m = { t: 'chat', s: this.me, id: `${this.me}-${now}-${this.chatTimes.length}`, text: line };
    this.broadcast(m);
    this.onChatMsg(m);
    return true;
  }

  onChatMsg(m) {
    if (typeof m.text !== 'string' || this.chatLog.some((c) => c.id === m.id)) return;
    const c = { id: m.id, s: m.s, name: this.name(m.s), text: m.text.slice(0, this.net.chatMax) };
    this.chatLog.push(c);
    this.onChat?.(c);
  }

  // ---- links (the transport reports them) --------------------------------------

  linkUp(slot) {
    const p = this.peers.get(slot);
    if (p) { p.since = this.t.now(); p.heard = this.t.now(); }
  }

  // What the UI shows while the game waits.
  status() {
    const now = this.t.now();
    const waiting = this.mode === 'play' && !this.ls.done ? this.ls.missing().map((s) => ({ s, name: this.name(s), silentMs: now - (this.peers.get(s)?.heard ?? now) })) : [];
    return { mode: this.mode, tick: this.tick, waiting, held: this.ls ? this.ls.held() : [], desync: this.desync };
  }
}
