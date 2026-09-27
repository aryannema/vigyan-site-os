# vigyan-site-os

A brand-neutral Next.js + Postgres site foundation where **permissions are enforced by the
database, not by the application** — and where an AI agent is a first-class operator of the
site, not a bolted-on chat widget.

Blog, CMS, careers, CRM, media library, and an MCP endpoint that lets an agent drive all of
them through the same capability checks a human admin goes through.

> [!WARNING]
> **`/admin/*` is currently unauthenticated.** There is no auth layer wired up yet — see
> [BLOCKERS.md](BLOCKERS.md) §3. Do not expose this to the internet as-is. This is a
> foundation to build on, not a finished product to deploy.

## Why this exists

Most CMS templates check permissions in the UI. Hide the button, and the capability is
"revoked" — until someone reaches the table through `supabase-js`, PostgREST, `psql`, or an
admin screen that forgot. The checkbox said revoked; the database disagreed.

Here the check lives in Postgres:

```
reads   ->  public.user_has_capability(actor, resource_key, action)
writes  ->  public.perform_action(actor, resource_key, action, target, payload)
```

`perform_action()` authorizes **and** audits in one atomic step, so no write path can produce
a permission decision without also producing an audit row. Column-level concerns that RLS
cannot express — "may edit a post, may not *publish* one" — are enforced by trigger rather
than by convention (`supabase/migrations/007_*`).

The practical consequence: it does not matter whether the caller is the admin UI, a script,
or an AI agent. They all meet the same wall.

## The agentic surface

`POST /api/mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) JSON-RPC
endpoint exposing the site's governed resources as tools. Every tool call is
capability-checked in the database before it touches data, and runs inside a single
transaction — if the data write fails after the audit row is inserted, both roll back.

An agent connected to it can draft and publish posts, edit CMS sections, manage job
openings, and read CRM inquiries — each subject to the role its identity carries. Give the
agent a role with `blog:edit` but not `blog:publish` and it can write drafts it cannot ship.

AI provider choice is configuration, not code (`public.ai_provider_config`, admin UI at
`/admin/ai-settings`), so the writing assistant and image generation are not hardcoded to
one vendor.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind · Postgres (`pg`) · Zod · Vitest ·
pnpm 10

## Getting started

```bash
pnpm install
cp .env.example .env.local     # then fill it in — see SETUP.md
psql "$DATABASE_URL" -f supabase/migrations/000_local_auth_stub.sql
# ...apply 001 through 009 in order
pnpm dev
```

[SETUP.md](SETUP.md) covers what credentials to procure and where they go.
[BLOCKERS.md](BLOCKERS.md) is the append-only running log of known problems — read §3 before
deploying anything.

```bash
pnpm typecheck
pnpm test          # DB suite: permission matrix, perform_action, adversarial findings
pnpm build
```

## Schema

Ten migrations, applied in order. Each one's header explains the finding it closes rather
than just what it does:

| | |
|---|---|
| `000` | local auth stub |
| `001` | base schema — posts, CMS sections, job openings, CRM inquiries |
| `002` | admin auth |
| `003` | roles and capabilities |
| `004` | audit by construction |
| `005` | contact PII masking |
| `006` | session identity |
| `007` | `publish` becomes a real capability |
| `008` | `perform_action` integrity |
| `009` | AI provider configuration |

## Status

Early. The database layer is the part that has been adversarially tested (see
`tests/adversarial-findings.test.ts`); the application layer above it is younger, and the
auth gap in §3 is real. Issues and PRs welcome.

## Licence

[AGPL-3.0](LICENSE). You may run, modify, and self-host this freely. If you run a modified
version as a network service, you must make your changes available to its users under the
same licence.

Commercial licences are available for anyone who needs to build a closed-source service on
top of it — open an issue to start that conversation.
