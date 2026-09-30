import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('PROJECT.md records all phases and the project-wide out-of-scope list', () => {
  const doc = read('PROJECT.md');
  for (const phase of ['Phase', '1 — Sandbox', '2 — Scripted AI opponent', '3 — Balance & polish', '4 — Mobile & art', '5 — Fantasy reskin & zoom', '6 — Free-for-all foundation', '7 — Multi-rival AI', '8 — Symmetry & N-way balance', '9 — Auto-defend, moving structures, hopeless camps', '10 — Multiplayer foundation', '11 — Lockstep play, disconnects, reconnection']) {
    assert.ok(doc.includes(phase), `missing "${phase}"`);
  }
  for (const banned of ['Fog of war', 'More than one faction', 'at most 2 tech tiers', 'Multiplayer', 'Map editors or procedural maps', 'Adaptive or learning AI']) {
    assert.ok(doc.includes(banned), `out-of-scope list missing "${banned}"`);
  }
});

test('BACKLOG.md entries are tagged with a future phase', () => {
  const items = read('BACKLOG.md').split('\n').filter((l) => l.startsWith('- '));
  assert.ok(items.length > 0);
  for (const item of items) assert.match(item, /^- \[P(?:[2-9]|1[01])\]/, item);
});
