-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 019: whatsapp_consent_log -- DPDP-style audit trail for WhatsApp
-- number verification consent, part of the template-free verification flow
-- (docs/OPS.md §13.4). Append-only by design: a consent record must never be
-- editable/overwritable after the fact -- that's what makes it usable as an
-- audit trail, not just a UI convenience flag.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.whatsapp_consent_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number  text        NOT NULL,
  consent_text  text        NOT NULL,
  consented_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_consent_log_user_idx
  ON public.whatsapp_consent_log (user_id, created_at DESC);

COMMENT ON TABLE public.whatsapp_consent_log IS
  'DPDP-style audit trail: exact consent text + timestamp shown to the user before their WhatsApp number was collected/verified. Append-only -- no UPDATE/DELETE policy exists, by design. Self-insert/self-read only.';

ALTER TABLE public.whatsapp_consent_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_consent_log_self_insert" ON public.whatsapp_consent_log;
CREATE POLICY "whatsapp_consent_log_self_insert"
  ON public.whatsapp_consent_log FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "whatsapp_consent_log_self_read" ON public.whatsapp_consent_log;
CREATE POLICY "whatsapp_consent_log_self_read"
  ON public.whatsapp_consent_log FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT ON public.whatsapp_consent_log TO authenticated;
-- Deliberately no UPDATE/DELETE grant to any session role -- immutability is
-- enforced at the grant level, not just by omitting policies.
