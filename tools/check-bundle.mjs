// Phase 12b (PHASE12B_SPEC.md Part C, credential security): inspects the
// shipped site, file by file, for anything that would let a browser use the
// TURN relay without the Worker: an API token, a TURN key, a static TURN
// server with a username and credential, or a direct call to Cloudflare's
// credential API. The only Cloudflare address allowed is the Worker's URL.
//
//   node tools/check-bundle.mjs _site                 a local copy (CI, before deploy)
//   node tools/check-bundle.mjs _site https://.../    the live site: the same files, fetched
//
// If CF_TURN_KEY_ID, CF_TURN_KEY_API_TOKEN, CLOUDFLARE_API_TOKEN or
// CLOUDFLARE_ACCOUNT_ID are set, their exact values are searched for too.
//
// Platform Milestone 1: every game on the platform names the Worker in its own
// config file (Dragonmarch's src/net/config.js, Ringout's
// games/ringout/config.js), once each; nowhere else.
// GITHUB_SHA, if set, is the deployed commit (pages.yml writes it to
// version.txt): public, so it alone is exempt from the hex-token rule.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { TURN } from '../src/net/config.js';

const [dir, base] = process.argv.slice(2);
if (!dir) { console.error('usage: check-bundle.mjs <site dir> [live base URL]'); process.exit(2); }

const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files.push(relative(dir, p)); } };
walk(dir);
const TEXT = /\.(html|js|css|json|txt|md|svg)$/;

const RULES = [
  ['Cloudflare credential API called from the site', /rtc\.live\.cloudflare\.com|generate-ice-servers/],
  ['an Authorization header or bearer token', /\bBearer\s|['"]authorization['"]\s*:/i],
  ['a TURN server address (a static relay)', /\bturns?:[a-z0-9.-]+/i],
  ['a literal username/credential for an ICE server', /\b(username|credential)\s*[:=]\s*['"`]/],
  ['a long hex token (TURN keys and credentials are hex)', /\b[0-9a-f]{32,}\b/i],
  ['a Cloudflare or workers.dev address other than the Worker', /[a-z0-9.-]*(cloudflare\.com|workers\.dev)/i],
];
const secrets = ['CF_TURN_KEY_ID', 'CF_TURN_KEY_API_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].filter((k) => process.env[k]);

const problems = [];
const WORKER_FILES = ['src/net/config.js', 'games/ringout/config.js'];
let scanned = 0, bytes = 0, workerRefs = 0;
for (const f of files) {
  let body;
  if (base) {
    const res = await fetch(new URL(f, base), { cache: 'no-store' });
    // A dotfile (.nojekyll) that the host does not serve cannot leak anything.
    if (res.status === 404 && f.split('/').pop().startsWith('.')) continue;
    if (!res.ok) { problems.push(`${f}: live site answered ${res.status}`); continue; }
    body = Buffer.from(await res.arrayBuffer());
  } else body = readFileSync(join(dir, f));
  scanned++; bytes += body.length;
  const text = body.toString('latin1'); // binaries too: a secret is ASCII wherever it hides
  for (const k of secrets) if (text.includes(process.env[k])) problems.push(`${f}: contains the value of ${k}`);
  if (!TEXT.test(f)) continue;
  const refs = text.split(TURN.endpoint).length - 1;
  workerRefs += refs;
  if (refs && (!WORKER_FILES.includes(f.split('\\').join('/')) || refs > 1)) problems.push(`${f}: the Worker URL ${refs}x (only once, in a game's config file: ${WORKER_FILES.join(', ')})`);
  for (const [what, re] of RULES) {
    let scan = text.replaceAll(TURN.endpoint, '');
    if (/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA || '')) scan = scan.replaceAll(process.env.GITHUB_SHA, '');
    const m = scan.match(re);
    if (m) problems.push(`${f}: ${what}: "${m[0]}"`);
  }
}
if (!workerRefs) problems.push('the Worker URL appears nowhere (expected in src/net/config.js)');

console.log(`# bundle check (${base ? `live: ${base}` : `local: ${dir}`}): ${scanned} files, ${(bytes / 1024).toFixed(0)} KiB; ${secrets.length} secret values compared exactly (${secrets.join(', ') || 'none set'}); Worker URL referenced ${workerRefs}x`);
if (problems.length) { for (const p of problems) console.error(`FAIL ${p}`); process.exit(1); }
console.log('# no API token, TURN key, static TURN credential or direct Cloudflare API call in the shipped site');
