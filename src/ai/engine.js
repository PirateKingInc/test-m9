// The AI execution engine. It started life as the Phase 1 "sandbox bot"
// (test/bot.js), which proved the whole build/gather/train/fight loop works
// through the public command API. Phase 2 extends that same class into the
// opponent's engine: it executes a strategy script from src/data/strategies.js
// with timing from src/data/difficulty.js.
//
// Rules the engine lives by (SPEC.md Phase 2 "AI architecture"):
// - It *reads* the world only through `this.w` (a view; tests pass a recursively
//   read-only proxy) and *acts* only through `this.issue()`, which forwards to
//   world.issue() with the engine's own team stamped on and a command whitelist.
// - No Phaser, no DOM, no direct state mutation, no cheating.
import { BUILDINGS } from '../data/buildings.js';
import { UNITS } from '../data/units.js';
import { STRATEGIES, SPOTS, ARMY, SCOUTING, EXPANSION } from '../data/strategies.js';
import { Scout } from './scout.js';
import { rankRivals } from './rivals.js';
import { RIVALS } from '../data/rivals.js';
import { DIFFICULTY } from '../data/difficulty.js';
import { canPlace } from '../sim/construction.js';
import { supplyOf } from '../sim/supply.js';
import { createRng } from '../sim/rng.js';

// Everything a player can do through the UI, and nothing else (no devSpawn).
export const ALLOWED_COMMANDS = new Set([
  'build', 'assist', 'cancelBuild', 'train', 'cancelTrain', 'rally',
  'gather', 'returnCargo', 'move', 'stop', 'attack', 'attackMove',
]);

import { COMBAT_TYPES } from './engine-types.js';

export { COMBAT_TYPES };

export class AiEngine {
  // world: the real World (only its issue() is used); opts.view: what the engine
  // reads (defaults to the world itself).
  constructor(world, { team = 1, strategy = 'sandbox', difficulty = 'hard', view = world, seed = 1, targeting = 'assess' } = {}) {
    this.w = view;
    // Phase 7: 'assess' ranks rivals (PHASE7_SPEC.md); 'nearest' keeps the
    // Phase 6 placeholder. Only matters with more than one rival.
    this.targeting = targeting;
    this.team = team;
    this.issueFn = (cmd) => world.issue(cmd);
    this.d = typeof difficulty === 'string' ? DIFFICULTY[difficulty] : difficulty;
    if (strategy === 'auto') strategy = this.d.strategy; // each difficulty's default strategy
    this.strategyId = strategy;
    this.s = typeof strategy === 'string' ? STRATEGIES[strategy] : strategy;
    this.rng = createRng(seed * 31 + team); // the engine's own RNG, never the sim's
    this.log = [];
    this.step = 0; // index of the next opening step
    this.nextStepAt = 0; // game time before which the next opening step waits (stepDelay)
    this.nextThinkAt = 0;
    this.pendingBuild = null;
    this.stats = { commands: 0, rejected: 0, built: {}, trained: {}, waves: 0, reachedEnemySide: false, engaged: false, reachedEnemyBase: false, coreAssaults: 0 };
    this.mode = 'gather'; // army state: gather | attack
    this.wave = []; // ids of the units in the current attack wave
    this.waveSize = 0;
    this.rallySet = new Set();
    this.scout = new Scout(this);
    this.defending = null; // { since, lastThreat, attackers: Set } while in defend mode
    this.counterFor = null; // enemy unit type we are countering (massing trigger)
    this.pendingEarly = null; // when an early-aggression condition was first seen
    this.pendingMass = null; // { type, at } when a massing condition was first seen
    this.reactions = []; // { t, kind, detail } for tests and the result screen
    this.expansion = null; // { name, center, depot, spire, guard, nodes } once we expand
    this.expandRetryAt = 0;
    this.guards = new Set(); // combat units posted at the expansion (never join waves)
    this.squad = null; // Phase 7 zone squad: { zone, kind, since, ids, clearSince }
  }

  // ---- acting -------------------------------------------------------------

  issue(cmd) {
    if (!ALLOWED_COMMANDS.has(cmd.type)) throw new Error(`AI command not allowed: ${cmd.type}`);
    const res = this.issueFn({ ...cmd, team: this.team });
    this.stats.commands++;
    if (!res.ok) this.stats.rejected++;
    return res;
  }

  // Timing slack from the engine's own seeded RNG, so repeated matches differ.
  jittered(t) {
    return t * (1 + (this.d.jitter || 0) * (2 * this.rng.next() - 1));
  }

  note(msg) { this.log.push(`[${this.w.time.toFixed(1)}s] ${msg}`); }

  // ---- reading ------------------------------------------------------------

  mine(kind, type) {
    const out = [];
    for (const e of this.w.ofKind(kind)) if (e.team === this.team && (!type || e.type === type)) out.push(e);
    return out;
  }

  core() {
    return this.mine('building', 'core').find((b) => b.built) || this.mine('building', 'core')[0];
  }

  // The west base's spot offsets, mirrored when our Core sits in the east half
  // (and, on maps that ask for it, the south half: the free-for-all's corners).
  south() { return !!this.w.map.mirrorY && this.core().y > this.w.height / 2; }

  spot(key, type) {
    const c = this.core(), def = BUILDINGS[type];
    const [dx, dy] = SPOTS[key] || SPOTS[type];
    const east = c.x > this.w.width / 2;
    return { tx: east ? c.tx + c.w - dx - def.w : c.tx + dx, ty: this.south() ? c.ty + c.h - dy - def.h : c.ty + dy };
  }

  // A valid footprint near the desired spot that leaves a one-tile walkable ring
  // around the building, so the AI never walls in its own units.
  // `key` is a SPOTS name, or an absolute { tx, ty } (expansion buildings).
  placement(type, key) {
    const want = typeof key === 'object' ? key : this.spot(key, type), def = BUILDINGS[type], g = this.w.grid;
    const east = this.core().x > this.w.width / 2, south = this.south();
    const ringFree = (tx, ty) => {
      for (let y = ty - 1; y <= ty + def.h; y++) for (let x = tx - 1; x <= tx + def.w; x++) {
        const edge = x === tx - 1 || x === tx + def.w || y === ty - 1 || y === ty + def.h;
        if (edge && g.inBounds(x, y) && !g.isWalkable(x, y)) return false;
      }
      return true;
    };
    for (const strict of [true, false]) {
      for (let r = 0; r <= 8; r++) {
        for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
          const dx = east ? -k : k; // the east base searches in the mirror-image order
          const dy = south ? -j : j; // and a south base in the vertical mirror image
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = want.tx + dx, ty = want.ty + dy;
          if (canPlace(this.w, type, tx, ty) && (!strict || ringFree(tx, ty))) return { tx, ty };
        }
      }
    }
    return null;
  }

  homeNode() {
    const core = this.core();
    if (!core) return null;
    let best = null, bestD = Infinity;
    for (const n of this.w.ofKind('node')) {
      const d = Math.hypot(n.x - core.x, n.y - core.y);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  army() {
    return this.mine('unit').filter((u) => COMBAT_TYPES.includes(u.type));
  }

  supply() { return supplyOf(this.w, this.team); }

  lumen() { return this.w.resources[this.team] || 0; }

  // ---- decisions ----------------------------------------------------------

  // Put every idle drone to work, spreading them over the crystals near our base
  // (least-busy node first, nearest on ties) so a big economy isn't one queue.
  gatherIdle() {
    const scouting = this.scout?.activeScout();
    const idle = this.mine('unit', 'drone').filter((d) => d.order.type === 'idle' && d.id !== scouting);
    const core = this.core();
    if (!idle.length || !core) return;
    const nodes = [...this.w.ofKind('node')]
      .map((n) => ({ n, d: Math.hypot(n.x - core.x, n.y - core.y) }))
      .sort((a, b) => a.d - b.d).slice(0, 4);
    if (!nodes.length) return;
    const busy = new Map(nodes.map(({ n }) => [n.id, 0]));
    for (const d of this.mine('unit', 'drone')) if (d.order.type === 'gather' && busy.has(d.order.node)) busy.set(d.order.node, busy.get(d.order.node) + 1);
    for (const d of idle) {
      const pick = nodes.reduce((a, b) => (busy.get(b.n.id) < busy.get(a.n.id) ? b : a));
      busy.set(pick.n.id, busy.get(pick.n.id) + 1);
      this.issue({ type: 'gather', ids: [d.id], node: pick.n.id });
    }
  }

  trackConstruction() {
    // Any unfinished site of ours with nobody building it (the builder died or
    // was pulled away) gets a new builder, so construction can never stall.
    for (const b of this.mine('building')) {
      if (b.built) continue;
      const drones = this.mine('unit', 'drone');
      if (!drones.length || drones.some((d) => d.order.type === 'build' && d.order.target === b.id)) continue;
      const pick = drones.reduce((a, d) => (Math.hypot(d.x - b.x, d.y - b.y) < Math.hypot(a.x - b.x, a.y - b.y) ? d : a));
      this.issue({ type: 'assist', ids: [pick.id], target: b.id });
      this.note(`reassigned builder to ${b.type}`);
    }
    if (!this.pendingBuild) return;
    const b = this.w.get(this.pendingBuild);
    if (!b) this.pendingBuild = null;
    else if (b.built) {
      this.note(`${b.type} complete`);
      this.stats.built[b.type] = (this.stats.built[b.type] || 0) + 1;
      this.pendingBuild = null;
    }
  }

  // One construction at a time, unless `urgent` (a defend reaction's Spire).
  tryBuild(type, key = type, urgent = false) {
    if ((this.pendingBuild && !urgent) || this.lumen() < BUILDINGS[type].cost) return false;
    const at = this.placement(type, key);
    const drones = this.mine('unit', 'drone');
    if (!at || !drones.length) return false;
    const builder = drones.find((d) => d.order.type === 'gather' && d.carry === 0) || drones[0];
    const res = this.issue({ type: 'build', ids: [builder.id], building: type, tx: at.tx, ty: at.ty });
    if (res.ok) { this.pendingBuild = res.id; this.note(`placed ${type} at (${at.tx},${at.ty})`); }
    return res.ok;
  }

  // Queue a unit at a completed building that trains it (shortest queue first).
  tryTrain(unit, maxQueue = 5) {
    const where = UNITS[unit].trainedAt;
    const hosts = this.mine('building', where).filter((b) => b.built && b.queue.length < maxQueue);
    if (!hosts.length || this.lumen() < UNITS[unit].cost || this.supply().free < UNITS[unit].supply) return false;
    hosts.sort((a, b) => a.queue.length - b.queue.length);
    const res = this.issue({ type: 'train', building: hosts[0].id, unit });
    if (res.ok) {
      this.note(`queued ${unit}`);
      this.stats.trained[unit] = (this.stats.trained[unit] || 0) + 1;
    }
    return res.ok;
  }

  // Execute the next opening step if its time has come. Returns true when done.
  runOpening() {
    const steps = this.s.opening;
    if (this.step >= steps.length) return true;
    if (this.w.time < this.nextStepAt) return false;
    const st = steps[this.step];
    const ok = st.build ? this.tryBuild(st.build, st.spot) : this.tryTrain(st.train);
    if (ok) {
      this.step++;
      this.nextStepAt = this.w.time + this.jittered(this.d.stepDelay);
    }
    return this.step >= steps.length;
  }

  // ---- macro loop (after the opening) --------------------------------------

  macro() {
    const s = this.s, sup = this.supply();
    // 1. Supply: a new Depot before we run out.
    const producers = this.mine('building', 'foundry').length + 1;
    if (sup.cap < 60 && sup.free <= s.supplyBuffer + producers && !this.pendingBuild) {
      const keys = s.depotSpots || ['depot'];
      const key = keys[Math.min(this.mine('building', 'depot').length, keys.length - 1)];
      if (this.tryBuild('depot', key)) return;
    }
    // 2. Workers up to the (difficulty-scaled) target, one at a time.
    const core = this.mine('building', 'core').find((b) => b.built);
    const target = Math.floor(s.workerTarget * this.d.workerFactor) + (this.expansion?.depotBuilt ? s.expand.drones : 0);
    if (core && core.queue.length === 0 && this.mine('unit', 'drone').length < target) this.tryTrain('drone', 1);
    // Defend mode: make sure we have the Spires the reaction calls for.
    if (this.defending) {
      const want = this.s.defendSpires ?? SCOUTING.defendSpires;
      const have = this.mine('building', 'spire').length;
      if (have < want && this.tryBuild('spire', have ? 'spire2' : 'spire', true)) return;
    }
    // Expansion to a middle field (Depot, then its guard Spires).
    if (this.runExpansion()) return;
    // 3. More production when Lumen piles up, then strategy-specific structures.
    const foundries = this.mine('building', 'foundry').length;
    if (!this.pendingBuild && foundries < this.foundryCap(s.maxFoundries ?? 1) && this.lumen() >= (s.floatLumen ?? Infinity)) {
      if (this.tryBuild('foundry', foundries ? 'foundry2' : 'foundry')) return;
    }
    for (const st of s.structures || []) {
      if (this.pendingBuild) break;
      if (this.structureWanted(st)) {
        const have = this.mine('building', st.build).length;
        this.tryBuild(st.build, st.spots[Math.min(have, st.spots.length - 1)]);
        break;
      }
    }
    // 4. Army from the composition weights, keeping Foundry queues short.
    const unit = this.nextArmyUnit();
    if (unit) this.tryTrain(unit, ARMY.maxFoundryQueue);
  }

  // Difficulty caps how much production the AI runs (Phase 3): an easier tier
  // simply builds fewer Foundries. It never changes the rules or gives resources.
  foundryCap(n) { return Math.min(n, this.d.maxFoundries ?? Infinity); }

  // A strategy structure rule: { build, spots, max, minDrones?, armyPer? }. Wanted
  // while we have fewer than `max`, enough Drones, and (armyPer) at least
  // armyPer combat units per existing building of that type.
  structureWanted(st) {
    const have = this.mine('building', st.build).length;
    if (have >= (st.build === 'foundry' ? this.foundryCap(st.max) : st.max)) return false;
    if (st.minDrones && this.mine('unit', 'drone').length < st.minDrones) return false;
    if (st.armyPer && this.army().length < st.armyPer * have) return false;
    return this.lumen() >= BUILDINGS[st.build].cost;
  }

  // ---- scouting-triggered reactions (SPEC.md Phase 2) -----------------------

  react(kind, detail) {
    this.reactions.push({ t: this.w.time, kind, detail });
    this.note(`${kind}${detail ? `: ${detail}` : ''}`);
  }

  // Each trigger only takes effect once its condition has held for the
  // difficulty's reactionDelay, so easier tiers react late.
  evaluateTriggers() {
    const cfg = SCOUTING, now = this.w.time, delay = this.d.reactionDelay;
    const intruders = this.scout.intrudersSeen();
    if (!this.defending) {
      if (now < cfg.earlyWindow && intruders.length >= cfg.earlyAggroUnits) {
        this.pendingEarly ??= now;
        if (now - this.pendingEarly >= delay) {
          this.defending = { since: now, lastThreat: now, attackers: new Set(intruders.map((m) => m.type)) };
          this.pendingEarly = null;
          this.react('early-aggression', `${intruders.length} enemy units at the base: defend`);
        }
      } else this.pendingEarly = null;
    } else if (intruders.length) {
      this.defending.lastThreat = now;
      for (const m of intruders) this.defending.attackers.add(m.type);
    } else if (now - this.defending.lastThreat >= cfg.defendClear) {
      this.defending = null;
      this.react('defend-end');
    }

    // Free-for-all (Phase 7): massing is judged per rival, see massedRival().
    const mass = this.multi() ? this.massedRival() : massedIn(this.scout.seenArmy());
    const massed = mass?.type ?? null, seen = mass?.seen;
    if (massed && massed !== this.counterFor) {
      if (this.pendingMass?.type !== massed) this.pendingMass = { type: massed, at: now };
      if (now - this.pendingMass.at >= delay) {
        this.counterFor = massed;
        this.pendingMass = null;
        this.react('massing', `${seen[massed]} ${massed} seen${mass.team ? ` (camp ${mass.team})` : ''}: counter with ${cfg.counters[massed].join('/')}`);
      }
    } else if (!massed) {
      this.pendingMass = null;
      if (this.counterFor) { this.counterFor = null; this.react('massing-end'); }
    }
  }

  // Per-rival massing (PHASE7_SPEC.md "Reactive defense in the free-for-all"):
  // each rival's seen army is judged on its own, so two rivals massing two
  // different types don't dilute each other. Several massing: our target
  // first, then a rival hitting us, then the biggest seen army.
  massedRival() {
    const i = this.intel(), found = [];
    for (const c of this.livingRivals()) {
      const m = massedIn(this.scout.seenArmy(c.team));
      if (m) found.push({ ...m, team: c.team, hitting: !!i.ranking.find((r) => r.team === c.team)?.hitting });
    }
    if (!found.length) return null;
    return found.find((m) => m.team === i.target) || found.find((m) => m.hitting)
      || found.reduce((a, b) => (b.total > a.total || (b.total === a.total && b.team < a.team) ? b : a));
  }

  // Composition weights after reactions: counterShare of production goes to the
  // counters (primary weighted 2:1 over secondary) of whatever we're reacting to.
  composition() {
    const base = this.s.composition;
    const against = this.defending ? [...this.defending.attackers] : this.counterFor ? [this.counterFor] : [];
    if (!against.length) return base;
    const counter = {};
    for (const t of against) {
      const picks = SCOUTING.counters[t] || [];
      picks.forEach((c, i) => { counter[c] = (counter[c] || 0) + (i === 0 ? 2 : 1); });
    }
    const bsum = Object.values(base).reduce((a, b) => a + b, 0) || 1;
    const csum = Object.values(counter).reduce((a, b) => a + b, 0);
    const out = {};
    for (const [t, w] of Object.entries(base)) out[t] = (w / bsum) * (1 - SCOUTING.counterShare);
    for (const [t, w] of Object.entries(counter)) out[t] = (out[t] || 0) + (w / csum) * SCOUTING.counterShare;
    return out;
  }

  // The composition type furthest below its target share (counting living and
  // queued units), so production follows the weights without any randomness.

  nextArmyUnit() {
    const weights = this.composition();
    const types = Object.keys(weights).filter((t) => weights[t] > 0);
    if (!types.length) return null;
    const have = Object.fromEntries(types.map((t) => [t, 0]));
    for (const u of this.army()) if (u.type in have) have[u.type]++;
    for (const f of this.mine('building', 'foundry')) for (const q of f.queue) if (q.unit in have) have[q.unit]++;
    const total = types.reduce((n, t) => n + have[t], 0) + 1;
    const wsum = types.reduce((n, t) => n + weights[t], 0);
    let best = null, bestGap = -Infinity;
    for (const t of types) {
      const gap = weights[t] / wsum - have[t] / total;
      if (gap > bestGap) { bestGap = gap; best = t; }
    }
    return best;
  }

  // ---- expansion (Phase 3) --------------------------------------------------

  // Fields we may expand to: the 1v1 map's two middle fields, or (Phase 6) the
  // free-for-all's neutral zones.
  expansionFields() {
    if (this.w.zones) return [...this.w.zones].filter((z) => z.field).map((z) => this.zoneField(z)); // a plain array: we sort it
    return Object.keys(EXPANSION.fields).map((n) => this.field(n));
  }

  // A neutral zone's field, with its Depot, Spire and guard spots on the side
  // facing our Castle (the 1v1 fields put them 5-7 tiles toward the owner).
  zoneField(z) {
    const T = this.w.grid.tile, [cx, cy] = z.field, core = this.core();
    const d = Math.hypot(core.x / T - cx, core.y / T - cy) || 1;
    const ux = (core.x / T - cx) / d, uy = (core.y / T - cy) / d;
    const at = (k, side = 0) => ({ tx: Math.round(cx + ux * k - uy * side), ty: Math.round(cy + uy * k + ux * side) });
    const g = at(5, -2);
    return {
      name: z.id, center: { x: cx * T, y: cy * T },
      depot: at(7, 0), spire: at(5, 3),
      guard: { x: (g.tx + 0.5) * T, y: (g.ty + 0.5) * T },
    };
  }

  // A middle field's tiles for our side (the data is written for the west).
  field(name) {
    const f = EXPANSION.fields[name], T = this.w.grid.tile;
    const east = this.core().x > this.w.width / 2, cols = this.w.grid.cols;
    const fx = (tx, w) => (east ? cols - tx - w : tx);
    const center = { x: (fx(f.center[0], 0)) * T, y: f.center[1] * T };
    return {
      name, center,
      depot: { tx: fx(f.depot[0], BUILDINGS.depot.w), ty: f.depot[1] },
      spire: { tx: fx(f.spire[0], BUILDINGS.spire.w), ty: f.spire[1] },
      guard: { x: (fx(f.guard[0], 1) + 0.5) * T, y: (f.guard[1] + 0.5) * T },
    };
  }

  nodesNear(p, tiles) {
    const r = tiles * this.w.grid.tile;
    return [...this.w.ofKind('node')].filter((n) => n.amount > 0 && Math.hypot(n.x - p.x, n.y - p.y) <= r);
  }

  // Share of the home field's Lumen still in the ground.
  homeLeft() {
    const core = this.core();
    if (!core) return 0;
    this.homeTotal ??= this.nodesNear(core, EXPANSION.homeRadius).reduce((a, n) => a + n.amount, 0);
    if (!this.homeTotal) return 0;
    return this.nodesNear(core, EXPANSION.homeRadius).reduce((a, n) => a + n.amount, 0) / this.homeTotal;
  }

  // A field is contested if the AI has seen an enemy building there (still
  // believed standing) or enemy combat units near it recently. Enemy Drones
  // alone don't count. Only what the AI has seen counts.
  contested(f) {
    const r = EXPANSION.contestRadius * this.w.grid.tile, now = this.w.time;
    for (const m of this.scout.memory.values()) {
      if (Math.hypot(m.x - f.center.x, m.y - f.center.y) > r) continue;
      if (m.kind === 'building' || (COMBAT_TYPES.includes(m.type) && now - m.seenAt <= EXPANSION.contestMemory)) return true;
    }
    return false;
  }

  // Why we'd expand now ('home-low' or 'timer'), or null.
  expandWanted() {
    const x = this.s.expand;
    if (!x || this.w.time < this.expandRetryAt || this.defending) return null;
    if (x.orHomeBelow != null && this.homeLeft() < x.orHomeBelow) return 'home-low';
    if (this.w.time < x.after) return null;
    if (x.minDrones && this.mine('unit', 'drone').length < x.minDrones) return null;
    if (x.minArmySupply && this.army().reduce((n, u) => n + UNITS[u.type].supply, 0) < x.minArmySupply) return null;
    return 'timer';
  }

  ourDepotAt(f) {
    const r = EXPANSION.fieldRadius * 2 * this.w.grid.tile;
    return this.mine('building', 'depot').find((b) => Math.hypot(b.x - f.center.x, b.y - f.center.y) <= r) || null;
  }

  // Returns true when it placed a building this round.
  runExpansion() {
    const x = this.s.expand, core = this.core();
    if (!x || !core) return false;
    if (!this.expansion) {
      const why = this.expandWanted();
      if (!why) return false;
      const fields = this.expansionFields()
        .filter((f) => this.nodesNear(f.center, EXPANSION.fieldRadius).length && !this.contested(f))
        .sort((a, b) => Math.hypot(a.center.x - core.x, a.center.y - core.y) - Math.hypot(b.center.x - core.x, b.center.y - core.y));
      if (!fields.length) return false;
      this.expansion = { ...fields[0], since: this.w.time, depotBuilt: false, why };
      this.react('expand', `${fields[0].name} field (${why}): Depot, ${x.drones} Drones, ${x.spires} Spire(s), ${x.guards} guard(s)`);
    }
    const e = this.expansion, depot = this.ourDepotAt(e);
    if (e.depotBuilt && !depot) return this.loseExpansion();
    if (!e.depotBuilt && this.contested(e)) { // the enemy turned up there first: pick again
      if (depot) this.issue({ type: 'cancelBuild', id: depot.id });
      this.react('expand-abort', `${e.name} field is held by the enemy`);
      this.expansion = null;
      return false;
    }
    if (!depot) return this.tryBuild('depot', e.depot);
    if (!depot.built) return false;
    e.depotBuilt = true;
    if (!this.nodesNear(e.center, EXPANSION.fieldRadius).length) { // mined out: free to take the next field
      this.react('expansion-mined-out', e.name);
      this.expansion = null;
      return false;
    }
    const spireR = EXPANSION.fieldRadius * 2 * this.w.grid.tile;
    const spires = this.mine('building', 'spire').filter((b) => Math.hypot(b.x - e.center.x, b.y - e.center.y) <= spireR).length;
    if (spires < x.spires && this.tryBuild('spire', e.spire)) return true;
    this.staffExpansion();
    return false;
  }

  // Keep `expand.drones` Drones mining the expansion field.
  staffExpansion() {
    const e = this.expansion, want = this.s.expand.drones;
    const nodes = this.nodesNear(e.center, EXPANSION.fieldRadius);
    if (!nodes.length) return;
    const ids = new Set(nodes.map((n) => n.id));
    const drones = this.mine('unit', 'drone');
    const there = drones.filter((d) => d.order.type === 'gather' && ids.has(d.order.node));
    if (there.length >= want) return;
    const scouting = this.scout.activeScout();
    const spare = drones.filter((d) => d.order.type === 'gather' && !ids.has(d.order.node) && d.id !== scouting && d.carry === 0);
    const busy = new Map(nodes.map((n) => [n.id, 0]));
    for (const d of there) busy.set(d.order.node, busy.get(d.order.node) + 1);
    for (const d of spare.slice(0, want - there.length)) {
      const pick = nodes.reduce((a, b) => (busy.get(b.id) < busy.get(a.id) ? b : a));
      busy.set(pick.id, busy.get(pick.id) + 1);
      this.issue({ type: 'gather', ids: [d.id], node: pick.id });
    }
  }

  // The expansion Depot fell: bring its Drones home and retry later.
  loseExpansion() {
    const ids = new Set(this.nodesNear(this.expansion.center, EXPANSION.fieldRadius).map((n) => n.id));
    const back = this.mine('unit', 'drone').filter((d) => d.order.type === 'gather' && ids.has(d.order.node));
    if (back.length) this.issue({ type: 'stop', ids: back.map((d) => d.id) }); // gatherIdle re-homes them
    this.react('expansion-lost', this.expansion.name);
    this.expansion = null;
    this.expandRetryAt = this.w.time + EXPANSION.retryAfter;
    return false;
  }

  // Post `expand.guards` combat units at the expansion; they defend it and
  // never join attack waves. Returns the guard ids.
  postGuards(home) {
    for (const id of this.guards) if (!this.w.get(id)) this.guards.delete(id);
    const e = this.expansion, want = this.s.expand?.guards || 0;
    if (!e || !want) {
      if (this.guards.size) this.guards.clear();
      return this.guards;
    }
    const free = home.filter((u) => !this.guards.has(u.id))
      .sort((a, b) => Math.hypot(a.x - e.guard.x, a.y - e.guard.y) - Math.hypot(b.x - e.guard.x, b.y - e.guard.y));
    const add = free.slice(0, Math.max(0, want - this.guards.size));
    for (const u of add) this.guards.add(u.id);
    const leash = EXPANSION.guardLeash * this.w.grid.tile;
    const back = [...this.guards].map((id) => this.w.get(id))
      .filter((u) => u.order.type === 'idle' && Math.hypot(u.x - e.guard.x, u.y - e.guard.y) > leash);
    if (add.length || back.length) {
      const ids = [...new Set([...add, ...back].map((u) => u.id))];
      this.issue({ type: 'attackMove', ids, x: e.guard.x, y: e.guard.y });
    }
    return this.guards;
  }

  // ---- zone holding (Phase 7) -------------------------------------------------

  // Seen rival army value in a zone (PHASE7_SPEC.md "Zone holding"): rival
  // combat units remembered within zoneRadius of its field, not seen gone.
  rivalForceAt(z) {
    const r = RIVALS.hold.zoneRadius * this.w.grid.tile, T = this.w.grid.tile, now = this.w.time;
    const [cx, cy] = z.field;
    let v = 0;
    for (const m of this.scout.memory.values()) {
      if (m.kind !== 'unit' || m.gone || !COMBAT_TYPES.includes(m.type) || now - m.seenAt > EXPANSION.contestMemory) continue;
      if (Math.hypot(m.x - cx * T, m.y - cy * T) <= r) v += UNITS[m.type].supply * (m.health ?? 1);
    }
    return v;
  }

  // Keep the non-home zones we hold: a squad of up to squadMax home units goes
  // to a zone of ours being taken (defend), or to one we lost in the last
  // lostMemory seconds (recapture), if the rival force seen there is small
  // enough. One squad at a time. Returns the squad's unit ids.
  holdZones(home, rally) {
    const cfg = RIVALS.hold, now = this.w.time, T = this.w.grid.tile;
    this.zoneLost ??= new Map();
    this.zoneSeen ??= new Map();
    for (const z of this.w.zones) {
      if (this.zoneSeen.get(z.id) === this.team && z.owner !== this.team) this.zoneLost.set(z.id, { at: now, to: z.owner });
      this.zoneSeen.set(z.id, z.owner);
    }
    const sq = this.squad;
    if (sq) {
      const units = [...sq.ids].map((id) => this.w.get(id)).filter(Boolean);
      const z = this.w.zones.find((x) => x.id === sq.zone);
      const clear = z.owner === this.team && z.holder == null && this.rivalForceAt(z) === 0;
      sq.clearSince = clear ? sq.clearSince ?? now : null;
      if (!units.length || this.defending || now - sq.since > cfg.maxOut || (clear && now - sq.clearSince >= cfg.clearAfter)) {
        const idle = units.filter((u) => u.order.type === 'idle');
        if (idle.length && !this.defending) this.issue({ type: 'move', ids: idle.map((u) => u.id), ...rally });
        this.react('zone-squad-home', `${sq.zone}: ${!units.length ? 'squad lost' : this.defending ? 'needed at home' : clear ? 'zone secure' : 'time out'}`);
        this.squad = null;
        return NO_SQUAD;
      }
      const at = { x: z.field[0] * T, y: z.field[1] * T };
      const back = units.filter((u) => u.order.type === 'idle' && Math.hypot(u.x - at.x, u.y - at.y) > EXPANSION.guardLeash * T);
      if (back.length) this.issue({ type: 'attackMove', ids: back.map((u) => u.id), ...at });
      sq.ids = new Set(units.map((u) => u.id));
      return sq.ids;
    }
    if (this.defending || this.intruders().length) return NO_SQUAD;
    const core = this.core();
    const jobs = [];
    for (const z of this.w.zones) {
      if (!z.field) continue;
      const force = this.rivalForceAt(z);
      const lost = this.zoneLost.get(z.id);
      if (z.owner === this.team && ((z.holder != null && z.holder !== this.team) || force > 0)) jobs.push({ z, kind: 'defend', force, limit: cfg.defendOvermatch });
      else if (z.owner !== this.team && lost && now - lost.at <= cfg.lostMemory) jobs.push({ z, kind: 'recapture', force, limit: 1 });
    }
    if (!jobs.length) return NO_SQUAD;
    const dist = (z) => Math.hypot(z.field[0] * T - core.x, z.field[1] * T - core.y);
    jobs.sort((a, b) => (a.kind === b.kind ? dist(a.z) - dist(b.z) : a.kind === 'defend' ? -1 : 1));
    for (const job of jobs) {
      const at = { x: job.z.field[0] * T, y: job.z.field[1] * T };
      const picks = [...home].sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y)).slice(0, cfg.squadMax);
      if (picks.length < cfg.squadMin) return NO_SQUAD;
      const value = picks.reduce((n, u) => n + UNITS[u.type].supply * (u.hp / u.maxHp), 0);
      if (job.force > job.limit * value) continue;
      this.issue({ type: 'attackMove', ids: picks.map((u) => u.id), ...at });
      this.squad = { zone: job.z.id, kind: job.kind, since: now, ids: new Set(picks.map((u) => u.id)), clearSince: null };
      this.react(`zone-${job.kind}`, `${job.z.id}: ${picks.length} units vs ${job.force.toFixed(1)} seen`);
      return this.squad.ids;
    }
    return NO_SQUAD;
  }

  // ---- army control -------------------------------------------------------

  // Any team but ours is an enemy (Phase 6: N camps; in the 1v1 match that is
  // the one other camp, and the sandbox's test targets). Entities without a
  // team (gold mines) are nobody's.
  isEnemyTeam(team) { return !!team && team !== this.team; }

  // Where a camp's Castle started (everyone knows the map).
  campStart(camp) {
    const T = this.w.grid.tile;
    return { x: (camp.core[0] + 2) * T, y: (camp.core[1] + 2) * T };
  }

  // Rival camps still in the game: they still have a completed Castle.
  // (Which camps remain is public: the HUD shows it to the player too.)
  livingRivals() {
    const alive = new Set();
    for (const b of this.w.ofKind('building')) if (b.type === 'core' && b.built && b.hp > 0) alive.add(b.team);
    return this.w.camps.filter((c) => c.team !== this.team && alive.has(c.team));
  }

  // More than one rival (the free-for-all) with Phase 7 targeting on. In the
  // 1v1 match this is false and every decision is the Phase 2-6 one.
  multi() { return this.targeting === 'assess' && this.w.camps.length > 2; }

  // This round's rival ranking (PHASE7_SPEC.md "Priority formula"), computed
  // once per scan/decision time. Stickiness goes to the target we last had.
  intel() {
    if (!this.intelCache || this.intelCache.at !== this.w.time) this.intelCache = rankRivals(this, this.lastTarget ?? null, this.avoid ??= new Set());
    return this.intelCache;
  }

  // Which rival camp we are aiming at. Phase 7 (free-for-all): the top of the
  // ranking that is not clearly stronger; when cautious, the top of the
  // ranking all the same (for the rally point and scouting only: no wave goes
  // there). Otherwise the Phase 6 rule.
  targetCamp() {
    if (this.multi()) {
      const i = this.intel(), team = i.target ?? i.ranking[0]?.team;
      const camp = team != null && this.w.camps.find((c) => c.team === team);
      if (camp) return camp;
    }
    return this.nearestCamp();
  }

  // The Phase 6 placeholder rule: the nearest living rival camp by
  // straight-line distance between Castle starts, ties to the lower team
  // number. In the 1v1 match there is only one rival, so this is exactly the
  // Phase 2-5 behaviour.
  nearestCamp() {
    const own = this.w.camps.find((c) => c.team === this.team);
    const rivals = this.livingRivals();
    const pool = rivals.length ? rivals : this.w.camps.filter((c) => c.team !== this.team);
    if (!own) return pool[0];
    const from = this.campStart(own);
    let best = null, bestD = Infinity;
    for (const c of pool) {
      const p = this.campStart(c), d = Math.hypot(p.x - from.x, p.y - from.y);
      if (d < bestD || (d === bestD && c.team < best.team)) { bestD = d; best = c; }
    }
    return best;
  }

  // Caution (PHASE7_SPEC.md "Caution: claim instead of attack"): the nearest
  // non-home zone we don't own that no rival is seen holding, or null.
  claimZone() {
    const core = this.core();
    if (!core || !this.w.zones) return null;
    let best = null, bestD = Infinity;
    for (const z of this.w.zones) {
      if (!z.field || z.owner === this.team) continue;
      const f = this.zoneField(z);
      if (this.contested(f)) continue;
      const d = Math.hypot(f.center.x - core.x, f.center.y - core.y);
      if (d < bestD) { bestD = d; best = { id: z.id, x: f.center.x, y: f.center.y }; }
    }
    return best;
  }

  // What an attack wave is for, in the free-for-all: a rival camp, a zone to
  // claim, or (cautious with nothing to claim) nothing: hold at home.
  waveGoal() {
    const i = this.intel();
    if (!i.cautious) return { key: `camp ${i.target}`, team: i.target };
    const z = this.claimZone();
    return z ? { key: `claim ${z.id}`, claim: z } : { key: 'hold' };
  }

  enemyTeam() { return this.targetCamp().team; }

  // The target camp's start. When the target changes (it was eliminated), what
  // the scout learned about the old target's start no longer applies.
  enemyStart() {
    const camp = this.targetCamp();
    if (this.lastTarget !== camp.team) {
      if (this.lastTarget != null) { this.scout.startEmptyAt = null; this.searchIdx = 0; }
      this.lastTarget = camp.team;
    }
    return this.campStart(camp);
  }

  // What to hit (Phase 3): the nearest enemy Command Core the scout knows of;
  // with none known, the enemy start, unless that has been seen empty, then the
  // nearest enemy building still believed standing, then a sweep of the enemy
  // half (SCOUTING.searchPoints). Returns
  // the Core itself when one is known, otherwise a { x, y } point.
  attackTarget() {
    if (this.multi() && this.goal?.claim) return this.goal.claim;
    const home = this.core() || this.enemyStart();
    const [known] = this.scout.knownCores(home, this.enemyTeam());
    if (known) {
      const live = this.w.get(known.id);
      return live && live.hp > 0 ? live : { x: known.x, y: known.y };
    }
    const start = this.enemyStart();
    if (this.scout.startEmptyAt == null) return start;
    const seen = this.scout.knownBuildings(undefined, this.enemyTeam())
      .sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y));
    if (seen.length) return { x: seen[0].x, y: seen[0].y };
    // Nothing known: sweep the enemy half, moving on once a point is in sight.
    const pts = SCOUTING.searchPoints, T = this.w.grid.tile, cols = this.w.grid.cols;
    const east = start.x > this.w.width / 2; // the points are written for the west half
    const at = (i) => {
      const [tx, ty] = pts[i % pts.length];
      return { x: ((east ? cols - tx : tx)) * T, y: ty * T };
    };
    this.searchIdx ??= 0;
    for (let n = 0; n < pts.length && this.scout.sees(at(this.searchIdx).x, at(this.searchIdx).y); n++) this.searchIdx++;
    return at(this.searchIdx);
  }

  rallyPoint() {
    const c = this.core(), e = this.enemyStart(), T = this.w.grid.tile;
    const d = Math.hypot(e.x - c.x, e.y - c.y) || 1;
    return { x: c.x + ((e.x - c.x) / d) * ARMY.rallyTiles * T, y: c.y + ((e.y - c.y) / d) * ARMY.rallyTiles * T };
  }

  nearBase(x, y) {
    for (const b of this.mine('building')) if (Math.hypot(b.x - x, b.y - y) < ARMY.homeRadius) return true;
    return false;
  }

  // Enemy combat units currently inside our base area.
  intruders() {
    const out = [];
    for (const u of this.w.ofKind('unit')) {
      if (this.isEnemyTeam(u.team) && COMBAT_TYPES.includes(u.type) && this.nearBase(u.x, u.y)) out.push(u);
    }
    return out;
  }

  commandArmy() {
    const s = this.s;
    const rally = this.rallyPoint();
    for (const f of this.mine('building', 'foundry')) {
      if (f.built && !this.rallySet.has(f.id)) { this.issue({ type: 'rally', building: f.id, ...rally }); this.rallySet.add(f.id); }
    }
    const inWave = new Set(this.wave.filter((id) => this.w.get(id)));
    this.wave = [...inWave];
    const guards = this.postGuards(this.army().filter((u) => !inWave.has(u.id)));
    const squad = this.multi() ? this.holdZones(this.army().filter((u) => !inWave.has(u.id) && !guards.has(u.id)), rally) : NO_SQUAD;
    const army = this.army().filter((u) => !guards.has(u.id) && !squad.has(u.id));
    const home = army.filter((u) => !inWave.has(u.id));

    // Defend mode (early-aggression trigger): recall any wave and send the whole
    // army at the threat; no new waves until it ends.
    if (this.defending) {
      const seen = this.scout.intrudersSeen();
      const at = seen[0] || this.intruders()[0];
      if (this.mode === 'attack') { this.mode = 'gather'; this.wave = []; this.note('wave recalled to defend'); }
      const free = army.filter((u) => u.order.type !== 'attack' && !(u.order.type === 'attackMove' && at && Math.hypot(u.order.x - at.x, u.order.y - at.y) < 64));
      if (at && free.length) this.issue({ type: 'attackMove', ids: free.map((u) => u.id), x: at.x, y: at.y });
      else if (!at) {
        const idleAway = army.filter((u) => u.order.type === 'idle' && !this.nearBase(u.x, u.y));
        if (idleAway.length) this.issue({ type: 'move', ids: idleAway.map((u) => u.id), ...rally });
      }
      return;
    }
    // Defense: idle units at home go after intruders.
    const threats = this.intruders();
    if (threats.length) {
      const idle = home.filter((u) => u.order.type !== 'attack' && u.order.type !== 'attackMove');
      if (idle.length) this.issue({ type: 'attackMove', ids: idle.map((u) => u.id), x: threats[0].x, y: threats[0].y });
    }

    if (this.mode === 'attack') {
      if (!this.wave.length || (s.retreatBelow != null && this.wave.length < s.retreatBelow * this.waveSize)) {
        if (this.wave.length) { this.issue({ type: 'move', ids: this.wave, ...rally }); this.note(`retreat with ${this.wave.length}`); }
        this.mode = 'gather';
        this.wave = [];
        return;
      }
      if (this.multi() && this.retarget(rally)) return;
      // Reinforcements travel in groups so they aren't fed in one at a time.
      if (s.reinforce && home.length >= (s.reinforceMin ?? 1) && !threats.length) {
        this.joinWave(home);
      }
      this.pressAttack();
      return;
    }
    // A wave leaves when the army at home reaches the unit-count threshold, or
    // (for strategies that build up) the army-supply threshold.
    // Each wave's size threshold varies by +/- waveJitter (the engine's own
    // seeded RNG), so wave timing isn't one fixed, exploitable moment.
    this.waveFactor ??= 1 + (s.waveJitter || 0) * (2 * this.rng.next() - 1);
    const need = (this.stats.waves === 0 ? s.firstWave : s.wave) * this.waveFactor;
    const baseSupply = this.stats.waves === 0 ? s.firstWaveSupply : s.waveSupply;
    const needSupply = baseSupply == null ? null : baseSupply * this.waveFactor;
    const homeSupply = home.reduce((n, u) => n + UNITS[u.type].supply, 0);
    const ready = needSupply != null ? homeSupply >= needSupply : home.length >= need;
    if (!threats.length && ready) {
      if (this.multi()) { // Phase 7: attack the pick, claim land, or hold
        this.goal = this.waveGoal();
        this.goalSince = this.w.time;
        if (this.goal.key === 'hold') { this.posture('holding', 'every rival is clearly stronger and no free zone to claim'); return; }
        this.posture(this.goal.claim ? `claiming ${this.goal.claim.id}` : `attacking camp ${this.goal.team}`, this.goalWhy());
      }
      this.mode = 'attack';
      this.waveFactor = null; // the next wave draws a new threshold
      this.waveSize = home.length;
      this.stats.waves++;
      this.note(`wave ${this.stats.waves}: ${home.length} units attack`);
      this.joinWave(home);
    }
  }

  // Why the current goal (the top reasons from the ranking).
  goalWhy() {
    const i = this.intel();
    if (this.goal?.team != null) return i.ranking.find((r) => r.team === this.goal.team)?.why.join(', ') || '';
    return i.ranking.map((r) => `camp ${r.team}: ${r.why[0]}`).join('; ');
  }

  // A posture change is logged as a reaction (tests, the dev panel).
  posture(p, why) {
    if (this.stance === p) return;
    this.stance = p;
    this.react(p.startsWith('attacking') ? 'target' : p.startsWith('claiming') ? 'cautious-claim' : 'cautious-hold', why ? `${p}: ${why}` : p);
  }

  // A wave in the field follows the ranking: a new pick, a claim instead of a
  // rival that turned out clearly stronger, or home if there is nothing to do.
  // Returns true when the wave was pulled home.
  retarget(rally) {
    const g = this.waveGoal();
    if (g.key === this.goal?.key || this.keepTarget(g)) return false;
    const was = this.goal?.key, prev = this.goal;
    this.goal = g;
    this.goalSince = this.w.time;
    if (g.key === 'hold') {
      this.issue({ type: 'move', ids: this.wave, ...rally });
      this.mode = 'gather'; this.wave = [];
      this.react('retarget', `${was} -> hold: every rival is clearly stronger`);
      this.stance = 'holding';
      return true;
    }
    const t = this.attackTarget();
    this.issue({ type: 'attackMove', ids: this.wave, x: t.x, y: t.y });
    this.stance = g.claim ? `claiming ${g.claim.id}` : `attacking camp ${g.team}`;
    this.react('retarget', `${was} -> ${g.key}: ${this.goalWhy()}${this.leftBecause(prev, g)}`);
    return false;
  }

  // A wave marching on a rival keeps it unless that rival fell, turned out
  // clearly stronger, or the new pick scores switchMargin better: armies don't
  // turn round on every change in the numbers.
  keepTarget(g) {
    if (this.goal?.team == null || g.team == null) return false;
    const rank = this.intel().ranking, cur = rank.find((r) => r.team === this.goal.team), next = rank.find((r) => r.team === g.team);
    if (!cur || cur.avoided) return false;
    return next.score - cur.score < RIVALS.switchMargin || this.w.time - (this.goalSince ?? -Infinity) < RIVALS.commitTime;
  }

  // Why a wave left its old rival, for the log.
  leftBecause(prev, g) {
    if (prev?.team == null) return '';
    const rank = this.intel().ranking, cur = rank.find((r) => r.team === prev.team), next = rank.find((r) => r.team === g.team);
    if (!cur) return ` (camp ${prev.team} fell)`;
    if (cur.avoided) return ` (camp ${prev.team} clearly stronger, R ${cur.R.toFixed(2)})`;
    return next ? ` (scores ${(next.score - cur.score).toFixed(2)} above camp ${prev.team})` : '';
  }

  joinWave(units) {
    const t = this.attackTarget();
    this.issue({ type: 'attackMove', ids: units.map((u) => u.id), x: t.x, y: t.y });
    for (const u of units) this.wave.push(u.id);
  }

  // Near the enemy Core with no enemy units around: hit the Core directly.
  pressAttack() {
    const t = this.attackTarget();
    const core = t.type === 'core' ? t : null;
    const units = this.wave.map((id) => this.w.get(id)).filter(Boolean);
    if (!units.length) return;
    const cx = units.reduce((a, u) => a + u.x, 0) / units.length, cy = units.reduce((a, u) => a + u.y, 0) / units.length;
    const start = this.enemyStart(), mid = this.w.width / 2;
    if ((start.x < mid) === (cx < mid)) this.stats.reachedEnemySide = true;
    if (Math.hypot(cx - start.x, cy - start.y) < ARMY.homeRadius) this.stats.reachedEnemyBase = true;
    if (units.some((u) => u.order.type === 'attack' || (u.order.type === 'attackMove' && u.order.target))) this.stats.engaged = true;
    if (!core) {
      // No Core in sight yet: idle wave units head for the target point.
      const idle = units.filter((u) => u.order.type === 'idle' && Math.hypot(u.x - t.x, u.y - t.y) > 96);
      if (idle.length) this.issue({ type: 'attackMove', ids: idle.map((u) => u.id), x: t.x, y: t.y });
      return;
    }
    const near = units.filter((u) => Math.hypot(u.x - core.x, u.y - core.y) < ARMY.coreAssault + core.pw);
    if (!near.length) {
      const idle = units.filter((u) => u.order.type === 'idle');
      if (idle.length) this.issue({ type: 'attackMove', ids: idle.map((u) => u.id), x: core.x, y: core.y });
      return;
    }
    const defended = [...this.w.ofKind('unit')].some((e) => this.isEnemyTeam(e.team) && COMBAT_TYPES.includes(e.type)
      && Math.hypot(e.x - core.x, e.y - core.y) < ARMY.coreAssault + core.pw);
    const free = near.filter((u) => !(u.order.type === 'attack' && u.order.target === core.id) && u.order.type !== 'attack');
    if (!defended && free.length) {
      this.issue({ type: 'attack', ids: free.map((u) => u.id), target: core.id });
      this.stats.coreAssaults++;
    }
  }

  // One decision round. The match loop calls update() every tick, which calls
  // think() every `decisionInterval`; the Phase 1 bot test calls think() directly.
  think() {
    this.homeLeft(); // measures the home field on the first decision
    this.trackConstruction();
    this.gatherIdle();
    const opened = this.runOpening();
    if (this.s.noMacro) return; // the Phase 1 sandbox script is opening-only
    if (this.s.scouting !== false && this.scout.update()) { this.intelCache = null; this.evaluateTriggers(); }
    if (opened) this.macro();
    this.commandArmy();
  }

  update() {
    if (this.w.result || this.w.time < this.nextThinkAt) return;
    this.nextThinkAt = this.w.time + this.jittered(this.d.decisionInterval);
    if (!this.core()) return; // defeated
    this.think();
  }
}

const NO_SQUAD = new Set(); // never written: holdZones returns a fresh Set for a squad

// The massed type in a seen-army count (SPEC.md Phase 2 "massing"): at least
// massMin of one combat type and a majority of the army; the largest wins.
function massedIn(seen) {
  const cfg = SCOUTING, total = Object.values(seen).reduce((a, b) => a + b, 0);
  let type = null;
  for (const [t, n] of Object.entries(seen)) {
    if (n >= cfg.massMin && n / total >= cfg.massShare && (!type || n > seen[type])) type = t;
  }
  return type ? { type, seen, total } : null;
}

// The Phase 1 bot, now a thin preset of the engine running the sandbox script.
export class SandboxBot extends AiEngine {
  constructor(world, opts = {}) {
    super(world, { team: 1, strategy: 'sandbox', difficulty: 'hard', ...opts });
  }
}
