-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 036: drop licence keys, add Notion-backed gated pages.
--
-- LICENCE KEYS REMOVED. The operator does not want a key system, and the
-- reasoning holds: a key is only worth building if something enforces it, which
-- means a licence server, activation, revocation and an offline grace period --
-- a product in itself. Without enforcement a key is theatre. Access is instead
-- carried by the entitlement already on the account, and a download is a
-- per-buyer route that checks it.
--
-- NOTION ADDED as a content source, which answers "why can't we just host the
-- gated material in Notion".
--
-- Because a Notion "share to web" link is a BEARER link. It has no idea who is
-- opening it: one buyer forwards it, posts it, or it gets indexed, and the
-- material is public with no way to tell that it happened. That is not a
-- limitation of a plan tier -- it is what a public share link IS.
--
-- What does work is separating the two jobs. Notion is where the material is
-- WRITTEN; this site is where access is DECIDED. The page is fetched through
-- the integration (api/sync/notion already does exactly this) and rendered here
-- behind the buyer's entitlement, so the Notion page itself is never shared and
-- never needs to be public.
--
-- That also keeps the material portable: it renders through our own templates,
-- so moving off Notion later is a change of source, not a migration of content.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_fulfilment_kind_known;

-- Nothing in production uses license_key yet, so this converts rather than
-- stranding rows. Kept as a safety net regardless of the current row count.
UPDATE public.products
   SET fulfilment_kind = 'none'
 WHERE fulfilment_kind = 'license_key';

ALTER TABLE public.products
  ADD CONSTRAINT products_fulfilment_kind_known
  CHECK (fulfilment_kind IN (
    'none',            -- manual follow-up; we contact the buyer
    'hosted_file',     -- product_assets rows: PDF, guide, prompt library
    'external_url',    -- anywhere: Play Store, App Store, Gumroad, Drive
    'github_release',  -- a release asset, public or private
    'private_page',    -- a page on this site, gated by entitlement
    'notion_page',     -- written in Notion, rendered HERE behind the entitlement
    'short_link',      -- a public.link_shortener slug, so delivery is tracked
    'physical',        -- shipped; the invoice is the record
    'service'          -- a booking or engagement; nothing to download
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
      ELSE true
    END
  );

DROP TABLE IF EXISTS public.license_keys;

COMMENT ON COLUMN public.products.fulfilment_config IS
  'Kind-specific settings. external_url: {url}. github_release: {repo, tag, asset}. private_page: {path}. notion_page: {notion_page_id}. short_link: {slug}.';
