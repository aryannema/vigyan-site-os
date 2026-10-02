#!/usr/bin/env node
// pnpm bootstrap — fill the platform (bootstrap/public) variables of a fresh site.
// Run AFTER the accounts/hosts exist (Hostinger + Coolify, Vercel, AWS; Supabase cloud
// or self-hosted). For every variable env.manifest.json says the host needs:
//   1. already in the vault           -> keep
//   2. generatable (gen: hex32/literal) -> generate straight into the vault
//   3. fetchable from a provider       -> fetch straight into the vault
//   4. otherwise                       -> say exactly where to find it, ask (hidden)
// Then: vault check, sync plan for the host, admin-panel checklist.
// No value is ever printed. Without a terminal (an agent running it) nothing is
// asked: it reports what is still missing with the guidance, exit code 3.
//
//   pnpm bootstrap --host coolify|vercel|aws|local --supabase cloud|coolify [--env prod]
//     cloud:   --project-ref <ref>   (uses `supabase projects api-keys`; run `supabase login` first)
//     coolify: --service <uuid>      (self-hosted Supabase service; COOLIFY_BASE_URL + COOLIFY_ACCESS_TOKEN
//                                     with read:sensitive in your shell)
//   --stdin   read answers line by line from stdin (scripted / tests)

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'env.manifest.json'), 'utf8'));
const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const has = (n) => args.includes(`--${n}`);

const host = flag('host');
const supa = flag('supabase');
const envName = flag('env', host === 'local' ? 'dev' : 'prod');
const vaultPath = join(ROOT, 'secrets', `${envName}.sops.env`);
const keyFile = process.env.SOPS_AGE_KEY_FILE || join(homedir(), '.config', 'sops', 'age', 'keys.txt');
const sopsEnv = { ...process.env, SOPS_AGE_KEY_FILE: keyFile, SOPS_DISABLE_VERSION_CHECK: '1' };
const interactive = process.stdin.isTTY || has('stdin');

const say = (s = '') => console.log(s);
const die = (s, code = 1) => {
  console.error(`bootstrap: ${s}`);
  process.exit(code);
};

if (!['coolify', 'vercel', 'aws', 'local'].includes(host) || !['cloud', 'coolify'].includes(supa)) {
  die('usage: pnpm bootstrap --host coolify|vercel|aws|local --supabase cloud|coolify [--project-ref REF | --service UUID] [--env prod]');
}

// ── vault (values stay in this process; written back encrypted) ─────────────
function readVault() {
  if (!existsSync(vaultPath)) return new Map();
  const plain = execFileSync('sops', ['-d', '--input-type', 'dotenv', '--output-type', 'dotenv', vaultPath], { cwd: ROOT, env: sopsEnv, encoding: 'utf8' });
  const m = new Map();
  for (const line of plain.split('\n')) {
    const x = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (x) m.set(x[1], x[2]);
  }
  return m;
}
function writeVault(vars) {
  mkdirSync(dirname(vaultPath), { recursive: true });
  const plain = [...vars].map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  const enc = execFileSync('sops', ['encrypt', '--filename-override', vaultPath, '--input-type', 'dotenv', '--output-type', 'dotenv'], { cwd: ROOT, env: sopsEnv, input: plain, encoding: 'utf8' });
  const tmp = `${vaultPath}.tmp-${process.pid}`;
  writeFileSync(tmp, enc);
  renameSync(tmp, vaultPath);
}

// ── answers ─────────────────────────────────────────────────────────────────
let lines = null;
async function ask(question) {
  if (has('stdin')) {
    if (!lines) {
      lines = [];
      const rl = createInterface({ input: process.stdin });
      for await (const l of rl) lines.push(l);
    }
    return (lines.shift() ?? '').trim();
  }
  // Hidden TTY input: nothing is echoed.
  process.stdout.write(question);
  return await new Promise((res) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    let buf = '';
    const onData = (ch) => {
      const c = ch.toString('utf8');
      if (c === '\r' || c === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        process.stdout.write('\n');
        res(buf.trim());
      } else if (c === '\u0003') process.exit(130);
      else if (c === '\u007f') buf = buf.slice(0, -1);
      else buf += c;
    };
    stdin.on('data', onData);
  });
}

// ── generators / fetchers ───────────────────────────────────────────────────
function generate(spec) {
  if (spec === 'hex32') return randomBytes(32).toString('hex');
  if (spec?.startsWith('literal:')) return spec.slice(8);
  return null;
}

async function fetchProvider() {
  const out = {};
  if (supa === 'cloud') {
    const ref = flag('project-ref');
    if (!ref) return out;
    out.NEXT_PUBLIC_SUPABASE_URL = `https://${ref}.supabase.co`;
    try {
      const raw = execFileSync('supabase', ['projects', 'api-keys', '--project-ref', ref, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      for (const k of JSON.parse(raw)) {
        if (k.name === 'anon') out.NEXT_PUBLIC_SUPABASE_ANON_KEY = k.api_key;
        if (k.name === 'service_role') out.SUPABASE_SERVICE_ROLE_KEY = k.api_key;
      }
    } catch {
      say('  · supabase CLI unavailable or not logged in (`supabase login`) — keys will be asked for');
    }
    // DATABASE_URL embeds the DB password, which no API returns: always guided.
  } else {
    const uuid = flag('service');
    const { COOLIFY_BASE_URL: base, COOLIFY_ACCESS_TOKEN: token } = process.env;
    if (!uuid || !base || !token) {
      say('  · self-hosted fetch skipped (needs --service <uuid> and COOLIFY_BASE_URL/COOLIFY_ACCESS_TOKEN)');
      return out;
    }
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/api/v1/services/${uuid}/envs`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const env = Object.fromEntries((await res.json()).map((e) => [e.key, e.real_value ?? e.value]));
      const pick = (...keys) => keys.map((k) => env[k]).find(Boolean);
      const anon = pick('SERVICE_SUPABASEANON_KEY', 'ANON_KEY');
      const service = pick('SERVICE_SUPABASESERVICE_KEY', 'SERVICE_ROLE_KEY');
      const pw = pick('SERVICE_PASSWORD_POSTGRES', 'POSTGRES_PASSWORD');
      const api = pick('API_EXTERNAL_URL', 'SERVICE_FQDN_SUPABASEKONG', 'SERVICE_URL_SUPABASEKONG');
      if (anon) out.NEXT_PUBLIC_SUPABASE_ANON_KEY = anon;
      if (service) out.SUPABASE_SERVICE_ROLE_KEY = service;
      if (api) out.NEXT_PUBLIC_SUPABASE_URL = api.startsWith('http') ? api : `https://${api}`;
      if (pw) out.DATABASE_URL = `postgres://postgres:${encodeURIComponent(pw)}@supabase-db-${uuid}:5432/postgres`;
    } catch (e) {
      say(`  · Coolify fetch failed (${e.message}) — token needs read:sensitive; values will be asked for`);
    }
  }
  return out;
}

const sourceFor = (k) => {
  const s = MANIFEST.vars[k].source || {};
  return s[supa === 'cloud' ? 'supabase_cloud' : 'supabase_selfhosted'] || s.vendor || s.generate || MANIFEST.vars[k].purpose;
};

// ── run ─────────────────────────────────────────────────────────────────────
say(`\nBootstrap — host: ${host}, Supabase: ${supa}, vault: secrets/${envName}.sops.env`);
if (!existsSync(join(ROOT, '.sops.yaml')) || !existsSync(keyFile)) {
  execFileSync('node', [join(ROOT, 'scripts', 'secrets.mjs'), 'init'], { stdio: 'inherit', env: sopsEnv });
}

const vars = readVault();
const wanted = Object.entries(MANIFEST.vars)
  .filter(([, m]) => ['bootstrap', 'public'].includes(m.tier) || m.platform)
  .filter(([, m]) => m.ask !== false);
const fetched = await fetchProvider();
const missing = [];
let changed = 0;

for (const [k, m] of wanted) {
  if (vars.get(k)) {
    say(`  ✓ ${k} (in vault)`);
    continue;
  }
  const g = generate(m.gen);
  if (g) {
    vars.set(k, g);
    changed++;
    say(`  + ${k} generated`);
    continue;
  }
  if (fetched[k]) {
    vars.set(k, fetched[k]);
    changed++;
    say(`  + ${k} fetched from ${supa === 'cloud' ? 'Supabase' : 'Coolify'}`);
    continue;
  }
  if (!m.required && !interactive) continue;
  if (!interactive) {
    missing.push(k);
    continue;
  }
  say(`\n  ? ${k} — ${m.purpose}\n    where: ${sourceFor(k)}${m.required ? '' : '\n    (optional — press Enter to skip)'}`);
  const v = await ask('    value (hidden): ');
  if (v) {
    vars.set(k, v);
    changed++;
    say(`  + ${k} saved`);
  } else if (m.required) missing.push(k);
}

if (changed) writeVault(vars);
say(`\nVault: ${changed} added, ${vars.size} total.`);

if (missing.length) {
  say('\nStill needed (ask the operator; never paste values into chat):');
  for (const k of missing) say(`  - ${k}: ${sourceFor(k)}`);
  say(`Then run: pnpm bootstrap --host ${host} --supabase ${supa}   (in a terminal)`);
  process.exit(3);
}

say('');
execFileSync('node', [join(ROOT, 'scripts', 'secrets.mjs'), 'check', '--env', envName], { stdio: 'inherit', env: sopsEnv });
if (host === 'aws') {
  say(`\nAWS: ${MANIFEST.platforms.aws.set_with}\n     ${MANIFEST.platforms.aws.notes}`);
} else {
  execFileSync('node', [join(ROOT, 'scripts', 'secrets.mjs'), 'sync', host, '--env', envName], { stdio: 'inherit', env: sopsEnv });
  if (host !== 'local') say(`\nReview the plan above, then push: pnpm secrets sync ${host} --env ${envName} --apply  — ${MANIFEST.platforms[host].notes}`);
}

const admin = (tier) => Object.entries(MANIFEST.vars).filter(([, m]) => m.tier === tier && !m.platform).map(([k]) => k);
if (admin('secret').length || admin('config').length) {
  say('\nAfter the first deploy, sign in and set these in the admin panel (they are not platform variables):');
  if (admin('secret').length) say(`  /admin/settings/secrets : ${admin('secret').join(', ')}`);
  if (admin('config').length) say(`  /admin/settings         : ${admin('config').join(', ')}`);
  say('  (self-generated ones have a Generate button there; vendor ones come from their dashboards)');
}
