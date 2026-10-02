-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 032: archive the issued invoice PDF.
--
-- Until now the PDF was rendered on demand from the order's immutable tax
-- snapshot, which is always arithmetically correct. That is not quite enough
-- for a tax document: if the TEMPLATE changes -- a new address, a new logo, a
-- reworded footer -- regenerating produces a document that is correct but is
-- not the one the customer received. In an audit you want the artifact that was
-- issued, byte for byte.
--
-- So the bytes are archived once, at issue, and served from the archive
-- thereafter. Rendering remains the fallback for orders paid before this
-- existed, which then archive themselves on first download.
--
-- WHY POSTGRES AND NOT OBJECT STORAGE:
--
--   Portability. Everything else worth keeping already lives in this database
--   and is already in the backup. An object store is another credential,
--   another service to provision, and another thing to move on a host
--   migration -- against the portability goal that drove this whole design.
--
--   Atomicity. Allocating the invoice number and storing its PDF belong in one
--   transaction. Split across a database and a bucket, the failure modes are a
--   number allocated with no document, or a document uploaded under a number
--   that was never committed.
--
--   Size. An invoice is tens of kilobytes. Ten thousand of them is well under a
--   gigabyte, TOAST-compressed and out of line, fetched only when someone
--   actually downloads one. Object storage earns its complexity on large or
--   numerous blobs; this is neither.
--
-- Revisit that if invoices ever become large, numerous, or hot.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invoice_archive (
  order_id    uuid        PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  pdf         bytea       NOT NULL,
  byte_size   integer     NOT NULL,
  -- So a stored document can be proved unchanged since issue, rather than
  -- merely assumed to be.
  sha256      text        NOT NULL,
  rendered_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.invoice_archive IS
  'The invoice PDF exactly as issued. Written once; never updated. If the template changes, previously issued invoices keep the document the customer actually received.';

ALTER TABLE public.invoice_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_archive FROM anon, authenticated;

-- Service role only. A buyer reaches their own invoice through
-- GET /api/invoice/[id], which checks ownership; there is no reason to expose
-- a table of everyone's tax documents to the anon or authenticated roles.

-- An archived invoice must not be silently replaced. Correcting a wrong invoice
-- is a credit note and a new invoice, which is what GST requires -- not an
-- edit to the document already given to the customer.
CREATE OR REPLACE FUNCTION public.invoice_archive_is_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'invoice_archive is append-only: invoice for order % has already been issued. Raise a credit note and a new invoice instead.',
    OLD.order_id;
END;
$$;

DROP TRIGGER IF EXISTS invoice_archive_no_update ON public.invoice_archive;
CREATE TRIGGER invoice_archive_no_update
  BEFORE UPDATE ON public.invoice_archive
  FOR EACH ROW EXECUTE FUNCTION public.invoice_archive_is_immutable();
