# SETUP.md

Everything needed to stand up a fresh deployment of this template: what credentials
to procure, where they go, how to get new ones if they expire or get revoked.

This is a living doc — expand it as more pieces (payment gateway, GA, Telegram/
WhatsApp notifier) get built.

---

## Credentials this project needs

| Credential | Used for | Expires? | Where to get it |
|---|---|---|---|
| Supabase personal access token | CLI/Management API — create the Cloud project, apply migrations | Whatever you set at creation. Supabase PATs do **not** expire by default — an expiry is opt-in at generation time. | https://supabase.com/dashboard/account/tokens → Generate new token |
| Vercel CLI session | Deploy the app, manage env vars | Not confirmed to have a fixed lifetime — typically long-lived. Verify with `vercel whoami`. | `vercel login` (device-code flow, needs a browser) |
| Google OAuth Client ID/Secret | "Sign in with Google" for `/admin` | Does not expire by default. | https://console.cloud.google.com/apis/credentials → Create OAuth client ID (Web application) |
| `BOOTSTRAP_ADMIN_EMAILS` | Comma-separated list — which emails auto-become admin on first sign-in | N/A, it's your own config | Set by you, not procured from anywhere |
| `MCP_SECRET_KEY` | Bearer token for the MCP automation path (n8n, CI, etc.) | N/A, self-generated | `openssl rand -hex 24` |
| `DATABASE_URL` | Direct Postgres connection (used by the admin UI and MCP route via raw `pg`) | N/A | From the Supabase project's connection settings, or your own Postgres instance for local dev |

### Regeneration procedures

**Supabase personal access token**
1. https://supabase.com/dashboard/account/tokens → Generate new token → name it → copy immediately (shown once, cannot be viewed again).
2. `supabase login --token <new-token>`.
3. Revoke the old token from the same page once the new one is confirmed working (`supabase projects list`).

**Vercel CLI session**
- Just re-run `vercel login` — interactive device-code flow, no dashboard token needed.

**Google OAuth**
- Client ID is stable, never needs regenerating.
- To rotate the Client Secret: Google Cloud Console → APIs & Services → Credentials → select the OAuth 2.0 Client ID → "Reset Secret". This invalidates the old secret **immediately** — update it everywhere it's configured (Supabase project's Auth → Providers → Google panel, and any local GoTrue env if self-hosting auth) *before* rotating in a live environment, or sign-in breaks until you do.

---

## Local dev vs. production

- **Local dev**: bare Postgres + (optionally) self-hosted GoTrue, see `scripts/a19-install-gotrue.sh` in the `Vigyan-Virtual-Cloud` ops repo (drafted, not yet wired up — has known blockers documented in its header: `auth.uid()` is a function this schema's RLS policies depend on and must survive even when the local `auth.users` stub table is dropped; do not `DROP SCHEMA auth CASCADE`, follow the ordered migration it documents instead).
- **Production**: a real Supabase Cloud project (auth + Postgres both hosted there) + Vercel for the app. The two environments are deliberately independent — same `supabase-js`/`@supabase/ssr` app code works against either, but they don't share an auth backend, so you register the Google OAuth redirect URI separately for each (local GoTrue callback URL vs. the Cloud project's `.supabase.co/auth/v1/callback`).

## Bootstrapping the first admin

1. Add your email to `BOOTSTRAP_ADMIN_EMAILS` (comma-separated, env var).
2. Deploy/run migrations (`supabase/migrations/*.sql`, in order).
3. Sign in with Google at `/login` using that email — you land directly in `/admin` as `role='admin'`.
4. Anyone else who signs in (whose email isn't in `BOOTSTRAP_ADMIN_EMAILS` but is allow-listed in the `admin_users` table) lands in `/pending-approval` until an existing admin assigns them a role via `/admin/users/capabilities`.

## Known state as of 2026-08-11

- Schema, RLS, dynamic roles-and-capabilities system, MCP content-driving route, admin UI (shell + capability grid + blog/careers CRUD), content/formatting system, and the OAuth login/callback/middleware pages are all built and tested (313 tests, 310 passing — 3 known, deliberately deferred MEDIUM/LOW findings tracked in `tests/adversarial-findings.test.ts`).
- **Not yet wired**: `resolveActor()` (in `app/admin/lib/db.ts` and `app/api/mcp/route.ts`) still needs to read the real signed-in session instead of falling back to "no actor" — this is the last step that turns the auth pages that exist into admin writes that actually work end-to-end. Until then, admin reads work but admin writes correctly refuse with "no authenticated actor."
- No GoTrue instance and no Supabase Cloud project exist yet — this doc's credential table is what's needed to create them.
