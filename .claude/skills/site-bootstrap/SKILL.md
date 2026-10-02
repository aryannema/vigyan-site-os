---
name: site-bootstrap
description: Use when standing up a fresh deployment of this codebase (or the public vigyan-site-os template) — populates company identity, branding and starting content without committing any of it, and decides for each value whether it belongs in platform env, encrypted DB secrets, DB config, or an admin screen.
---

# Bootstrapping a fresh site

This codebase separates four things that are easy to confuse. Getting a value into the wrong
one is the difference between a template someone can adopt and a template that boots already
believing it is somebody else's company.

| Layer | Holds | Changed by |
|---|---|---|
| **DDL** — `supabase/migrations/` | tables, functions, policies, triggers | a migration |
| **Required seed** — `seed/01_required.sql` | rows the system cannot run without | a migration |
| **Defaults** — `seed/02_defaults.sql` | starting values with a screen behind them | the admin UI |
| **Platform env** | what you need *before* you can reach the database | the host (Coolify/Vercel/AWS) |
| **Encrypted DB secrets** — `app_secrets` | vendor credentials | `/admin/settings/secrets` |
| **Company & content data** | who you are, what you sell | this skill, or the admin UI |

Run `node scripts/sql-classify.mjs` to see which tier every migration falls in. It parses
dollar-quoted bodies, so an `INSERT` inside a trigger is correctly read as DDL rather than
data.

## The rule that matters

**Nothing this skill produces gets committed.** It writes a local seed file and a
`brand.config.ts`; both are gitignored. What ships is the interview and the shape it fills,
never the answers.

If you find yourself about to `git add` a file containing a legal name, a tax identifier, a
bank account or an API key, stop — that is the failure this separation exists to prevent.

## Why env is its own tier

Some values cannot live in the database, because they are what you need in order to *reach*
or *decrypt* it. **`env.manifest.json` is the authority** — its `bootstrap` and `public`
tiers are the platform env, and `pnpm env:check` fails if code reads a name it does not
describe. Do not keep a separate list in this skill. Today that is:

- `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` — reaching the database
- `CONFIG_ENCRYPTION_KEY` (the key itself; `_CURRENT` is only the version number, `_V2`
  only during rotation) — without it `app_secrets` is undecryptable ciphertext
- `ACCOUNT_DELETION_ENCRYPTION_KEY`, `OTP_HASH_SECRET` — read before any DB lookup
- `public` tier (`NEXT_PUBLIC_GA4_ID`, optional `NEXT_PUBLIC_SITE_URL`) — baked in at build

Everything else that looks like an env var should be asked for here and stored encrypted in
`app_secrets` (tier `secret`, `/admin/settings/secrets`) or `app_config` (tier `config`,
`/admin/settings`), where it is rotatable from a screen and auditable.

**These differ by host, which is the whole reason they are separable:**

| | Coolify (self-hosted) | Vercel |
|---|---|---|
| `DATABASE_URL` | internal Docker hostname, direct connection | pooled connection string |
| `NEXT_PUBLIC_SITE_URL` | your domain behind Cloudflare | `VERCEL_URL` on previews, domain in prod |
| Cron | system cron or a Coolify scheduled task | Vercel Cron, which needs `CRON_SECRET` |
| How values get there | `pnpm secrets sync coolify --env prod --apply` | `pnpm secrets sync vercel --env prod --apply` |

A value that changes per host must never be a committed seed row: it would be correct on
exactly one machine and silently wrong everywhere else.

## The interview

Ask these in order. Skip anything already set — read `company_profile` first and only ask for
what is missing or empty.

**1. Identity.** Legal name, brand name, entity type, jurisdiction, city, country.

**2. Tax and registration.** Only what the jurisdiction actually needs. For India: CIN,
GSTIN, PAN. For elsewhere, ask what applies rather than assuming Indian fields — the schema
carries them as nullable text for exactly this reason.

**3. Contact.** Public email, phone, and whether a WhatsApp number should be shown. If the
site will send WhatsApp, say plainly that a Business Account and an approved template are
needed before any business-initiated message will be delivered — cold outbound returns 200
with a `wamid` and is silently dropped, which reads as a broken integration when it is
working correctly.

**4. Brand.** Palette (primary, accent, surface, text), typeface pairing, logo path, tagline,
and voice in a sentence or two. If they have no palette, offer to derive one from the logo
rather than inventing colours.

**5. What they sell.** This template supports two commercial models:
   - **lead magnet** — free, given away to start a conversation
   - **one-off** — buy once, own it

   Subscriptions, services and usage credits are deliberately not here. If the adopter needs
   recurring billing, say so directly rather than bending `one_off` into a subscription.

**6. Payments.** Razorpay or Stripe, test or live. Never ask for a key in chat — point them
at `/admin/settings/secrets`, which encrypts on write.

## What to write

**`seed/local/01_company.sql`** — gitignored. Their answers as `INSERT`s against
`company_profile`, `company_accounts`, `social_links`. Idempotent (`ON CONFLICT DO UPDATE`)
so re-running is safe.

**`brand.config.ts`** — gitignored. Palette, fonts, logo, tagline, voice, feeding CSS custom
properties so one file re-skins the whole site.

**Run `pnpm bootstrap`** once the hosts/accounts exist:
`pnpm bootstrap --host coolify|vercel|aws|local --supabase cloud|coolify [--project-ref REF | --service UUID]`.
It generates what is generatable (encryption keys, OTP/cron secrets), fetches what a
provider can return (Supabase cloud via `supabase` CLI; self-hosted Supabase via the Coolify
API with a `read:sensitive` token), and asks — hidden — for the rest with the exact place to
find each. Run by an agent (no terminal) it asks nothing: it reports what is still missing
with the same guidance and exits 3 — relay that to the operator, who runs it in a terminal.
Never ask the operator to paste a value into chat.

**The encrypted vault** — `secrets/prod.sops.env`, never a plaintext file. Run
`pnpm secrets init` (age key + recipient), then `pnpm secrets edit --env prod` and fill the
`bootstrap`/`public` names; `pnpm secrets check --env prod` must report nothing missing.
Push with `pnpm secrets sync coolify|vercel --env prod --apply`. The vault is ciphertext and
safe to commit; the age key in `~/.config/sops/age/keys.txt` never is — back it up offline.
A *plaintext* file of secrets is still the thing this whole structure exists to avoid.

**A checklist, printed not written** — the `secret`/`config` values to enter in
`/admin/settings/secrets` and `/admin/settings` after first sign-in, grouped by screen.

## Verify before declaring done

```bash
pnpm typecheck
git status --porcelain      # must show NOTHING from this skill
psql "$DATABASE_URL" -c "select brand_name, legal_name from company_profile"
```

Then load the site. If the header still shows the template's placeholder name, `brand.config.ts`
was written but not imported — check `app/layout.tsx` reads it.

## Do not

- Commit anything produced here.
- Put a credential in `app_config`; it is not encrypted. `app_secrets` is.
- Seed products or posts to "show it working" — an adopter deleting demo rows they did not ask
  for is a worse first experience than an empty site with a working admin.
- Invent tax identifiers as examples. An adopter who copies a plausible-looking GSTIN into
  production has a real problem.
