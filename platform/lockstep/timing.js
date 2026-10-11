// The protocol's tunable defaults. Determinism does not depend on any of
// them; they trade responsiveness against tolerance of bad networks. Pass
// { ...DEFAULT_TIMING, ...yours } to a Session (and the match runner).
export const DEFAULT_TIMING = Object.freeze({
  tickMs: 50, // one simulation tick of real time (20 ticks a second)
  inputDelay: 4, // ticks: commands run this many ticks after they are given (200 ms)
  heartbeatMs: 500, // a heartbeat on every link this often
  quietMs: 2000, // nothing from a player for this long: shown as "waiting for ..."
  graceMs: 50000, // nothing for this long (and the arbiter agrees): the slot is held
  handbackStableMs: 5000, // a returning player's link must be steady this long
  handbackMaxGapMs: 1500, // ... with no heartbeat gap longer than this
  snapshotEvery: 600, // ticks between periodic snapshots (served to rejoining players)
  hashEvery: 100, // ticks between desync checks
  needAfterMs: 400, // waiting this long for a turn: ask every peer for it
  chunkChars: 16000, // snapshot chunk size over a link
  speed: 1, // game time per real time; tests raise it (the lockstep is tick-based)
});
