---
name: feature-schema
description: Use when a new feature needs a table, column or capability — evolving the schema so the new thing joins the permission, audit and RLS contract instead of sitting outside it. Covers the DDL/DML split, the resource/capability wiring, and the self-verifying migration.
---

# Adding a feature to the schema

The schema here is not a set of tables. It is a **contract**: every resource has a key, every
key has capabilities, every write is authorized and audited in the same atomic step, and every
table is reachable only through a policy. A new table that does not join that contract is not
"a table without permissions yet" — it is a hole, and it will be found by someone who is not
you.

This skill exists because joining the contract is mechanical, easy to half-do, and invisible
when you get it wrong. A table with RLS enabled and no policy silently returns zero rows. A
table with a policy and no `resource_key` cannot be granted to anyone. Both look fine until
they do not.

## Before writing anything

```bash
node scripts/sql-classify.mjs        # what tier does each migration sit in
ls supabase/migrations | tail -3     # the next number is the last + 1
```

Migrations are **append-only and applied by hand, in order**. Never edit an applied one — it
already ran, so editing it changes nothing on any existing database and diverges you from
every deployment that has it. If something is wrong, the fix is the next number.

## The seven things a new table owes

Work through these in order. Each one is a question with a wrong answer that compiles.

**1. Does it need to be a table at all?** A setting is `app_config`. A secret is `app_secrets`
(encrypted). A flag is `feature_flags`. Reach for a new table when you have rows that belong to
someone and change over time.

**2. What is its resource key?** One short noun — `blog`, `crm`, `payments`. Add it to
`RESOURCE_KEYS` in `src/types/schema.ts` in the same change, or the admin capability grid has
a resource nobody can grant.

**3. Which capabilities apply?** `view` / `create` / `edit` / `delete`, plus `publish` when
there is a published state. **`view` is a floor** — migration 075 made an acting capability
require the view it depends on, so granting `create` without `view` now grants nothing. Seed
grants for every existing role, including the ones that should get nothing: an absent row and
an explicit `allowed=false` read differently to an operator looking at the grid.

**4. RLS: enable it AND write policies.** Enabling without a policy denies everything;
Postgres will not warn you. Write `USING` for reads and `WITH CHECK` for writes — a `USING`-only
policy lets a caller write a row they then cannot see.

**5. Route writes through `perform_action()`.** It authorizes and audits atomically, so no
write path can produce a permission decision without also producing an audit row. A direct
`INSERT` from application code bypasses both.

**6. Split DDL from DML.** The migration carries schema and any idempotent backfill it needs.
Rows that make the system work go to `seed/01_required.sql`; starting values an admin will edit
go to `seed/02_defaults.sql`. **Company, product or content data goes in neither** — it comes
from the admin UI or the `site-bootstrap` skill. Run `node scripts/sql-classify.mjs` afterwards
and confirm your migration lands in the tier you intended.

**7. Verify inside the migration.** End with a `DO $verify$` block that asserts the thing you
just claimed, and `RAISE EXCEPTION` if it is not true. Migration 075 checks that its own
disclosure fix holds and that the private lookup is not reachable by `authenticated`. A
migration that cannot fail at apply time is a migration you will trust for the wrong reasons.

## The header is the deliverable

Every migration here opens by explaining **the finding it closes**, not what it does — the SQL
already says what it does. Read `007_publish_capability_enforcement.sql` for the shape. If you
cannot articulate what was wrong before, the migration is not ready; you are guessing at a
design rather than closing a gap.

Include what you checked and chose not to change. `075` records that every seeded role holding
`crm:create` also holds `crm:view`, which is the fact that made a breaking change safe. Without
it the next person has to rediscover it before they dare touch the policy.

## Apply and prove

```bash
# never against production first
createdb scratch_test
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -d scratch_test -f "$f"; done
pnpm test:db          # permissions, RLS, PII
pnpm gen:e2e          # the permission-matrix invariants regenerate from the DB
```

`pnpm test:db` is not optional after a schema change. It is the only thing standing between a
policy typo and a table that quietly returns everything to everyone.

## Then hand off

A schema change is not finished when it applies. It is finished when:

- `pnpm test:db` is green **and** you added a case that fails without your change
- the feature has a screen, or the migration is queued in `public_template_sync` as
  ship-when-UI-exists
- `docs/PUBLIC_TEMPLATE.md` says whether this crosses to the public template
- `work-units/session-state.json` records it

Then use **`feature-testing`** to cover the surface you built on top.

## Do not

- Edit an applied migration.
- Enable RLS without writing a policy in the same migration.
- Grant an acting capability without `view`.
- Seed company, product or content rows into a migration.
- Write to a table from application code without going through `perform_action()`.
- Assume a policy works because the happy path works — the interesting case is the role that
  should be refused.
