-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 024: account_deletion_log.restored_by -- WHO restored an account
-- within its grace period, not just that a restore happened. Split out from
-- migration 022's restored_at because that column alone doesn't answer "which
-- admin did this" -- a real gap for an action with this much consequence.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.account_deletion_log
  ADD COLUMN IF NOT EXISTS restored_by uuid REFERENCES auth.users(id);
