-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 027: manual "purge now" for the account-deletion grace period --
-- symmetric with restored_at/restored_by (022/024). Operator-requested so
-- test accounts (test email/WhatsApp number pairs) can be permanently
-- purged immediately during testing instead of waiting the full 15 days for
-- the cron job (api/cron/purge-deletion-grace) to do it. Same audit table
-- either way -- a purge is a purge, whether it happens via the cron or an
-- admin clicking "Purge now".
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.account_deletion_log
  ADD COLUMN IF NOT EXISTS purged_at timestamptz;

ALTER TABLE public.account_deletion_log
  ADD COLUMN IF NOT EXISTS purged_by uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.account_deletion_log.purged_by IS
  'NULL if purged by the scheduled cron job (api/cron/purge-deletion-grace) -- only set when an admin used the manual "Purge now" action (/admin/account-deletions).';
