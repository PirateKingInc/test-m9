// Bakes every code-drawn sprite into a Phaser texture once, at startup.
// Textures are drawn at ART_SCALE x resolution so they stay crisp when zoomed.
import { UNIT_TYPES, UNIT_BOX, drawUnitSprite, drawTeamRing } from './units.js';
import { BUILDING_TYPES, STATES, BUILDING_MARGIN, drawBuildingSprite } from './buildings.js';
import { BUILDINGS } from '../data/buildings.js';
import { paintTerrain, drawCrystal, CRYSTAL_STAGES, CRYSTAL_BOX } from './terrain.js';

export const ART_SCALE = 2;
export const TEAMS = [1, 2, 3, 4]; // Phase 6: four free-for-all camps
export const RING_R = 12; // world-px radius the ring texture is drawn for

// Zoomed out, unit sprites are drawn up to 2x larger so they stay legible
// (visual only: collision and picking use the sim's radius). Phase 5 raised the
// cap from 1.6x with the minimum zoom: a unit at 0.35x is drawn at 0.7x its 1x
// screen size, close to the 0.8x it had at Phase 4's 0.5x minimum.
export const UNIT_BOOST_MAX = 2;
export const unitBoost = (zoom) => Math.min(UNIT_BOOST_MAX, Math.max(1, 0.8 / zoom));

// Texture keys, shared with the renderer.
export const unitKey = (type, team, carry = false) => `u-${type}-${team}${carry ? '-carry' : ''}`;
export const ringKey = (team) => `ring-${team}`;
export const buildingKey = (type, team, state) => `b-${type}-${team}-${state}`;
export const crystalKey = (stage) => `crystal-${stage}`;
export const TERRAIN_KEY = 'terrain';

// Create a canvas texture of w x h world px and draw into it (origin at center).
export function bake(textures, key, w, h, draw) {
  if (textures.exists(key)) textures.remove(key);
  const tex = textures.createCanvas(key, Math.ceil(w * ART_SCALE), Math.ceil(h * ART_SCALE));
  const ctx = tex.getContext();
  ctx.save();
  ctx.scale(ART_SCALE, ART_SCALE);
  ctx.translate(w / 2, h / 2);
  draw(ctx);
  ctx.restore();
  tex.refresh();
  return key;
}

export function bakeUnits(textures) {
  const keys = [];
  for (const team of TEAMS) {
    for (const type of UNIT_TYPES) keys.push(bake(textures, unitKey(type, team), UNIT_BOX, UNIT_BOX, (ctx) => drawUnitSprite(ctx, type, team)));
    keys.push(bake(textures, unitKey('drone', team, true), UNIT_BOX, UNIT_BOX, (ctx) => drawUnitSprite(ctx, 'drone', team, { carry: true })));
    keys.push(bake(textures, ringKey(team), RING_R * 3, RING_R * 2.4, (ctx) => drawTeamRing(ctx, team, RING_R)));
  }
  return keys;
}

// Footprints come from the (frozen) building data: 1 tile = 32 px.
export function bakeBuildings(textures, tile = 32) {
  const keys = [];
  for (const team of TEAMS) for (const type of BUILDING_TYPES) for (const state of STATES) {
    const w = BUILDINGS[type].w * tile, h = BUILDINGS[type].h * tile;
    keys.push(bake(textures, buildingKey(type, team, state), w + 2 * BUILDING_MARGIN, h + 2 * BUILDING_MARGIN, (ctx) => drawBuildingSprite(ctx, type, team, state, w, h)));
  }
  return keys;
}

export function bakeCrystals(textures) {
  return CRYSTAL_STAGES.map((stage) => bake(textures, crystalKey(stage), CRYSTAL_BOX, CRYSTAL_BOX, (ctx) => drawCrystal(ctx, stage)));
}

// The whole map in one texture, at 1 px per world px (a 2x map would be ~80 MB).
export function bakeTerrain(textures, grid) {
  if (textures.exists(TERRAIN_KEY)) textures.remove(TERRAIN_KEY);
  const tex = textures.createCanvas(TERRAIN_KEY, grid.cols * grid.tile, grid.rows * grid.tile);
  paintTerrain(tex.getContext(), grid.cols, grid.rows, grid.tile, (tx, ty) => !!grid.rock[grid.idx(tx, ty)]);
  tex.refresh();
  return TERRAIN_KEY;
}

// Every sprite; the terrain needs the map grid.
export function bakeAll(textures, grid) {
  const keys = [...bakeUnits(textures), ...bakeBuildings(textures), ...bakeCrystals(textures)];
  if (grid) keys.push(bakeTerrain(textures, grid));
  return keys;
}
