// Gameplay values only: player-facing names and text live in src/theme (Phase 5).
// Building roster (see SPEC.md "Buildings"). Footprints are in tiles.
export const BUILDINGS = {
  core: {
    w: 4, h: 4, hp: 1500, armor: 'structure',
    cost: 400, buildTime: 60, trains: ['drone'], hotkey: 'Q', supply: 10,
  },
  depot: {
    w: 3, h: 3, hp: 600, armor: 'structure',
    cost: 100, buildTime: 20, trains: [], dropOff: true, hotkey: 'W', supply: 10,
  },
  foundry: {
    w: 3, h: 3, hp: 800, armor: 'structure',
    cost: 150, buildTime: 30, trains: ['striker', 'sparker', 'bulwark', 'lancer'], hotkey: 'E',
  },
  spire: {
    w: 2, h: 2, hp: 500, armor: 'structure',
    cost: 120, buildTime: 25, trains: [], hotkey: 'R',
    weapon: { attack: 'bolt', damage: 14, cooldown: 0.8, range: 224 },
  },
};

export const BUILD_ORDER = ['core', 'depot', 'foundry', 'spire'];

export const CONSTRUCTION = {
  startHpFraction: 0.1,
  cancelRefund: 0.75,
  builderRange: 8,
};

export const PRODUCTION = {
  maxQueue: 5,
  cancelRefund: 1.0,
};

// Population cap (SPEC.md Phase 2 "Population (supply)"). Applies to every team
// and every mode. Phase 12 (PHASE12_SPEC.md) raised it from 60 to the highest
// cap the performance budget supports on a phone, and the Storehouse from 8
// to 10 supply: the Castle (10) and 9 Storehouses reach it, against 7 for 60.
export const SUPPLY = {
  max: 100, // hard ceiling, however many providers a team has
};
