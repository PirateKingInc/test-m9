// One palette for every sprite, so the game reads as one designed style.
// Phase 5 made it medieval: stone, timber, thatch, iron and gold, with the team
// colour on banners, roofs and tabards. See PHASE5_SPEC.md "Art direction".
export const TEAM = {
  1: { base: '#3f86e8', light: '#9cc4ff', dark: '#1f4f9a', glow: '#d6e8ff' }, // player: Azure
  2: { base: '#e0472f', light: '#ff9f8a', dark: '#8e2415', glow: '#ffd9cf' }, // AI: Crimson
};
export const STONE = { base: '#8f897a', light: '#bdb6a3', dark: '#5f5a4e', deep: '#3b372f' };
export const WOOD = { base: '#8a5a33', light: '#b07a48', dark: '#5c3b20', deep: '#3a2514' };
export const THATCH = { base: '#c9a55a', light: '#e6cb8c', dark: '#8f7236' };
export const GOLD = { base: '#f2c23a', light: '#fff0a8', dark: '#a8780f', glow: 'rgba(255, 210, 90, 0.35)' };
export const DIRT = { base: '#6b5433', light: '#8c7248', dark: '#4a3a22' };

export const INK = '#0b0f17'; // outlines
export const METAL = { base: '#6b7788', light: '#aeb9c8', dark: '#3a4250', deep: '#232a35' };
export const LUMEN = { base: '#b69bff', light: '#e4d8ff', dark: '#6a4fd0', glow: 'rgba(182, 155, 255, 0.35)' };
export const WARM = { base: '#ffc24a', light: '#fff0b8', dark: '#b07a10' }; // lance, furnace, construction
export const GROUND = { base: '#19212d', mottle: ['#1c2533', '#172029', '#1e2837'], grid: 'rgba(60, 78, 104, 0.18)' };
export const ROCK = { base: '#3b3f4a', light: '#6f7584', dark: '#23262e', face: '#15171c', crack: '#2c3038' };
export const HAZARD = { yellow: '#ffd24a', black: '#1a1a1a' };

// Hex colour -> Phaser integer.
export const hex = (c) => parseInt(c.slice(1), 16);
