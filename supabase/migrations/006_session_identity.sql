-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 006: the session's identity stops being session-writable
--
-- ⚠ THIS FILE BELONGS TO THE LOCAL-DEV AUTH STUB LINEAGE (see 000).
--   Like 000, it must NOT be run against a GoTrue/Supabase-managed database:
--   there, `auth.uid()` is GoTrue's, and the identity arrives in
--   `request.jwt.claims` from a JWT that PostgREST has already verified.
--
-- ── The finding this closes ──────────────────────────────────────────────────
--
-- 000 derives auth.uid() from the `request.jwt.claims` GUC. 004 §2 justifies
-- perform_action()'s anti-impersonation check by comparing p_actor against
-- auth.uid(); 003's and 005's policies pass auth.uid() to
-- user_has_capability(). Every rule in the system therefore rests on auth.uid()
-- being something the session cannot choose.
--
-- It was not. `auth.local_login()` is correctly `REVOKE`d from PUBLIC, but a
-- bare
--
--     SELECT set_config('request.jwt.claims', '{"sub":"<any uuid>"}', true);
--
-- achieves exactly the same thing and is callable by anyone — including the
-- `authenticated` role. One statement promoted a viewer to any other identity,
-- an admin's included.
--
-- ── Why the fix is not "revoke set_config" ───────────────────────────────────
--
-- Two independent reasons, both verified against this database:
--
--   1. `set_config()` lives in pg_catalog and is owned by the bootstrap
--      superuser. The application owner role (`vigyan_site_os`, NOT a
--      superuser) cannot revoke it:
--          REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(...) FROM PUBLIC;
--          WARNING: no privileges could be revoked for "set_config"
--
--   2. Even as superuser it would not be enough. `request.jwt.claims` is a
--      CUSTOMIZED OPTION (a placeholder GUC with a dotted name). Postgres lets
--      any role `SET` such a parameter, and `GRANT ... ON PARAMETER` (PG15+)
--      can only ADD privileges — there is no way to revoke the default ability
--      to set a custom GUC. Blocking `set_config()` would leave the plain
--      `SET request.jwt.claims = '...'` form wide open.
--
-- The conclusion is structural: as long as the identity LIVES in a session
-- variable, the session owns it. So it is moved out of the session.
--
-- ── The mechanism ────────────────────────────────────────────────────────────
--
-- `auth.session_identity` is an ordinary table in the `auth` schema:
--
--   * only the owner can write it, and only through the SECURITY DEFINER
--     `auth.set_session_identity()` / `auth.clear_session_identity()` pair,
--     which are REVOKEd from PUBLIC exactly as `auth.local_login()` already was;
--   * `anon` and `authenticated` hold no privilege on the table at all, and it
--     has RLS enabled with no policies as a second, independent gate;
--   * `auth.uid()` becomes SECURITY DEFINER and reads THAT, never the GUC.
--
-- A row is keyed by `backend_pid` and is only honoured while
-- `xact_id = pg_current_xact_id_if_assigned()`, i.e. for the transaction that
-- established it. That preserves the property app/admin/lib/db.ts and
-- app/api/mcp/route.ts both rely on today — an impersonated identity is
-- TRANSACTION-LOCAL and cannot leak onto the next borrower of a pooled
-- connection — while making the identity unreachable from the session's own SQL.
--
-- `set_config('request.jwt.claims', ...)` is still performed by the setter, so
-- anything that reads the claims blob for non-identity purposes keeps working.
-- It is now a MIRROR of the identity, not its source: overwriting it changes
-- nothing that any policy consults.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. auth.session_identity — the identity, somewhere the session cannot write
-- ═════════════════════════════════════════════════════════════════════════════
-- No FK to auth.users on purpose: 000's contract is that local_login() accepts
-- a uuid and auth.uid() reports it back, and capability resolution already
-- denies everything to an identity with no user_roles row. Adding referential
-- integrity here would change the stub's semantics rather than its safety.
CREATE TABLE IF NOT EXISTS auth.session_identity (
  backend_pid    integer     PRIMARY KEY,
  backend_start  timestamptz,             -- diagnostics only; the xid is the gate
  xact_id        xid8        NOT NULL,
  user_id        uuid        NOT NULL,
  established_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE auth.session_identity IS
  'LOCAL DEV STUB — the authenticated identity of a backend, for the transaction that established it. Written only by auth.set_session_identity() (SECURITY DEFINER, owner-only). Intentionally NOT tagged with a resource: key; it is not application data.';

ALTER TABLE auth.session_identity ENABLE ROW LEVEL SECURITY;
-- NO POLICIES, ON PURPOSE. Nothing but the SECURITY DEFINER functions below
-- (which run as the owner and so bypass RLS) may see or touch this table.

REVOKE ALL ON auth.session_identity FROM PUBLIC;
REVOKE ALL ON auth.session_identity FROM anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. The only way in: auth.set_session_identity() / auth.clear_session_identity()
-- ═════════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER + REVOKE FROM PUBLIC is the same pattern 000 used for
-- `auth.local_login()`, and it is the pattern the real deployment will keep:
-- the request layer (PostgREST with a verified JWT, or the Next.js server after
-- validating a session cookie) is trusted to say who is calling; the session
-- itself never is.
CREATE OR REPLACE FUNCTION auth.set_session_identity(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, pg_catalog
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    PERFORM auth.clear_session_identity();
    RETURN;
  END IF;

  -- Housekeeping: a committed transaction leaves its row behind (it is no
  -- longer honoured — the xid will never match again — but it is clutter).
  DELETE FROM auth.session_identity
   WHERE established_at < now() - interval '1 day';

  INSERT INTO auth.session_identity (backend_pid, backend_start, xact_id, user_id)
  VALUES (
    pg_backend_pid(),
    (SELECT a.backend_start FROM pg_stat_activity a WHERE a.pid = pg_backend_pid()),
    pg_current_xact_id(),
    p_user_id
  )
  ON CONFLICT (backend_pid) DO UPDATE
     SET backend_start  = EXCLUDED.backend_start,
         xact_id        = EXCLUDED.xact_id,
         user_id        = EXCLUDED.user_id,
         established_at = now();

  -- Mirror, for compatibility with anything that reads the claims blob. NOT the
  -- source of truth any more: see auth.uid() below.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', p_user_id, 'role', 'authenticated')::text,
                     true);
END;
$$;

CREATE OR REPLACE FUNCTION auth.clear_session_identity()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, pg_catalog
AS $$
BEGIN
  DELETE FROM auth.session_identity WHERE backend_pid = pg_backend_pid();
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;

COMMENT ON FUNCTION auth.set_session_identity(uuid) IS
  'Establishes the calling backend''s authenticated identity for the CURRENT TRANSACTION. Owner/service_role only — a session must never be able to choose its own identity.';
COMMENT ON FUNCTION auth.clear_session_identity() IS
  'Drops the calling backend''s authenticated identity. Owner/service_role only.';


-- ═════════════════════════════════════════════════════════════════════════════
-- 3. auth.uid() — now reads the table, never the GUC
-- ═════════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER because `authenticated` deliberately has no privilege on
-- auth.session_identity; STABLE and a single primary-key lookup because RLS
-- policies call this once per candidate row.
--
-- The `xact_id` predicate is what makes the identity transaction-local: a row
-- left behind by an earlier, committed transaction on the same pooled backend
-- can never match again, because xid8 values are never reused.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = auth, pg_catalog
AS $$
  SELECT s.user_id
    FROM auth.session_identity s
   WHERE s.backend_pid = pg_backend_pid()
     AND s.xact_id     = pg_current_xact_id_if_assigned();
$$;

COMMENT ON FUNCTION auth.uid() IS
  'LOCAL DEV STUB of Supabase auth.uid(). Reads auth.session_identity, which only auth.set_session_identity() (owner-only, SECURITY DEFINER) can write. Deliberately does NOT read request.jwt.claims: that GUC is settable by any session, so an identity derived from it can be forged with one statement.';


-- ═════════════════════════════════════════════════════════════════════════════
-- 4. The 000 helpers, re-pointed at the new mechanism
-- ═════════════════════════════════════════════════════════════════════════════
-- Same names, same signatures, same owner-only grants — every existing caller
-- (tests/helpers/db.ts, psql sessions) keeps working unchanged.
--
-- BEHAVIOUR CHANGE, deliberate: local_login() used to set a SESSION-scoped GUC
-- that survived ROLLBACK. The identity is now transaction-scoped, so a login
-- performed inside a transaction is undone when that transaction (or a
-- SAVEPOINT enclosing it) is rolled back. That is the safer default — it is the
-- property that stops an impersonation from outliving the request that
-- established it — and it is what the pooled admin/MCP write paths already
-- assumed they were getting from `set_config(..., true)`.
CREATE OR REPLACE FUNCTION auth.local_login(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM auth.set_session_identity(p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION auth.local_logout()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM auth.clear_session_identity();
END;
$$;


-- ═════════════════════════════════════════════════════════════════════════════
-- 5. Grants
-- ═════════════════════════════════════════════════════════════════════════════
-- auth.uid() stays callable by everyone: RLS policy expressions are evaluated
-- as the calling role, so anon and authenticated must be able to ask WHO they
-- are. They still cannot say who they are.
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- The setters are the boundary. PUBLIC (hence anon and authenticated) gets
-- nothing; the trusted server identity gets EXECUTE, exactly like 000 intended
-- for auth.local_login().
REVOKE ALL ON FUNCTION auth.set_session_identity(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.clear_session_identity()   FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.local_login(uuid)          FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.local_logout()             FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.set_session_identity(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION auth.clear_session_identity()   TO service_role;
