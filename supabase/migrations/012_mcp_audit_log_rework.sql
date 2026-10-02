-- 012_mcp_audit_log_rework.sql
--
-- Un-deprecates mcp_audit_log as the permanent, correct audit mechanism for
-- agent/MCP-driven writes -- action_audit_log/perform_action() (004) requires
-- p_actor to resolve to a real auth.users row, which agents fundamentally
-- don't have (no login session, no email). Forcing agent writes through that
-- path would mean fabricating fake user accounts for a shared-secret bearer
-- caller, which is the wrong shape for what these are. Two tables, one per
-- caller kind (human admin-UI writes vs agent/MCP writes), not three, not one.
--
-- Adds: resource_key/action/target_id/before_data/after_data (same column
-- shape and resource_key vocabulary as action_audit_log -- 'blog', 'careers',
-- 'cms', etc., see 003_role_expansion.sql's COMMENT ON TABLE tags -- so the
-- two tables UNION cleanly into one admin-facing view), public_ip (observed
-- from the request itself, via the reverse proxy's X-Forwarded-For -- caller
-- cannot spoof this), local_ip (self-reported by the caller, same
-- claim-not-proof trust level as caller_identity -- private IPs are never
-- visible over the network, there is no way to observe this objectively).
--
-- changed_by is kept (not dropped) for backward compatibility with existing
-- rows written before this migration; new rows populate caller_identity
-- instead, which callers can no longer omit (enforced at the application
-- layer -- resolveCallerIdentity() now fails closed on an unrecognized or
-- absent bearer token, per the 2026-08-15 pre-shared-key-per-caller design;
-- see docs/VIGYAN_SECRETS.md "MCP_CALLER_KEYS").

ALTER TABLE public.mcp_audit_log
  ADD COLUMN IF NOT EXISTS caller_identity text,
  ADD COLUMN IF NOT EXISTS resource_key    text,
  ADD COLUMN IF NOT EXISTS action          text,
  ADD COLUMN IF NOT EXISTS target_id       text,
  ADD COLUMN IF NOT EXISTS before_data     jsonb,
  ADD COLUMN IF NOT EXISTS after_data      jsonb,
  ADD COLUMN IF NOT EXISTS public_ip       inet,
  ADD COLUMN IF NOT EXISTS local_ip        text;

COMMENT ON TABLE public.mcp_audit_log IS
  'Audit trail for agent/MCP-driven writes (bearer-key callers, no auth.users identity). Sibling to action_audit_log, which is for human admin-UI writes. UNIONed into admin_unified_audit_log for a single combined view.';

COMMENT ON COLUMN public.mcp_audit_log.caller_identity IS
  'Which pre-shared key the caller presented, resolved server-side from MCP_CALLER_KEYS -- authentication IS identity here, not a caller-supplied claim. NOT NULL is enforced at the application layer (fail closed on unrecognized key), not a DB constraint, so existing pre-migration rows are not invalidated.';

COMMENT ON COLUMN public.mcp_audit_log.public_ip IS
  'Observed from the request via the reverse proxy X-Forwarded-For header -- not caller-supplied, cannot be spoofed by the caller.';

COMMENT ON COLUMN public.mcp_audit_log.local_ip IS
  'Self-reported by the caller (private IPs are never visible over the network). Same trust level as caller_identity claims -- evidence of what was asserted, not verified fact.';

-- Single combined view for the admin UI: human writes (action_audit_log) and
-- agent writes (mcp_audit_log) side by side, distinguished by `source`.
CREATE OR REPLACE VIEW public.admin_unified_audit_log AS
SELECT
  'human'::text          AS source,
  id,
  actor                  AS caller_identity,
  actor_claim,
  NULL::text             AS tool_name,
  resource_key,
  action,
  target_id,
  before_data,
  after_data,
  NULL::inet             AS public_ip,
  NULL::text             AS local_ip,
  created_at
FROM public.action_audit_log
UNION ALL
SELECT
  'agent'::text           AS source,
  id,
  COALESCE(caller_identity, changed_by) AS caller_identity,
  NULL::text              AS actor_claim,
  tool_name,
  resource_key,
  action,
  target_id,
  before_data,
  after_data,
  public_ip,
  local_ip,
  created_at
FROM public.mcp_audit_log
ORDER BY created_at DESC;

COMMENT ON VIEW public.admin_unified_audit_log IS
  'Combined human + agent audit trail for the admin UI. source distinguishes which table a row came from.';

-- Same access pattern as the underlying tables -- owner-role connection only,
-- no RLS-bypassing anon/authenticated grant.
REVOKE ALL ON public.admin_unified_audit_log FROM PUBLIC, anon, authenticated;
