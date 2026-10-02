-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 053: capture the fee the gateway ACTUALLY charged.
--
-- payment_gateway_config holds our ESTIMATE of a gateway's fee, used to price a
-- product before anyone buys it. An estimate is all it can ever be: published
-- MDR varies by instrument (UPI is not carded rates), by card network (AMEX is
-- dearer), by domestic vs international, and by whatever rate was negotiated.
-- No published table captures that, and a scraper reading their pricing page
-- would produce a number that is confidently wrong.
--
-- The gateway already tells us the truth. Razorpay's payment entity carries
-- `fee` and `tax` in paise; Stripe's balance_transaction carries `fee` and
-- `fee_details`. The webhook was receiving that payload and discarding both.
--
-- So: config = the estimate we PRICE with. These columns = what we were
-- CHARGED. Comparing the two is how a drifting estimate becomes visible instead
-- of quietly eroding every margin.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS gateway              text,
  ADD COLUMN IF NOT EXISTS actual_fee_minor     integer CHECK (actual_fee_minor IS NULL OR actual_fee_minor >= 0),
  ADD COLUMN IF NOT EXISTS actual_fee_tax_minor integer CHECK (actual_fee_tax_minor IS NULL OR actual_fee_tax_minor >= 0),
  ADD COLUMN IF NOT EXISTS estimated_fee_minor  integer CHECK (estimated_fee_minor IS NULL OR estimated_fee_minor >= 0);

COMMENT ON COLUMN public.orders.actual_fee_minor IS
  'What the gateway ACTUALLY charged, from its own payload (Razorpay payment.fee, Stripe balance_transaction.fee). Ground truth, not an estimate. Inclusive of the tax the gateway charged on its fee.';
COMMENT ON COLUMN public.orders.actual_fee_tax_minor IS
  'The tax portion of that fee (Razorpay payment.tax). Separated because it is input credit, not a cost.';
COMMENT ON COLUMN public.orders.estimated_fee_minor IS
  'What payment_gateway_config predicted at pricing time. Kept alongside the actual so drift is measurable per order rather than inferred from a month-end total.';
COMMENT ON COLUMN public.orders.gateway IS
  'Which gateway processed this order. Recorded on the ORDER because a price can be re-pointed at a different gateway later, and this one must keep saying who actually took the money.';

CREATE INDEX IF NOT EXISTS orders_gateway_fees_idx
  ON public.orders (gateway, created_at DESC) WHERE actual_fee_minor IS NOT NULL;

-- Per-gateway reconciliation: what we assumed against what we paid.
CREATE OR REPLACE VIEW public.gateway_fee_accuracy AS
SELECT
  o.gateway,
  count(*)                                        AS orders,
  sum(o.amount_paise)                             AS charged_total,
  sum(o.estimated_fee_minor)                      AS estimated_total,
  sum(o.actual_fee_minor)                         AS actual_total,
  sum(o.actual_fee_minor) - sum(o.estimated_fee_minor) AS drift,
  -- The effective rate we are REALLY paying, in basis points. This is the
  -- number that belongs in payment_gateway_config, and no published rate card
  -- will tell you it.
  CASE WHEN sum(o.amount_paise) > 0
       THEN round(sum(o.actual_fee_minor)::numeric * 10000 / sum(o.amount_paise))
  END                                             AS effective_rate_bp
FROM public.orders o
WHERE o.actual_fee_minor IS NOT NULL
GROUP BY o.gateway;

COMMENT ON VIEW public.gateway_fee_accuracy IS
  'Estimated versus actual gateway fees. effective_rate_bp is what we are really paying -- feed it back into payment_gateway_config rather than trusting a published rate card, which cannot know our instrument mix or negotiated rate.';

ALTER VIEW public.gateway_fee_accuracy OWNER TO postgres;
