// Gameplay values only: player-facing names and text live in src/theme (Phase 5).
// Unit roster (see SPEC.md "Units"). Distances in px, times in seconds.
// range = edge-to-edge gap at which the unit can hit its target.
export const UNITS = {
  drone: {
    supply: 1, hp: 40, armor: 'light', attack: 'blade',
    damage: 4, cooldown: 1.0, range: 8, speed: 72, radius: 9,
    cost: 50, trainTime: 10, trainedAt: 'core', worker: true,
  },
  striker: {
    supply: 1, hp: 100, armor: 'light', attack: 'blade',
    damage: 10, cooldown: 0.6, range: 8, speed: 85, radius: 11,
    cost: 60, trainTime: 12, trainedAt: 'foundry',
  },
  sparker: {
    supply: 1, hp: 65, armor: 'light', attack: 'bolt',
    damage: 15, cooldown: 0.75, range: 176, speed: 70, radius: 10,
    cost: 70, trainTime: 14, trainedAt: 'foundry',
  },
  bulwark: {
    supply: 3, hp: 300, armor: 'heavy', attack: 'crush',
    damage: 14, cooldown: 1.0, range: 8, speed: 50, radius: 15,
    cost: 150, trainTime: 22, trainedAt: 'foundry',
  },
  lancer: {
    supply: 2, hp: 120, armor: 'light', attack: 'lance',
    damage: 26, cooldown: 1.4, range: 128, speed: 60, radius: 11,
    cost: 110, trainTime: 18, trainedAt: 'foundry',
  },
  // Verification-only test target (team 2). Not a game feature: no attack, never trained.
  dummy: {
    supply: 0, hp: 300, armor: 'light', attack: null,
    damage: 0, cooldown: 1, range: 0, speed: 0, radius: 12,
    cost: 0, trainTime: 0, trainedAt: null, testOnly: true,
  },
};

// Fraction of damage each attack type deals to each armor class.
export const DAMAGE_MULTIPLIERS = {
  blade: { light: 1.0, heavy: 0.4, structure: 0.5 },
  bolt: { light: 1.0, heavy: 0.4, structure: 0.5 },
  crush: { light: 1.0, heavy: 0.6, structure: 1.0 },
  lance: { light: 0.35, heavy: 2.5, structure: 1.5 },
};

export const COMBAT = {
  aggroRange: 200, // gap within which idle/attack-moving units acquire targets
  leashRange: 320, // chase is abandoned when the gap grows beyond this
  damageSpread: 0.1, // damage is multiplied by U(1 - spread, 1 + spread)
};
