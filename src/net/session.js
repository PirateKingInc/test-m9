// Phase 11 protocol (PHASE11_SPEC.md "Messages", "Disconnects and AI hold",
// "Snapshots and reconnection"), now the lockstep module's Session
// (platform/lockstep/session.js, Platform Milestone 1). This subclass is what
// is Dragonmarch's: the notices players see (a held camp is played by the
// AI), the in-match chat (an app message of its own), and the Phase 11 names
// (ls, humans, net, t) the game and its tests use.
//
// transport: { send(slot, msg) -> bool, connected(slot) -> bool, now() -> ms }
// arbiter:   { online() -> bool, present(slot) -> bool } (Firebase presence)
import { Session as CoreSession } from '../../platform/lockstep/index.js';
import { NET } from './net-rules.js';
import { Lockstep } from './lockstep.js';

export class Session extends CoreSession {
  constructor({ ls = null, me, humans, names = {}, transport, arbiter, net = NET }) {
    super({
      lockstep: ls, me, players: humans, names, transport, arbiter, timing: net,
      restore: (snap) => Lockstep.restore(snap, { humans, me, delay: net.inputDelay }),
    });
    this.chatLog = [];
    this.chatTimes = [];
    this.notices = [];
    this.onNotice = null;
    this.onChat = null;
  }

  get ls() { return this.lockstep; }
  get humans() { return this.players; }
  get net() { return this.config; }
  get t() { return this.transport; }
  name(s) { return this.names[s] || `Camp ${s}`; }
  notice(text, kind = 'info') { const n = { text, kind, at: this.transport.now() }; this.notices.push(n); this.onNotice?.(n); }

  // What the protocol reports, as the notices a player sees (then the callbacks).
  emit(event, ...a) {
    switch (event) {
      case 'held': this.notice(`${this.name(a[0])} is disconnected: the AI holds their camp.`, 'hold'); break;
      case 'returned': this.notice(a[0] === this.me ? 'You are back in control of your camp.' : `${this.name(a[0])} is back in control.`, 'back'); break;
      case 'heldOut': this.notice('Your connection dropped for too long: the AI held your camp. Rejoining…', 'hold'); break;
      case 'desync': if (a[1] === 'hash') this.notice(`Desync detected at tick ${a[0].tick} with ${this.name(a[0].with)}: the match cannot continue.`, 'error'); break;
      case 'restored': this.notice(`Rejoined from ${this.name(a[0].server)}'s snapshot${a[0].match ? '' : ' (state mismatch!)'}.`, a[0].match ? 'info' : 'error'); break;
      case 'message': if (a[1]?.t === 'chat') { this.onChatMsg(a[1]); return undefined; } break;
      default: break;
    }
    return super.emit(event, ...a);
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
}
