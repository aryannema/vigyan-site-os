# Porting site-os off Hostinger/Coolify

**Status: reference only — no migration is planned or in progress.** Written
2026-09-10 while the details were fresh, so a future move doesn't have to
rediscover them under time pressure.

Target scenario assumed throughout: **Vercel (app) + Supabase Cloud (database
+ auth)**. That's the stack this project migrated *away from* in 2026-08 for
cost reasons (see `docs/OPS.md` §5 for the pricing comparison) — so this is a
reversal, not new ground.

---

## 1. What ports cleanly (most of it)

| Layer | Why it's portable |
|---|---|
| **App code** | Plain Next.js 15 App Router. No Coolify-specific APIs, no custom server. |
| **Database schema** | `supabase/migrations/*.sql`, numbered and ordered. Replay in sequence. |
| **Admin-editable config** | `app_config`, `social_links`, `feature_flags` live **in the database**, so they travel with a DB dump — not with the host. This is deliberate (see §4). |
| **Secrets/env** | ~34 standard `process.env.*` reads. Paste into Vercel's env UI. |

---

## 2. What does NOT port — the four real gotchas

### 2.1 GoTrue redirect allow-list ⚠️ highest risk

**On Supabase Cloud this is a dashboard setting, not an env var**:
Authentication → URL Configuration → **Redirect URLs**. Add:

```
https://example.com/**
https://www.example.com/**
```

**Why this is flagged highest-risk:** on 2026-09-10 Google OAuth was found
silently broken here for exactly this reason. The allow-list was empty, so
GoTrue ignored the app's `redirect_to` and fell back to `GOTRUE_SITE_URL`
(the homepage). Users signed in successfully but **never reached
`/auth/site-callback`**, so the mandatory profile-completion step
(`/complete-profile` — name + WhatsApp OTP) never appeared. No error was
logged anywhere; sign-in "worked", it just skipped a required step.

The self-hosted root cause was a name mismatch worth knowing about if you ever
come back: `docker-compose.yml` maps
`GOTRUE_URI_ALLOW_LIST: '${ADDITIONAL_REDIRECT_URLS}'`, but the value had been
written to `.env` as `GOTRUE_URI_ALLOW_LIST=...` — a variable nothing reads.
The compose-referenced `ADDITIONAL_REDIRECT_URLS` existed but was empty.

**Verify after migrating** (don't assume — this failure is invisible):

```bash
curl -s -o /dev/null -w "%{redirect_url}\n" \
  "https://<project>.supabase.co/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Fwww.example.com%2Fauth%2Fsite-callback"
```

The returned Google URL must still contain your `redirect_to`. If it's absent
or rewritten to the bare site URL, the allow-list isn't taking effect.

Also set **Site URL** to `https://www.example.com` (the `www` canonical),
not the apex — the self-hosted value is the apex, which is a latent mismatch.

### 2.2 Cron jobs

Currently **two** Coolify Scheduled Tasks (Coolify → application → Scheduled
Tasks):

| Task | Schedule | Route |
|---|---|---|
| `publish-scheduled-blog-posts` | `0 3 * * *` | `/api/cron/publish-scheduled` |
| `purge-deletion-grace` | `0 4 * * *` | `/api/cron/purge-deletion-grace` |

On Vercel these become `vercel.json` `crons`. **`vercel.json` in this repo is
stale** — a leftover from the pre-migration era that lists only
`publish-scheduled`. Porting it as-is means `purge-deletion-grace` never runs,
and account-deletion grace-period snapshots are never purged — a silent DPDP
compliance gap, since "permanently deleted after 15 days" would stop being
true. Add both entries.

Both routes are `CRON_SECRET`-gated; Vercel sends that header automatically
when the env var is set.

### 2.3 WhatsApp knowledge base — filesystem dependency

`src/app/api/webhook/whatsapp/route.ts` reads `/app/kb-data/kb.md` from a
ZFS-backed volume, falling back to the git-bundled `data/kb.md`.

**Vercel has no persistent writable filesystem.** The bot won't break (the
fallback handles it), but you lose the ability to update the KB without a
redeploy. To keep that capability, move the KB into the database or blob
storage before/at migration. Not blocking; a capability regression to accept
knowingly rather than discover later.

### 2.4 Local AI (vLLM on dev-box)

`LOCAL_AI_URL` points at a Tailscale address on the home network. Vercel can't
reach it. `tryLocalAi()` fails over to Gemini by design, so nothing breaks —
but local inference is permanently off unless exposed via a public Funnel URL.

---

## 3. Migration order

1. Create the Supabase Cloud project; run `supabase/migrations/*.sql` **in
   numeric order**. Confirm RLS policies came across — several tables
   (`app_config`, `social_links`, `feature_flags`) are public-read/admin-write
   and depend on `user_has_capability()` from migration 003.
2. `pg_dump`/restore the data. `app_config`/`social_links`/`feature_flags`
   rows carry the live settings — no re-entry needed.
3. Set **Redirect URLs** and **Site URL** per §2.1. Re-add the Google OAuth
   provider (client ID/secret) and update the authorized redirect URI in
   Google Cloud Console to the new `.supabase.co` callback.
4. Import env vars into Vercel (list: `.env.example`; real values:
   `docs/VIGYAN_SECRETS.md` while the repo is private).
5. Add both crons to `vercel.json` (§2.2).
6. Point DNS at Vercel. Keep Cloudflare in front if the redirect rules there
   are still wanted.
7. Update the WhatsApp webhook callback URL in Meta's WhatsApp Manager to the
   new host, then re-verify — `POST /{waba-id}/subscribed_apps` is a
   **separate step** from setting the callback URL (see `docs/OPS.md` §13).

---

## 4. Design note: why config lives in the DB

Over 2026-09-09/10, admin-editable settings were deliberately moved out of
env vars into Postgres (`app_config`, `social_links`, `feature_flags`) — the
WhatsApp display number, escalation number, API version, OTP timings,
grace-period length, social URLs. Two reasons, the second being the point of
this document:

1. Changing them is an admin edit at `/admin/settings`, not a redeploy.
2. **They're not tied to a hosting platform's env store.** A DB dump carries
   them; moving hosts doesn't mean re-entering them by hand.

**The boundary — what deliberately stays in env:**

- **Secrets.** `app_config` is publicly readable by design (`anon SELECT`), so
  `WHATSAPP_TOKEN`, `OTP_HASH_SECRET`, `ACCOUNT_DELETION_ENCRYPTION_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` etc. would be world-readable there. Non-negotiable.
- **Bootstrap values.** `DATABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL` are needed
  *to reach* the database — they can't live in it.
- **Other services' config.** GoTrue is a separate Go container that reads its
  own env at boot; it has no access to our tables and no mechanism to read
  them. §2.1 is that limitation in practice.
