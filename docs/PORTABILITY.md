# Portability: moving off self-hosted Supabase

Assessed 2026-09-20 against the live database. Numbers are measured, not estimated.

## The short answer

**The business data is already portable. The coupling is entirely in auth.**

| | Count | Portable to RDS/Azure as-is? |
|---|---|---|
| Tables in `public` | 52 | **yes** — plain Postgres |
| Constraints, triggers, functions, views | all | **yes** |
| FKs pointing at `auth.users` | 37 | **no** — see below |
| RLS policies calling `auth.uid()` | 61 | **with a shim** — see below |
| Extensions | 7 | 4 portable, 3 Supabase-only |

Nothing in the commerce schema — products, prices, offers, orders, credits,
holds, vendor jobs, invoices — uses a single Supabase-specific feature. It is
ordinary Postgres 15 and restores into RDS with `pg_restore` unchanged.

## What actually binds us

### 1. `auth.users` — 37 foreign keys

`auth.users` belongs to GoTrue, Supabase's auth service. RDS has no such table,
so every FK to it fails on restore.

Roughly half those 37 are GoTrue's own internal tables (`sessions`,
`refresh_tokens`, `mfa_factors`, `saml_providers` …) which simply would not come
with us. The rest are ours: `orders`, `site_accounts`, `credit_ledger`,
`credit_holds`, `vendor_jobs`, `user_roles`, and so on.

**The fix is not hard, and is worth doing BEFORE it is urgent:** create our own
`public.app_users` table holding the identity we actually care about, with
`auth.users.id` as its primary key today. Point our FKs at that instead. Then
the auth provider becomes swappable — Cognito, Entra, Auth0, or self-hosted
GoTrue — because our tables reference *our* user table, not theirs.

### 2. `auth.uid()` — 61 RLS policies

Every policy is written as `USING (user_id = auth.uid())` or
`user_has_capability(auth.uid(), …)`. `auth.uid()` is a Supabase function that
reads a JWT claim from the session.

**This one is a ten-line shim, not a rewrite.** On any Postgres:

```sql
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$ LANGUAGE sql STABLE;
```

The application sets that session variable after verifying the JWT itself. All
61 policies then work unchanged, wherever the database runs. This is the single
highest-leverage portability step and it changes no policy text at all.

### 3. Extensions

| Extension | On RDS? |
|---|---|
| `uuid-ossp`, `pgcrypto`, `pg_stat_statements` | yes |
| `pg_net` | no — used for outbound HTTP from the DB. Move that to app code. |
| `pgjwt`, `supabase_vault`, `pg_graphql` | no — Supabase-only |

We do not currently depend on `pgjwt`, `supabase_vault` or `pg_graphql` in any
of our own code. `pg_net` should be checked before a move.

### 4. Services that are not the database

- **Auth (GoTrue)** → Cognito, or run GoTrue on ECS. The bigger question is the
  user table above, not the service.
- **Storage** → already on **Cloudflare R2**, which speaks the S3 API. Moving to
  S3 is a config change: endpoint and credentials. No code change.
- **Realtime** → not used by this app.
- **PostgREST** → we use `supabase-js` against it. This is the largest
  application-side dependency and would need replacing with a Postgres client or
  an API layer.

## Cost, honestly

Self-hosting on Hostinger was chosen deliberately (`OPS.md` §5) and costs roughly
₹63,000–90,000 over two years against ~₹132,000 for managed Vercel+Supabase.
Managed AWS will be **more expensive than either** at current scale — RDS alone,
sized sensibly with backups and Multi-AZ, exceeds the entire present bill.

So the reason to move is **not cost**. It is scale, compliance, or an enterprise
customer who requires it. Moving before one of those is real trades a working,
cheap stack for a dearer one.

## On AWS Activate credits

AWS Activate does offer startup credits, and applying costs little. Two honest
cautions:

- **Credits are a discount on a bill, not a free tier.** They expire, typically
  within a year or two. Architecting for AWS because credits are available means
  inheriting the full bill when they run out — at which point moving back is far
  harder than not moving was.
- **The credit is worth most when spent on something that would otherwise be
  hard to afford** — GPU inference, for instance — rather than on replacing a
  database that already works for ₹3,000/month.

Applying is sensible. Migrating *because* of the credit is not.

## The two things to do now, while they are cheap

1. **`public.app_users`**, with our FKs pointing at it rather than `auth.users`.
   Cheap today with almost no rows; expensive once there is real customer data.
2. **Keep `auth.uid()` as the only Supabase function in policy text.** It is
   already the case, and it is what makes the shim above sufficient. Do not
   introduce `auth.jwt()`, `auth.role()` or storage functions into policies.

Everything else can wait for an actual reason to move.
