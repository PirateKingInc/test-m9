// The module's boundary (PLATFORM_SPEC.md, verification d): it imports nothing
// outside platform/lockstep, and its code names no concept of any particular
// game. Games built on it import only its public index.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(MODULE, '../..');
const files = (dir, out = []) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'test') files(p, out); } else if (n.endsWith('.js')) out.push(p);
  }
  return out;
};
const imports = (src) => [...src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1] || m[2]);
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1'); // comments out

test('the module imports nothing outside platform/lockstep', () => {
  for (const f of files(MODULE)) {
    for (const spec of imports(readFileSync(f, 'utf8'))) {
      if (/^https?:/.test(spec) || spec.includes('${')) continue; // a CDN the caller names
      assert.ok(spec.startsWith('.'), `${relative(ROOT, f)} imports a package: ${spec}`);
      const target = resolve(dirname(f), spec);
      assert.ok(target.startsWith(MODULE), `${relative(ROOT, f)} imports ${spec}, outside the module`);
    }
  }
});

// Words that would mean the module still thinks in one game's terms. ("match"
// is generic: a match is what every game plays; Dragonmarch's Match class
// could not reach the module anyway, by the import rule above.)
const GAME_WORDS = /\b(camps?|units?|zones?|teams?|world|Phaser|HoldBrain|AiEngine|lumen|gold|castle|peasant|dragon\w*|difficulty|ringout|pucks?)\b/i;
test('the module code names no game concept', () => {
  for (const f of files(MODULE)) {
    const lines = code(readFileSync(f, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      const m = line.match(GAME_WORDS);
      assert.equal(m, null, `${relative(ROOT, f)}:${i + 1} names "${m?.[0]}": ${line.trim()}`);
    });
  }
});

test('games import the module through its public index only', () => {
  const games = join(ROOT, 'games');
  if (!existsSync(games)) return;
  for (const f of files(games)) {
    for (const spec of imports(readFileSync(f, 'utf8'))) {
      if (/^https?:/.test(spec)) continue;
      const target = resolve(dirname(f), spec);
      const game = relative(games, f).split('/')[0];
      const own = target.startsWith(join(games, game));
      assert.ok(own || target === join(MODULE, 'index.js'), `${relative(ROOT, f)} imports ${spec}: a game may use only its own files and platform/lockstep/index.js`);
    }
  }
});
