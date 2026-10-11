// Phase 10 lobbies (PHASE10_SPEC.md "Data model"), now the lockstep module's
// Lobby (platform/lockstep/browser/lobby.js) with Dragonmarch's settings:
// 4 camps, 2 humans to start, and the AI difficulty in the lobby record.
// Every write is one the rules in database.rules.json allow.
import { Lobby as CoreLobby } from '../../platform/lockstep/index.js';
import { LOBBY } from './config.js';
import { CODES } from './code.js';

export { LobbyError } from '../../platform/lockstep/index.js';

export class Lobby extends CoreLobby {
  constructor(fb) { super(fb, { slots: LOBBY.slots, minPlayers: LOBBY.minHumans, ttlMs: LOBBY.ttlMs, codes: CODES }); }
  create(name, difficulty) { return super.create(name, { difficulty }); }
}
