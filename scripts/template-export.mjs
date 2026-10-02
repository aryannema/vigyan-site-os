#!/usr/bin/env node
// template-export.mjs — generate the public template (vigyan-site-os) from this repo, ONE WAY.
//
//   pnpm template:export [--out DIR] [--verify [--db-url postgres://…/empty_db]] [--ref HEAD]
//   pnpm template:export --check-only DIR      # forbidden-string scan of an existing tree
//
// Source is a git ref (default HEAD): only committed work leaves, nothing from the working
// tree. Rules live in template/export.rules.json, neutral identity in template/overlay/.
// The output is never edited by hand; site-os receives it as one commit/PR.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'template/export.rules.json'), 'utf8'));

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const has = (name) => args.includes(name);

// ── glob → regex (supports **, *, ?, [..]) ────────────────────────────────────
function globRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') { const j = glob.indexOf(']', i); re += glob.slice(i, j + 1); i = j; }
    else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
const excludes = RULES.exclude.filter((g) => !g.startsWith('!')).map(globRe);
const keeps = RULES.exclude.filter((g) => g.startsWith('!')).map((g) => globRe(g.slice(1)));
const excluded = (p) => !keeps.some((r) => r.test(p)) && excludes.some((r) => r.test(p));

const isText = (buf) => !buf.subarray(0, 8000).includes(0);
const walk = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.name === 'node_modules' || e.name === '.git' || e.name === '.next') return [];
  return e.isDirectory() ? walk(p, base) : [path.relative(base, p)];
});

// ── forbidden scan ────────────────────────────────────────────────────────────
function scan(dir) {
  const res = RULES.forbidden.map((f) => new RegExp(f, 'i'));
  const hits = [];
  for (const rel of walk(dir)) {
    if (RULES.forbidden_allow_files.includes(rel)) continue;
    for (const r of res) if (r.test(rel)) hits.push(`${rel} (path) ~ ${r.source}`);
    const buf = fs.readFileSync(path.join(dir, rel));
    if (!isText(buf)) continue;
    buf.toString('utf8').split('\n').forEach((line, i) => {
      for (const r of res) if (r.test(line)) hits.push(`${rel}:${i + 1} ~ ${r.source}: ${line.trim().slice(0, 140)}`);
    });
  }
  return hits;
}

if (has('--check-only')) {
  const hits = scan(path.resolve(opt('--check-only')));
  hits.forEach((h) => console.log(h));
  console.log(hits.length ? `\n${hits.length} forbidden hit(s)` : 'clean: no forbidden strings');
  process.exit(hits.length ? 1 : 0);
}

// ── export ───────────────────────────────────────────────────────────────────
const ref = opt('--ref', 'HEAD');
const out = path.resolve(opt('--out', path.join(ROOT, '.template-out')));
const sha = execFileSync('git', ['rev-parse', ref], { cwd: ROOT, encoding: 'utf8' }).trim();
if (fs.existsSync(out)) fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const files = execFileSync('git', ['ls-tree', '-r', '--name-only', ref], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);
const replacers = RULES.replace.map((r) => ({
  re: r.regex ? new RegExp(r.from, 'g' + (r.flags ?? '')) : null, from: r.from, to: r.to,
}));
const renamed = (p) => {
  for (const [a, b] of Object.entries(RULES.rename)) if (p.startsWith(a)) return b + p.slice(a.length);
  return p;
};

// strip_blocks: drop whole SQL statements (our rows) from files that otherwise ship
function stripBlocks(rel, text) {
  const starts = (RULES.strip_blocks?.[rel] ?? []).map((s) => new RegExp(s));
  if (!starts.length) return text;
  const lines = text.split('\n'), outLines = [];
  let skipping = false, removed = 0;
  for (const line of lines) {
    if (!skipping && starts.some((r) => r.test(line))) { skipping = true; removed++; }
    if (skipping) { if (/;\s*(--.*)?$/.test(line)) skipping = false; continue; }
    outLines.push(line);
  }
  if (removed !== starts.length) throw new Error(`strip_blocks: ${rel} matched ${removed}/${starts.length} statements — rules are stale`);
  return outLines.join('\n');
}
const rewrite = (rel, s) => {
  s = stripBlocks(rel, s);
  for (const r of replacers) s = r.re ? s.replace(r.re, r.to) : s.split(r.from).join(r.to);
  return s;
};

let kept = 0, dropped = 0, changed = 0;
for (const rel of files) {
  if (excluded(rel)) { dropped++; continue; }
  let buf = execFileSync('git', ['show', `${ref}:${rel}`], { cwd: ROOT, maxBuffer: 256 << 20 });
  if (isText(buf)) {
    const before = buf.toString('utf8');
    const s = rewrite(rel, before);
    if (s !== before) changed++;
    buf = Buffer.from(s, 'utf8');
  }
  const dest = path.join(out, renamed(rel));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  const mode = execFileSync('git', ['ls-tree', ref, rel], { cwd: ROOT, encoding: 'utf8' }).slice(0, 6);
  if (mode === '100755') fs.chmodSync(dest, 0o755);
  kept++;
}

// overlay: whole-file replacements (same path renames and string rules, so names stay consistent)
const overlayDir = path.join(ROOT, RULES.overlay);
let overlaid = 0;
if (fs.existsSync(overlayDir)) for (const rel of walk(overlayDir)) {
  const dest = path.join(out, renamed(rel));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const buf = fs.readFileSync(path.join(overlayDir, rel));
  fs.writeFileSync(dest, isText(buf) ? rewrite(rel, buf.toString('utf8')) : buf);
  overlaid++;
}

for (const [rel, patch] of Object.entries(RULES.json_edits)) {
  const p = path.join(out, rel);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  Object.assign(j, patch);
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
}

for (const [cmd, ...a] of RULES.post ?? []) execFileSync(cmd, a, { cwd: out, stdio: 'ignore' });

fs.writeFileSync(path.join(out, 'TEMPLATE_SOURCE.json'), JSON.stringify({
  generated_by: 'scripts/template-export.mjs',
  source_commit: sha,
  generated_at: new Date().toISOString(),
  note: 'Generated one-way from a production site. Do not edit by hand: changes are made upstream and re-exported.',
}, null, 2) + '\n');

console.log(`exported ${sha.slice(0, 7)} -> ${out}`);
console.log(`  files: ${kept} kept (${changed} rewritten), ${dropped} excluded, ${overlaid} overlaid`);

const hits = scan(out);
if (hits.length) {
  hits.slice(0, 80).forEach((h) => console.log('  FORBIDDEN ' + h));
  console.log(`\n${hits.length} forbidden hit(s) — fix rules/overlay, re-run.`);
  process.exit(1);
}
console.log('  forbidden scan: clean');

// ── verify: the output must stand on its own ───────────────────────────────────
if (has('--verify')) {
  const nm = path.join(out, 'node_modules');
  if (!fs.existsSync(nm)) fs.symlinkSync(path.join(ROOT, 'node_modules'), nm);
  const bin = (pkg, file) => path.join(nm, pkg, file);
  const steps = [
    ['agents:port', 'node', ['scripts/port-agents.mjs']],
    ['agents:check', 'node', ['scripts/port-agents.mjs', '--check']],
    ['env manifest lint', 'node', ['scripts/secrets.mjs', 'lint']],
    ['typecheck', 'node', [bin('typescript', 'bin/tsc'), '--noEmit', '-p', '.']],
    ['unit tests', 'node', [bin('vitest', 'vitest.mjs'), 'run']],
  ];
  // --db-url <empty database on a Supabase Postgres image>: migrations + seeds from zero, then test:db
  const dbUrl = opt('--db-url');
  if (dbUrl) {
    const sql = [...fs.readdirSync(path.join(out, 'supabase/migrations')).sort().map((f) => `supabase/migrations/${f}`),
      'supabase/seed/01_required.sql', 'supabase/seed/02_defaults.sql'];
    steps.push(['migrations + seeds on a fresh DB', 'bash', ['-c',
      `set -e; for f in ${sql.join(' ')}; do psql "$DB" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done`]]);
    steps.push(['db tests', 'node', [bin('vitest', 'vitest.mjs'), 'run', '--config', 'vitest.db.config.mts']]);
  }
  let failed = 0;
  for (const [name, cmd, a] of steps) {
    const r = spawnSync(cmd, a, { cwd: out, encoding: 'utf8', env: { ...process.env, CI: '1', DB: dbUrl ?? '', DATABASE_URL: dbUrl ?? '' } });
    const ok = r.status === 0;
    if (!ok) failed++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) console.log(((r.stdout ?? '') + (r.stderr ?? '')).split('\n').slice(-25).map((l) => '        ' + l).join('\n'));
  }
  fs.unlinkSync(nm);
  process.exit(failed ? 1 : 0);
}
