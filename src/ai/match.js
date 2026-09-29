// Match loop: step the world, then let each AI brain decide. The World knows
// nothing about AI; brains only read it and call world.issue().
import { World } from '../sim/world.js';
import { AiEngine } from './engine.js';
import { SIM_DT } from '../sim/constants.js';

export class Match {
  // ai: { strategy, difficulty } for team 2 (or null for no opponent).
  // player: optional { strategy, difficulty } to have team 1 scripted too (tests,
  // fairness runs). view: optional (world) => read-only view for guard tests.
  //
  // Free-for-all (Phase 6): pass `ffa: { map, camps: { team: { strategy, difficulty } } }`
  // for the AI camps (teams 2-4 on the free-for-all map); `player` still scripts
  // team 1 if given, otherwise team 1 is the human (or idle, headless).
  constructor({ seed = 1337, PF = globalThis.PF, ai = { strategy: 'rush', difficulty: 'hard' }, player = null, view = (w) => w, ffa = null } = {}) {
    this.brains = [];
    if (ffa) {
      this.world = new World({ seed, PF, map: ffa.map, setup: 'ffa' });
      for (const [team, cfg] of Object.entries(ffa.camps).sort((a, b) => a[0] - b[0])) {
        this.brains.push(new AiEngine(this.world, { team: Number(team), seed, view: view(this.world), ...cfg }));
      }
    } else {
      this.world = new World({ seed, PF, setup: 'match' });
      if (ai) this.brains.push(new AiEngine(this.world, { team: 2, seed, view: view(this.world), ...ai }));
    }
    if (player) this.brains.push(new AiEngine(this.world, { team: 1, seed: seed + 7, view: view(this.world), ...player }));
  }

  get ai() { return this.brains.find((b) => b.team === 2); }
  get player() { return this.brains.find((b) => b.team === 1); }

  step() {
    this.world.step();
    for (const b of this.brains) b.update();
  }

  run(seconds) {
    const n = Math.round(seconds / SIM_DT);
    for (let i = 0; i < n && !this.world.result; i++) this.step();
  }

  // Play until the match is decided (the 30:00 limit guarantees it).
  runToEnd() {
    while (!this.world.result) this.step();
    return this.world.result;
  }
}
