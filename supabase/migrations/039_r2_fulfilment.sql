-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 039: R2-hosted files, and lead magnets.
--
-- Adds 'r2_file' as a fulfilment kind. The object key is stored; the bytes live
-- in the bucket. Nothing in the bucket is ever public -- a buyer receives a
-- signed URL good for a few minutes, so a forwarded link is dead before it is
-- useful.
--
-- This supersedes 'hosted_file' (product_assets, migration 035) for anything
-- large. product_assets stays for small files already attached, but R2 is where
-- new ones belong: a database backed up nightly is the wrong home for an app
-- build, and R2's egress is free where S3's is not.
--
-- LEAD MAGNETS. A free download is a product priced at 0 with is_lead_magnet
-- set. It needs the flag rather than relying on price alone, because 0 already
-- means "request a quote" elsewhere in this schema -- overloading it a third
-- way would make an unpriced consulting page look like a free download.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_fulfilment_kind_known;

ALTER TABLE public.products
  ADD CONSTRAINT products_fulfilment_kind_known
  CHECK (fulfilment_kind IN (
    'none', 'hosted_file', 'r2_file', 'external_url', 'github_release',
    'private_page', 'notion_page', 'short_link', 'physical', 'service'
  ));

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_fulfilment_config_present;
ALTER TABLE public.products
  ADD CONSTRAINT products_fulfilment_config_present
  CHECK (
    CASE fulfilment_kind
      WHEN 'external_url'   THEN fulfilment_config ? 'url'
      WHEN 'github_release' THEN fulfilment_config ? 'repo' AND fulfilment_config ? 'tag'
      WHEN 'private_page'   THEN fulfilment_config ? 'path'
      WHEN 'notion_page'    THEN fulfilment_config ? 'notion_page_id'
      WHEN 'short_link'     THEN fulfilment_config ? 'slug'
      WHEN 'r2_file'        THEN fulfilment_config ? 'key'
      ELSE true
    END
  );

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_lead_magnet boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.is_lead_magnet IS
  'A free download offered in exchange for an email. Distinct from price_paise = 0, which already means "request a quote" -- a lead magnet is deliberately free, not unpriced.';

-- A lead magnet is free by definition. Charging for one would mean the CTA and
-- the checkout disagree.
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_lead_magnet_is_free;
ALTER TABLE public.products
  ADD CONSTRAINT products_lead_magnet_is_free
  CHECK (NOT is_lead_magnet OR price_paise = 0);

CREATE INDEX IF NOT EXISTS products_lead_magnet_idx
  ON public.products (is_lead_magnet) WHERE is_lead_magnet;
