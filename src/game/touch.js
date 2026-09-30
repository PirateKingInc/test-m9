// Touch gestures -> the same InputController methods the mouse uses (Phase 4).
// This layer only captures gestures; every order still goes through the
// controller's selectAt/selectBox/command/attackMoveTo/place, which are the
// only callers of world.issue(). See PHASE4_SPEC.md "The touch model".
import { pickAt } from '../sim/selection.js';
import { PLAYER } from './player.js';
import { ZOOM, zoomAbout } from './camera.js';

export const TOUCH = {
  tapSlop: 10, // screen px a finger may wander and still count as a tap
  pickSlop: 22, // screen px of extra pick radius for a fingertip
  doubleTap: 0.4, // s (wall clock) between taps on the same unit type
  minZoom: ZOOM.min, // shared with the desktop mouse wheel (camera.js)
  maxZoom: ZOOM.max,
};

export class TouchInput {
  // ui: the InputController; cam: () => the Phaser camera.
  constructor(ui, cam) {
    this.ui = ui;
    this.cam = cam;
    this.active = new Map(); // pointer id -> { sx, sy, x, y }
    this.gesture = null; // { kind: 'tap' | 'pan' | 'box' | 'place', ... } or { kind: 'pinch', ... }
    this.lastTap = null;
  }

  // World point under a screen point, using the camera.
  world(sx, sy) {
    const p = this.cam().getWorldPoint(sx, sy);
    return { x: p.x, y: p.y };
  }

  down(p) {
    this.active.set(p.id, { sx: p.x, sy: p.y, x: p.x, y: p.y });
    if (this.active.size === 2) { this.startPinch(); return; }
    if (this.active.size > 2) return;
    const w = this.world(p.x, p.y);
    const kind = this.ui.placing ? 'place' : this.ui.boxArmed ? 'box' : 'tap';
    this.gesture = { kind, id: p.id, sx: p.x, sy: p.y, lx: p.x, ly: p.y, wx: w.x, wy: w.y, moved: false };
    if (kind === 'place') this.ui.hover = w;
    if (kind === 'box') this.ui.drag = { sx: p.x, sy: p.y, wx: w.x, wy: w.y, cx: w.x, cy: w.y, moved: false, touch: true };
  }

  move(p) {
    const a = this.active.get(p.id);
    if (!a) return;
    a.x = p.x; a.y = p.y;
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch') { this.updatePinch(); return; }
    if (g.id !== p.id) return;
    if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) > TOUCH.tapSlop) {
      g.moved = true;
      if (g.kind === 'tap') g.kind = 'pan';
    }
    const w = this.world(p.x, p.y);
    if (g.kind === 'pan') {
      const cam = this.cam();
      cam.scrollX -= (p.x - g.lx) / cam.zoom;
      cam.scrollY -= (p.y - g.ly) / cam.zoom;
    } else if (g.kind === 'place') {
      this.ui.hover = w;
    } else if (g.kind === 'box' && this.ui.drag) {
      Object.assign(this.ui.drag, { cx: w.x, cy: w.y, moved: g.moved });
    }
    g.lx = p.x; g.ly = p.y;
  }

  up(p) {
    this.active.delete(p.id);
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (!this.active.size) this.gesture = null; // wait for every finger to lift
      return;
    }
    if (g.id !== p.id) return;
    this.gesture = null;
    const w = this.world(p.x, p.y);
    if (g.kind === 'place') {
      this.ui.hover = w;
      this.ui.place(false);
    } else if (g.kind === 'box') {
      this.ui.drag = null;
      this.ui.boxArmed = false;
      if (g.moved) this.ui.selectBox(g.wx, g.wy, w.x, w.y, false);
    } else if (g.kind === 'tap') {
      // When the finger actually lifted (the native event time), so a double-tap
      // is judged by the player's timing, not by how fast frames are processed.
      this.tap(w.x, w.y, (p.upTime || performance.now()) / 1000);
    }
  }

  // Everything a tap can mean, depending on what is armed.
  tap(x, y, now = performance.now() / 1000) {
    const ui = this.ui, cam = this.cam();
    // A unit exactly under the finger, else the building or crystal under it,
    // else the nearest unit within a fingertip. (A plain wide pick would let a
    // Drone walking across a Foundry steal a tap aimed at the Foundry.)
    const target = pickAt(ui.world, x, y) || pickAt(ui.world, x, y, TOUCH.pickSlop / cam.zoom);
    // Aim orders at the picked entity's center, so the controller's own pick
    // finds exactly what the fingertip covered.
    const at = target ? { x: target.x, y: target.y } : { x, y };
    if (ui.armed === 'order') { ui.command(at.x, at.y); ui.disarm(); return; }
    if (ui.armed === 'attack') {
      const enemy = target && target.team && target.team !== PLAYER;
      ui.attackMoveTo(enemy ? at.x : x, enemy ? at.y : y);
      ui.disarm();
      return;
    }
    if (!target) { ui.selection.clear(); this.lastTap = null; return; }
    const prev = this.lastTap; // wall clock: a UI gesture, not game time
    this.lastTap = { type: target.type, team: target.team, at: now };
    if (prev && target.kind === 'unit' && target.team === PLAYER && prev.type === target.type && prev.team === PLAYER && now - prev.at <= TOUCH.doubleTap) {
      ui.selectAllOnScreen(target.type, cam.worldView);
      this.lastTap = null;
      return;
    }
    ui.selectAt(at.x, at.y, false);
  }

  startPinch() {
    const [a, b] = [...this.active.values()];
    const cam = this.cam();
    if (this.gesture?.kind === 'box') { this.ui.drag = null; }
    this.gesture = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: cam.zoom };
  }

  updatePinch() {
    const pts = [...this.active.values()];
    if (pts.length < 2) return;
    const [a, b] = pts, g = this.gesture, cam = this.cam();
    // Keep the point between the fingers fixed on screen.
    zoomAbout(cam, (a.x + b.x) / 2, (a.y + b.y) / 2, g.z0 * (Math.hypot(a.x - b.x, a.y - b.y) / g.d0));
  }
}
