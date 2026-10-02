-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 030: GST.
--
-- Razorpay does NOT compute this. It is a payment gateway: it moves money and
-- reports what it moved. Deciding the rate, the split and whether tax applies
-- at all is the seller's liability, so it is computed here, server-side, and
-- recorded on the order.
--
-- The rule that decides everything is PLACE OF SUPPLY:
--
--   buyer outside India        -> export of services, zero-rated (0%).
--                                 Conditional on being paid in convertible
--                                 foreign exchange and on an LUT/bond being
--                                 filed; otherwise IGST applies and is claimed
--                                 back. We store the country so the decision is
--                                 auditable rather than assumed.
--   buyer in the seller's state -> CGST + SGST, half the rate each
--   buyer in another Indian state -> IGST at the full rate
--
-- Rates and the seller's own state are configuration, not constants: they are
-- set by the government and change without asking us.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS gst_rate_bp integer NOT NULL DEFAULT 1800,
  ADD COLUMN IF NOT EXISTS sac_code    text;

COMMENT ON COLUMN public.products.gst_rate_bp IS
  'GST rate in BASIS POINTS (1800 = 18%). Integer so a rate is never a float. 0 = exempt.';
COMMENT ON COLUMN public.products.sac_code IS
  'SAC/HSN code for the invoice. Software services are commonly 998314 — confirm per product with your CA.';

-- Tax is recorded ON THE ORDER, not recomputed later. Rates change; an invoice
-- must always reproduce the tax that was actually charged on the day.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tax_base_paise  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_paise      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_paise      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_paise      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_rate_bp     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS place_of_supply text,
  ADD COLUMN IF NOT EXISTS buyer_country   text NOT NULL DEFAULT 'IN',
  ADD COLUMN IF NOT EXISTS buyer_gstin     text,
  ADD COLUMN IF NOT EXISTS tax_treatment   text NOT NULL DEFAULT 'intra_state'
    CHECK (tax_treatment IN ('intra_state', 'inter_state', 'export_zero_rated', 'exempt'));

COMMENT ON COLUMN public.orders.tax_base_paise IS
  'Taxable value. amount_paise = tax_base_paise + cgst + sgst + igst, always.';
COMMENT ON COLUMN public.orders.place_of_supply IS
  'GST state code of supply, e.g. 29 for Karnataka. Null for exports.';

-- Buyers need a state before their tax can be determined. site_accounts is the
-- profile table (migration 018), not a `profiles` table.
ALTER TABLE public.site_accounts
  ADD COLUMN IF NOT EXISTS billing_state_code text,
  ADD COLUMN IF NOT EXISTS billing_country    text NOT NULL DEFAULT 'IN',
  ADD COLUMN IF NOT EXISTS gstin              text;

COMMENT ON COLUMN public.site_accounts.gstin IS
  'Buyer GSTIN for B2B. Its first two digits are the state code and must agree with billing_state_code.';

-- app_config.value is JSONB (migration 023), so these must be valid JSON.
--
-- The state code is stored as a JSON STRING, not a number, and that matters:
-- state codes carry leading zeros (01 Jammu & Kashmir, 09 Uttar Pradesh). As a
-- JSON number 09 becomes 9, and every comparison against a buyer's '09' then
-- fails — charging IGST to someone in their own state, on the invoice.
INSERT INTO public.app_config (key, value, description) VALUES
  ('gst_seller_state_code', '"29"'::jsonb,
   'GST state code of our own registered place of business, as a STRING so leading zeros survive. 29 = Karnataka. Decides CGST+SGST versus IGST — if this is wrong, every invoice is wrong.'),
  ('gst_seller_gstin', '""'::jsonb,
   'Our GSTIN, printed on invoices. Empty until registration is confirmed.'),
  ('gst_prices_include_tax', 'true'::jsonb,
   'true = the price shown on a product IS the total payable and tax is back-computed from it (the usual Indian B2C presentation). false = tax is added on top at checkout.'),
  ('gst_export_lut_filed', 'false'::jsonb,
   'Whether an LUT/bond is on file. With it, exports of services are zero-rated. Without it, IGST is payable on exports and reclaimed later — so this flag must reflect reality, not intent.')
ON CONFLICT (key) DO NOTHING;
