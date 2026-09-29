// Headless check of the Web Audio layer with a fake AudioContext.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Sfx, EVENT_SOUNDS } from '../src/game/audio.js';

function fakeContext() {
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {}, start() {}, stop() {}, gain: param(), frequency: param(), type: '' });
  const ctx = {
    state: 'running', currentTime: 0, sampleRate: 8000, destination: node(),
    createGain: node, createOscillator: node, createBiquadFilter: node, createBufferSource: node,
    createBuffer: (_c, len) => ({ getChannelData: () => new Float32Array(len) }),
    resume() {},
  };
  return ctx;
}

const memoryStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('nothing plays before the first user gesture unlocks audio', () => {
  const sfx = new Sfx({ createContext: fakeContext, storage: memoryStorage() });
  sfx.handle([{ type: 'trained', x: 0, y: 0 }]);
  assert.equal(sfx.played, 0);
  sfx.unlock();
  sfx.handle([{ type: 'trained', x: 0, y: 0 }]);
  assert.equal(sfx.played, 1);
});

test('a burst of 40 simultaneous attacks is rate-limited to one voice', () => {
  const sfx = new Sfx({ createContext: fakeContext, storage: memoryStorage() });
  sfx.unlock();
  const burst = Array.from({ length: 40 }, () => ({ type: 'attack', attack: 'blade', x: 0, y: 0 }));
  sfx.handle(burst);
  assert.equal(sfx.played, 1);
  sfx.ctx.currentTime = 1;
  sfx.handle(burst);
  assert.equal(sfx.played, 2);
});

test('total voices are capped', () => {
  const sfx = new Sfx({ createContext: fakeContext, storage: memoryStorage() });
  sfx.unlock();
  for (let i = 0; i < 100; i++) { sfx.ctx.currentTime += 1; sfx.handle([{ type: 'death', kind: 'unit', x: 0, y: 0 }]); }
  assert.ok(sfx.voices <= 14, `voices ${sfx.voices}`);
});

test('M-toggle mutes everything and persists', () => {
  const storage = memoryStorage();
  const sfx = new Sfx({ createContext: fakeContext, storage });
  sfx.unlock();
  assert.equal(sfx.toggleMute(), true);
  sfx.handle([{ type: 'built' }, { type: 'trained' }]);
  sfx.ui('select');
  assert.equal(sfx.played, 0);
  assert.equal(new Sfx({ createContext: fakeContext, storage }).muted, true, 'mute survives a reload');
});

test('far-away world sounds are silent, UI sounds are not positional', () => {
  const sfx = new Sfx({ createContext: fakeContext, storage: memoryStorage() });
  sfx.unlock();
  sfx.handle([{ type: 'attack', attack: 'bolt', x: 5000, y: 5000 }], 0, 0);
  assert.equal(sfx.played, 0);
  sfx.ui('command');
  assert.equal(sfx.played, 1);
});

// ---- Phase 3 audio pass ----------------------------------------------------

const unlocked = () => { const sfx = new Sfx({ createContext: fakeContext, storage: memoryStorage() }); sfx.unlock(); return sfx; };

test('every event type the sim emits has a sound mapping', () => {
  const dir = new URL('../src/sim/', import.meta.url);
  const emitted = new Set();
  for (const f of readdirSync(dir)) for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/emit\('(\w+)'/g)) emitted.add(m[1]);
  assert.ok(emitted.size >= 10, `found ${[...emitted]}`);
  for (const type of emitted) assert.ok(EVENT_SOUNDS[type], `no sound mapped for sim event "${type}"`);
  // ...and each mapped event actually makes a sound.
  for (const type of emitted) {
    const sfx = unlocked();
    const e = { type, team: 1, x: 0, y: 0, kind: 'unit', unit: 'striker', attack: 'blade', winner: 1, reason: 'core-destroyed', to: 1, from: null };
    sfx.handle([e], 0, 0, 1);
    assert.ok(sfx.played > 0, `"${type}" played nothing`);
  }
});

test('build/train/cancel cues play for the player only, not the AI', () => {
  const sfx = unlocked();
  sfx.handle([{ type: 'trained', team: 2 }, { type: 'built', team: 2 }, { type: 'placed', team: 2 }, { type: 'cancelled', team: 2 }, { type: 'rejected', team: 2 }], 0, 0, 1);
  assert.equal(sfx.played, 0);
  sfx.handle([{ type: 'trained', team: 1 }], 0, 0, 1);
  assert.equal(sfx.played, 1);
});

test('victory, defeat and draw each have their own stinger', () => {
  const kinds = (winner) => { const sfx = unlocked(); sfx.handle([{ type: 'gameOver', winner, reason: 'core-destroyed' }], 0, 0, 1); return new Set(sfx.recent); };
  assert.deepEqual([...kinds(1)], ['victory']);
  assert.deepEqual([...kinds(2)], ['defeat']);
  assert.deepEqual([...kinds(null)], ['draw']);
});

test('a Command Core falling is heard across the map; other buildings fade with distance', () => {
  const sfx = unlocked();
  sfx.handle([{ type: 'death', kind: 'building', unit: 'depot', team: 2, x: 9000, y: 9000 }], 0, 0);
  assert.equal(sfx.played, 0);
  sfx.handle([{ type: 'death', kind: 'building', unit: 'core', team: 2, x: 9000, y: 9000 }], 0, 0);
  assert.ok(sfx.recent.includes('core'));
});

test('match start and tutorial hint cues exist', () => {
  const sfx = unlocked();
  sfx.ui('start');
  sfx.ui('hint');
  assert.deepEqual([...new Set(sfx.recent)], ['start', 'hint']);
});
