// Phase 11 multiplayer timing (PHASE11_SPEC.md). Tunable defaults, each with
// its reasoning in the spec; determinism does not depend on any of them.
const DEFAULTS = {
  inputDelay: 4, // ticks (200 ms): commands run 4 ticks after they are issued
  heartbeatMs: 500, // a heartbeat on every channel this often
  quietMs: 2000, // nothing from a player for this long: "waiting for ..."
  graceMs: 50000, // nothing for this long (and Firebase agrees): the AI holds the camp
  handbackStableMs: 5000, // a returning player's link must be steady this long
  handbackMaxGapMs: 1500, // ... with no heartbeat gap longer than this
  snapshotEvery: 600, // ticks (30 s of game time) between periodic snapshots
  hashEvery: 100, // ticks between desync checks
  needAfterMs: 400, // waiting this long for a turn: ask the others for it
  chunkChars: 16000, // snapshot chunk size over the data channel
  chatMax: 200, // characters per chat line
  chatBurst: 5, // lines per chatWindowMs per player
  chatWindowMs: 5000,
  speed: 1, // game time per real time; only browser tests raise it (the lockstep is tick-based)
};

// Browser tests shorten the timings with globalThis.__DM_NET_OVERRIDES__
// (a Playwright init script); the shipped site never defines it.
export const NET = { ...DEFAULTS, ...(globalThis.__DM_NET_OVERRIDES__ || {}) };
export const NET_DEFAULTS = DEFAULTS;
