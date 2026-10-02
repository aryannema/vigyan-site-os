-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 044: WhatsApp opt-out state + consent purpose.
--
-- Two gaps found on 2026-09-17.
--
-- 1. The webhook had no STOP. Meta expects opt-out keywords to be honoured,
--    and an ignored STOP is the fastest route to blocks and reports -- which
--    is what actually collapses a number's quality rating and gets it banned.
--    There was nowhere to record that someone had opted out, so there was no
--    way to honour it even if it had been parsed.
--
-- 2. whatsapp_consent_log records WHAT text a user agreed to but not WHICH
--    PURPOSE it served. Every consent captured so far reads "...may message
--    you on this WhatsApp number to verify it" -- scoped to verification
--    alone. Without a purpose column, "which numbers may receive a campaign?"
--    cannot be answered from the data, and the append-only log would be
--    evidence that the consent was for something narrower.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Opt-out lives on the conversation, keyed by phone number ─────────────
-- Deliberately NOT on site_accounts: a person can opt out from a number that
-- has no account at all, and that opt-out must still be honoured.
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS opted_out_at timestamptz;

COMMENT ON COLUMN public.whatsapp_conversations.opted_out_at IS
  'Set when the contact sent STOP (or an equivalent keyword). While set, send nothing except the confirmation of the opt-out itself and a reply to an explicit START. Cleared by START.';

CREATE INDEX IF NOT EXISTS whatsapp_conversations_opted_out_idx
  ON public.whatsapp_conversations (opted_out_at)
  WHERE opted_out_at IS NOT NULL;

-- ── 2. Consent gains an explicit purpose ────────────────────────────────────
ALTER TABLE public.whatsapp_consent_log
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'verification';

-- Existing rows are backfilled by the DEFAULT, which is correct rather than
-- convenient: every consent captured before this migration used the
-- verification wording. Marking them anything else would be a false record.
ALTER TABLE public.whatsapp_consent_log
  DROP CONSTRAINT IF EXISTS whatsapp_consent_log_purpose_check;
ALTER TABLE public.whatsapp_consent_log
  ADD CONSTRAINT whatsapp_consent_log_purpose_check
  CHECK (purpose IN ('verification', 'transactional', 'marketing', 'revoked'));

COMMENT ON COLUMN public.whatsapp_consent_log.purpose IS
  'What the consent actually covers. Marketing sends must be restricted to numbers whose LATEST row is purpose=marketing with no later revoked row. Defaults to verification because that is what every pre-2026-09-17 row consented to.';

CREATE INDEX IF NOT EXISTS whatsapp_consent_log_purpose_idx
  ON public.whatsapp_consent_log (phone_number, purpose, consented_at DESC);
