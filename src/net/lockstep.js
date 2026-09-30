// Phase 11 lockstep (PHASE11_SPEC.md "The tick loop"). Every peer runs the same
// match; tick T runs only once the turn for T of every human player in control
// of a camp is here. A turn is that player's commands for that tick. There is
// no network code here: turns come in through accept() and go out of commit(),
// so the same engine runs in the browser (over data channels) and in tests
// (several peers in one process).
import { Match } from '../ai/match.js';
import { FFA_MAP } from '../data/ffa.js';
import { campsFor } from './lineup.js';
import { NET } from './net-rules.js';
import { HoldBrain } from './hold.js';
import { adoptRngs, registerClass, encode, decode, hashText } from './snapshot.js';

registerClass('HoldBrain', HoldBrain);

// What a player may ask of the world: the UI's commands. (No devSpawn, and
// the team is always the sender's slot, whatever the message says.)
export const PLAYER_COMMANDS = new Set(['move', 'attackMove', 'attack', 'stop', 'gather', 'build', 'assist', 'returnCargo',
  'train', 'cancelTrain', 'cancelBuild', 'rally', 'relocate']);

// The free-for-all of a Phase 10 lobby: slot n plays camp n, the AI the rest.
export function lobbyMatch({ seed, lineup, difficulty }, PF = globalThis.PF) {
  const match = new Match({ seed, PF, ffa: { map: FFA_MAP, camps: campsFor(lineup, difficulty) } });
  return adoptRngs(match, seed);
}
export const humansOf = (lineup) => [...lineup].map((c, i) => (c === 'H' ? i + 1 : 0)).filter(Boolean);

export class Lockstep {
  // match: a freshly built match (every peer builds the same one, or restores
  // the same snapshot); humans: the human slots; me: this peer's slot.
  constructor({ match, humans, me, delay = NET.inputDelay, shared = null }) {
    this.match = match;
    this.humans = [...humans].sort((a, b) => a - b);
    this.me = me;
    this.delay = delay;
    // Shared state: identical on every peer, part of every snapshot.
    this.shared = shared || {
      control: new Map(this.humans.map((s) => [s, []])), // slot -> [{ k, held }] in tick order
      holds: new Map(), // team -> HoldBrain, while held
      sys: new Map(), // tick -> [{ kind: 'hold' | 'back', team }]
    };
    // Local state.
    this.turns = new Map(); // tick -> Map(slot -> turn)
    this.outbox = []; // this player's commands not yet in a turn
    this.sysOut = []; // this player's system commands not yet in a turn
    this.nextCommit = shared ? this.tick : delay; // turns for ticks < delay are empty for everyone
    this.executed = []; // [tick, [turns]] kept for serving catch-up (pruned by the session)
    this.onTick = null; // (tick) => void, after each tick
  }

  get world() { return this.match.world; }
  get tick() { return this.match.world.tick; }
  get done() { return !!this.match.world.result; }

  // Is `slot` a human in control at tick k (not held by the AI)?
  isHuman(slot, k) {
    const h = this.shared.control.get(slot);
    if (!h) return false;
    let human = true;
    for (const e of h) { if (e.k <= k) human = !e.held; else break; }
    return human;
  }

  held(k = this.tick) { return this.humans.filter((s) => !this.isHuman(s, k)); }
  required(k) { return k < this.delay ? [] : this.humans.filter((s) => this.isHuman(s, k)); }
  missing(k = this.tick) { const m = this.turns.get(k); return this.required(k).filter((s) => !m?.has(s)); }
  ready() { return !this.done && this.missing().length === 0; }

  // A command from this player's UI (or a scripted player).
  local(cmd) {
    if (!PLAYER_COMMANDS.has(cmd.type)) return { ok: false, reason: 'Not allowed in multiplayer' };
    const { team, ...rest } = cmd; // eslint-disable-line no-unused-vars
    this.outbox.push(rest);
    return { ok: true, pending: true };
  }

  // A system command from this player (e.g. hand a camp back).
  system(cmd) { this.sysOut.push(cmd); }

  // Close this player's turns up to tick + delay; returns them to broadcast.
  commit() {
    const out = [];
    while (this.nextCommit <= this.tick + this.delay) {
      const k = this.nextCommit++;
      if (!this.isHuman(this.me, k)) continue; // held: my turns are not used
      const turn = { t: 'turn', s: this.me, k, c: this.outbox.splice(0), y: this.sysOut.splice(0) };
      this.accept(turn);
      out.push(turn);
    }
    return out;
  }

  // A turn from anyone (this player included). False if not needed or a duplicate.
  accept(turn) {
    if (turn.k < this.tick || !this.humans.includes(turn.s)) return false;
    let m = this.turns.get(turn.k);
    if (!m) this.turns.set(turn.k, (m = new Map()));
    if (m.has(turn.s)) return false;
    m.set(turn.s, turn);
    return true;
  }

  // The agreed decision that `team` is gone: the AI holds it from tick `from`.
  hold(team, from) {
    if (from < this.tick) throw new Error(`hold of ${team} at ${from}, already at ${this.tick}`);
    if (!this.isHuman(team, from)) return false;
    this.shared.control.get(team).push({ k: from, held: true });
    this.schedule(from, { kind: 'hold', team });
    return true;
  }

  schedule(k, ev) {
    const list = this.shared.sys.get(k) || [];
    list.push(ev);
    list.sort((a, b) => (a.kind === b.kind ? a.team - b.team : a.kind < b.kind ? -1 : 1));
    this.shared.sys.set(k, list);
  }

  // Run one tick if every needed turn is here. The order is the protocol.
  step() {
    if (!this.ready()) return false;
    const T = this.tick, turns = this.turns.get(T) || new Map();
    const w = this.world;
    // 1. System events (AI hold starts and ends), sorted by kind, then camp.
    for (const ev of this.shared.sys.get(T) || []) {
      if (ev.kind === 'hold') { const hb = new HoldBrain(ev.team); this.shared.holds.set(ev.team, hb); hb.activate(w); }
      if (ev.kind === 'back') this.shared.holds.delete(ev.team);
      this.onSys?.(ev, T);
    }
    this.shared.sys.delete(T);
    // 2. Human commands, by slot; the team is always the sender's.
    const used = [];
    for (const s of this.required(T)) {
      const turn = turns.get(s);
      used.push(turn);
      for (const c of turn.c) if (PLAYER_COMMANDS.has(c.type)) w.issue({ ...c, team: s });
      for (const y of turn.y || []) this.systemCommand(y, T);
    }
    // 3. AI hold brains (they decide nothing, by design).
    for (const team of [...this.shared.holds.keys()].sort((a, b) => a - b)) this.shared.holds.get(team).update(w);
    // 4. The world, then the free-for-all AI camps, exactly as single-player.
    this.match.step();
    this.turns.delete(T);
    this.executed.push([T, used]);
    this.onTick?.(T);
    return true;
  }

  // A system command carried in a turn of tick T.
  systemCommand(y, T) {
    if (y.kind === 'back' && this.humans.includes(y.team)) {
      // Every peer has already committed its turns up to T + delay, so the
      // returning player's first turn is T + delay + 1.
      const from = T + this.delay + 1;
      if (this.isHuman(y.team, from)) return; // already back (a duplicate): nothing to do
      this.shared.control.get(y.team).push({ k: from, held: false });
      this.schedule(from, { kind: 'back', team: y.team });
    }
  }

  // ---- snapshots ---------------------------------------------------------------

  // The shared state (everything identical on every peer) as data.
  snapshot() { return { tick: this.tick, state: encode({ match: this.match, shared: this.shared }) }; }
  // The hash of the state at this tick: decisions already scheduled for later
  // ticks are left out, since peers learn of them at different moments (a
  // rejoining player learns a takeover from its snapshot before replaying the
  // ticks before it). The snapshot itself keeps them.
  stateHash() {
    const T = this.tick, sh = this.shared;
    const control = new Map([...sh.control].map(([s, h]) => [s, h.filter((e) => e.k <= T)]));
    const sys = new Map([...sh.sys].filter(([k]) => k <= T));
    return hashText(JSON.stringify(encode({ match: this.match, shared: { control, holds: sh.holds, sys } })));
  }

  static restore(snap, { humans, me, delay = NET.inputDelay, PF = globalThis.PF }) {
    const { match, shared } = decode(snap.state, { PF });
    return new Lockstep({ match, humans, me, delay, shared });
  }
}
