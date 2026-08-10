-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 000: LOCAL-DEV-ONLY auth schema stub
--
-- ⚠ THIS FILE IS A LOCAL DEVELOPMENT SHIM. IT IS NOT PART OF THE PRODUCT.
--
-- Migrations 001-004 reference `auth.users(id)` (foreign keys) and `auth.uid()`
-- (RLS policies). In a real deployment those are provided by GoTrue — either
-- Supabase Cloud or a self-hosted GoTrue instance — which owns the `auth`
-- schema and creates a far richer `auth.users` table.
--
-- On a bare local Postgres there is no GoTrue yet (auth-server setup is out of
-- scope for this phase), so this migration creates the minimum surface the
-- later migrations need, purely so they can be applied and tested locally.
-- This mirrors the pattern already established in vigyanbytes-web's local
-- bare-metal Postgres + PostgREST stack.
--
-- WHEN GOTRUE IS INTRODUCED: DO NOT RUN THIS FILE against that database.
-- GoTrue will create `auth.users` and `auth.uid()` itself, and running this
-- would be at best a no-op and at worst a conflict. Every statement here is
-- guarded with IF NOT EXISTS / CREATE OR REPLACE, but the correct action is
-- simply to skip 000 on any GoTrue-backed database.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;


-- ── auth.users — stub ────────────────────────────────────────────────────────
-- Minimal shape: only the columns migrations 001-004 actually reference.
-- The real GoTrue table is a superset of this (encrypted_password, raw_app_meta_data,
-- confirmed_at, etc.), so FKs and policies written against these columns keep working.
CREATE TABLE IF NOT EXISTS auth.users (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text        UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE auth.users IS
  'LOCAL DEV STUB — replaced by the real GoTrue-managed auth.users. Intentionally NOT tagged with a resource: key.';


-- ── auth.uid() — stub ────────────────────────────────────────────────────────
-- Reproduces Supabase/PostgREST semantics: the authenticated user id is the
-- `sub` claim of the verified JWT, which PostgREST exposes to SQL as the GUC
-- `request.jwt.claims`. Returns NULL when there is no JWT (anon, or a direct
-- psql session), which is exactly what the RLS policies expect.
--
-- Wrapped in an exception handler so a malformed/absent GUC yields NULL rather
-- than aborting the surrounding query (an error here would fail-open into a
-- query error, not a permission grant, but NULL is the correct semantic).
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_claims text;
BEGIN
  v_claims := current_setting('request.jwt.claims', true);
  IF v_claims IS NULL OR v_claims = '' THEN
    RETURN NULL;
  END IF;
  RETURN NULLIF(v_claims::jsonb ->> 'sub', '')::uuid;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION auth.uid() IS
  'LOCAL DEV STUB of Supabase auth.uid(). Reads the JWT sub claim from the request.jwt.claims GUC. Replaced by GoTrue/Supabase in real deployments.';


-- ── Local testing helper ─────────────────────────────────────────────────────
-- Lets a psql session impersonate an authenticated user so RLS can be exercised
-- without a running PostgREST/GoTrue. LOCAL DEV ONLY — never grant this in prod.
--   SELECT auth.local_login('<uuid>');   -- then SET ROLE authenticated;
--   SELECT auth.local_logout();
CREATE OR REPLACE FUNCTION auth.local_login(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', p_user_id, 'role', 'authenticated')::text,
                     false);
END;
$$;

CREATE OR REPLACE FUNCTION auth.local_logout()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '', false);
END;
$$;

COMMENT ON FUNCTION auth.local_login(uuid) IS
  'LOCAL DEV STUB ONLY — fakes an authenticated session for RLS testing from psql. Must not exist in any deployed database.';


-- ── Grants ───────────────────────────────────────────────────────────────────
-- RLS policy expressions are evaluated as the CALLING role, so anon and
-- authenticated must be able to reach auth.uid(). This mirrors what Supabase
-- grants on its own auth schema. auth.users itself is NOT granted to anyone:
-- nothing in 001-004 reads it as a non-owner.
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- The impersonation helper stays owner-only.
REVOKE ALL ON FUNCTION auth.local_login(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.local_logout()    FROM PUBLIC;
