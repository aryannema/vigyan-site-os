-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 037: a minimum cut on every sale.
--
-- So that nothing can be listed, or discounted, at a price that leaves less
-- than a chosen amount after GST and the gateway.
--
-- Two floors, and the higher one binds:
--
--   ABSOLUTE   stops a cheap item being sold for effectively nothing once the
--              gateway has taken its percentage.
--   PERCENTAGE stops an expensive item being discounted into a thin margin
--              that the absolute floor alone would wave through.
--
-- Checked against the price the customer ACTUALLY PAYS -- during an offer that
-- is the discounted price. A product priced comfortably above the floor can be
-- pushed under it by a discount, and checking the list price would never show
-- it.
--
-- Config rather than constants: the gateway rate is Razorpay's to set, GST is
-- the government's, and the floor is a commercial decision that will change.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.app_config (key, value, description) VALUES
  ('pricing_min_net_paise', '5000',
   'Absolute minimum kept on any sale, in paise, after GST and gateway fees. 5000 = ₹50. A product or discount that leaves less is refused at save.'),
  ('pricing_min_net_bp', '6000',
   'And at least this share of what the customer paid, in basis points. 6000 = 60%. The higher of this and the absolute floor binds.'),
  ('pricing_gateway_fee_bp', '200',
   'Gateway fee in basis points. 200 = 2%, Razorpay''s standard domestic rate — confirm against your own agreement, and note international cards cost more.'),
  ('pricing_gateway_fee_gst_bp', '1800',
   'GST charged ON the gateway fee. Normally 1800 (18%).')
ON CONFLICT (key) DO NOTHING;
