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

## Why not just use Wix?

Wix is excellent at the thing it does: get a brochure site online in an
afternoon, with no developer. If that is what you need, use Wix. This is not
trying to compete with it.

The wall you hit is the second thing you ask for.

> "Can a client edit blog posts but not publish them without my review?"
>
> "Can my accountant see enquiries with phone numbers hidden?"
>
> "Can an AI agent draft posts overnight, with the same permissions as a junior
> editor?"
>
> "Can I query my own leads with SQL?"
>
> "Can I take my data and leave?"

On a hosted site builder those are not hard questions — they are **unavailable**
ones. There is no database you can reach, no permission model you can extend, no
place to put your own logic. You get the features the platform decided to build,
at the price the platform decides to charge, for as long as the platform exists.

This is the other trade. You run it, you own the database, and every part is
open to change.

| | hosted builder | this |
|---|---|---|
| Your database | not exposed | **Postgres, yours, direct SQL** |
| Permissions | what the plan offers | **rows and columns, enforced in the database** |
| Custom logic | plugins from a marketplace | **your own code, no marketplace** |
| AI agents operating it | vendor features | **an MCP endpoint through the same permission checks** |
| Where the data lives | vendor's choice | **your server, your country** |
| Leaving | export what they let you | **it is already yours** |
| Cost | monthly, forever, per feature tier | **₹700–1,100/month for a VPS, any number of sites** |

## The idea worth stealing even if you never use this

**Most systems check permissions in the user interface.** Hide the button, and
the capability is "revoked" — until someone reaches the table through an API
client, a script, `psql`, or an admin screen a colleague added last month and
forgot to guard. The checkbox said revoked; the database disagreed.

Here the check lives in Postgres:

```
reads   ->  user_has_capability(actor, resource_key, action)
writes  ->  perform_action(actor, resource_key, action, target, payload)
```

`perform_action()` authorizes **and** writes the audit row in one transaction.
There is no write path that produces a permission decision without also
producing an audit trail — not by convention, but because no other path exists.

It does not matter whether the caller is the admin UI, a script, or an AI agent.
They all meet the same wall.

### Measured, not asserted

Run `tests/e2e/mcp.sh` against a real database and watch it happen. Same
endpoint, same tool, two different identities:

```
editor → post created, audited, and the audit names who did it
viewer → "not permitted to create on blog", and nothing was written
```

The refusal came from **Postgres**, not from the code that received the request.
24 assertions, all passing. [tests/README.md](tests/README.md) has the setup.

## An AI agent is a user, not a feature

`POST /api/mcp` exposes the site's resources as [Model Context
Protocol](https://modelcontextprotocol.io) tools — so Claude, or any MCP client,
can operate the site.

The interesting part is not that an agent *can* write posts. It is that the
agent **has a role**, and the role is enforced the same way yours is. Give it
`blog:edit` without `blog:publish` and it writes drafts it cannot ship. Its calls
land in the audit log next to yours, naming it.

That is the difference between an AI feature and an AI **user**. Most products
bolt a chat widget onto an admin panel and hope the prompt holds. Here the
constraint is a row in `role_capabilities`, and no prompt can talk its way past
it.

Authentication is per-agent: short-lived access tokens with refresh, so each
agent is identifiable in the audit log and revocable on its own.

## The CRM, and privacy that survives the UI

Contact enquiries land in `contact_inquiries`. **Nothing reads that table
directly** — every authenticated read goes through `contact_inquiries_view`,
which is where the rule lives:

```sql
CREATE VIEW public.contact_inquiries_view
WITH (security_barrier = true) AS
SELECT
  ci.full_name,
  CASE WHEN crm_pii_unmasked(auth.uid())
       THEN ci.email ELSE mask_email(ci.email) END AS email,
  CASE WHEN crm_pii_unmasked(auth.uid())
       THEN ci.phone_number ELSE mask_phone(ci.phone_number) END AS phone_number,
  NOT crm_pii_unmasked(auth.uid()) AS pii_masked
FROM public.contact_inquiries ci
WHERE user_has_capability(auth.uid(), 'crm', 'view');
```

Read that carefully, because four separate decisions are in it:

**Rows are gated by capability.** No `crm:view`, no rows. RLS is enabled on 16
tables here; this view re-imposes the row rule itself so it is exactly as
restrictive on rows and *strictly more* restrictive on columns.

**Seeing a real phone number is a capability**, not a screen. Hold `crm:view`
and you see `9•••••1234`. Hold `crm:edit` and you see the number. A support
agent who opens `psql` sees exactly what the UI showed them.

**`security_barrier = true` closes a real side channel.** Without it the query
planner may push a caller-supplied condition *below* the capability check —
including a cheap user-defined function — letting someone with no `crm:view`
observe which rows exist through side effects. The masked columns cannot leak
that way (an outer filter on `email` is rewritten onto the `CASE`, so it sees
the mask), but the row gate needs the barrier.

**`pii_masked` is returned to the UI** so the interface never re-derives the
rule — and therefore cannot re-derive it *wrongly*. The badge and the disabled
`mailto:` follow what the database already decided.

That is a different promise from "we hide it in the interface." It is the one
that still holds when someone connects a BI tool, exports a CSV, or opens a
database client to debug something.

## What is already built

Not a scaffold with TODOs — these are working screens backed by 16 tables, 15
SQL functions and 4 test suites.

### Admin

| screen | what it does |
|---|---|
| `/admin` | dashboard |
| `/admin/blog` · `/new` · `/[id]` | write, edit, publish posts — **editing and publishing are separate capabilities** |
| `/admin/cms` | edit page content without a deploy; every change versioned in `content_history` |
| `/admin/careers` · `/new` · `/[id]` | job openings |
| `/admin/crm` | contact enquiries, **with PII masked by default** |
| `/admin/media` | uploads and library |
| `/admin/users` | accounts, roles, approval |
| `/admin/users/capabilities` | grant and revoke per resource and action |
| `/admin/ai-settings` | choose the AI provider and model — configuration, not code |

### The authorization core

Two functions every path goes through:

```
reads   →  user_has_capability(actor, resource_key, action)
writes  →  perform_action(actor, resource_key, action, target, payload)
```

`perform_action()` authorizes **and** writes the audit row in one transaction, so
no write can produce a permission decision without also producing an audit trail.
It is not a convention — there is no code path that skips it.

Beyond that:

- **`publish_capability_guard`** — a trigger enforcing what RLS cannot express:
  "may edit a post, may **not** publish one" is a column-level rule, so it is
  enforced by trigger rather than by a hidden button
- **`mask_email` / `mask_phone` / `crm_pii_unmasked`** — CRM personal data is
  masked in the database. Seeing a real phone number is a *capability*, so it is
  masked for a direct `psql` query too, not just in the UI
- **`audit_row_change`** — audit by construction
- **`capability_lookup`** — kept out of `authenticated`'s reach, so the
  permission table cannot be enumerated by a logged-in user

### The 16 tables

```
posts · site_content · content_history · job_openings · contact_inquiries
admin_users · user_roles · user_entitlements · role_capabilities
action_audit_log · mcp_audit_log · ai_provider_config
whatsapp_conversations · whatsapp_messages
auth.users · auth.session_identity
```

### The agent endpoint

`POST /api/mcp` — the same resources as tools, **through the same capability
checks**. Give an agent a role with `blog:edit` but not `blog:publish` and it
writes drafts it cannot ship. Calls land in `mcp_audit_log` like any other write.

### Tested where it matters

```
permission-matrix.test.ts     every role × resource × action
perform-action.test.ts        the write path and its audit guarantee
pii-masking.test.ts           masking holds below the UI
adversarial-findings.test.ts  regression tests for attempted bypasses
mcp-auth.test.ts              token verification, both type-confusion directions
e2e/mcp.sh                    24 assertions against a RUNNING server + database
```

That last file is the interesting one: each test is a way someone tried to reach
around the permission model, kept so it cannot come back.

The end-to-end suite proves the pieces are actually connected. Same endpoint,
same tool, two different identities:

```
editor → post created, audited, and the audit names the JWT subject
viewer → "not permitted to create on blog", nothing written
```

The decision is made by Postgres, not by the route — which is the claim this
whole repository rests on, now measured rather than asserted. See
[tests/README.md](tests/README.md) to run it.

Browser testing (functional, accessibility, contrast, responsive, visual) is
**not** written yet. The `testing-browser` skill describes how to add it,
including asserting brand by shape rather than by hex value so the tests survive
a rebrand.

---

## Ship a site in a weekend, not a quarter

The parts of a business site that take longest are the parts nobody sees: roles
and permissions, an audit trail, a schema that survives its second feature, and
an admin area a non-technical owner can be trusted with. Those are done here, and
done so the permission model cannot be bypassed by reaching around the UI.

**Ten Claude skills ship with the repo**, in `.claude/skills/`. They are not
prompts — they are written-down decisions, so you get the same answer on Tuesday
that you got on Monday:

| skill | what it does |
|---|---|
| `feature-intake` | asks the right questions **before** any schema is designed |
| `feature-schema` | evolves tables and capabilities for a new feature |
| `design` | shadcn/ui mechanics, the form validation layer, UI bugs that shipped |
| `feature-testing` | drives it in a real browser to find what nobody predicted |
| `database` | migrations, and the DDL/DML separation |
| `brand` | **a template you fill in** — identity is yours, not ours |
| `cloudflare` | DNS cutover, TLS modes, the redirect loop, keeping email alive |
| `seo-optimize` | before launch |
| `mcp` | the agent endpoint |
| `site-bootstrap` | standing up a fresh deployment |

They encode things that cost someone an afternoon: that `NEXT_PUBLIC_` is inlined
at build time, that Cloudflare's *Flexible* TLS mode causes an infinite redirect
loop, that a 1 GB VPS dies during `next build` with a bare exit 137.

[docs/WRITING_SKILLS.md](docs/WRITING_SKILLS.md) shows how to write your own.

## Who this is for

Reasonable uses:

- A client site where you will hand the admin area to a non-technical owner
- An internal tool that needs real roles rather than an `isAdmin` boolean
- A starting point for learning how database-enforced authorization works — the
  SQL is short enough to read in an afternoon
- A base for agent-operated content workflows, since `/api/mcp` is already wired

Not a fit if you want a static marketing page (this needs a Node runtime and
Postgres — see [HOSTING.md](HOSTING.md)), or if you want a finished product: see
the warning above.

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
| [REQUIREMENTS.md](REQUIREMENTS.md) | versions, machine sizing, what is not optional |
| [ENVIRONMENT.md](ENVIRONMENT.md) | **start here** — pnpm, the CAS, Postgres, env vars |
| [SETUP.md](SETUP.md) | environment, database, first run |
| [docs/BRANDING.md](docs/BRANDING.md) | defining a brand, with a worked example, and how to get Claude to apply it |
| [docs/WRITING_SKILLS.md](docs/WRITING_SKILLS.md) | writing skills for your own project |
| [docs/DDL_DML.md](docs/DDL_DML.md) | schema vs data, the four tiers, and where this repo mixes them |
| [HOSTING.md](HOSTING.md) | **Hostinger + Coolify (India), AWS, Vercel** — requirements and real costs |
| [docs/BUILDING_YOUR_SITE.md](docs/BUILDING_YOUR_SITE.md) | adding pages, sections and features |
| [docs/A_SITE_THAT_SELLS.md](docs/A_SITE_THAT_SELLS.md) | conversion principles — what makes a site earn its keep, not just look finished |
| [docs/MIGRATIONS.md](docs/MIGRATIONS.md) | schema changes, and why order matters |
| [MCP.md](MCP.md) | the agent endpoint: JWT auth, refresh tokens, Streamable HTTP |
| [SECURITY.md](SECURITY.md) | the threat model and what is not covered yet |
| [ROADMAP.md](ROADMAP.md) | **what is built, WIP, and not started** — read before assuming |
| [BLOCKERS.md](BLOCKERS.md) | **read before deploying** — known gaps, including admin auth |
| [docs/PUBLISHING.md](docs/PUBLISHING.md) | scrubbing secrets, screenshots and real data before you publish |
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
