// Ringout: the rules. A deterministic simulation of 2-4 pucks on a shrinking
// ring, written as a game for the DragonMarch lockstep module (it implements
// the module's game contract: step, hash, serialize, isOver, validate, hold,
// release). No DOM here: it runs the same in Node and every browser.
//
// Each player steers a puck in one of 16 directions and can dash. Pucks
// collide elastically. A puck whose centre leaves the ring is out for the
// round; the last puck on the ring scores. First to 3 points wins (or the most
// points after 9 rounds; a tie is a draw). The ring shrinks after a short
// grace period, faster at a harder pace.
import { createCodec, hashText, SeededRng } from '../../platform/lockstep/index.js';

export const RULES = Object.freeze({
  dt: 0.05, // seconds per tick (the module's default tick, 50 ms)
  ringStart: 300, ringMin: 90,
  shrink: { easy: 0.25, normal: 0.5, hard: 1 }, // ring units per tick, after the grace
  graceTicks: 60, // 3 s before the ring starts shrinking
  puckRadius: 18, startRadius: 180,
  thrust: 1100, // units/s² while steering
  drag: 0.92, // velocity kept per tick
  maxSpeed: 260, // units/s under thrust alone
  dash: 360, dashCooldown: 30, // units/s added; ticks between dashes
  brake: 0.6, // velocity kept per tick by an anchored (held) puck
  restitution: 0.9,
  pauseTicks: 30, // between rounds
  roundMaxTicks: 1800, // 90 s: a round with two pucks still on is a draw (no point)
  winScore: 3, maxRounds: 9,
});
const DIRS = 16;

// What a player may send.
export const COMMANDS = Object.freeze({ steer: (c) => Number.isInteger(c.dir) && c.dir >= -1 && c.dir < DIRS, dash: () => true });

const codec = createCodec({ classes: { SeededRng } });

export class Ringout {
  // slots: the player slots (from the lobby's lineup); pace: easy|normal|hard.
  constructor({ seed, slots, pace = 'normal' }) {
    this.seed = seed;
    this.pace = RULES.shrink[pace] ? pace : 'normal';
    this.slots = [...slots].sort((a, b) => a - b);
    this.rng = new SeededRng(seed);
    this.tick = 0;
    this.round = 0;
    this.score = Object.fromEntries(this.slots.map((s) => [s, 0]));
    this.anchored = Object.fromEntries(this.slots.map((s) => [s, false]));
    this.history = []; // [round, winner slot or 0]
    this.result = null; // { winner: slot or 0 (draw), score }
    this.newRound();
  }

  // Pucks on their start circle at their compass points (turned a little at
  // random each round), the ring full size.
  newRound() {
    this.round++;
    this.phase = 'play';
    this.phaseTick = 0;
    this.radius = RULES.ringStart;
    const turn = this.rng.range(-Math.PI / 8, Math.PI / 8);
    const held = this.pucks || {}; // a direction a player is holding carries over
    this.pucks = {};
    for (const s of this.slots) {
      const a = turn + (s - 1) * (Math.PI / 2) - Math.PI / 2; // slot 1 north, then clockwise
      this.pucks[s] = { x: Math.cos(a) * RULES.startRadius, y: Math.sin(a) * RULES.startRadius, vx: 0, vy: 0, dir: held[s]?.dir ?? -1, dash: false, cd: 0, out: false };
    }
  }

  // ---- the game contract ----------------------------------------------------

  validate(cmd) { return COMMANDS[cmd?.type]?.(cmd) ? undefined : 'not a Ringout command'; }

  // A disconnected player's puck is anchored: it brakes and stays where it is
  // (still pushable) until its player is back.
  hold(slot) { this.anchored[slot] = true; const p = this.pucks[slot]; if (p) { p.dir = -1; p.dash = false; } }
  release(slot) { this.anchored[slot] = false; }

  isOver() { return !!this.result; }

  step(tick, inputs) {
    if (tick !== this.tick) throw new Error(`Ringout stepped at ${tick}, expected ${this.tick}`);
    this.tick++;
    if (this.result) return;
    for (const { slot, commands } of inputs) {
      const p = this.pucks[slot];
      if (!p || this.anchored[slot]) continue;
      for (const c of commands) {
        if (this.validate(c)) continue;
        if (c.type === 'steer') p.dir = c.dir;
        if (c.type === 'dash') p.dash = true;
      }
    }
    if (this.phase === 'pause') {
      if (++this.phaseTick >= RULES.pauseTicks) this.newRound();
      return;
    }
    this.phaseTick++;
    this.move();
    this.collide();
    if (this.phaseTick > RULES.graceTicks) this.radius = Math.max(RULES.ringMin, this.radius - RULES.shrink[this.pace]);
    for (const s of this.slots) { const p = this.pucks[s]; if (!p.out && Math.hypot(p.x, p.y) > this.radius) p.out = true; }
    const on = this.slots.filter((s) => !this.pucks[s].out);
    if (on.length <= 1) this.endRound(on.length === 1 ? on[0] : 0);
    else if (this.phaseTick >= RULES.roundMaxTicks) this.endRound(0);
  }

  move() {
    const { dt, thrust, drag, maxSpeed, dash, dashCooldown, brake } = RULES;
    for (const s of this.slots) {
      const p = this.pucks[s];
      if (p.out) continue;
      if (this.anchored[s]) { p.vx *= brake; p.vy *= brake; } else if (p.dir >= 0) {
        const a = (p.dir * Math.PI * 2) / DIRS;
        p.vx += Math.cos(a) * thrust * dt;
        p.vy += Math.sin(a) * thrust * dt;
      }
      if (p.dash && p.cd === 0 && !this.anchored[s]) {
        let ux = 0, uy = 0;
        const speed = Math.hypot(p.vx, p.vy);
        if (p.dir >= 0) { const a = (p.dir * Math.PI * 2) / DIRS; ux = Math.cos(a); uy = Math.sin(a); } else if (speed > 1) { ux = p.vx / speed; uy = p.vy / speed; }
        if (ux || uy) { p.vx += ux * dash; p.vy += uy * dash; p.cd = dashCooldown; }
      }
      p.dash = false;
      if (p.cd > 0) p.cd--;
      p.vx *= drag; p.vy *= drag;
      const cap = p.cd > dashCooldown - 10 ? maxSpeed + dash : maxSpeed; // a fresh dash may exceed the cap
      const speed = Math.hypot(p.vx, p.vy);
      if (speed > cap) { p.vx = (p.vx / speed) * cap; p.vy = (p.vy / speed) * cap; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  // Equal masses, elastic with restitution, pairs in slot order.
  collide() {
    const r2 = RULES.puckRadius * 2;
    const on = this.slots.filter((s) => !this.pucks[s].out);
    for (let i = 0; i < on.length; i++) {
      for (let j = i + 1; j < on.length; j++) {
        const a = this.pucks[on[i]], b = this.pucks[on[j]];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d >= r2 || d === 0) continue;
        const nx = dx / d, ny = dy / d, push = (r2 - d) / 2;
        a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel >= 0) continue;
        const imp = (-(1 + RULES.restitution) * rel) / 2;
        a.vx -= imp * nx; a.vy -= imp * ny; b.vx += imp * nx; b.vy += imp * ny;
      }
    }
  }

  endRound(winner) {
    if (winner) this.score[winner]++;
    this.history.push([this.round, winner]);
    const top = Math.max(...Object.values(this.score));
    if (top >= RULES.winScore || this.round >= RULES.maxRounds) {
      const leaders = this.slots.filter((s) => this.score[s] === top);
      this.result = { winner: leaders.length === 1 ? leaders[0] : 0, score: { ...this.score }, rounds: this.round, tick: this.tick };
      this.phase = 'over';
      return;
    }
    this.phase = 'pause';
    this.phaseTick = 0;
  }

  // ---- snapshots and hashes: the module's codec, no registrations but the RNG --

  serialize() { return codec.encode(this); }
  hash() { return hashText(JSON.stringify(this.serialize())); }
  static restore(data) { return codec.decode(data); }
}
codec.register('Ringout', Ringout);
