-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 042: multiple bank accounts, exactly one primary.
--
-- company_private held a single account, which was right while there was one.
-- A second — a separate settlement account, an FD, a tax account — needs its
-- own rows and a way to say which one money should go to.
--
-- "Exactly one primary" is enforced by a PARTIAL UNIQUE INDEX, not by
-- application code. Doing it in the app means read-then-write: find the current
-- primary, clear it, set the new one. Two administrators doing that at the same
-- instant leaves zero primaries or two, and the second case is worse — a
-- settlement going to an account nobody chose. The index makes the database
-- refuse the second write outright.
--
-- Switching primary is therefore a single atomic statement (see
-- set_primary_account below), not a sequence.
--
-- A NEW capability resource, 'company_finance', separate from 'settings'. Bank
-- details are a different kind of access from editing the site's WhatsApp
-- number, and one grant covering both means granting a colleague the ability to
-- edit copy also hands them the bank accounts.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.company_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label                 text NOT NULL,
  bank_name             text NOT NULL,
  bank_branch           text,

  -- AES-256-GCM, same format as app_secrets. Never plaintext.
  account_number_enc    text NOT NULL,
  account_number_last4  text NOT NULL CHECK (account_number_last4 ~ '^[0-9]{4}$'),

  ifsc                  text CHECK (ifsc IS NULL OR ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  micr                  text CHECK (micr IS NULL OR micr ~ '^[0-9]{9}$'),
  swift                 text CHECK (swift IS NULL OR swift ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),

  account_type          text NOT NULL DEFAULT 'current'
                          CHECK (account_type IN ('current', 'savings', 'od', 'fd', 'escrow')),
  purpose               text,
  currency              text NOT NULL DEFAULT 'INR',

  is_primary            boolean NOT NULL DEFAULT false,
  is_active             boolean NOT NULL DEFAULT true,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text
);

COMMENT ON TABLE public.company_accounts IS
  'Company bank accounts. Exactly one active primary, enforced by a partial unique index rather than by application code.';
COMMENT ON COLUMN public.company_accounts.is_primary IS
  'Where settlements go. At most one active account may carry this — the database refuses a second.';
COMMENT ON COLUMN public.company_accounts.swift IS
  'For foreign inward remittance. 8 or 11 characters.';

-- THE constraint. One active primary, at most, always.
CREATE UNIQUE INDEX IF NOT EXISTS company_accounts_one_primary
  ON public.company_accounts ((true)) WHERE is_primary AND is_active;

-- The same account should not be entered twice for one bank.
CREATE UNIQUE INDEX IF NOT EXISTS company_accounts_no_duplicates
  ON public.company_accounts (bank_name, account_number_last4, ifsc) WHERE is_active;

ALTER TABLE public.company_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_accounts FROM anon, authenticated;

/**
 * Makes one account primary, atomically.
 *
 * Clearing the old primary and setting the new one happen in ONE statement, so
 * there is no instant where zero or two accounts are primary. Written as a
 * single UPDATE over all rows rather than two statements precisely because two
 * statements can interleave with another administrator's.
 *
 * Refuses an inactive account: an account nobody is using should not be where
 * money arrives.
 */
CREATE OR REPLACE FUNCTION public.set_primary_account(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.company_accounts WHERE id = p_account_id AND is_active) THEN
    RAISE EXCEPTION 'Account % does not exist or is not active — an inactive account cannot receive settlements.', p_account_id;
  END IF;

  UPDATE public.company_accounts
     SET is_primary = (id = p_account_id),
         updated_at = now()
   WHERE is_primary OR id = p_account_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_primary_account(uuid) FROM PUBLIC, anon, authenticated;

-- ── A capability of its own ──────────────────────────────────────────────────
--
-- So access to bank accounts can be granted without granting the rest of
-- settings, and taken away without removing it.

INSERT INTO public.role_capabilities (role, resource_key, action) VALUES
  ('admin', 'company_finance', 'view'),
  ('admin', 'company_finance', 'edit')
ON CONFLICT DO NOTHING;

-- ── Carry the existing account over ──────────────────────────────────────────
--
-- Moved rather than copied: two records of one account drift, and the one in
-- company_private would go stale the first time the other changed.

