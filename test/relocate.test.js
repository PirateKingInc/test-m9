// Phase 9 moving a structure (PHASE9_SPEC.md "Part B"): half the cost, half
// the build time, an ordinary construction site in transit (no training, no
// supply, no drop-off, no Tower fire), the old building gone at confirmation,
// and no capture from moving into a hostile zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PF, makeWorld } from './helpers.js';
import { World } from '../src/sim/world.js';
import { FFA_MAP } from '../src/data/ffa.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { RELOCATE } from '../src/data/camp-rules.js';
import { supplyOf } from '../src/sim/supply.js';
import { weaponOf } from '../src/sim/combat.js';
import { nearestDepot } from '../src/sim/economy.js';
import { relocateCost } from '../src/sim/construction.js';
import { SIM_DT } from '../src/sim/constants.js';

import { canPlace } from '../src/sim/construction.js';

// A 1v1 world; put() places a completed building of team 1 at the nearest
// free spot to (tx, ty) and returns it; spot() finds a free spot for a type.
function sandbox() {
  const w = makeWorld({ setup: 'match' });
  w.resources[1] = 1000;
  w.spot = (type, tx, ty) => { for (const t of w.grid.spiral(tx, ty, 20)) if (canPlace(w, type, t.tx, t.ty) && canPlace(w, type, t.tx - 1, t.ty - 1)) return t; return null; };
  w.put = (type, tx, ty, team = 1) => { const s = w.spot(type, tx, ty); return w.addBuilding(type, team, s.tx, s.ty, { built: true }); };
  w.moveTo = (b, tx, ty) => { const s = w.spot(b.type, tx, ty); return w.issue({ type: 'relocate', id: b.id, tx: s.tx, ty: s.ty, team: 1 }); };
  return w;
}

test('cost and time: half of each, paid at confirmation; the old building is gone at once', () => {
  for (const type of ['depot', 'foundry', 'spire']) {
    const w = sandbox();
    const b = w.put(type, 12, 30);
    const gold = w.resources[1];
    const res = w.moveTo(b, 18, 44);
    assert.ok(res.ok, `${type}: ${res.reason}`);
    assert.equal(relocateCost(type), Math.floor(BUILDINGS[type].cost * RELOCATE.costShare));
    assert.equal(gold - w.resources[1], Math.floor(BUILDINGS[type].cost / 2), `${type}: half the cost`);
    assert.equal(w.get(b.id), undefined, `${type}: the old building is removed at confirmation`);
    const site = w.get(res.id);
    assert.equal(site.built, false);
    assert.equal(site.hp, site.maxHp * 0.1, 'starts at 10% health like any site');
    const ticks = Math.round((BUILDINGS[type].buildTime * RELOCATE.timeShare) / SIM_DT);
    for (let i = 0; i < ticks - 1; i++) w.step();
    assert.equal(site.built, false, `${type}: not before half its build time`);
    for (let i = 0; i < 2 && !site.built; i++) w.step();
    assert.equal(site.built, true, `${type}: up in half its build time (${BUILDINGS[type].buildTime / 2} s), with no Peasant`);
    assert.equal(site.hp, site.maxHp);
  }
});

test('in transit it is an ordinary construction site: no training, no supply, no drop-off, no Tower fire', () => {
  const w = sandbox();
  const foundry = w.put('foundry', 12, 30), depot = w.put('depot', 18, 30), spire = w.put('spire', 24, 30);
  const capBefore = supplyOf(w, 1).cap;
  const f = w.get(w.moveTo(foundry, 12, 44).id);
  const d = w.get(w.moveTo(depot, 20, 44).id);
  const s = w.get(w.moveTo(spire, 26, 44).id);
  assert.equal(w.issue({ type: 'train', building: f.id, unit: 'striker', team: 1 }).ok, false, 'no training');
  assert.equal(supplyOf(w, 1).cap, capBefore - BUILDINGS.depot.supply, 'the Storehouse gives no supply in transit');
  const peasant = w.addUnit('drone', 1, d.x, d.y + 3 * 32);
  assert.notEqual(nearestDepot(w, peasant)?.id, d.id, 'not a drop-off');
  assert.equal(weaponOf(s), null, 'the Watchtower does not shoot');
  w.run(16); // the Barracks, the slowest, takes 15 s
  assert.equal(weaponOf(s) != null && d.built && f.built, true, 'all working again once up');
  assert.equal(supplyOf(w, 1).cap, capBefore);
});

test('what cannot move: the Castle, a building still training, one still being built, one you cannot afford, a blocked spot', () => {
  const w = sandbox();
  const core = [...w.ofKind('building')].find((b) => b.team === 1 && b.type === 'core');
  assert.equal(w.issue({ type: 'relocate', id: core.id, tx: 20, ty: 20, team: 1 }).reason, "The Castle can't be moved");
  const f = w.put('foundry', 12, 30);
  w.issue({ type: 'train', building: f.id, unit: 'striker', team: 1 });
  assert.equal(w.issue({ type: 'relocate', id: f.id, tx: 12, ty: 38, team: 1 }).reason, 'Finish or cancel training first');
  const site = w.addBuilding('depot', 1, 20, 30);
  assert.equal(w.issue({ type: 'relocate', id: site.id, tx: 20, ty: 38, team: 1 }).reason, 'Finish building it first');
  const d = w.put('depot', 26, 30);
  w.resources[1] = 49;
  assert.equal(w.issue({ type: 'relocate', id: d.id, tx: 26, ty: 38, team: 1 }).reason, 'Not enough gold');
  w.resources[1] = 1000;
  assert.equal(w.issue({ type: 'relocate', id: d.id, tx: 12, ty: 30, team: 1 }).reason, "Can't build there", 'onto another building');
  const enemy = [...w.ofKind('building')].find((b) => b.team === 2);
  assert.equal(w.issue({ type: 'relocate', id: enemy.id, tx: 26, ty: 38, team: 1 }).ok, false, 'not another camp\'s building');
  assert.equal(w.resources[1], 1000, 'nothing charged for a refused move');
});

test('its own old footprint counts as free: a building can shift by a tile', () => {
  const w = sandbox();
  const d = w.put('depot', 26, 30);
  const res = w.issue({ type: 'relocate', id: d.id, tx: 27, ty: 30, team: 1 });
  assert.ok(res.ok, res.reason);
});

function ffa() {
  const w = new World({ map: FFA_MAP, seed: 4, PF, setup: 'ffa' });
  for (const u of [...w.ofKind('unit')]) w.removeEntity(u);
  w.resources[1] = 1000;
  w.zone = (id) => w.zones.find((z) => z.id === id);
  return w;
}

test('moving into a zone a rival holds is no capture, and the site can be destroyed while it goes up', () => {
  const w = ffa();
  w.zone('w').owner = 3; // Rose holds the West field, with soldiers on guard
  for (let i = 0; i < 8; i++) w.addUnit('striker', 3, (11 + (i % 4)) * 32, (46 + Math.floor(i / 4)) * 32);
  const tower = w.addBuilding('spire', 1, 20, 20, { built: true }); // Azure's Watchtower at home
  const res = w.issue({ type: 'relocate', id: tower.id, tx: 14, ty: 42, team: 1 });
  assert.ok(res.ok, res.reason);
  w.run(3);
  assert.equal(w.zone('w').owner, 3, 'still Rose\'s: a site is no military presence');
  w.run(9);
  assert.equal(w.get(res.id), undefined, 'the unfinished Watchtower was destroyed by the guards');
  assert.equal(w.zone('w').owner, 3);
});

test('a moved Watchtower that finishes in a rival\'s zone contests it, as an army walking in would; it does not take it', () => {
  const w = ffa();
  w.zone('w').owner = 3;
  w.addUnit('striker', 3, 30 * 32, 74 * 32); // one Rose soldier far across the zone, out of range
  const tower = w.addBuilding('spire', 1, 20, 20, { built: true });
  const res = w.issue({ type: 'relocate', id: tower.id, tx: 4, ty: 42, team: 1 });
  assert.ok(res.ok, res.reason);
  w.run(14);
  assert.equal(w.get(res.id).built, true);
  assert.equal(w.zone('w').contested, true, 'two camps present: contested');
  assert.equal(w.zone('w').owner, 3, 'no capture while Rose is still there');
});
