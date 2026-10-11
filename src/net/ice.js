// Phase 12b (PHASE12B_SPEC.md Part B): the ICE servers every peer connection
// uses, from the lockstep module's IceServers: the public STUN servers first,
// then the TURN relay minted by the Worker (worker/src/index.js). If the
// Worker cannot be reached, it is STUN-only, with no error.
import { IceServers } from '../../platform/lockstep/index.js';
import { ICE_SERVERS, TURN } from './config.js';

const ice = new IceServers({ stun: ICE_SERVERS, turn: TURN });
export const ICE = ice;

// STUN first, then whatever relay is known now. Never waits.
export const iceServers = () => ice.iceServers();
// Wait (briefly) for a relay credential, before opening connections.
export const ready = () => ice.ready();
// For the tests: forget the credential.
export const _reset = () => ice.reset();
