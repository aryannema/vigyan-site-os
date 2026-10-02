-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 020: public.feature_flags — admin-controllable site-wide switches,
-- starting with `whatsapp_live` (the WABA banned 2026-09-08 -- see
-- docs/OPS.md §12 -- previously required a code change + redeploy to
-- toggle; this makes it a live admin action instead).
--
-- RLS pattern mirrors `products` (011), not `ai_provider_config` (009):
-- flags must be PUBLICLY readable (marketing pages read this with no admin
-- session), unlike ai_provider_config's API keys which are never
-- client-readable. A boolean flag name carries no sensitive data.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.feature_flags (
  key         text        PRIMARY KEY,
  enabled     boolean     NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES auth.users(id)
);
COMMENT ON TABLE public.feature_flags IS 'resource:settings -- site-wide admin-controllable boolean switches. Publicly readable (booleans only, no sensitive data), admin-writable via user_has_capability.';

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feature_flags_public_read" ON public.feature_flags;
CREATE POLICY "feature_flags_public_read"
  ON public.feature_flags FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "feature_flags_capability_write" ON public.feature_flags;
CREATE POLICY "feature_flags_capability_write"
  ON public.feature_flags FOR ALL
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'settings', 'edit'))
  WITH CHECK (public.user_has_capability(auth.uid(), 'settings', 'edit'));

GRANT SELECT ON public.feature_flags TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.feature_flags TO authenticated;

INSERT INTO public.role_capabilities (role, resource_key, action, allowed)
VALUES
  ('admin', 'settings', 'view', true),
  ('admin', 'settings', 'edit', true)
ON CONFLICT (role, resource_key, action) DO NOTHING;

INSERT INTO public.feature_flags (key, enabled)
VALUES ('whatsapp_live', false)
ON CONFLICT (key) DO NOTHING;
