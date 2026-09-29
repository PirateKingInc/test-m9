// Multi-rival targeting (Phase 7, PHASE7_SPEC.md "Priority formula"). Only used
// when a camp has more than one rival (the free-for-all); the 1v1 match never
// reads these numbers.
export const RIVALS = {
  smoothing: 4, // army-value units added to both sides of the strength ratio
  spireValue: 3, // a known standing Tower counts as this much army value
  engagedMemory: 45, // s a witnessed fight with a third camp counts
  hitMemory: 45, // s a witnessed attack on us counts
  caution: 1.5, // a rival with R at or above this is clearly stronger: never the target
  cautionRelease: 1.2, // ...and once avoided, it must drop below this to be a target again
  switchMargin: 0.75, // a wave in the field changes rival only for a pick this much better...
  commitTime: 20, // ...and not within this many s of its last change of target
  weights: {
    weakness: 1.0, // x (1 - min(R, 2))
    overmatch: 1.2, // x max(0, R - 1), subtracted
    engaged: 0.8,
    castle: 0.6, // x Castle damage (0-1)
    hitting: 0.4,
    zones: 0.15, // x (zones owned - 1)
    travel: 0.01, // x one-way travel s, subtracted
    stick: 0.2, // current target
  },
  // Zone holding (PHASE7_SPEC.md "Zone holding").
  hold: {
    squadMax: 4,
    squadMin: 2,
    defendOvermatch: 1.5, // defend if the seen force is at most this x the squad's value
    lostMemory: 90, // s after losing a zone that recapture is considered
    zoneRadius: 12, // tiles around a zone's field that count as "in the zone" for sightings
    clearAfter: 10, // s with no rival seen before the squad goes home
    maxOut: 60, // s a squad stays out at most
  },
};
