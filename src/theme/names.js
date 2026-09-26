// Every player-facing name and description (Phase 5). src/data holds only
// gameplay values, so the display text can change without touching them; the
// ids used as keys here are the internal ids from src/data.
export const GAME_TITLE = 'Dragonmarch';
export const RESOURCE = 'Gold'; // the one resource (internally: Lumen)
export const NODE_NAME = 'Gold Mine';

export const UNIT_TEXT = {
  drone: { name: 'Peasant', plural: 'Peasants', role: 'worker' },
  striker: { name: 'Horseman', plural: 'Horsemen', role: 'light cavalry' },
  sparker: { name: 'Archer', plural: 'Archers', role: 'ranged' },
  bulwark: { name: 'Shield Knight', plural: 'Shield Knights', role: 'heavy infantry' },
  lancer: { name: 'Dragon Rider', plural: 'Dragon Riders', role: 'anti-armour specialist' },
  dummy: { name: 'Training Dummy', plural: 'Training Dummies', role: 'verification only' },
};

export const BUILDING_TEXT = {
  core: { name: 'Castle' },
  depot: { name: 'Storehouse' },
  foundry: { name: 'Barracks' },
  spire: { name: 'Watchtower' },
};

// Attack and armour words shown in tooltips (the data keeps its internal ids).
export const ATTACK_TEXT = { blade: 'sword', bolt: 'arrow', crush: 'mace', lance: 'dragonfire' };
export const ARMOR_TEXT = { light: 'light armour', heavy: 'plate armour', structure: 'stone' };

export const STRATEGY_TEXT = {
  rush: {
    name: 'Warband Raid',
    description: 'Aggression: a lean economy feeding many Barracks of Horsemen and Archers (plus a few Dragon Riders), big early raids and constant reinforcements.',
  },
  boom: {
    name: 'Merchant Kingdom',
    description: 'Greed: ten Peasants and two Storehouses before its first Barracks, claims a second gold field early, then marches with a big mixed army and falls back when an attack breaks.',
  },
  turtle: {
    name: 'Stone Bastion',
    description: 'Defense: Watchtowers on its front, an Archer, Shield Knight and Dragon Rider army, fortified gold fields, and a heavy push once it has built up.',
  },
  sandbox: { name: 'Sandbox bot' },
  sentinel: { name: 'Sentinel (test player script)' },
};

export const DIFFICULTY_TEXT = {
  easy: { name: 'Easy' },
  normal: { name: 'Normal' },
  hard: { name: 'Hard' },
};

// The sim's rejection messages use its internal words; the player reads these.
const REASONS = {
  'Not enough Lumen': `Not enough ${RESOURCE.toLowerCase()}`,
  'Not enough supply: build a Lumen Depot': 'Not enough supply: build a Storehouse',
  'Select a Drone to build': 'Select a Peasant to build',
};
export const reasonText = (reason) => REASONS[reason] ?? reason;

export const unitName = (type) => UNIT_TEXT[type].name;
export const unitPlural = (type) => UNIT_TEXT[type].plural;
export const buildingName = (type) => BUILDING_TEXT[type].name;
export const strategyName = (id) => STRATEGY_TEXT[id].name;
export const difficultyName = (id) => DIFFICULTY_TEXT[id].name;
