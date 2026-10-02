# agentic-site-os

**Tell a coding agent "launch my site" — and watch it actually do it.**

agentic-site-os is a full business website — marketing pages, blog, careers, a product
store with real checkout and invoices, a WhatsApp inbox with a bot, and a 40-page admin
console — designed from day one to be **built and run by AI coding agents**.
Claude Code, Codex, OpenCode or Antigravity: open the repo, and your agent already knows
the codebase, has the right tools wired in, and can ship features, publish content and
operate the live site on its own.

> I'm a third-year CS student, and I built this because every "AI builds your website"
> demo I tried stopped at a pretty landing page. Real sites need payments, permissions,
> SEO, caching, backups and an admin panel — and an agent that can safely touch all of
> it. So I made the template I wished existed.
> — Aryan

---

## Why it's different

**🤖 Agent-native, not agent-compatible.** The repo ships with *skills* (step-by-step
playbooks agents follow) and an **MCP bundle** (the tools they call). One command sets
them up for every major coding agent:

```bash
pnpm agents:port   # Claude Code · Codex · OpenCode · Antigravity
```

**🔌 The site has its own MCP server.** Once deployed, `/api/mcp` lets an agent edit pages,
publish blog posts, manage products and prices, flip feature flags — through the same
permission checks and audit log as a human admin. Every agent action is recorded with
*which* agent did it.

**🛡️ Permissions live in the database.** Roles and capabilities are enforced by Postgres
row-level security, not by hoping the frontend hides a button. There are tests that
actually attack it (log in as a viewer, try to read admin data) and must fail.

**🏭 Production-born.** This isn't a weekend starter. It's exported — one way, branding
stripped — from a site running in production. Every feature here was built and tested
live first. No half-finished pages, no "TODO: add auth".

**🔐 Secrets done right.** `pnpm bootstrap` generates keys, fetches what your providers can
give it, asks (hidden) for the rest, and writes an encrypted vault (SOPS + age). Your
agent never sees a raw key.

---

## How it works

```
 You (once, ~1 hour)            Your coding agent (from then on)
 ───────────────────            ─────────────────────────────────
 accounts + domain        ──►   builds features   (feature-intake → schema → tests)
 pnpm bootstrap                 publishes content (site MCP → purge cache → ping search engines)
 pick your brand                runs migrations   (site-database skill)
                                deploys + operates (Coolify / Vercel / Cloudflare / GitHub MCPs)
```

The agent works through **two layers of MCP**:

| Layer | What it is | What the agent does with it |
|---|---|---|
| **Infrastructure** | Cloudflare, GitHub, Coolify or Vercel, Supabase, WhatsApp, Postiz, n8n | build, deploy, DNS, cache, database, social posts, automations |
| **The site itself** | `https://your-site/api/mcp` | pages, blog, jobs, products, short links, settings, flags |

Full explanation: [docs/AGENT_MCP.md](docs/AGENT_MCP.md).

---

## What's inside

| | |
|---|---|
| **Public site** | Home, about, services, blog, careers, contact, legal pages, landing pages, SEO metadata, sitemap, JSON-LD |
| **Store** | Products, lead magnets, bundles, offers, Razorpay checkout, GST-correct invoices (PDF), guest checkout, fulfilment |
| **WhatsApp** | Business Cloud API inbox, menu bot, human hand-off, phone verification |
| **Admin console** | 40+ screens: content, blog, products, pricing, users and roles, audit log, secrets, feature flags, campaigns and UTM links, cache and search-engine buttons |
| **Growth** | Campaign link builder, short links, IndexNow + Google Search Console submission, Cloudflare purge-and-rewarm |
| **Agent kit** | 13 skills, MCP bundle with profiles, site MCP server, `scripts/agents-smoke.sh` to prove agents can call it |
| **Ops** | Env manifest describing every variable, SOPS vault, sync to Coolify / Vercel / AWS, migrations + seeds split (DDL vs data) |

**Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Supabase (Postgres + Auth) ·
Tailwind CSS + [shadcn/ui](https://ui.shadcn.com) · Vitest + Playwright · Razorpay ·
Cloudflare · Coolify or Vercel.

---

## Try it

```bash
git clone https://github.com/aryannema/vigyan-site-os.git my-site
cd my-site
pnpm install
pnpm bootstrap --host local --supabase cloud     # or: --host coolify|vercel|aws
pnpm agents:port
```

Then open the folder in your agent and say something like:

- *"Read AGENTS.md, then set up my brand: name Acme Bakery, warm colours, friendly tone."*
- *"Add a products page for three cake boxes with prices, and publish it."*
- *"Write a launch blog post, publish it, and make sure Google and Bing know about it."*

Everything a person must do (accounts, domain, payment KYC) is listed step by step in
**[docs/SETUP.md](docs/SETUP.md)**.

---

## Documentation

| Start here | |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | New site, start to finish: the manual part, then the agentic part |
| [docs/AGENT_MCP.md](docs/AGENT_MCP.md) | The two MCP layers and how agents use them |
| [AGENTS.md](AGENTS.md) | The rules every coding agent reads first |
| [docs/INDEX.md](docs/INDEX.md) | Every other doc |

| Going deeper | |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the pieces fit |
| [docs/ADDING_A_FEATURE.md](docs/ADDING_A_FEATURE.md) | The feature workflow agents follow |
| [docs/MIGRATIONS.md](docs/MIGRATIONS.md) | Schema changes and seed data |
| [docs/TESTING.md](docs/TESTING.md) | Unit, database and end-to-end tests |
| [docs/SEO_PLAYBOOK.md](docs/SEO_PLAYBOOK.md) | Getting pages indexed |
| [docs/PORTABILITY.md](docs/PORTABILITY.md) · [docs/PORTING.md](docs/PORTING.md) | Moving between hosts |

---

## Checks

```bash
pnpm build && pnpm test && pnpm env:check && pnpm brand:check && pnpm agents:check
```

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Found a security
problem? Please read [SECURITY.md](SECURITY.md) first.

## License

[AGPL-3.0](LICENSE). Build on it freely; if you run a modified version as a service,
share your changes.
