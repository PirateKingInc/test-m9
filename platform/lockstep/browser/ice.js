// The ICE servers every peer connection uses: public STUN first, then a TURN
// relay whose short-lived credential comes from a credential endpoint (a small
// server holding the TURN provider's key; the page never sees it). Direct and
// reflexive paths are tried as before; only a pair that cannot connect any
// other way is relayed. If the endpoint cannot be reached, it is STUN-only,
// with no error. One credential serves the tab's connections until it is
// close to expiring. (From Dragonmarch Phase 12b.)
//
//   const ice = new IceServers({ stun: [{ urls: [...] }],
//     turn: { endpoint, timeoutMs: 4000, retryMs: 60000, refreshMarginMs: 3600000 } });
//   await ice.ready();         // before opening connections: wait briefly for a relay
//   ice.iceServers();          // for each RTCPeerConnection; never waits
//
// The endpoint answers a POST with { iceServers: [...], ttl } (seconds).
export class IceServers {
  constructor({ stun = [], turn = null } = {}) {
    this.stun = stun;
    this.turn = turn;
    this.reset();
  }

  reset() { this.cached = null; this.pending = null; this.retryAt = 0; } // { servers, expires, margin } (performance.now() ms)

  fresh() { return !!this.cached && this.cached.expires - performance.now() > this.cached.margin; }

  // STUN first, then whatever relay is known now. Never waits.
  iceServers() {
    if (!this.fresh()) this.refresh(); // for the next connection
    return this.fresh() ? [...this.stun, ...this.cached.servers] : [...this.stun];
  }

  // Wait (briefly) for a relay credential.
  async ready() {
    if (!this.fresh()) await this.refresh();
    return this.iceServers();
  }

  refresh() {
    if (!this.turn || performance.now() < this.retryAt) return Promise.resolve();
    return (this.pending ||= this.mint().then((r) => {
      if (r) this.cached = r;
      else this.retryAt = performance.now() + this.turn.retryMs;
    }).finally(() => { this.pending = null; }));
  }

  async mint() {
    const { endpoint, timeoutMs, refreshMarginMs } = this.turn;
    try {
      const res = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
      if (!res.ok) return null;
      const { iceServers: servers, ttl } = await res.json();
      if (!Array.isArray(servers) || !(ttl > 0)) return null;
      // Used for new connections while at least the margin (or half its life) is left.
      return { servers: servers.filter((s) => s && s.urls), expires: performance.now() + ttl * 1000, margin: Math.min(refreshMarginMs, ttl * 500) };
    } catch {
      return null; // unreachable, refused or slow: STUN only
    }
  }
}
