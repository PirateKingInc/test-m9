import { SIM_DT } from '../sim/constants.js';
import { PLAYER } from './player.js';
import { drawProgress, drawSelection, drawMarker, drawGhost, drawHealth, drawCrosshair } from './draw.js';
import { InputController } from './input.js';
import { Effects } from './effects.js';
import { MatchStats } from './stats.js';
import { bakeAll, TERRAIN_KEY } from '../art/atlas.js';
import { SpriteLayer } from './sprites.js';
import { zoomAbout, wheelZoom, hudBounds } from './camera.js';
import { reasonText } from '../theme/names.js';
import { drawTerritory, ZONE_DEPTH, BANNER_DEPTH } from './territory.js';

const Phaser = globalThis.Phaser;
const PAN_SPEED = 900; // px/s
const EDGE = 14; // px from the canvas edge that triggers edge-panning
const MAX_STEPS_PER_FRAME = 8; // avoid a spiral of death after a stall
const UNDER_ATTACK_COOLDOWN = 15; // s of game time between under-attack alerts

export class GameScene extends Phaser.Scene {
  // stepSim: advances one fixed step (the world alone in the sandbox, or the
  // Match, i.e. world then AI, in match mode).
  constructor(world, hud, sfx, stepSim = () => world.step()) {
    super('game');
    this.world = world;
    this.stepSim = stepSim;
    this.hud = hud;
    this.sfx = sfx;
    this.acc = 0;
  }

  create() {
    const w = this.world;
    bakeAll(this.textures, w.grid); // Phase 4: every sprite and the terrain, drawn in code
    this.add.image(0, 0, TERRAIN_KEY).setOrigin(0).setDepth(0);
    this.sprites = new SpriteLayer(this);
    this.gfx = this.add.graphics().setDepth(4); // overlays above the sprites
    if (w.zones) { // free-for-all territory (Phase 6)
      this.zoneGfx = this.add.graphics().setDepth(ZONE_DEPTH);
      this.bannerGfx = this.add.graphics().setDepth(BANNER_DEPTH);
    }
    this.fxGfx = this.add.graphics().setDepth(5);
    this.effects = new Effects(this);
    this.stats = new MatchStats();
    if (this.hud) this.hud.stats = this.stats;

    const cam = this.cameras.main;
    this.fitBounds(); // leave room under the HUD bars
    this.centerOnCore();

    this.input.mouse.disableContextMenu();
    this.keys = this.input.keyboard.addKeys('UP,DOWN,LEFT,RIGHT,HOME');
    this.keys.HOME.on('down', () => this.centerOnCore());
    this.input.keyboard.on('keydown-SPACE', () => this.jumpToAttack());
    if (this.hud) this.hud.onAlertTap = () => this.jumpToAttack();
    this.pointerInside = false;
    this.game.canvas.addEventListener('mouseenter', () => { this.pointerInside = true; });
    this.game.canvas.addEventListener('mouseleave', () => { this.pointerInside = false; });
    this.input.on('pointermove', (p) => {
      if (p.middleButtonDown() && this.midDrag) {
        cam.scrollX = this.midDrag.sx - (p.x - this.midDrag.x);
        cam.scrollY = this.midDrag.sy - (p.y - this.midDrag.y);
      }
    });
    this.input.on('pointerdown', (p) => {
      if (p.middleButtonDown()) this.midDrag = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY };
    });
    this.input.on('pointerup', () => { this.midDrag = null; });
    // Desktop zoom (Phase 5): the mouse wheel zooms about the cursor, over the
    // same range as pinch on touch.
    this.input.on('wheel', (p, _objs, _dx, dy) => zoomAbout(cam, p.x, p.y, wheelZoom(cam.zoom, dy)));
    this.ui = new InputController(this, w);
    this.ui.on((name) => {
      if (name === 'select' || name === 'command') this.sfx?.ui(name);
    });
  }

  // Camera bounds follow the zoom and input mode (see camera.js hudBounds).
  fitBounds() {
    const cam = this.cameras.main, sig = `${cam.zoom}:${!!this.touchMode}`;
    if (sig === this.boundsSig) return;
    this.boundsSig = sig;
    cam.setBounds(...hudBounds(cam.zoom, this.world.width, this.world.height, this.touchMode));
  }

  jumpToAttack() {
    if (this.lastAttack) this.cameras.main.centerOn(this.lastAttack.x, this.lastAttack.y);
  }

  centerOnCore() {
    for (const b of this.world.ofKind('building')) {
      if (b.type === 'core' && b.team === PLAYER) { this.cameras.main.centerOn(b.x, b.y); return; }
    }
  }

  panCamera(dt) {
    const cam = this.cameras.main, k = this.keys, p = this.input.activePointer;
    let dx = 0, dy = 0;
    if (k.LEFT.isDown) dx -= 1;
    if (k.RIGHT.isDown) dx += 1;
    if (k.UP.isDown) dy -= 1;
    if (k.DOWN.isDown) dy += 1;
    if (this.pointerInside && !this.midDrag && !this.touchMode) {
      const { width, height } = this.scale;
      if (p.x < EDGE) dx -= 1;
      if (p.x > width - EDGE) dx += 1;
      if (p.y < EDGE) dy -= 1;
      if (p.y > height - EDGE) dy += 1;
    }
    cam.scrollX += dx * PAN_SPEED * dt;
    cam.scrollY += dy * PAN_SPEED * dt;
  }

  update() {
    // Wall-clock delta: Phaser's delta is smoothed/capped, which starves the
    // fixed-timestep accumulator (and slows the sim) whenever frames are slow.
    const now = performance.now();
    const dt = Math.min(now - (this.lastNow ?? now), 250) / 1000;
    this.lastNow = now;
    this.fitBounds();
    this.panCamera(dt);
    // ?speed=N runs the (unchanged) sim N times faster: for demos and the
    // mobile playthrough test. The sim still advances in fixed SIM_DT steps.
    const speed = this.speed || 1, maxSteps = MAX_STEPS_PER_FRAME * speed;
    this.acc += dt * speed;
    let steps = 0;
    while (this.acc >= SIM_DT && steps < maxSteps) {
      // A multiplayer match returns false when it must wait (Phase 11).
      if (this.stepSim() === false) { this.acc = Math.min(this.acc, SIM_DT); break; }
      this.acc -= SIM_DT;
      steps++;
    }
    if (steps === maxSteps) this.acc = 0;
    const events = this.world.drainEvents();
    if (events.length) {
      const mid = this.cameras.main.midPoint;
      this.sfx?.handle(events, mid.x, mid.y);
      this.effects.add(events, this.world.time);
      this.stats.add(events);
      for (const e of events) {
        if (e.type === 'rejected' && e.team === PLAYER) this.hud?.toast(reasonText(e.reason));
        if (e.type === 'eliminated' || e.type === 'zoneCaptured') this.hud?.ffaEvent(e);
        // Under-attack cue: enemy fire hitting our units or buildings (throttled).
        if (e.type === 'attack' && e.team !== PLAYER && this.world.get(e.target)?.team === PLAYER) {
          this.lastAttack = { x: e.tx, y: e.ty };
          if (this.world.time - (this.lastAlertAt ?? -Infinity) >= UNDER_ATTACK_COOLDOWN) {
            this.lastAlertAt = this.world.time;
            this.hud?.toast(this.touchMode ? 'Your lands are under attack! Tap here to ride there' : 'Your lands are under attack! (Space to jump there)', { alert: true });
            this.sfx?.ui('alert');
          }
        }
      }
    }
    this.render(this.acc / SIM_DT);
    this.hud?.update(this.world, this.game.loop.actualFps, this.ui);
  }

  render(alpha) {
    const g = this.gfx, w = this.world;
    g.clear();
    if (this.zoneGfx) drawTerritory(this.zoneGfx, this.bannerGfx, w, this.cameras.main.zoom, performance.now() / 1000);
    for (const b of w.ofKind('building')) if (!b.built) drawProgress(g, b);
    this.sprites.sync(w, alpha);
    const sel = this.ui.selection;
    for (const b of w.ofKind('building')) if (sel.has(b.id)) drawSelection(g, b, b.x, b.y);
    for (const n of w.ofKind('node')) if (sel.has(n.id)) drawSelection(g, n, n.x, n.y);
    for (const u of w.ofKind('unit')) {
      const x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha;
      if (sel.has(u.id)) drawSelection(g, u, x, y);
      if (u.order.type === 'build' && !u.path && w.tick % 4 < 2) { g.fillStyle(0xffe08a, 1); g.fillCircle(x + Math.cos(u.facing) * u.radius, y + Math.sin(u.facing) * u.radius, 2.5); }
      if (u.hp < u.maxHp || sel.has(u.id)) drawHealth(g, x, y - u.radius - 7, u.radius * 2, u.hp / u.maxHp);
    }
    for (const b of w.ofKind('building')) {
      if (b.hp < b.maxHp || sel.has(b.id)) drawHealth(g, b.x, b.y - b.ph / 2 - 6, b.pw - 12, b.hp / b.maxHp);
    }
    if (this.ui.attackMode || this.ui.devSpawn) drawCrosshair(g, this.ui.hover, this.ui.devSpawn ? 0xe0472f : 0xff5a5a);
    if (this.ui.armed) { // touch: a pulsing ring on each selected unit while an order is armed
      const k = 0.5 + 0.5 * Math.sin(w.time * 8);
      g.lineStyle(3, this.ui.armed === 'attack' ? 0xff5a5a : 0xffd24a, 0.5 + 0.5 * k);
      for (const e of this.ui.ownSelected()) g.strokeCircle(e.x, e.y, (e.radius ?? Math.max(e.pw, e.ph) / 2) + 8 + 4 * k);
    }
    this.fxGfx.clear();
    this.effects.draw(this.fxGfx, w.time);
    const ghost = this.ui.ghost();
    if (ghost) drawGhost(g, ghost, w.grid.tile);
    this.ui.markers = this.ui.markers.filter((m) => drawMarker(g, m, w.time));
    const d = this.ui.drag;
    if (d?.moved) {
      g.fillStyle(0x3f86e8, 0.1);
      g.fillRect(Math.min(d.wx, d.cx), Math.min(d.wy, d.cy), Math.abs(d.cx - d.wx), Math.abs(d.cy - d.wy));
      g.lineStyle(1, 0x9cc4ff, 0.9);
      g.strokeRect(Math.min(d.wx, d.cx), Math.min(d.wy, d.cy), Math.abs(d.cx - d.wx), Math.abs(d.cy - d.wy));
    }
  }
}
