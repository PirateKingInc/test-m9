// Phase 10 verification (e), the core proof: independent browser contexts go
// through create / join / start and end up with a real, separate WebRTC peer
// connection for every pair of players, each proven by messages sent and
// received over its data channel. Nothing is mocked: the handshake goes
// through the Firebase emulator exactly as it would through the real project,
// and the connections are Chromium's own RTCPeerConnections.
import { test, expect, chromium } from '@playwright/test';
import { player, create, join, sees, EMULATOR } from './mp-helpers.js';

test.describe.configure({ timeout: 120_000 });

async function lobbyOf(browser, names) {
  const ps = [];
  for (const n of names) ps.push(await player(browser, n));
  const code = await create(ps[0]);
  for (const [i, p] of ps.entries()) if (i > 0) { await join(p, code); await sees(p, names.slice(0, i + 1)); }
  await sees(ps[0], names);
  for (const p of ps) p.uid = await p.page.evaluate(() => globalThis.__net.lobby.uid);
  return { ps, code };
}

// What one browser knows about its connections, straight from its RTCPeerConnections.
const links = (p) => p.page.evaluate(async () => {
  const out = [];
  for (const peer of globalThis.__net.mesh.peers.values()) {
    const stats = await peer.pc.getStats();
    // The pair ICE selected, as the transport reports it.
    let pair = null;
    stats.forEach((s) => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId); });
    const cand = (id) => { const c = stats.get(id); return c && { type: c.candidateType, protocol: c.protocol }; };
    out.push({
      uid: peer.uid, name: peer.name, state: peer.state, rtt: peer.rtt,
      connection: peer.pc.connectionState, ice: peer.pc.iceConnectionState,
      channel: peer.channel.readyState, label: peer.channel.label,
      hello: peer.hello?.name, local: pair && cand(pair.localCandidateId), remote: pair && cand(pair.remoteCandidateId),
      bytesSent: pair?.bytesSent, bytesReceived: pair?.bytesReceived,
    });
  }
  return out;
});

// On a failure: what each browser's connections went through.
const diagnose = (p) => p.page.evaluate(() => [...(globalThis.__net.mesh?.peers?.values() || [])].map((x) => ({
  to: x.name, state: x.state, error: x.error, signaling: x.pc?.signalingState, ice: x.pc?.iceConnectionState,
  gathering: x.pc?.iceGatheringState, connection: x.pc?.connectionState, channel: x.channel?.readyState, queued: x.queued.length,
  remote: !!x.pc?.remoteDescription, events: x.events, nonce: x.nonce, rtt: x.rtt, hello: !!x.hello, log: x.log.map((l) => `${l.dir}:${l.msg.t}`), label: x.channel?.label, id: x.channel?.id,
})));

async function connectAll(ps, code) {
  const t0 = Date.now();
  await ps[0].page.locator('#mp-start').click();
  const others = ps.length - 1;
  for (const p of ps) {
    await expect.poll(() => p.page.evaluate(() => {
      const m = globalThis.__net.mesh;
      return m?.peers ? [...m.peers.values()].map((x) => x.state).sort().join(',') : '';
    }), { timeout: 60000, message: `${p.name}'s connections` }).toBe(Array(others).fill('verified').join(',')).catch(async (e) => {
      for (const q of ps) console.log(`# DIAG ${q.name}:`, JSON.stringify(await diagnose(q)));
      throw e;
    });
  }
  const seconds = (Date.now() - t0) / 1000;
  // 1. Every browser has exactly one open connection to every other player.
  const all = {};
  for (const p of ps) {
    all[p.name] = await links(p);
    expect(all[p.name].map((l) => l.uid).sort()).toEqual(ps.filter((q) => q !== p).map((q) => q.uid).sort());
    for (const l of all[p.name]) {
      expect(l).toMatchObject({ state: 'verified', connection: 'connected', channel: 'open', label: 'dragonmarch' });
      expect(l.hello, `${p.name} got a hello from ${l.name} over the data channel`).toBe(l.name);
      expect(l.local, `${p.name}-${l.name}: ICE selected a candidate pair`).toBeTruthy();
      expect(l.bytesReceived).toBeGreaterThan(0);
    }
    await expect(p.page.locator('#mp-links-title')).toHaveText(`Connected directly to all ${others} other player${others > 1 ? 's' : ''}.`);
  }
  // 2. An independent probe on every ordered pair: the test itself sends a
  //    fresh token down A's channel to B and finds it in B's received messages.
  for (const a of ps) {
    for (const b of ps) {
      if (a === b) continue;
      const token = `${a.name}->${b.name}:${Math.random().toString(36).slice(2)}`;
      await a.page.evaluate(([uid, t]) => globalThis.__net.mesh.peers.get(uid).channel.send(JSON.stringify({ t: 'probe', token: t })), [b.uid, token]);
      await expect.poll(() => b.page.evaluate(([uid, t]) => globalThis.__net.mesh.peers.get(uid).log.some((e) => e.dir === 'in' && e.msg.token === t), [a.uid, token]), { timeout: 10000, message: token }).toBe(true);
    }
  }
  // 3. The handshake leaves the database once everyone is connected.
  await expect.poll(async () => {
    const r = await fetch(`http://${EMULATOR.db}/lobbies/${code}/signal.json?ns=${EMULATOR.ns}`, { headers: { authorization: 'Bearer owner' } });
    const tree = await r.json();
    return tree ? Object.values(tree).flatMap((from) => Object.values(from)).filter((x) => x.desc).length : 0;
  }, { timeout: 15000, message: 'offers and answers cleared' }).toBe(0);
  const pairs = ps.length * (ps.length - 1) / 2;
  console.log(`# ${ps.length} players, ${pairs} pairs, all verified in ${seconds.toFixed(1)} s: `
    + ps.map((p) => all[p.name].map((l) => `${p.name}->${l.name} ${l.local.type}/${l.local.protocol} rtt ${l.rtt} ms`).join(', ')).join('; '));
  return all;
}

test('two players: one real WebRTC connection, proven both ways over its data channel', async ({ browser }) => {
  const { ps, code } = await lobbyOf(browser, ['Ava', 'Bram']);
  await connectAll(ps, code);
  // Two humans: the other two camps are the single-player AI scripts.
  for (const p of ps) {
    await expect(p.page.locator('#mp-lineup')).toHaveAttribute('data-lineup', 'HHAA');
    await expect(p.page.locator('#mp-lineup li').nth(2)).toHaveText('Rose, south-east: Merchant Kingdom AI (Normal)');
    await expect(p.page.locator('#mp-lineup li').nth(3)).toHaveText('Jade, south-west: Stone Bastion AI (Normal)');
  }
  expect(ps.flatMap((p) => p.errors)).toEqual([]);
  for (const p of ps) await p.context.close();
});

test('three players: three pairs, the fourth camp to the AI', async ({ browser }) => {
  const { ps, code } = await lobbyOf(browser, ['Ava', 'Bram', 'Cora']);
  await connectAll(ps, code);
  for (const p of ps) await expect(p.page.locator('#mp-lineup')).toHaveAttribute('data-lineup', 'HHHA');
  expect(ps.flatMap((p) => p.errors)).toEqual([]);
  for (const p of ps) await p.context.close();
});

test('four players: a full mesh of six separate connections, every one proven', async ({ browser }) => {
  const { ps, code } = await lobbyOf(browser, ['Ava', 'Bram', 'Cora', 'Dunn']);
  const all = await connectAll(ps, code);
  expect(Object.values(all).flat()).toHaveLength(12); // 6 pairs, seen from both ends
  for (const p of ps) await expect(p.page.locator('#mp-lineup')).toHaveAttribute('data-lineup', 'HHHH');
  expect(ps.flatMap((p) => p.errors)).toEqual([]);
  for (const p of ps) await p.context.close();
});

test('separate browser processes, not just contexts: two Chromium instances connect directly', async () => {
  const browsers = [await chromium.launch(), await chromium.launch()];
  const ps = [await player(browsers[0], 'Ava'), await player(browsers[1], 'Bram')];
  const code = await create(ps[0]);
  await join(ps[1], code);
  for (const p of ps) await sees(p, ['Ava', 'Bram']);
  for (const p of ps) p.uid = await p.page.evaluate(() => globalThis.__net.lobby.uid);
  await connectAll(ps, code);
  expect(ps.flatMap((p) => p.errors)).toEqual([]);
  for (const b of browsers) await b.close();
});
