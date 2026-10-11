// A seeded random number generator whose whole state is one field (`s`), so
// it is part of any snapshot and restores exactly: mulberry32. Every peer that
// seeds it alike draws the same numbers.
export class SeededRng {
  constructor(state) { this.s = state >>> 0; }
  next() { // [0, 1)
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); } // a..b inclusive
}
