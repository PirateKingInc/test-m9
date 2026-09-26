// Procedural sound effects via the Web Audio API (no asset files).
// Driven by the sim's event stream plus UI notifications. Rate-limited per
// sound and capped in total voices so 40 units fighting never clip.

const MIN_GAP = { alert0: 1, alert1: 1, attack: 0.07, death: 0.05, dropoff: 0.12, select: 0.05, command: 0.05, rejected: 0.3, built: 0.2, trained: 0.15, placed: 0.1, cancelled: 0.1, depleted: 0.3, core: 0.5 };

// What every sim event sounds like (Phase 3 audio pass). test/audio.test.js
// checks that each event type the sim emits has an entry here. "own" sounds
// only play for the player's team; "positional" ones fade with camera distance.
export const EVENT_SOUNDS = {
  attack: 'weapon sound per attack type: sword swish, arrow twang, mace thud, dragonfire roar (positional)',
  death: 'explosion: small for units, bigger for buildings, a deep boom for a Castle (positional)',
  built: 'rising three-note chime (own)',
  trained: 'rising blip (own)',
  placed: 'construction thunk (own)',
  cancelled: 'falling blip (own)',
  dropoff: 'soft gold clink (own, positional)',
  depleted: 'glassy falling chime when a gold mine runs dry (positional)',
  rejected: 'low buzz (own)',
  gameOver: 'victory fanfare, defeat stinger or draw chord',
};
const MAX_VOICES = 14;
const HEARING = 1400; // px from the camera center at which world sounds fade out

// Even reading window.localStorage can throw (blocked storage, some privacy modes).
function safeStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export class Sfx {
  constructor({ createContext = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(), storage = safeStorage() } = {}) {
    this.createContext = createContext;
    this.storage = storage;
    this.ctx = null;
    this.voices = 0;
    this.last = {};
    this.played = 0; // total voices started (for tests/diagnostics)
    this.recent = []; // names of the last sounds started (for tests/diagnostics)
    try { this.muted = storage?.getItem('prism-muted') === '1'; } catch { this.muted = false; }
  }

  // Browsers only allow audio after a user gesture.
  unlock() {
    try {
      if (!this.ctx) {
        this.ctx = this.createContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { this.ctx = null; }
  }

  toggleMute() {
    this.muted = !this.muted;
    try { this.storage?.setItem('prism-muted', this.muted ? '1' : '0'); } catch { /* storage unavailable */ }
    return this.muted;
  }

  // Returns a gain node for a new voice, or null if muted / rate-limited / too many voices.
  voice(kind, volume, duration) {
    if (this.muted || !this.ctx || volume <= 0.01) return null;
    const now = this.ctx.currentTime;
    if (now - (this.last[kind] ?? -1) < (MIN_GAP[kind] ?? 0.05) || this.voices >= MAX_VOICES) return null;
    this.last[kind] = now;
    this.voices++;
    this.played++;
    this.recent.push(kind.replace(/\d+$/, ''));
    if (this.recent.length > 50) this.recent.shift();
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(volume, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    g.connect(this.master);
    setTimeout(() => { this.voices--; g.disconnect?.(); }, duration * 1000 + 50);
    return g;
  }

  tone(kind, { freq, to = freq, type = 'sine', dur = 0.1, vol = 0.5, delay = 0 }) {
    const g = this.voice(kind, vol, dur + delay);
    if (!g) return;
    const o = this.ctx.createOscillator(), t = this.ctx.currentTime + delay;
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + dur);
    o.connect(g);
    o.start(t);
    o.stop(t + dur);
  }

  noise(kind, { dur = 0.1, vol = 0.4, filter = 'highpass', freq = 1500 }) {
    const g = this.voice(kind, vol, dur);
    if (!g) return;
    const ctx = this.ctx, len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1; // audio texture only, not sim state
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    src.buffer = buf;
    src.connect(f);
    f.connect(g);
    src.start();
  }

  // UI sounds (not positional).
  ui(name) {
    if (name === 'select') this.tone('select', { freq: 880, to: 990, dur: 0.05, vol: 0.25 });
    else if (name === 'command') { this.tone('command', { freq: 520, to: 700, type: 'triangle', dur: 0.07, vol: 0.3 }); }
    else if (name === 'rejected') this.tone('rejected', { freq: 150, to: 110, type: 'square', dur: 0.18, vol: 0.25 });
    else if (name === 'alert') {
      this.tone('alert0', { freq: 880, to: 660, type: 'square', dur: 0.16, vol: 0.22 });
      this.tone('alert1', { freq: 880, to: 660, type: 'square', dur: 0.16, vol: 0.22, delay: 0.22 });
    } else if (name === 'start') { // match start: a rising two-note horn
      this.tone('start0', { freq: 392, to: 392, type: 'triangle', dur: 0.2, vol: 0.3 });
      this.tone('start1', { freq: 587, to: 587, type: 'triangle', dur: 0.35, vol: 0.3, delay: 0.18 });
    } else if (name === 'hint') {
      this.tone('hint', { freq: 1046, to: 1318, dur: 0.12, vol: 0.18 });
    }
  }

  // End-of-match stinger for the player's team.
  stinger(result, team = 1) {
    if (result.winner === team) {
      [523, 659, 784, 1046].forEach((f, i) => this.tone(`victory${i}`, { freq: f, type: 'triangle', dur: i === 3 ? 0.7 : 0.16, vol: 0.32, delay: i * 0.14 }));
    } else if (result.winner == null) {
      [440, 554, 659].forEach((f, i) => this.tone(`draw${i}`, { freq: f, type: 'sine', dur: 0.9, vol: 0.2 }));
    } else {
      [392, 330, 262, 196].forEach((f, i) => this.tone(`defeat${i}`, { freq: f, to: f * 0.97, type: 'sawtooth', dur: i === 3 ? 0.9 : 0.22, vol: 0.2, delay: i * 0.2 }));
    }
  }

  // World events, attenuated by distance from the camera center (cx, cy).
  // `team` is the player's team: build/train/cancel cues are for it alone.
  handle(events, cx = 0, cy = 0, team = 1) {
    for (const e of events) {
      const d = e.x !== undefined ? Math.hypot(e.x - cx, e.y - cy) : 0;
      const near = Math.max(0, 1 - d / HEARING);
      const own = e.team === undefined || e.team === team;
      switch (e.type) {
        case 'attack':
          if (e.attack === 'blade') this.noise('attack', { dur: 0.05, vol: 0.25 * near, freq: 3000 });
          else if (e.attack === 'bolt') this.tone('attack', { freq: 1400, to: 380, type: 'sawtooth', dur: 0.08, vol: 0.12 * near });
          else if (e.attack === 'crush') this.noise('attack', { dur: 0.12, vol: 0.45 * near, filter: 'lowpass', freq: 400 });
          else if (e.attack === 'lance') this.tone('attack', { freq: 180, to: 1600, type: 'sawtooth', dur: 0.16, vol: 0.14 * near });
          break;
        case 'death':
          if (e.unit === 'core') { // heard across the map
            this.noise('core', { dur: 1.4, vol: 0.9, filter: 'lowpass', freq: 260 });
            this.tone('core', { freq: 110, to: 30, dur: 1.2, vol: 0.4 });
            break;
          }
          this.noise('death', { dur: e.kind === 'building' ? 0.6 : 0.3, vol: (e.kind === 'building' ? 0.7 : 0.4) * near, filter: 'lowpass', freq: 700 });
          this.tone('death', { freq: 320, to: 50, dur: 0.3, vol: 0.2 * near });
          break;
        case 'built':
          if (own) [523, 659, 784].forEach((f, i) => this.tone(`built${i}`, { freq: f, dur: 0.12, vol: 0.3, delay: i * 0.09 }));
          break;
        case 'trained':
          if (own) this.tone('trained', { freq: 660, to: 880, type: 'triangle', dur: 0.1, vol: 0.28 });
          break;
        case 'placed':
          if (own) this.noise('placed', { dur: 0.14, vol: 0.35, filter: 'lowpass', freq: 500 });
          break;
        case 'cancelled':
          if (own) this.tone('cancelled', { freq: 700, to: 350, type: 'triangle', dur: 0.14, vol: 0.25 });
          break;
        case 'dropoff':
          if (own) this.tone('dropoff', { freq: 1250, to: 1500, dur: 0.06, vol: 0.08 * near });
          break;
        case 'depleted':
          this.tone('depleted', { freq: 2093, to: 1046, dur: 0.4, vol: 0.2 * near });
          break;
        case 'rejected':
          if (own) this.ui('rejected');
          break;
        case 'gameOver':
          this.stinger(e, team);
          break;
        default:
      }
    }
  }
}
