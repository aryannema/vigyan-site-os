# Setting up your machine

Written for someone who has not done this before. Every tool solves one specific
problem, and the problem is named so you can decide whether you need it.

---

## Node — required

### pnpm, not npm — and no nvm

```bash
corepack enable      # ships inside Node 16.9+; nothing to install
pnpm install
pnpm dev             # http://localhost:3000
```

`corepack` reads `packageManager` in `package.json` and activates exactly that
pnpm version. **That is why nvm is unnecessary**: the version is pinned in the
repository, not in your shell profile, so everyone on the project gets the same
one without agreeing to.

Node **20 LTS or 22**. Next.js 15 requires 18.18+, and 20 is where the ecosystem
actually is.

### Why not npm

Not preference — it prevents a class of bug.

npm installs a **flat** `node_modules`: every transitive dependency is hoisted to
the top level, so a package can `import` something it never declared and it
works. Until the hoisting order changes on someone else's machine, or after a
lockfile update, and then it does not. These are **phantom dependencies**, and
they fail somewhere other than where they were introduced.

pnpm builds a nested, symlinked tree where a package can reach only what it
declared. The undeclared import fails immediately, on the machine that added it.

### The content-addressable store (CAS)

pnpm keeps **one copy of every package version** in a global store and
**hard-links** it into each project instead of copying.

```bash
pnpm store path      # where it lives
pnpm store prune     # remove versions nothing references
```

| | |
|---|---|
| Ten projects on the same Next.js version | one copy on disk, not ten |
| Reinstalling a version you have seen | a hard link, not a download — works offline |
| This project's `node_modules` | ~400 MB apparent, nearly all links |

Because they are **hard links, never edit a file inside `node_modules`** — you
would be editing the store, and therefore every project on the machine. Use
`pnpm patch` when you genuinely must change a dependency.

#### Environment variables

| variable | what it does | when |
|---|---|---|
| `PNPM_HOME` | where the pnpm binary and global packages live | set by `pnpm setup`; must be on `PATH` |
| `PNPM_STORE_PATH` | moves the CAS | small system SSD, large data disk |
| `COREPACK_ENABLE_STRICT=0` | stops corepack refusing a mismatched pnpm | rarely, and prefer fixing the mismatch |

```bash
pnpm setup                                    # writes PNPM_HOME to your profile
export PNPM_STORE_PATH=/mnt/data/pnpm-store   # optional
```

**The store must be on the same filesystem as your projects.** Hard links cannot
cross filesystems, so pnpm silently falls back to copying — you lose the whole
disk saving and nothing warns you. Check with `df` if `node_modules` looks
suspiciously large.

---

## PostgreSQL — required

Not incidental storage. The permission model **is** the database:
`user_has_capability()` and `perform_action()` are SQL functions, and
column-level rules are enforced by trigger. Point this at MySQL and there is no
product.

Three ways to get one:

```bash
# 1. Docker — simplest for local work
docker run -d --name siteos-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=localdev -e POSTGRES_DB=siteos postgres:16

# 2. Supabase local — if you want the whole stack
npx supabase start

# 3. Native install
sudo apt install postgresql-16        # or: brew install postgresql@16
```

Postgres **14 or newer**. The migrations use `gen_random_uuid()` from `pgcrypto`
and generated columns.

```bash
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
```

---

## Environment file

```bash
cp .env.example .env.local
```

| variable | breaks without it |
|---|---|
| `DATABASE_URL` | everything |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client data reads |
| `SUPABASE_SERVICE_ROLE_KEY` | privileged server paths |
| `MCP_SECRET_KEY`, `MCP_SERVICE_ACTOR` | the agent endpoint |
| `ADMIN_ACTOR`, `BOOTSTRAP_ADMIN_EMAILS` | first-admin bootstrap |

> [!WARNING]
> **`NEXT_PUBLIC_` is compiled into the browser bundle.** Putting a service-role
> key behind that prefix publishes it to every visitor. It is also inlined at
> **build** time, so setting one only at runtime gives `undefined` in the
> browser with no error.

`.env.local` is gitignored. Keep it that way. If a key is ever committed, rotate
it — deleting the commit does not make it safe.

---

## Applying the schema

```bash
for f in supabase/migrations/*.sql; do
  echo "-- $f"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

**In order, 000 through 010.** Later files depend on functions earlier ones
create; running them out of order fails in ways that look like a broken schema
rather than a sequencing mistake. See [docs/MIGRATIONS.md](docs/MIGRATIONS.md)
and [docs/DDL_DML.md](docs/DDL_DML.md).

---

## Verify

```bash
pnpm install
pnpm build          # the memory peak — see HOSTING.md for sizing
pnpm test           # vitest
pnpm dev
```

Then `http://localhost:3000`. Admin routes currently have **no auth** — see
[BLOCKERS.md](BLOCKERS.md).

---

## Optional

```bash
pnpm dlx shadcn@latest add dialog toast form   # more UI primitives
```

`psql` is worth having natively even if Postgres runs in Docker — the permission
model is best understood by querying it directly.
