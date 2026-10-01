// Separation steering: overlapping units push apart so groups don't stack or clip.
// Uses a spatial hash, so cost stays ~linear in unit count.
import { tryMove } from './movement.js';

const CELL = 64;
const PAD = 1; // px of breathing room between circles
const PASSES = 2;

// How easily a unit is shoved. Moving units push idle ones out of their way;
// units in melee or working hold their ground more.
function mobility(u) {
  switch (u.order.type) {
    case 'idle': return 1;
    case 'move': case 'attackMove': return u.path ? 0.35 : 1;
    case 'attack': return u.path ? 0.5 : 0.25;
    case 'build': return 0.3;
    default: return 0.5;
  }
}

// Drones working the gather loop pass through each other (a common RTS
// convention) so mining traffic never jams at nodes or depots.
const ghost = (u) => u.order.type === 'gather';

// Distinct for every cell of any map up to 4096 cells across (one past each edge included).
const cellKey = (cx, cy) => (cx + 1) * 8192 + (cy + 1);

export function separate(world) {
  const units = [];
  for (const u of world.ofKind('unit')) if (!ghost(u)) units.push(u);
  for (let pass = 0; pass < PASSES; pass++) {
    // (Phase 12: a numeric cell key, not a string per unit and neighbour;
    // the same cells, so the same pushes in the same order.)
    const hash = new Map();
    for (const u of units) {
      const k = cellKey(Math.floor(u.x / CELL), Math.floor(u.y / CELL));
      let cell = hash.get(k);
      if (!cell) hash.set(k, (cell = []));
      cell.push(u);
    }
    // Pushes are applied one pair at a time, so the order matters. On maps
    // mirrored north-south too (the free-for-all), a unit in the east (south)
    // half visits neighbour cells in the mirror image of the west (north)
    // order, so mirrored crowds resolve identically (Phase 8). The 1v1 map
    // keeps the Phase 1 order.
    const mir = world.grid.mirrorY, W = world.width / 2, H = world.height / 2;
    for (const a of units) {
      const cx = Math.floor(a.x / CELL), cy = Math.floor(a.y / CELL);
      const sx = mir && a.x >= W ? -1 : 1, sy = mir && a.y >= H ? -1 : 1;
      for (let j = -1; j <= 1; j++) {
        const dy = sy * j;
        for (let i = -1; i <= 1; i++) {
          const dx = sx * i;
          const cell = hash.get(cellKey(cx + dx, cy + dy));
          if (!cell) continue;
          for (const b of cell) {
            if (b.id <= a.id) continue;
            push(world, a, b);
          }
        }
      }
    }
  }
}

function push(world, a, b) {
  const min = a.radius + b.radius + PAD;
  let nx = b.x - a.x, ny = b.y - a.y;
  const d2 = nx * nx + ny * ny;
  if (d2 >= min * min) return;
  let d = Math.sqrt(d2);
  if (d < 1e-6) { // exactly stacked: split along a direction derived from the ids
    const ang = ((a.id * 7919 + b.id * 104729) % 628) / 100;
    nx = Math.cos(ang); ny = Math.sin(ang); d = 0;
  } else { nx /= d; ny /= d; }
  const overlap = min - d;
  // A mover bumping an idle unit shoves it sideways (off the mover's heading)
  // so it steps aside instead of being bulldozed along the mover's path.
  const aMoving = !!a.path, bMoving = !!b.path;
  if (aMoving !== bMoving) {
    const [m, idle, sign] = aMoving ? [a, b, 1] : [b, a, -1];
    if (idle.order.type === 'idle') {
      const hx = Math.cos(m.facing), hy = Math.sin(m.facing);
      const ox = nx * sign, oy = ny * sign; // mover -> idle
      const side = hx * oy - hy * ox >= 0 ? 1 : -1;
      const px = -hy * side, py = hx * side; // perpendicular, toward the idle unit's side
      tryMove(world, idle, (px * 0.8 + ox * 0.2) * overlap, (py * 0.8 + oy * 0.2) * overlap);
      return;
    }
  }
  // Two movers meeting roughly head-on each sidestep *away from the side the
  // other one is on*, so opposing streams flow past instead of deadlocking.
  // Unlike a fixed "keep right" rule, this is symmetric under the map's
  // east-west mirror (see BALANCE.md, side bias). Exactly aligned pairs (only
  // in perfectly mirrored states) break the tie by id.
  if (aMoving && bMoving) {
    const ahx = Math.cos(a.facing), ahy = Math.sin(a.facing);
    const bhx = Math.cos(b.facing), bhy = Math.sin(b.facing);
    if (ahx * bhx + ahy * bhy < -0.3) {
      const k = overlap * 0.5;
      // side = sign(heading x (self - other)); n points from a to b.
      let sa = Math.sign(ahx * -ny - ahy * -nx), sb = Math.sign(bhx * ny - bhy * nx);
      if (sa === 0 || sb === 0) { sa = 1; sb = 1; } // aligned: both turn the same way relative to their heading
      tryMove(world, a, (-ahy * sa * 0.7 - nx * 0.3) * k, (ahx * sa * 0.7 - ny * 0.3) * k);
      tryMove(world, b, (-bhy * sb * 0.7 + nx * 0.3) * k, (bhx * sb * 0.7 + ny * 0.3) * k);
      return;
    }
  }
  // Moving units only partially resolve overlap with each other (soft
  // collisions): crowds compress a little and keep flowing through
  // chokepoints instead of locking up. Once they stop, full separation applies.
  const soft = aMoving && bMoving ? 0.25 : 1;
  const ma = mobility(a), mb = mobility(b), sum = ma + mb;
  const pa = (overlap * soft * ma) / sum, pb = (overlap * soft * mb) / sum;
  tryMove(world, a, -nx * pa, -ny * pa);
  tryMove(world, b, nx * pb, ny * pb);
}
