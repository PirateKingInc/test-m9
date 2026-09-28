// Building sprites in three construction states, drawn with the Canvas 2D API
// around (0, 0) in world pixels. `w`/`h` is the gameplay footprint; the
// sprite may overhang it slightly (shadow), but the footprint stays the
// gameplay size. Pure drawing: no game state.
// Phase 5: medieval stone and timber (PHASE5_SPEC.md "Art direction"): the
// Castle, Storehouse, Barracks and Watchtower, each with a team banner or roof.
import { TEAM, INK, STONE, WOOD, THATCH, GOLD, DIRT, METAL } from './palette.js';

export const BUILDING_MARGIN = 8; // world px of overhang drawn around the footprint
export const STATES = ['foundation', 'frame', 'complete'];

// Construction progress -> state (see PHASE4_SPEC.md).
export const stateOf = (b) => (b.built ? 'complete' : b.progress < 0.34 ? 'foundation' : 'frame');

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }
function fs(ctx, fill, stroke = INK, width = 2) {
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.lineWidth = width; ctx.strokeStyle = stroke; ctx.stroke(); }
}
function line(ctx, x0, y0, x1, y1, color, width) {
  ctx.lineWidth = width; ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}
function glow(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
// A shaded ball, lit from the top-left (tower roofs).
function ball(ctx, x, y, r, c, stroke = INK) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.1, x, y, r);
  g.addColorStop(0, c.light);
  g.addColorStop(0.6, c.base);
  g.addColorStop(1, c.dark);
  circle(ctx, x, y, r);
  fs(ctx, g, stroke, 1.6);
}
// Battlements along a rectangle's edges: stone teeth with gaps.
function merlons(ctx, x, y, w, h, size = 5) {
  ctx.fillStyle = STONE.light;
  for (let px = x; px + size <= x + w; px += size * 2) { ctx.fillRect(px, y, size, size); ctx.fillRect(px, y + h - size, size, size); }
  for (let py = y + size * 2; py + size <= y + h - size; py += size * 2) { ctx.fillRect(x, py, size, size); ctx.fillRect(x + w - size, py, size, size); }
}
// Stone courses: staggered mortar lines.
function courses(ctx, x, y, w, h, step = 8) {
  ctx.lineWidth = 1; ctx.strokeStyle = STONE.dark;
  for (let py = y + step, row = 0; py < y + h; py += step, row++) {
    ctx.beginPath(); ctx.moveTo(x + 2, py); ctx.lineTo(x + w - 2, py); ctx.stroke();
    for (let px = x + (row % 2 ? step : step / 2); px < x + w - 2; px += step * 1.6) { ctx.beginPath(); ctx.moveTo(px, py - step); ctx.lineTo(px, py); ctx.stroke(); }
  }
}
// A team banner on a pole: the pole foot at (x, y), the cloth flying right.
function banner(ctx, x, y, t, size = 1) {
  const h = 26 * size, fw = 18 * size, fh = 12 * size;
  line(ctx, x, y, x, y - h, WOOD.deep, 2.5 * size);
  ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + fw, y - h + 2 * size); ctx.lineTo(x + fw - 4 * size, y - h + fh / 2 + 1 * size); ctx.lineTo(x + fw, y - h + fh); ctx.lineTo(x, y - h + fh); ctx.closePath();
  fs(ctx, t.base, INK, 1.4);
  ctx.fillStyle = t.light; ctx.fillRect(x + 1, y - h + fh * 0.4, fw - 6 * size, 2 * size);
  circle(ctx, x, y - h - 1.5 * size, 2 * size); fs(ctx, GOLD.base, null);
}

// A raised block: drop shadow, front wall, then the roof `draw` on top.
// The front wall carries a team-coloured trim so allegiance reads on every building.
function block(ctx, w, h, wall, wallColor, roof, t) {
  rr(ctx, -w / 2 + 4, -h / 2 + 6, w, h, 6);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill(); // shadow (down-right)
  rr(ctx, -w / 2, -h / 2 + wall, w, h - wall, 6);
  fs(ctx, wallColor); // front wall
  if (t) { ctx.fillStyle = t.base; ctx.fillRect(-w / 2 + 6, h / 2 - 5, w - 12, 3); }
  roof(ctx, w, h - wall);
}

const COMPLETE = {
  // A stone castle: curtain wall, four round towers with team roofs, a
  // crenellated keep flying the team banner, and a gate on the south side.
  core(ctx, w, h, t) {
    block(ctx, w - 8, h - 8, 8, STONE.deep, (c, bw, bh) => {
      const x = -bw / 2, y = -bh / 2 - 4;
      rr(c, x + 4, y + 4, bw - 8, bh - 8, 4); fs(c, STONE.base);
      courses(c, x + 4, y + 4, bw - 8, bh - 8, 9);
      rr(c, x + 16, y + 16, bw - 32, bh - 32, 3); fs(c, DIRT.light, INK, 1.5); // courtyard
      merlons(c, x + 4, y + 4, bw - 8, bh - 8, 5);
      // Keep
      rr(c, -20, y + bh / 2 - 22, 40, 40, 2); fs(c, STONE.light);
      courses(c, -20, y + bh / 2 - 22, 40, 40, 8);
      merlons(c, -20, y + bh / 2 - 22, 40, 40, 5);
      rr(c, -12, y + bh / 2 - 14, 24, 24, 2); fs(c, STONE.dark, INK, 1.2);
      // Gate
      c.beginPath(); c.moveTo(-9, y + bh - 4); c.lineTo(-9, y + bh - 14); c.arc(0, y + bh - 14, 9, Math.PI, 0); c.lineTo(9, y + bh - 4); c.closePath();
      fs(c, WOOD.dark, INK, 1.5);
      line(c, 0, y + bh - 22, 0, y + bh - 4, WOOD.deep, 1.2);
      // Corner towers with conical team roofs
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const tx = sx * (bw / 2 - 12), ty = y + bh / 2 + sy * (bh / 2 - 12);
        circle(c, tx, ty, 16); fs(c, STONE.base);
        ball(c, tx, ty, 12, t);
        circle(c, tx - 3, ty - 4, 2.5); fs(c, t.light, null);
      }
      banner(c, 0, y + bh / 2 - 2, t, 1.2);
    }, t);
  },

  // A timber storehouse: a thatched hip roof, a team pennant, sacks and a
  // heap of gold by the door (it is where Peasants bring the gold).
  depot(ctx, w, h, t) {
    block(ctx, w - 8, h - 8, 9, WOOD.dark, (c, bw, bh) => {
      const x = -bw / 2 + 4, y = -bh / 2 - 4, rw = bw - 8, rh = bh - 18;
      rr(c, x, y, rw, rh, 4); fs(c, THATCH.base);
      // Hip roof: the ridge and the four hips, the lit side lighter.
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + rw * 0.3, y + rh / 2); c.lineTo(x, y + rh); c.closePath();
      c.fillStyle = THATCH.light; c.fill();
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + rw, y); c.lineTo(x + rw * 0.7, y + rh / 2); c.lineTo(x + rw * 0.3, y + rh / 2); c.closePath();
      c.fillStyle = THATCH.light; c.globalAlpha = 0.5; c.fill(); c.globalAlpha = 1;
      c.lineWidth = 1; c.strokeStyle = THATCH.dark; // straw
      for (let i = 0; i < 22; i++) { const px = x + 4 + ((i * 37) % (rw - 8)), py = y + 4 + ((i * 23) % (rh - 8)); c.beginPath(); c.moveTo(px, py); c.lineTo(px + 3, py + 5); c.stroke(); }
      line(c, x + rw * 0.3, y + rh / 2, x + rw * 0.7, y + rh / 2, THATCH.dark, 3); // ridge
      for (const [ax, ay] of [[x, y], [x + rw, y], [x, y + rh], [x + rw, y + rh]]) line(c, ax, ay, ax < 0 ? x + rw * 0.3 : x + rw * 0.7, y + rh / 2, THATCH.dark, 1.5);
      rr(c, x, y, rw, rh, 4); c.lineWidth = 2; c.strokeStyle = INK; c.stroke();
      // Door, sacks and gold along the front
      const fy = y + rh;
      rr(c, -9, fy - 3, 18, 12, 2); fs(c, t.base, INK, 1.4); // team-painted door
      line(c, 0, fy - 2, 0, fy + 8, t.dark, 1.5);
      for (const [sx, sr] of [[-bw / 2 + 12, 6], [-bw / 2 + 22, 5]]) { circle(c, sx, fy + 6, sr); fs(c, '#d8c79e', INK, 1.2); }
      circle(c, bw / 2 - 16, fy + 5, 8); fs(c, GOLD.base, INK, 1.4); // gold heap
      circle(c, bw / 2 - 19, fy + 2, 3); fs(c, GOLD.light, null);
      banner(c, x + 6, y + 22, t, 1.3);
    }, t);
  },

  // A long timber barracks with a team-coloured tiled roof, a stone chimney
  // and a training yard with crossed swords and a shield.
  foundry(ctx, w, h, t) {
    block(ctx, w - 8, h - 8, 11, WOOD.dark, (c, bw, bh) => {
      const x = -bw / 2, y = -bh / 2 - 3, rh = bh * 0.62;
      rr(c, x, y, bw, rh, 4); fs(c, t.base); // roof
      rr(c, x, y, bw, rh / 2, 4); c.fillStyle = t.light; c.globalAlpha = 0.35; c.fill(); c.globalAlpha = 1;
      c.lineWidth = 1.2; c.strokeStyle = t.dark; // tile rows
      for (let py = y + 6; py < y + rh - 2; py += 6) { c.beginPath(); c.moveTo(x + 3, py); c.lineTo(x + bw - 3, py); c.stroke(); }
      line(c, x + 4, y + rh / 2, x + bw - 4, y + rh / 2, t.dark, 3); // ridge
      rr(c, x, y, bw, rh, 4); c.lineWidth = 2; c.strokeStyle = INK; c.stroke();
      rr(c, bw * 0.22, y - 3, 12, 12, 2); fs(c, STONE.base, INK, 1.4); // chimney
      glow(c, bw * 0.22 + 6, y + 3, 9, 'rgba(255, 150, 60, 0.55)');
      // Training yard in front
      const yy = y + rh + 2, yh = bh - rh - 4;
      rr(c, x + 3, yy, bw - 6, yh, 3); fs(c, DIRT.base, INK, 1.2);
      const cx = -bw * 0.18, cy = yy + yh / 2;
      for (const s of [-1, 1]) { // crossed swords
        line(c, cx - s * 11, cy - 9, cx + s * 11, cy + 9, METAL.light, 3);
        line(c, cx - s * 7, cy - 1 - s * 5, cx - s * 3, cy + 3 - s * 9, WOOD.deep, 2);
      }
      circle(c, bw * 0.2, cy, 8); fs(c, t.base, INK, 1.5); // shield
      circle(c, bw * 0.2, cy, 3); fs(c, GOLD.base, null);
    }, t);
  },

  // A round stone watchtower seen from above: battlements, a timber floor
  // and the team flag.
  spire(ctx, w, h, t) {
    block(ctx, w - 8, h - 8, 6, STONE.deep, (c, bw, bh) => {
      rr(c, -bw / 2, -bh / 2 - 3, bw, bh, 5); fs(c, STONE.dark);
      courses(c, -bw / 2, -bh / 2 - 3, bw, bh, 8);
    }, t);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; circle(ctx, 5, 2, 20); ctx.fill(); // tower shadow
    circle(ctx, 0, -5, 20); fs(ctx, STONE.base);
    for (let i = 0; i < 10; i++) { // merlons around the rim
      const a = (i / 10) * Math.PI * 2;
      ctx.save(); ctx.translate(Math.cos(a) * 17, -5 + Math.sin(a) * 17); ctx.rotate(a);
      ctx.fillStyle = STONE.light; ctx.fillRect(-3, -3, 6, 6); ctx.lineWidth = 1; ctx.strokeStyle = INK; ctx.strokeRect(-3, -3, 6, 6);
      ctx.restore();
    }
    circle(ctx, 0, -5, 12); fs(ctx, WOOD.base, INK, 1.4); // floor
    line(ctx, -12, -5, 12, -5, WOOD.dark, 1); line(ctx, -10, -11, 10, -11, WOOD.dark, 1); line(ctx, -10, 1, 10, 1, WOOD.dark, 1);
    circle(ctx, 0, -5, 5); fs(ctx, t.base, INK, 1.2);
    banner(ctx, 0, -5, t, 1);
  },
};

function tint(c) { const a = c.globalAlpha; c.globalAlpha = 0.45; c.fill(); c.globalAlpha = a; }

// The building's type, marked on its plot, so every type is recognisable from
// the moment it is placed (a Storehouse and a Barracks share a 3x3 footprint).
const STENCIL = {
  // A crenellated keep outline.
  core(c, s) { c.beginPath(); const q = s / 3; c.moveTo(-s, s); c.lineTo(-s, -s); for (let i = 0; i < 3; i++) { c.lineTo(-s + (2 * i + 1) * q, -s); c.lineTo(-s + (2 * i + 1) * q, -s + q); c.lineTo(-s + (2 * i + 2) * q, -s + q); c.lineTo(-s + (2 * i + 2) * q, -s); } c.lineTo(s, s); c.closePath(); tint(c); c.stroke(); },
  // A tied grain sack.
  depot(c, s) { circle(c, 0, s * 0.2, s * 0.75); tint(c); c.stroke(); c.beginPath(); c.moveTo(-s * 0.35, -s * 0.85); c.lineTo(0, -s * 0.45); c.lineTo(s * 0.35, -s * 0.85); c.stroke(); },
  // Crossed swords.
  foundry(c, s) { c.beginPath(); c.moveTo(-s, -s); c.lineTo(s, s); c.moveTo(s, -s); c.lineTo(-s, s); c.moveTo(-s * 0.7, s * 0.2); c.lineTo(-s * 0.2, s * 0.7); c.moveTo(s * 0.7, s * 0.2); c.lineTo(s * 0.2, s * 0.7); c.stroke(); },
  // A round tower with battlements.
  spire(c, s) { circle(c, 0, 0, s * 0.6); tint(c); c.stroke(); for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2; c.strokeRect(Math.cos(a) * s * 0.8 - 3, Math.sin(a) * s * 0.8 - 3, 6, 6); } },
};

// Foundation: a staked dirt plot roped off in the team colour, a stone block
// and a timber pile, and the type's mark.
function foundation(ctx, w, h, t, type) {
  // The Storehouse plot is strewn with straw; the others are bare earth.
  rr(ctx, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 5); fs(ctx, type === 'depot' ? DIRT.light : DIRT.base, null);
  ctx.setLineDash([7, 4]); ctx.lineWidth = 2.5; ctx.strokeStyle = t.base; ctx.stroke(); ctx.setLineDash([]);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { // corner stakes
    const x = (sx * (w - 12)) / 2, y = (sy * (h - 12)) / 2;
    if (sy < 0) { // the two back stakes fly claim pennants in the team colour
      ctx.beginPath(); ctx.moveTo(x, y - 1); ctx.lineTo(x + sx * -11, y + 3); ctx.lineTo(x, y + 8); ctx.closePath();
      fs(ctx, t.base, INK, 1);
    }
    circle(ctx, x, y, 3.5); fs(ctx, WOOD.light, INK, 1.2);
  }
  // Bold enough to read zoomed out: a translucent fill plus a thick outline.
  ctx.lineWidth = 5; ctx.strokeStyle = t.base; ctx.fillStyle = t.base;
  ctx.globalAlpha = 0.9;
  STENCIL[type](ctx, Math.min(w, h) * 0.3);
  ctx.globalAlpha = 1;
  rr(ctx, -0.3 * w - 6, 0.3 * h - 4, 12, 8, 2); fs(ctx, STONE.base, INK, 1.2); // stone block
  // Building materials: straw bundles for the thatched Storehouse, timber for the rest.
  const straw = type === 'depot';
  for (let i = 0; i < 3; i++) { rr(ctx, 0.3 * w - 9, 0.3 * h - 6 + i * 4, 18, 4, 2); fs(ctx, straw ? THATCH.light : WOOD.light, INK, 1); }
  if (straw) for (let i = 0; i < 3; i++) { rr(ctx, -0.3 * w - 8 + i * 6, -0.3 * h - 6, 5, 12, 2); fs(ctx, THATCH.base, INK, 1); }
}

// Frame: the building's lower part going up inside a timber scaffold.
function frame(ctx, w, h, t, type) {
  foundation(ctx, w, h, t, type);
  ctx.save();
  ctx.beginPath(); ctx.rect(-w / 2, 0 - h * 0.08, w, h / 2 + h * 0.08); ctx.clip(); // the lower half is built
  ctx.globalAlpha = 0.9;
  COMPLETE[type](ctx, w, h, t);
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip(); // scaffold stays on the footprint
  ctx.lineWidth = 3; ctx.strokeStyle = WOOD.light; // scaffold poles
  const m = 6;
  ctx.strokeRect(-w / 2 + m, -h / 2 + m, w - 2 * m, h - 2 * m);
  ctx.lineWidth = 1.8;
  for (let x = -w / 2 + m; x < w / 2 - m; x += 16) { ctx.beginPath(); ctx.moveTo(x, -h / 2 + m); ctx.lineTo(x + 16, h / 2 - m); ctx.stroke(); }
  for (let y = -h / 2 + m + 16; y < h / 2 - m; y += 16) { ctx.beginPath(); ctx.moveTo(-w / 2 + m, y); ctx.lineTo(w / 2 - m, y); ctx.stroke(); }
  ctx.restore();
}

export const BUILDING_TYPES = ['core', 'depot', 'foundry', 'spire'];

// Draw one building sprite (footprint w x h px) in `state`.
export function drawBuildingSprite(ctx, type, team, state, w, h) {
  const t = TEAM[team] || TEAM[2];
  if (state === 'foundation') foundation(ctx, w, h, t, type);
  else if (state === 'frame') frame(ctx, w, h, t, type);
  else COMPLETE[type](ctx, w, h, t);
}
