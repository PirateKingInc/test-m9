// A scripted Ringout player (for tests, and to fill in for a player in a
// demo). It reads the game and sends commands like a person: steer toward the
// nearest rival, back toward the middle when near the edge, dash when close.
// It decides only every few ticks and sends a command only when it changes
// its mind, so its traffic looks like a player's. Deterministic for a seed.
import { SeededRng } from '../../platform/lockstep/index.js';

const DIRS = 16;
const dirOf = (dx, dy) => ((Math.round((Math.atan2(dy, dx) * DIRS) / (Math.PI * 2)) % DIRS) + DIRS) % DIRS;

export class Bot {
  constructor(slot, seed = 1) {
    this.slot = slot;
    this.rng = new SeededRng(seed * 7919 + slot);
    this.dir = -1;
  }

  // game: the Ringout state; submit(cmd): how a command reaches the lockstep.
  act(game, submit) {
    if (game.tick % 3 !== 0 || game.phase !== 'play') return;
    const me = game.pucks[this.slot];
    if (!me || me.out) return;
    const rivals = game.slots.filter((s) => s !== this.slot && !game.pucks[s].out).map((s) => game.pucks[s]);
    let dir = -1;
    const fromMiddle = Math.hypot(me.x, me.y);
    if (fromMiddle > game.radius * 0.72) dir = dirOf(-me.x, -me.y); // back from the edge
    else if (rivals.length) {
      const t = rivals.reduce((a, b) => (Math.hypot(a.x - me.x, a.y - me.y) <= Math.hypot(b.x - me.x, b.y - me.y) ? a : b));
      const dx = t.x - me.x, dy = t.y - me.y;
      dir = dirOf(dx, dy);
      if (this.rng.next() < 0.2) dir = (dir + (this.rng.next() < 0.5 ? 1 : DIRS - 1)) % DIRS; // a little wobble
      if (Math.hypot(dx, dy) < 90 && me.cd === 0 && this.rng.next() < 0.5) submit({ type: 'dash' });
    }
    if (dir !== this.dir) { this.dir = dir; submit({ type: 'steer', dir }); }
  }
}
