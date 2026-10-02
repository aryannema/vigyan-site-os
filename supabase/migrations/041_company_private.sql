-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 041: directors, shareholding and banking — PRIVATE.
--
-- A SEPARATE table from company_profile, not more columns on it, for one
-- reason: company_profile grants SELECT to `anon`, and the anon key ships
-- inside the browser bundle on every page load. A bank account number added
-- there would be published to the internet, not stored.
--
-- Same split as app_config versus app_secrets (migrations 023 and 029). The
-- public table holds what is already printed on invoices — legal name, GSTIN,
-- CIN, address. This one holds what must never leave the server.
--
-- The account number is ENCRYPTED with CONFIG_ENCRYPTION_KEY, so a database
-- dump or a backup does not hand it over. The IFSC and MICR are not: they
-- identify a branch, are published by the RBI, and encrypting them would only
-- make the data harder to work with for no gain.
--
-- Director names, DINs and shareholding are matters of public record at the
-- MCA. They are kept here rather than on the public table because there is no
-- reason for the website to broadcast them — public record is not the same as
-- worth publishing.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.company_private (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Tax identifiers. TAN is needed to deduct TDS; PAN also lives on
  -- company_profile because it can appear on documents.
  tan           text,
  pan           text,

  -- Banking. account_number_enc is base64(iv||tag||ciphertext), same format as
  -- app_secrets and the deletion snapshots.
  bank_name             text,
  bank_branch           text,
  account_number_enc    text,
  account_number_last4  text,   -- for display, so the UI never decrypts to show "which account"
  ifsc                  text,
  micr                  text,
  account_type          text CHECK (account_type IS NULL OR account_type IN ('current', 'savings')),

  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);

COMMENT ON TABLE public.company_private IS
  'Company banking and tax identifiers. Service role only -- never grant to anon or authenticated. The account number is encrypted at rest.';
COMMENT ON COLUMN public.company_private.account_number_last4 IS
  'Plaintext last four digits, so the admin UI can show which account is configured without decrypting anything.';

ALTER TABLE public.company_private ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_private FROM anon, authenticated;
-- No policy defined on purpose: with RLS on and no policy, anon and
-- authenticated can do nothing. The service role bypasses RLS, which is the
-- only intended path.

INSERT INTO public.company_private (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── Directors ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.company_directors (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       text    NOT NULL,
  -- "S/O Parent Name" as filed. Kept as one field rather than parsed:
  -- relation prefixes vary (S/O, D/O, W/O) and filings are literal.
  parentage       text,
  -- Director Identification Number: exactly 8 digits, issued by the MCA.
  din             text    CHECK (din IS NULL OR din ~ '^[0-9]{8}$'),
  -- Shareholding in BASIS POINTS, like every other rate here. 9900 = 99%.
  -- Integer so a holding is never a float and the total can be checked exactly.
  shareholding_bp integer CHECK (shareholding_bp IS NULL OR (shareholding_bp >= 0 AND shareholding_bp <= 10000)),
  role            text    NOT NULL DEFAULT 'director'
                          CHECK (role IN ('director', 'managing_director', 'shareholder', 'nominee')),
  appointed_on    date,
  is_active       boolean NOT NULL DEFAULT true,
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.company_directors IS
  'Directors and shareholders. Public record at the MCA, but not published by this site -- service role only.';
COMMENT ON COLUMN public.company_directors.shareholding_bp IS
  'Basis points. 9900 = 99%. Integer so holdings sum exactly and 33.33% is representable without a float.';

-- A DIN identifies one person; two rows sharing one would be a data error.
CREATE UNIQUE INDEX IF NOT EXISTS company_directors_din_key
  ON public.company_directors (din) WHERE din IS NOT NULL;

ALTER TABLE public.company_directors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_directors FROM anon, authenticated;

/**
 * Total shareholding across active holders, in basis points.
 *
 * Reported rather than enforced by a constraint: during a transfer the total
 * legitimately passes through states that do not sum to 100%, and a CHECK would
 * block the intermediate save. The admin screen shows the total so a mistake is
 * visible without making a correct workflow impossible.
 */
-- Incorporation date belongs on the PUBLIC table: it appears on the certificate
-- of incorporation and is routinely shown in an "about" or footer.
ALTER TABLE public.company_profile
  ADD COLUMN IF NOT EXISTS incorporated_on date;

COMMENT ON COLUMN public.company_profile.incorporated_on IS
  'Date of incorporation as filed with the MCA. Public — it is on the certificate.';

CREATE OR REPLACE FUNCTION public.total_shareholding_bp()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(shareholding_bp), 0)::integer
    FROM public.company_directors
   WHERE is_active AND shareholding_bp IS NOT NULL;
$$;


-- Seed: as filed. The account number is written encrypted by the seeding step,
-- never as plaintext in a migration file.

