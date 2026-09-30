// Phase 11 test harness: several lockstep peers in one process, each with its
// own match, exchanging turns as JSON through a fake network with random
// latency (so turns arrive late and out of order). Scripted players (the AI
// engine) play the human camps; each runs only on its own peer and its
// commands reach the others only as turns, exactly like a person's.
import { AiEngine } from '../src/ai/engine.js';
import { Lockstep } from '../src/net/lockstep.js';
import { quickHash } from '../src/net/snapshot.js';
import { createRng } from '../src/sim/rng.js';

export function lockstepPeers({ make, humans, bots = {}, delay }) {
  return humans.map((me) => {
    const ls = new Lockstep({ match: make(), humans, me, delay });
    const cfg = bots[me];
    const bot = cfg ? new AiEngine(ls.world, { team: me, seed: 500 + me, ...cfg }) : null;
    if (bot) bot.issueFn = (cmd) => ls.local(cmd);
    return { me, ls, bot, fp: [], full: new Map(), commands: 0 };
  });
}

// Run every peer to `ticks` (or the result). latency: max extra rounds a
// message takes. check(peer) is called after every tick of every peer.
export function runPeers(peers, { ticks, latency = 4, seed = 1, fullEvery = 250, onRound }) {
  const rnd = createRng(seed);
  const inbox = new Map(peers.map((p) => [p.me, []]));
  let round = 0;
  const live = () => peers.some((p) => p.ls.tick < ticks && !p.ls.done);
  while (live()) {
    if (++round > ticks * 40) throw new Error(`stuck at round ${round}: ${peers.map((p) => `${p.me}@${p.ls.tick} missing ${p.ls.missing()}`).join(', ')}`);
    const order = [...peers].sort(() => rnd.next() - 0.5);
    for (const p of order) {
      const box = inbox.get(p.me);
      for (let i = box.length - 1; i >= 0; i--) if (box[i].at <= round) { p.ls.accept(JSON.parse(box[i].msg)); box.splice(i, 1); }
      for (const turn of p.ls.commit()) {
        p.commands += turn.c.length;
        const msg = JSON.stringify(turn);
        for (const q of peers) if (q !== p) inbox.get(q.me).push({ at: round + 1 + rnd.int(0, latency), msg });
      }
      if (p.ls.tick < ticks && p.ls.step()) {
        const t = p.ls.tick;
        p.fp[t] = quickHash(p.ls.world);
        if (t % fullEvery === 0) p.full.set(t, p.ls.stateHash());
        p.bot?.update();
      }
    }
    onRound?.(round);
  }
  for (const p of peers) p.full.set(p.ls.tick, p.ls.stateHash());
  return round;
}

// First tick where two peers differ, or null.
export function firstDivergence(peers) {
  const [a, ...rest] = peers;
  for (const b of rest) {
    const n = Math.max(a.fp.length, b.fp.length);
    for (let t = 1; t < n; t++) if (a.fp[t] !== b.fp[t]) return { tick: t, peers: [a.me, b.me] };
    for (const [t, h] of a.full) if (b.full.has(t) && b.full.get(t) !== h) return { tick: t, peers: [a.me, b.me], full: true };
  }
  return null;
}
