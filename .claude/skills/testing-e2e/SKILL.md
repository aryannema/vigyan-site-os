---
name: testing-e2e
description: Use when testing that the pieces are actually CONNECTED — API routes against a real server and database, auth flows, capability enforcement end to end. Covers standing up throwaway Postgres, the Supabase roles plain Postgres lacks, and the bash traps that make a suite silently stop testing. For browser and visual testing load testing-browser instead.
---

# End-to-end testing

Unit tests check pieces. End-to-end tests check that the pieces are **wired
together** — and that is a different class of bug. A unit test cannot tell you
the route forgot to `await` the verifier, or that the capability check never
reaches Postgres.

`tests/e2e/mcp.sh` is the worked example: 24 assertions against a running server
and a real database.

## Standing up a throwaway database

```bash
docker run -d --name e2e-pg -p 55433:5432 \
  -e POSTGRES_PASSWORD=e2elocal -e POSTGRES_DB=siteos postgres:16-alpine

export DATABASE_URL='postgresql://postgres:e2elocal@127.0.0.1:55433/siteos'
psql "$DATABASE_URL" -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'
```

**Port 55433, not 5432.** A local Postgres or another container is usually
already on 5432, and the failure — connecting to the wrong database and applying
migrations to it — is worse than a refused connection.

### The migrations assume Supabase roles exist

This bites every first-time user on plain Postgres. Migration `000` fails with:

```
ERROR:  role "anon" does not exist
```

The schema grants to `anon`, `authenticated` and `service_role`, which Supabase
creates and plain Postgres does not:

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')
    THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated')
    THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')
    THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
```

Then apply migrations **in order**, stopping at the first failure:

```bash
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

Without `ON_ERROR_STOP=1`, psql continues past a failure and leaves a
half-applied schema that is far harder to diagnose than a clean stop.

## Seed the identities the test needs

Capability tests need at least two users with **different** roles — one that may
do the thing and one that may not. A suite that only tests the allowed path
proves nothing about enforcement.

```sql
INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'editor@example.com');
INSERT INTO public.user_roles (user_id, role)
  SELECT id, 'editor' FROM auth.users WHERE email='editor@example.com';
-- and a viewer, who may view but not create
```

Confirm the model agrees before testing through HTTP — if this is wrong, every
HTTP assertion is testing the wrong thing:

```sql
SELECT public.user_has_capability('<uuid>','blog','create');
```

## Four bash traps that make a suite lie

Each of these was hit writing `tests/e2e/mcp.sh`, and each makes a suite report
success while testing less than you think.

### 1. `$(...)` is a subshell — variables set inside never escape

```bash
rpc() { ...; RPC_CODE="$code"; printf '%s' "$body"; }
body=$(rpc ...)          # RPC_CODE is set in the SUBSHELL
check "..." "200" "$RPC_CODE"   # reads the PREVIOUS call's value
```

This passed three checks against a stale status before it was noticed. Pass the
status out through a file, or return it in the body.

### 2. `grep -c` exits 1 when the count is zero

With `set -o pipefail` that aborts the run, and every test after it silently
never executes.

```bash
n=$(curl -sD- ... | grep -ci 'cache-control' || true)   # the count IS the answer
```

### 3. Never use `set -e` in a test script

A failing assertion must **record a failure and continue**. With `set -e` the
first failure aborts and hides every test after it — so you fix one thing, rerun,
and discover another, one at a time.

### 4. A silent skip proves nothing

```bash
if [ -z "${DATABASE_URL:-}" ]; then
  echo "  [skip] DATABASE_URL unset — capability checks NOT run"
  echo "         These are the most valuable assertions here."
fi
```

Say loudly what was skipped and why it mattered. A suite reporting "24 passed"
while quietly skipping the only tests that mattered is worse than no suite.

## What to assert

Work outward from the credential:

| | |
|---|---|
| **no credential** | rejected — before anything is parsed |
| **wrong credential** | rejected |
| **valid credential** | accepted, and the response has the expected shape |
| **wrong kind** of valid credential | rejected (a refresh token must not call tools) |
| **allowed identity** | the write lands **and is audited** |
| **denied identity** | refused, **and nothing was written** |

That last pair is the whole point. Checking the error message without checking
the table leaves open that the write happened anyway.

## Cleaning up

```bash
docker rm -f e2e-pg
```

Use a unique slug per run (`e2e-$(date +%s)`) so a re-run does not collide with
its own leftovers, and so a failed run leaves evidence you can inspect.
