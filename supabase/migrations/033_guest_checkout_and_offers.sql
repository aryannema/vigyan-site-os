-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 033: guest checkout, buyer tax identifiers, and timed offers.
--
-- 1. GUEST CHECKOUT
--    orders.user_id was NOT NULL REFERENCES auth.users, so a purchase was
--    impossible without an account. Buying should not require registering --
--    the purchase form already collects everything an invoice needs, and
--    "create an account with these details" becomes a tick box on it rather
--    than a wall in front of it.
--
--    The buyer's details are therefore stored ON THE ORDER, not only on an
--    account. That is also the right shape for a tax document even when there
--    IS an account: an invoice records who bought at the time of sale, and
--    must not change later because someone edited their profile.
--
-- 2. TAX IDENTIFIERS
--    GSTIN for Indian buyers. VAT ID for buyers abroad -- we do not charge on
--    it (an export of services is zero-rated either way), but a business buyer
--    needs it printed on the invoice to account for the purchase under their
--    own reverse-charge rules.
--
-- 3. TIMED OFFERS
--    A discount PERCENTAGE off the standard price, running until a deadline,
--    after which the standard price applies again with no action needed. The
--    standard price is mandatory; the discount and deadline are one optional
--    pair. The expiry is enforced in SQL and re-checked at order creation: a
--    countdown in a browser is decoration, and the obvious move is to open the
--    page before expiry and buy after it.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1 & 2: guest orders ──────────────────────────────────────────────────────

ALTER TABLE public.orders
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS buyer_email      text,
  ADD COLUMN IF NOT EXISTS buyer_name       text,
  ADD COLUMN IF NOT EXISTS buyer_state_code text,
  ADD COLUMN IF NOT EXISTS buyer_vat_id     text,
  -- Lets a guest reach their own invoice without an account. Random, single
  -- purpose, and useless for anything but this one order.
  ADD COLUMN IF NOT EXISTS access_token     text UNIQUE;

COMMENT ON COLUMN public.orders.buyer_email IS
  'Buyer email AS AT THE SALE. Snapshotted rather than joined from the account, so an invoice does not change when a profile is edited.';
COMMENT ON COLUMN public.orders.buyer_vat_id IS
  'VAT/tax identifier for a buyer outside India. Printed on the invoice; no Indian GST is charged either way.';
COMMENT ON COLUMN public.orders.access_token IS
  'Bearer-style token for a guest to retrieve their own invoice. Not a session, not reusable elsewhere.';

-- An order must be attributable to somebody: an account, or an email.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_has_a_buyer;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_has_a_buyer
  CHECK (user_id IS NOT NULL OR buyer_email IS NOT NULL);

CREATE INDEX IF NOT EXISTS orders_buyer_email_idx ON public.orders (buyer_email, created_at DESC);

-- ── 3: timed offers ──────────────────────────────────────────────────────────
--
-- Expressed as a DISCOUNT PERCENTAGE off the standard price, not as a second
-- absolute price. That is how an offer is actually described ("25% off until
-- Friday"), and it means raising the standard price keeps the offer correct
-- instead of silently selling at an old absolute figure.
--
-- The standard price is mandatory and always present. The discount and its
-- deadline are one optional pair: neither is meaningful alone, so the CHECK
-- requires both or neither.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS discount_bp   integer,
  ADD COLUMN IF NOT EXISTS offer_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS offer_label   text;

COMMENT ON COLUMN public.products.discount_bp IS
  'Discount in BASIS POINTS off price_paise (2500 = 25%). Same unit as gst_rate_bp, so no rate anywhere is a float. NULL means no offer.';
COMMENT ON COLUMN public.products.offer_ends_at IS
  'When the discount stops applying. After this the standard price_paise is charged, with no further action needed.';
COMMENT ON COLUMN public.products.offer_label IS
  'Short line shown beside the price, e.g. "Launch offer". Editable rather than in code.';

-- A discount and its deadline are one thing. A discount with no end never
-- ends, which is a price change; a deadline with no discount does nothing.
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_offer_is_complete;
ALTER TABLE public.products
  ADD CONSTRAINT products_offer_is_complete
  CHECK (
    (discount_bp IS NULL AND offer_ends_at IS NULL)
    OR (discount_bp IS NOT NULL AND offer_ends_at IS NOT NULL
        AND discount_bp > 0 AND discount_bp <= 10000)
  );

/**
 * What a product sells for right now.
 *
 * One definition, in the database, used by the product page, the quote and the
 * order. Computing "is the offer still on?" separately in three places is how a
 * page advertises one price and checkout charges another.
 *
 * Integer arithmetic throughout: the discount is rounded to whole paise and
 * SUBTRACTED, so the displayed saving and the charged price always agree.
 */
CREATE OR REPLACE FUNCTION public.effective_price_paise(p public.products)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
           WHEN p.discount_bp IS NOT NULL
            AND p.offer_ends_at IS NOT NULL
            AND p.offer_ends_at > now()
           THEN p.price_paise - round(p.price_paise::numeric * p.discount_bp / 10000)::integer
           ELSE p.price_paise
         END;
$$;
