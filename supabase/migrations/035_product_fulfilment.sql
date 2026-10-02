-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 035: where the thing being sold actually lives.
--
-- Until now a product had a price and a title but no answer to "what does the
-- buyer get, and from where". The answers are genuinely varied -- a PDF
-- blueprint, a guide, a prompt library, a GitHub release, a desktop build, a
-- redirect to Google Play or the App Store, a private page, a booked call, a
-- physical print -- and more will appear.
--
-- So this does NOT enumerate columns per case. A product has a fulfilment KIND
-- and a jsonb CONFIG whose shape the kind decides. Adding a new way to deliver
-- something is then a new kind and a handler, not a schema migration and a
-- column that is null for every other product.
--
-- Two things are deliberately NOT built here, because the operator was explicit
-- that this is not becoming an e-commerce site: no cart, no cross-sell, no
-- upsell. A product is bought on its own. Bundles are represented as a product
-- that grants several entitlements, which needs no cart.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Files we host ourselves ──────────────────────────────────────────────────
--
-- Same reasoning as invoice_archive (032): a blueprint or prompt library is
-- tens of kilobytes to a few megabytes, it is already in the backup, and it
-- moves with the database on a host migration. Large binaries -- an installer,
-- a video -- should NOT go here: point a product at a GitHub release or a
-- signed URL instead. The CHECK makes that boundary explicit rather than
-- leaving it to judgement.

CREATE TABLE IF NOT EXISTS public.product_assets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  filename    text        NOT NULL,
  content_type text       NOT NULL,
  bytes       bytea       NOT NULL,
  byte_size   integer     NOT NULL CHECK (byte_size > 0 AND byte_size <= 26214400),
  sha256      text        NOT NULL,
  -- Ordering when a product ships several files.
  position    integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.product_assets IS
  'Files we host for a purchased product. 25 MB ceiling per file: past that, use a GitHub release or an external URL rather than the database.';

CREATE INDEX IF NOT EXISTS product_assets_product_idx
  ON public.product_assets (product_id, position);

ALTER TABLE public.product_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_assets FROM anon, authenticated;
-- Service role only. A buyer reaches a file through a route that checks their
-- entitlement first; there is no reason to expose paid material to a SELECT.

-- ── How a product is delivered ───────────────────────────────────────────────

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS fulfilment_kind   text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS fulfilment_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- What the purchase grants. Matches user_entitlements.entitlement, so access
  -- outlives any single order and a bundle can grant several.
  ADD COLUMN IF NOT EXISTS grants_entitlements text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_fulfilment_kind_known;
ALTER TABLE public.products
  ADD CONSTRAINT products_fulfilment_kind_known
  CHECK (fulfilment_kind IN (
    'none',            -- manual follow-up; we contact the buyer
    'hosted_file',     -- product_assets rows: PDF, guide, prompt library
    'external_url',    -- anywhere: Play Store, App Store, Gumroad, Drive, Notion
    'github_release',  -- a release asset, public or private
    'private_page',    -- a page on this site, gated by entitlement
    'license_key',     -- a key issued per purchase
    'short_link',      -- a public.link_shortener slug, so delivery is tracked
    'physical',        -- shipped; the invoice is the record, fulfilment is offline
    'service'          -- a booking or engagement; nothing to download
  ));

COMMENT ON COLUMN public.products.fulfilment_kind IS
  'How the buyer receives it. The config shape follows from this; see src/lib/fulfilment.ts.';
COMMENT ON COLUMN public.products.fulfilment_config IS
  'Kind-specific settings. external_url: {url}. github_release: {repo, tag, asset}. private_page: {path}. short_link: {slug}. license_key: {prefix}. hosted_file: none, the rows in product_assets are the config.';
COMMENT ON COLUMN public.products.grants_entitlements IS
  'Entitlement keys granted on payment. An array so one product can unlock several things without needing a cart.';

-- A kind that needs configuration must have it. Catching this at save is far
-- better than a buyer paying and then finding nothing to download.
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_fulfilment_config_present;
ALTER TABLE public.products
  ADD CONSTRAINT products_fulfilment_config_present
  CHECK (
    CASE fulfilment_kind
      WHEN 'external_url'   THEN fulfilment_config ? 'url'
      WHEN 'github_release' THEN fulfilment_config ? 'repo' AND fulfilment_config ? 'tag'
      WHEN 'private_page'   THEN fulfilment_config ? 'path'
      WHEN 'short_link'     THEN fulfilment_config ? 'slug'
      ELSE true
    END
  );

-- ── Licence keys ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.license_keys (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  order_id   uuid        REFERENCES public.orders(id) ON DELETE SET NULL,
  key        text        NOT NULL UNIQUE,
  issued_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

COMMENT ON TABLE public.license_keys IS
  'One key per purchase. order_id survives as SET NULL so a deleted order does not invalidate a key the customer is still using.';

ALTER TABLE public.license_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.license_keys FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS license_keys_order_idx ON public.license_keys (order_id);
