// Phase 12b: the site exactly as .github/workflows/pages.yml assembles it holds
// no API token, TURN key or static TURN credential (tools/check-bundle.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Assembled exactly as pages.yml does, version.txt (the commit SHA) included.
const SHA = '3b695ebcf7f363592a56001478c0dea4af72fd54';
const site = () => {
  const d = mkdtempSync(join(tmpdir(), 'site-'));
  for (const f of ['index.html', 'sheet.html', 'src']) cpSync(f, join(d, f), { recursive: true });
  writeFileSync(join(d, 'version.txt'), `${SHA}\n`);
  writeFileSync(join(d, '.nojekyll'), '');
  return d;
};
const check = (d, env = { GITHUB_SHA: SHA }) => {
  try { return { ok: true, out: execFileSync('node', ['tools/check-bundle.mjs', d], { encoding: 'utf8', stdio: 'pipe', env: { PATH: process.env.PATH, ...env } }) }; } catch (e) { return { ok: false, out: e.stderr }; }
};

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

test('only the deployed commit SHA is exempt from the hex-token rule', () => {
  const d = site();
  try {
    assert.equal(check(d, {}).ok, false, 'version.txt without GITHUB_SHA: flagged');
    writeFileSync(join(d, 'version.txt'), `${'ab'.repeat(20)}\n`);
    const r = check(d);
    assert.equal(r.ok, false, 'another 40-hex value: flagged');
    assert.match(r.out, /long hex token/);
  } finally { rmSync(d, { recursive: true }); }
});
