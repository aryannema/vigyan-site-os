#!/usr/bin/env node
/**
 * Asserts that every environment variable the code reads is accounted for.
 *
 * "Accounted for" deliberately does NOT mean "listed in .env.example". Most
 * values are managed in the admin panel and stored in the database, and naming
 * them in .env.example would read as "you are supposed to set this" — which is
 * the habit we are migrating away from.
 *
 * So a variable is accounted for if it is exactly one of:
 *   - declared in .env.example          (bootstrap / build / local-dev)
 *   - listed in MANAGED_SECRETS          (app_secrets, set at /admin/settings/secrets)
 *   - listed in MANAGED_CONFIG below     (app_config, set at /admin/settings)
 *   - a known external                   (NODE_ENV, the Nixpacks build var)
 *
 * Anything else is a variable someone added without deciding where it lives,
 * which is how production ends up missing values nobody knew were required.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(e)) out.push(p);
  }
  return out;
}

const read = new Set();
for (const f of [...walk(join(root, 'src')), ...walk(join(root, 'scripts'))]) {
  for (const m of readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
    read.add(m[1]);
  }
}

const example = new Set(
  readFileSync(join(root, '.env.example'), 'utf8')
    .split('\n')
    .map((l) => l.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
    .filter(Boolean),
);

const secretsSrc = readFileSync(join(root, 'src/lib/app-secrets.ts'), 'utf8');
const managedSecrets = new Set(
  secretsSrc
    .slice(secretsSrc.indexOf('MANAGED_SECRETS = ['))
    .match(/'([A-Z][A-Z0-9_]*)'/g)
    ?.map((s) => s.replaceAll("'", '')) ?? [],
);

/** Keys served from public.app_config. Non-secret by definition. */
const MANAGED_CONFIG = new Set([
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_API_VERSION',
  'WHATSAPP_SELF_NOTIFY_NUMBER',
  'RESEND_FROM_ADDRESS',
  'GSC_SITE_URL',
  'GA4_PROPERTY_ID',
  'LOCAL_AI_URL',
  'LOCAL_AI_MODEL',
  'NOTION_DATABASE_ID',
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_SUPABASE_ID',
]);

/** Set by something other than us. */
const EXTERNAL = new Set(['NODE_ENV', 'NIXPACKS_NODE_VERSION']);

const described = JSON.parse(readFileSync(join(root, 'env.manifest.json'), 'utf8')).vars;
const unaccounted = [...read]
  .filter((v) => !described[v] && !example.has(v) && !managedSecrets.has(v) && !MANAGED_CONFIG.has(v) && !EXTERNAL.has(v))
  .sort();

/** A name in BOTH places is ambiguous: two stores, no stated winner. */
const doubled = [...managedSecrets].filter((v) => example.has(v)).sort();

let failed = false;
if (unaccounted.length) {
  failed = true;
  console.error('\n  FAIL  read by code but not accounted for anywhere:');
  for (const v of unaccounted) console.error(`          ${v}`);
  console.error('\n        Decide where it lives: .env.example (bootstrap/build),');
  console.error('        MANAGED_SECRETS (app_secrets), or MANAGED_CONFIG (app_config).');
}
if (doubled.length) {
  failed = true;
  console.error('\n  FAIL  declared in .env.example AND managed as a secret:');
  for (const v of doubled) console.error(`          ${v}`);
  console.error('\n        Remove it from .env.example — it is set at /admin/settings/secrets.');
}

if (!failed) {
  console.log(`  ok    ${read.size} env vars read by code, all accounted for`);
  console.log(`  ok    ${example.size} in .env.example (bootstrap + build only)`);
  console.log(`  ok    ${managedSecrets.size} managed at /admin/settings/secrets`);
  console.log(`  ok    ${MANAGED_CONFIG.size} managed at /admin/settings`);
  console.log('\nenv:check passed');
}
// ── env.manifest.json: every name the code can read must be described there ──
// Scans direct env reads (dot and bracket form) plus the getSecret / secretMatches readers:
// the last two are how secrets are read, and the process.env-only scan above
// never saw them (CRON_SECRET and CLOUDFLARE_* slipped past for that reason).
const manifest = JSON.parse(readFileSync(join(root, 'env.manifest.json'), 'utf8')).vars;
const named = new Set(read);
for (const f of [...walk(join(root, 'src')), ...walk(join(root, 'scripts'))]) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]|(?:getSecret|secretMatches)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g)) {
    named.add(m[1] || m[2]);
  }
}
const SCAN_NOISE = new Set(['NIXPACKS_NODE_VERSION', 'SOPS_DISABLE_VERSION_CHECK']);
const undocumented = [...named].filter((v) => !manifest[v] && !SCAN_NOISE.has(v)).sort();
const readButDeprecated = [...named].filter((v) => manifest[v]?.tier === 'deprecated').sort();
const secretNotStorable = Object.entries(manifest)
  .filter(([k, m]) => m.tier === 'secret' && !managedSecrets.has(k))
  .map(([k]) => k)
  .sort();
if (undocumented.length) {
  failed = true;
  console.error('\n  FAIL  read by code but missing from env.manifest.json:');
  for (const v of undocumented) console.error(`          ${v}`);
}
if (readButDeprecated.length) {
  failed = true;
  console.error('\n  FAIL  marked deprecated in env.manifest.json but still read by code:');
  for (const v of readButDeprecated) console.error(`          ${v}`);
}
if (secretNotStorable.length) {
  console.warn(`\n  warn  tier "secret" but not storable at /admin/settings/secrets (not in MANAGED_SECRETS): ${secretNotStorable.join(', ')}`);
}
if (!undocumented.length && !readButDeprecated.length) {
  console.log(`  ok    ${named.size} names read by code, all described in env.manifest.json`);
}

process.exit(failed ? 1 : 0);
