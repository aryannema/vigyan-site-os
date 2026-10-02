-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 078 (DDL ONLY — no rows; rows are in supabase/seed/): landing_pages — admin-authored, server-rendered pages served at
-- /services/<slug>, optionally attached to a product (checkout) and reachable
-- from campaign links (/go/<slug>) and the header nav, all without a rebuild.
--
-- Body is the same typed block array as blog posts (lib/content/blocks.ts), so
-- there is still no raw HTML anywhere: structure is JSON, rendered on the server
-- by <BlockRenderer />, crawlable as ordinary HTML.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.landing_pages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80),
  title           text        NOT NULL,                       -- the page h1
  subtitle        text,
  body_blocks     jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- Block[] (blocks.ts)
  seo_title       text,                                        -- falls back to title
  seo_description text,                                        -- falls back to subtitle
  og_image_url    text,
  product_id      uuid        REFERENCES public.products(id) ON DELETE SET NULL,
  cta_label       text,
  cta_url         text,                                        -- used when no product, or a free product
  status          text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_at    timestamptz,
  created_by      uuid        REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.landing_pages IS 'resource:landing_pages';

CREATE INDEX IF NOT EXISTS landing_pages_status_idx ON public.landing_pages (status);
CREATE INDEX IF NOT EXISTS landing_pages_product_idx ON public.landing_pages (product_id);

ALTER TABLE public.landing_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "landing_pages_public_read_published" ON public.landing_pages;
CREATE POLICY "landing_pages_public_read_published"
  ON public.landing_pages FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

DROP POLICY IF EXISTS "landing_pages_capability_read" ON public.landing_pages;
CREATE POLICY "landing_pages_capability_read"
  ON public.landing_pages FOR SELECT
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'landing_pages', 'view'));

DROP POLICY IF EXISTS "landing_pages_capability_write" ON public.landing_pages;
CREATE POLICY "landing_pages_capability_write"
  ON public.landing_pages FOR ALL
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'landing_pages', 'edit'))
  WITH CHECK (public.user_has_capability(auth.uid(), 'landing_pages', 'edit'));

GRANT SELECT ON public.landing_pages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.landing_pages TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Header navigation, editable from /admin/nav. Two levels: a top-level item may
-- have children, which render as a dropdown (desktop) / accordion (mobile).
-- The site falls back to a built-in menu if this table is empty or unreachable.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.nav_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id       uuid        REFERENCES public.nav_items(id) ON DELETE CASCADE,
  label           text        NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  -- What the item points at. landing_page / product are real foreign keys, so a
  -- renamed slug follows automatically, an unpublished target drops out of the
  -- menu, and a deleted target takes its menu item with it (no dead links).
  target_type     text        NOT NULL DEFAULT 'route'
                              CHECK (target_type IN ('route','url','landing_page','product')),
  href            text        CHECK (href ~ '^(/|https?://)' AND href !~ '^//'),  -- route / url only
  landing_page_id uuid        REFERENCES public.landing_pages(id) ON DELETE CASCADE,
  product_id      uuid        REFERENCES public.products(id) ON DELETE CASCADE,
  position        integer     NOT NULL DEFAULT 0,
  enabled         boolean     NOT NULL DEFAULT true,
  flag            text,                                        -- hide unless this feature flag is on
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nav_items_target_shape CHECK (
    (target_type IN ('route','url') AND href IS NOT NULL AND landing_page_id IS NULL AND product_id IS NULL)
    OR (target_type = 'landing_page' AND landing_page_id IS NOT NULL AND href IS NULL AND product_id IS NULL)
    OR (target_type = 'product'      AND product_id      IS NOT NULL AND href IS NULL AND landing_page_id IS NULL)
  )
);
COMMENT ON TABLE public.nav_items IS 'resource:nav';
CREATE INDEX IF NOT EXISTS nav_items_parent_idx ON public.nav_items (parent_id, position);
CREATE INDEX IF NOT EXISTS nav_items_landing_idx ON public.nav_items (landing_page_id) WHERE landing_page_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS nav_items_product_idx ON public.nav_items (product_id) WHERE product_id IS NOT NULL;

ALTER TABLE public.nav_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nav_items_public_read" ON public.nav_items;
CREATE POLICY "nav_items_public_read"
  ON public.nav_items FOR SELECT TO anon, authenticated USING (enabled);

DROP POLICY IF EXISTS "nav_items_capability_read" ON public.nav_items;
CREATE POLICY "nav_items_capability_read"
  ON public.nav_items FOR SELECT TO authenticated
  USING (public.user_has_capability(auth.uid(), 'nav', 'view'));

DROP POLICY IF EXISTS "nav_items_capability_write" ON public.nav_items;
CREATE POLICY "nav_items_capability_write"
  ON public.nav_items FOR ALL TO authenticated
  USING (public.user_has_capability(auth.uid(), 'nav', 'edit'))
  WITH CHECK (public.user_has_capability(auth.uid(), 'nav', 'edit'));

GRANT SELECT ON public.nav_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nav_items TO authenticated;
