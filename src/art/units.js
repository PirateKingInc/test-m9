// Unit sprites, drawn with the Canvas 2D API around (0, 0), facing +x, in world
// pixels (the atlas scales for resolution). Pure drawing: no game state.
import { TEAM, INK, METAL, WOOD, GOLD, THATCH } from './palette.js';

// World-pixel box every unit sprite is drawn into (centered).
export const UNIT_BOX = 64;

function path(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
}

function fillStroke(ctx, fill, stroke = INK, width = 1.6) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = width;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

// A soft top-left highlight over whatever path is current.
function sheen(ctx, x, y, r, alpha = 0.35) {
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.5, 0, x, y, r * 1.2);
  g.addColorStop(0, `rgba(255,255,255,${alpha})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fill();
}

const SKIN = '#c99d78', HAIR = '#5a3a1e';
const BODY = { dragon: '#6b5a3c', dragonLight: '#9c8558', dragonDark: '#3e3322', horse: '#7a5230', horseDark: '#4a311c' };

function line(ctx, x0, y0, x1, y1, color, width) {
  ctx.lineWidth = width; ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}
function ellipse(ctx, x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); }

// Phase 5 roster, seen from above and facing +x (PHASE5_SPEC.md "Naming").
// Each has its own silhouette: small Peasant, long Horseman, Archer with a bow
// arc, wide Shield Knight, winged Dragon Rider. Team colour is on the clothes.
const DRAW = {
  // A small worker in a team tunic with a pickaxe; carrying, a gold sack on the back.
  drone(ctx, t, { carry = false } = {}) {
    line(ctx, -2, 5, 11, 5, WOOD.base, 2.2); // pick handle
    path(ctx, [[10, -1], [13, 5], [10, 11], [9, 5]]); // pick head
    fillStroke(ctx, METAL.light, INK, 1);
    if (carry) { circle(ctx, -7, 0, 5); fillStroke(ctx, GOLD.base, INK, 1.4); circle(ctx, -8, -1.5, 1.8); ctx.fillStyle = GOLD.light; ctx.fill(); }
    ellipse(ctx, 0, 0, 5.5, 8); // shoulders
    fillStroke(ctx, t.base);
    sheen(ctx, 0, 0, 7, 0.3);
    circle(ctx, 0.5, 0, 3.6); // head
    fillStroke(ctx, SKIN, INK, 1.1);
    ctx.beginPath(); ctx.arc(0, 0, 3.6, Math.PI * 0.5, Math.PI * 1.5); ctx.fillStyle = HAIR; ctx.fill();
  },

  // Light cavalry: a horse (long body, head forward, tail behind) and a rider
  // in a team tabard holding a sword out front.
  striker(ctx, t) {
    path(ctx, [[-13, 0], [-20, -2], [-21, 0], [-20, 2]]); // tail
    fillStroke(ctx, BODY.horseDark, INK, 1);
    ellipse(ctx, -1, 0, 13, 6.2); // horse body
    fillStroke(ctx, BODY.horse);
    ellipse(ctx, 14, 0, 6, 3.4); // neck and head
    fillStroke(ctx, BODY.horse, INK, 1.4);
    circle(ctx, 18.5, 0, 2.6); fillStroke(ctx, BODY.horseDark, INK, 1);
    for (const s of [-1, 1]) { path(ctx, [[11, s * 2.5], [12.5, s * 5], [13.5, s * 2.5]]); fillStroke(ctx, BODY.horseDark, INK, 0.8); } // ears
    ellipse(ctx, -2, 0, 9.5, 7.2); // team caparison over the horse's back
    fillStroke(ctx, t.base, INK, 1.2);
    ctx.fillStyle = t.light; ctx.globalAlpha = 0.45; ctx.fillRect(-10, -1, 16, 2); ctx.globalAlpha = 1;
    ellipse(ctx, 0, 0, 4.5, 7.5); // rider with tabard
    fillStroke(ctx, t.dark, INK, 1.2);
    sheen(ctx, 0, 0, 6, 0.3);
    line(ctx, 2, 5, 17, 10, METAL.light, 2.2); // sword
    line(ctx, 3.5, 3, 1.5, 8, GOLD.dark, 2);
    circle(ctx, 0.5, 0, 3.3); fillStroke(ctx, METAL.base, INK, 1.1); // helm
  },

  // A hooded archer behind a tall longbow arc, an arrow nocked.
  sparker(ctx, t) {
    ctx.beginPath(); ctx.moveTo(6, -14); ctx.quadraticCurveTo(17, 0, 6, 14); // bow
    ctx.lineWidth = 3.2; ctx.strokeStyle = INK; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = WOOD.light; ctx.stroke();
    line(ctx, 6, -14, 6, 14, '#f3ead6', 0.8); // string
    line(ctx, -3, 0, 15, 0, WOOD.light, 1.4); // arrow
    path(ctx, [[15, -2], [18.5, 0], [15, 2]]); fillStroke(ctx, METAL.light, INK, 0.8);
    ellipse(ctx, -2, 0, 5.5, 8); // cloak
    fillStroke(ctx, t.base);
    sheen(ctx, -2, 0, 7, 0.3);
    circle(ctx, -1.5, 0, 3.4); // hood
    fillStroke(ctx, t.dark, INK, 1.1);
    for (const y of [-2, 0, 2]) line(ctx, -9, y + 3, -6, y + 3, WOOD.light, 1); // quiver
  },

  // The biggest unit: a knight in plate behind a team tower shield, a mace at his side.
  bulwark(ctx, t) {
    line(ctx, -2, -12, 8, -17, WOOD.dark, 2.4); // mace
    circle(ctx, 9, -17.5, 3.4); fillStroke(ctx, METAL.base, INK, 1.2);
    ellipse(ctx, -3, 0, 10, 13.5); // plate body
    fillStroke(ctx, METAL.base, INK, 2);
    sheen(ctx, -3, 0, 12, 0.4);
    ellipse(ctx, -4, 0, 6, 9); // team tabard
    fillStroke(ctx, t.base, INK, 1.2);
    circle(ctx, -3, 0, 4.2); // helm
    fillStroke(ctx, METAL.light, INK, 1.2);
    line(ctx, -1, -2.5, -1, 2.5, INK, 1.2); // visor slit
    ctx.beginPath(); // tower shield
    ctx.roundRect(7, -16, 9, 32, 3);
    fillStroke(ctx, t.base, INK, 1.8);
    ctx.fillStyle = t.light; ctx.globalAlpha = 0.5; ctx.fillRect(9, -13, 2.5, 26); ctx.globalAlpha = 1;
    line(ctx, 11.5, -9, 11.5, 9, GOLD.base, 2.2); // cross emblem
    line(ctx, 8.5, -3, 14.5, -3, GOLD.base, 2.2);
  },

  // A small dragon with spread team-coloured wings, a long neck and tail,
  // and a rider on its back. Its breath melts plate.
  lancer(ctx, t, { rider = true, body = { base: BODY.dragon, light: BODY.dragonLight, dark: BODY.dragonDark } } = {}) {
    for (const s of [-1, 1]) { // wings: bat-like membranes with finger bones
      path(ctx, [[2, s * 3], [-4, s * 22], [-8, s * 17], [-12, s * 20], [-13, s * 12], [-17, s * 13], [-8, s * 3]]);
      fillStroke(ctx, t.base, INK, 1.4);
      ctx.fillStyle = t.dark; ctx.globalAlpha = 0.45; ctx.fill(); ctx.globalAlpha = 1;
      for (const [x, y] of [[-4, 22], [-12, 20], [-17, 13]]) line(ctx, 0, s * 3, x, s * y, body.dark, 1.2);
    }
    path(ctx, [[-8, -2.5], [-22, 0], [-8, 2.5]]); // tail
    fillStroke(ctx, body.base, INK, 1.2);
    path(ctx, [[-22, 0], [-26, -3], [-25, 0], [-26, 3]]); fillStroke(ctx, body.dark, INK, 0.8); // tail spade
    ellipse(ctx, -1, 0, 9, 5.5); // body
    fillStroke(ctx, body.base);
    sheen(ctx, -1, 0, 8, 0.3);
    path(ctx, [[6, -2.5], [15, -2], [15, 2], [6, 2.5]]); // neck
    fillStroke(ctx, body.base, INK, 1.1);
    path(ctx, [[14, -4], [21, -1.5], [22, 0], [21, 1.5], [14, 4]]); // head
    fillStroke(ctx, body.light, INK, 1.2);
    for (const s of [-1, 1]) { path(ctx, [[14, s * 3], [11, s * 6], [15.5, s * 3.5]]); fillStroke(ctx, '#e8dcc0', INK, 0.8); } // horns
    circle(ctx, 18, -1.5, 0.9); ctx.fillStyle = '#ffb030'; ctx.fill(); // eye
    if (rider) { circle(ctx, -2, 0, 3.4); fillStroke(ctx, t.light, INK, 1.1); } // rider
  },

  // Verification-only training dummy (dev panel): a straw target, not a game unit.
  dummy(ctx, t) {
    for (const [r, c] of [[12, THATCH.light], [8.5, t.base], [5, THATCH.light], [2, t.base]]) { circle(ctx, 0, 0, r); fillStroke(ctx, c, INK, r === 12 ? 1.6 : 0.6); }
  },
};

export const UNIT_TYPES = ['drone', 'striker', 'sparker', 'bulwark', 'lancer', 'dummy'];

// Draw one unit sprite at the current transform's origin.
export function drawUnitSprite(ctx, type, team, opts) {
  DRAW[type](ctx, TEAM[team] || TEAM[2], opts);
}

// The team ground ring drawn under every unit (does not rotate).
export function drawTeamRing(ctx, team, r) {
  const t = TEAM[team] || TEAM[2];
  ctx.beginPath();
  ctx.ellipse(0, r * 0.25, r * 1.35, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = t.base;
  ctx.globalAlpha = 0.85;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// The dragon alone in any colours (the title-screen emblem, src/game/emblem.js).
export function drawDragon(ctx, wings, body) {
  DRAW.lancer(ctx, wings, { rider: false, body });
}
