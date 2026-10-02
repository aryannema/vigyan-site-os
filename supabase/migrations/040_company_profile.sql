-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 040: the company's own identity, in one place.
--
-- The legal name, GSTIN and CIN were repeated across twelve files -- the
-- footer, four legal pages, both invoices, the schema.org block and two PDF
-- callers. Changing the registered address meant finding all of them, and the
-- proprietorship GSTIN already proved the failure mode: removed from the footer
-- and left standing on three legal pages for weeks.
--
-- One row, read everywhere, editable by an administrator.
--
-- A single row enforced by a CHECK on a fixed primary key, rather than by
-- convention. "The one where id = 1" is a rule that holds until someone inserts
-- a second row.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.company_profile (
  id              integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Identity
  legal_name      text NOT NULL,
  brand_name      text NOT NULL,
  entity_type     text NOT NULL DEFAULT 'private_limited'
                       CHECK (entity_type IN ('private_limited', 'llp', 'proprietorship', 'partnership')),
  cin             text,
  gstin           text,
  pan             text,

  -- Registered address. Separate fields rather than one blob, because the
  -- state code drives GST and an invoice needs the parts, not a paragraph.
  address_line1   text,
  address_line2   text,
  city            text,
  state_code      text,
  postal_code     text,
  country         text NOT NULL DEFAULT 'IN',

  -- Contact. The voice line and the WhatsApp number are DIFFERENT numbers here
  -- and always have been -- see src/config/site.ts.
  email           text,
  phone           text,

  -- Optional Google Maps embed. The Embed API is free and unlimited; a plain
  -- maps link needs no key at all. Neither is required.
  map_embed_url   text,
  map_link_url    text,

  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text
);

COMMENT ON TABLE public.company_profile IS
  'Single-row company identity. Read by the footer, the legal pages, both invoices and the schema.org block. id is pinned to 1 by a CHECK so a second row cannot appear.';
COMMENT ON COLUMN public.company_profile.state_code IS
  'GST state code as TEXT, so leading zeros survive -- 09 Uttar Pradesh is not 9. Drives CGST+SGST versus IGST.';
COMMENT ON COLUMN public.company_profile.phone IS
  'Voice line. NOT the WhatsApp number, which is a different number in app_config (migration 028).';

ALTER TABLE public.company_profile ENABLE ROW LEVEL SECURITY;

-- Publicly readable: every field here is already printed on the website and on
-- invoices. Nothing in this table is a secret.
DROP POLICY IF EXISTS "company_profile_public_read" ON public.company_profile;
CREATE POLICY "company_profile_public_read"
  ON public.company_profile FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "company_profile_admin_write" ON public.company_profile;
CREATE POLICY "company_profile_admin_write"
  ON public.company_profile FOR UPDATE TO authenticated
  USING (public.user_has_capability(auth.uid(), 'settings', 'edit'))
  WITH CHECK (public.user_has_capability(auth.uid(), 'settings', 'edit'));

GRANT SELECT ON public.company_profile TO anon, authenticated;
GRANT UPDATE ON public.company_profile TO authenticated;

-- Seeded from what the site currently hardcodes, so nothing changes on the day
-- this lands.
