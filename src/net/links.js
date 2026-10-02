// Phase 11: the data channels under a match (PHASE11_SPEC.md "Snapshots and
// reconnection"). It adopts the channels Phase 10's Mesh opened and verified,
// unchanged, and reopens a link that dies, through the same signaling paths
// (lobbies/<code>/signal/<to>/<from>) and the same ICE servers (STUN, then
// Phase 12b's TURN relay). Firebase
// carries only that handshake; everything else goes over the channels.
//
// Who reopens: a player coming back (after a reload) offers to everyone; when
// both tabs are alive and a link dies, the player in the higher slot offers.
// If two offers cross, the higher slot yields and answers the other one.
import { CONNECT } from './config.js';
import { iceServers } from './ice.js';

const REOFFER_AFTER_MS = 3000; // a link down this long gets a new offer
const REOFFER_EVERY_MS = 10000; // and another every so often while still down

export class Links {
  // slots: { slot: uid } for the other human players.
  constructor({ fb, code, me, uid, slots, returning = false, onMessage, onUp }) {
    Object.assign(this, { fb, code, me, uid, slots, returning, onMessage, onUp });
    this.links = new Map(Object.keys(slots).map((s) => [Number(s), { pc: null, ch: null, up: false, downSince: performance.now(), lastOffer: -Infinity, lastRemote: null, queued: [] }]));
    this.stops = [];
    this.timer = null;
  }

  ref(path) { return this.fb.ref(this.fb.db, `lobbies/${this.code}/signal/${path}`); }

  // Take over a channel Phase 10's Mesh opened and verified.
  adopt(slot, pc, ch) {
    const l = this.links.get(slot);
    if (!l || !pc || !ch) return false; // nothing to adopt: the link is down, and reopened like any other
    Object.assign(l, { pc, ch });
    // The offer that opened it, so the listener does not take it for a new one.
    if (pc.remoteDescription?.type === 'offer') l.lastRemote = pc.remoteDescription.sdp;
    this.wire(slot, ch);
    if (ch.readyState === 'open') this.markUp(slot);
    return true;
  }

  wire(slot, ch) {
    const l = this.links.get(slot);
    const prev = ch.onmessage; // Phase 10's handshake log keeps working
    ch.onmessage = (e) => { prev?.(e); let m; try { m = JSON.parse(e.data); } catch { return; } this.onMessage(slot, m); };
    ch.onopen = () => { if (l.ch === ch) this.markUp(slot); };
    ch.onclose = () => { if (l.ch === ch) this.markDown(slot); };
  }

  markUp(slot) { const l = this.links.get(slot); if (!l.up) { l.up = true; this.onUp?.(slot); } }
  markDown(slot) { const l = this.links.get(slot); if (l.up) { l.up = false; l.downSince = performance.now(); } }

  connected(slot) { const l = this.links.get(slot); return !!l && l.up && l.ch?.readyState === 'open'; }

  send(slot, msg) {
    if (!this.connected(slot)) return false;
    try { this.links.get(slot).ch.send(JSON.stringify(msg)); return true; } catch { this.markDown(slot); return false; }
  }

  // Listen for (re)offers and candidates from every other player, for the
  // whole match; and watch the links.
  async start() {
    const { onValue, onChildAdded, remove } = this.fb;
    if (this.returning) await remove(this.ref(this.uid)).catch(() => {}); // stale handshakes from before the reload
    for (const [slot] of this.links) {
      const peer = this.slots[slot];
      this.stops.push(onValue(this.ref(`${this.uid}/${peer}/desc`), (s) => { const d = s.val(); if (d) this.onDesc(slot, d).catch(() => {}); }));
      this.stops.push(onChildAdded(this.ref(`${this.uid}/${peer}/ice`), (s) => this.onIce(slot, s.val())));
    }
    if (this.returning) for (const [slot] of this.links) this.offer(slot).catch(() => {});
    this.timer = setInterval(() => this.watch(), 1000);
  }

  watch() {
    const now = performance.now();
    for (const [slot, l] of this.links) {
      if (this.connected(slot)) continue;
      if (l.up && l.ch?.readyState !== 'open') this.markDown(slot);
      const mine = this.returning || this.me > slot; // who offers
      if (mine && now - l.downSince >= REOFFER_AFTER_MS && now - l.lastOffer >= REOFFER_EVERY_MS) this.offer(slot).catch(() => {});
    }
  }

  fresh(slot) {
    const l = this.links.get(slot);
    try { l.pc?.close(); } catch { /* closed */ }
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    l.pc = pc; l.ch = null; l.queued = []; l.up = false;
    const peer = this.slots[slot];
    pc.onicecandidate = ({ candidate: c }) => {
      if (!c || !c.candidate || l.pc !== pc) return;
      const rec = { c: c.candidate };
      if (c.sdpMid != null) rec.m = c.sdpMid;
      if (c.sdpMLineIndex != null) rec.i = c.sdpMLineIndex;
      this.fb.push(this.ref(`${peer}/${this.uid}/ice`), rec).catch(() => {});
    };
    pc.ondatachannel = (e) => { if (l.pc === pc) { l.ch = e.channel; this.wire(slot, e.channel); if (e.channel.readyState === 'open') this.markUp(slot); } };
    pc.onconnectionstatechange = () => { if (l.pc === pc && pc.connectionState === 'failed') this.markDown(slot); };
    return pc;
  }

  async offer(slot) {
    const l = this.links.get(slot), peer = this.slots[slot];
    l.lastOffer = performance.now();
    await this.fb.remove(this.ref(`${peer}/${this.uid}`)).catch(() => {}); // my old handshake to them
    const pc = this.fresh(slot);
    const ch = pc.createDataChannel(CONNECT.channel, { ordered: true });
    l.ch = ch;
    this.wire(slot, ch);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    l.pending = true;
    await this.fb.set(this.ref(`${peer}/${this.uid}/desc`), { type: 'offer', sdp: offer.sdp });
  }

  async onDesc(slot, d) {
    const l = this.links.get(slot), peer = this.slots[slot];
    if (d.sdp === l.lastRemote) return; // seen
    if (d.type === 'offer') {
      // Crossing offers: the higher slot yields; the lower keeps its own.
      if (l.pending && l.pc?.signalingState === 'have-local-offer' && this.me < slot) return;
      l.lastRemote = d.sdp;
      l.pending = false;
      const pc = this.fresh(slot);
      await pc.setRemoteDescription(d);
      for (const c of l.queued.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      await this.fb.remove(this.ref(`${peer}/${this.uid}`)).catch(() => {}); // my old handshake to them
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.fb.set(this.ref(`${peer}/${this.uid}/desc`), { type: 'answer', sdp: answer.sdp });
    } else if (d.type === 'answer' && l.pc?.signalingState === 'have-local-offer') {
      l.lastRemote = d.sdp;
      l.pending = false;
      await l.pc.setRemoteDescription(d);
      for (const c of l.queued.splice(0)) await l.pc.addIceCandidate(c).catch(() => {});
    }
  }

  onIce(slot, c) {
    if (!c) return;
    const l = this.links.get(slot);
    const init = { candidate: c.c, sdpMid: c.m ?? null, sdpMLineIndex: c.i ?? null };
    if (l.pc?.remoteDescription) l.pc.addIceCandidate(init).catch(() => {});
    else l.queued.push(init);
  }

  close() {
    clearInterval(this.timer);
    for (const f of this.stops.splice(0)) f();
    for (const l of this.links.values()) { try { l.pc?.close(); } catch { /* closed */ } }
  }
}
