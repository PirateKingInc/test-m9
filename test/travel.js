// Phase 6 camp spacing, measured with the sim itself (PHASE6_SPEC.md "Spacing,
// measured by travel time"). Shared by test/travel.test.js and tools/travel.mjs.
import { World } from '../src/sim/world.js';
import { FFA_MAP } from '../src/data/ffa.js';
import { PF } from './helpers.js';

const T = FFA_MAP.tile; // 32 on both maps
const castleOf = (w, team) => [...w.ofKind('building')].find((b) => b.team === team && b.type === 'core');
const run = (w, done, max) => { const t0 = w.time; while (!done() && !w.result && w.time - t0 < max) w.step(); return w.time - t0; };

// A world with only the two camps' Castles left (no Peasants): the
// free-for-all map, or the 1v1 map for comparison.
function twoCastles(a, b, seed, map = FFA_MAP) {
  const w = new World({ map, seed, PF, setup: map === FFA_MAP ? 'ffa' : 'match' });
  for (const e of [...w.entities.values()]) if (e.kind === 'unit' || (e.kind === 'building' && e.team !== a && e.team !== b)) w.removeEntity(e);
  w.mode = 'measure'; // a measurement, not a match: no win/lose checks
  return w;
}

// A full army: 20 supply of each combat type's worth, 5 of each (the Shield
// Knight, at 50 px/s, is the slowest unit in the game), formed up in front of
// camp `a`'s Castle.
export const ARMY = ['striker', 'sparker', 'bulwark', 'lancer'].flatMap((t) => Array(5).fill(t));

// Round trip of a full army from camp a's Castle to camp b's and back, timed on
// the last unit. Plain moves (no fighting on the way), the sim's pathfinding,
// steering and chokepoints. Returns { there, back, roundTrip, pathTiles }.
export function roundTrip(a, b, seed = 1, map = FFA_MAP) {
  const w = twoCastles(a, b, seed, map);
  const home = castleOf(w, a), target = castleOf(w, b);
  target.team = a; // an obstacle to walk up to, not something to attack on arrival
  const d = Math.hypot(target.x - home.x, target.y - home.y), ux = (target.x - home.x) / d, uy = (target.y - home.y) / d;
  const start = { x: home.x + ux * 4 * T, y: home.y + uy * 4 * T }; // in front of the home Castle, toward the rival
  const units = ARMY.map((t, i) => w.addUnit(t, a, start.x + ((i % 5) - 2) * 28, start.y + (Math.floor(i / 5) - 1.5) * 28));
  roundTrip.last = { w, units };
  // Arrived: every unit has finished its move (formation slots spread a
  // 20-unit army over a few tiles) and stands within 10 tiles of the goal.
  const near = (p, r) => units.every((u) => u.order.type === 'idle' && Math.hypot(u.x - p.x, u.y - p.y) < r);
  const goal = { x: target.x - ux * 4 * T, y: target.y - uy * 4 * T }; // just outside the rival Castle
  w.issue({ type: 'move', ids: units.map((u) => u.id), ...goal, team: a });
  const there = run(w, () => near(goal, 10 * T), 600);
  w.issue({ type: 'move', ids: units.map((u) => u.id), ...start, team: a });
  const back = run(w, () => near(start, 10 * T), 600);
  const path = w.pathfinder.find(start.x, start.y, goal.x, goal.y) || [];
  let len = 0, p = start;
  for (const q of path) { len += Math.hypot(q.x - p.x, q.y - p.y); p = q; }
  return { there, back, roundTrip: there + back, pathTiles: len / T };
}

// How fast an undefended Castle falls: a Warband Raid first wave (its
// composition weights striker 2 : sparker 2 : lancer 0.5, about 14 units)
// already at the walls, ordered to attack it. Returns seconds.
export const RAID = [...Array(6).fill('striker'), ...Array(6).fill('sparker'), ...Array(2).fill('lancer')];
export function castleKillTime(seed = 1) {
  const w = twoCastles(1, 2, seed);
  const castle = castleOf(w, 1);
  const units = RAID.map((t, i) => w.addUnit(t, 2, castle.x + 3 * T + (i % 4) * 26, castle.y + (Math.floor(i / 4) - 1.5) * 26));
  w.issue({ type: 'attack', ids: units.map((u) => u.id), target: castle.id, team: 2 });
  return run(w, () => !w.get(castle.id), 600);
}
