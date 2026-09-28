// The title-screen emblem (Phase 5): a heraldic shield split in the two team
// colours with a gold dragon on it. Drawn in code with the same dragon as the
// Dragon Rider sprite, so there is no image file.
import { drawDragon } from '../art/units.js';
import { TEAM, GOLD, INK } from '../art/palette.js';

export function drawEmblem(canvas) {
  const W = 132, H = 140, dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  const shield = () => {
    ctx.beginPath();
    ctx.moveTo(10, 8); ctx.lineTo(W - 10, 8); ctx.lineTo(W - 10, 62);
    ctx.quadraticCurveTo(W - 14, 112, W / 2, H - 4);
    ctx.quadraticCurveTo(14, 112, 10, 62); ctx.closePath();
  };
  // Party per pale: Azure and Crimson, the two sides of the march.
  ctx.save(); shield(); ctx.clip();
  ctx.fillStyle = TEAM[1].dark; ctx.fillRect(0, 0, W / 2, H);
  ctx.fillStyle = TEAM[2].dark; ctx.fillRect(W / 2, 0, W / 2, H);
  const g = ctx.createRadialGradient(W / 2, 50, 4, W / 2, 60, 80);
  g.addColorStop(0, 'rgba(255, 230, 160, 0.35)'); g.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.restore();
  shield(); ctx.lineWidth = 5; ctx.strokeStyle = GOLD.base; ctx.stroke();
  shield(); ctx.lineWidth = 1.5; ctx.strokeStyle = INK; ctx.stroke();
  // The dragon rampant, head up.
  ctx.save();
  ctx.translate(W / 2 + 2, 70); ctx.rotate(-Math.PI / 2); ctx.scale(2.3, 2.3);
  const gold = { base: GOLD.base, light: GOLD.light, dark: GOLD.dark };
  drawDragon(ctx, gold, gold);
  ctx.restore();
}
