-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 031: invoice numbering.
--
-- The PDF is NOT stored. The order already carries an immutable snapshot of
-- everything an invoice states -- taxable value, CGST/SGST/IGST, rate, place of
-- supply, buyer GSTIN (migration 030) -- so the document is rendered from that
-- on demand and is correct every time by construction.
--
-- Storing a generated file instead would mean a writable volume (which does not
-- survive a host move, and the operator's stated concern is portability), a
-- second thing to back up, and two copies of the same facts that can disagree.
--
-- What CANNOT be regenerated is the NUMBER. GST requires invoice numbers to be
-- a consecutive series, unique within a financial year, at most 16 characters.
-- "Consecutive" means it must be allocated once, by the database, and never
-- recomputed -- a number derived from a row's position or a timestamp would
-- renumber itself the moment anything is inserted, refunded or deleted.
--
-- Indian financial year runs April-March, so the series resets each April.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS invoice_number text UNIQUE,
  ADD COLUMN IF NOT EXISTS invoice_date   timestamptz;

COMMENT ON COLUMN public.orders.invoice_number IS
  'Allocated ONCE when the order is paid, by allocate_invoice_number(). Never recomputed.';

CREATE TABLE IF NOT EXISTS public.invoice_series (
  financial_year text    PRIMARY KEY,   -- '2026-27'
  last_number    integer NOT NULL DEFAULT 0
);

ALTER TABLE public.invoice_series ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_series FROM anon, authenticated;

/**
 * Allocates the next invoice number for an order, atomically.
 *
 * The UPDATE ... RETURNING under a row lock is what makes the series
 * gap-free and duplicate-free when two payments land at the same instant.
 * Doing this as SELECT-max-then-INSERT in application code is how two
 * customers end up holding the same invoice number.
 *
 * Idempotent: an order that already has a number keeps it, so a webhook
 * redelivery -- which Razorpay will do -- cannot burn a second number.
 */
CREATE OR REPLACE FUNCTION public.allocate_invoice_number(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing text;
  v_fy       text;
  v_next     integer;
BEGIN
  SELECT invoice_number INTO v_existing FROM public.orders WHERE id = p_order_id;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Indian FY: April to March.
  v_fy := CASE
            WHEN EXTRACT(MONTH FROM now()) >= 4
              THEN to_char(now(), 'YYYY') || '-' || to_char(now() + interval '1 year', 'YY')
            ELSE to_char(now() - interval '1 year', 'YYYY') || '-' || to_char(now(), 'YY')
          END;

  INSERT INTO public.invoice_series (financial_year, last_number)
       VALUES (v_fy, 0)
  ON CONFLICT (financial_year) DO NOTHING;

  UPDATE public.invoice_series
     SET last_number = last_number + 1
   WHERE financial_year = v_fy
  RETURNING last_number INTO v_next;

  -- e.g. VB/2026-27/000042 — 16 characters, within the GST limit.
  v_existing := 'VB/' || v_fy || '/' || lpad(v_next::text, 6, '0');

  UPDATE public.orders
     SET invoice_number = v_existing,
         invoice_date   = COALESCE(invoice_date, now())
   WHERE id = p_order_id;

  RETURN v_existing;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_invoice_number(uuid) FROM PUBLIC, anon, authenticated;
