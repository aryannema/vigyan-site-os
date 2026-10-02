#!/usr/bin/env node
/**
 * Generate a Mermaid ER diagram from the LIVE schema.
 *
 * Hand-drawn diagrams are wrong the moment a migration lands. This reads
 * information_schema over ssh+docker, so it cannot disagree with the database.
 *
 *   node scripts/erd.mjs > docs/ERD.md
 */
import { execFileSync } from 'node:child_process';

const psql = (sql) =>
  execFileSync('ssh', ['-o', 'ConnectTimeout=20', 'your-vps',
    `sudo docker exec supabase-db-<service-uuid> psql -U postgres -d postgres -t -A -F'|' -c "${sql.replace(/\n/g, ' ').replace(/"/g, '\\"')}"`,
  ], { encoding: 'utf-8' }).trim().split('\n').filter(Boolean).map((l) => l.split('|'));

const fks = psql(`
  SELECT tc.table_name, kcu.column_name, ccu.table_name, rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
  JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  ORDER BY 1, 2`);

const cols = psql(`
  SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position`);

// One diagram per domain: 41 tables in a single graph is unreadable, and the
// clusters barely reference each other anyway.
const DOMAINS = {
  Commerce: ['products', 'product_prices', 'product_offers', 'orders', 'invoice_archive',
             'product_assets', 'product_bundle_items', 'user_entitlements'],
  Campaigns: ['link_shortener', 'link_clicks', 'products', 'orders'],
  WhatsApp: ['whatsapp_conversations', 'whatsapp_messages', 'whatsapp_consent_log',
             'whatsapp_otp_challenges', 'site_accounts'],
  Company: ['company_profile', 'company_private', 'company_directors', 'company_accounts'],
  Access: ['user_roles', 'role_capabilities', 'site_accounts', 'admin_users', 'action_audit_log'],
};

const TYPE = { 'timestamp with time zone': 'timestamptz', 'character varying': 'varchar',
               'double precision': 'float8', 'ARRAY': 'array', 'USER-DEFINED': 'enum' };

const out = [];
out.push('# Entity relationships');
out.push('');
out.push('**Generated from the live database** by `node scripts/erd.mjs` — not hand-drawn, so it');
out.push('cannot drift from the schema. Re-run it after any migration.');
out.push('');
out.push(`Last generated against ${fks.length} foreign keys across ${new Set(cols.map((c) => c[0])).size} tables.`);
out.push('');
out.push('> Delete rules are shown on each relationship because they are the design:');
out.push('> `RESTRICT` means the parent cannot be deleted while children exist, `CASCADE`');
out.push('> means children go with it, `SET NULL` means children survive orphaned.');
out.push('');

for (const [domain, tables] of Object.entries(DOMAINS)) {
  const present = tables.filter((t) => cols.some((c) => c[0] === t));
  if (!present.length) continue;

  out.push(`## ${domain}`);
  out.push('');
  out.push('```mermaid');
  out.push('erDiagram');

  for (const t of present) {
    const tc = cols.filter((c) => c[0] === t);
    if (!tc.length) continue;
    out.push(`  ${t} {`);
    for (const [, col, type, nullable] of tc) {
      const fk = fks.find((f) => f[0] === t && f[1] === col);
      const key = col === 'id' ? 'PK' : fk ? 'FK' : '';
      const note = nullable === 'YES' ? '"nullable"' : '';
      out.push(`    ${TYPE[type] ?? type} ${col} ${key} ${note}`.trimEnd());
    }
    out.push('  }');
  }

  for (const [child, col, parent, rule] of fks) {
    if (!present.includes(child) || !present.includes(parent)) continue;
    // ||--o{ : one parent, zero-or-more children.
    out.push(`  ${parent} ||--o{ ${child} : "${col} ${rule}"`);
  }
  out.push('```');
  out.push('');
}

console.log(out.join('\n'));
