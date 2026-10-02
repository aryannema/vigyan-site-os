-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 051: real gateway economics, and cost of goods.
--
-- Two gaps that both cause the same failure -- a price that looks profitable
-- and is not.
--
-- 1. GATEWAY FEES WERE A SINGLE GLOBAL NUMBER (app_config.pricing_gateway_fee_bp
--    = 200). That is Razorpay domestic and nothing else. Stripe charges a
--    PERCENTAGE PLUS A FIXED FEE, and both gateways surcharge international
--    cards. A $19 sale through Stripe loses ~4.4% + $0.30, not 2%. On small
--    amounts the fixed fee dominates and a flat 2% assumption is simply wrong.
--    payment_gateway_config already existed but held credentials only.
--
-- 2. NOTHING RECORDED WHAT A PRODUCT COSTS US TO RUN. A SaaS product that pays
--    Meta per WhatsApp conversation, Sarvam for speech, or a video API per
--    render has a real per-sale or per-month cost, and the margin floor was
--    checked as though it were zero. Vendor DISCOUNTS matter too -- a committed
--    -spend discount changes the true cost and should feed the same sum.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Gateway fee structure ────────────────────────────────────────────────
ALTER TABLE public.payment_gateway_config
  ADD COLUMN IF NOT EXISTS display_name     text,
  ADD COLUMN IF NOT EXISTS fee_percent_bp   integer NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS fee_fixed_minor  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_gst_bp       integer NOT NULL DEFAULT 1800,
  ADD COLUMN IF NOT EXISTS intl_surcharge_bp integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_currency text NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS supports_intl    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enabled          boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.payment_gateway_config.fee_percent_bp IS
  'Percentage cut in basis points. 200 = 2%.';
COMMENT ON COLUMN public.payment_gateway_config.fee_fixed_minor IS
  'FIXED fee per transaction in minor units, on top of the percentage. Stripe''s 30 cents = 30. Razorpay has none. On small amounts this dominates: 30c on a $5 sale is 6%.';
COMMENT ON COLUMN public.payment_gateway_config.intl_surcharge_bp IS
  'Extra basis points charged when the CARD is foreign. Stripe adds ~150bp, Razorpay ~100bp on international. Applies on top of fee_percent_bp.';
COMMENT ON COLUMN public.payment_gateway_config.fee_gst_bp IS
  'GST the GATEWAY charges on its own fee. 1800 for an Indian gateway. A foreign gateway billing from abroad charges none -- set 0.';
COMMENT ON COLUMN public.payment_gateway_config.settlement_currency IS
  'What they pay US in. A USD-settling gateway avoids a conversion spread that an INR-settling one charges.';

INSERT INTO public.payment_gateway_config (gateway, display_name, fee_percent_bp, fee_fixed_minor, fee_gst_bp, intl_surcharge_bp, settlement_currency, supports_intl, enabled, is_live)
VALUES
  ('razorpay', 'Razorpay',        200, 0,  1800, 100, 'INR', true,  true,  false),
  ('stripe',   'Stripe',          290, 30, 0,    150, 'USD', true,  false, false),
  ('manual',   'Bank transfer',     0, 0,  0,      0, 'INR', true,  true,  false)
ON CONFLICT (gateway) DO UPDATE SET
  display_name = COALESCE(public.payment_gateway_config.display_name, EXCLUDED.display_name);

-- ── 2. Which gateway charges this price ─────────────────────────────────────
-- On the PRICE, not the product: a USD price may settle through Stripe while
-- the INR price for the same product goes through Razorpay.
ALTER TABLE public.product_prices
  ADD COLUMN IF NOT EXISTS gateway text REFERENCES public.payment_gateway_config(gateway) ON DELETE SET NULL;

COMMENT ON COLUMN public.product_prices.gateway IS
  'Which gateway charges this price. NULL = the site default. Set per PRICE, not per product, because a USD price may settle through Stripe while the INR price for the same product goes through Razorpay -- and their fee structures differ enough to change the margin.';

-- ── 3. What a product costs us to run ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_costs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,

  vendor        text        NOT NULL,
  label         text        NOT NULL,

  -- per_sale  : charged once per transaction (an API call per purchase)
  -- per_month : a running cost while a subscriber is active
  -- per_unit  : metered -- multiply by expected_units
  cost_kind     text        NOT NULL CHECK (cost_kind IN ('per_sale','per_month','per_unit')),
  amount_minor  integer     NOT NULL CHECK (amount_minor >= 0),
  currency      text        NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','USD')),

  -- Expected metered volume per sale or month, for cost_kind = per_unit.
  expected_units numeric(12,2) CHECK (expected_units IS NULL OR expected_units >= 0),

  -- What the VENDOR gives US off list -- committed spend, startup credits, a
  -- negotiated rate. Reduces true cost, so it must feed the same sum rather
  -- than being remembered informally.
  vendor_discount_bp integer NOT NULL DEFAULT 0 CHECK (vendor_discount_bp BETWEEN 0 AND 10000),

  notes         text,
  status        text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_costs_units_present
    CHECK (cost_kind <> 'per_unit' OR expected_units IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS product_costs_lookup
  ON public.product_costs (product_id, status);

COMMENT ON TABLE public.product_costs IS
  'Cost of goods for a product: the APIs and services we pay to deliver it (Meta WhatsApp conversations, Sarvam speech, video rendering, model inference). Subtracted BEFORE the margin floor is checked, so a product that pays more to vendors than it earns is refused at save time rather than discovered in a month-end reconciliation.';
COMMENT ON COLUMN public.product_costs.vendor_discount_bp IS
  'Discount the VENDOR gives US, in basis points -- committed spend, credits, negotiated rate. Not a customer discount. Reduces true cost.';
COMMENT ON COLUMN public.product_costs.cost_kind IS
  'per_sale = once per transaction. per_month = running cost per active subscriber. per_unit = metered, multiplied by expected_units.';

ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;

-- Costs are COMMERCIALLY SENSITIVE: what we pay vendors, and what discounts we
-- negotiated. No anon policy, deliberately -- unlike product_prices, this must
-- never be publicly readable.
DROP POLICY IF EXISTS product_costs_admin_all ON public.product_costs;
CREATE POLICY product_costs_admin_all ON public.product_costs TO authenticated
  USING (public.user_has_capability(auth.uid(), 'products', 'edit'))
  WITH CHECK (public.user_has_capability(auth.uid(), 'products', 'edit'));

ALTER TABLE public.product_costs OWNER TO postgres;
