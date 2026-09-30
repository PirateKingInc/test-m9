#!/usr/bin/env node
// Phase 9 free-for-all playthroughs (PHASE9_SPEC.md "Results"): full matches
// with every Phase 9 rule on. Camp 1 is a scripted Boom player that moves its
// first finished building at 5:00; the AI camps play FFA_STRATEGIES at Hard.
// Reports each match's result, falls (with or without a conqueror), auto-defend
// engagements and walks back per camp, and how the move went.
//
//   node tools/ffa-playthrough.mjs 2 3 5 7 11 13
import { createRequire } from 'node:module';
import { Match } from '../src/ai/match.js';
import { readonly } from '../src/ai/readonly.js';
import { FFA_MAP, FFA_STRATEGIES } from '../src/data/ffa.js';
import { canRelocate } from '../src/sim/construction.js';

const PF = createRequire(import.meta.url)('pathfinding/visual/lib/pathfinding-browser.min.js');
const seeds = process.argv.slice(2).map(Number);
for (const seed of seeds) {
  const camps = Object.fromEntries(Object.entries(FFA_STRATEGIES).map(([t, s]) => [t, { strategy: s, difficulty: 'hard' }]));
  const m = new Match({ seed, PF, ffa: { map: FFA_MAP, camps }, player: { strategy: 'boom', difficulty: 'hard' }, view: readonly });
  const w = m.world;
  const engaged = new Set(), eng = { 1: 0, 2: 0, 3: 0, 4: 0 }, returns = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let moved = null, captures = 0;
  const falls = [];
  while (!w.result) {
    m.step();
    if (!moved && w.time >= 300) { // the player moves its first finished Storehouse/Barracks 3 tiles
      const b = [...w.ofKind('building')].find((x) => x.team === 1 && x.built && x.type !== 'core' && !x.queue.length);
      if (b) for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3], [4, 4]]) {
        if (!canRelocate(w, b, b.tx + dx, b.ty + dy)) continue;
        const r = w.issue({ type: 'relocate', id: b.id, tx: b.tx + dx, ty: b.ty + dy, team: 1 });
        if (r.ok) { moved = { type: b.type, at: w.time, id: r.id }; break; }
      }
    }
    if (moved && moved.done == null && w.get(moved.id)?.built) moved.done = w.time;
    if (moved && moved.done == null && !w.get(moved.id)) moved.done = 'destroyed';
    for (const u of w.ofKind('unit')) {
      const o = u.order;
      if (o?.defend && !engaged.has(u.id)) { engaged.add(u.id); eng[u.team]++; }
      if (!o?.defend && engaged.has(u.id)) { engaged.delete(u.id); if (o?.returning) returns[u.team]++; }
    }
    for (const e of w.drainEvents()) {
      if (e.type === 'zoneCaptured') captures++;
      if (e.type === 'eliminated') falls.push(`camp ${e.team} ${e.by == null ? `hopeless` : `by ${e.by}`} @${(e.time / 60).toFixed(1)}m`);
    }
  }
  const r = w.result;
  console.log(`seed ${seed}: ${r.reason} @${(r.time / 60).toFixed(1)} min, winner ${r.winner} (${r.winner === 1 ? 'player' : FFA_STRATEGIES[r.winner]}); ${captures} captures; falls: ${falls.join(', ')}; auto-defend engagements per camp ${JSON.stringify(eng)}, walks back ${JSON.stringify(returns)}; player moved ${moved ? `${moved.type} at ${(moved.at / 60).toFixed(1)}m, up ${typeof moved.done === 'number' ? `after ${(moved.done - moved.at).toFixed(1)} s` : moved.done}` : 'nothing'}`);
}
