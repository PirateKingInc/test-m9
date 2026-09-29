// Multi-rival assessment (Phase 7, PHASE7_SPEC.md). Ranks every living rival
// camp from what this AI camp has actually scouted (its Scout's memory and
// witnessed fights) plus public information (which camps are alive, who owns
// each zone), with the documented priority formula. Pure reading: it never
// acts and never writes game state.
import { UNITS } from '../data/units.js';
import { RIVALS } from '../data/rivals.js';
import { campTravel } from '../data/ffa.js';
import { COMBAT_TYPES } from './engine-types.js';

const armyValue = (units) => units.reduce((n, u) => n + UNITS[u.type].supply * u.health, 0);

// One rival's inputs to the formula.
export function assessRival(e, camp, now = e.w.time) {
  const cfg = RIVALS, team = camp.team, scout = e.scout;
  const sightings = [...scout.memory.values()].filter((m) => m.team === team && m.kind === 'unit' && COMBAT_TYPES.includes(m.type));
  const spires = scout.knownBuildings('spire', team).length;
  const seen = armyValue(sightings.filter((m) => !m.gone)) + cfg.spireValue * spires;
  const own = armyValue(e.army().map((u) => ({ type: u.type, health: u.hp / u.maxHp })));
  const scouted = sightings.length > 0 || spires > 0;
  const R = scouted ? (seen + cfg.smoothing) / (own + cfg.smoothing) : 1;
  const fight = scout.engaged.get(team);
  const engaged = fight && now - fight.at <= cfg.engagedMemory ? fight.with : null;
  const hit = scout.hitUs.get(team);
  const hitting = hit != null && now - hit <= cfg.hitMemory;
  const cores = [...scout.cores.values()].filter((c) => c.team === team);
  const castle = cores.length ? 1 - Math.max(...cores.map((c) => c.health ?? 1)) : 0;
  const zones = e.w.zones ? [...e.w.zones].filter((z) => z.owner === team).length : 0;
  const travel = campTravel(e.team, team) ?? 0;
  return { team, scouted, seen, own, R, engaged, hitting, castle, zones, travel };
}

// P_r (PHASE7_SPEC.md "Priority formula") and the reasons behind it.
export function scoreRival(a, current) {
  const w = RIVALS.weights;
  const parts = {
    weakness: w.weakness * (1 - Math.min(a.R, 2)),
    overmatch: -w.overmatch * Math.max(0, a.R - 1),
    engaged: a.engaged != null ? w.engaged : 0,
    castle: w.castle * a.castle,
    hitting: a.hitting ? w.hitting : 0,
    zones: w.zones * (a.zones - 1),
    travel: -w.travel * a.travel,
    stick: a.team === current ? w.stick : 0,
  };
  const score = Object.values(parts).reduce((x, y) => x + y, 0);
  const why = [];
  if (!a.scouted) why.push('unscouted');
  else if (a.R >= RIVALS.caution) why.push('clearly stronger');
  else if (a.R < 0.8) why.push('weaker');
  else if (a.R > 1.2) why.push('stronger');
  if (a.engaged != null) why.push(`engaged with camp ${a.engaged}`);
  if (a.castle > 0.05) why.push(`Castle ${Math.round((1 - a.castle) * 100)}%`);
  if (a.hitting) why.push('hitting us');
  if (a.zones > 1) why.push(`${a.zones} zones`);
  why.push(`${a.travel.toFixed(0)} s away`);
  return { ...a, score, parts, why };
}

// Every living rival, best first (ties: lower team), and the pick: the best
// rival that is not clearly stronger, or null (cautious).
// `avoid` (a Set the engine keeps) holds the rivals we have backed off from as
// clearly stronger: one stays avoided until its R drops below cautionRelease,
// so a ratio hovering around the caution line doesn't flip the decision.
export function rankRivals(e, current = null, avoid = new Set()) {
  const ranking = [...e.livingRivals()].map((c) => scoreRival(assessRival(e, c), current))
    .sort((a, b) => b.score - a.score || a.team - b.team);
  for (const r of ranking) {
    if (r.R >= RIVALS.caution) avoid.add(r.team);
    else if (r.R < RIVALS.cautionRelease) avoid.delete(r.team);
    r.avoided = avoid.has(r.team);
    if (r.avoided && !r.why.includes('clearly stronger')) r.why.unshift('avoided: was clearly stronger');
  }
  const pick = ranking.find((r) => !r.avoided) || null;
  return { at: e.w.time, ranking, target: pick ? pick.team : null, cautious: !pick && ranking.length > 0 };
}
