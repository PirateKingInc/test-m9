// Map layout for Phase 1 (see SPEC.md "Map"). All coordinates are in tiles.
// Rectangles are [x, y, w, h]. Crystal nodes are 2x2 and hold `nodeAmount` Lumen.
export const MAP = {
  cols: 100,
  rows: 75,
  tile: 32,
  startingLumen: 250,
  // Phase 12: 1500 until the supply cap rose from 60 to 100; each mine now
  // holds 5/3 as much, so a camp's gold grows with the army it can field.
  nodeAmount: 2500,
  nodeSize: 2,

  // Mirror-symmetric about the vertical center line (Phase 2): a feature of
  // width w at tile x has a twin at 100 - x - w.
  //
  // Phase 12 (PHASE12_SPEC.md "Maps"): 80 x 60 until the supply cap rose to
  // 100. Every distance grows by 1.25 (area by 1.56, as the full-cap armies
  // grew by 1.67) and the chokepoints widen from 6 to 8 tiles; each base keeps
  // its exact Phase 1 layout around its Castle, which moves down by 8 tiles
  // with the map's middle.
  rocks: [
    // Ridge A (x=38-39) and its mirror Ridge B (x=60-61); chokepoints at y 22-29 and 44-51
    [38, 0, 2, 22], [38, 30, 2, 14], [38, 52, 2, 23],
    [60, 0, 2, 22], [60, 30, 2, 14], [60, 52, 2, 23],
    // Outcrops and their mirrors, plus the center plateau
    [18, 13, 4, 3], [78, 13, 4, 3],
    [15, 58, 5, 3], [80, 58, 5, 3],
    [48, 33, 4, 9],
  ],

  nodes: [
    // West home field (the Phase 1 arc, 12-15 tiles east of the Castle)
    [20, 29], [22, 32], [23, 35], [23, 38], [22, 41], [20, 44],
    // East home field (mirror)
    [78, 29], [76, 32], [75, 35], [75, 38], [76, 41], [78, 44],
    // North-middle
    [47, 8], [51, 8], [49, 5], [49, 11],
    // South-middle
    [47, 64], [51, 64], [49, 61], [49, 67],
  ],

  // Player (team 1, west). Used by both the sandbox and match setups.
  start: {
    team: 1,
    core: [8, 35],
    drones: [[13, 35], [13, 36], [13, 37], [13, 38]],
  },

  // AI opponent (team 2, east): the mirror of the player start. Match mode only.
  aiStart: {
    team: 2,
    core: [88, 35],
    drones: [[86, 35], [86, 36], [86, 37], [86, 38]],
  },

  // Match rules (SPEC.md Phase 2 "Win / lose").
  timeLimit: 1800, // s of game time before sudden death on score
};
