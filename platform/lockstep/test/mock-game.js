// A minimal deterministic game for testing the module without any real game:
// each slot has a counter; a command { n } adds n; every tick a seeded RNG
// draw goes into a shared total, so any difference in inputs, order or timing
// changes the whole state. A held slot's counter drifts down by 1 a tick (so
// holding visibly does something), and the match is over at `endAt`.
import { createCodec, hashText, SeededRng } from '../index.js';

const codec = createCodec({ classes: { SeededRng } });

export class Counter {
  constructor({ seed = 1, slots = [1, 2], endAt = Infinity } = {}) {
    this.rng = new SeededRng(seed);
    this.counts = Object.fromEntries(slots.map((s) => [s, 0]));
    this.total = 0;
    this.held = [];
    this.events = []; // [kind, slot, tick]
    this.ran = []; // [tick, slot, n] every command, where it ran
    this.endAt = endAt;
    this.tick = 0;
  }

  step(tick, inputs) {
    if (tick !== this.tick) throw new Error(`stepped ${tick} at ${this.tick}`);
    for (const { slot, commands } of inputs) for (const c of commands) { this.counts[slot] += c.n; this.ran.push([tick, slot, c.n]); }
    for (const s of this.held) this.counts[s] -= 1;
    this.total = (this.total + Math.floor(this.rng.next() * 1000)) % 1000003;
    this.tick++;
  }

  validate(cmd) { return Number.isInteger(cmd?.n) ? undefined : 'n must be an integer'; }
  hold(slot, tick) { this.held.push(slot); this.held.sort(); this.events.push(['hold', slot, tick]); }
  release(slot, tick) { this.held = this.held.filter((s) => s !== slot); this.events.push(['release', slot, tick]); }
  isOver() { return this.tick >= this.endAt; }
  serialize() { return codec.encode(this); }
  hash() { return hashText(JSON.stringify(this.serialize())); }
  static restore(data) { return codec.decode(data); }
}
codec.register('Counter', Counter);
