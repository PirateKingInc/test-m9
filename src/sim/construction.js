// Building placement and construction (SPEC.md "Buildings").
import { BUILDINGS, CONSTRUCTION } from '../data/buildings.js';
import { RELOCATE } from '../data/camp-rules.js';
import { registerCommand, registerOrder, ownUnits } from './orders.js';
import { gap } from './geometry.js';
import { approach, canStand, clearPath } from './movement.js';

export function canPlace(world, type, tx, ty) {
  const def = BUILDINGS[type];
  return !!def && world.grid.isRectFree(tx, ty, def.w, def.h);
}

// Moving a completed building (Phase 9, PHASE9_SPEC.md "Part B"): the same
// placement rule, with the building's own current footprint counting as free.
export function canRelocate(world, b, tx, ty) {
  const def = BUILDINGS[b.type], g = world.grid;
  for (let y = ty; y < ty + def.h; y++) {
    for (let x = tx; x < tx + def.w; x++) {
      if (!g.inBounds(x, y)) return false;
      const i = g.idx(x, y);
      if (g.rock[i] || (g.occupant[i] && g.occupant[i] !== b.id)) return false;
    }
  }
  return true;
}

export const relocateCost = (type) => Math.floor(BUILDINGS[type].cost * RELOCATE.costShare);

// Why a building can't be moved right now, or null.
export function relocateBlocked(world, b) {
  if (!b.built) return 'Finish building it first';
  if (RELOCATE.fixed.includes(b.type)) return "The Castle can't be moved";
  if (b.queue.length) return 'Finish or cancel training first';
  if ((world.resources[b.team] || 0) < relocateCost(b.type)) return 'Not enough gold';
  return null;
}

// Push units standing on a freshly blocked footprint to the nearest free tile.
function evictUnits(world, b) {
  for (const u of world.ofKind('unit')) {
    if (canStand(world.grid, u.x, u.y, u.radius)) continue;
    const here = world.grid.tileOf(u.x, u.y);
    const free = world.grid.nearestWalkable(here.tx, here.ty, 8);
    if (!free) continue;
    const c = world.grid.center(free.tx, free.ty);
    u.x = u.px = c.x; u.y = u.py = c.y;
    if (u.order.type === 'move') clearPath(u), (u.order = { type: 'idle' });
  }
  world.emit('placed', { id: b.id, team: b.team, x: b.x, y: b.y });
}

registerCommand('build', (world, cmd) => {
  const team = cmd.team ?? 1;
  const drones = ownUnits(world, cmd).filter((u) => u.type === 'drone');
  const def = BUILDINGS[cmd.building];
  if (!drones.length || !def) return { ok: false, reason: 'Select a Drone to build' };
  if (!canPlace(world, cmd.building, cmd.tx, cmd.ty)) return { ok: false, reason: "Can't build there" };
  if (world.resources[team] < def.cost) return { ok: false, reason: 'Not enough Lumen' };
  world.resources[team] -= def.cost;
  const b = world.addBuilding(cmd.building, team, cmd.tx, cmd.ty);
  b.hp = def.hp * CONSTRUCTION.startHpFraction;
  evictUnits(world, b);
  // The nearest selected Drone takes the job.
  const builder = drones.reduce((best, u) => (gap(u, b) < gap(best, b) ? u : best));
  builder.order = { type: 'build', target: b.id };
  clearPath(builder);
  return { ok: true, id: b.id };
});

// Move: the old building is removed at once and a construction site of the
// same type goes up at the new spot for costShare of the cost, in timeShare
// of the build time. The crew moves with it: it needs no Peasant.
registerCommand('relocate', (world, cmd) => {
  const team = cmd.team ?? 1, b = world.get(cmd.id);
  if (!b || b.kind !== 'building' || b.team !== team) return { ok: false };
  const blocked = relocateBlocked(world, b);
  if (blocked) return { ok: false, reason: blocked };
  if (!canRelocate(world, b, cmd.tx, cmd.ty)) return { ok: false, reason: "Can't build there" };
  const cost = relocateCost(b.type);
  world.resources[team] -= cost;
  const rally = b.rally;
  world.removeEntity(b);
  const nb = world.addBuilding(b.type, team, cmd.tx, cmd.ty);
  nb.hp = nb.maxHp * CONSTRUCTION.startHpFraction;
  nb.relocating = true;
  nb.rally = rally;
  evictUnits(world, nb);
  return { ok: true, id: nb.id, cost };
});

registerCommand('assist', (world, cmd) => {
  const b = world.get(cmd.target);
  const drones = ownUnits(world, cmd).filter((u) => u.type === 'drone');
  if (!b || b.kind !== 'building' || b.built || b.team !== (cmd.team ?? 1) || !drones.length) return { ok: false };
  for (const u of drones) { u.order = { type: 'build', target: b.id }; clearPath(u); }
  return { ok: true };
});

registerCommand('cancelBuild', (world, cmd) => {
  const b = world.get(cmd.id);
  if (!b || b.kind !== 'building' || b.built || b.team !== (cmd.team ?? 1)) return { ok: false };
  const refund = Math.floor(BUILDINGS[b.type].cost * CONSTRUCTION.cancelRefund);
  world.resources[b.team] += refund;
  world.removeEntity(b);
  world.emit('cancelled', { id: b.id, refund, team: b.team });
  return { ok: true, refund };
});

registerOrder('build', (world, u, dt) => {
  const b = world.get(u.order.target);
  if (!b || b.built || b.hp <= 0) { u.order = { type: 'idle' }; clearPath(u); return; }
  if (gap(u, b) <= CONSTRUCTION.builderRange) {
    clearPath(u);
    u.facing = Math.atan2(b.y - u.y, b.x - u.x);
    b.buildingNow = true;
    return;
  }
  approach(world, u, b, dt);
});

// Advance every site that had a builder next to it this tick.
export function updateConstruction(world, dt) {
  for (const b of world.ofKind('building')) {
    if (b.built) continue;
    if (b.buildingNow || b.relocating) { // a moving building rebuilds itself (Phase 9), at its own pace
      const def = BUILDINGS[b.type];
      const k = dt / (def.buildTime * (b.relocating ? RELOCATE.timeShare : 1));
      b.progress = Math.min(1, b.progress + k);
      b.hp = Math.min(b.maxHp, b.hp + b.maxHp * (1 - CONSTRUCTION.startHpFraction) * k);
      if (b.progress >= 1) {
        b.built = true;
        b.relocating = false;
        world.emit('built', { id: b.id, building: b.type, team: b.team });
      }
    }
    b.buildingNow = false;
  }
}
