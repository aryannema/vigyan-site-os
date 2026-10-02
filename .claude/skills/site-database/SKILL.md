---
name: site-database
description: Use when writing or applying a migration in site-os, adding a table or column, storing files, or when a migration fails with "must be owner of table" — covers the apply procedure, the postgres-ownership rule, money/rate units, and where files belong.
---

# Database and migrations

Postgres, self-hosted Supabase on your-vps, under Coolify.

## Applying a migration

**There is no migration runner.** Migrations are applied by hand, in order, and
nothing records that they were. Check first, never assume:

```sql
SELECT to_regclass('public.<a table it creates>') IS NOT NULL;
```

```bash
./scripts/coolify-tunnel.sh          # if not already up
scp supabase/migrations/0NN_x.sql your-vps:/tmp/
ssh your-vps "sudo docker cp /tmp/0NN_x.sql supabase-db-<service-uuid>:/tmp/ \
  && sudo docker exec supabase-db-<service-uuid> \
     psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction -f /tmp/0NN_x.sql"
```

`ON_ERROR_STOP=1 --single-transaction` is not optional. Without it psql
continues past an error and leaves the migration half-applied — worse than a
clean failure.

**Applying to production touches live data. Ask first** unless the operator has
already said to apply it.

## `must be owner of table` — do not switch roles

Every table in `public` is owned by **`postgres`**. If a migration fails with
`must be owner of table X`, something created X as another role. Fix the owner:

```sql
ALTER TABLE public.X OWNER TO postgres;
```

Do **not** reach for `-U supabase_admin` to get past it. That makes the one
migration work and deepens the split, so the next one fails somewhere else.
This exact situation happened on 2026-09-16 (migration 033); migration 034
normalised all 29 tables. Ownership decides **only who may run DDL** — not RLS,
policies, grants, or application behaviour. `supabase_admin` legitimately owns
the internal schemas (`auth`, `storage`, `realtime`).

Invariant, should return nothing:

```sql
SELECT tablename, tableowner FROM pg_tables
 WHERE schemaname = 'public' AND tableowner <> 'postgres';
```

## Units: no float ever touches money

- **Money in paise.** `price_paise`, `amount_paise`, `tax_base_paise`.
- **Rates in basis points.** `gst_rate_bp`, `discount_bp`. 1800 = 18%.
- Round the *component* and subtract, never round the result — so the parts
  always re-add to the total exactly. `src/lib/gst.ts` and `src/lib/pricing.ts`
  both have property tests asserting that.

## Where files go

| What | Where | Ceiling |
|---|---|---|
| Invoice PDFs | `invoice_archive` | ~4 KB each |
| Guides, blueprints, prompt libraries | `product_assets` | **25 MB**, CHECK-enforced |
| Installers, video, anything large | **not the database** | GitHub release or external URL |

Postgres over object storage for small durable files: it is already in the
backup, it moves with the database, and there is no split-brain between a row
and a bucket. Cloudflare R2 is **not enabled** on the account (checked
2026-09-16). The CHECK is what makes the boundary loud instead of a judgement
call.

## Conventions

- **`CHECK` the invariant, and mirror it in the server action.** The constraint
  is the guarantee; the mirror is so the admin sees a message on the field
  rather than a database error they cannot act on.
- **Open-ended things get a kind + jsonb config**, not a column per case.
  `products.fulfilment_kind` + `fulfilment_config`: a new delivery method is a
  new kind and a handler, not a migration.
- **Append-only where a record must not change.** `invoice_archive` has a
  trigger refusing `UPDATE` — correcting an invoice is a credit note, not an
  edit.
- **Admin writes go through `mutate()`** (`admin/lib/db.ts`), which runs the
  change and `perform_action()` in one transaction, so the capability check and
  the audit row cannot come apart.
- **RLS on every table.** Service-role-only tables get
  `REVOKE ALL ... FROM anon, authenticated` and no policy. Remember
  `public.app_config` grants SELECT to `anon` — never put a secret there.

## Verifying, not trusting

`tsc` cannot see inside a SQL string. A placeholder with no parameter compiles
and fails at runtime — this has already happened twice here. After editing a
parameterised statement, count them:

```bash
# highest $n in the SQL must equal the number of params passed
```

Then run `pnpm build && pnpm test && pnpm env:check`.

## Related

- `docs/OPS.md` §3 (which store holds which value) and §3.5 (this, in full).
- `[[site-mcp]]` — the MCP write path for content and products.
