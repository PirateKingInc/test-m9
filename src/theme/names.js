// Every player-facing name and description (Phase 5). src/data holds only
// gameplay values, so the display text can change without touching them; the
// ids used as keys here are the internal ids from src/data.
export const UNIT_TEXT = {
  drone: { name: 'Drone', role: 'worker' },
  striker: { name: 'Striker', role: 'light melee' },
  sparker: { name: 'Sparker', role: 'ranged' },
  bulwark: { name: 'Bulwark', role: 'heavy' },
  lancer: { name: 'Lancer', role: 'anti-heavy specialist' },
  dummy: { name: 'Test Target', role: 'test target' },
};

export const BUILDING_TEXT = {
  core: { name: 'Command Core' },
  depot: { name: 'Lumen Depot' },
  foundry: { name: 'Foundry' },
  spire: { name: 'Sentry Spire' },
};

export const STRATEGY_TEXT = {
  rush: {
    name: 'Rush',
    description: 'Aggression: a lean economy feeding many Foundries of Strikers and Sparkers (plus a few Lancers), big early waves and constant reinforcements.',
  },
  boom: {
    name: 'Economy-Boom',
    description: 'Greed: ten Drones and two Depots before its first Foundry, expands early, then attacks with a big mixed army and falls back when a wave breaks.',
  },
  turtle: {
    name: 'Turtle-and-Tech',
    description: 'Defense: Sentry Spires on its front, a Sparker/Bulwark/Lancer army, fortified expansions, and a heavy push once it has built up.',
  },
  sandbox: { name: 'Sandbox bot' },
  sentinel: { name: 'Sentinel (test player script)' },
};

export const DIFFICULTY_TEXT = {
  easy: { name: 'Easy' },
  normal: { name: 'Normal' },
  hard: { name: 'Hard' },
};

export const unitName = (type) => UNIT_TEXT[type].name;
export const buildingName = (type) => BUILDING_TEXT[type].name;
export const strategyName = (id) => STRATEGY_TEXT[id].name;
export const difficultyName = (id) => DIFFICULTY_TEXT[id].name;
