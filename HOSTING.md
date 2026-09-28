# Hosting this

Where to run it, what each option actually requires, and what it costs. Written
with India first, because that is where the latency and the compliance questions
are easiest to answer.

> [!CAUTION]
> **Do not put this on a public domain yet.** `/admin/*` has no auth layer — see
> [BLOCKERS.md](BLOCKERS.md) §3. Anyone who finds the URL is an admin. Everything
> below assumes you have either wired authentication or bound the deployment to
> a private network. This is a foundation, not a finished product.

---

## What it needs to run

Two things, and the first surprises people who expect to drop it on static
hosting.

**1. A Node runtime — not a static host.** This is Next.js 15 App Router with
React Server Components. Pages are rendered per request, and `/api/mcp` and the
admin routes are server code. GitHub Pages, S3-as-website, Netlify's static tier
and Hostinger's shared *web* hosting cannot run it. You need Node 20+ executing
continuously.

**2. PostgreSQL.** Not incidental storage — the permission model *is* the
database. `user_has_capability()` and `perform_action()` are SQL functions, and
the triggers in `supabase/migrations/007_*` enforce column-level rules. Point it
at MySQL or SQLite and there is no product.

### Environment

| variable | what breaks without it |
|---|---|
| `DATABASE_URL` | everything |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client-side data reads |
| `SUPABASE_SERVICE_ROLE_KEY` | privileged server paths — **never expose to the browser** |
| `MCP_SECRET_KEY`, `MCP_SERVICE_ACTOR` | the agent endpoint |
| `ADMIN_ACTOR`, `BOOTSTRAP_ADMIN_EMAILS` | first-admin bootstrap |

Anything prefixed `NEXT_PUBLIC_` is **compiled into the browser bundle**. Putting
a service-role key behind that prefix publishes it to every visitor — the single
most expensive mistake available here.

### Minimum sizing

| | |
|---|---|
| RAM | 2 GB works; **4 GB** is comfortable — `next build` is the memory peak, not serving |
| vCPU | 2 |
| Disk | 20 GB + database |
| Node | 20 LTS or 22 |

Budget VPS instances with 1 GB commonly fail during `next build` with an
out-of-memory kill that reads as a mysterious exit 137. Build elsewhere, or size
up.

---

## Option 1 — Hostinger VPS + Coolify  *(recommended for India)*

Coolify is a self-hosted PaaS: you get git-push deploys, TLS, and a database
manager on a VPS you control. Roughly Vercel's convenience without the vendor
relationship or the per-seat pricing.

### Why this combination for India

Three reasons, and the first is the one that wins business.

#### 1. The data never leaves India

With a Mumbai VPS, the application **and its database** sit on Indian
infrastructure. Nothing about a page view crosses a border.

That matters commercially, not just legally. Under the **DPDP Act 2023**,
cross-border transfer of personal data is permitted for most destinations — so
using a US provider is usually *lawful*. But "lawful with a transfer mechanism
we can explain" is a much longer conversation than **"it is on a server in
Mumbai"**, and some buyers will not have the longer conversation at all:

- Government and PSU-adjacent work, where residency is often a tender condition
- Banking, insurance and health, where the compliance team asks before the
  business team does
- Any client who has been asked by *their* customers where the data lives

With Vercel + Supabase Cloud you are answering "United States, under these
contractual clauses." With a Mumbai VPS you are answering "Mumbai." For a
sovereignty-conscious buyer that is the entire difference, and it is a reason to
choose you over a competitor who cannot say it.

The honest caveat: **Cloudflare in front is still a global CDN.** Cached assets
and TLS termination happen at an edge that may be outside India. If a
requirement is strictly "no data leaves the country", you either run
Cloudflare's India-only settings or drop the proxy — and lose DDoS protection.
Know which you are promising.

#### 2. Latency is on the critical path

This is Next.js App Router with React Server Components: **pages render on the
server for every request.** A visitor in Delhi hitting a Mumbai origin sees a
round trip of tens of milliseconds. The same visitor hitting a US origin sees
250–300 ms, on every navigation, before the page starts rendering.

Static sites hide this behind a CDN. Server-rendered ones cannot.

#### 3. Cost — measured, not guessed



Hostinger has a **Mumbai** region, so Indian visitors get single-digit to low-tens
millisecond latency instead of a transatlantic round trip on every server-rendered
page. Since RSC renders per request, that round trip is on the critical path for
*every* page view, not just API calls.

It also simplifies the **DPDP Act 2023** conversation: personal data collected
from Indian users stays on Indian infrastructure. Cross-border transfer is
permitted for most cases, but "it never left the country" is a much shorter
answer than a transfer-mechanism argument.

### What you need

| | |
|---|---|
| Hostinger **VPS** (KVM 2 or better — 2 vCPU, 8 GB) | ~₹700–1,100/month |
| Region | Mumbai |
| OS | Ubuntu 22.04 or 24.04 |
| A domain | anywhere; point DNS at the VPS |
| Open ports | 22, 80, 443 (and 8000 for Coolify's own UI) |

**Shared hosting will not work.** You need root on a VPS to install Docker.

### Setup

```bash
# on the VPS, as root
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Then in Coolify's UI:

1. **New Project → Resource → Public/Private Repository**, point it at this repo
2. Build pack: **Nixpacks** detects Next.js and pnpm automatically. If it guesses
   wrong, switch to Dockerfile — Nixpacks occasionally picks npm despite
   `pnpm-lock.yaml`, which then ignores the lockfile and installs different
   versions than you tested.
3. Build command `pnpm build`, start command `pnpm start`, port **3000**
4. **Environment variables** — paste the table above. Coolify marks variables as
   build-time or runtime; `NEXT_PUBLIC_*` must be **build-time**, because they are
   inlined during `next build`. Set them at runtime only and they arrive as
   `undefined` in the browser with no error.
5. **Database:** either add a Postgres resource in Coolify (simplest, same box) or
   point `DATABASE_URL` at managed Postgres. Same box is cheaper and fine for one
   site; it also means one machine failure takes both down.
6. **Domain:** set it in Coolify and it provisions Let's Encrypt automatically.
   DNS must already resolve to the VPS or issuance fails.
7. Run the migrations — `supabase/migrations/001` through `009`, **in order**. See
   [docs/MIGRATIONS.md](docs/MIGRATIONS.md); the ordering is not cosmetic, later
   files depend on functions earlier ones create.

### What Coolify does not do for you

- **Backups are opt-in.** Enable scheduled Postgres backups to S3-compatible
  storage and then *restore one* to prove it works. An untested backup is a
  hypothesis.
- **You own the OS.** `unattended-upgrades`, a firewall, SSH keys not passwords.
- **One box, one failure domain.** Fine for a site; not for something with an SLA.

---

## Option 2 — AWS  *(WIP — not yet deployed this way)*

> [!NOTE]
> **This section is a plan, not a runbook.** The Hostinger + Coolify path above
> has actually been used; the AWS paths below have not been deployed and
> verified end to end. Costs are list-price estimates and the steps are from
> documentation rather than from having hit the errors. Treat it as a map, and
> expect to find things it does not mention.

More moving parts and more expensive for one site, worth it when you already have
an AWS account, a compliance requirement, or real scale. Use **ap-south-1
(Mumbai)** or **ap-south-2 (Hyderabad)** for the same latency and residency
reasons as above.

### 2a. Amplify Hosting + RDS — least work

| | |
|---|---|
| Amplify | Next.js SSR is supported; connect the repo, it builds and deploys |
| RDS Postgres | `db.t4g.micro` is enough to start |
| Needs | VPC so Amplify's build/runtime can reach RDS, secrets in Amplify env, Node 20 build image |
| Watch | Amplify's Next.js support lags Next releases; verify the adapter handles App Router RSC in your version before committing |
| Cost | roughly $15–40/month for low traffic |

### 2b. ECS Fargate + RDS — production shape

| | |
|---|---|
| Needs | a Dockerfile, ECR, an ALB with ACM certificate, VPC with public+private subnets, security groups, Secrets Manager, task role |
| Gives | no servers to patch, horizontal scaling, RDS failover |
| Cost | ~$40–80/month minimum — the ALB alone is ~$16 before traffic |
| Reality | a day of infrastructure work, or Terraform you already have |

### 2c. EC2 + RDS — cheapest AWS

A `t4g.small` running the app under systemd or Docker, nginx in front, certbot
for TLS. Cheapest AWS option and you are back to owning the OS — at which point
**Hostinger + Coolify gives you the same thing for less money and less work.**

### 2d. What does *not* work

- **S3 + CloudFront alone** — static only; no RSC, no `/api/mcp`
- **Lambda without an adapter** — Next.js standalone needs `@sst-dev/open-next`
  or similar; do not hand-roll it
- **Aurora Serverless v2 scaling to zero** — cold starts appear as random
  multi-second page loads

---

## Option 3 — Vercel

The path of least resistance: Next.js is Vercel's product, so SSR, RSC and image
optimisation work with no configuration. Free tier covers a small site.

Reasons you might still not:

- **No Indian region for serverless functions.** The nearest edge is Mumbai, but
  function execution defaults elsewhere unless configured, which puts a
  trans-region hop on server-rendered pages.
- **No database.** You still need Supabase, Neon or RDS.
- **Cost steps are steep.** Pro is $20/seat/month, and bandwidth overages
  surprise people.
- **Data residency** is harder to reason about than "our VPS in Mumbai".

Sensible use: Vercel for preview deployments while building, Hostinger+Coolify or
AWS for production.

---

## Cost — Hostinger vs Vercel + Supabase

The comparison that actually decided this, for **one production site**:

| | Hostinger VPS + Coolify | Vercel + Supabase |
|---|---|---|
| Compute | ₹700–1,100/mo (2 vCPU, 8 GB) | Vercel Pro **$20/seat/mo** (~₹1,700) |
| Database | included on the same box | Supabase Pro **$25/mo** (~₹2,100) |
| **Monthly** | **₹700–1,100** | **~₹3,800**, before overages |
| Bandwidth | VPS allowance, generous | metered; overages are the usual surprise |
| Scaling | you resize the VPS | automatic |
| Patching | **yours** | theirs |
| Backups | **you configure them** | managed |
| Where the data is | **Mumbai** | US, unless you pay for regions |
| Second site | ₹0 — same box | another project, often another seat |

**Roughly 3–4× cheaper, and the gap widens with every additional site**, because
a VPS hosts several and a seat-priced PaaS does not.

What you are buying with the saved money is work you now do yourself: OS
updates, a firewall, backups you must *test*, and a single failure domain. That
is a real trade, not a free win. It is the right trade for a small number of
sites where someone is comfortable in a terminal; it is the wrong trade if
nobody wants to be paged.

**The free tiers are real** — Vercel Hobby plus Supabase free will genuinely host
a portfolio or a low-traffic site at ₹0. The comparison above is for production,
where Supabase's free tier pauses idle projects and Vercel Hobby forbids
commercial use.

### Full picture

| | monthly | notes |
|---|---|---|
| Hostinger VPS + Coolify + Postgres, one box | **₹700–1,100** | best value; you patch it |
| Vercel free + Supabase free | ₹0 | non-commercial; idle projects pause |
| Vercel Pro + Supabase Pro | ~₹3,800 | no servers to run |
| AWS Amplify + RDS | ~₹1,300–3,500 | *(WIP — see below)* |
| AWS Fargate + ALB + RDS | ~₹3,500–7,000 | *(WIP)* |

---

## Before you make it public

1. **Wire authentication.** `/admin/*` is open. [BLOCKERS.md](BLOCKERS.md) §3.
2. **Check no secret is `NEXT_PUBLIC_`.** Grep the built bundle for the first
   characters of your service-role key.
3. **Migrations 001→009 applied in order**, verified against a fresh database and
   not just the one you developed on.
4. **Take a backup and restore it somewhere.** Untested backups do not count.
5. **TLS everywhere**, including the `/api/mcp` endpoint — `MCP_SECRET_KEY` over
   plain HTTP is a shared secret in cleartext.
6. **Read [SECURITY.md](SECURITY.md).**
