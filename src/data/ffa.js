// Gameplay values only: player-facing names and text live in src/theme (Phase 5).
// The free-for-all map (Phase 6, PHASE6_SPEC.md "The free-for-all map"). All
// coordinates are in tiles; rectangles are [x, y, w, h]. The map is a 3 x 3 grid
// of 32 x 32-tile zones: four camps in the corners, five neutral gold fields.
// It is mirror-symmetric in both axes, so it is written for the north-west and
// mirrored: a feature of width w at x has twins at 96 - x - w (and the same in y).
const N = 96;
const mx = (x, w = 0) => N - x - w;
// The four copies of a rectangle (or a point, w = h = 0), NW first.
const four = ([x, y, w = 0, h = 0]) => [[x, y, w, h], [mx(x, w), y, w, h], [mx(x, w), mx(y, h), w, h], [x, mx(y, h), w, h]];

// Each camp is the 1v1 west base (map.js) moved to the corner: a Castle, four
// Peasants and six gold mines in an arc toward the map centre, facing east.
const CORE = [8, 12];
const HOME_NODES = [[12, -6], [14, -3], [15, 0], [15, 3], [14, 6], [12, 9]]; // offsets from the Castle, as in map.js
const DRONES = [[5, 0], [5, 1], [5, 2], [5, 3]];

// Camp order: team 1 north-west (the player), 2 north-east, 3 south-east, 4 south-west.
const MIRROR = [[false, false], [true, false], [true, true], [false, true]];
const campAt = (team, [fx, fy]) => ({
  team,
  core: [fx ? mx(CORE[0], 4) : CORE[0], fy ? mx(CORE[1], 4) : CORE[1]],
  drones: DRONES.map(([dx, dy]) => [fx ? mx(CORE[0] + dx, 1) : CORE[0] + dx, fy ? mx(CORE[1] + dy, 1) : CORE[1] + dy]),
  nodes: HOME_NODES.map(([dx, dy]) => [fx ? mx(CORE[0] + dx, 2) : CORE[0] + dx, fy ? mx(CORE[1] + dy, 2) : CORE[1] + dy]),
  mirrorX: fx,
  mirrorY: fy,
});
const CAMPS = MIRROR.map((m, i) => campAt(i + 1, m));

// Neutral gold fields: four mines (the 1v1 middle-field layout) around the
// centre of each edge zone, six in the Centre zone.
const FIELD = [[-3, -1], [1, -1], [-1, -4], [-1, 2]];
const CENTRE_EXTRA = [[-6, -1], [4, -1]];
const fieldNodes = ([cx, cy], extra = []) => [...FIELD, ...extra].map(([dx, dy]) => [cx + dx, cy + dy]);

// Zones: the nine squares. Corner zones are camp homes; the rest are neutral
// and hold a gold field at `field` (its centre tile).
const Z = 32;
const ZONES = [
  { id: 'nw', rect: [0, 0, Z, Z], home: 1 },
  { id: 'n', rect: [Z, 0, Z, Z], field: [48, 16] },
  { id: 'ne', rect: [2 * Z, 0, Z, Z], home: 2 },
  { id: 'w', rect: [0, Z, Z, Z], field: [16, 48] },
  { id: 'c', rect: [Z, Z, Z, Z], field: [48, 48] },
  { id: 'e', rect: [2 * Z, Z, Z, Z], field: [80, 48] },
  { id: 'sw', rect: [0, 2 * Z, Z, Z], home: 4 },
  { id: 's', rect: [Z, 2 * Z, Z, Z], field: [48, 80] },
  { id: 'se', rect: [2 * Z, 2 * Z, Z, Z], home: 3 },
];

// Stone walls along the zone borders (two tiles thick, at x = 30 and its
// mirror 64, and the same in y) with a gate in every border. A camp's
// eastward gate (y 23-29) sits just past the south end of its gold-mine arc,
// like the 1v1 map's chokepoints, so armies go around the mines instead of
// squeezing between them; its southward gate (x 12-19) is beside the Castle.
// The Centre's borders have gates in the middle. Four boulders frame the
// Centre field.
const V_RUNS = [[0, 23], [30, 44], [52, 66], [73, 96]]; // walls along x = 30 and x = 64; gates at y 23-29, 44-51, 66-72
const H_RUNS = [[0, 12], [20, 44], [52, 76], [84, 96]]; // walls along y = 30 and y = 64; gates at x 12-19, 44-51, 76-83
const ROCKS = [
  ...V_RUNS.flatMap(([a, b]) => [[30, a, 2, b - a], [mx(30, 2), a, 2, b - a]]),
  ...H_RUNS.flatMap(([a, b]) => [[a, 30, b - a, 2], [a, mx(30, 2), b - a, 2]]),
  ...four([38, 38, 2, 2]),
];

export const FFA_MAP = {
  cols: N,
  rows: N,
  tile: 32,
  startingLumen: 250,
  nodeAmount: 1500,
  nodeSize: 2,
  rocks: ROCKS,
  nodes: [
    ...CAMPS.flatMap((c) => c.nodes),
    ...ZONES.filter((z) => z.field).flatMap((z) => fieldNodes(z.field, z.id === 'c' ? CENTRE_EXTRA : [])),
  ],
  camps: CAMPS,
  zones: ZONES,
  // The AI mirrors its build spots per camp in both axes on this map.
  mirrorY: true,
  timeLimit: 1800, // s of game time before the time-limit ranking (PHASE6_SPEC.md "Win condition")
};

// Territory rules (PHASE6_SPEC.md "Territory").
export const TERRITORY = {
  interval: 1, // s between ownership updates
  captureHold: 5, // s a camp must be the only military presence in a zone to take it
};

// The AI camps' scripts in the free-for-all (camp team -> strategy id).
export const FFA_STRATEGIES = { 2: 'rush', 3: 'boom', 4: 'turtle' };

// Measured one-way march time in seconds between two camps' Castles (Phase 7,
// PHASE7_SPEC.md "Travel time"): the round trip of a 14-unit army from
// test/travel.js, halved. test/rivals.test.js re-measures it.
export const CAMP_TRAVEL = { '1-2': 49.0, '1-3': 65.6, '1-4': 41.0, '2-3': 42.2, '2-4': 65.6, '3-4': 48.1 };
export const campTravel = (a, b) => CAMP_TRAVEL[a < b ? `${a}-${b}` : `${b}-${a}`];
