-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 022: 15-day recoverable grace period on account deletion.
--
-- Deliberately NOT a decrypt-anytime admin backdoor -- that would defeat the
-- actual legal meaning of "erasure" under DPDP (see the design discussion
-- recorded in work-units/session-state.json, 2026-09-09). This is a bounded,
-- time-limited safety net against fraudulent/mistaken deletion requests: an
-- encrypted snapshot survives for exactly 15 days, admin-restorable within
-- that window, then a cron job purges it permanently -- after which the data
-- is genuinely, irrecoverably gone, same as if this table never existed.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.account_deletion_grace (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  encrypted_snapshot text        NOT NULL,
  purge_after        timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.account_deletion_grace IS
  'AES-256-GCM encrypted PII snapshot (site_accounts fields) taken immediately before anonymization, held ONLY until purge_after (created_at + 15 days). Admin-restorable within that window via a dedicated admin action; purged permanently by a cron job after. Service-role only -- no client access, no read policy for any role.';

CREATE INDEX IF NOT EXISTS account_deletion_grace_purge_after_idx
  ON public.account_deletion_grace (purge_after);

ALTER TABLE public.account_deletion_grace ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_grace FROM PUBLIC, anon, authenticated;

-- account_deletion_log (021) gains an optional pointer to the grace-period
-- window, purely informational (a timestamp, not PII) -- lets an admin see
-- at a glance whether a given deletion is still within its recovery window
-- without needing to separately query account_deletion_grace.
ALTER TABLE public.account_deletion_log
  ADD COLUMN IF NOT EXISTS grace_expires_at timestamptz;

ALTER TABLE public.account_deletion_log
  ADD COLUMN IF NOT EXISTS restored_at timestamptz;
