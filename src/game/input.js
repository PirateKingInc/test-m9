// Mouse/keyboard -> selection state and world commands. Never mutates the sim directly.
import { pickAt, boxSelect, Selection, ControlGroups } from '../sim/selection.js';
import { PLAYER } from '../sim/constants.js';
import { BUILDINGS, BUILD_ORDER, PRODUCTION } from '../data/buildings.js';
import { UNITS } from '../data/units.js';
import { unitName, buildingName } from '../theme/names.js';
import { canPlace, canRelocate, relocateCost, relocateBlocked } from '../sim/construction.js';
import { RELOCATE } from '../data/camp-rules.js';
import { supplyOf } from '../sim/supply.js';
import { TouchInput } from './touch.js';

const DRAG_THRESHOLD = 6; // px on screen
const DOUBLE_TAP = 0.35; // s

export class InputController {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.selection = new Selection();
    this.groups = new ControlGroups();
    this.drag = null;
    this.markers = [];
    this.lastGroup = { n: 0, at: -1 };
    this.listeners = new Set();
    this.placing = null; // building type while in placement mode
    this.moving = null; // id of the building being moved while placing (Phase 9)
    this.attackMode = false; // A pressed: next left-click is an attack-move
    this.devSpawn = null; // dev panel: unit type to spawn for team 2 on next left-click
    this.hover = { x: 0, y: 0 };
    // Touch (Phase 4): an order armed from the action bar ('order' = the
    // right-click command, 'attack' = attack-move), and a one-shot box select.
    this.armed = null;
    this.boxArmed = false;
    this.touch = new TouchInput(this, () => scene.cameras.main);

    const input = scene.input;
    input.addPointer?.(2); // two fingers for pinch-zoom
    input.on('pointerdown', (p) => (p.wasTouch ? this.touch.down(p) : this.onDown(p)));
    input.on('pointermove', (p) => (p.wasTouch ? this.touch.move(p) : this.onMove(p)));
    input.on('pointerup', (p) => (p.wasTouch ? this.touch.up(p) : this.onUp(p)));
    input.keyboard.on('keydown', (e) => this.onKey(e));
  }

  // Hook for audio/HUD: fn(eventName, data).
  on(fn) { this.listeners.add(fn); }
  notify(name, data) { for (const fn of this.listeners) fn(name, data); }

  onDown(p) {
    if (this.placing) {
      if (p.rightButtonDown()) this.placing = null;
      else if (p.leftButtonDown()) this.place(p.event.shiftKey);
      return;
    }
    if (this.attackMode || this.devSpawn) {
      if (p.leftButtonDown() && this.attackMode) this.attackMoveTo(p.worldX, p.worldY);
      if (p.leftButtonDown() && this.devSpawn) {
        this.world.issue({ type: 'devSpawn', unit: this.devSpawn, x: p.worldX, y: p.worldY, team: 2 });
        if (p.event.shiftKey) return;
      }
      this.attackMode = false;
      this.devSpawn = null;
      return;
    }
    if (p.rightButtonDown()) { this.command(p.worldX, p.worldY); return; }
    if (!p.leftButtonDown()) return;
    this.drag = { sx: p.x, sy: p.y, wx: p.worldX, wy: p.worldY, cx: p.worldX, cy: p.worldY, shift: p.event.shiftKey };
  }

  onMove(p) {
    this.hover = { x: p.worldX, y: p.worldY };
    if (this.drag) { this.drag.cx = p.worldX; this.drag.cy = p.worldY; this.drag.moved ||= Math.hypot(p.x - this.drag.sx, p.y - this.drag.sy) > DRAG_THRESHOLD; }
  }

  onUp(p) {
    const d = this.drag;
    if (!d || !p.leftButtonReleased()) return;
    this.drag = null;
    if (d.moved) this.selectBox(d.wx, d.wy, p.worldX, p.worldY, d.shift);
    else this.selectAt(p.worldX, p.worldY, d.shift);
  }

  selectBox(x1, y1, x2, y2, additive) {
    const ids = boxSelect(this.world, x1, y1, x2, y2, PLAYER);
    if (additive) this.selection.add(ids);
    else this.selection.set(ids);
    if (ids.length) this.notify('select', { ids });
  }

  selectAt(x, y, additive) {
    const e = pickAt(this.world, x, y);
    if (!e) { if (!additive) this.selection.clear(); return; }
    // Only own entities join a multi-selection; anything can be inspected alone.
    if (additive && e.team === PLAYER && this.selection.entities(this.world).every((s) => s.team === PLAYER)) {
      this.selection.toggle(e.id);
    } else {
      this.selection.set([e.id]);
    }
    this.notify('select', { ids: [e.id] });
  }

  // ---- touch helpers (Phase 4) ------------------------------------------------

  // Can the ➜ Order button do anything with this selection?
  canOrder() {
    return this.ownSelected('unit').length > 0 || this.ownSelected('building').some((b) => BUILDINGS[b.type].trains.length);
  }

  arm(mode) {
    if (mode === 'attack' && !this.ownSelected('unit').length) return;
    if (mode === 'order' && !this.canOrder()) return;
    this.armed = this.armed === mode ? null : mode; // tapping the armed button again disarms
    this.placing = null;
    this.boxArmed = false;
    this.notify('arm', { mode: this.armed });
  }

  disarm() {
    this.armed = null;
    this.boxArmed = false;
    this.placing = null;
    this.drag = null;
    this.notify('arm', { mode: null });
  }

  armBox() {
    this.boxArmed = !this.boxArmed;
    this.armed = null;
    this.placing = null;
    this.notify('arm', { mode: this.boxArmed ? 'box' : null });
  }

  stop() {
    const ids = this.ownSelected('unit').map((u) => u.id);
    if (ids.length) this.world.issue({ type: 'stop', ids });
  }

  // Double-tap: every own unit of `type` inside the visible world rectangle.
  selectAllOnScreen(type, view) {
    const ids = [];
    for (const u of this.world.ofKind('unit')) {
      if (u.team === PLAYER && u.type === type && u.x >= view.x && u.x <= view.right && u.y >= view.y && u.y <= view.bottom) ids.push(u.id);
    }
    this.selection.set(ids);
    if (ids.length) this.notify('select', { ids });
  }

  ownSelected(kind) {
    return this.selection.entities(this.world).filter((e) => e.team === PLAYER && (!kind || e.kind === kind));
  }

  // Footprint under the cursor for the building being placed.
  ghost() {
    if (!this.placing) return null;
    const def = BUILDINGS[this.placing], T = this.world.grid.tile;
    const tx = Math.round(this.hover.x / T - def.w / 2), ty = Math.round(this.hover.y / T - def.h / 2);
    const moved = this.movingBuilding();
    const valid = moved ? canRelocate(this.world, moved, tx, ty) : canPlace(this.world, this.placing, tx, ty);
    return { type: this.placing, tx, ty, w: def.w, h: def.h, valid };
  }

  // The building being moved, while its new spot is being placed (Phase 9).
  movingBuilding() {
    if (!this.placing || this.moving == null) return null;
    const b = this.world.get(this.moving);
    return b && b.type === this.placing ? b : null;
  }

  place(keepPlacing) {
    const g = this.ghost();
    const moved = this.movingBuilding();
    if (moved) { // Phase 9: confirm the move
      const res = this.world.issue({ type: 'relocate', id: moved.id, tx: g.tx, ty: g.ty });
      if (res.ok) {
        const T = this.world.grid.tile;
        this.mark((g.tx + g.w / 2) * T, (g.ty + g.h / 2) * T, 'build');
        this.placing = null; this.moving = null;
        this.selection.set([res.id]);
      }
      return;
    }
    const drones = this.ownSelected('unit').filter((u) => u.type === 'drone');
    const res = this.world.issue({ type: 'build', ids: drones.map((u) => u.id), building: g.type, tx: g.tx, ty: g.ty });
    if (res.ok) {
      const T = this.world.grid.tile;
      this.mark((g.tx + g.w / 2) * T, (g.ty + g.h / 2) * T, 'build');
      if (!keepPlacing) this.placing = null;
    }
  }

  // Buttons for the HUD command card, derived from the current selection.
  commandCard() {
    const sel = this.ownSelected();
    const lumen = this.world.resources[PLAYER];
    if (sel.length && sel.every((e) => e.kind === 'unit') && sel.some((u) => u.type === 'drone')) {
      return BUILD_ORDER.map((type) => {
        const d = BUILDINGS[type];
        return { key: d.hotkey, label: buildingName(type), cost: d.cost, action: `build:${type}`, enabled: lumen >= d.cost, active: this.placing === type };
      });
    }
    const trainer = sel.length === 1 && sel[0].kind === 'building' && sel[0].built ? sel[0] : null;
    // Phase 9: any completed building but the Castle can be moved.
    const move = trainer && !RELOCATE.fixed.includes(trainer.type)
      ? [{ key: 'V', label: 'Move', cost: relocateCost(trainer.type), action: 'move', enabled: !relocateBlocked(this.world, trainer), active: this.moving === trainer.id }]
      : [];
    if (trainer && BUILDINGS[trainer.type].trains.length) {
      return [...BUILDINGS[trainer.type].trains.map((unit, i) => ({
        key: 'QWER'[i], label: unitName(unit), cost: UNITS[unit].cost, action: `train:${unit}`,
        enabled: lumen >= UNITS[unit].cost && trainer.queue.length < PRODUCTION.maxQueue && supplyOf(this.world, PLAYER).free >= UNITS[unit].supply,
      })), ...move];
    }
    if (move.length) return move;
    if (sel.length === 1 && sel[0].kind === 'building' && !sel[0].built) {
      return [{ key: 'X', label: 'Cancel build', cost: null, action: 'cancel-build', enabled: true }];
    }
    return [];
  }

  action(name) {
    const [verb, arg] = name.split(':');
    if (verb === 'move') { // Phase 9: place the moved building's new spot
      const b = this.ownSelected('building')[0];
      const why = b && relocateBlocked(this.world, b);
      if (!b || why) { if (why) this.world.emit('rejected', { reason: why, team: PLAYER }); this.notify('action', { name }); return; }
      this.placing = b.type;
      this.moving = b.id;
      this.armed = null;
      this.boxArmed = false;
      if (this.scene.touchMode) { const v = this.scene.cameras.main.midPoint; this.hover = { x: v.x, y: v.y }; }
    }
    else if (verb === 'build') {
      this.placing = arg;
      this.moving = null;
      this.armed = null;
      this.boxArmed = false;
      // On touch there is no hover: start the ghost in the middle of the screen.
      if (this.scene.touchMode) { const v = this.scene.cameras.main.midPoint; this.hover = { x: v.x, y: v.y }; }
    }
    else if (verb === 'train' || verb === 'cancel-train') {
      const b = this.ownSelected('building')[0];
      if (!b) return;
      if (verb === 'train') this.world.issue({ type: 'train', building: b.id, unit: arg });
      else this.world.issue({ type: 'cancelTrain', building: b.id, index: arg === undefined ? undefined : Number(arg) });
    }
    else if (verb === 'cancel-build') {
      const b = this.ownSelected('building')[0];
      if (b) this.world.issue({ type: 'cancelBuild', id: b.id });
    }
    this.notify('action', { name });
  }

  // Right-click: contextual command for the selection.
  command(x, y) {
    const units = this.ownSelected('unit');
    const producers = this.ownSelected('building').filter((b) => BUILDINGS[b.type].trains.length);
    if (!units.length && producers.length) {
      for (const b of producers) this.world.issue({ type: 'rally', building: b.id, x, y });
      this.mark(x, y, 'move');
      return;
    }
    if (!units.length) return;
    const target = pickAt(this.world, x, y);
    const drones = units.filter((u) => u.type === 'drone');
    if (target && target.team && target.team !== PLAYER && (target.kind === 'unit' || target.kind === 'building')) {
      const res = this.world.issue({ type: 'attack', ids: units.map((u) => u.id), target: target.id });
      if (res.ok) this.mark(target.x, target.y, 'attack');
      return;
    }
    if (target?.kind === 'building' && target.team === PLAYER && !target.built && drones.length) {
      this.world.issue({ type: 'assist', ids: drones.map((u) => u.id), target: target.id });
      this.mark(target.x, target.y, 'build');
      return;
    }
    if (target?.kind === 'node' && drones.length) {
      this.world.issue({ type: 'gather', ids: drones.map((u) => u.id), node: target.id });
      this.mark(target.x, target.y, 'gather');
      const rest = units.filter((u) => u.type !== 'drone');
      if (rest.length) this.world.issue({ type: 'move', ids: rest.map((u) => u.id), x, y });
      return;
    }
    if (target?.kind === 'building' && target.team === PLAYER && target.built && BUILDINGS[target.type].dropOff && drones.some((u) => u.carry > 0)) {
      this.world.issue({ type: 'returnCargo', ids: drones.map((u) => u.id) });
      this.mark(target.x, target.y, 'gather');
      return;
    }
    const res = this.world.issue({ type: 'move', ids: units.map((u) => u.id), x, y });
    if (res.ok) this.mark(x, y, 'move');
  }

  attackMoveTo(x, y) {
    const units = this.ownSelected('unit');
    const res = this.world.issue({ type: 'attackMove', ids: units.map((u) => u.id), x, y });
    if (res.ok) this.mark(x, y, 'attack');
  }

  mark(x, y, kind) {
    this.markers.push({ x, y, kind, t: this.world.time });
    this.notify('command', { kind });
  }

  onKey(e) {
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m) {
      e.preventDefault();
      const n = Number(m[1]);
      // Shift+digit is the primary assign key: desktop Chrome reserves Ctrl+1-8 for
      // tab switching and never delivers them (unless fullscreen Keyboard Lock is on).
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        this.assignGroup(n);
      } else {
        this.recallGroup(n);
      }
      return;
    }
    if (e.code === 'Escape') { this.placing = null; this.attackMode = false; this.devSpawn = null; return; }
    if (e.code === 'KeyA' && this.ownSelected('unit').length) { this.attackMode = true; this.placing = null; return; }
    if (e.code === 'Backspace') { e.preventDefault(); this.action('cancel-train'); return; }
    if (e.code === 'KeyS') { this.world.issue({ type: 'stop', ids: this.selection.ids }); return; }
    const btn = this.commandCard().find((b) => `Key${b.key}` === e.code);
    if (btn && btn.enabled) this.action(btn.action);
  }

  assignGroup(n) {
    const ids = this.selection.ids.filter((id) => this.world.get(id)?.team === PLAYER);
    this.groups.assign(n, ids);
    this.notify('group-assign', { n, ids });
  }

  recallGroup(n) {
    const ids = this.groups.recall(n, this.world);
    if (!ids.length) return;
    const now = performance.now() / 1000;
    const doubleTap = this.lastGroup.n === n && now - this.lastGroup.at < DOUBLE_TAP;
    this.lastGroup = { n, at: now };
    this.selection.set(ids);
    if (doubleTap) {
      const es = ids.map((id) => this.world.get(id));
      const cx = es.reduce((s, e) => s + e.x, 0) / es.length, cy = es.reduce((s, e) => s + e.y, 0) / es.length;
      this.scene.cameras.main.centerOn(cx, cy);
    }
    this.notify('select', { ids });
  }
}
