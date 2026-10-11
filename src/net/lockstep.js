// Phase 11 lockstep (PHASE11_SPEC.md "The tick loop"), now running on the
// lockstep module (platform/lockstep/core.js, Platform Milestone 1). This file
// is Dragonmarch as a game on that engine: DragonmarchGame is the game
// contract over a Match (commands become world.issue() with the sender's
// team; a held camp is played by the AI hold brain), and Lockstep keeps the
// Phase 11 constructor and names (match, world, humans, isHuman, local) that
// the rest of the game and its tests use.
import { Lockstep as CoreLockstep } from '../../platform/lockstep/index.js';
import { Match } from '../ai/match.js';
import { FFA_MAP } from '../data/ffa.js';
import { campsFor } from './lineup.js';
import { NET } from './net-rules.js';
import { HoldBrain } from './hold.js';
import { adoptRngs, registerClass, encode, decode, hashText } from './snapshot.js';

registerClass('HoldBrain', HoldBrain);

// What a player may ask of the world: the UI's commands. (No devSpawn, and
// the team is always the sender's slot, whatever the message says.)
export const PLAYER_COMMANDS = new Set(['move', 'attackMove', 'attack', 'stop', 'gather', 'build', 'assist', 'returnCargo',
  'train', 'cancelTrain', 'cancelBuild', 'rally', 'relocate']);

// The free-for-all of a Phase 10 lobby: slot n plays camp n, the AI the rest.
export function lobbyMatch({ seed, lineup, difficulty }, PF = globalThis.PF) {
  const match = new Match({ seed, PF, ffa: { map: FFA_MAP, camps: campsFor(lineup, difficulty) } });
  return adoptRngs(match, seed);
}
export const humansOf = (lineup) => [...lineup].map((c, i) => (c === 'H' ? i + 1 : 0)).filter(Boolean);

// The game contract (platform/lockstep/README.md) for a Dragonmarch match.
export class DragonmarchGame {
  constructor(match, holds = new Map()) {
    this.match = match;
    this.holds = holds; // team -> HoldBrain, while held
  }

  get world() { return this.match.world; }
  isOver() { return !!this.match.world.result; }
  validate(cmd) { return PLAYER_COMMANDS.has(cmd.type) ? undefined : 'Not allowed in multiplayer'; }

  // A disconnected player's camp: the AI hold mode (src/net/hold.js).
  hold(team) { const hb = new HoldBrain(team); this.holds.set(team, hb); hb.activate(this.world); }
  release(team) { this.holds.delete(team); }

  step(tick, inputs) {
    const w = this.world;
    // Human commands, by slot; the team is always the sender's.
    for (const { slot, commands } of inputs) for (const c of commands) if (PLAYER_COMMANDS.has(c.type)) w.issue({ ...c, team: slot });
    // AI hold brains (they decide nothing, by design).
    for (const team of [...this.holds.keys()].sort((a, b) => a - b)) this.holds.get(team).update(w);
    // The world, then the free-for-all AI camps, exactly as single-player.
    this.match.step();
  }

  serialize() { return encode({ match: this.match, holds: this.holds }); }
  hash() { return hashText(JSON.stringify(this.serialize())); }
  static restore(data, PF = globalThis.PF) { const { match, holds } = decode(data, { PF }); return new DragonmarchGame(match, holds); }
}

export class Lockstep extends CoreLockstep {
  // match: a freshly built match (every peer builds the same one); humans: the
  // human slots; me: this peer's slot.
  constructor({ match, humans, me, delay = NET.inputDelay, shared = null, game = null, tick }) {
    game ||= new DragonmarchGame(match);
    super({ game, players: humans, me, delay, shared, tick: tick ?? game.world.tick });
  }

  get match() { return this.game.match; }
  get world() { return this.game.world; }
  get humans() { return this.players; }
  isHuman(slot, k) { return this.inControl(slot, k); }

  // A command from this player's UI (or a scripted player).
  local(cmd) {
    if (!PLAYER_COMMANDS.has(cmd.type)) return { ok: false, reason: 'Not allowed in multiplayer' };
    const { team, ...rest } = cmd; // eslint-disable-line no-unused-vars
    return this.submit(rest);
  }

  static restore(snap, { humans, me, delay = NET.inputDelay, PF = globalThis.PF }) {
    const { game, control, sys } = snap.state;
    return new Lockstep({ game: DragonmarchGame.restore(game, PF), humans, me, delay, shared: { control: new Map(control), sys: new Map(sys) }, tick: snap.tick });
  }
}
