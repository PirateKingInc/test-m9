// Map layout for Phase 1 (see SPEC.md "Map"). All coordinates are in tiles.
// Rectangles are [x, y, w, h]. Crystal nodes are 2x2 and hold `nodeAmount` Lumen.
export const MAP = {
  cols: 80,
  rows: 60,
  tile: 32,
  startingLumen: 250,
  nodeAmount: 1500,
  nodeSize: 2,

  // Mirror-symmetric about the vertical center line (Phase 2): a feature of
  // width w at tile x has a twin at 80 - x - w. The west half is Phase 1's.
  rocks: [
    // Ridge A (x=30-31) and its mirror Ridge B (x=48-49); chokepoints at y 18-23 and 36-41
    [30, 0, 2, 18], [30, 24, 2, 12], [30, 42, 2, 18],
    [48, 0, 2, 18], [48, 24, 2, 12], [48, 42, 2, 18],
    // Outcrops and their mirrors, plus the center plateau
    [14, 10, 4, 3], [62, 10, 4, 3],
    [12, 46, 5, 3], [63, 46, 5, 3],
    [38, 26, 4, 8],
  ],

  nodes: [
    // West home field
    [20, 21], [22, 24], [23, 27], [23, 30], [22, 33], [20, 36],
    // East home field (mirror)
    [58, 21], [56, 24], [55, 27], [55, 30], [56, 33], [58, 36],
    // North-middle
    [37, 6], [41, 6], [39, 3], [39, 9],
    // South-middle
    [37, 51], [41, 51], [39, 48], [39, 54],
  ],

  // Player (team 1, west). Used by both the sandbox and match setups.
  start: {
    team: 1,
    core: [8, 27],
    drones: [[13, 27], [13, 28], [13, 29], [13, 30]],
  },

  // AI opponent (team 2, east): the mirror of the player start. Match mode only.
  aiStart: {
    team: 2,
    core: [68, 27],
    drones: [[66, 27], [66, 28], [66, 29], [66, 30]],
  },

  // Match rules (SPEC.md Phase 2 "Win / lose").
  timeLimit: 1800, // s of game time before sudden death on score
};
