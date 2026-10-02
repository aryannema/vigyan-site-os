-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 028: move CONFIGURABLE (non-secret) WhatsApp values out of Coolify
-- env vars and hardcoded src/config/site.ts into public.app_config, so they're
-- editable at /admin/settings without a redeploy AND without tying the app to
-- one hosting platform's env store (operator's portability concern, 2026-09-10).
--
-- Prompted by a real bug: the WABA migration updated WHATSAPP_PHONE_NUMBER_ID
-- in Coolify (so sending worked) but missed the hardcoded display number in
-- site.ts, leaving every visitor-facing wa.me link -- including the new
-- tap-to-verify and tap-to-confirm-deletion buttons -- pointing at the
-- permanently banned old number.
--
-- WHAT STAYS IN ENV, DELIBERATELY: WHATSAPP_TOKEN and WHATSAPP_VERIFY_TOKEN
-- are SECRETS. app_config is publicly readable by design (anon SELECT), so a
-- secret placed here would be world-readable. Secrets stay in env; only
-- non-secret configuration moves.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.app_config (key, value, description) VALUES
  ('whatsapp_display_number',
   '"+919000000001"',
   'The live WABA number, digits only, no +. Drives every visitor-facing wa.me link: floating chat button, home CTAs, contact row, footer, tap-to-verify, tap-to-confirm-deletion. MUST match the number the webhook is subscribed to.'),
  ('whatsapp_self_notify_number',
   '"+919000000000"',
   'Where bot escalation alerts are sent (the operator''s own number) -- deliberately NOT the business WABA number.'),
  ('whatsapp_api_version',
   '"v25.0"',
   'Meta Graph API version used for WhatsApp send calls.')
ON CONFLICT (key) DO NOTHING;
