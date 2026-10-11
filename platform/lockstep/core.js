// The lockstep engine: one peer's view of a match, with no network code.
// Every peer runs the same game from the same commands at the same ticks.
// Tick T runs only once the turn for T of every player in control is here; a
// turn is one player's commands for one tick, committed `delay` ticks ahead,
// so every command runs `delay` ticks after it is given, on every peer. Turns
// come in through accept() and go out of commit(), so the same engine runs in
// a browser (over data channels) and in tests (many peers in one process).
//
// The game is anything with this shape (see README.md):
//   step(tick, inputs)  inputs: [{ slot, commands }] for the slots in control, by slot
//   hash()              a string digest of the whole state
//   serialize()         the whole state as JSON-able data
//   isOver()            optional: the match has a result
//   validate(command)   optional: a reason (string) to refuse a local command
//   hold(slot, tick)    optional: the slot's player is gone from this tick
//   release(slot, tick) optional: the slot's player is back in control
import { hashText } from './codec.js';

export const DEFAULT_DELAY = 4;

export class Lockstep {
  // game: a freshly built game (every peer builds the same one) or a restored
  // one; players: the player slots; me: this peer's slot. shared and tick are
  // given only when restoring from a snapshot.
  constructor({ game, players, me, delay = DEFAULT_DELAY, shared = null, tick = 0 }) {
    this.game = game;
    this.players = [...players].sort((a, b) => a - b);
    this.me = me;
    this.delay = delay;
    this.tick = tick;
    // Shared state: identical on every peer, part of every snapshot.
    this.shared = shared || {
      control: new Map(this.players.map((s) => [s, []])), // slot -> [{ k, held }] in tick order
      sys: new Map(), // tick -> [{ kind: 'hold' | 'back', slot }]
    };
    // Local state.
    this.turns = new Map(); // tick -> Map(slot -> turn)
    this.outbox = []; // this player's commands not yet in a turn
    this.sysOut = []; // this player's control commands not yet in a turn
    this.nextCommit = shared ? this.tick : delay; // turns for ticks < delay are empty for everyone
    this.executed = []; // [tick, [turns]] kept for serving catch-up (pruned by the session)
    this.onTick = null; // (tick) => void, after each tick
    this.onSys = null; // ({ kind, slot }, tick) => void, when a slot is held or handed back
  }

  get done() { return !!this.game.isOver?.(); }

  // Is `slot` in control of its player at tick k (not held)?
  inControl(slot, k) {
    const h = this.shared.control.get(slot);
    if (!h) return false;
    let mine = true;
    for (const e of h) { if (e.k <= k) mine = !e.held; else break; }
    return mine;
  }

  held(k = this.tick) { return this.players.filter((s) => !this.inControl(s, k)); }
  required(k) { return k < this.delay ? [] : this.players.filter((s) => this.inControl(s, k)); }
  missing(k = this.tick) { const m = this.turns.get(k); return this.required(k).filter((s) => !m?.has(s)); }
  ready() { return !this.done && this.missing().length === 0; }

  // A command from this player.
  submit(cmd) {
    const reason = this.game.validate?.(cmd);
    if (reason) return { ok: false, reason };
    this.outbox.push(cmd);
    return { ok: true, pending: true };
  }

  // A control command from this player (the session hands a slot back this way).
  system(cmd) { this.sysOut.push(cmd); }

  // Close this player's turns up to tick + delay; returns them to broadcast.
  commit() {
    const out = [];
    while (this.nextCommit <= this.tick + this.delay) {
      const k = this.nextCommit++;
      if (!this.inControl(this.me, k)) continue; // held: my turns are not used
      const turn = { t: 'turn', s: this.me, k, c: this.outbox.splice(0), y: this.sysOut.splice(0) };
      this.accept(turn);
      out.push(turn);
    }
    return out;
  }

  // A turn from anyone (this player included). False if not needed or a duplicate.
  accept(turn) {
    if (turn.k < this.tick || !this.players.includes(turn.s)) return false;
    let m = this.turns.get(turn.k);
    if (!m) this.turns.set(turn.k, (m = new Map()));
    if (m.has(turn.s)) return false;
    m.set(turn.s, turn);
    return true;
  }

  // The agreed decision that `slot`'s player is gone: held from tick `from`.
  hold(slot, from) {
    if (from < this.tick) throw new Error(`hold of ${slot} at ${from}, already at ${this.tick}`);
    if (!this.inControl(slot, from)) return false;
    this.shared.control.get(slot).push({ k: from, held: true });
    this.schedule(from, { kind: 'hold', slot });
    return true;
  }

  schedule(k, ev) {
    const list = this.shared.sys.get(k) || [];
    list.push(ev);
    list.sort((a, b) => (a.kind === b.kind ? a.slot - b.slot : a.kind < b.kind ? -1 : 1));
    this.shared.sys.set(k, list);
  }

  // Run one tick if every needed turn is here. The order is the protocol.
  step() {
    if (!this.ready()) return false;
    const T = this.tick, turns = this.turns.get(T) || new Map();
    // 1. Control changes (holds start and end), sorted by kind, then slot.
    for (const ev of this.shared.sys.get(T) || []) {
      if (ev.kind === 'hold') this.game.hold?.(ev.slot, T);
      if (ev.kind === 'back') this.game.release?.(ev.slot, T);
      this.onSys?.(ev, T);
    }
    this.shared.sys.delete(T);
    // 2. The players' turns, by slot: control commands, then the game's inputs.
    const used = [], inputs = [];
    for (const s of this.required(T)) {
      const turn = turns.get(s);
      used.push(turn);
      for (const y of turn.y || []) this.systemCommand(y, T);
      inputs.push({ slot: s, commands: turn.c });
    }
    // 3. The game.
    this.game.step(T, inputs);
    this.tick = T + 1;
    this.turns.delete(T);
    this.executed.push([T, used]);
    this.onTick?.(T);
    return true;
  }

  // A control command carried in a turn of tick T.
  systemCommand(y, T) {
    if (y.kind === 'back' && this.players.includes(y.slot)) {
      // Every peer has already committed its turns up to T + delay, so the
      // returning player's first turn is T + delay + 1.
      const from = T + this.delay + 1;
      if (this.inControl(y.slot, from)) return; // already back (a duplicate): nothing to do
      this.shared.control.get(y.slot).push({ k: from, held: false });
      this.schedule(from, { kind: 'back', slot: y.slot });
    }
  }

  // ---- snapshots ---------------------------------------------------------------

  // The shared state (everything identical on every peer) as JSON-able data,
  // a copy: a session keeps snapshots and serves them later.
  snapshot() {
    const copy = (m) => JSON.parse(JSON.stringify([...m]));
    return { tick: this.tick, state: { game: this.game.serialize(), control: copy(this.shared.control), sys: copy(this.shared.sys) } };
  }

  // The hash of the state at this tick: decisions already scheduled for later
  // ticks are left out, since peers learn of them at different moments (a
  // rejoining player learns a takeover from its snapshot before replaying the
  // ticks before it). The snapshot itself keeps them.
  stateHash() {
    const T = this.tick, sh = this.shared;
    const control = [...sh.control].map(([s, h]) => [s, h.filter((e) => e.k <= T)]);
    const sys = [...sh.sys].filter(([k]) => k <= T);
    return hashText(`${this.game.hash()}|${JSON.stringify({ tick: T, control, sys })}`);
  }

  // A Lockstep from a snapshot. restoreGame(data) is the inverse of the
  // game's serialize().
  static restore(snap, { restoreGame, players, me, delay = DEFAULT_DELAY }) {
    const { game, control, sys } = snap.state;
    const shared = { control: new Map(control), sys: new Map(sys) };
    return new this({ game: restoreGame(game), players, me, delay, shared, tick: snap.tick });
  }
}
