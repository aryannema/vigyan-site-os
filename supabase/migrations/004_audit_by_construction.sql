-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 004: Auditability by construction
--
-- The problem this solves: in the source project, audit logging was a property
-- of ONE code path (the MCP route wrote mcp_audit_log). Every other write —
-- admin UI, webhook, script, psql — was invisible. Adding a new feature meant
-- remembering to add logging to it, and nobody ever does.
--
-- The inversion here: authorization and audit are the SAME operation.
-- perform_action() checks the capability and writes the audit row atomically.
-- A caller cannot get the permission decision without also producing the
-- record, because there is only one function and it does both. New resource
-- types inherit audit logging for free — action_audit_log.resource_key is free
-- text, so a resource invented in a future migration needs no changes here.
--
-- ⚠ ADOPTION STATUS: this migration builds the MECHANISM. It does NOT rewrite
--   existing write paths to use it — that is deliberate and was approved as
--   incremental adoption: each admin surface routes through perform_action()
--   as it is built. Until a surface adopts it, that surface's writes are
--   governed by RLS alone and are not audited. Nothing in this file is
--   load-bearing for correctness of 001-003.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. action_audit_log
-- ═════════════════════════════════════════════════════════════════════════════
-- Generalises mcp_audit_log from "MCP tool calls" to "any governed write".
--
--   actor        opaque identity string as supplied by the caller — a uuid for
--                a human user, or (in a later phase) a bot service-token name.
--                Stored as given so the log records what was claimed, not only
--                what was resolved.
--   resource_key free text on purpose: mirrors role_capabilities.resource_key,
--                so future resources need no migration.
--   before_data  state prior to the change, when the caller supplies it.
--   after_data   state after the change, or the request payload.
CREATE TABLE IF NOT EXISTS public.action_audit_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor        text        NOT NULL,
  resource_key text        NOT NULL,
  action       text        NOT NULL,
  target_id    text,
  before_data  jsonb,
  after_data   jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS action_audit_log_resource_created_idx
  ON public.action_audit_log (resource_key, created_at DESC);
CREATE INDEX IF NOT EXISTS action_audit_log_actor_created_idx
  ON public.action_audit_log (actor, created_at DESC);
CREATE INDEX IF NOT EXISTS action_audit_log_target_idx
  ON public.action_audit_log (target_id) WHERE target_id IS NOT NULL;

ALTER TABLE public.action_audit_log ENABLE ROW LEVEL SECURITY;

-- Deliberately NOT tagged with a resource: key. See the untagged list in 003 —
-- whether audit trails get their own `audit` resource is an open design
-- question, and guessing would freeze it.
-- TODO(phase-2-or-later): introduce an `audit` resource key + tag this table
-- and mcp_audit_log, so "who may read the audit log" stops borrowing users:view.

DROP POLICY IF EXISTS "action_audit_log_capability_read" ON public.action_audit_log;
CREATE POLICY "action_audit_log_capability_read"
  ON public.action_audit_log FOR SELECT
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'users', 'view'));

-- NO INSERT/UPDATE/DELETE POLICIES, ON PURPOSE — not even for admin.
-- Rows arrive exclusively through perform_action() (SECURITY DEFINER, owned by
-- the database owner, so it bypasses RLS) or through the service role. An audit
-- log that its subjects can write to, amend, or erase is decoration.


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. perform_action()
-- ═════════════════════════════════════════════════════════════════════════════
-- SIGNATURE CHOICE (documented, as the spec allows discretion here):
-- kept as the specified 5 parameters, with p_target_id and p_payload defaulted
-- to NULL so read-ish actions can be logged with a 3-argument call.
--
-- p_payload -> before_data/after_data convention:
--   * a jsonb OBJECT containing a 'before' and/or 'after' key is SPLIT into the
--     two columns   →  {"before": {...}, "after": {...}}
--   * anything else is stored whole in after_data
--   This keeps the specified single-payload signature while still supporting
--   the before/after columns the audit table needs.
--
-- Behaviour:
--   1. resolve p_actor to a user id
--   2. refuse to let an authenticated session act as somebody else
--   3. deny unless user_has_capability() says yes
--   4. write the audit row
--   5. return a jsonb receipt (including the audit row id) so callers can
--      reference the record they just created
--   Denials RAISE. There is no "returned false" path, so a caller that ignores
--   the result still cannot proceed past a denial inside a transaction.
--
-- TODO(phase-1.5-or-later): bot service-token identity resolution.
--   support_bot_text / support_bot_voice are named service tokens, not OAuth
--   accounts, so they have no auth.users row and no user_roles row today. This
--   function currently resolves p_actor ONLY as a user_roles-backed identity
--   (uuid, or an auth.users email). When service tokens land, add a
--   service_tokens(token_name, role) lookup as a second resolution branch and
--   have user_has_capability take a role rather than a user id. Until then a
--   bot must call through the service role, which bypasses this function — and
--   therefore is not audited by it. Not blocking: no bot write path exists yet.
CREATE OR REPLACE FUNCTION public.perform_action(
  p_actor        text,
  p_resource_key text,
  p_action       text,
  p_target_id    text  DEFAULT NULL,
  p_payload      jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_actor_id uuid;
  v_before   jsonb;
  v_after    jsonb;
  v_id       uuid;
BEGIN
  -- ── argument validation ────────────────────────────────────────────────
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'perform_action: p_actor is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_resource_key IS NULL OR p_resource_key !~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'perform_action: invalid resource_key %', p_resource_key
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_action IS NULL OR p_action NOT IN ('view','create','edit','delete','publish') THEN
    RAISE EXCEPTION 'perform_action: invalid action %', p_action
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 1. resolve the actor ───────────────────────────────────────────────
  -- Accept either a uuid or an email address; both must land on an auth.users
  -- row, which is the only identity kind this phase can resolve.
  BEGIN
    v_actor_id := p_actor::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_actor_id := NULL;
  END;

  IF v_actor_id IS NULL THEN
    SELECT u.id INTO v_actor_id
    FROM auth.users u
    WHERE lower(u.email) = lower(btrim(p_actor));
  END IF;

  -- ── 2. anti-impersonation ──────────────────────────────────────────────
  -- This function is SECURITY DEFINER, so without this check any authenticated
  -- caller could pass an admin's uuid as p_actor and borrow their capabilities.
  -- Rule: if there IS a JWT session, the actor must be that session's user.
  -- A NULL auth.uid() means a trusted server-side context (service role, or a
  -- direct backend connection), which is permitted to act on a user's behalf.
  IF v_caller IS NOT NULL AND v_actor_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'perform_action: actor % does not match the authenticated session', p_actor
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'perform_action: actor % could not be resolved to a known identity', p_actor
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── 3. authorize (deny by default) ─────────────────────────────────────
  IF NOT public.user_has_capability(v_actor_id, p_resource_key, p_action) THEN
    RAISE EXCEPTION 'perform_action: % is not permitted to % on %', p_actor, p_action, p_resource_key
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── 4. audit ───────────────────────────────────────────────────────────
  IF p_payload IS NOT NULL
     AND jsonb_typeof(p_payload) = 'object'
     AND (p_payload ? 'before' OR p_payload ? 'after') THEN
    v_before := p_payload -> 'before';
    v_after  := p_payload -> 'after';
  ELSE
    v_before := NULL;
    v_after  := p_payload;
  END IF;

  INSERT INTO public.action_audit_log
    (actor, resource_key, action, target_id, before_data, after_data)
  VALUES
    (p_actor, p_resource_key, p_action, p_target_id, v_before, v_after)
  RETURNING id INTO v_id;

  -- ── 5. receipt ─────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',            true,
    'audit_id',      v_id,
    'actor',         p_actor,
    'actor_user_id', v_actor_id,
    'resource_key',  p_resource_key,
    'action',        p_action,
    'target_id',     p_target_id
  );
END;
$$;

COMMENT ON FUNCTION public.perform_action(text, text, text, text, jsonb) IS
  'Atomically authorizes and audits a governed action. Raises insufficient_privilege on denial; returns a jsonb receipt containing the action_audit_log row id on success. Mechanism is complete; adoption by existing write paths is incremental.';

-- SECURITY DEFINER + default EXECUTE-to-PUBLIC would let any role (including
-- anon) probe capabilities and stuff the audit log. Lock down and re-grant.
REVOKE ALL ON FUNCTION public.perform_action(text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.perform_action(text, text, text, text, jsonb)
  TO authenticated, service_role;

-- Table grants (see the rationale in 003 §9). SELECT only for authenticated —
-- the absence of INSERT/UPDATE/DELETE grants here is a second, independent gate
-- on top of the absence of write policies above. Nothing for anon.
REVOKE ALL ON public.action_audit_log FROM anon, authenticated;
GRANT SELECT ON public.action_audit_log TO authenticated;
GRANT ALL    ON public.action_audit_log TO service_role;
