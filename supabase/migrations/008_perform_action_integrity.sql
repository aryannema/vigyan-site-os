-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 008: perform_action() stops accepting fiction
--
-- ── The findings this closes ─────────────────────────────────────────────────
--
-- perform_action() is SECURITY DEFINER, is granted to `authenticated`, and is
-- the ONLY way a row enters action_audit_log from a session (004 §1 gives that
-- table no INSERT policy and no INSERT grant, on purpose). Two properties of
-- the function undermined the log it protects:
--
--   1. IT AUTHORIZED THE CLAIM, NOT THE MUTATION. `action = 'view'` — the one
--      action in the vocabulary that changes nothing — accepted a
--      {"before": ..., "after": ...} payload and wrote it verbatim. So the
--      least privileged holder of a resource grant (crm:view) could mint audit
--      rows that read exactly like a real triage action on a real lead:
--
--        SELECT perform_action(me,'crm','view',<real lead id>,
--                              '{"before":{"status":"new"},
--                                "after":{"status":"resolved by me"}}');
--
--      Nothing about that lead changed. An audit log that records changes that
--      did not happen is worse than no audit log, because it is believed.
--
--   2. `actor` WAS ATTACKER-CHOSEN FREE TEXT. p_actor was stored verbatim, and
--      the same identity has many spellings that all resolve: the uuid, the
--      braced uuid `{...}` (accepted by ::uuid), and the email in any case with
--      any surrounding whitespace. Three spellings produced three different
--      `actor` strings for one person, so "everything user X did" silently
--      under-reported — while the log still looked complete.
--
-- ── The rules, stated ────────────────────────────────────────────────────────
--
--   A. VIEW IS AUDIT-ONLY. For action = 'view', before_data and after_data are
--      always NULL. A payload supplied with a view is DISCARDED, not stored,
--      and the receipt says so (`payload_discarded: true`) so the caller is
--      told rather than quietly disbelieved. `view` records "I looked at this";
--      it is not a vehicle for asserting that state changed.
--
--      Discarding rather than raising is deliberate: a caller who passes a
--      payload has done nothing dangerous — the danger was that we BELIEVED
--      them — and a read path that starts throwing after this migration would
--      turn a logging refinement into an outage. The receipt makes the refusal
--      explicit, and the log carries no fiction either way.
--
--   B. `actor` IS THE RESOLVED IDENTITY. The audit row now stores the canonical
--      auth.users uuid in `actor`, so "everything user X did" is one equality
--      predicate. What the caller CLAIMED is not lost — it moves to the new
--      `actor_claim` column, preserving 004 §1's intent ("stored as given so the
--      log records what was claimed, not only what was resolved") while making
--      the claim a separate, clearly-labelled field rather than the identity.
--
-- ── What this migration deliberately does NOT do ─────────────────────────────
--
-- It does not verify that `target_id` names an existing row. target_id is free
-- text by design and legitimately holds things that are not row ids
-- ('hero-section', 'role_capabilities:viewer:blog:edit'), so there is nothing
-- generic to check it against. The real answer to "the audit record describes a
-- change that did not occur" for the two publishable tables is 007's
-- audit-by-construction trigger, which derives its rows from the data itself
-- and cannot be shaped by a caller at all.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. action_audit_log.actor_claim
-- ═════════════════════════════════════════════════════════════════════════════
-- Nullable: rows written by 007's triggers have no claim to record (nobody
-- asserted anything — the database observed a change), and rows written before
-- this migration have their claim in `actor` already.
ALTER TABLE public.action_audit_log
  ADD COLUMN IF NOT EXISTS actor_claim text;

COMMENT ON COLUMN public.action_audit_log.actor       IS
  'The RESOLVED actor: an auth.users uuid for a perform_action() call, or ''system:<db role>'' for a change observed by a trigger with no session identity. Canonical, so "everything actor X did" is one equality predicate.';
COMMENT ON COLUMN public.action_audit_log.actor_claim IS
  'The identity string the caller SUPPLIED to perform_action(), verbatim (uuid, braced uuid, email in any case). NULL when nothing was claimed. Never used for attribution — see actor.';

-- Historical rows keep whatever `actor` they were written with; they are not
-- rewritten. An append-only log is not append-only if a migration edits it.


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. perform_action()
-- ═════════════════════════════════════════════════════════════════════════════
-- Unchanged from 004: the signature, the argument validation, the actor
-- resolution (uuid or auth.users email), the anti-impersonation rule, the
-- deny-by-default capability check, the RAISE-on-denial contract, and the
-- before/after payload split. Only the two rules above are new, plus the two
-- extra receipt fields they need.
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
  v_caller    uuid := auth.uid();
  v_actor_id  uuid;
  v_before    jsonb;
  v_after     jsonb;
  v_discarded boolean := false;
  v_id        uuid;
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
  -- Rule: if there IS a session, the actor must be that session's user. A NULL
  -- auth.uid() means a trusted server-side context. Since 006 the session's
  -- identity is no longer session-writable, so this check now rests on
  -- something the caller cannot set.
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
  -- RULE A: `view` mutates nothing, so it may not carry state. Any payload is
  -- discarded and reported back rather than recorded as if it were a change.
  IF p_action = 'view' THEN
    v_before    := NULL;
    v_after     := NULL;
    v_discarded := p_payload IS NOT NULL;
  ELSIF p_payload IS NOT NULL
     AND jsonb_typeof(p_payload) = 'object'
     AND (p_payload ? 'before' OR p_payload ? 'after') THEN
    v_before := p_payload -> 'before';
    v_after  := p_payload -> 'after';
  ELSE
    v_before := NULL;
    v_after  := p_payload;
  END IF;

  -- RULE B: `actor` is the resolved identity; the claim is kept beside it.
  INSERT INTO public.action_audit_log
    (actor, actor_claim, resource_key, action, target_id, before_data, after_data)
  VALUES
    (v_actor_id::text, p_actor, p_resource_key, p_action, p_target_id, v_before, v_after)
  RETURNING id INTO v_id;

  -- ── 5. receipt ─────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',               true,
    'audit_id',         v_id,
    'actor',            v_actor_id::text,
    'actor_claim',      p_actor,
    'actor_user_id',    v_actor_id,
    'resource_key',     p_resource_key,
    'action',           p_action,
    'target_id',        p_target_id,
    'payload_discarded', v_discarded
  );
END;
$$;

COMMENT ON FUNCTION public.perform_action(text, text, text, text, jsonb) IS
  'Atomically authorizes and audits a governed action. Raises insufficient_privilege on denial. `actor` is recorded as the RESOLVED auth.users uuid (the supplied string is kept in actor_claim), and action=''view'' never records before/after state — a payload passed with a view is discarded and reported as payload_discarded in the receipt.';

-- Grants are unchanged from 004; restated so this file is self-contained if it
-- is ever applied to a database where a re-run of 004 reset them.
REVOKE ALL ON FUNCTION public.perform_action(text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.perform_action(text, text, text, text, jsonb)
  TO authenticated, service_role;
