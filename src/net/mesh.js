// Phase 10: a direct WebRTC connection to every other human player
// (PHASE10_SPEC.md "Connection sequence"): the lockstep module's Mesh with
// Dragonmarch's channel label, timings and ICE servers (STUN, then TURN).
import { Mesh as CoreMesh } from '../../platform/lockstep/index.js';
import { CONNECT } from './config.js';
import { iceServers } from './ice.js';

export const APP = 'dragonmarch';

export class Mesh extends CoreMesh {
  constructor(lobby, onUpdate = () => {}) {
    super(lobby, onUpdate, { channel: CONNECT.channel, app: APP, timeoutMs: CONNECT.timeoutMs, helloRetryMs: CONNECT.helloRetryMs, iceServers });
  }
}
