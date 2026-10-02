-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 026: allow 'admin_action' as a third account_deletion_log.method
-- value, for the new /admin/accounts page's admin-initiated deletion (spam/
-- fake accounts, etc.) -- reuses the exact same executeAccountDeletion()
-- executor as the two user-initiated flows (same safety properties: no hard
-- delete of auth.users, 15-day recoverable grace period), just a third
-- caller.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.account_deletion_log DROP CONSTRAINT IF EXISTS account_deletion_log_method_check;
ALTER TABLE public.account_deletion_log
  ADD CONSTRAINT account_deletion_log_method_check
  CHECK (method IN ('self_service', 'verified_request', 'admin_action'));
