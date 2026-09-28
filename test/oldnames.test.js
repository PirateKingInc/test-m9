// Phase 5: no player-facing text uses the Phase 1-4 names. Covers the text in
// the UI sources (string literals in src/game, visible text and tooltips in
// the HTML pages) and every display string in src/theme. The in-browser scan
// of the running game (menu, HUD, tooltips, tutorial, result screen) is
// e2e/oldnames.spec.js; README.md is scanned outside its internal-names table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { oldNamesIn } from './oldnames.js';
import * as theme from '../src/theme/names.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

// String literals of a JS source, comments removed. Single identifiers (ids,
// keys, CSS selectors) are code, not text, so only literals with a space or a
// capital letter count as player-facing.
export function literals(src) {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const out = [];
  for (const m of noComments.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const s = m[1] ?? m[2] ?? m[3];
    if (/\s|[A-Z]/.test(s)) out.push(s);
  }
  return out;
}

// Visible text and tooltip/label attributes of an HTML page.
function htmlText(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  const attrs = [...body.matchAll(/\s(?:title|alt|aria-label|placeholder)="([^"]*)"/g)].map((m) => m[1]);
  const text = body.replace(/<[^>]*>/g, ' ');
  return [text, ...attrs];
}

test('UI sources show no old names', () => {
  const hits = [];
  for (const f of readdirSync(new URL('../src/game/', import.meta.url)).filter((x) => x.endsWith('.js'))) {
    for (const s of literals(read(`src/game/${f}`))) for (const n of oldNamesIn(s)) hits.push(`src/game/${f}: "${n}" in ${JSON.stringify(s.slice(0, 80))}`);
  }
  for (const s of literals(read('src/art/sheet.js'))) for (const n of oldNamesIn(s)) hits.push(`src/art/sheet.js: "${n}" in ${JSON.stringify(s.slice(0, 80))}`);
  for (const f of ['index.html', 'sheet.html']) for (const s of htmlText(read(f))) for (const n of oldNamesIn(s)) hits.push(`${f}: "${n}"`);
  assert.deepEqual(hits, []);
});

test('every display string in src/theme is free of old names, including translated sim messages', () => {
  const strings = [];
  const walk = (v) => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  for (const [k, v] of Object.entries(theme)) if (typeof v !== 'function') walk({ [k]: v });
  // Every rejection message the sim can emit, as the player reads it.
  const reasons = [];
  for (const f of readdirSync(new URL('../src/sim/', import.meta.url))) {
    for (const m of read(`src/sim/${f}`).matchAll(/reason: ['"]([^'"]+)['"]/g)) reasons.push(m[1]);
  }
  assert.ok(reasons.includes('Not enough Lumen'), 'found the sim messages');
  strings.push(...reasons.map(theme.reasonText));
  const hits = strings.flatMap((s) => oldNamesIn(s).map((n) => `"${n}" in ${JSON.stringify(s)}`));
  assert.deepEqual(hits, []);
});

test('README.md uses the fantasy names outside its internal-names table and code', () => {
  const md = read('README.md')
    .replace(/<!-- internal-names -->[\s\S]*?<!-- \/internal-names -->/, '')
    .replace(/\\`/g, '') // an escaped backtick is text, not a code span
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/\]\([^)]*\)/g, ']'); // link targets (file names)
  assert.match(read('README.md'), /<!-- internal-names -->/, 'the table is marked');
  assert.match(md, /The single resource is/, 'prose survives the stripping');
  assert.deepEqual(oldNamesIn(md), []);
});

test('the scan catches old names (self-check)', () => {
  assert.deepEqual(oldNamesIn('Build a Lumen Depot near the crystal'), ['Lumen', 'Depot', 'crystal']);
  assert.deepEqual(oldNamesIn('Train Strikers at the Foundry'), ['Strikers', 'Foundry']);
  assert.deepEqual(oldNamesIn('an early rush is answered by Watchtowers'), []);
  assert.deepEqual(literals("const a = 'drone'; // a Drone\nlabel('Sentry Spire')"), ['Sentry Spire']);
});
