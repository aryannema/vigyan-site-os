-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 025: social_links -- footer social icons, DB-driven with a per-
-- platform enable/disable toggle, editable from /admin/settings without a
-- redeploy. Same shape/RLS pattern as feature_flags (020) and app_config
-- (023): publicly readable (not secret), admin-writable via 'settings'.
-- Seeded from the URLs live in src/config/site.ts as of 2026-09-09.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.social_links (
  platform    text        PRIMARY KEY,
  url         text        NOT NULL,
  enabled     boolean     NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES auth.users(id)
);

COMMENT ON TABLE public.social_links IS
  'Footer social icons -- URL + enable/disable per platform, editable at /admin/settings without a redeploy. The icon SVG itself stays a static per-platform map in code (src/app/(marketing)/layout.tsx) -- only URL/visibility are data-driven.';

ALTER TABLE public.social_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "social_links_public_read" ON public.social_links;
CREATE POLICY "social_links_public_read"
  ON public.social_links FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "social_links_admin_write" ON public.social_links;
CREATE POLICY "social_links_admin_write"
  ON public.social_links FOR UPDATE
  TO authenticated
  USING (user_has_capability(auth.uid(), 'settings', 'edit'))
  WITH CHECK (user_has_capability(auth.uid(), 'settings', 'edit'));

GRANT SELECT ON public.social_links TO anon, authenticated;
GRANT UPDATE ON public.social_links TO authenticated;

INSERT INTO public.social_links (platform, url, enabled) VALUES
  ('linkedin', 'https://www.linkedin.com/company/yoursite', true),
  ('youtube', 'https://www.youtube.com/@yoursite', true),
  ('x', 'https://x.com/yoursite', true),
  ('instagram', 'https://www.instagram.com/yoursite/', true),
  ('facebook', 'https://www.facebook.com/yoursite', true),
  ('telegram', 'https://t.me/yoursite_bot', true)
ON CONFLICT (platform) DO NOTHING;
