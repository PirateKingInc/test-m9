// AI perception (SPEC.md Phase 2 "Scouting: what the AI can see"). The AI does
// not get full map knowledge: it only records enemy entities inside its base
// watch or its units' sight, remembers them for a while, and sends one scout
// Drone to the enemy start. This is AI-side information only, not fog of war.
import { SCOUTING } from '../data/strategies.js';
import { COMBAT_TYPES } from './engine-types.js';

export class Scout {
  constructor(engine, cfg = SCOUTING) {
    this.e = engine;
    this.cfg = cfg;
    this.memory = new Map(); // enemy id -> { kind, type, x, y, seenAt, nearBase }
    // Enemy Command Cores ever seen (Phase 3 attack targeting). Cores don't move,
    // so one is forgotten only when its spot is back in view and it is gone.
    this.cores = new Map(); // id -> { id, x, y, seenAt }
    this.startEmptyAt = null; // when the enemy start was last seen with no Core
    this.nextScanAt = 0;
    this.scoutId = null;
    this.scoutSentAt = null;
    this.scoutDone = false;
    this.scoutArrivedAt = null;
    // Phase 7 (PHASE7_SPEC.md "What an AI camp knows about a rival"): fights we
    // witnessed. team -> { at, with } for a fight with a third camp; team -> time
    // for an attack on us.
    this.engaged = new Map();
    this.hitUs = new Map();
    // Phase 8 (PHASE8_SPEC.md "Part D"): when we last saw any unit or building
    // of each rival team, and the Peasant out re-scouting, if any.
    this.lastSeen = new Map();
    this.rescout = null; // { id, team, sentAt, arrivedAt }
    this.nextRescoutAt = 0;
  }

  // Where our eyes are: base watch circles around buildings, sight around units.
  eyes() {
    const eyes = [];
    for (const b of this.e.mine('building')) eyes.push({ x: b.x, y: b.y, r: this.cfg.baseWatch, base: true });
    for (const u of this.e.mine('unit')) eyes.push({ x: u.x, y: u.y, r: this.cfg.sight, base: false });
    return eyes;
  }

  scan() {
    const now = this.e.w.time;
    const eyes = this.eyes();
    const inView = (x, y) => {
      let seen = false, base = false;
      for (const eye of eyes) {
        if (Math.hypot(eye.x - x, eye.y - y) <= eye.r) { seen = true; if (eye.base) { base = true; break; } }
      }
      return { seen, base };
    };
    const seenNow = new Set();
    for (const t of this.e.w.entities.values()) {
      if (!this.e.isEnemyTeam(t.team) || (t.kind !== 'unit' && t.kind !== 'building') || t.hp <= 0) continue;
      const v = inView(t.x, t.y);
      if (!v.seen) continue;
      this.memory.set(t.id, { kind: t.kind, type: t.type, team: t.team, x: t.x, y: t.y, seenAt: now, nearBase: v.base, health: t.hp / t.maxHp });
      this.lastSeen.set(t.team, now);
      if (t.type === 'core') { this.cores.set(t.id, { id: t.id, team: t.team, x: t.x, y: t.y, seenAt: now, health: t.hp / t.maxHp }); seenNow.add(t.id); }
      this.witness(t, now);
    }
    for (const [id, c] of this.cores) if (!seenNow.has(id) && inView(c.x, c.y).seen) this.cores.delete(id);
    const start = this.e.enemyStart();
    if (inView(start.x, start.y).seen) {
      const there = [...this.cores.values()].some((c) => c.team === this.e.enemyTeam() && Math.hypot(c.x - start.x, c.y - start.y) < 200);
      this.startEmptyAt = there ? null : now;
    }
    // Unit sightings are remembered for `memory` seconds (even if that unit has
    // since died: "the enemy fielded six Strikers" is still true information).
    // Buildings don't move, so one is forgotten only once its spot is back in
    // view without it (Phase 3).
    for (const [id, m] of this.memory) {
      // A unit whose last spot is in view again without it: we saw it die or leave.
      if (m.kind === 'unit' && m.seenAt < now && !m.gone && inView(m.x, m.y).seen) m.gone = true;
      if (m.kind === 'building' ? m.seenAt < now && inView(m.x, m.y).seen : now - m.seenAt > this.cfg.memory) this.memory.delete(id);
    }
  }

  // A visible rival entity that is attacking: who it is fighting (its current
  // order's target, or a Tower's target, which is within its weapon range and
  // so in view too). Fights between two other camps mark both as engaged.
  witness(t, now) {
    const id = t.kind === 'unit' ? (t.order.type === 'attack' || t.order.type === 'attackMove' ? t.order.target : null) : t.target;
    const victim = id != null ? this.e.w.get(id) : null;
    if (!victim || !victim.team || victim.team === t.team) return;
    if (victim.team === this.e.team) { this.hitUs.set(t.team, now); return; }
    this.engaged.set(t.team, { at: now, with: victim.team });
    this.engaged.set(victim.team, { at: now, with: t.team });
  }

  // The scout Drone: sent once at the strategy's scoutAt, walks to the enemy
  // start, then goes back to mining (on arrival or after scoutGiveUp seconds).
  runScout() {
    const at = this.e.s.scoutAt, now = this.e.w.time;
    if (this.scoutDone || at == null || now < at) return;
    if (this.scoutId == null) {
      const d = this.e.mine('unit', 'drone').find((u) => u.order.type === 'gather' && u.carry === 0);
      if (!d) return;
      const p = this.e.enemyStart(); // the pathfinder stops at the nearest reachable tile
      this.e.issue({ type: 'move', ids: [d.id], x: p.x, y: p.y });
      this.scoutId = d.id;
      this.scoutSentAt = now;
      this.e.note('scout drone sent');
      return;
    }
    const d = this.e.w.get(this.scoutId);
    if (!d) { this.scoutDone = true; this.e.note('scout drone lost'); return; }
    if (d.order.type === 'idle') this.scoutArrivedAt ??= now;
    // Loiter at the enemy start long enough for two scans, then go back to work.
    const looked = this.scoutArrivedAt != null && now - this.scoutArrivedAt >= 2 * this.cfg.interval;
    if (looked || now - this.scoutSentAt > this.cfg.scoutGiveUp) {
      this.scoutDone = true; // gatherIdle() puts it back to work
      if (d.order.type !== 'idle') this.e.issue({ type: 'stop', ids: [d.id] });
      this.e.note('scout drone returning');
    }
  }

  // The Drone currently out scouting (gatherIdle leaves it alone).
  activeScout() { return this.scoutDone ? (this.rescout?.id ?? null) : this.scoutId; }

  // Seconds since we last saw any unit or building of `team` (Infinity: never).
  intelAge(team) {
    const t = this.lastSeen.get(team);
    return t == null ? Infinity : this.e.w.time - t;
  }

  // Re-scouting (Phase 8, free-for-all only): once the first scout is back,
  // send a Peasant to look again at the rival whose intel is stalest (our
  // current target first) once it is older than rescoutAfter, one at a time,
  // at most every rescoutEvery seconds. The same walk-loiter-return as the
  // first scout.
  runRescout(cfg) {
    const now = this.e.w.time, r = this.rescout;
    if (r) {
      const d = this.e.w.get(r.id);
      if (!d) { this.rescout = null; this.e.react('rescout-lost', `camp ${r.team}`); return; }
      if (d.order.type === 'idle') r.arrivedAt ??= now;
      const looked = r.arrivedAt != null && now - r.arrivedAt >= 2 * this.cfg.interval;
      if (looked || now - r.sentAt > cfg.rescoutGiveUp) {
        if (d.order.type !== 'idle') this.e.issue({ type: 'stop', ids: [d.id] });
        this.rescout = null; // gatherIdle puts it back to work
        this.e.note(`re-scout of camp ${r.team} done`);
      }
      return;
    }
    if (!this.scoutDone || now < this.nextRescoutAt) return;
    const target = this.e.lastTarget;
    const stale = [...this.e.livingRivals()].filter((c) => this.intelAge(c.team) > cfg.rescoutAfter)
      .sort((a, b) => (b.team === target) - (a.team === target) || this.intelAge(b.team) - this.intelAge(a.team) || a.team - b.team);
    if (!stale.length) return;
    const d = this.e.mine('unit', 'drone').find((u) => u.order.type === 'gather' && u.carry === 0);
    if (!d) return;
    const camp = stale[0], p = this.e.campStart(camp);
    this.e.issue({ type: 'move', ids: [d.id], x: p.x, y: p.y });
    this.rescout = { id: d.id, team: camp.team, sentAt: now, arrivedAt: null };
    this.nextRescoutAt = now + cfg.rescoutEvery;
    this.e.stats.scouts = (this.e.stats.scouts || 0) + 1;
    const age = this.intelAge(camp.team);
    this.e.react('rescout', `camp ${camp.team}: intel ${age === Infinity ? 'never gathered' : `${Math.round(age)} s old`}`);
  }

  update() {
    this.runScout();
    if (this.e.w.time < this.nextScanAt) return false;
    this.nextScanAt = this.e.w.time + this.cfg.interval;
    this.scan();
    return true;
  }

  // ---- derived knowledge -------------------------------------------------

  // Combat units seen in memory, by type (of one rival team, if given).
  seenArmy(team) {
    const counts = Object.fromEntries(COMBAT_TYPES.map((t) => [t, 0]));
    for (const m of this.memory.values()) if (m.kind === 'unit' && m.type in counts && (team == null || m.team === team)) counts[m.type]++;
    return counts;
  }

  // Enemy combat units seen inside our base watch in the latest scan.
  intrudersSeen() {
    const now = this.e.w.time;
    return [...this.memory.values()].filter((m) => m.kind === 'unit' && COMBAT_TYPES.includes(m.type) && m.nearBase && now - m.seenAt < this.cfg.interval + 0.01);
  }

  // Is (x, y) inside the sight of one of our units right now?
  sees(x, y) {
    for (const u of this.e.mine('unit')) if (Math.hypot(u.x - x, u.y - y) <= this.cfg.sight) return true;
    return false;
  }

  // Enemy Cores we know of (of one team, if given), nearest to `from` first.
  knownCores(from, team) {
    const out = [...this.cores.values()].filter((c) => team == null || c.team === team);
    if (from) out.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
    return out;
  }

  knownBuildings(type, team) {
    return [...this.memory.values()].filter((m) => m.kind === 'building' && (!type || m.type === type) && (team == null || m.team === team));
  }
}
