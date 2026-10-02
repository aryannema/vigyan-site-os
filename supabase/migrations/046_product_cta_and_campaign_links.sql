-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 046: product CTA copy, and the product <-> campaign link.
--
-- Two gaps reported from the admin on 2026-09-17.
--
-- 1. A product carries a price, a discount, a deadline and a description, but
--    nothing that says what its BUTTON should say. Every product therefore
--    renders the same generic call to action, which is the one piece of copy
--    that most affects whether anyone clicks it.
--
-- 2. link_shortener has no product_id. Its target_url is free text typed by
--    hand, so nothing connects a campaign link to the thing it sells: a
--    product's URL can change and silently break every live link, and there is
--    no way to ask "which campaign sold this". orders likewise records nothing
--    about where the buyer came from, so clicks could be counted but never
--    joined to revenue.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. CTA copy on the product ──────────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cta_label   text,
  ADD COLUMN IF NOT EXISTS cta_subtext text;

COMMENT ON COLUMN public.products.cta_label IS
  'Button text, e.g. "Get the blueprint". Falls back to a generic label when null.';
COMMENT ON COLUMN public.products.cta_subtext IS
  'Small reassurance line under the button, e.g. "Instant download · GST invoice included".';

-- ── 2. A campaign link points at a PRODUCT, not a typed URL ─────────────────
ALTER TABLE public.link_shortener
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.link_shortener.product_id IS
  'The product this campaign link sells. When set, target_url is DERIVED from the product slug rather than typed, so a slug change cannot silently break live links. Null for lead magnets and links to non-product pages. ON DELETE SET NULL: deleting a product must not delete the click history of a campaign that ran.';

CREATE INDEX IF NOT EXISTS link_shortener_product_idx
  ON public.link_shortener (product_id) WHERE product_id IS NOT NULL;

-- ── 3. Attribution on the order — the missing join ──────────────────────────
-- Without these, link_clicks counts clicks and orders counts revenue, and
-- nothing connects the two. Nullable throughout: a direct sale has no campaign,
-- and that is not an error.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS link_slug    text,
  ADD COLUMN IF NOT EXISTS utm_source   text,
  ADD COLUMN IF NOT EXISTS utm_medium   text,
  ADD COLUMN IF NOT EXISTS utm_campaign text;

COMMENT ON COLUMN public.orders.link_slug IS
  'Short-link slug the buyer arrived through, captured at checkout. Deliberately the SLUG and not a FK: attribution is a historical fact about this order and must survive the link being archived or deleted.';

CREATE INDEX IF NOT EXISTS orders_utm_campaign_idx
  ON public.orders (utm_campaign) WHERE utm_campaign IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_link_slug_idx
  ON public.orders (link_slug) WHERE link_slug IS NOT NULL;
