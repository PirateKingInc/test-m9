import { MAP } from '../data/map.js';
import { UNITS } from '../data/units.js';
import { BUILDINGS } from '../data/buildings.js';
import { Grid } from './grid.js';
import { createRng } from './rng.js';
import { SIM_DT, PLAYER } from './constants.js';
import { Pathfinder } from './pathfinder.js';
import { issueCommand, thinkUnit } from './orders.js';
import { updateConstruction } from './construction.js';
import './economy.js';
import { updateProduction } from './production.js';
import { updateCombat } from './combat.js';
import { separate } from './steering.js';
import { checkResult } from './victory.js';
import { SpatialIndex } from './spatial.js';
import { setupZones, updateTerritory } from './territory.js';

// The headless game state. No Phaser/DOM here: the renderer reads entities,
// and everything that changes the world goes through issue(cmd).
export class World {
  constructor({ map = MAP, seed = 1337, PF = globalThis.PF, setup = 'start' } = {}) {
    this.map = map;
    this.PF = PF;
    this.rng = createRng(seed);
    this.grid = new Grid(map.cols, map.rows, map.tile);
    // Maps mirrored north-south as well (the free-for-all) mirror every
    // tie-break in y too (Phase 8, PHASE8_SPEC.md "Pathfinding symmetry").
    this.grid.mirrorY = !!map.mirrorY;
    this.width = map.cols * map.tile;
    this.height = map.rows * map.tile;
    this.time = 0;
    this.tick = 0;
    this.nextId = 1;
    this.entities = new Map();
    // Camps in play (Phase 6): the sandbox has the player's only; the 1v1 match
    // the west and east starts; the free-for-all every camp on its map. Each
    // camp is a team with its own stockpile, buildings and units.
    this.camps = setup === 'ffa' ? map.camps : setup === 'match' ? [map.start, map.aiStart] : setup === 'start' ? [map.start] : [];
    this.teams = this.camps.length ? this.camps.map((c) => c.team) : [PLAYER]; // an empty test world still has the player
    this.resources = { [PLAYER]: map.startingLumen };
    this.mode = setup === 'match' || setup === 'ffa' ? setup : 'sandbox';
    this.result = null; // set once a match is decided (SPEC.md Phase 2 "Win / lose")
    this.events = []; // drained by the renderer/audio each frame

    this.pathfinder = new Pathfinder(this.grid, PF);
    this.spatial = new SpatialIndex();
    for (const [x, y, w, h] of map.rocks) this.grid.setRock(x, y, w, h);
    for (const [tx, ty] of map.nodes) this.addNode(tx, ty, map.nodeAmount);
    if (setup === 'start' || setup === 'match' || setup === 'ffa') {
      for (const camp of this.camps) {
        this.setupStart(camp);
        this.resources[camp.team] = map.startingLumen;
      }
    }
    if (setup === 'ffa') setupZones(this, map.zones); // territory (Phase 6)
  }

  setupStart(start) {
    this.addBuilding('core', start.team, start.core[0], start.core[1], { built: true });
    for (const [tx, ty] of start.drones) {
      const c = this.grid.center(tx, ty);
      this.addUnit('drone', start.team, c.x, c.y);
    }
  }

  emit(type, data = {}) {
    this.events.push({ ...data, type, t: this.time });
  }

  drainEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  add(e) {
    e.id = this.nextId++;
    this.entities.set(e.id, e);
    this.byKind = null;
    return e;
  }

  addNode(tx, ty, amount) {
    const s = this.map.nodeSize, T = this.grid.tile;
    const e = this.add({
      kind: 'node', tx, ty, w: s, h: s, pw: s * T, ph: s * T,
      x: (tx + s / 2) * T, y: (ty + s / 2) * T, amount, maxAmount: amount,
    });
    this.grid.setOccupant(tx, ty, s, s, e.id);
    return e;
  }

  addBuilding(type, team, tx, ty, { built = false } = {}) {
    const def = BUILDINGS[type], T = this.grid.tile;
    const e = this.add({
      kind: 'building', type, team, tx, ty, w: def.w, h: def.h, pw: def.w * T, ph: def.h * T,
      x: (tx + def.w / 2) * T, y: (ty + def.h / 2) * T,
      maxHp: def.hp, hp: def.hp, built, progress: built ? 1 : 0,
      queue: [], rally: null, cooldown: 0, target: null,
    });
    this.grid.setOccupant(tx, ty, def.w, def.h, e.id);
    return e;
  }

  addUnit(type, team, x, y) {
    const def = UNITS[type];
    return this.add({
      kind: 'unit', type, team, x, y, px: x, py: y,
      radius: def.radius, speed: def.speed, maxHp: def.hp, hp: def.hp,
      order: { type: 'idle' }, path: null, cooldown: 0, carry: 0, facing: 0,
    });
  }

  removeEntity(e) {
    this.entities.delete(e.id);
    this.byKind = null;
    if (e.kind !== 'unit') this.grid.setOccupant(e.tx, e.ty, e.w, e.h, 0);
  }

  get(id) {
    return this.entities.get(id);
  }

  // Entities of one kind in id order. Cached until the entity set changes; callers
  // get a snapshot array (iterate or spread it, never mutate it).
  ofKind(kind) {
    if (!this.byKind) {
      this.byKind = { unit: [], building: [], node: [] };
      for (const e of this.entities.values()) (this.byKind[e.kind] ||= []).push(e);
    }
    return this.byKind[kind] || [];
  }

  issue(cmd) {
    if (this.result) return { ok: false, reason: 'Game over' };
    return issueCommand(this, cmd);
  }

  step() {
    if (this.result) return; // the match is decided: the world is frozen
    const units = [...this.ofKind('unit')];
    for (const u of units) { u.px = u.x; u.py = u.y; }
    this.spatial.rebuild(this); // enemy scans this tick use the index
    for (const u of units) thinkUnit(this, u, SIM_DT);
    separate(this);
    updateConstruction(this, SIM_DT);
    updateProduction(this, SIM_DT);
    updateCombat(this, SIM_DT);
    this.time += SIM_DT;
    this.tick++;
    updateTerritory(this); // free-for-all only: no zones, no work
    checkResult(this);
  }

  run(seconds) {
    const n = Math.round(seconds / SIM_DT);
    for (let i = 0; i < n; i++) this.step();
  }
}
