# Requirements

What this needs to run, and why each requirement exists.

## Versions

| | version | why |
|---|---|---|
| **Node** | 20 LTS or 22 | Next.js 15 needs 18.18+; 20 is where the ecosystem is |
| **pnpm** | 10.x | pinned by `packageManager`; `corepack enable` activates it |
| **PostgreSQL** | 14+ | `gen_random_uuid()` via `pgcrypto`, generated columns |
| **TypeScript** | 5.x | bundled |

Do **not** use npm or yarn. The lockfile is pnpm's, and npm's flat
`node_modules` permits phantom dependencies this project does not tolerate —
[ENVIRONMENT.md](ENVIRONMENT.md) explains the failure mode.

## Development machine

| | minimum | comfortable |
|---|---|---|
| RAM | 4 GB | **8 GB** |
| Disk | 5 GB | 10 GB |
| CPU | 2 cores | 4 |

`next build` is the memory peak, not serving. On 4 GB, close the browser first.

## Server

| | |
|---|---|
| RAM | 2 GB works; **4 GB** comfortable |
| vCPU | 2 |
| Disk | 20 GB + database |
| Runtime | **Node 20+ running continuously** |

**Static hosting cannot run this.** App Router with React Server Components
renders per request, and `/api/mcp` plus the admin routes are server code. GitHub
Pages, S3-as-website and shared web hosting are all out. See
[HOSTING.md](HOSTING.md).

Builds on a 1 GB VPS commonly die with an out-of-memory kill that surfaces as
exit 137. Build elsewhere or size up.

## Database

PostgreSQL 14+, with `pgcrypto`:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

Not optional and not swappable. The authorization model is SQL functions and
triggers — see [docs/DDL_DML.md](docs/DDL_DML.md).

## Browser support

Modern evergreen browsers. React 19 and the CSS here assume `:has()`, container
queries and CSS custom properties. No IE, no pre-2023 Safari.

## External services

| | required? | |
|---|---|---|
| Supabase | optional | plain Postgres works; Supabase adds auth and storage |
| An AI provider | optional | the writing assistant; configured in the database, not code |
| Cloudflare | optional | recommended in front of a VPS — see the `cloudflare` skill |

Nothing here requires a paid service to run locally.
