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

## What this is for

A **skeleton you clone to build a real business site** — not a demo, and not a
theme. Brand-neutral on purpose: there is no logo, no colour story and no copy to
delete, so the first commit after cloning is your own brand rather than someone
else's removal.

It exists because the boring parts of a small-business site are the same every
time — blog, editable page content, careers, an enquiry inbox, a media library,
an admin area, and permissions over all of it — and those parts are where the
security mistakes live. Here they are already built, and built so the permission
model cannot be bypassed by reaching around the UI.

**What you are expected to spend your time on:** the design, the copy, and the
one or two things your business actually does differently. **What you should not
have to rebuild:** who may publish a post, and whether the audit row exists.

Reasonable uses:

- A client site where you will hand the admin area to a non-technical owner
- An internal tool that needs real roles rather than an `isAdmin` boolean
- A starting point for learning how database-enforced authorization works — the
  SQL is short enough to read in an afternoon
- A base for agent-operated content workflows, since `/api/mcp` is already wired

Not a fit if you want a static marketing page (this needs a Node runtime and
Postgres — see [HOSTING.md](HOSTING.md)), or if you want a finished product: see
the warning above.

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

### The UI layer — shadcn/ui

`components.json` configures [shadcn/ui](https://ui.shadcn.com): RSC on, TypeScript,
`neutral` base colour, CSS variables for theming.

**shadcn is not a dependency.** There is no `npm install shadcn-ui` — the CLI
*copies source files into your repo*, so `components/ui/*.tsx` is yours to read
and edit. That is the point: when a button needs to behave differently you change
the file, instead of fighting a library's props. It also means updates are
deliberate rather than automatic.

Nine primitives are already in `components/ui/`:

```
badge  button  card  checkbox  input  label  select  table  textarea
```

Add more as needed:

```bash
pnpm dlx shadcn@latest add dialog dropdown-menu toast form
```

Because `cssVariables: true` and `baseColor: neutral`, rebranding is editing the
variables in `app/globals.css` — not touching component files.

### Forms

Zod 4 schemas are the single definition of a form's shape, used for **both**
client-side validation and the server-side check. One schema, so the two cannot
disagree — which is the usual way invalid data reaches a database that thought it
was validated.

Pair with `pnpm dlx shadcn@latest add form` for the react-hook-form wiring if you
want the resolver pattern.

## Documentation

| | |
|---|---|
| [SETUP.md](SETUP.md) | environment, database, first run |
| [HOSTING.md](HOSTING.md) | **Hostinger + Coolify (India), AWS, Vercel** — requirements and real costs |
| [docs/BUILDING_YOUR_SITE.md](docs/BUILDING_YOUR_SITE.md) | adding pages, sections and features |
| [docs/A_SITE_THAT_SELLS.md](docs/A_SITE_THAT_SELLS.md) | conversion principles — what makes a site earn its keep, not just look finished |
| [docs/MIGRATIONS.md](docs/MIGRATIONS.md) | schema changes, and why order matters |
| [SECURITY.md](SECURITY.md) | the threat model and what is not covered yet |
| [BLOCKERS.md](BLOCKERS.md) | **read before deploying** — known gaps, including admin auth |
| [CONTRIBUTING.md](CONTRIBUTING.md) | how to work on it |

[docs/A_SITE_THAT_SELLS.md](docs/A_SITE_THAT_SELLS.md) is worth reading even if
you never touch the code. Most sites fail commercially for reasons that have
nothing to do with the framework.

## Hosting

Needs a **Node runtime and Postgres** — static hosting cannot run it, because
pages render per request and `/api/mcp` is server code.

| | |
|---|---|
| **Hostinger VPS + Coolify** | recommended for India — Mumbai region, ~₹700–1,100/month, git-push deploys, automatic TLS |
| **AWS** | Amplify+RDS for least work, Fargate+ALB+RDS for production shape, ap-south-1 |
| **Vercel** | easiest while building; no Indian function region and no database |

[HOSTING.md](HOSTING.md) has the concrete requirements for each, what Coolify
does *not* do for you, the `NEXT_PUBLIC_` trap that publishes secrets to the
browser, and a pre-deploy checklist.

## Getting started

```bash
pnpm install
cp .env.example .env.local     # then fill it in — see SETUP.md
psql "$DATABASE_URL" -f supabase/migrations/000_local_auth_stub.sql
# ...apply 001 through 009 in order
pnpm dev
```

**Next:** [docs/BUILDING_YOUR_SITE.md](docs/BUILDING_YOUR_SITE.md) takes you from a running
database to a live site — what this template gives you, what you build yourself, and the order
that avoids rework. Then [docs/A_SITE_THAT_SELLS.md](docs/A_SITE_THAT_SELLS.md) before you write
any copy.

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
