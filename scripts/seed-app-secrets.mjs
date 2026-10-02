#!/usr/bin/env node
/**
 * Move secrets from environment variables into public.app_secrets.
 *
 * WHY THIS EXISTS. The app_secrets table, its AES-256-GCM encryption and the
 * admin page at /admin/settings/secrets have all worked since migration 029 and
 * the table has never held a single row. So every key still resolves from
 * Coolify's env and every key change is a redeploy. This moves them across.
 *
 * NOTHING IS HARDCODED. Key NAMES come from the app's own MANAGED list. Key
 * VALUES come from an env file you name, or from the process environment.
 * No secret is written into this file, printed, or logged — output is key names
 * and SHA-256 fingerprints only, so two runs can be compared without ever
 * revealing a value.
 *
 * SAFE TO RE-RUN. Upserts by key. And safe to undo: getSecret() falls back to
 * process.env when a row is absent, so `DELETE FROM app_secrets WHERE key=...`
 * hands that key straight back to Coolify with no code change.
 *
 * Usage:
 *   node scripts/seed-app-secrets.mjs --dry-run              # show what would happen
 *   node scripts/seed-app-secrets.mjs --sql-out seed.sql     # write SQL, apply it yourself
 *   node scripts/seed-app-secrets.mjs --env-file .env.local --dry-run
 *   node scripts/seed-app-secrets.mjs --only R2_BUCKET,RESEND_API_KEY --dry-run
 *
 * CONFIG_ENCRYPTION_KEY must be the SAME key production uses, or the rows will
 * be undecryptable there. The script prints its fingerprint so you can compare
 * before writing anything — see --dry-run output.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';

// ── the key names this app manages, mirroring src/lib/app-secrets.ts ────────
// Deliberately a literal list rather than "everything in the env file": a
// typo'd or unrelated variable must not silently become an app secret.
const MANAGED = [
  'WHATSAPP_TOKEN', 'WHATSAPP_VERIFY_TOKEN', 'META_APP_SECRET',
  'OTP_HASH_SECRET', 'MCP_SECRET_KEY', 'WEBHOOK_SECRET',
  'N8N_BLOG_PUBLISHED_WEBHOOK_URL', 'N8N_COMMENT_POSTED_WEBHOOK_URL',
  'RESEND_API_KEY', 'GEMINI_API_KEY', 'NOTION_API_KEY', 'LOCAL_AI_SECRET',
  'GCP_SERVICE_ACCOUNT_KEY', 'GITHUB_RELEASE_TOKEN',
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET',
];

// Boot-critical: the app must read these BEFORE it can reach the database, so
// they can never live in a table the database holds. Refused loudly rather
// than skipped quietly — asking for it means a misunderstanding worth naming.
const NEVER = new Set([
  'DATABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'CONFIG_ENCRYPTION_KEY',
  'ACCOUNT_DELETION_ENCRYPTION_KEY', 'CRON_SECRET', 'PORT', 'HOST',
]);

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

const DRY = flag('--dry-run');
const ENV_FILE = opt('--env-file', '.env.local');
const SQL_OUT = opt('--sql-out');
const ONLY = opt('--only');

/** Parses KEY=value lines. Strips one layer of quotes, the way Coolify writes
 *  them. Values are read literally — never evaluated — so a credential
 *  containing a backtick or $() cannot execute. */
function parseEnvFile(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); }
  catch { return {}; }
  const out = {};
  for (const line of text.split('\n')) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) continue;
    const i = line.indexOf('=');
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[line.slice(0, i)] = v;
  }
  return out;
}

// File first, then the real environment — so this works both on a laptop with
// .env.local and on a server where the values are already exported.
const fileEnv = parseEnvFile(ENV_FILE);
const source = { ...process.env, ...fileEnv };

const rawKey = (source.CONFIG_ENCRYPTION_KEY || '').trim();
if (!rawKey) {
  console.error('CONFIG_ENCRYPTION_KEY is not set (checked the environment and ' + ENV_FILE + ').');
  process.exit(1);
}
const key = Buffer.from(rawKey, 'hex');
if (key.length !== 32) {
  console.error(`CONFIG_ENCRYPTION_KEY must be 32 bytes as 64 hex characters; got ${key.length} bytes.`);
  process.exit(1);
}

/** Byte-for-byte the format encryptSecret() writes in src/lib/app-secrets.ts:
 *  "v<N>:" + base64(iv[12] ‖ authTag[16] ‖ ciphertext), with v1 unprefixed so
 *  code predating versioning can still read it. */
function encryptSecret(plaintext, version = 1) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const body = Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
  return version === 1 ? body : `v${version}:${body}`;
}

function decryptSecret(value) {
  const m = value.match(/^v([0-9]+):([\s\S]*)$/);
  const raw = Buffer.from(m ? m[2] : value, 'base64');
  const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

/** Safe to print: identifies a value without revealing it, so two machines can
 *  be compared. Same idea as keyFingerprint() in app-secrets.ts. */
const fp = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);
const keyFp = createHash('sha256').update(key).digest('hex').slice(0, 16);

const wanted = ONLY ? new Set(ONLY.split(',').map((s) => s.trim())) : null;
for (const k of wanted ?? []) {
  if (NEVER.has(k)) {
    console.error(`REFUSED: ${k} is boot-critical. The app must read it before it can reach the\n` +
                  `database, so it cannot live in a table the database holds. Leave it in Coolify.`);
    process.exit(1);
  }
  if (!MANAGED.includes(k)) {
    console.error(`REFUSED: ${k} is not in the MANAGED list in this script or in src/lib/app-secrets.ts.`);
    process.exit(1);
  }
}

console.log(`CONFIG_ENCRYPTION_KEY fingerprint: ${keyFp}`);
console.log(`  Compare against production before writing. Different fingerprint means the rows`);
console.log(`  will be written but cannot be decrypted there.\n`);
console.log(`source: ${ENV_FILE} (file) + process environment\n`);

const rows = [];
let skipped = 0;
for (const k of MANAGED) {
  if (wanted && !wanted.has(k)) continue;
  const v = source[k];
  if (!v) { console.log(`  ${k.padEnd(32)} — absent, skipped`); skipped++; continue; }

  const enc = encryptSecret(v);
  // Verify before trusting it. A row that cannot be decrypted is worse than no
  // row: getSecret() would find it, fail, and fall through — silently.
  if (decryptSecret(enc) !== v) {
    console.error(`  ${k.padEnd(32)} ROUND-TRIP FAILED — aborting, nothing written`);
    process.exit(1);
  }
  console.log(`  ${k.padEnd(32)} ok  value-fp=${fp(v)}  ciphertext=${enc.length}b`);
  rows.push({ key: k, value_enc: enc });
}

console.log(`\n${rows.length} ready, ${skipped} skipped.`);

if (rows.length === 0) process.exit(0);

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const stamp = `seed-app-secrets ${new Date().toISOString().slice(0, 10)}`;
const sql = 'BEGIN;\n' + rows.map((r) =>
  `INSERT INTO public.app_secrets (key, value_enc, env_fallback, updated_by)\n` +
  `VALUES (${q(r.key)}, ${q(r.value_enc)}, ${q(r.key)}, ${q(stamp)})\n` +
  `ON CONFLICT (key) DO UPDATE SET value_enc = EXCLUDED.value_enc,\n` +
  `  updated_at = now(), updated_by = EXCLUDED.updated_by;`
).join('\n') + '\nCOMMIT;\n';

if (DRY) {
  console.log('\n--dry-run: nothing written. Re-run with --sql-out <file> to produce SQL.');
  process.exit(0);
}

if (!SQL_OUT) {
  console.error('\nRefusing to print SQL to stdout — it contains ciphertext and stdout is often logged.');
  console.error('Pass --sql-out <file>, apply it, then shred the file.');
  process.exit(1);
}

writeFileSync(SQL_OUT, sql, { mode: 0o600 });
console.log(`\nSQL written to ${SQL_OUT} (mode 600).`);
console.log('Apply it, then SHRED IT — it holds ciphertext for every key above.');
console.log('\n  shred -u ' + SQL_OUT);
