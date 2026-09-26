// Match statistics for the result screen, tallied from the sim's event stream.
// Render-side only: it reads events and never touches sim state.
export class MatchStats {
  constructor(teams = [1, 2]) {
    this.teams = Object.fromEntries(teams.map((t) => [t, { lumen: 0, trained: 0, built: 0, unitsLost: 0, buildingsLost: 0, kills: 0 }]));
    this.owner = new Map(); // entity id -> team, learned from events (for kill credit)
  }

  add(events) {
    for (const e of events) {
      const t = this.teams[e.team];
      switch (e.type) {
        case 'dropoff': if (t) t.lumen += e.amount; break;
        case 'trained': if (t) t.trained++; break;
        case 'built': if (t) t.built++; break;
        case 'attack': {
          // Remember who last hit each target, so its death credits the killer.
          if (e.team !== undefined) this.owner.set(e.target, e.team);
          break;
        }
        case 'death': {
          if (t) { if (e.kind === 'building') t.buildingsLost++; else if (e.kind === 'unit') t.unitsLost++; }
          const killer = this.teams[this.owner.get(e.id)];
          if (killer && this.owner.get(e.id) !== e.team && (e.kind === 'unit' || e.kind === 'building')) killer.kills++;
          this.owner.delete(e.id);
          break;
        }
        default:
      }
    }
  }

  // Rows for the result screen: [label, player value, opponent value].
  rows(player = 1, opponent = 2) {
    const a = this.teams[player], b = this.teams[opponent];
    return [
      ['Gold gathered', a.lumen, b.lumen],
      ['Units trained', a.trained, b.trained],
      ['Buildings completed', a.built, b.built],
      ['Enemies destroyed', a.kills, b.kills],
      ['Units lost', a.unitsLost, b.unitsLost],
      ['Buildings lost', a.buildingsLost, b.buildingsLost],
    ];
  }
}
