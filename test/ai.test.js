// Phase 2 AI engine: acts only through World.issue(), never mutates state directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, PF } from './helpers.js';
import { AiEngine } from '../src/ai/engine.js';
import { Match } from '../src/ai/match.js';
import { readonly, MutationError } from '../src/ai/readonly.js';

const guarded = (w, opts) => new AiEngine(w, { view: readonly(w), ...opts });

test('the read-only guard catches a deliberately cheating AI', () => {
  const w = makeWorld({ setup: 'match' });
  class FreeMoney extends AiEngine { think() { this.w.resources[this.team] += 1000; } }
  class Godmode extends AiEngine { think() { for (const u of this.mine('unit')) u.hp = 9999; } }
  class Teleport extends AiEngine { think() { this.mine('unit')[0].x = 100; } }
  class Backdoor extends AiEngine { think() { this.w.issue({ type: 'devSpawn', unit: 'bulwark', x: 0, y: 0, team: 2 }); } }
  class Queue extends AiEngine { think() { this.mine('building', 'core')[0].queue.push({ unit: 'drone', progress: 9 }); } }
  for (const Cheat of [FreeMoney, Godmode, Teleport, Backdoor, Queue]) {
    const ai = new Cheat(w, { team: 2, view: readonly(w) });
    assert.throws(() => ai.think(), MutationError, Cheat.name);
  }
  assert.equal(w.resources[2], 250, 'no cheat got through');
});

test('the engine refuses non-player commands and always acts as its own team', () => {
  const w = makeWorld({ setup: 'match' });
  const ai = guarded(w, { team: 2 });
  assert.throws(() => ai.issue({ type: 'devSpawn', unit: 'bulwark', x: 0, y: 0 }), /not allowed/);
  const playerDrone = [...w.ofKind('unit')].find((u) => u.team === 1);
  const res = ai.issue({ type: 'move', ids: [playerDrone.id], x: 100, y: 100, team: 1 });
  assert.equal(res.ok, false, "the AI's team is stamped over any team it passes");
});

test('the Phase 1 sandbox script runs as team 2 through a read-only view, mirrored to the east', () => {
  const w = makeWorld({ setup: 'match', seed: 5 });
  const ai = guarded(w, { team: 2, strategy: 'sandbox', difficulty: 'hard' });
  for (let t = 0; t < 180 * 20 && !w.result; t++) { w.step(); ai.update(); }
  const mine = [...w.ofKind('building')].filter((b) => b.team === 2);
  assert.deepEqual([...new Set(mine.map((b) => b.type))].sort(), ['core', 'depot', 'foundry', 'spire']);
  const depot = mine.find((b) => b.type === 'depot');
  assert.deepEqual([depot.tx, depot.ty], [100 - 17 - 3, 34], 'mirror of the west depot spot (17,34)');
  assert.ok(mine.every((b) => b.x > w.width / 2), 'all of it in the east half');
  assert.ok(ai.stats.commands > 10);
  assert.equal(ai.army().length >= 2, true, 'it trained combat units');
});

test('Match steps the world then the brains, and runs to a declared result', () => {
  const m = new Match({ seed: 3, PF, ai: { strategy: 'sandbox', difficulty: 'hard' } });
  m.world.map = { ...m.world.map, timeLimit: 60 };
  const r = m.runToEnd();
  assert.equal(r.reason, 'time-limit');
  assert.ok(m.ai.stats.commands > 0);
});
