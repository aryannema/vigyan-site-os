# Setting up a new site

Two phases. **Phase 1 is done by a person, once.** It needs accounts, money,
identity checks and taste — none of which an agent can supply. **Phase 2 onward is
agentic:** any coding agent (Claude Code, Codex, OpenCode, …) builds and runs the
site from here, using the skills in `.claude/skills/`.

Never paste a key into a chat with an agent. Values go into the encrypted vault
(`pnpm bootstrap` / `pnpm secrets edit`) or the admin panel, nowhere else.

---

## Phase 1 — manual (person)

### 1. Accounts and hosts

Pick one row per line and create the account/project.

| Need | Option A (self-hosted) | Option B (managed) |
|---|---|---|
| App host | Hostinger VPS + Coolify | Vercel (or AWS: App Runner / ECS / Amplify) |
| Database + auth | Supabase self-hosted (Coolify service) | Supabase cloud project |
| DNS / CDN | Cloudflare (recommended either way) | Cloudflare |
| Code | GitHub repo from this template | same |

Plain RDS/Postgres is not enough: the app uses Supabase auth (`auth.users`, `auth.uid()`),
see `docs/PORTABILITY.md`.

### 2. Tools on your machine

`node` + `pnpm`, `sops`, `age` (and `supabase` CLI for Supabase cloud, `vercel` CLI for Vercel).

### 3. Platform variables — `pnpm bootstrap`

```
pnpm install
pnpm bootstrap --host coolify|vercel|aws|local --supabase cloud|coolify \
               [--project-ref <supabase ref> | --service <coolify supabase uuid>]
```

It **generates** what can be generated (encryption keys, OTP and cron secrets), **fetches**
what a provider can return (Supabase keys via `supabase login`, or a self-hosted Supabase
service via a Coolify token with `read:sensitive`), and **asks — hidden — for the rest**,
telling you exactly where each value is. Every variable, its purpose and where it comes
from on each platform is in `env.manifest.json`.

Then push to the host and keep the vault:

```
pnpm secrets sync coolify|vercel --env prod --apply     # AWS: see env.manifest.json "platforms.aws"
git add secrets/prod.sops.env .sops.yaml && git commit -m "Add encrypted prod vault"
```

**Back up `~/.config/sops/age/keys.txt` offline.** Losing it loses the vault.

### 4. Database

Apply migrations, then seed rows, in order (the `db-migrate` / database skill has the
exact commands for your host): `supabase/migrations/*` → `supabase/seed/01_required.sql`
→ `supabase/seed/02_defaults.sql`.

### 5. Branding and identity

Run the `site-bootstrap` skill with your agent. It interviews you for legal name, tax
details, brand (palette, type, logo, voice) and what you sell, and writes
`seed/local/01_company.sql` + `brand.config.ts` — both gitignored. **The choices are
yours**; the agent only writes them down.

### 6. First deploy and first admin

Deploy (Coolify: push to the connected branch; Vercel: `vercel --prod`). Set
`BOOTSTRAP_ADMIN_EMAILS` once so your first sign-in becomes admin, sign in, then
remove it.

### 7. Admin panel — vendor keys and settings

`pnpm bootstrap` prints this checklist at the end. Enter:

- **`/admin/settings/secrets`** — vendor credentials (WhatsApp/Meta, Resend, Google
  service account, R2, Cloudflare purge token, …). Self-generated ones have a
  **Generate** button.
- **`/admin/settings`** — plain settings (WhatsApp phone id, Search Console property,
  GA4 property, Cloudflare zone, …).
- **Payments → Gateway Config** — Razorpay test keys first.

Accounts that need your identity (Meta business verification, Razorpay KYC, domain
purchase) can only be done by you.

---

## Phase 2 — agentic (any coding agent)

From here, ask your agent in plain language. It reads `AGENTS.md`, the session state in
`work-units/` and the skills, and handles:

- features and schema (`feature-intake` → `feature-schema` → `feature-testing`)
- content, landing pages, menus, products (`site-mcp` / admin)
- publishing, cache purge and re-cache, search-engine submission (`publish-and-verify`, `seo-launch`)
- migrations on any database (`db-migrate`)
- secrets changes and host moves (`secrets-ops`, `pnpm secrets`)

Moving hosts later (Coolify ⇄ Vercel ⇄ AWS) only changes the ~7 bootstrap variables:
`pnpm secrets sync <host> --env prod --apply`.
