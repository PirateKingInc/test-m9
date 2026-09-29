// Terrain and gold-mine art, drawn with the Canvas 2D API. Pure drawing: the
// rock layout is read from the grid, never changed. (Phase 5: a meadow with
// stone cliffs; the resource nodes are gold mines. Internal names such as
// drawCrystal are the Phase 4 ones.)
import { GROUND, ROCK, GOLD, STONE, INK } from './palette.js';

// A tiny seeded RNG for texture noise (art only; the sim has its own).
function noise(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0; return (s >>> 8) / 16777216; };
}

// Paint the whole map (cols x rows tiles) at 1 canvas px per world px.
// isRock(tx, ty) says which tiles are impassable rock.
export function paintTerrain(ctx, cols, rows, tile, isRock) {
  const W = cols * tile, H = rows * tile, rnd = noise(7);
  const area = (cols * rows) / (80 * 60); // detail scales with the map (1 on the 1v1 map)
  ctx.fillStyle = GROUND.base;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < Math.round(900 * area); i++) { // soft mottling
    const x = rnd() * W, y = rnd() * H, r = 18 + rnd() * 70;
    ctx.fillStyle = GROUND.mottle[Math.floor(rnd() * GROUND.mottle.length)];
    ctx.globalAlpha = 0.18;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.5 + rnd() * 0.5), rnd() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < Math.round(2400 * area); i++) { // grass tufts and pebbles
    ctx.fillStyle = GROUND.speck[Math.floor(rnd() * GROUND.speck.length)];
    ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  ctx.strokeStyle = GROUND.grid; // a faint 4-tile grid helps placement
  ctx.lineWidth = 1;
  for (let x = 0; x <= cols; x += 4) { ctx.beginPath(); ctx.moveTo(x * tile + 0.5, 0); ctx.lineTo(x * tile + 0.5, H); ctx.stroke(); }
  for (let y = 0; y <= rows; y += 4) { ctx.beginPath(); ctx.moveTo(0, y * tile + 0.5); ctx.lineTo(W, y * tile + 0.5); ctx.stroke(); }

  // Rock reads as a raised wall: a shadow cast down-right, a dark cliff face on
  // the south side, the rock top, and a lit north/west edge.
  const rock = (tx, ty) => tx >= 0 && ty >= 0 && tx < cols && ty < rows && isRock(tx, ty);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) if (rock(tx, ty)) ctx.fillRect(tx * tile + 6, ty * tile + 10, tile, tile);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if (!rock(tx, ty)) continue;
      const x = tx * tile, y = ty * tile;
      ctx.fillStyle = ROCK.base;
      ctx.fillRect(x, y, tile, tile);
      if (!rock(tx, ty + 1)) { ctx.fillStyle = ROCK.face; ctx.fillRect(x, y + tile - 9, tile, 9); ctx.fillStyle = ROCK.dark; ctx.fillRect(x, y + tile - 10, tile, 2); }
      if (!rock(tx, ty - 1)) { ctx.fillStyle = ROCK.light; ctx.fillRect(x, y, tile, 3); }
      if (!rock(tx - 1, ty)) { ctx.fillStyle = ROCK.light; ctx.globalAlpha = 0.6; ctx.fillRect(x, y, 2, tile); ctx.globalAlpha = 1; }
      if (!rock(tx + 1, ty)) { ctx.fillStyle = ROCK.dark; ctx.fillRect(x + tile - 3, y, 3, tile); }
      for (let k = 0; k < 3; k++) { // shaded boulders on the rock top
        const r = 5 + rnd() * 6, bx = x + r + rnd() * (tile - 2 * r), by = y + r + rnd() * Math.max(1, tile - 10 - 2 * r);
        const g = ctx.createRadialGradient(bx - r * 0.4, by - r * 0.5, 1, bx, by, r);
        g.addColorStop(0, ROCK.light); g.addColorStop(0.6, ROCK.base); g.addColorStop(1, ROCK.dark);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(bx, by, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
}

// Gold mine stages: 3 = full, 2 = mined, 1 = nearly empty.
export const CRYSTAL_STAGES = [3, 2, 1];
export const stageOf = (fill) => (fill > 0.66 ? 3 : fill > 0.33 ? 2 : 1);
export const CRYSTAL_BOX = 80; // world px drawn around a 64 px (2x2) node

const BOULDERS = [[-14, 4, 13], [12, 6, 12], [0, -8, 14], [-4, 14, 10], [16, -8, 9]]; // [x, y, r]
const NUGGETS = [ // [x, y, r], biggest first; later stages keep fewer and smaller ones
  [0, 2, 7], [-9, -4, 5.5], [9, -2, 5], [-4, 12, 4.5], [8, 11, 4], [-15, 8, 3.5], [15, 4, 3.5], [3, -12, 3.5],
];

function ball(ctx, x, y, r, c) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.1, x, y, r);
  g.addColorStop(0, c.light); g.addColorStop(0.6, c.base); g.addColorStop(1, c.dark);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 1.3; ctx.strokeStyle = INK; ctx.stroke();
}

// A rocky outcrop with gold ore: grey boulders studded with gold nuggets that
// thin out as the mine is worked.
export function drawCrystal(ctx, stage) {
  const glow = ctx.createRadialGradient(0, 2, 2, 0, 2, 36);
  glow.addColorStop(0, GOLD.glow);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-40, -36, 80, 80);
  ctx.beginPath(); ctx.ellipse(2, 10, 30, 18, 0, 0, Math.PI * 2); // shadow and spoil
  ctx.fillStyle = 'rgba(40, 30, 15, 0.55)'; ctx.fill();
  const rocks = { 3: 5, 2: 4, 1: 3 }[stage];
  for (const [x, y, r] of BOULDERS.slice(0, rocks)) ball(ctx, x, y, r, STONE);
  const count = { 3: 8, 2: 5, 1: 2 }[stage], scale = { 3: 1, 2: 0.85, 1: 0.7 }[stage];
  for (const [x, y, r] of NUGGETS.slice(0, count)) {
    ball(ctx, x, y, r * scale, GOLD);
    ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.85; // glint
    ctx.fillRect(x - r * scale * 0.45, y - r * scale * 0.55, 1.6, 1.6);
    ctx.globalAlpha = 1;
  }
}
