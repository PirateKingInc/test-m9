// Phase 10: a direct WebRTC connection to every other human player
// (PHASE10_SPEC.md "Connection sequence"). Firebase carries only the one-time
// handshake: an offer, an answer and ICE candidates per pair, through
// lobbies/<code>/signal/<to>/<from>. Once a data channel is open, both sides
// prove it with a test message; no game state is sent in this phase.
import { CONNECT } from './config.js';
import { iceServers } from './ice.js';

export class Mesh {
  constructor(lobby, onUpdate = () => {}) {
    this.lobby = lobby;
    this.fb = lobby.fb;
    this.onUpdate = onUpdate;
    this.peers = new Map(); // uid -> peer
    this.stops = [];
    this.timers = [];
    this.closed = false;
  }

  get me() { return this.lobby.uid; }
  ref(path) { return this.lobby.ref(`signal/${path}`); }

  start() {
    const { lineup } = this.lobby.meta;
    const { onValue, onChildAdded } = this.fb;
    [...lineup].forEach((c, i) => {
      const slot = i + 1, p = this.lobby.slots[slot];
      if (c !== 'H' || slot === this.lobby.slot) return;
      if (!p) return; // left between the start and now: nobody to connect to
      const peer = { uid: p.uid, name: p.name, slot, state: 'waiting', pc: null, channel: null, queued: [], log: [], rtt: null, events: [] };
      this.peers.set(p.uid, peer);
      // Listen before offering: the other side's description and candidates.
      this.stops.push(onValue(this.ref(`${this.me}/${p.uid}/desc`), (s) => { if (s.val()) this.description(peer, s.val()).catch((e) => this.fail(peer, e)); }));
      this.stops.push(onChildAdded(this.ref(`${this.me}/${p.uid}/ice`), (s) => this.candidate(peer, s.val())));
      this.timers.push(setTimeout(() => { if (peer.state !== 'verified') this.fail(peer, new Error('timed out')); }, CONNECT.timeoutMs));
      // One offerer per pair: the player in the lower slot.
      if (this.lobby.slot < slot) this.offer(peer).catch((e) => this.fail(peer, e));
    });
    this.onUpdate();
  }

  connection(peer) {
    if (peer.pc) return peer.pc;
    const pc = peer.pc = new RTCPeerConnection({ iceServers: iceServers() });
    pc.onicecandidate = ({ candidate: c }) => {
      if (!c || !c.candidate || this.closed) return; // null: gathering finished
      const rec = { c: c.candidate };
      if (c.sdpMid != null) rec.m = c.sdpMid;
      if (c.sdpMLineIndex != null) rec.i = c.sdpMLineIndex;
      this.fb.push(this.ref(`${peer.uid}/${this.me}/ice`), rec).catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.fail(peer, new Error('ICE failed'));
      this.onUpdate();
    };
    pc.ondatachannel = (e) => this.channel(peer, e.channel);
    return pc;
  }

  async offer(peer) {
    const pc = this.connection(peer);
    this.channel(peer, pc.createDataChannel(CONNECT.channel, { ordered: true }));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.fb.set(this.ref(`${peer.uid}/${this.me}/desc`), { type: 'offer', sdp: offer.sdp });
    this.advance(peer, 'connecting');
  }

  async description(peer, d) {
    peer.events.push(`desc ${d.type} (${peer.pc?.signalingState ?? 'no pc'})`);
    if (d.type === 'offer' && this.lobby.slot > peer.slot && !peer.pc?.remoteDescription) {
      const pc = this.connection(peer);
      await pc.setRemoteDescription(d);
      await this.flush(peer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.fb.set(this.ref(`${peer.uid}/${this.me}/desc`), { type: 'answer', sdp: answer.sdp });
      this.advance(peer, 'connecting');
    } else if (d.type === 'answer' && peer.pc?.signalingState === 'have-local-offer') {
      await peer.pc.setRemoteDescription(d);
      await this.flush(peer);
    }
  }

  // Candidates can arrive before the description they belong to: queue them.
  candidate(peer, c) {
    if (!c) return;
    peer.events.push(`ice ${peer.pc?.remoteDescription ? 'add' : 'queue'}`);
    const init = { candidate: c.c, sdpMid: c.m ?? null, sdpMLineIndex: c.i ?? null };
    if (peer.pc?.remoteDescription) peer.pc.addIceCandidate(init).catch(() => {});
    else peer.queued.push(init);
  }

  async flush(peer) {
    for (const init of peer.queued.splice(0)) await peer.pc.addIceCandidate(init).catch(() => {});
  }

  // The proof: each side sends hello with a nonce; the other acks it.
  channel(peer, ch) {
    peer.channel = ch;
    const hello = () => {
      peer.sentAt = performance.now();
      this.send(peer, { t: 'hello', name: this.lobby.slots[this.lobby.slot]?.name, nonce: peer.nonce });
    };
    const opened = () => {
      if (peer.nonce) return; // once
      peer.nonce = crypto.getRandomValues(new Uint32Array(2)).join('-');
      hello();
      // Resend until acked: a message sent the moment one side's channel
      // opens can be dropped before the other side's channel is open (seen
      // in about 1 of 30 pairs in Chromium). Acks are idempotent.
      peer.resend = setInterval(() => { if (peer.rtt == null && ch.readyState === 'open') hello(); else clearInterval(peer.resend); }, CONNECT.helloRetryMs);
      this.advance(peer, 'open');
    };
    ch.onopen = opened;
    // The answerer's channel can arrive (ondatachannel) already open, and then
    // its open event never fires.
    if (ch.readyState === 'open') opened();
    ch.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      peer.log.push({ dir: 'in', msg });
      if (msg.t === 'hello') { peer.hello = msg; this.send(peer, { t: 'ack', nonce: msg.nonce }); }
      if (msg.t === 'ack' && msg.nonce === peer.nonce && peer.rtt == null) peer.rtt = Math.round(performance.now() - peer.sentAt);
      if (peer.hello && peer.rtt != null) this.advance(peer, 'verified');
    };
  }

  send(peer, msg) {
    peer.log.push({ dir: 'out', msg });
    peer.channel.send(JSON.stringify(msg));
  }

  advance(peer, state) {
    const order = ['waiting', 'connecting', 'open', 'verified'];
    if (peer.state === 'failed' || order.indexOf(state) <= order.indexOf(peer.state)) return;
    peer.state = state;
    this.settled();
    this.onUpdate();
  }

  fail(peer, err) {
    if (peer.state === 'verified' || peer.state === 'failed' || this.closed) return;
    peer.state = 'failed';
    clearInterval(peer.resend);
    peer.error = String(err?.message || err);
    this.settled();
    this.onUpdate();
  }

  // Every pair verified or failed: the handshake leaves the database (it holds
  // IP addresses in the candidates).
  settled() {
    if (this.cleared || [...this.peers.values()].some((p) => p.state !== 'verified' && p.state !== 'failed')) return;
    this.cleared = true;
    for (const t of this.timers.splice(0)) clearTimeout(t);
    for (const stop of this.stops.splice(0)) stop();
    this.fb.remove(this.ref(this.me)).catch(() => {});
  }

  close() {
    this.closed = true;
    for (const t of this.timers.splice(0)) clearTimeout(t);
    for (const stop of this.stops.splice(0)) stop();
    for (const p of this.peers.values()) { clearInterval(p.resend); try { p.pc?.close(); } catch { /* closed */ } }
  }
}
