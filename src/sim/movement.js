// Path following, stuck recovery and wall sliding. Pure sim code.
import { PATHING } from '../data/scale.js';

const ARRIVE = 2; // px, final waypoint
const PASS = 12; // px, intermediate waypoints count as reached within this radius
const STUCK_WINDOW = 1.0; // s
const STUCK_MIN_PROGRESS = 4; // px per window
const MAX_REPATHS = 3;
const MAX_CROWD_WAIT = 15; // s a unit will queue behind moving traffic before giving up

// Give the unit a new destination. Returns false if no route exists.
//
// Phase 12: route searches stop for the tick once they have touched
// PATHING.workPerTick pathfinding nodes between them (the work, which is what costs
// time, and deterministic, so every lockstep peer defers the same units). An
// order to a whole army (hundreds of units at a high supply cap) would
// otherwise plan every route in the same tick, a stall longer than the 0.05 s
// the tick simulates (PHASE12_SPEC.md). Past the budget the unit keeps its
// new destination with its route pending (an empty path) and plans it in a
// later tick, in unit order, so a big army sets off over a few ticks.
export function setDestination(world, u, x, y) {
  u.dest = { x, y };
  u.pathIdx = 0;
  u.stuck = { t: 0, best: Infinity, repaths: 0, waited: 0 };
  u.pathVersion = world.grid.version;
  const pf = world.pathfinder;
  if (world.pathTick !== world.tick) { world.pathTick = world.tick; world.pathWork = pf.work; }
  if (pf.work - world.pathWork >= PATHING.workPerTick) { u.path = []; u.pathPending = true; return true; }
  if (u.pathPending) u.pathPending = false;
  u.path = world.pathfinder.find(u.x, u.y, x, y) || [];
  return u.path.length > 0;
}

// Walk toward the free tile next to entity e that is closest to the unit.
export function approach(world, u, e, dt) {
  if (!u.path || u.approachTarget !== e.id) {
    const t = adjacentTile(world, e, u.x, u.y);
    if (!t) return 'failed';
    setDestination(world, u, t.x, t.y);
    u.approachTarget = e.id;
  }
  const r = followPath(world, u, dt);
  if (r !== 'moving') u.approachTarget = null; // arrived or failed: re-plan next tick if still out of range
  return r;
}

// Center of the walkable tile bordering e's footprint that is nearest to (x,y).
// Edge-adjacent tiles come first: diagonal corner tiles are too far from the edge
// for melee/build range, so they are only used when every edge tile is blocked.
// Exact distance ties go to the first tile in scan order (top row first, left
// to right). On maps mirrored north-south too (the free-for-all), the scan runs
// in the mirror image of that order in the south and east halves, so mirrored
// camps pick mirrored tiles (Phase 8). The 1v1 map keeps the Phase 1 order.
export function adjacentTile(world, e, x, y) {
  const g = world.grid;
  const up = g.mirrorY && e.ty + e.h / 2 > g.rows / 2, left = g.mirrorY && e.tx + e.w / 2 > g.cols / 2;
  const ys = range(e.ty - 1, e.ty + e.h, up), xs = range(e.tx - 1, e.tx + e.w, left);
  let best = null, bestD = Infinity;
  for (const corners of [false, true]) {
    for (const ty of ys) {
      for (const tx of xs) {
        const sideX = tx === e.tx - 1 || tx === e.tx + e.w, sideY = ty === e.ty - 1 || ty === e.ty + e.h;
        if (!(sideX || sideY) || (sideX && sideY) !== corners || !g.isWalkable(tx, ty)) continue;
        const c = g.center(tx, ty), d = Math.hypot(c.x - x, c.y - y);
        if (d < bestD) { bestD = d; best = c; }
      }
    }
    if (best) return best;
  }
  return null;
}

// Integers a..b inclusive, descending if `rev`.
function range(a, b, rev) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return rev ? out.reverse() : out;
}

export function clearPath(u) {
  u.path = null;
  u.dest = null;
  if (u.pathPending) u.pathPending = false;
}

// A unit's circle may stand here if the tiles under its (shrunken) footprint are walkable.
// (Phase 12: the same five points without allocating; called for every move.)
export function canStand(grid, x, y, r) {
  const k = Math.min(r, 10) * 0.6, T = grid.tile;
  return grid.isWalkable(Math.floor((x + 0) / T), Math.floor((y + 0) / T))
    && grid.isWalkable(Math.floor((x + -k) / T), Math.floor((y + -k) / T))
    && grid.isWalkable(Math.floor((x + k) / T), Math.floor((y + -k) / T))
    && grid.isWalkable(Math.floor((x + -k) / T), Math.floor((y + k) / T))
    && grid.isWalkable(Math.floor((x + k) / T), Math.floor((y + k) / T));
}

// Move by (dx,dy), sliding along walls when the full move is blocked.
export function tryMove(world, u, dx, dy) {
  const g = world.grid;
  const nx = Math.min(Math.max(u.x + dx, u.radius), world.width - u.radius);
  const ny = Math.min(Math.max(u.y + dy, u.radius), world.height - u.radius);
  // Already overlapping a blocked tile (e.g. spawned or shoved there): move freely to escape.
  if (canStand(g, nx, ny, u.radius) || !canStand(g, u.x, u.y, u.radius)) { u.x = nx; u.y = ny; return true; }
  if (canStand(g, nx, u.y, u.radius)) { u.x = nx; return true; }
  if (canStand(g, u.x, ny, u.radius)) { u.y = ny; return true; }
  return false;
}

// Advance along the path. Returns 'moving', 'arrived' or 'failed'.
export function followPath(world, u, dt) {
  if (!u.path) return 'arrived';
  // A route left pending by the search budget: plan it as soon as there is room.
  if (u.pathPending) {
    const stuck = u.stuck;
    setDestination(world, u, u.dest.x, u.dest.y);
    u.stuck = stuck;
    if (u.pathPending) return 'moving';
    if (u.path.length === 0) { clearPath(u); return 'failed'; }
  }
  // The map changed (building placed or removed): re-route once.
  if (u.pathVersion !== world.grid.version && u.dest) {
    const stuck = u.stuck;
    setDestination(world, u, u.dest.x, u.dest.y);
    u.stuck = { ...stuck, best: Infinity };
  }
  // Every 0.5 s: if shoving pushed us behind an obstacle relative to the next
  // waypoint, re-plan from here instead of grinding against the corner.
  if ((world.tick + u.id) % 10 === 0 && u.pathIdx < u.path.length && !lineWalkable(world.grid, u.x, u.y, u.path[u.pathIdx])) {
    const stuck = u.stuck;
    setDestination(world, u, u.dest.x, u.dest.y);
    u.stuck = { ...stuck, best: Infinity };
  }
  let budget = u.speed * dt;
  while (budget > 0 && u.pathIdx < u.path.length) {
    const wp = u.path[u.pathIdx];
    const dx = wp.x - u.x, dy = wp.y - u.y, d = Math.hypot(dx, dy);
    const last = u.pathIdx === u.path.length - 1;
    if (!last && d <= PASS) { u.pathIdx++; continue; }
    if (d <= Math.max(ARRIVE, budget)) {
      if (!tryMove(world, u, dx, dy)) break;
      budget -= d;
      u.pathIdx++;
    } else {
      u.facing = Math.atan2(dy, dx);
      tryMove(world, u, (dx / d) * budget, (dy / d) * budget);
      budget = 0;
    }
  }
  if (u.pathIdx >= u.path.length) { clearPath(u); return 'arrived'; }
  return checkStuck(world, u, dt);
}

function remaining(u) {
  let len = 0, x = u.x, y = u.y;
  for (let i = u.pathIdx; i < u.path.length; i++) {
    len += Math.hypot(u.path[i].x - x, u.path[i].y - y);
    x = u.path[i].x; y = u.path[i].y;
  }
  return len;
}

function lineWalkable(grid, x, y, wp) {
  const len = Math.hypot(wp.x - x, wp.y - y);
  for (let d = 0; d <= len; d += 8) {
    const t = grid.tileOf(x + ((wp.x - x) * d) / len, y + ((wp.y - y) * d) / len);
    if (!grid.isWalkable(t.tx, t.ty)) return false;
  }
  return true;
}

function inTraffic(world, u) {
  for (const v of world.ofKind('unit')) {
    if (v !== u && v.path && Math.hypot(v.x - u.x, v.y - u.y) < u.radius + v.radius + 6) return true;
  }
  return false;
}

function checkStuck(world, u, dt) {
  const s = u.stuck;
  s.t += dt;
  if (s.t < STUCK_WINDOW) return 'moving';
  // Progress = shrinkage of the remaining path length, so a unit being
  // jostled back and forth (orbiting a waypoint) doesn't count as moving.
  const left = remaining(u);
  const progress = s.best - left;
  s.t = 0;
  s.best = Math.min(s.best, left);
  if (progress >= STUCK_MIN_PROGRESS) { s.repaths = 0; s.waited = 0; return 'moving'; }
  // Jammed in moving traffic (e.g. a chokepoint): re-plan, but don't count it
  // as a failure; queueing is bounded so nobody waits forever.
  const crowd = inTraffic(world, u) && s.waited < MAX_CROWD_WAIT;
  if (!crowd && s.repaths >= MAX_REPATHS) { clearPath(u); return 'failed'; }
  const { repaths, waited } = s;
  setDestination(world, u, u.dest.x, u.dest.y);
  u.stuck.repaths = crowd ? repaths : repaths + 1;
  u.stuck.waited = crowd ? waited + STUCK_WINDOW : waited;
  if (u.path.length === 0 && !u.pathPending) { clearPath(u); return 'failed'; }
  return 'moving';
}
