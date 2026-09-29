// The territory overlay (Phase 6, PHASE6_SPEC.md "Territory"): each owned zone
// is tinted in its owner's colour with a thick border and a banner at its
// centre; contested zones flash; every zone's outline shows faintly. Line
// widths and the banner grow as the camera zooms out, so the map still reads
// at 0.35x. Render only: it reads world.zones and never changes them.
import { TEAM, hex } from '../art/palette.js';

export const ZONE_DEPTH = 0.5; // tints and borders: above the terrain, below mines, buildings and units
export const BANNER_DEPTH = 3.6; // banners: above everything on the ground
export const ZONE_TINT_ALPHA = 0.16;

export function drawTerritory(g, banners, world, zoom, now) {
  g.clear();
  banners.clear();
  const T = world.grid.tile, px = 1 / zoom; // one screen pixel in world px
  const flash = Math.floor(now * 2) % 2 === 0;
  for (const z of world.zones) {
    const [tx, ty, tw, th] = z.rect, x = tx * T, y = ty * T, w = tw * T, h = th * T;
    const c = z.owner != null ? hex(TEAM[z.owner].base) : null;
    if (c != null) {
      g.fillStyle(c, ZONE_TINT_ALPHA);
      g.fillRect(x, y, w, h);
    }
    // Border: the owner's colour (white on alternate beats while contested),
    // faint for neutral zones.
    const bw = Math.max(6, 3 * px);
    const stroke = z.contested && flash ? 0xffffff : c ?? 0xf1e4c3;
    g.lineStyle(c != null || z.contested ? bw : Math.max(2, px), stroke, c != null || z.contested ? 0.75 : 0.25);
    g.strokeRect(x + bw / 2, y + bw / 2, w - bw, h - bw);
    if (c != null) { // a banner in the zone's upper part, big enough to spot from far out
      const b = banners, s = Math.max(1, 0.6 * px), cx = x + w * 0.25, cy = y + h * 0.3;
      b.fillStyle(0x3a2514, 0.9);
      b.fillRect(cx - 2 * s, cy - 30 * s, 4 * s, 44 * s);
      b.fillStyle(c, 0.95);
      b.fillTriangle(cx + 2 * s, cy - 30 * s, cx + 34 * s, cy - 22 * s, cx + 2 * s, cy - 12 * s);
      b.lineStyle(2 * s, 0x0b0f17, 0.9);
      b.strokeTriangle(cx + 2 * s, cy - 30 * s, cx + 34 * s, cy - 22 * s, cx + 2 * s, cy - 12 * s);
    }
  }
}
