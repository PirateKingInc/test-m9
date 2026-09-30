// Phase 9 hopeless camps (PHASE9_SPEC.md "Part C"). Each false-positive
// safeguard is its own scenario; then a genuinely hopeless camp, proven by the
// reachability search, is eliminated through the Phase 6 pipeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PF, makeWorld } from './helpers.js';
import { World } from '../src/sim/world.js';
import { FFA_MAP } from '../src/data/ffa.js';
import { HOPELESS } from '../src/data/camp-rules.js';
import { isHopeless, campModel, canRecover } from '../src/sim/hopeless.js';

const T = FFA_MAP.tile;
// A free-for-all where Crimson (team 2) keeps only its Castle, no units and
// `gold`; everything else is added per scenario.
function stripped(gold = 0) {
  const w = new World({ map: FFA_MAP, seed: 6, PF, setup: 'ffa' });
  for (const u of [...w.ofKind('unit')]) w.removeEntity(u);
  w.resources[2] = gold;
  w.castle = [...w.ofKind('building')].find((b) => b.team === 2 && b.type === 'core');
  w.put = (type, tx, ty, built = true) => w.addBuilding(type, 2, tx, ty, { built });
  w.unit = (type, tx = 76, ty = 20, team = 2) => w.addUnit(type, team, (tx + 0.5) * T, (ty + 0.5) * T);
  w.runFor = (s) => { for (let i = 0; i < s / 0.05 && !w.result; i++) w.step(); };
  w.out = () => (w.eliminated || []).find((e) => e.team === 2);
  return w;
}

// ---- the predicate itself ---------------------------------------------------

test('a Castle, no army, no Peasant, 40 gold (less than any unit): hopeless', () => {
  const w = stripped(40);
  assert.equal(isHopeless(w, 2), true);
  assert.equal(canRecover(campModel(w, 2)), false, 'no reachable sequence of actions leads to a unit or income');
});

test('safeguard: a Peasant alive while gold is left in a mine is never hopeless', () => {
  const w = stripped(0);
  w.unit('drone');
  assert.equal(isHopeless(w, 2), false);
});

test('safeguard: a Peasant with no mine left but gold for a Storehouse... still has a way (it can train Peasants: a unit)', () => {
  const w = stripped(100);
  for (const n of [...w.ofKind('node')]) w.removeEntity(n); // the whole map mined out
  w.unit('drone');
  assert.equal(isHopeless(w, 2), false);
});

test('safeguard: enough gold for the cheapest unit it can train (a Peasant at the Castle)', () => {
  const w = stripped(50);
  assert.equal(isHopeless(w, 2), false);
  w.resources[2] = 49;
  assert.equal(isHopeless(w, 2), true, 'one gold short');
});

test('safeguard: a Barracks and enough gold for the cheapest soldier', () => {
  const w = stripped(0);
  w.put('foundry', 74, 20);
  w.resources[2] = 60;
  // A Castle with 60 gold could already train a Peasant; make that impossible
  // to isolate the Barracks path: take the Castle out of the model.
  const m = { ...campModel(w, 2), core: false };
  assert.equal(canRecover(m), true);
  assert.equal(canRecover({ ...m, gold: 59 }), false);
});

test('safeguard: a unit in a training queue', () => {
  const w = stripped(0);
  w.castle.queue.push({ unit: 'drone', progress: 0 });
  assert.equal(isHopeless(w, 2), false);
});

test('safeguard: any combat unit alive', () => {
  const w = stripped(0);
  w.unit('sparker');
  assert.equal(isHopeless(w, 2), false);
});

test('safeguard: an unfinished site whose refund would buy something', () => {
  const w = stripped(0);
  w.put('foundry', 74, 20, false); // cancel: 75% of 150 = 112 gold -> a Peasant at the Castle
  assert.equal(isHopeless(w, 2), false);
  assert.equal(canRecover(campModel(w, 2)), true);
});

test('safeguard: a completed Storehouse is never flagged', () => {
  const w = stripped(0);
  w.put('depot', 74, 20);
  assert.equal(isHopeless(w, 2), false);
});

test('the search chains actions: cancel a site, build a Storehouse with the refund, a Peasant mines', () => {
  // No Castle in the model (it could train), a Peasant, no mines near it... a
  // pure economy chain: an unfinished Barracks (112 back) -> a Storehouse (100)
  // -> the Peasant delivers gold.
  const m = { gold: 0, peasants: 1, carrying: false, combat: 0, queued: 0, core: false, foundry: false, depot: false, sites: ['foundry'], selfSites: [], minesLeft: true };
  assert.equal(canRecover(m), true);
  assert.equal(canRecover({ ...m, sites: [] }), false, 'without the site to cancel there is no way');
});

// ---- the confirmation window and elimination --------------------------------

test('a camp hopeless for less than the window is not eliminated', () => {
  const w = stripped(40);
  w.runFor(HOPELESS.confirm - 2);
  w.resources[2] = 50; // gold arrives (a delivery, a refund): a way forward again
  w.runFor(HOPELESS.confirm + 2);
  assert.equal(w.out(), undefined);
  assert.ok(w.get(w.castle.id));
});

test('a genuinely hopeless camp is eliminated after the window, through the Phase 6 pipeline, with nothing transferred', () => {
  const w = stripped(40);
  const zones = w.zones.filter((z) => z.owner === 2).map((z) => z.id);
  w.runFor(HOPELESS.confirm - 0.5);
  assert.equal(w.out(), undefined, 'not before the window');
  w.runFor(HOPELESS.checkEvery + 1); // checked once a second: out by window + one check
  const rec = w.out();
  assert.ok(rec, 'eliminated');
  assert.equal(rec.reason, 'hopeless');
  assert.equal(rec.by, null, 'no conqueror: no killing blow');
  assert.deepEqual(rec.zones, zones);
  assert.ok(rec.zones.every((id) => w.zones.find((z) => z.id === id).owner === null), 'its zones are neutral');
  assert.equal([...w.entities.values()].filter((e) => e.team === 2).length, 0, 'razed like any fallen camp');
  assert.equal(w.resources[2], 0);
  assert.deepEqual(w.zoneLoot, { ne: 40 }, 'its gold is left in its home zone');
  for (const t of [1, 3, 4]) assert.ok(w.resources[t] === FFA_MAP.startingLumen, `camp ${t} got nothing for free`);
});

test('its home zone is capturable by whoever takes it, and the captor gets the gold left there', () => {
  const w = stripped(40);
  w.runFor(HOPELESS.confirm + 1);
  assert.ok(w.out());
  w.unit('striker', 80, 12, 3); // Rose walks in alone
  const before = w.resources[3];
  w.runFor(7);
  assert.equal(w.zones.find((z) => z.id === 'ne').owner, 3);
  assert.equal(w.resources[3], before + 40);
  assert.deepEqual(w.zoneLoot, {});
});

test('no double firing: a Castle that falls in the same tick is an ordinary Castle loss', () => {
  const w = stripped(40);
  w.hopelessSince = { 2: -100 }; // would fire at the next check
  w.castle.hp = 0; w.castle.killedBy = 3; // and the Castle falls on that very tick
  const gold3 = w.resources[3];
  while (!w.out()) w.step();
  assert.equal(w.eliminated.filter((e) => e.team === 2).length, 1, 'eliminated once');
  assert.equal(w.out().by, 3, 'by the camp that landed the blow');
  assert.equal(w.out().reason, undefined, 'not as hopeless');
  assert.equal(w.resources[3], gold3 + 40, 'the conqueror takes the gold as usual');
});

test('the same rule for every camp: the player\'s camp too', () => {
  const w = stripped(0);
  w.resources[1] = 10;
  w.runFor(HOPELESS.confirm + 1);
  assert.ok((w.eliminated || []).some((e) => e.team === 1 && e.reason === 'hopeless'));
});

test('1v1: a hopeless camp loses, and the other wins by "hopeless"', () => {
  const w = makeWorld({ setup: 'match' });
  for (const u of [...w.ofKind('unit')].filter((x) => x.team === 2)) w.removeEntity(u);
  w.resources[2] = 0;
  for (let i = 0; i < (HOPELESS.confirm + 1) / 0.05 && !w.result; i++) w.step();
  assert.equal(w.result?.winner, 1);
  assert.equal(w.result?.reason, 'hopeless');
});
