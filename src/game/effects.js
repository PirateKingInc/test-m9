// Render-only "juice": arrows, dragonfire, sparks, death bursts, floating text and screen
// shake, spawned from sim events. Never touches sim state, so it can use
// Math.random freely without affecting determinism.
import { TEAM, GOLD, hex } from '../art/palette.js';
import { PLAYER } from './player.js';
const LIFE = { arrow: 0.16, flame: 0.28, spark: 0.18, burst: 0.7, text: 0.9, ring: 0.5, flash: 0.12, shock: 1.1 };
const MAX_EFFECTS = 400;
const TEAM_FX = Object.fromEntries(Object.entries(TEAM).map(([t, c]) => [t, hex(c.base)]));
const GOLD_FX = hex(GOLD.base);

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.texts = [];
  }

  add(events, now) {
    for (const e of events) {
      if (e.type === 'attack') {
        // Phase 5: Archers and Watchtowers loose arrows; the Dragon Rider breathes fire.
        if (e.attack === 'bolt') this.push({ kind: 'arrow', t: now, x: e.x, y: e.y, tx: e.tx, ty: e.ty });
        if (e.attack === 'lance') this.push({ kind: 'flame', t: now, x: e.x, y: e.y, tx: e.tx, ty: e.ty });
        this.push({ kind: 'spark', t: now, x: e.tx + (Math.random() - 0.5) * 10, y: e.ty + (Math.random() - 0.5) * 10, big: e.attack === 'crush' || e.attack === 'lance' });
        this.push({ kind: 'flash', t: now, id: e.target }); // the target blinks white when hit
      } else if (e.type === 'death' && e.unit === 'core') {
        // A Command Core falling: shockwave, heavy debris, a long shake and a flash.
        const parts = Array.from({ length: 60 }, () => {
          const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 260;
          return { vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 2 + Math.random() * 4 };
        });
        this.push({ kind: 'burst', t: now, x: e.x, y: e.y, parts, color: TEAM_FX[e.team] ?? TEAM_FX[2] });
        this.push({ kind: 'shock', t: now, x: e.x, y: e.y });
        this.scene.cameras.main.shake(700, 0.018);
        this.scene.cameras.main.flash(350, 255, 230, 200);
      } else if (e.type === 'death') {
        const n = e.kind === 'building' ? 28 : 12;
        const parts = Array.from({ length: n }, () => {
          const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * (e.kind === 'building' ? 160 : 90);
          return { vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 1.5 + Math.random() * 3 };
        });
        this.push({ kind: 'burst', t: now, x: e.x, y: e.y, parts, color: TEAM_FX[e.team] ?? TEAM_FX[2] });
        this.push({ kind: 'ring', t: now, x: e.x, y: e.y, r: e.kind === 'building' ? 70 : 26 });
        if (e.kind === 'building') this.scene.cameras.main.shake(260, 0.008);
      } else if (e.type === 'placed' && e.x !== undefined) {
        // Construction starts: a dust puff around the footprint.
        const parts = Array.from({ length: 14 }, () => {
          const a = Math.random() * Math.PI * 2, v = 30 + Math.random() * 40;
          return { vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 2 + Math.random() * 2 };
        });
        this.push({ kind: 'burst', t: now, x: e.x, y: e.y, parts, color: 0x8a7a66 });
      } else if (e.type === 'depleted') {
        // A gold mine runs dry and crumbles.
        const parts = Array.from({ length: 16 }, () => {
          const a = Math.random() * Math.PI * 2, v = 50 + Math.random() * 70;
          return { vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 1.5 + Math.random() * 2.5 };
        });
        this.push({ kind: 'burst', t: now, x: e.x, y: e.y, parts, color: GOLD_FX });
        this.floatText(e.x, e.y - 18, 'Mined out', GOLD.light);
      } else if (e.type === 'dropoff' && e.team === PLAYER) {
        this.floatText(e.x, e.y - 14, `+${e.amount}`, GOLD.base);
      } else if (e.type === 'built') {
        const b = this.scene.world.get(e.id);
        if (b) this.push({ kind: 'ring', t: now, x: b.x, y: b.y, r: Math.max(b.pw, b.ph) * 0.8, color: 0x7dffb0 });
      } else if (e.type === 'trained') {
        const u = this.scene.world.get(e.id);
        if (u) this.push({ kind: 'ring', t: now, x: u.x, y: u.y, r: 18, color: 0x7dffb0 });
      }
    }
  }

  push(fx) {
    if (this.list.length < MAX_EFFECTS) this.list.push(fx);
  }

  floatText(x, y, str, color) {
    const t = this.scene.add.text(x, y, str, { fontFamily: 'system-ui, sans-serif', fontSize: '13px', fontStyle: 'bold', color })
      .setOrigin(0.5).setStroke('#0b0f17', 3).setDepth(10);
    this.scene.tweens.add({ targets: t, y: y - 26, alpha: 0, duration: LIFE.text * 1000, onComplete: () => t.destroy() });
  }

  draw(g, now) {
    this.list = this.list.filter((fx) => {
      const age = now - fx.t, life = LIFE[fx.kind], k = 1 - age / life;
      if (k <= 0) return false;
      if (fx.kind === 'arrow') {
        // A shaft flying from the shooter to the target.
        const p = 1 - k, dx = fx.tx - fx.x, dy = fx.ty - fx.y, len = Math.hypot(dx, dy) || 1;
        const hx = fx.x + dx * p, hy = fx.y + dy * p, ux = dx / len, uy = dy / len;
        g.lineStyle(2, 0x6b4a2a, 1);
        g.lineBetween(hx - ux * 12, hy - uy * 12, hx, hy);
        g.fillStyle(0xd8dde4, 1);
        g.fillTriangle(hx + ux * 4, hy + uy * 4, hx - uy * 2.5, hy + ux * 2.5, hx + uy * 2.5, hy - ux * 2.5);
      } else if (fx.kind === 'flame') {
        // A jet of dragonfire: puffs along the line, hottest at the mouth.
        const dx = fx.tx - fx.x, dy = fx.ty - fx.y, reach = Math.min(1, (1 - k) * 3);
        for (let i = 0; i <= 8; i++) {
          const f = (i / 8) * reach;
          g.fillStyle(i < 3 ? 0xfff0a0 : i < 6 ? 0xffa030 : 0xe0401a, k * 0.85);
          g.fillCircle(fx.x + dx * f, fx.y + dy * f, 3 + f * 6);
        }
      } else if (fx.kind === 'spark') {
        g.fillStyle(0xfff3c4, k);
        g.fillCircle(fx.x, fx.y, (fx.big ? 7 : 4) * k + 1);
      } else if (fx.kind === 'burst') {
        for (const p of fx.parts) {
          g.fillStyle(fx.color, k);
          g.fillCircle(fx.x + p.vx * age, fx.y + p.vy * age, p.r * k + 0.5);
        }
      } else if (fx.kind === 'flash') {
        const t = this.scene.world.get(fx.id);
        if (!t) return false;
        g.fillStyle(0xffffff, 0.55 * k);
        if (t.kind === 'building') g.fillRect(t.x - t.pw / 2, t.y - t.ph / 2, t.pw, t.ph);
        else g.fillCircle(t.x, t.y, t.radius + 1);
      } else if (fx.kind === 'shock') {
        g.lineStyle(6 * k + 1, 0xfff0d0, k);
        g.strokeCircle(fx.x, fx.y, 40 + (1 - k) * 260);
        g.lineStyle(3, 0xff9a60, k * 0.8);
        g.strokeCircle(fx.x, fx.y, 20 + (1 - k) * 170);
      } else if (fx.kind === 'ring') {
        g.lineStyle(3, fx.color ?? 0xffe0b0, k);
        g.strokeCircle(fx.x, fx.y, fx.r * (1.2 - k * 0.7));
      }
      return true;
    });
  }
}
