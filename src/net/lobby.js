// Phase 10 lobbies (PHASE10_SPEC.md "Data model"): create, join, watch,
// leave and start. Every write here is one the rules in database.rules.json
// allow; anything else is refused by the server, not just by this code.
import { LOBBY } from './config.js';
import { newCode } from './code.js';
import { isDenied } from './firebase.js';
import { lineupOf, humansIn } from './lineup.js';

// A problem to show the player as is.
export class LobbyError extends Error { name = 'LobbyError'; }

export class Lobby {
  constructor(fb) {
    this.fb = fb;
    this.code = null;
    this.slot = null;
    this.meta = null;
    this.slots = {};
    this.stops = [];
    this.listeners = new Set();
  }

  get uid() { return this.fb.uid; }
  get isHost() { return this.slot === 1; }
  ref(path = '') { return this.fb.ref(this.fb.db, `lobbies/${this.code}${path ? `/${path}` : ''}`); }
  expired(meta) { return meta.created < this.fb.now() - LOBBY.ttlMs; }

  // Create a lobby with a fresh code; this player is its host, in slot 1.
  async create(name, difficulty) {
    const { update, serverTimestamp: ts } = this.fb;
    for (let attempt = 0; attempt < 5; attempt++) {
      this.code = newCode();
      try {
        await update(this.ref(), {
          meta: { host: this.uid, created: ts(), status: 'open', difficulty },
          'slots/1': { uid: this.uid, name, joined: ts() },
          [`members/${this.uid}`]: '1',
        });
      } catch (e) {
        if (!isDenied(e)) throw e;
        await this.sweep(); // the code is taken; if by an expired lobby, clean it up
        continue;
      }
      this.slot = 1;
      // Layer 1 of lobby expiry: when the host's connection ends for any
      // reason, the server removes the whole lobby.
      await this.fb.onDisconnect(this.ref()).remove();
      this.watch();
      return this.code;
    }
    this.code = null;
    throw new LobbyError('Could not create a lobby. Try again.');
  }

  // Join by code: the lowest free slot of an open, unexpired lobby.
  async join(code, name) {
    const { get, update, serverTimestamp: ts } = this.fb;
    this.code = code;
    try {
      const meta = (await get(this.ref('meta'))).val();
      if (!meta) throw new LobbyError('No lobby has that code. Check it with the host.');
      if (this.expired(meta)) { await this.sweep(); throw new LobbyError('That lobby has expired. Ask the host for a new code.'); }
      if (meta.status !== 'open') throw new LobbyError('That match has already started.');
      for (let slot = 2; slot <= LOBBY.slots; slot++) {
        const taken = (await get(this.ref(`slots/${slot}`))).exists();
        if (taken) continue;
        try {
          await update(this.ref(), { [`slots/${slot}`]: { uid: this.uid, name, joined: ts() }, [`members/${this.uid}`]: String(slot) });
        } catch (e) {
          if (isDenied(e)) continue; // someone took it a moment before us: try the next one
          throw e;
        }
        this.slot = slot;
        // If this player's connection ends, the server frees the slot. (Only
        // the slot: the rules check disconnect writes one path at a time when
        // they are registered, and the member entry may only go once the slot
        // has. The leftover write-only entry is harmless: the anonymous id
        // dies with the tab.)
        await this.fb.onDisconnect(this.ref(`slots/${slot}`)).remove();
        this.watch();
        return slot;
      }
      throw new LobbyError(`That lobby is full (${LOBBY.slots} players).`);
    } catch (e) {
      this.code = null;
      if (e instanceof LobbyError) throw e;
      if (isDenied(e)) throw new LobbyError('That lobby is not taking players.');
      throw e;
    }
  }

  // Live updates of the lobby record: this.meta, this.slots.
  watch() {
    const { onValue } = this.fb;
    const emit = () => { for (const f of this.listeners) f(this); };
    this.stops.push(onValue(this.ref('meta'), (s) => {
      this.meta = s.val();
      if (!this.meta && this.slot) this.closed = this.closed || 'The host closed the lobby.';
      emit();
    }, () => { this.closed = this.closed || 'The lobby is gone.'; emit(); }));
    this.stops.push(onValue(this.ref('slots'), (s) => { this.slots = s.val() || {}; emit(); }, () => {}));
  }

  onChange(f) { this.listeners.add(f); return () => this.listeners.delete(f); }

  players() {
    return Object.entries(this.slots).map(([slot, p]) => ({ slot: Number(slot), ...p })).sort((a, b) => a.slot - b.slot);
  }

  canStart() { return this.isHost && this.meta?.status === 'open' && humansIn(lineupOf(this.slots)) >= LOBBY.minHumans; }

  // The host starts: a seed and the lineup, which fixes who plays each camp.
  async start() {
    if (!this.canStart()) throw new LobbyError(`At least ${LOBBY.minHumans} players are needed to start.`);
    const seed = 1 + (crypto.getRandomValues(new Uint32Array(1))[0] % 999999);
    try {
      await this.fb.update(this.ref('meta'), { status: 'started', seed, lineup: lineupOf(this.slots) });
    } catch (e) {
      if (isDenied(e)) throw new LobbyError('The lobby changed; try starting again.');
      throw e;
    }
  }

  // Once the match starts the lobby must outlive any one player's connection
  // (Phase 11: reconnection signals through it, and names come from its
  // slots), so the Phase 10 disconnect handlers are cancelled. It then ends
  // by the rules' age limit.
  async keepForMatch() {
    try { await this.fb.onDisconnect(this.ref(this.isHost ? '' : `slots/${this.slot}`)).cancel(); } catch { /* already gone */ }
  }

  // Leave on purpose: the host closes the lobby, a guest frees its slot.
  async leave() {
    if (!this.code) return;
    const { onDisconnect, remove, update } = this.fb;
    this.unwatch();
    try {
      await onDisconnect(this.ref(this.isHost ? '' : `slots/${this.slot}`)).cancel();
      if (this.isHost) await remove(this.ref());
      else if (this.slot) await update(this.ref(), { [`slots/${this.slot}`]: null, [`members/${this.uid}`]: null });
    } catch { /* already gone */ }
    this.code = null;
    this.slot = null;
  }

  unwatch() { for (const stop of this.stops.splice(0)) stop(); }

  // Layer 3 of lobby expiry: an expired lobby may be deleted by anyone.
  async sweep() {
    try {
      const meta = (await this.fb.get(this.ref('meta'))).val();
      if (meta && this.expired(meta)) await this.fb.remove(this.ref());
    } catch { /* not ours to judge */ }
  }
}
