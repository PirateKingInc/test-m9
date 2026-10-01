// Phase 12 scale scenario (PHASE12_SPEC.md "Part A"): every camp's army at a
// given supply cap, in a real match with its AI running, then a forced clash.
// Pure sim code: tools/scale.mjs runs it headless in Node and
// e2e/scale-mobile.spec.js runs it in the browser game.
import { UNITS } from '../src/data/units.js';
import { SUPPLY } from '../src/data/buildings.js';

// Army compositions, as a repeating list of unit types.
// - mix: a realistic late-game army (the AI's own mixes lean on 1-supply
//   units, with a share of Dragon Riders and Shield Knights): 1.5 supply a unit.
// - swarm: the worst case for unit count, every soldier 1 supply.
export const MIXES = {
  mix: ['striker', 'sparker', 'striker', 'sparker', 'lancer', 'bulwark'],
  swarm: ['striker', 'sparker'],
};
export const DRONES_AT_CAP = 20; // Peasants a full economy keeps working

// Raise the cap for this run (the data value is restored by the caller).
export function setCap(cap) { const old = SUPPLY.max; SUPPLY.max = cap; return old; }

// Fill each camp to `cap` supply: Peasants up to DRONES_AT_CAP, then soldiers
// from the composition, placed one per free tile spiralling out of its Castle.
export function fillArmies(world, cap, mix = 'mix') {
  const types = MIXES[mix];
  const out = {}, T = world.grid.tile;
  const taken = new Set([...world.ofKind('unit')].map((u) => { const t = world.grid.tileOf(u.x, u.y); return `${t.tx},${t.ty}`; }));
  for (const team of world.teams) {
    const core = [...world.ofKind('building')].find((b) => b.team === team && b.type === 'core');
    if (!core) continue;
    const ct = world.grid.tileOf(core.x, core.y);
    const tiles = world.grid.spiral(ct.tx, ct.ty, 40);
    let used = 0;
    for (const e of world.ofKind('unit')) if (e.team === team) used += UNITS[e.type].supply;
    const add = (type) => {
      for (;;) {
        const t = tiles.next();
        if (t.done) return false;
        const { tx, ty } = t.value;
        if (taken.has(`${tx},${ty}`)) continue;
        taken.add(`${tx},${ty}`);
        world.addUnit(type, team, (tx + 0.5) * T, (ty + 0.5) * T);
        used += UNITS[type].supply;
        return true;
      }
    };
    let drones = [...world.ofKind('unit')].filter((u) => u.team === team && u.type === 'drone').length;
    while (drones < Math.min(DRONES_AT_CAP, Math.floor(cap / 3)) && used + 1 <= cap && add('drone')) drones++;
    for (let i = 0; used < cap; i++) {
      const type = types[i % types.length];
      if (used + UNITS[type].supply > cap) { if (UNITS.striker.supply + used <= cap && add('striker')) continue; break; }
      if (!add(type)) break;
    }
    out[team] = { units: [...world.ofKind('unit')].filter((u) => u.team === team).length, supply: used };
  }
  return out;
}

// The clash: every camp's soldiers attack-move to the middle of the map (the
// free-for-all) or to the enemy Castle (the 1v1), through the gates and
// chokepoints; Peasants keep working. The AI keeps deciding afterwards.
export function charge(world) {
  const cores = [...world.ofKind('building')].filter((b) => b.type === 'core');
  const mid = { x: world.width / 2, y: world.height / 2 };
  for (const team of world.teams) {
    const ids = [...world.ofKind('unit')].filter((u) => u.team === team && u.type !== 'drone').map((u) => u.id);
    if (!ids.length) continue;
    const enemy = world.teams.length === 2 ? cores.find((b) => b.team !== team) : null;
    const at = enemy ? { x: enemy.x, y: enemy.y } : mid;
    world.issue({ type: 'attackMove', ids, x: at.x, y: at.y, team });
  }
}

export const unitCount = (world) => [...world.ofKind('unit')].length;
