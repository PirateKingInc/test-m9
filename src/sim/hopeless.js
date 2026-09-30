// Hopeless camps (Phase 9, PHASE9_SPEC.md "Part C"). A camp that can provably
// never again produce a unit or earn gold is eliminated after a short
// confirmation window, instead of watching itself lose slowly.
//
// The proof is a reachability search over an abstract model of the camp,
// in the spirit of a softlock checker: explore every sequence of actions the
// rules allow from the camp's current state and look for one that yields a
// unit or income. The model deliberately over-approximates what the camp can
// do (it ignores supply, assumes a free building spot, assumes any gold mine
// anywhere is reachable and that a Peasant survives), so the predicate can
// only under-trigger, never flag a camp that still has a way forward.
import { BUILDINGS, CONSTRUCTION } from '../data/buildings.js';
import { UNITS } from '../data/units.js';

const isCombat = (type) => { const d = UNITS[type]; return !!d.attack && !d.worker && !d.testOnly; };
const cheapestSoldier = Math.min(...Object.keys(UNITS).filter(isCombat).map((t) => UNITS[t].cost));
const peasantCost = UNITS.drone.cost;
const BUILDABLE = ['depot', 'foundry', 'core']; // a Watchtower never leads to a unit or income

// The camp as the search sees it.
export function campModel(world, team) {
  const m = {
    gold: Math.floor(world.resources[team] || 0),
    peasants: 0, carrying: false, combat: 0, queued: 0,
    core: false, foundry: false, depot: false,
    sites: [], selfSites: [], // unfinished buildings (moving ones finish without a Peasant)
    minesLeft: false,
  };
  for (const e of world.entities.values()) {
    if (e.kind === 'node') { if (e.amount > 0) m.minesLeft = true; continue; }
    if (e.team !== team || e.hp <= 0) continue;
    if (e.kind === 'unit') {
      if (UNITS[e.type].worker) { m.peasants++; if (e.carry > 0) m.carrying = true; }
      else if (isCombat(e.type)) m.combat++;
    } else if (e.kind === 'building') {
      m.queued += e.queue.length;
      if (!e.built) (e.relocating ? m.selfSites : m.sites).push(e.type);
      else if (e.type === 'core' || e.type === 'foundry' || e.type === 'depot') m[e.type] = true;
    }
  }
  return m;
}

const finish = (s, type) => ({ ...s, [type]: type === 'spire' ? s[type] : true });

// Can any sequence of actions from this state produce a unit or income?
export function canRecover(m) {
  let start = { gold: m.gold, peasant: m.peasants > 0, core: m.core, foundry: m.foundry, depot: m.depot, sites: [...m.sites].sort() };
  for (const t of m.selfSites) start = finish(start, t); // a moving building finishes by itself
  const key = (s) => `${s.gold}|${+s.peasant}|${+s.core}|${+s.foundry}|${+s.depot}|${s.sites.join(',')}`;
  const seen = new Set([key(start)]), queue = [start];
  while (queue.length) {
    const s = queue.shift();
    // Success: a unit can be trained, or gold can come in.
    if (s.core && s.gold >= peasantCost) return true;
    if (s.foundry && s.gold >= cheapestSoldier) return true;
    if (s.peasant && s.depot && (m.minesLeft || m.carrying)) return true;
    const next = [];
    s.sites.forEach((t, i) => {
      const rest = s.sites.filter((_, j) => j !== i);
      next.push({ ...s, sites: rest, gold: s.gold + Math.floor(BUILDINGS[t].cost * CONSTRUCTION.cancelRefund) }); // cancel
      if (s.peasant) next.push({ ...finish(s, t), sites: rest }); // a Peasant finishes it
    });
    if (s.peasant) {
      for (const t of BUILDABLE) {
        if (s.gold >= BUILDINGS[t].cost) next.push({ ...s, gold: s.gold - BUILDINGS[t].cost, sites: [...s.sites, t].sort() });
      }
    }
    for (const n of next) {
      const k = key(n);
      if (!seen.has(k)) { seen.add(k); queue.push(n); }
    }
  }
  return false;
}

// The predicate (PHASE9_SPEC.md "The predicate"): no combat unit, nothing in
// training, no completed Storehouse, no Peasant while gold is left in any mine
// (even one that could not deliver it: erring toward under-triggering), and no
// reachable way to a unit or income.
export function isHopeless(world, team) {
  const m = campModel(world, team);
  if (m.combat > 0 || m.queued > 0 || m.depot) return false;
  if (m.peasants > 0 && m.minesLeft) return false;
  return !canRecover(m);
}
