// Win / lose. SPEC.md Phase 2 (the 1v1 match): a team with no completed
// Command Core is defeated; same-tick mutual loss is a draw; at the time limit
// the higher score wins. Phase 6 generalizes this to world.teams (N camps);
// the free-for-all's elimination and ranking rules are in PHASE6_SPEC.md.
import { UNITS } from '../data/units.js';
import { BUILDINGS } from '../data/buildings.js';

export function hasCore(world, team) {
  for (const b of world.ofKind('building')) if (b.team === team && b.type === 'core' && b.built && b.hp > 0) return true;
  return false;
}

// Banked Lumen + cost of living units + cost of standing buildings (paid in full on placement).
export function score(world, team) {
  let s = world.resources[team] || 0;
  for (const e of world.entities.values()) {
    if (e.team !== team) continue;
    if (e.kind === 'unit') s += UNITS[e.type].cost;
    else if (e.kind === 'building') s += BUILDINGS[e.type].cost;
  }
  return s;
}

function finish(world, winner, reason) {
  const teams = world.teams;
  const loser = winner === null || teams.length !== 2 ? null : teams.find((t) => t !== winner);
  world.result = { winner, loser, reason, time: world.time, scores: Object.fromEntries(teams.map((t) => [t, score(world, t)])) };
  world.emit('gameOver', { ...world.result });
}

// Called at the end of every match-mode step. Always leaves a declared result
// once a Core is gone or time runs out, so a match can never end in limbo.
export function checkResult(world) {
  if (world.result) return;
  if (world.mode === 'ffa') return checkFreeForAll(world);
  if (world.mode !== 'match') return;
  const alive = world.teams.filter((t) => hasCore(world, t));
  if (alive.length === 0) return finish(world, null, 'draw');
  if (alive.length === 1) return finish(world, alive[0], 'core-destroyed');
  if (world.time >= world.map.timeLimit - 1e-9) {
    const scores = world.teams.map((t) => score(world, t));
    const best = Math.max(...scores);
    const top = world.teams.filter((t, i) => scores[i] === best);
    return finish(world, top.length === 1 ? top[0] : null, 'time-limit');
  }
}

// ---- free-for-all (Phase 6, PHASE6_SPEC.md) ---------------------------------

const zoneCount = (world, team) => (world.zones || []).filter((z) => z.owner === team).length;

// A camp with no completed Castle is eliminated. The camp that landed the
// killing blow on that Castle takes its banked gold and every zone it owned, in
// one transfer; everything the eliminated camp still had is razed. If the
// conqueror fell in the same tick (or there is none), the gold is lost and the
// zones go neutral.
function eliminate(world, team, alive) {
  const by = world.castleKills?.[team] ?? null;
  const conqueror = by != null && by !== team && alive.includes(by) ? by : null;
  const gold = world.resources[team] || 0;
  world.resources[team] = 0;
  if (conqueror != null) world.resources[conqueror] += gold;
  const zones = [];
  for (const z of world.zones || []) {
    if (z.owner !== team) continue;
    z.owner = conqueror; z.holder = null; z.holdSince = null;
    zones.push(z.id);
  }
  for (const e of [...world.entities.values()]) if (e.team === team && (e.kind === 'unit' || e.kind === 'building')) world.removeEntity(e);
  const rec = { team, by: conqueror, time: world.time, gold, zones };
  world.eliminated.push(rec);
  world.emit('eliminated', { ...rec });
}

// Final places: survivors by zones then score, then the eliminated, last out first.
function standings(world) {
  const out = world.eliminated.map((e) => e.team);
  const alive = world.teams.filter((t) => !out.includes(t))
    .map((team) => ({ team, zones: zoneCount(world, team), score: score(world, team), eliminatedAt: null }))
    .sort((a, b) => b.zones - a.zones || b.score - a.score || a.team - b.team);
  const gone = [...world.eliminated].reverse().map((e) => ({ team: e.team, zones: 0, score: score(world, e.team), eliminatedAt: e.time }));
  return [...alive, ...gone].map((s, i) => ({ ...s, place: i + 1 }));
}

function finishFreeForAll(world, winner, reason) {
  world.result = {
    winner, loser: null, reason, time: world.time,
    scores: Object.fromEntries(world.teams.map((t) => [t, score(world, t)])),
    zones: Object.fromEntries(world.teams.map((t) => [t, zoneCount(world, t)])),
    standings: standings(world),
    eliminated: world.eliminated.map((e) => ({ ...e })),
  };
  world.emit('gameOver', { ...world.result });
}

// Last camp standing wins. If the last camps all fall in the same tick it is a
// draw. At the time limit the camp owning the most zones wins, then the higher
// score; a tie on both is a draw. Every free-for-all therefore ends declared.
function checkFreeForAll(world) {
  world.eliminated ||= [];
  const out = new Set(world.eliminated.map((e) => e.team));
  const alive = world.teams.filter((t) => !out.has(t) && hasCore(world, t));
  for (const t of world.teams) if (!out.has(t) && !alive.includes(t)) eliminate(world, t, alive);
  if (alive.length === 0) return finishFreeForAll(world, null, 'draw');
  if (alive.length === 1) return finishFreeForAll(world, alive[0], 'last-standing');
  if (world.time >= world.map.timeLimit - 1e-9) {
    const rank = alive.map((t) => ({ t, z: zoneCount(world, t), s: score(world, t) })).sort((a, b) => b.z - a.z || b.s - a.s);
    const tie = rank[1] && rank[1].z === rank[0].z && rank[1].s === rank[0].s;
    return finishFreeForAll(world, tie ? null : rank[0].t, 'time-limit');
  }
}
