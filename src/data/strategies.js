// Gameplay values only: player-facing names and text live in src/theme (Phase 5).
// AI scripts (SPEC.md Phase 2 "Strategies"). Each is data the engine executes:
// an ordered opening, a macro loop and army thresholds. Phase 3 tunes these
// numbers without touching src/ai/engine.js.
//
// Build spots are tile offsets from the team's own Command Core top-left, written
// for the west base; the engine mirrors them for the east base.
export const SPOTS = {
  depot: [9, -1], depot2: [9, 5], depot3: [2, -6], depot4: [5, 10], depot5: [-3, -5],
  foundry: [6, 5], foundry2: [2, 8], foundry3: [6, -6],
  spire: [10, 4], spire2: [14, 0], spire3: [14, 6], spire4: [11, -4],
  core: [1, 7],
};

// Shared army-control numbers (SPEC.md Phase 2 "Engine loop").
export const ARMY = {
  rallyTiles: 9, // rally point this far from our Core toward the enemy
  homeRadius: 512, // px around our buildings that counts as "our base" (16 tiles)
  coreAssault: 250, // px: army this close to the enemy Core with no enemy units near attacks it directly
  maxFoundryQueue: 2,
};

// AI perception and scouting-triggered reactions (SPEC.md Phase 2 "Scouting").
export const SCOUTING = {
  interval: 2, // s between scans
  baseWatch: 512, // px around any of our buildings (16 tiles)
  sight: 224, // px around any of our units (7 tiles), incl. the scout Drone
  memory: 90, // s a sighting is remembered
  scoutGiveUp: 75, // s before the scout Drone returns to mining regardless
  earlyWindow: 300, // s: early-aggression trigger only fires before this
  earlyAggroUnits: 2, // enemy combat units inside base watch to count as a rush
  defendClear: 20, // s without enemies near base before defend mode ends
  defendSpires: 1, // Spires to have while defending (strategies may override)
  massMin: 5, // at least this many of one enemy combat type seen...
  massShare: 0.5, // ...and a majority of the enemy army seen (a balanced army never trips it)
  counterShare: 0.7, // share of new production given to counters when reacting
  // Where attack waves look for the enemy when its start is empty and no enemy
  // building is known (west-half tiles; mirrored when searching the east).
  searchPoints: [[12, 10], [12, 64], [28, 12], [28, 61], [50, 9], [50, 65]], // (Phase 12: the 100 x 75 map)
  // Counter picks from the Phase 1 counter table (PROJECT.md): primary first.
  counters: {
    striker: ['bulwark', 'sparker'],
    sparker: ['bulwark', 'striker'],
    bulwark: ['lancer'],
    lancer: ['striker', 'sparker'],
  },
};

// Expansion to the middle crystal fields (Phase 3). Tiles are absolute and
// written for the west team; the engine mirrors x for the east team. Each field
// is itself mirror-symmetric about the map's center line.
export const EXPANSION = {
  fields: {
    // (Phase 12: the 100 x 75 map; the same offsets from each field's centre.)
    north: { center: [50, 9], depot: [43, 8], spire: [44, 12], guard: [45, 15] },
    south: { center: [50, 65], depot: [43, 63], spire: [44, 59], guard: [45, 58] },
  },
  fieldRadius: 6, // tiles: crystal nodes this close to the center belong to the field
  homeRadius: 14, // tiles from our Core that count as the home field
  contestRadius: 12, // tiles: an enemy combat unit seen this close to a field makes it contested...
  contestMemory: 60, // ...if seen within this many seconds (enemy buildings: any time)
  retryAfter: 120, // s before re-expanding after losing an expansion Depot
  guardLeash: 5, // tiles a guard may drift from its post before returning
};

export const STRATEGIES = {
  rush: {
    opening: [
      { train: 'drone' }, { build: 'depot' }, { train: 'drone' }, { build: 'foundry' },
      { train: 'striker' }, { train: 'striker' }, { train: 'drone' },
    ],
    workerTarget: 10,
    supplyBuffer: 2,
    depotSpots: ['depot', 'depot2', 'depot3'],
    composition: { striker: 2, sparker: 2, lancer: 0.5 },
    maxFoundries: 5, // extra Foundries whenever Lumen floats above floatLumen
    floatLumen: 200,
    firstWave: 14,
    wave: 10,
    waveJitter: 0.3, // each wave's size threshold varies +/-30% (seeded)
    retreatBelow: null, // never retreats
    reinforce: true,
    reinforceMin: 4, // reinforcements leave home in groups of at least this many
    scoutAt: 30,
    // Expands late, or once the home field runs low; guards it with units.
    expand: { after: 420, minDrones: 6, orHomeBelow: 0.35, drones: 4, spires: 0, guards: 3 },
  },

  // The Phase 1 sandbox bot's behaviour, now expressed as a script: one of every
  // building, one of every unit, no attack. test/bot.test.js runs it.
  sandbox: {
    opening: [
      { train: 'drone' }, { build: 'depot' }, { train: 'drone' },
      { build: 'foundry' }, { build: 'spire' }, { build: 'core' },
      { train: 'striker' }, { train: 'sparker' }, { train: 'bulwark' }, { train: 'lancer' },
    ],
    workerTarget: 0, // no macro loop: the opening is the whole script
    composition: {},
    noMacro: true,
  },

  boom: {
    opening: [
      { train: 'drone' }, { train: 'drone' }, { build: 'depot' }, { train: 'drone' }, { train: 'drone' },
      { build: 'depot', spot: 'depot2' }, { train: 'drone' }, { train: 'drone' }, { train: 'drone' }, { train: 'drone' },
      { build: 'foundry' }, { train: 'drone' },
    ],
    workerTarget: 16,
    supplyBuffer: 3,
    depotSpots: ['depot', 'depot2', 'depot3', 'depot4', 'depot5'],
    structures: [
      { build: 'foundry', spots: ['foundry', 'foundry2', 'foundry3'], max: 2, minDrones: 15 },
      { build: 'depot', spots: ['depot', 'depot2', 'depot3', 'depot4'], max: 3, minDrones: 14 },
    ],
    composition: { striker: 2, sparker: 2, bulwark: 1, lancer: 1 },
    maxFoundries: 3, // late game: a third Foundry once Lumen floats
    floatLumen: 600,
    // Builds up by army supply, like Turtle, but attacks sooner.
    firstWaveSupply: 34,
    waveSupply: 26,
    waveJitter: 0.3,
    retreatBelow: 0.35,
    reinforce: false,
    defendSpires: 0, // greedy: answers a rush with units, not Spires
    scoutAt: 60,
    // Greedy: expands as soon as the home economy is saturated, with a Spire and two guards.
    expand: { after: 240, minDrones: 13, drones: 6, spires: 1, guards: 2 },
  },

  turtle: {
    opening: [
      { train: 'drone' }, { train: 'drone' }, { build: 'depot' }, { train: 'drone' }, { build: 'foundry' },
      { build: 'spire' }, { train: 'drone' }, { build: 'spire', spot: 'spire2' },
    ],
    workerTarget: 12,
    supplyBuffer: 3,
    depotSpots: ['depot', 'depot2', 'depot3', 'depot4', 'depot5'],
    structures: [
      // A second Foundry once the economy is up, then Spires on the base front
      // (toward the enemy), one more per 2 army units, up to 4.
      { build: 'foundry', spots: ['foundry', 'foundry2', 'foundry3'], max: 2, minDrones: 8 },
      { build: 'spire', spots: ['spire', 'spire2', 'spire3', 'spire4'], max: 4, armyPer: 2 },
    ],
    composition: { sparker: 2, bulwark: 2, lancer: 1 },
    maxFoundries: 3,
    floatLumen: 400,
    // Builds up by army *supply* (heavy units cost 2-3), not unit count.
    firstWaveSupply: 30,
    waveSupply: 30,
    waveJitter: 0.3,
    retreatBelow: 0.3,
    reinforce: false,
    scoutAt: 90,
    defendSpires: 2, // a Turtle answers a rush with two Spires
    // Expands once its army can hold the base, and fortifies the field with two Spires.
    expand: { after: 360, minArmySupply: 14, orHomeBelow: 0.35, drones: 5, spires: 2, guards: 0 },
  },

  // Fixed player-side script used by the strategy playthrough tests: a solid
  // defensive economy that never attacks, so each AI strategy must carry its
  // full build/train/attack sequence to win.
  sentinel: {
    opening: [
      { train: 'drone' }, { build: 'depot' }, { train: 'drone' }, { build: 'foundry' },
      { train: 'drone' }, { build: 'spire' },
    ],
    workerTarget: 10,
    supplyBuffer: 3,
    depotSpots: ['depot', 'depot2', 'depot3'],
    composition: { striker: 1, sparker: 1, bulwark: 1, lancer: 1 },
    maxFoundries: 2,
    floatLumen: 400,
    firstWave: Infinity, // defends only
    wave: Infinity,
    retreatBelow: null,
    reinforce: false,
    scouting: false, // a fixed script: it never adapts to what it sees
  },
};
