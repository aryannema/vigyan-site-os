# DDL and DML — why they are different, and where this repo mixes them

**DDL** defines shape: tables, columns, functions, triggers, policies.
**DML** moves data: `INSERT`, `UPDATE`, `DELETE` of actual rows.

They need different handling, and a migration that mixes them is a migration you
cannot reason about. This explains the distinction, audits where this repository
currently mixes them, and says what to do about it.

---

## Why the distinction matters

| | DDL | DML |
|---|---|---|
| Safe to re-run? | yes, written idempotently (`IF NOT EXISTS`, `CREATE OR REPLACE`) | **no** — re-running duplicates or overwrites |
| Same on every environment? | **yes** — dev, staging and prod must have identical shape | no — prod has real customers, dev has fixtures |
| Safe in a template repo? | yes | **often not** — see below |
| Reviewable how? | diff the schema | diff the *rows*, which nobody does |

The expensive consequence: **if seed data lives in the same file as schema, you
cannot re-run the schema.** Someone eventually needs to re-apply a migration on a
fresh environment, hits a duplicate-key error on the seed rows, and either edits
a committed migration — which desynchronises everyone — or gives up.

---

## Four tiers, not two

"DDL vs DML" is too coarse in practice. Sort every statement into one of these:

**1. DDL** — shape. Tables, columns, indexes, functions, triggers, RLS policies.
Idempotent. Identical everywhere.

**2. Required reference data** — rows the *code* depends on. Capability names,
role definitions, enum-like lookup tables. Without them the application is
broken, not empty. Technically DML; must ship with the schema; must be written
as an upsert so re-running is safe.

**3. Defaults** — rows a *new deployment* wants but that a real site will
replace. Placeholder page sections, a default AI provider choice. Ships with the
template; must never overwrite what an operator has changed.

**4. Actual data** — posts, enquiries, customers. **Never in a migration.** It
belongs to the environment, not the repository.

Tier 2 is the one people get wrong, usually by putting it in tier 4's box (so a
fresh install is broken) or tier 1's (so it cannot be re-run).

---

## Where this repository mixes them

An honest audit of `supabase/migrations/` as it stands:

| migration | DDL | `INSERT` | verdict |
|---|---|---|---|
| `000_local_auth_stub` | 7 | 0 | clean |
| `001_base_schema` | 32 | 0 | clean |
| `002_admin_auth` | 4 | 0 | clean |
| `003_role_expansion` | 108 | 1 | **mixed** — tier 2 |
| `004_audit_by_construction` | 9 | 1 | mixed |
| `005_contact_pii_masking` | 8 | 1 | mixed |
| `006_session_identity` | 7 | 1 | **not mixed** — see below |
| `007_publish_capability_enforcement` | 10 | 1 | mixed |
| `008_perform_action_integrity` | 2 | 1 | mixed |
| `009_ai_provider_config` | 2 | 1 | **mixed** — tier 3 |
| `010_capability_disclosure` | 5 | 0 | clean |

### An `INSERT` inside a function body is DDL

`006_session_identity.sql:124` contains `INSERT INTO auth.session_identity`, and
it is **not** DML. It sits inside a `$$ ... $$` function body — it is part of the
function's *definition*, stored as text, executed later at runtime. Creating the
function inserts nothing.

So the test is not "does the file contain the word INSERT". It is **"does
applying this file write a row?"** Statements inside `CREATE FUNCTION` bodies,
trigger bodies and `DO` blocks that only define things are DDL.

`003:256` and `009:59` are at the top level. Applying those files *does* write
rows. Those are real DML.

### What the two real cases are

**`003_role_expansion`** seeds `role_capabilities` — which roles may do what.
This is **tier 2, required reference data**. The authorization model is empty
without it: every capability check returns false and nobody can do anything. It
must ship, and it must be an upsert.

**`009_ai_provider_config`** seeds a default provider and model. This is **tier
3, a default**. A real deployment will choose its own, and re-running the
migration must not silently revert that choice.

---

## How to keep them separate

### Naming

```
supabase/migrations/            DDL only — safe to re-run, identical everywhere
  001_base_schema.sql
supabase/seed/
  required/010_role_capabilities.sql    tier 2 — upserts, must ship
  defaults/010_ai_provider.sql          tier 3 — INSERT ... ON CONFLICT DO NOTHING
```

### Write tier 2 as an upsert

```sql
INSERT INTO public.role_capabilities (role, resource_key, action, allowed)
VALUES ('editor', 'blog', 'edit', true)
ON CONFLICT (role, resource_key, action)
DO UPDATE SET allowed = EXCLUDED.allowed;
```

Re-running converges on the intended state. That is what makes it safe.

### Write tier 3 so it never overwrites

```sql
INSERT INTO public.ai_provider_config (capability, provider, model)
VALUES ('writing', 'example', 'example-model')
ON CONFLICT (capability) DO NOTHING;    -- an operator's choice survives
```

`DO NOTHING`, not `DO UPDATE`. The difference is whether re-running the migration
silently reverts a production setting.

### Never put tier 4 in the repository

Posts, enquiries, customers, uploaded media. If a template ships with demo
content, ship it as a **separate optional script** an operator runs deliberately
— not as a migration that runs automatically and then has to be deleted from
production.

---

## Order still matters

Migrations here are numbered and **must be applied in order**. Later files
depend on functions earlier ones create — `007` enforces publish capability
using machinery from `003`. Out of order, you get errors that look like a broken
schema rather than a sequencing mistake.

```bash
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

`ON_ERROR_STOP=1` matters. Without it `psql` continues past a failure and leaves
a half-applied schema that is harder to diagnose than a clean stop.

---

## Before writing a migration

- [ ] Does applying this file **write a row**? If yes, it contains DML
- [ ] If it does, which tier — required, default, or actual data?
- [ ] Tier 2 written as an upsert that converges?
- [ ] Tier 3 written as `DO NOTHING` so it cannot revert an operator's choice?
- [ ] Tier 4 — move it out of the repository entirely
- [ ] Is the DDL idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`)?
- [ ] Applied against a **fresh** database, not only the one you developed on?

That last one catches most of it. A migration that only works against your
current database is not a migration.

See also [MIGRATIONS.md](MIGRATIONS.md) and the `database` skill.
