// Production queues (SPEC.md "Production queue"): FIFO, cost paid on enqueue, 100% refund on cancel.
import { BUILDINGS, PRODUCTION } from '../data/buildings.js';
import { UNITS } from '../data/units.js';
import { registerCommand } from './orders.js';
import { supplyOf } from './supply.js';

function ownBuilding(world, cmd) {
  const b = world.get(cmd.building);
  return b && b.kind === 'building' && b.team === (cmd.team ?? 1) && b.hp > 0 ? b : null;
}

registerCommand('train', (world, cmd) => {
  const b = ownBuilding(world, cmd);
  if (!b || !b.built || !BUILDINGS[b.type].trains.includes(cmd.unit)) return { ok: false, reason: "Can't train that here" };
  if (b.queue.length >= PRODUCTION.maxQueue) return { ok: false, reason: 'Queue is full' };
  const cost = UNITS[cmd.unit].cost;
  if (world.resources[b.team] < cost) return { ok: false, reason: 'Not enough Lumen' };
  if (supplyOf(world, b.team).free < UNITS[cmd.unit].supply) return { ok: false, reason: 'Not enough supply: build a Lumen Depot' };
  world.resources[b.team] -= cost;
  b.queue.push({ unit: cmd.unit, progress: 0 });
  return { ok: true };
});

registerCommand('cancelTrain', (world, cmd) => {
  const b = ownBuilding(world, cmd);
  if (!b || !b.queue.length) return { ok: false };
  const i = cmd.index ?? b.queue.length - 1;
  if (i < 0 || i >= b.queue.length) return { ok: false };
  const [item] = b.queue.splice(i, 1);
  const refund = Math.floor(UNITS[item.unit].cost * PRODUCTION.cancelRefund);
  world.resources[b.team] += refund;
  return { ok: true, refund };
});

registerCommand('rally', (world, cmd) => {
  const b = ownBuilding(world, cmd);
  if (!b || !BUILDINGS[b.type].trains.length) return { ok: false };
  b.rally = { x: cmd.x, y: cmd.y };
  return { ok: true };
});

// Nearest walkable tile around the footprint with no unit standing on it,
// searching outward ring by ring (so crowded exits push spawns further out).
export function spawnPoint(world, b, towardX, towardY) {
  const g = world.grid, T = g.tile;
  const units = [...world.ofKind('unit')];
  const free = (c) => units.every((u) => Math.hypot(u.x - c.x, u.y - c.y) > u.radius + 8);
  for (let ring = 1; ring <= 8; ring++) {
    let best = null, bestD = Infinity;
    for (let ty = b.ty - ring; ty < b.ty + b.h + ring; ty++) {
      for (let tx = b.tx - ring; tx < b.tx + b.w + ring; tx++) {
        const onRing = tx === b.tx - ring || tx === b.tx + b.w + ring - 1 || ty === b.ty - ring || ty === b.ty + b.h + ring - 1;
        if (!onRing || !g.isWalkable(tx, ty)) continue;
        const c = g.center(tx, ty);
        if (!free(c)) continue;
        const d = Math.hypot(c.x - towardX, c.y - towardY);
        if (d < bestD) { bestD = d; best = c; }
      }
    }
    if (best) return best;
  }
  return { x: b.x, y: b.y + b.ph / 2 + T / 2 };
}

export function updateProduction(world, dt) {
  for (const b of world.ofKind('building')) {
    if (!b.built || !b.queue.length) continue;
    const item = b.queue[0];
    item.progress += dt;
    if (item.progress + 1e-9 < UNITS[item.unit].trainTime) continue;
    b.queue.shift();
    // Without a rally point, spawn toward the bottom corner on the map-centre side:
    // bottom-right in the west half (the Phase 1 default), bottom-left in the east.
    // A fixed bottom-right for everyone sent east-side units out the back of
    // their base (see BALANCE.md, side bias).
    // Phase 8: on maps mirrored north-south too (the free-for-all), the south
    // half spawns toward the top corner, the mirror image of the north half.
    const east = b.x >= world.width / 2, south = world.grid.mirrorY && b.y >= world.height / 2;
    const toward = b.rally || { x: b.x + (east ? -b.pw : b.pw), y: b.y + (south ? -b.ph : b.ph) };
    const p = spawnPoint(world, b, toward.x, toward.y);
    const u = world.addUnit(item.unit, b.team, p.x, p.y);
    world.emit('trained', { id: u.id, unit: item.unit, team: b.team, building: b.id });
    if (b.rally) world.issue({ type: 'move', ids: [u.id], x: b.rally.x, y: b.rally.y, team: b.team });
  }
}
