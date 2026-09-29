// Territory (Phase 6, PHASE6_SPEC.md "Territory"). The free-for-all map is
// divided into zones; each has an owner at all times: a camp's team, or null
// (neutral). Home zones are locked to their camp while its Castle stands; every
// other zone goes to a camp that holds it alone, militarily, for captureHold
// seconds. Worlds without zones (the sandbox, the 1v1 match) skip all of this.
import { UNITS } from '../data/units.js';
import { TERRITORY } from '../data/ffa.js';
import { SIM_DT } from './constants.js';
import { hasCore } from './victory.js';

export function setupZones(world, zones) {
  world.zones = zones.map((z) => ({
    id: z.id, rect: z.rect, home: z.home ?? null, field: z.field ?? null,
    owner: z.home ?? null, // camps own their home zone; the rest start neutral
    holder: null, holdSince: null, contested: false,
  }));
}

export const zoneAt = (world, x, y) => {
  const T = world.grid.tile, tx = Math.floor(x / T), ty = Math.floor(y / T);
  return world.zones?.find(({ rect: [zx, zy, w, h] }) => tx >= zx && ty >= zy && tx < zx + w && ty < zy + h) ?? null;
};

// Military presence: combat units (not Peasants), completed Watchtowers and
// completed Castles of the camps in play. Returns zone id -> Set of teams.
export function presence(world) {
  const out = new Map(world.zones.map((z) => [z.id, new Set()]));
  const teams = new Set(world.teams);
  for (const u of world.ofKind('unit')) {
    if (!teams.has(u.team) || u.hp <= 0 || UNITS[u.type].worker) continue;
    const z = zoneAt(world, u.x, u.y);
    if (z) out.get(z.id).add(u.team);
  }
  for (const b of world.ofKind('building')) {
    if (!teams.has(b.team) || !b.built || b.hp <= 0 || (b.type !== 'spire' && b.type !== 'core')) continue;
    const z = zoneAt(world, b.x, b.y);
    if (z) out.get(z.id).add(b.team);
  }
  return out;
}

export const zonesOf = (world, team) => (world.zones || []).filter((z) => z.owner === team);

// Once every TERRITORY.interval seconds (tick-aligned, so it is deterministic).
export function updateTerritory(world) {
  if (!world.zones) return;
  const every = Math.round(TERRITORY.interval / SIM_DT);
  if (world.tick % every !== 0) return;
  const seen = presence(world);
  for (const z of world.zones) {
    if (z.home != null && hasCore(world, z.home)) { // locked while the home camp stands
      z.owner = z.home; z.holder = null; z.holdSince = null; z.contested = false;
      continue;
    }
    const here = seen.get(z.id);
    z.contested = here.size >= 2;
    const only = here.size === 1 ? [...here][0] : null;
    if (only == null || only === z.owner) { z.holder = null; z.holdSince = null; continue; }
    if (z.holder !== only) { z.holder = only; z.holdSince = world.time; }
    if (world.time - z.holdSince >= TERRITORY.captureHold - 1e-9) {
      const from = z.owner;
      z.owner = only; z.holder = null; z.holdSince = null;
      world.emit('zoneCaptured', { zone: z.id, from, to: only });
    }
  }
}
