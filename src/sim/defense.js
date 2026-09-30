// Auto-defend (Phase 9, PHASE9_SPEC.md "Part A"). In every zone a camp owns,
// the camp's idle combat units engage the hostile units standing in it, then
// walk back to where they stood. A unit following any order of its own is
// never touched, and nothing outside the zone is pulled in. Zones exist only
// in the free-for-all; elsewhere this does nothing.
import { UNITS } from '../data/units.js';
import { AUTO_DEFEND } from '../data/camp-rules.js';
import { SIM_DT } from './constants.js';
import { zoneAt } from './territory.js';
import { setDestination, clearPath } from './movement.js';

// No order of its own: idle, or already under automatic control (Phase 1's
// idle auto-acquire, an auto-defend engagement or walk back).
const automatic = (u) => u.order.type === 'idle' || !!u.order.auto;
const defender = (u) => { const d = UNITS[u.type]; return !d.worker && !!d.attack; };

function nearest(u, list) {
  let best = null, bestD = Infinity;
  for (const t of list) {
    const d = Math.hypot(t.x - u.x, t.y - u.y);
    if (d < bestD || (d === bestD && t.id < best.id)) { bestD = d; best = t; }
  }
  return best;
}

// world.autoDefend = false switches the rule off (the freeze guard's proof
// that nothing else changed).
export function updateDefense(world) {
  if (!world.zones || world.autoDefend === false) return;
  if (world.tick % Math.max(1, Math.round(AUTO_DEFEND.scanEvery / SIM_DT)) !== 0) return;
  const inZone = new Map();
  for (const u of world.ofKind('unit')) {
    if (u.hp <= 0) continue;
    const z = zoneAt(world, u.x, u.y);
    if (!z) continue;
    if (!inZone.has(z)) inZone.set(z, []);
    inZone.get(z).push(u);
  }
  const engaged = new Set();
  for (const z of world.zones) {
    const team = z.owner, here = inZone.get(z);
    if (team == null || !here) continue;
    const hostile = here.filter((u) => u.team && u.team !== team);
    if (!hostile.length) continue;
    for (const d of here) {
      if (d.team !== team || !defender(d) || !automatic(d)) continue;
      engaged.add(d);
      const cur = d.order.type === 'attack' && d.order.defend === z.id ? world.get(d.order.target) : null;
      if (cur && hostile.includes(cur)) continue; // still on an intruder in the zone
      d.post ??= { x: d.x, y: d.y };
      d.order = { type: 'attack', target: nearest(d, hostile).id, auto: true, defend: z.id };
      clearPath(d);
    }
  }
  // The zone is clear (or the unit left it): back to the post, unless the post
  // is now in a zone the camp does not own, or a contested one.
  for (const u of world.ofKind('unit')) {
    if (!u.post || engaged.has(u) || !automatic(u)) continue;
    if (u.order.type === 'attack' && !u.order.defend) continue; // a Phase 1 auto-acquire fight finishes by its own rule
    const pz = zoneAt(world, u.post.x, u.post.y);
    if (!pz || pz.owner !== u.team || pz.contested) {
      u.post = null;
      if (u.order.defend) { u.order = { type: 'idle' }; clearPath(u); }
      continue;
    }
    if (Math.hypot(u.x - u.post.x, u.y - u.post.y) <= AUTO_DEFEND.returnSlack) {
      u.post = null;
      if (u.order.type !== 'idle') { u.order = { type: 'idle' }; clearPath(u); }
      continue;
    }
    if (!u.order.returning) {
      u.order = { type: 'move', x: u.post.x, y: u.post.y, auto: true, returning: true };
      setDestination(world, u, u.post.x, u.post.y);
    }
  }
}
