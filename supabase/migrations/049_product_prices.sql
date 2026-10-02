-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 049: product_prices + product_offers.
--
-- WHY: price was flattened onto products -- one price_paise column, so one
-- price ever. No monthly-vs-annual, no service bands, no USD, and a price edit
-- silently rewrote every historical invoice that referenced it.
--
-- SHAPE: products = WHAT it is. product_prices = HOW it is sold (1:N).
-- Same split Stripe uses; their Plan object is legacy, replaced by Price.
-- Deliberately NOT a table per product_type: orders, link_shortener,
-- product_assets and product_bundle_items all carry FKs to products(id), and
-- splitting into sibling tables makes those FKs impossible to express.
--
-- ADDITIVE ONLY. The existing products.price_paise / discount_bp /
-- offer_ends_at columns stay and keep working; this migration backfills from
-- them. Dropping them is a later migration, once every read path has moved.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.product_prices (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,

  -- What the buyer sees this option called: 'Monthly', 'Annual', 'Discovery',
  -- 'Enterprise'. A service BAND is just one of these rows.
  nickname        text        NOT NULL,

  -- fixed = an exact price. from = "starting at", scope decides the rest.
  -- quote = no public number, amount_minor IS NULL.
  price_model     text        NOT NULL DEFAULT 'fixed'
                  CHECK (price_model IN ('fixed','from','quote')),

  -- MINOR UNITS: paise for INR, cents for USD. Integer only -- no float ever
  -- touches money.
  amount_minor    integer,
  currency        text        NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','USD')),

  billing_period  text        NOT NULL DEFAULT 'one_time'
                  CHECK (billing_period IN ('one_time','month','year')),
  interval_count  integer     NOT NULL DEFAULT 1 CHECK (interval_count > 0),

  -- What the amount is PER. 'hour' with min_units=10 is a 10-hour minimum.
  unit            text        NOT NULL DEFAULT 'flat'
                  CHECK (unit IN ('flat','seat','hour','day','project')),
  min_units       integer     CHECK (min_units IS NULL OR min_units > 0),

  sort_order      integer     NOT NULL DEFAULT 0,
  is_default      boolean     NOT NULL DEFAULT false,
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  -- A price without a number is only legitimate when it is a quote.
  CONSTRAINT product_prices_amount_present
    CHECK (price_model = 'quote' OR amount_minor IS NOT NULL),
  CONSTRAINT product_prices_amount_nonneg
    CHECK (amount_minor IS NULL OR amount_minor >= 0),
  CONSTRAINT product_prices_archived_stamped
    CHECK (status = 'active' OR archived_at IS NOT NULL)
);

-- One option per product per currency per term. This is what makes
-- "Monthly INR / Annual INR / Monthly USD / Annual USD" four distinct rows
-- rather than a single row with four nullable amount columns.
CREATE UNIQUE INDEX IF NOT EXISTS product_prices_unique_option
  ON public.product_prices (product_id, currency, billing_period, nickname)
  WHERE status = 'active';

-- Exactly one default per product PER CURRENCY: an Indian buyer and a US buyer
-- each need a defensible "the price" without the other's row competing.
CREATE UNIQUE INDEX IF NOT EXISTS product_prices_one_default
  ON public.product_prices (product_id, currency)
  WHERE is_default AND status = 'active';

CREATE INDEX IF NOT EXISTS product_prices_lookup
  ON public.product_prices (product_id, status, currency, sort_order);

COMMENT ON TABLE public.product_prices IS
  'How a product is sold. 1:N from products. APPEND-ONLY for billing fields: never edit an amount, archive the row and insert a new one (enforced by the product_prices_freeze trigger). That is what lets an invoice reproduce what was actually charged, and what grandfathers existing customers onto the price they signed up at.';
COMMENT ON COLUMN public.product_prices.amount_minor IS
  'Minor units: paise for INR, cents for USD. NULL only when price_model = ''quote''.';

-- ── Immutability ────────────────────────────────────────────────────────────
-- Editing an amount in place rewrites history: every invoice pointing at this
-- row silently re-prints at the new figure, which is a tax-document problem.
-- Display and lifecycle fields (nickname, sort_order, is_default, status,
-- archived_at) stay editable.
CREATE OR REPLACE FUNCTION public.product_prices_freeze() RETURNS trigger AS $$
BEGIN
  IF OLD.amount_minor   IS DISTINCT FROM NEW.amount_minor
  OR OLD.currency       IS DISTINCT FROM NEW.currency
  OR OLD.billing_period IS DISTINCT FROM NEW.billing_period
  OR OLD.interval_count IS DISTINCT FROM NEW.interval_count
  OR OLD.unit           IS DISTINCT FROM NEW.unit
  OR OLD.min_units      IS DISTINCT FROM NEW.min_units
  OR OLD.price_model    IS DISTINCT FROM NEW.price_model
  OR OLD.product_id     IS DISTINCT FROM NEW.product_id
  THEN
    RAISE EXCEPTION
      'product_prices is append-only: archive row % and insert a replacement instead of editing it', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS product_prices_no_edit ON public.product_prices;
CREATE TRIGGER product_prices_no_edit
  BEFORE UPDATE ON public.product_prices
  FOR EACH ROW EXECUTE FUNCTION public.product_prices_freeze();

-- ── Time-bound offers ───────────────────────────────────────────────────────
-- Distinct from annual-cheaper-than-monthly, which is STRUCTURAL and derived by
-- comparing two price rows. This is a campaign: it starts, it ends, and it is
-- kept afterwards so last quarter's discount is a record rather than an
-- overwrite.
CREATE TABLE IF NOT EXISTS public.product_offers (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  price_id     uuid        NOT NULL REFERENCES public.product_prices(id) ON DELETE CASCADE,
  discount_bp  integer     NOT NULL CHECK (discount_bp BETWEEN 1 AND 10000),
  label        text,
  starts_at    timestamptz NOT NULL DEFAULT now(),
  ends_at      timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_offers_window CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS product_offers_live
  ON public.product_offers (price_id, ends_at DESC);

COMMENT ON TABLE public.product_offers IS
  'Time-bound campaign discounts against one price row. NOT the annual-vs-monthly saving, which is structural and derived from two price rows -- treating them as the same thing double-discounts.';

-- ── Orders point at the PRICE that was charged ──────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS price_id uuid REFERENCES public.product_prices(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.orders.price_id IS
  'The exact price row charged. RESTRICT: a price that has been billed can never be deleted, only archived -- otherwise the invoice loses the number it printed.';

CREATE INDEX IF NOT EXISTS orders_price_idx ON public.orders (price_id) WHERE price_id IS NOT NULL;

-- ── Backfill from the flattened columns ─────────────────────────────────────
-- Every existing product gets one INR one-time price, marked default, so the
-- new tables agree with what the site currently shows.
INSERT INTO public.product_prices
  (product_id, nickname, price_model, amount_minor, currency, billing_period, unit, is_default, sort_order)
SELECT p.id, 'Standard', 'fixed', p.price_paise, COALESCE(p.currency, 'INR'), 'one_time', 'flat', true, 0
FROM public.products p
WHERE NOT EXISTS (SELECT 1 FROM public.product_prices pp WHERE pp.product_id = p.id);

-- And any live offer becomes a row against that price.
INSERT INTO public.product_offers (price_id, discount_bp, label, starts_at, ends_at)
SELECT pp.id, p.discount_bp, p.offer_label, now(), p.offer_ends_at
FROM public.products p
JOIN public.product_prices pp ON pp.product_id = p.id AND pp.is_default
WHERE p.discount_bp IS NOT NULL AND p.discount_bp > 0 AND p.offer_ends_at IS NOT NULL;

-- ── RLS: same rule as products ──────────────────────────────────────────────
ALTER TABLE public.product_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_prices_public_read ON public.product_prices;
CREATE POLICY product_prices_public_read ON public.product_prices FOR SELECT TO anon, authenticated
  USING (status = 'active' AND EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = product_id AND p.status = 'active'));

DROP POLICY IF EXISTS product_prices_admin_write ON public.product_prices;
CREATE POLICY product_prices_admin_write ON public.product_prices TO authenticated
  USING (public.user_has_capability(auth.uid(), 'products', 'edit'))
  WITH CHECK (public.user_has_capability(auth.uid(), 'products', 'edit'));

DROP POLICY IF EXISTS product_offers_public_read ON public.product_offers;
CREATE POLICY product_offers_public_read ON public.product_offers FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.product_prices pp
                 JOIN public.products p ON p.id = pp.product_id
                 WHERE pp.id = price_id AND pp.status = 'active' AND p.status = 'active'));

DROP POLICY IF EXISTS product_offers_admin_write ON public.product_offers;
CREATE POLICY product_offers_admin_write ON public.product_offers TO authenticated
  USING (public.user_has_capability(auth.uid(), 'products', 'edit'))
  WITH CHECK (public.user_has_capability(auth.uid(), 'products', 'edit'));

ALTER TABLE public.product_prices OWNER TO postgres;
ALTER TABLE public.product_offers OWNER TO postgres;
