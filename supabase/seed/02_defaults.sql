-- ─────────────────────────────────────────────────────────────────────────────
-- seed/02_defaults.sql — starting values an admin edits later (DML only).
-- Convention: docs/PUBLIC_TEMPLATE.md. Idempotent — safe to re-run.
-- Apply AFTER the migrations. Every row here is editable from an admin screen.
-- ─────────────────────────────────────────────────────────────────────────────

-- Seed the current header once, so applying this changes nothing visible.
INSERT INTO public.nav_items (label, target_type, href, position, flag)
SELECT v.label, 'route', v.href, v.position, v.flag
FROM (VALUES
  ('Sample Product', '/sample-product', 0, 'sample_product_live'),
  ('Services',      '/services',      1, NULL),
  ('About',         '/about',         2, NULL),
  ('Blog',          '/blog',          3, NULL),
  ('Contact',       '/contact',       4, NULL)
) AS v(label, href, position, flag)
WHERE NOT EXISTS (SELECT 1 FROM public.nav_items);

-- WhatsApp OTP via an approved AUTHENTICATION template. Empty name = not yet
-- approved; the profile form then falls back to the customer-sent "VERIFY" flow.
INSERT INTO public.app_config (key, value, description) VALUES
  ('whatsapp_otp_template', '""'::jsonb,
   'Name of the approved WhatsApp AUTHENTICATION template used to send verification codes. Empty = fall back to the VERIFY flow.'),
  ('whatsapp_otp_template_language', '"en"'::jsonb,
   'Language code the template was approved in, exactly as shown in WhatsApp Manager (e.g. en, en_US).')
ON CONFLICT (key) DO NOTHING;

-- Onboarding popup switches (Admin > Settings > Feature flags). Customers on,
-- staff off while the WhatsApp Authentication template awaits Meta approval.
INSERT INTO public.feature_flags (key, enabled) VALUES
  ('profile_gate_customers', true),
  ('profile_gate_staff', false)
ON CONFLICT (key) DO NOTHING;

-- WhatsApp verification codes via an approved Authentication template. Off:
-- customers send "VERIFY" and the webhook replies with the code.
INSERT INTO public.feature_flags (key, enabled) VALUES ('whatsapp_otp_template_live', false)
ON CONFLICT (key) DO NOTHING;
