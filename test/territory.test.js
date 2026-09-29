// Phase 6 territory (PHASE6_SPEC.md "Territory"): zone ownership in the sim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { FFA_MAP, TERRITORY } from '../src/data/ffa.js';
import { zoneAt, zonesOf } from '../src/sim/territory.js';
import { PF } from './helpers.js';

const T = FFA_MAP.tile;
// A free-for-all world with every Peasant removed, so only what a test adds moves.
function ffa() {
  const w = new World({ map: FFA_MAP, seed: 1, PF, setup: 'ffa' });
  for (const u of [...w.ofKind('unit')]) w.removeEntity(u);
  return w;
}
const zone = (w, id) => w.zones.find((z) => z.id === id);
const centre = (w, id) => { const [x, y, zw, zh] = zone(w, id).rect; return { x: (x + zw / 2) * T, y: (y + zh / 2 + 6) * T }; };
const runFor = (w, s) => { const end = w.time + s; while (w.time < end - 1e-9) w.step(); };
const hold = (w, unit, id) => { const p = centre(w, id); w.issue({ type: 'stop', ids: [unit.id], team: unit.team }); unit.x = p.x; unit.y = p.y; };

test('nine zones: four home zones owned by their camps, five neutral', () => {
  const w = ffa();
  assert.equal(w.zones.length, 9);
  assert.deepEqual(w.zones.filter((z) => z.owner != null).map((z) => [z.id, z.owner]), [['nw', 1], ['ne', 2], ['sw', 4], ['se', 3]]);
  for (const t of [1, 2, 3, 4]) assert.equal(zonesOf(w, t).length, 1);
  assert.equal(zoneAt(w, 10 * T, 10 * T).id, 'nw');
  assert.equal(zoneAt(w, 48 * T, 48 * T).id, 'c');
});

test('a camp alone in a neutral zone takes it after the hold time, not before', () => {
  const w = ffa();
  const u = w.addUnit('striker', 2, 0, 0);
  hold(w, u, 'n');
  runFor(w, TERRITORY.captureHold - 1.5);
  assert.equal(zone(w, 'n').owner, null, 'still neutral while the hold runs');
  runFor(w, 2.5);
  assert.equal(zone(w, 'n').owner, 2, 'captured');
  const ev = w.drainEvents().find((e) => e.type === 'zoneCaptured');
  assert.deepEqual([ev.zone, ev.from, ev.to], ['n', null, 2]);
});

test('a contested zone changes hands only once one camp holds it alone', () => {
  const w = ffa();
  const a = w.addUnit('bulwark', 2, 0, 0), b = w.addUnit('bulwark', 3, 0, 0);
  hold(w, a, 'c'); hold(w, b, 'c');
  a.x = 35 * T; a.y = 35 * T; // opposite corners of the Centre, too far apart to fight
  b.x = 60 * T; b.y = 60 * T;
  runFor(w, 12);
  assert.equal(zone(w, 'c').owner, null, 'contested: nobody takes it');
  assert.equal(zone(w, 'c').contested, true);
  w.removeEntity(b);
  runFor(w, TERRITORY.captureHold + 1.5);
  assert.equal(zone(w, 'c').owner, 2);
  assert.equal(zone(w, 'c').contested, false);
});

test('an empty zone keeps its owner; a rival must hold it to take it', () => {
  const w = ffa();
  const a = w.addUnit('striker', 2, 0, 0);
  hold(w, a, 'e');
  runFor(w, TERRITORY.captureHold + 1.5);
  assert.equal(zone(w, 'e').owner, 2);
  w.removeEntity(a);
  runFor(w, 20);
  assert.equal(zone(w, 'e').owner, 2, 'kept while empty');
  const b = w.addUnit('sparker', 3, 0, 0);
  hold(w, b, 'e');
  runFor(w, TERRITORY.captureHold + 1.5);
  assert.equal(zone(w, 'e').owner, 3, 'taken over');
});

test('Peasants alone never take a zone; a finished Watchtower does', () => {
  const w = ffa();
  const d = w.addUnit('drone', 4, 0, 0);
  hold(w, d, 's');
  runFor(w, 15);
  assert.equal(zone(w, 's').owner, null);
  w.addBuilding('spire', 4, 44, 76, { built: true });
  runFor(w, TERRITORY.captureHold + 1.5);
  assert.equal(zone(w, 's').owner, 4);
});

test("a home zone stays its camp's while the Castle stands, even against an army", () => {
  const w = ffa();
  const u = w.addUnit('striker', 3, 0, 0);
  hold(w, u, 'nw');
  u.y -= 12 * T; // away from team 1's Castle, so nothing fights
  runFor(w, 15);
  assert.equal(zone(w, 'nw').owner, 1);
});

test('the 1v1 match and the sandbox have no zones', () => {
  assert.equal(new World({ seed: 1, PF, setup: 'match' }).zones, undefined);
  assert.equal(new World({ seed: 1, PF }).zones, undefined);
});
