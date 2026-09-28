#!/usr/bin/env node
// Prints the free-for-all camp spacing measurements (PHASE6_SPEC.md).
//   node tools/travel.mjs
import { roundTrip, castleKillTime } from '../test/travel.js';
import { MAP } from '../src/data/map.js';
for (const [a, b, label] of [[1, 4, 'NW-SW (nearest pair)'], [1, 2, 'NW-NE'], [1, 3, 'NW-SE (diagonal)']]) {
  const r = roundTrip(a, b);
  console.log(`${label}: path ${r.pathTiles.toFixed(0)} tiles, there ${r.there.toFixed(1)} s, back ${r.back.toFixed(1)} s, round trip ${r.roundTrip.toFixed(1)} s`);
}
const c = roundTrip(1, 2, 1, MAP);
console.log(`1v1 map, west-east (for comparison): path ${c.pathTiles.toFixed(0)} tiles, round trip ${c.roundTrip.toFixed(1)} s`);
const k = [1, 2, 3].map((s) => castleKillTime(s));
console.log(`undefended Castle vs a 14-unit raid: ${k.map((x) => x.toFixed(1)).join(', ')} s`);
