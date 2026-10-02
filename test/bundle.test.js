// Phase 12b: the site exactly as .github/workflows/pages.yml assembles it holds
// no API token, TURN key or static TURN credential (tools/check-bundle.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const site = () => {
  const d = mkdtempSync(join(tmpdir(), 'site-'));
  for (const f of ['index.html', 'sheet.html', 'src']) cpSync(f, join(d, f), { recursive: true });
  return d;
};
const check = (d) => { try { return { ok: true, out: execFileSync('node', ['tools/check-bundle.mjs', d], { encoding: 'utf8', stdio: 'pipe' }) }; } catch (e) { return { ok: false, out: e.stderr }; } };

test('the shipped site has only the Worker URL, no credential of any kind', () => {
  const d = site();
  try {
    const r = check(d);
    assert.ok(r.ok, r.out);
    assert.match(r.out, /Worker URL referenced 1x/);
  } finally { rmSync(d, { recursive: true }); }
});

test('the check catches a static TURN credential', () => {
  const d = site();
  try {
    appendFileSync(join(d, 'src/net/config.js'), "\nexport const X = [{ urls: 'turn:turn.cloudflare.com:3478', username: 'u', credential: 'c' }];\n");
    const r = check(d);
    assert.equal(r.ok, false);
    assert.match(r.out, /static relay/);
  } finally { rmSync(d, { recursive: true }); }
});
