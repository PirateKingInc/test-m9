// Phase 11 AI hold (PHASE11_SPEC.md "Disconnects and AI hold"): the camp of a
// player who has disconnected. Not Rush, Boom or Turtle: at takeover it sends
// the army home and points every rally home, then makes no decision at all.
// Queued production completes, Peasants keep their orders, nothing new is
// trained or built, and Phase 9's auto-defend makes the idle garrison fight
// whatever enters the camp's zones. It looks like a camp whose player stopped.
import { UNITS } from '../data/units.js';
import { BUILDINGS } from '../data/buildings.js';

const isCombat = (u) => !!UNITS[u.type].attack && !UNITS[u.type].worker;

// The camp's home: its home zone in the free-for-all; around its Castle otherwise.
export function homeOf(world, team) {
  const T = world.grid.tile;
  const z = world.zones?.find((q) => q.home === team);
  if (z) {
    const [zx, zy, w, h] = z.rect;
    return { x: (zx + w / 2) * T, y: (zy + h / 2) * T, contains: (u) => u.x >= zx * T && u.y >= zy * T && u.x < (zx + w) * T && u.y < (zy + h) * T };
  }
  const core = [...world.ofKind('building')].find((b) => b.team === team && b.type === 'core');
  if (!core) return null;
  const r = 8 * T;
  return { x: core.x, y: core.y, contains: (u) => (u.x - core.x) ** 2 + (u.y - core.y) ** 2 <= r * r };
}

export class HoldBrain {
  constructor(team) {
    this.team = team;
    this.since = null; // the tick the hold began
  }

  // The only orders the hold ever gives, at the tick it begins.
  activate(world) {
    this.since = world.tick;
    const home = homeOf(world, this.team);
    if (!home) return;
    const army = [...world.ofKind('unit')].filter((u) => u.team === this.team && isCombat(u));
    // Out of the home zone, or on an order its player gave (an attack, a march): home.
    const recall = army.filter((u) => !home.contains(u) || (u.order.type !== 'idle' && !u.order.auto));
    if (recall.length) world.issue({ type: 'move', ids: recall.map((u) => u.id), x: home.x, y: home.y, team: this.team });
    // Units still in the queue come out and stay home.
    for (const b of world.ofKind('building')) {
      if (b.team === this.team && BUILDINGS[b.type].trains.length) world.issue({ type: 'rally', building: b.id, x: home.x, y: home.y, team: this.team });
    }
  }

  // No decisions: no training, building, expansion or attacks.
  update() {}
}
