#!/usr/bin/env node
// secrets.mjs — one vault (SOPS + age), one manifest (env.manifest.json),
// pushed to whichever platform runs the app. NEVER prints a value: output is
// names, counts and plans only.
//
//   node scripts/secrets.mjs init                     age key (if missing) + .sops.yaml
//   node scripts/secrets.mjs edit   --env prod        open the vault in $EDITOR (sops)
//   node scripts/secrets.mjs import --env prod --from plain.env   encrypt an existing dotenv into the vault
//   node scripts/secrets.mjs check  --env prod        vault vs manifest: missing / unknown / deprecated
//   node scripts/secrets.mjs lint                     code vs manifest: every env name read must be described
//   node scripts/secrets.mjs sync local   --env dev   write .env.local (mode 600)
//   node scripts/secrets.mjs sync coolify --env prod [--apply]   Coolify bulk env API
//   node scripts/secrets.mjs sync vercel  --env prod [--apply]   Vercel env API (upsert)
//
// Platforms receive only bootstrap + public tiers by default: everything else is
// set in the admin panel (app_secrets / app_config). --include secret,config adds
// env fallbacks for those tiers. Platform credentials come from the environment:
//   Coolify: COOLIFY_BASE_URL, COOLIFY_ACCESS_TOKEN, COOLIFY_APP_UUID
//   Vercel:  VERCEL_TOKEN, VERCEL_PROJECT (id or name), optional VERCEL_TEAM_ID
// Vault file: secrets/<env>.sops.env (dotenv, encrypted values, safe to commit).
// Age key: $SOPS_AGE_KEY_FILE or ~/.config/sops/age/keys.txt (never commit).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, chmodSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'env.manifest.json'), 'utf8'));
const PLATFORM_TIERS = ['bootstrap', 'public'];

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);
const die = (msg, code = 1) => {
  console.error(`secrets: ${msg}`);
  process.exit(code);
};

const envName = flag('env', 'dev');
const vaultPath = resolve(ROOT, flag('vault', join('secrets', `${envName}.sops.env`)));
const keyFile = process.env.SOPS_AGE_KEY_FILE || join(homedir(), '.config', 'sops', 'age', 'keys.txt');

function sops(argv, input) {
  return execFileSync('sops', argv, {
    cwd: ROOT,
    input,
    encoding: 'utf8',
    env: { ...process.env, SOPS_AGE_KEY_FILE: keyFile, SOPS_DISABLE_VERSION_CHECK: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Decrypt the vault into a Map in memory. Values never leave this process except to their target. */
function readVault() {
  if (!existsSync(vaultPath)) die(`no vault at ${vaultPath} — create it with: node scripts/secrets.mjs edit --env ${envName}`);
  let plain;
  try {
    plain = sops(['--decrypt', '--input-type', 'dotenv', '--output-type', 'dotenv', vaultPath]);
  } catch (e) {
    die(`could not decrypt ${vaultPath} (missing or wrong age key at ${keyFile}?)`);
  }
  const vars = new Map();
  for (const line of plain.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) vars.set(m[1], m[2]);
  }
  return vars;
}

const tierOf = (name) => MANIFEST.vars[name]?.tier;

function selected(vars) {
  const include = (flag('include', '') || '').split(',').filter(Boolean);
  const tiers = new Set([...PLATFORM_TIERS, ...include]);
  // `platform: true` = a non-bootstrap var the host itself also needs (e.g. CRON_SECRET for its scheduler).
  return [...vars].filter(([k, v]) => v !== '' && (tiers.has(tierOf(k)) || MANIFEST.vars[k]?.platform));
}

// ── commands ────────────────────────────────────────────────────────────────

function init() {
  if (!existsSync(keyFile)) {
    mkdirSync(dirname(keyFile), { recursive: true, mode: 0o700 });
    execFileSync('age-keygen', ['-o', keyFile], { stdio: ['ignore', 'ignore', 'ignore'] });
    chmodSync(keyFile, 0o600);
    console.log(`created age key ${keyFile} (600) — back it up OFFLINE; losing it loses the vault`);
  } else {
    console.log(`age key present: ${keyFile}`);
  }
  const pub = readFileSync(keyFile, 'utf8').match(/# public key: (age1[0-9a-z]+)/)?.[1];
  if (!pub) die(`no public key line in ${keyFile}`);
  const sopsYaml = join(ROOT, '.sops.yaml');
  if (existsSync(sopsYaml)) {
    console.log('.sops.yaml exists — add this recipient to it if this machine is new:', pub);
  } else {
    writeFileSync(sopsYaml, `# Recipients that can decrypt secrets/*.sops.env. Public keys only.\ncreation_rules:\n  - path_regex: secrets/.*\\.sops\\.env$\n    age: >-\n      ${pub}\n`);
    console.log(`wrote .sops.yaml with recipient ${pub}`);
  }
  mkdirSync(join(ROOT, 'secrets'), { recursive: true });
}

function edit() {
  mkdirSync(dirname(vaultPath), { recursive: true });
  execFileSync('sops', [vaultPath], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, SOPS_AGE_KEY_FILE: keyFile, SOPS_DISABLE_VERSION_CHECK: '1' },
  });
}

function importPlain() {
  const from = flag('from');
  if (!from || !existsSync(from)) die('import needs --from <existing plain dotenv file>');
  mkdirSync(dirname(vaultPath), { recursive: true });
  // sops matches creation rules against the FILE NAME, so encrypt under the
  // vault's own name or a plain .env never matches secrets/*.sops.env.
  const enc = sops(['--encrypt', '--filename-override', vaultPath, '--input-type', 'dotenv', '--output-type', 'dotenv', resolve(from)]);
  const tmp = `${vaultPath}.tmp-${process.pid}`;
  writeFileSync(tmp, enc, { mode: 0o644 });
  renameSync(tmp, vaultPath);
  const n = enc.split('\n').filter((l) => /^[A-Z0-9_]+=ENC\[AES256_GCM/.test(l)).length;
  console.log(`encrypted ${n} vars into ${vaultPath.replace(ROOT + '/', '')} — now delete the plain file: ${from}`);
}

function check() {
  const vars = readVault();
  const required = Object.entries(MANIFEST.vars)
    .filter(([, m]) => m.required && PLATFORM_TIERS.includes(m.tier))
    .map(([k]) => k);
  const missing = required.filter((k) => !vars.get(k));
  const unknown = [...vars.keys()].filter((k) => !MANIFEST.vars[k]);
  const deprecated = [...vars.keys()].filter((k) => tierOf(k) === 'deprecated');
  const adminTier = [...vars.keys()].filter((k) => ['secret', 'config'].includes(tierOf(k)));
  console.log(`vault ${envName}: ${vars.size} vars`);
  console.log(`  missing required (bootstrap/public): ${missing.length ? missing.join(', ') : 'none'}`);
  console.log(`  not in manifest: ${unknown.length ? unknown.join(', ') : 'none'}`);
  console.log(`  deprecated, remove: ${deprecated.length ? deprecated.join(', ') : 'none'}`);
  console.log(`  admin-panel tier (synced only with --include): ${adminTier.length}`);
  if (missing.length || unknown.length) process.exitCode = 2;
}

function lint() {
  const roots = ['src', 'app', 'lib', 'scripts', 'middleware.ts'].map((r) => join(ROOT, r)).filter(existsSync);
  const files = [];
  const walk = (p) => {
    if (statSync(p).isFile()) return /\.(m?[jt]sx?)$/.test(p) && files.push(p);
    for (const e of readdirSync(p)) if (!['node_modules', '.next'].includes(e)) walk(join(p, e));
  };
  roots.forEach(walk);
  const named = new Set();
  const re = /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]|(?:getSecret|secretMatches)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g;
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(re)) named.add(m[1] || m[2] || m[3]);
  const undocumented = [...named].filter((v) => !MANIFEST.vars[v]).sort();
  const deprecated = [...named].filter((v) => tierOf(v) === 'deprecated').sort();
  if (undocumented.length) console.error(`not in env.manifest.json: ${undocumented.join(', ')}`);
  if (deprecated.length) console.error(`marked deprecated but still read: ${deprecated.join(', ')}`);
  if (undocumented.length || deprecated.length) process.exitCode = 1;
  else console.log(`ok: ${named.size} env names read by code, all described in env.manifest.json`);
}

function syncLocal() {
  const vars = readVault();
  const out = resolve(ROOT, flag('out', '.env.local'));
  const keep = [...vars].filter(([k, v]) => v !== '' && !['deprecated', 'framework'].includes(tierOf(k)));
  const body = `# Generated by scripts/secrets.mjs from ${vaultPath.replace(ROOT + '/', '')}. Do not edit; do not commit.\n` +
    keep.map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  const tmp = `${out}.tmp-${process.pid}`;
  writeFileSync(tmp, body, { mode: 0o600 });
  renameSync(tmp, out);
  chmodSync(out, 0o600);
  console.log(`wrote ${out.replace(ROOT + '/', '')} (600): ${keep.length} vars`);
}

async function syncCoolify() {
  const vars = selected(readVault());
  const data = vars.map(([key, value]) => {
    const phase = MANIFEST.vars[key]?.phase;
    return { key, value, is_preview: false, is_buildtime: phase === 'build', is_runtime: true, is_literal: true };
  });
  console.log(`coolify plan (${data.length}): ${data.map((d) => `${d.key}${d.is_buildtime ? '[build]' : ''}`).join(', ')}`);
  if (!has('apply')) return console.log('dry run — re-run with --apply to push');
  const { COOLIFY_BASE_URL: base, COOLIFY_ACCESS_TOKEN: token, COOLIFY_APP_UUID: uuid } = process.env;
  if (!base || !token || !uuid) die('set COOLIFY_BASE_URL, COOLIFY_ACCESS_TOKEN, COOLIFY_APP_UUID');
  const res = await fetch(`${base.replace(/\/$/, '')}/api/v1/applications/${uuid}/envs/bulk`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) die(`coolify answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  console.log(`coolify: ${data.length} vars upserted — redeploy for build-time vars to take effect`);
}

async function syncVercel() {
  const vars = selected(readVault());
  const target = flag('target', envName === 'prod' ? 'production' : envName === 'preview' ? 'preview' : 'development');
  const body = vars.map(([key, value]) => ({
    key,
    value,
    type: tierOf(key) === 'public' || key.startsWith('NEXT_PUBLIC_') ? 'plain' : 'encrypted',
    target: [target],
  }));
  console.log(`vercel plan → ${target} (${body.length}): ${body.map((b) => b.key).join(', ')}`);
  if (!has('apply')) return console.log('dry run — re-run with --apply to push');
  const { VERCEL_TOKEN: token, VERCEL_PROJECT: project, VERCEL_TEAM_ID: team } = process.env;
  if (!token || !project) die('set VERCEL_TOKEN and VERCEL_PROJECT');
  const qs = new URLSearchParams({ upsert: 'true', ...(team ? { teamId: team } : {}) });
  const res = await fetch(`https://api.vercel.com/v10/projects/${encodeURIComponent(project)}/env?${qs}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) die(`vercel answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  console.log(`vercel: ${body.length} vars upserted to ${target} — redeploy to apply`);
}

const [cmd, sub] = args;
const run = {
  init,
  edit,
  import: importPlain,
  check,
  lint,
  sync: () => {
    const target = { local: syncLocal, coolify: syncCoolify, vercel: syncVercel }[sub];
    if (!target) die('sync target: local | coolify | vercel');
    return target();
  },
}[cmd];
if (!run) die('usage: init | edit | import --from f | check | lint | sync <local|coolify|vercel>  [--env dev|prod] [--apply] [--include secret,config]');
await run();
