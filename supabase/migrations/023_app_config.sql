-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 023: app_config -- DB-backed operational values (OTP timings,
-- rate limits, grace-period length) that were previously hardcoded TS
-- constants. Same shape/RLS pattern as feature_flags (020): publicly
-- readable (not secret), admin-writable via the existing 'settings'
-- capability. Deliberately scoped to NUMERIC/OPERATIONAL values only --
-- large policy/consent TEXT content is a separate, bigger content-management
-- project, not folded in here (see work-units/session-state.json's
-- 2026-09-09 microfrontend/JSON-forms TODO note).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_config (
  key         text        PRIMARY KEY,
  value       jsonb       NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES auth.users(id)
);

COMMENT ON TABLE public.app_config IS
  'DB-backed operational config values (numeric/small settings only, not content/copy) -- e.g. OTP expiry minutes, rate-limit windows, grace-period days. Editable at /admin/settings without a redeploy, mirrors feature_flags (020) exactly.';

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_config_public_read" ON public.app_config;
CREATE POLICY "app_config_public_read"
  ON public.app_config FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "app_config_admin_write" ON public.app_config;
CREATE POLICY "app_config_admin_write"
  ON public.app_config FOR UPDATE
  TO authenticated
  USING (user_has_capability(auth.uid(), 'settings', 'edit'))
  WITH CHECK (user_has_capability(auth.uid(), 'settings', 'edit'));

GRANT SELECT ON public.app_config TO anon, authenticated;
GRANT UPDATE ON public.app_config TO authenticated;

INSERT INTO public.app_config (key, value, description) VALUES
  ('whatsapp_otp_expiry_minutes', '10', 'How long a WhatsApp VERIFY code stays valid before expiring.'),
  ('whatsapp_otp_max_attempts', '5', 'Max wrong-code attempts before a WhatsApp VERIFY code is rejected outright.'),
  ('whatsapp_otp_resend_cooldown_seconds', '60', 'Minimum wait between two WhatsApp VERIFY code sends to the same number.'),
  ('whatsapp_otp_daily_cap', '5', 'Max WhatsApp VERIFY codes sent to one account per rolling 24h.'),
  ('deletion_email_token_expiry_minutes', '30', 'How long an account-deletion email confirmation link stays valid.'),
  ('deletion_whatsapp_expiry_minutes', '10', 'How long an account-deletion WhatsApp code stays valid before expiring.'),
  ('deletion_whatsapp_max_attempts', '5', 'Max wrong-code attempts before an account-deletion WhatsApp code is rejected outright.'),
  ('deletion_whatsapp_resend_cooldown_seconds', '60', 'Minimum wait between two account-deletion WhatsApp code sends to the same number.'),
  ('account_deletion_grace_period_days', '15', 'Days an anonymized account''s encrypted PII snapshot stays recoverable before a cron job purges it permanently.')
ON CONFLICT (key) DO NOTHING;
