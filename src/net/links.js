// Phase 11: the data channels under a match (PHASE11_SPEC.md "Snapshots and
// reconnection"): the lockstep module's Links with Dragonmarch's channel label
// and ICE servers.
import { Links as CoreLinks } from '../../platform/lockstep/index.js';
import { CONNECT } from './config.js';
import { iceServers } from './ice.js';

export class Links extends CoreLinks {
  constructor(opts) { super({ channel: CONNECT.channel, iceServers, ...opts }); }
}
