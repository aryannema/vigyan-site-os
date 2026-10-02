#!/usr/bin/env node
/**
 * sql-classify.mjs — split every migration into DDL, seed DML, and data DML.
 *
 * Why this is not a grep: an INSERT inside a function or trigger body is part of
 * a CREATE FUNCTION statement, so it is DDL. `004_audit_by_construction.sql`
 * writes to action_audit_log from inside a trigger body and contains no data at
 * all; a naive grep reports it as seeded. Dollar-quoted bodies ($$ ... $$, or
 * $tag$ ... $tag$) have to be stripped before any statement is classified.
 *
 * Output tiers:
 *   ddl       schema only — nothing to move
 *   required  rows the system cannot function without (role_capabilities:
 *             empty means every role can do nothing and every admin screen refuses)
 *   defaults  starting values an admin edits later, via a screen that exists
 *   env       values that differ per deployment (Coolify / Vercel / AWS), which
 *             belong in platform config, never in a committed seed
 *   data      our own rows — company identity, products, content. Never ship.
 *   backfill  idempotent transforms that keep the schema consistent with what
 *             came before. These stay WITH their migration; they are not seeds.
 *
 * Usage:
 *   node scripts/sql-classify.mjs            # table
 *   node scripts/sql-classify.mjs --json     # machine-readable
 *   node scripts/sql-classify.mjs --emit-seed <dir>
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const MIGRATIONS = 'supabase/migrations';

/** Rows without which the application does not work at all. */
const REQUIRED = new Set(['role_capabilities', 'invoice_series', 'encryption_keys']);

/** Starting values, each reachable from an admin screen. */
const DEFAULTS = new Set([
  'app_config', 'feature_flags', 'ai_provider_config',
  'payment_gateway_config', 'social_links', 'nav_items',
]);

/**
 * Per-deployment values. These look like defaults but are not: the right value
 * depends on where the thing runs, so a committed row is wrong everywhere
 * except the machine it was written on.
 */
const ENV_SCOPED = new Set(['app_secrets']);

/** Our own rows. Never ship. */
const COMPANY = new Set([
  'company_profile', 'company_private', 'company_directors', 'company_accounts',
]);

/**
 * Strip dollar-quoted bodies so statements inside CREATE FUNCTION / DO blocks
 * are not mistaken for top-level statements. Postgres allows an arbitrary tag
 * between the dollars, and tags nest by name, so match the opening tag exactly.
 */
function stripDollarQuoted(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const open = sql.indexOf('$', i);
    if (open === -1) { out += sql.slice(i); break; }
    const tagEnd = sql.indexOf('$', open + 1);
    // A dollar not followed by a closing dollar on the same construct is just
    // a dollar (e.g. inside a string); keep it and move on.
    if (tagEnd === -1) { out += sql.slice(i); break; }
    const tag = sql.slice(open, tagEnd + 1);
    if (!/^\$[A-Za-z_]*\$$/.test(tag)) { out += sql.slice(i, open + 1); i = open + 1; continue; }
    const close = sql.indexOf(tag, tagEnd + 1);
    if (close === -1) { out += sql.slice(i); break; }
    out += sql.slice(i, open) + ' /*body*/ ';
    i = close + tag.length;
  }
  return out;
}

/** Remove line and block comments, which otherwise produce phantom statements. */
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

function classifyFile(path) {
  const raw = readFileSync(path, 'utf8');
  const body = stripComments(stripDollarQuoted(raw));

  const ddl = (body.match(/\b(CREATE|ALTER|DROP)\s+/gi) || []).length;

  // Only statement-INITIAL dml counts. Matching anywhere sees the UPDATE in
  // "GRANT SELECT, UPDATE ON t TO r" and in "AFTER INSERT OR UPDATE ON t",
  // and reports the next word ("ON", "TO") as a table name. Splitting on
  // semicolons first and anchoring to the start of each statement removes a
  // whole class of phantom tables rather than blacklisting them one by one.
  const statements = [];
  const head = /^(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:(?:public|auth)\.)?("?[a-z_][a-z0-9_]*"?)/i;
  for (const stmt of body.split(';')) {
    const s = stmt.trim().replace(/\s+/g, ' ');
    const m = head.exec(s);
    if (!m) continue;
    const verb = m[1].toUpperCase().startsWith('INSERT') ? 'insert'
               : m[1].toUpperCase().startsWith('UPDATE') ? 'update' : 'delete';
    const table = m[2].replace(/"/g, '');
    // An INSERT ... SELECT usually derives rows from what is already there, so
    // it is a backfill rather than a new fact. But `INSERT ... SELECT ... FROM
    // (VALUES ...)` is a literal seed written compactly — 003 expands the whole
    // permission matrix that way — and reads from no table at all. Distinguish
    // by what the SELECT actually draws from.
    const fromValues = /\bFROM\s*\(\s*VALUES\b/i.test(s);
    const isBackfill = verb !== 'insert' || (/\bSELECT\b/i.test(s) && !fromValues);
    statements.push({ verb, table, isBackfill });
  }

  const tiers = new Map();
  for (const s of statements) {
    let tier;
    if (COMPANY.has(s.table)) tier = 'data';
    else if (ENV_SCOPED.has(s.table)) tier = 'env';
    else if (REQUIRED.has(s.table)) tier = 'required';
    else if (DEFAULTS.has(s.table)) tier = 'defaults';
    else if (s.isBackfill) tier = 'backfill';
    else tier = 'data';
    // A backfill against a required/default table is still a backfill.
    if (s.isBackfill && (tier === 'required' || tier === 'defaults')) tier = 'backfill';
    if (!tiers.has(tier)) tiers.set(tier, new Set());
    tiers.get(tier).add(s.table);
  }

  return {
    file: basename(path),
    ddl,
    tiers: Object.fromEntries([...tiers].map(([k, v]) => [k, [...v].sort()])),
    tier: tiers.has('data') ? 'data'
        : tiers.has('env') ? 'env'
        : tiers.has('required') ? 'required'
        : tiers.has('defaults') ? 'defaults'
        : tiers.size ? 'backfill' : 'ddl',
  };
}

const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();
const results = files.map(f => classifyFile(join(MIGRATIONS, f)));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const interesting = results.filter(r => r.tier !== 'ddl');
  const w = Math.max(...interesting.map(r => r.file.length), 10);
  for (const r of interesting) {
    const detail = Object.entries(r.tiers)
      .map(([k, v]) => `${k}:${v.join(',')}`)
      .join('  ');
    console.log(`  ${r.file.padEnd(w)}  ${r.tier.padEnd(9)} ${detail}`);
  }
  const counts = results.reduce((a, r) => (a[r.tier] = (a[r.tier] || 0) + 1, a), {});
  console.log('\n  ' + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  '));
  console.log(`  total=${results.length}`);
}
