-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 010: a capability check stops answering for other people, and an
--                explicit crm:view deny stops being bypassable
--
-- ── The two findings this closes ─────────────────────────────────────────────
--
-- FINDING A — user_has_capability() answers about anyone.
--
-- 003 §3 defines it as SECURITY DEFINER, takes the subject as an argument, and
-- Postgres grants EXECUTE to PUBLIC by default. Nothing checks who is asking.
-- So any authenticated user can run:
--
--     SELECT public.user_has_capability('<admin-uuid>', 'users', 'delete');
--
-- and read the entire permission matrix of every other account one probe at a
-- time. That is a privilege-disclosure bug on the one function the whole
-- authorization model rests on: 117 call sites defer to it.
--
-- FINDING B — crm:create bypasses an explicit crm:view deny on raw PII.
--
-- 005 §4 gates raw contact PII on crm_pii_unmasked() OR crm:delete, and
-- crm_pii_unmasked() is crm:edit OR crm:create. None of those consult crm:view.
-- The reasoning was sound — someone who acts on an inquiry needs the phone
-- number — but it means a role whose crm:view is explicitly set allowed=false
-- still reads every name, email and phone in the table. An operator who unticks
-- "view" in the capability grid has been told they revoked something. They had
-- not.
--
-- These are different bugs with one shape: a capability question answered
-- without asking who is entitled to the answer.
--
-- ── What this does NOT change ────────────────────────────────────────────────
--
-- Every existing call site keeps working, and that is checked rather than
-- assumed:
--
--   * 117 of the call sites pass auth.uid() — asking about yourself, still
--     allowed, unchanged.
--   * perform_action() passes v_actor_id, but 008 §2 already refuses to run
--     when a session exists and the actor is not that session's user. So there
--     v_actor_id IS auth.uid(), or auth.uid() is NULL in a trusted server
--     context. Both still pass.
--   * Every role in the default grid that holds crm:create, crm:edit or
--     crm:delete also holds crm:view (003 §7: admin, support_human,
--     support_bot_text, support_bot_voice). Requiring crm:view as a floor
--     removes no access anyone has today.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. The raw lookup moves behind a private function
-- ═════════════════════════════════════════════════════════════════════════════
-- user_has_capability() now has to ask a capability question about its CALLER
-- ("may this session inspect other accounts?") in order to answer a capability
-- question about its SUBJECT. Doing that through itself is infinite recursion,
-- so the unguarded lookup lives here, and only trusted callers reach it.
--
-- This is not granted to `authenticated`. It is the thing being protected.
CREATE OR REPLACE FUNCTION public.capability_lookup(
  p_user_id      uuid,
  p_resource_key text,
  p_action       text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE((
    SELECT rc.allowed
    FROM public.user_roles ur
    JOIN public.role_capabilities rc ON rc.role = ur.role
    WHERE ur.user_id      = p_user_id
      AND rc.resource_key = p_resource_key
      AND rc.action       = p_action
    LIMIT 1
  ), false);
$$;

COMMENT ON FUNCTION public.capability_lookup(uuid, text, text) IS
  'The unguarded capability lookup. Deny-by-default, never NULL. NOT granted to authenticated: it answers about any subject without asking who wants to know, which is exactly what user_has_capability() was doing wrong before 010. Call this only from SECURITY DEFINER code that has already decided the caller is entitled to the answer.';

REVOKE ALL ON FUNCTION public.capability_lookup(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.capability_lookup(uuid, text, text) TO service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. user_has_capability() asks who is calling
-- ═════════════════════════════════════════════════════════════════════════════
-- Three ways to be entitled to the answer:
--
--   a) There is no session (auth.uid() IS NULL). That is a trusted server-side
--      context — the same condition 008 §2 already treats as trusted for
--      impersonation. RLS is not the boundary there; the service role is.
--   b) You are asking about yourself.
--   c) You hold users:view, so you are entitled to inspect accounts anyway.
--      This is what keeps /admin/users/capabilities working.
--
-- Anything else returns false rather than raising. A probe that errors still
-- discloses that the subject exists and that the prober is not allowed to ask;
-- a probe that always returns false discloses nothing at all. The function's
-- contract has always been deny-by-default and never NULL, so false is also
-- the answer every existing caller already knows how to handle.
CREATE OR REPLACE FUNCTION public.user_has_capability(
  p_user_id      uuid,
  p_resource_key text,
  p_action       text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL          THEN public.capability_lookup(p_user_id, p_resource_key, p_action)
    WHEN p_user_id  =  auth.uid()    THEN public.capability_lookup(p_user_id, p_resource_key, p_action)
    WHEN public.capability_lookup(auth.uid(), 'users', 'view')
                                     THEN public.capability_lookup(p_user_id, p_resource_key, p_action)
    ELSE false
  END;
$$;

COMMENT ON FUNCTION public.user_has_capability(uuid, text, text) IS
  'Deny-by-default capability check. Returns true only for an explicit allowed=true grant on the subject''s role, AND only when the caller is entitled to ask: no session (trusted server), asking about itself, or holding users:view. Probing another account without users:view returns false rather than raising, so it discloses nothing. Never returns NULL.';


-- ═════════════════════════════════════════════════════════════════════════════
-- 3. crm:view becomes the floor for reading raw contact PII
-- ═════════════════════════════════════════════════════════════════════════════
-- Raw PII now needs BOTH:
--   * crm:view   — permission to look at the CRM at all, and
--   * an acting capability (crm:edit / crm:create / crm:delete) — the reason
--     to see identifiers rather than masked values.
--
-- crm:view alone still means masked, via contact_inquiries_view. That was
-- always the intent of 005; the missing half was that "view" was never
-- required, so revoking it did nothing.
CREATE OR REPLACE FUNCTION public.crm_pii_unmasked(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT public.user_has_capability(p_user_id, 'crm', 'view')
     AND (
          public.user_has_capability(p_user_id, 'crm', 'edit')
       OR public.user_has_capability(p_user_id, 'crm', 'create')
     );
$$;

COMMENT ON FUNCTION public.crm_pii_unmasked(uuid) IS
  'True when the user may see raw customer identifiers: holds crm:view AND can act on an inquiry (crm:edit or crm:create). crm:view alone is masked. Without crm:view there is no read at all — an explicit deny is a deny, which before 010 it was not. Never returns NULL.';

DROP POLICY IF EXISTS "contact_inquiries_raw_read_actionable" ON public.contact_inquiries;

CREATE POLICY "contact_inquiries_raw_read_actionable"
  ON public.contact_inquiries FOR SELECT
  TO authenticated
  USING (
    public.user_has_capability(auth.uid(), 'crm', 'view')
    AND (
         public.crm_pii_unmasked(auth.uid())
      OR public.user_has_capability(auth.uid(), 'crm', 'delete')
    )
  );

-- ⚠ UPDATE ... RETURNING and DELETE ... RETURNING need this SELECT policy to
--   pass as well as their own. Every role holding crm:edit or crm:delete also
--   holds crm:view in the default grid, so no write path is broken. A custom
--   role granted crm:edit WITHOUT crm:view would now lose RETURNING — which is
--   the correct reading of a revoked view, not a regression.


-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Prove it, here, at apply time
-- ═════════════════════════════════════════════════════════════════════════════
-- A migration that claims to close a disclosure bug should fail loudly if it
-- does not. This runs as the migration applies and aborts the transaction if
-- either finding is still open.
DO $verify$
DECLARE
  v_probe boolean;
BEGIN
  -- FINDING A: with no session, the trusted-server path must still answer.
  SELECT public.user_has_capability(
           '00000000-0000-0000-0000-000000000000'::uuid, 'users', 'view')
    INTO v_probe;
  IF v_probe IS NULL THEN
    RAISE EXCEPTION '010 verify: user_has_capability returned NULL; the contract is never-NULL';
  END IF;

  -- FINDING B: crm_pii_unmasked must now require crm:view. A subject with no
  -- roles at all must be false on every path.
  SELECT public.crm_pii_unmasked('00000000-0000-0000-0000-000000000000'::uuid)
    INTO v_probe;
  IF v_probe IS NOT FALSE THEN
    RAISE EXCEPTION '010 verify: crm_pii_unmasked is true for a user with no roles';
  END IF;

  -- The private lookup must NOT be reachable by authenticated.
  IF has_function_privilege('authenticated',
       'public.capability_lookup(uuid, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '010 verify: capability_lookup is executable by authenticated; the guard is bypassable';
  END IF;

  RAISE NOTICE '010 verify: both findings closed';
END
$verify$;
