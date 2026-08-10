-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002: admin_users allow-list
--
-- admin_users is the allow-list consulted by the OAuth callback: an email that
-- is not in this table (and not in BOOTSTRAP_ADMIN_EMAILS, see below) does not
-- get an admin role assigned on sign-in.
--
-- ⚠ NO ROWS ARE SEEDED HERE, DELIBERATELY.
--
-- This is a publishable, deployment-agnostic template. Hardcoding anyone's
-- email address in a migration would (a) leak a real identity into every fork
-- of this repo and (b) make the first-admin bootstrap a code change rather than
-- a configuration change.
--
-- Instead: the FIRST admin(s) are identified by the `BOOTSTRAP_ADMIN_EMAILS`
-- environment variable (comma-separated), read by application code in a later
-- phase. On sign-in, an email present in BOOTSTRAP_ADMIN_EMAILS is upserted
-- into admin_users and granted the 'admin' role in user_roles using the service
-- role key. Every subsequent admin is added by an existing admin through the
-- admin UI, never by editing SQL. Sign-ins that match neither list land in a
-- pending-approval state with no user_roles row (and therefore, by the
-- deny-by-default capability model, no access to anything).
--
-- RLS is enabled with NO policies: this table is reachable only via the service
-- role (which bypasses RLS). That is the intended access model — an
-- RLS-enabled table with no policy denies every anon/authenticated request.
-- This matches the pattern used by the source project's admin_users table.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admin_users (
  email    text        PRIMARY KEY,
  added_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Defensive: if an earlier revision of this file (or an operator) ever created
-- a policy here, drop it. Service-role-only is the contract.
DROP POLICY IF EXISTS "admin_users_admin_read" ON public.admin_users;
DROP POLICY IF EXISTS "admin_users_self_read"  ON public.admin_users;

-- NOTE: the resource: tag for this table is applied in 003_role_expansion.sql
-- alongside every other tag, so the full resource map is reviewable in one place.
