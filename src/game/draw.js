// Overlays drawn with Phaser Graphics each frame: selection, markers, the
// placement ghost, health and progress bars. Sprites live in src/art.


// Construction progress bar under an unfinished building's footprint.
export function drawProgress(g, b) {
  const l = b.x - b.pw / 2 + 6, w = b.pw - 12, y = b.y + b.ph / 2 - 10;
  g.fillStyle(0x000000, 0.7);
  g.fillRect(l - 1, y - 1, w + 2, 7);
  g.fillStyle(0xffc24a, 1);
  g.fillRect(l, y, w * b.progress, 5);
}

const SELECT = 0x7dffb0;
const MARKER_COLORS = { move: 0x7dffb0, attack: 0xff5a5a, gather: 0xf2c23a, build: 0xffc24a };

export function drawSelection(g, e, x, y) {
  g.lineStyle(2, e.team && e.team !== 1 ? 0xff5a5a : SELECT, 0.9);
  if (e.kind === 'unit') g.strokeEllipse(x, y + e.radius * 0.35, e.radius * 2.6, e.radius * 1.5);
  else g.strokeRect(x - e.pw / 2 - 2, y - e.ph / 2 - 2, e.pw + 4, e.ph + 4);
}

// Returns false once the marker has expired.
export function drawMarker(g, m, now) {
  const age = now - m.t, life = 0.7;
  if (age > life) return false;
  const k = 1 - age / life;
  g.lineStyle(2, MARKER_COLORS[m.kind] ?? SELECT, k);
  g.strokeCircle(m.x, m.y, 4 + 14 * k);
  g.strokeCircle(m.x, m.y, 2 + 26 * (1 - k) * (1 - k)); // outward pulse
  g.lineBetween(m.x - 5, m.y, m.x + 5, m.y);
  g.lineBetween(m.x, m.y - 5, m.x, m.y + 5);
  return true;
}

export function drawGhost(g, gh, T) {
  const color = gh.valid ? 0x7dffb0 : 0xff5a5a;
  g.fillStyle(color, 0.22);
  g.fillRect(gh.tx * T, gh.ty * T, gh.w * T, gh.h * T);
  g.lineStyle(2, color, 0.9);
  g.strokeRect(gh.tx * T, gh.ty * T, gh.w * T, gh.h * T);
  g.lineStyle(1, color, 0.35);
  for (let i = 1; i < gh.w; i++) g.lineBetween((gh.tx + i) * T, gh.ty * T, (gh.tx + i) * T, (gh.ty + gh.h) * T);
  for (let i = 1; i < gh.h; i++) g.lineBetween(gh.tx * T, (gh.ty + i) * T, (gh.tx + gh.w) * T, (gh.ty + i) * T);
}

export function drawHealth(g, x, y, w, frac) {
  const f = Math.max(0, Math.min(1, frac));
  g.fillStyle(0x000000, 0.6);
  g.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
  g.fillStyle(f > 0.6 ? 0x5cff8a : f > 0.3 ? 0xffd24a : 0xff5a5a, 1);
  g.fillRect(x - w / 2, y, w * f, 3);
}

export function drawCrosshair(g, p, color) {
  g.lineStyle(2, color, 0.9);
  g.strokeCircle(p.x, p.y, 10);
  g.lineBetween(p.x - 15, p.y, p.x - 5, p.y);
  g.lineBetween(p.x + 5, p.y, p.x + 15, p.y);
  g.lineBetween(p.x, p.y - 15, p.x, p.y - 5);
  g.lineBetween(p.x, p.y + 5, p.x, p.y + 15);
}
