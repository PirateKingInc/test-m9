// Scripted free-for-all scenarios for the Phase 7 rival tests: the four-camp
// map with every starting Peasant removed and one AI camp (default Crimson,
// team 2) reading the world through the read-only view.
import { PF } from './helpers.js';
import { World } from '../src/sim/world.js';
import { AiEngine } from '../src/ai/engine.js';
import { readonly } from '../src/ai/readonly.js';
import { rankRivals } from '../src/ai/rivals.js';
import { FFA_MAP } from '../src/data/ffa.js';

const T = FFA_MAP.tile;
export function scenario({ team = 2, strategy = 'rush' } = {}) {
  const w = new World({ map: FFA_MAP, seed: 3, PF, setup: 'ffa' });
  for (const u of [...w.ofKind('unit')]) w.removeEntity(u);
  const ai = new AiEngine(w, { team, strategy, difficulty: 'hard', view: readonly(w) });
  const at = (type, t, tx, ty, n = 1, health = 1) => Array.from({ length: n }, (_, i) => {
    const u = w.addUnit(type, t, (tx + 0.5 + (i % 3)) * T, (ty + 0.5 + Math.floor(i / 3)) * T);
    u.hp = u.maxHp * health;
    return u;
  });
  // A fight: every unit of `a` attacks the first unit of `b`, and back.
  const fight = (a, b) => {
    for (const u of a) u.order = { type: 'attack', target: b[0].id };
    for (const u of b) u.order = { type: 'attack', target: a[0].id };
  };
  const scan = () => { ai.scout.scan(); return rankRivals(ai, ai.lastTarget ?? null); };
  return { w, ai, at, fight, scan };
}
