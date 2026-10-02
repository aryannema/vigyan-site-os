-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 047: products.product_type — the COMMERCIAL MODEL of a product.
--
-- Deliberately a different axis from the two that already exist:
--   fulfilment_kind  = HOW it is delivered (r2_file, github_release, notion_page…)
--   is_lead_magnet   = whether it is free
--   product_type     = WHAT KIND OF THING is being sold, which is what decides
--                      how it is priced, described and called to action
--
-- A blueprint and a SaaS subscription can share a fulfilment_kind and still need
-- completely different copy, pricing and buttons.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'one_off';

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_product_type_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_product_type_check
  CHECK (product_type IN ('saas', 'one_off', 'blueprint', 'service', 'lead_magnet'));

COMMENT ON COLUMN public.products.product_type IS
  'Commercial model. saas = recurring subscription (Sample Product, video/voice bots, social scheduling & listening, MDT). one_off = buy once, own it (Sample App). blueprint = a document, guide or template. service = an engagement, priced per scope. lead_magnet = free, given away to start a conversation. Distinct from fulfilment_kind (how it is delivered) and is_lead_magnet (whether it costs money).';

-- Existing rows: both current products are software sold once, not subscriptions.
-- Set explicitly rather than relying on the DEFAULT, so the intent is recorded.
UPDATE public.products SET product_type = 'one_off' WHERE product_type IS NULL;

CREATE INDEX IF NOT EXISTS products_product_type_idx ON public.products (product_type);
