# Tests

```bash
pnpm test                      # vitest — 5 suites, no server needed
bash tests/e2e/mcp.sh          # 24 assertions against a running server + database
```

## What runs where

| | what it proves | needs |
|---|---|---|
| `mcp-auth.test.ts` | token verification, both type-confusion directions | nothing |
| `permission-matrix.test.ts` | every role × resource × action | database |
| `perform-action.test.ts` | the write path and its audit guarantee | database |
| `pii-masking.test.ts` | masking holds below the UI | database |
| `adversarial-findings.test.ts` | regressions for attempted bypasses | database |
| `e2e/mcp.sh` | the pieces are actually **connected** | server + database |

`adversarial-findings.test.ts` is the interesting one: each test is a way
someone tried to reach around the permission model, kept so it cannot come back.

## Running the end-to-end suite

Unit tests check pieces; this checks they are wired together. A unit test cannot
tell you the route forgot to `await` the verifier.

### 1. A throwaway database

```bash
docker run -d --name e2e-pg -p 55433:5432 \
  -e POSTGRES_PASSWORD=e2elocal -e POSTGRES_DB=siteos postgres:16-alpine

export DATABASE_URL='postgresql://postgres:e2elocal@127.0.0.1:55433/siteos'
export PGPASSWORD=e2elocal
psql "$DATABASE_URL" -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'
```

Port **55433** on purpose. Something is usually already on 5432, and applying
migrations to the wrong database is worse than a refused connection.

### 2. The Supabase roles plain Postgres lacks

Migration `000` fails on a stock Postgres with `role "anon" does not exist`. The
schema grants to three roles Supabase creates for you:

```bash
psql "$DATABASE_URL" <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')
    THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated')
    THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')
    THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
SQL
```

### 3. Migrations, in order

```bash
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

`ON_ERROR_STOP=1` matters — without it psql continues past a failure and leaves a
half-applied schema that is harder to diagnose than a clean stop.

### 4. Two identities with different roles

A suite that only tests the allowed path proves nothing about enforcement.

```bash
psql "$DATABASE_URL" <<'SQL'
INSERT INTO auth.users (id,email) VALUES (gen_random_uuid(),'editor@example.com')
  ON CONFLICT DO NOTHING;
INSERT INTO auth.users (id,email) VALUES (gen_random_uuid(),'viewer@example.com')
  ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id,role)
  SELECT id,'editor' FROM auth.users WHERE email='editor@example.com'
  ON CONFLICT (user_id) DO UPDATE SET role='editor';
INSERT INTO public.user_roles (user_id,role)
  SELECT id,'viewer' FROM auth.users WHERE email='viewer@example.com'
  ON CONFLICT (user_id) DO UPDATE SET role='viewer';
SQL
```

### 5. Run it

```bash
cat > .env.e2e <<'EOF'
DATABASE_URL=postgresql://postgres:e2elocal@127.0.0.1:55433/siteos
MCP_SECRET_KEY=e2e-shared-secret-for-local-testing-only
MCP_SERVICE_ACTOR=editor@example.com
MCP_JWT_SECRET=e2e-jwt-secret-at-least-thirty-two-chars-long
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=local-anon-key
SUPABASE_SERVICE_ROLE_KEY=local-service-key
EOF

set -a && . ./.env.e2e && set +a
pnpm build && pnpm start -p 3111 &

export VIEWER_TOKEN=$(pnpm -s mcp:token --access-only viewer@example.com)
REPO=$PWD BASE=http://127.0.0.1:3111 bash tests/e2e/mcp.sh
```

`.env.e2e` is gitignored. These are throwaway local values — **never reuse them
anywhere real.**

Expected: `24 passed, 0 failed`.

## What the end-to-end suite asserts

**Authentication** — no credential rejected, wrong credential rejected, shared
secret accepted, `initialize` returns a protocol version.

**JWT** — a pair is issued, the access token authenticates, and **the refresh
token cannot call tools**. That last one is why the `typ` claim exists: both
tokens are signed with the same key, by the same issuer, for the same audience,
carrying the same scopes, and only `typ` and expiry differ.

**Refresh** — exchange works, the new token works, an **access token is refused**
at the refresh endpoint, and the response is `no-store`.

**Transport** — `GET` declines the optional stream with `Allow: POST`, `GET`
without a credential is 401, `DELETE` is 204, and `OPTIONS` does **not** reflect
an origin.

**Tools** — `tools/list` returns the tool set; an unknown tool is a JSON-RPC
error, not a crash.

**Capability enforcement** — the part that matters most, and the part a unit test
cannot reach:

```
editor → post created, audited, audit names the JWT subject
viewer → "not permitted to create on blog", nothing written
```

Same endpoint, same tool, two JWT subjects. The decision is made by **Postgres**,
not by the route.

## Two things worth knowing

**Two audit rows per write is correct.** `perform_action()` records the
authorized action (`actor_claim` set), and a trigger records the row change
independently (`actor_claim` null). The trigger fires even if a future code path
forgets `perform_action` — that is what "audit by construction" means.

**`action_audit_log.target_id` is `text`, not `uuid`**, so one audit table can
reference any table. Joining it to a uuid primary key needs an explicit cast, or
psql fails with `operator does not exist: uuid = text`.

## Not covered yet

**Browser testing.** No Puppeteer or Playwright dependency, and no functional,
accessibility, contrast, responsive or visual tests exist. The `testing-browser`
skill describes how to add them — including asserting brand by **shape** rather
than by hex value, so the tests survive a rebrand — but the code is not written.

**Admin UI flows.** `/admin/*` has no auth layer (see [BLOCKERS.md](../BLOCKERS.md)),
so there is no login to test through yet.

## Cleaning up

```bash
docker rm -f e2e-pg
```

Each run uses a unique slug (`e2e-$(date +%s)`) so a re-run does not collide with
its own leftovers, and a failed run leaves evidence to inspect.
