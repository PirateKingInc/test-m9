// Combat (SPEC.md "Units" / "Damage multipliers"): targeting, chasing, damage and death.
import { UNITS, DAMAGE_MULTIPLIERS, COMBAT } from '../data/units.js';
import { BUILDINGS } from '../data/buildings.js';
import { registerCommand, registerOrder, ownUnits, setAnchor } from './orders.js';
import { setDestination, followPath, clearPath, approach } from './movement.js';
import { gap } from './geometry.js';

const SCAN_EVERY = 5; // ticks between target scans for idle / attack-moving units
const RECHASE = 24; // px the target may drift before the chase path is recomputed

export function weaponOf(e) {
  if (e.kind === 'unit') { const d = UNITS[e.type]; return d.attack ? d : null; }
  if (e.kind === 'building' && e.built) return BUILDINGS[e.type].weapon || null;
  return null;
}

const armorOf = (e) => (e.kind === 'unit' ? UNITS[e.type].armor : 'structure');
const isEnemy = (a, b) => b.team && b.team !== a.team && b.hp > 0 && (b.kind === 'unit' || b.kind === 'building');

export function damageRoll(world, weapon, target) {
  const k = 1 + COMBAT.damageSpread * (2 * world.rng.next() - 1);
  return weapon.damage * DAMAGE_MULTIPLIERS[weapon.attack][armorOf(target)] * k;
}

// Nearest enemy within `range` gap; units are preferred over buildings, and ties go
// to the lowest id (exactly what a brute-force scan in id order picks). Uses the
// per-tick spatial index, so each scan only looks at nearby cells.
export function findEnemy(world, e, range) {
  let best = null, bestScore = Infinity;
  const own = e.kind === 'unit' ? e.radius : Math.hypot(e.pw, e.ph) / 2;
  world.spatial.query(e.x, e.y, range + own, (t) => {
    if (!isEnemy(e, t) || !world.entities.has(t.id)) return;
    const d = gap(e, t);
    if (d > range) return;
    const score = d + (t.kind === 'building' ? 10000 : 0);
    if (score < bestScore || (score === bestScore && t.id < best.id)) { bestScore = score; best = t; }
  });
  return best;
}

// Fire at the target if it's in range and the weapon is ready. Returns true if in range.
function engage(world, e, target, weapon) {
  if (gap(e, target) > weapon.range) return false;
  e.facing = Math.atan2(target.y - e.y, target.x - e.x);
  if (e.cooldown <= 1e-9) {
    const dmg = damageRoll(world, weapon, target);
    const before = target.hp;
    target.hp -= dmg;
    if (before > 0 && target.hp <= 0) target.killedBy = e.team; // the killing blow (Phase 6 capture)
    target.lastHit = world.time;
    e.cooldown = weapon.cooldown;
    world.emit('attack', { id: e.id, target: target.id, attack: weapon.attack, x: e.x, y: e.y, tx: target.x, ty: target.y, team: e.team });
    retaliate(target, e);
  }
  return true;
}

// Idle combat units that get shot fight back even if the shooter is out of aggro range.
function retaliate(victim, attacker) {
  if (victim.kind !== 'unit' || victim.order.type !== 'idle' || victim.hp <= 0) return;
  if (!weaponOf(victim) || UNITS[victim.type].worker) return;
  victim.order = { type: 'attack', target: attacker.id, auto: true };
}

// Move toward the target: straight path to units (re-planned as they move), edge tile for buildings.
function chase(world, u, target, dt) {
  if (target.kind === 'building') { approach(world, u, target, dt); return; }
  const d = u.dest;
  if (!u.path || !d || Math.hypot(d.x - target.x, d.y - target.y) > RECHASE) setDestination(world, u, target.x, target.y);
  followPath(world, u, dt);
}

registerCommand('attack', (world, cmd) => {
  const units = ownUnits(world, cmd).filter((u) => weaponOf(u));
  const target = world.get(cmd.target);
  if (!target || !units.length || !isEnemy(units[0], target)) return { ok: false };
  for (const u of units) { u.order = { type: 'attack', target: target.id }; clearPath(u); }
  return { ok: true };
});

registerCommand('attackMove', (world, cmd) => {
  const units = ownUnits(world, cmd).filter((u) => weaponOf(u));
  for (const u of units) {
    u.order = { type: 'attackMove', x: cmd.x, y: cmd.y, target: null };
    setDestination(world, u, cmd.x, cmd.y);
  }
  return { ok: units.length > 0 };
});

registerOrder('attack', (world, u, dt) => {
  const o = u.order, target = world.get(o.target), weapon = weaponOf(u);
  if (!target || target.hp <= 0 || (o.auto && gap(u, target) > COMBAT.leashRange)) {
    u.order = { type: 'idle' }; clearPath(u); return;
  }
  if (engage(world, u, target, weapon)) clearPath(u);
  else chase(world, u, target, dt);
});

registerOrder('attackMove', (world, u, dt) => {
  const o = u.order, weapon = weaponOf(u);
  let target = o.target ? world.get(o.target) : null;
  if (target && (target.hp <= 0 || gap(u, target) > COMBAT.leashRange)) {
    target = null; o.target = null;
    setDestination(world, u, o.x, o.y); // resume the march
  }
  if (!target && (world.tick + u.id) % SCAN_EVERY === 0) {
    target = findEnemy(world, u, Math.max(COMBAT.aggroRange, weapon.range));
    if (target) o.target = target.id;
  }
  if (target) {
    if (engage(world, u, target, weapon)) clearPath(u);
    else chase(world, u, target, dt);
    return;
  }
  if (!u.path) setDestination(world, u, o.x, o.y);
  if (followPath(world, u, dt) !== 'moving') { u.order = { type: 'idle' }; setAnchor(u); }
});

// Called every tick after orders: cooldowns, idle auto-acquire, turrets, deaths.
export function updateCombat(world, dt) {
  for (const e of world.entities.values()) {
    if (e.cooldown > 0) e.cooldown = Math.max(0, e.cooldown - dt);
    const weapon = weaponOf(e);
    if (!weapon) continue;
    if (e.kind === 'building') {
      const t = (e.target && world.get(e.target)) || null;
      const target = t && t.hp > 0 && gap(e, t) <= weapon.range ? t : findEnemy(world, e, weapon.range);
      e.target = target?.id ?? null;
      if (target) engage(world, e, target, weapon);
    } else if (e.order.type === 'idle' && !UNITS[e.type].worker && (world.tick + e.id) % SCAN_EVERY === 0) {
      const target = findEnemy(world, e, Math.max(COMBAT.aggroRange, weapon.range));
      if (target) e.order = { type: 'attack', target: target.id, auto: true };
    }
  }
  for (const e of [...world.entities.values()]) {
    if ((e.kind === 'unit' || e.kind === 'building') && e.hp <= 0) {
      world.removeEntity(e);
      // A completed Castle's killer is remembered for free-for-all capture (Phase 6).
      if (e.type === 'core' && e.built) (world.castleKills ||= {})[e.team] = e.killedBy ?? null;
      world.emit('death', { id: e.id, kind: e.kind, unit: e.type, team: e.team, x: e.x, y: e.y, by: e.killedBy });
    }
  }
}

registerCommand('devSpawn', (world, cmd) => {
  if (!UNITS[cmd.unit]) return { ok: false };
  const u = world.addUnit(cmd.unit, cmd.team ?? 2, cmd.x, cmd.y);
  return { ok: true, id: u.id };
});
