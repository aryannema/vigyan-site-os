-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 038: bundles, and hosting as a priced input.
--
-- BUNDLES. A bundle is a product like any other -- it has a price, a slug, an
-- offer, an invoice line -- that happens to contain other products. Modelling
-- it as a product rather than as a new kind of thing means checkout, GST,
-- invoicing, the pricing floor and the offer mechanism all work on it already,
-- with nothing to special-case.
--
-- It is also why this needs no shopping cart. A cart exists so a buyer can
-- assemble several items at checkout; a bundle is several items assembled by
-- the SELLER in advance, bought in one transaction, at one price, on one
-- invoice line. That covers the case without multi-item orders, per-line tax,
-- or partial refunds.
--
-- HOSTING. Small, but the operator asked for it to be accounted for rather than
-- waved away, and the reasoning is sound: a cost you do not price is a cost you
-- absorb silently, and "negligible today" is an assumption that expires. It is
-- configurable so it can be revised when file sizes change.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.product_bundle_items (
  bundle_product_id uuid    NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  item_product_id   uuid    NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  position          integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bundle_product_id, item_product_id),

  -- A bundle containing itself would recurse when resolving entitlements.
  CONSTRAINT bundle_is_not_its_own_item CHECK (bundle_product_id <> item_product_id)
);

COMMENT ON TABLE public.product_bundle_items IS
  'What a bundle contains. ON DELETE RESTRICT on the item: deleting a product that is inside a live bundle must fail loudly rather than silently emptying it.';

CREATE INDEX IF NOT EXISTS product_bundle_items_item_idx
  ON public.product_bundle_items (item_product_id);

/**
 * Every entitlement a product grants, including those of anything it bundles.
 *
 * One level deep on purpose. Bundles of bundles would need cycle detection and
 * would make "what did this person buy" hard to answer; a bundle containing
 * plain products stays obvious.
 */
CREATE OR REPLACE FUNCTION public.bundle_entitlements(p_product_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT DISTINCT e
        FROM (
          SELECT unnest(p.grants_entitlements) AS e
            FROM public.products p WHERE p.id = p_product_id
          UNION
          SELECT unnest(i.grants_entitlements) AS e
            FROM public.product_bundle_items b
            JOIN public.products i ON i.id = b.item_product_id
           WHERE b.bundle_product_id = p_product_id
        ) all_e
       WHERE e IS NOT NULL AND e <> ''
    ),
    '{}'::text[]
  );
$$;

/** What the contents would cost bought separately — the saving a bundle claims. */
CREATE OR REPLACE FUNCTION public.bundle_parts_total_paise(p_product_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(public.effective_price_paise(i.*)), 0)::integer
    FROM public.product_bundle_items b
    JOIN public.products i ON i.id = b.item_product_id
   WHERE b.bundle_product_id = p_product_id;
$$;

ALTER TABLE public.product_bundle_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_bundle_items FROM anon, authenticated;

INSERT INTO public.app_config (key, value, description) VALUES
  ('pricing_hosting_per_sale_paise', '50',
   'Hosting attributable to one sale, in paise. 50 = ₹0.50. Cloudflare R2 measured at roughly 0.002 paise per download in 2026-09, so this is deliberately generous headroom rather than a measured cost — revise it if file sizes grow.')
ON CONFLICT (key) DO NOTHING;
