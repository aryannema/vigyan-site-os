-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 050: column comments on the pricing tables.
--
-- Comments are shown by Supabase Studio, psql \d+, pgAdmin and every other
-- introspection tool, so the schema explains itself at the point someone is
-- actually looking at it rather than in a doc they have to know exists.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── product_prices ──────────────────────────────────────────────────────────
COMMENT ON COLUMN public.product_prices.id IS
  'Primary key. Referenced by orders.price_id, so this is the identity an invoice preserves.';
COMMENT ON COLUMN public.product_prices.product_id IS
  'FK -> products(id) ON DELETE CASCADE. Deleting a product removes its prices; an order that used one blocks the delete via orders.price_id RESTRICT.';
COMMENT ON COLUMN public.product_prices.nickname IS
  'What the buyer sees this option called: Monthly, Annual, Discovery, Enterprise. A service BAND is just one of these rows.';
COMMENT ON COLUMN public.product_prices.price_model IS
  'fixed = an exact price. from = "starting at", scope decides the rest. quote = no public number, amount_minor IS NULL.';
COMMENT ON COLUMN public.product_prices.amount_minor IS
  'MINOR UNITS: paise for INR, cents for USD. Integer only -- no float ever touches money. NULL only when price_model = quote (enforced by product_prices_amount_present).';
COMMENT ON COLUMN public.product_prices.currency IS
  'INR or USD. Part of the uniqueness key, so the same option in two currencies is two rows rather than two columns.';
COMMENT ON COLUMN public.product_prices.billing_period IS
  'one_time, month or year. Lives HERE and not on products, so nothing gates annual pricing by product_type -- a retainer or a blueprint can have a term as readily as a SaaS plan.';
COMMENT ON COLUMN public.product_prices.interval_count IS
  'Multiplier on billing_period. 3 + month = quarterly.';
COMMENT ON COLUMN public.product_prices.unit IS
  'What amount_minor is PER: flat, seat, hour, day, project. hour + min_units=10 is a ten-hour minimum.';
COMMENT ON COLUMN public.product_prices.min_units IS
  'Smallest quantity sellable at this price. NULL means no minimum.';
COMMENT ON COLUMN public.product_prices.sort_order IS
  'Display order of bands on the product page and in the WhatsApp menu. Editable -- it is presentation, not billing.';
COMMENT ON COLUMN public.product_prices.is_default IS
  'The price shown when no option is chosen. Unique per (product_id, currency) among active rows, so an Indian and a US buyer each have a defensible "the price".';
COMMENT ON COLUMN public.product_prices.status IS
  'active or archived. Archiving is how a price is RETIRED -- it is never edited, because an invoice pointing at it must keep printing the figure it charged.';
COMMENT ON COLUMN public.product_prices.archived_at IS
  'When it was retired. Required once status = archived (product_prices_archived_stamped).';
COMMENT ON COLUMN public.product_prices.created_at IS
  'When this price came into effect. With archived_at this is the price history -- no separate audit table needed.';

-- ── product_offers ──────────────────────────────────────────────────────────
COMMENT ON COLUMN public.product_offers.price_id IS
  'FK -> product_prices(id) ON DELETE CASCADE. An offer discounts ONE price row, not the product: a campaign can run on monthly without touching annual.';
COMMENT ON COLUMN public.product_offers.discount_bp IS
  'Basis points. 2000 = 20% off. 1..10000, so a 0% or >100% offer cannot be stored.';
COMMENT ON COLUMN public.product_offers.label IS
  'The badge text, e.g. "Diwali offer". Shown beside the countdown.';
COMMENT ON COLUMN public.product_offers.starts_at IS
  'Offers can be scheduled ahead. Rows outside their window are simply not live -- they are kept, not deleted, so last quarter is a record.';
COMMENT ON COLUMN public.product_offers.ends_at IS
  'Re-evaluated server-side at order time. The countdown in a browser is decoration; this is what decides the charge.';

-- ── the FK that ties a sale to what it cost ─────────────────────────────────
COMMENT ON COLUMN public.orders.price_id IS
  'FK -> product_prices(id) ON DELETE RESTRICT. The exact row charged. RESTRICT because a billed price can never be deleted, only archived -- otherwise the invoice loses the number it printed.';
COMMENT ON COLUMN public.orders.product_id IS
  'FK -> products(id). What was bought. price_id records what it cost; both are needed because a product outlives any one of its prices.';

-- ── and on products, the columns the new tables supersede ───────────────────
COMMENT ON COLUMN public.products.price_paise IS
  'LEGACY, superseded by product_prices. Still read by the checkout and the product page until those move over. Do not add new readers.';
COMMENT ON COLUMN public.products.discount_bp IS
  'LEGACY, superseded by product_offers. Migration 049 backfilled live offers into that table.';
COMMENT ON COLUMN public.products.offer_ends_at IS
  'LEGACY, superseded by product_offers.ends_at.';
COMMENT ON COLUMN public.products.is_lead_magnet IS
  'REDUNDANT with product_type = lead_magnet and with amount_minor = 0. Two columns encoding one fact can disagree; this is scheduled for removal once every read path uses product_prices.';
COMMENT ON COLUMN public.products.product_type IS
  'The COMMERCIAL MODEL: saas, one_off, blueprint, service, lead_magnet. Distinct from fulfilment_kind (HOW it is delivered) and from price (WHAT it costs, now in product_prices).';
COMMENT ON COLUMN public.products.fulfilment_kind IS
  'HOW the buyer receives it. fulfilment_config carries the per-kind settings, and a CHECK validates that the required keys are present FOR THAT KIND.';
