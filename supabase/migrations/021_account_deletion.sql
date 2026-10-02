-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 021: account deletion -- two flows (signed-in self-service, and
-- an unauthenticated request verified on BOTH email + WhatsApp before it
-- executes), plus a minimal anonymized audit trail. See docs/OPS.md /
-- work-units/session-state.json for the design rationale: orders.user_id
-- cascades from auth.users, so this deliberately does NOT hard-delete the
-- auth user (would silently wipe legally-retained order/invoice records) --
-- it anonymizes site_accounts + the auth email instead, and bans login.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.site_accounts
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.site_accounts.deleted_at IS
  'Set when this account was anonymized via self-service or a dual-channel-verified deletion request (migration 021). A non-null value means first_name/last_name/whatsapp_number/whatsapp_verified_at/whatsapp_opt_in have been nulled and the auth.users email replaced with a placeholder -- orders/other records tied to this user_id are deliberately retained (legal/tax reasons, see /privacy).';

-- ── account_deletion_requests -- transient state for the unauthenticated,
-- dual-channel-verified flow. PII here is intentionally short-lived: once a
-- request completes (or expires), the row is deleted outright, not just
-- marked done -- its only job is to hold the email/phone JUST long enough to
-- verify ownership and execute the deletion. Service-role only, same as
-- whatsapp_otp_challenges (018).
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_email          text        NOT NULL,
  requested_phone          text        NOT NULL,
  email_token_hash         text        NOT NULL,
  email_token_expires_at   timestamptz NOT NULL,
  email_verified_at        timestamptz,
  whatsapp_code_hash       text,
  whatsapp_code_expires_at timestamptz,
  whatsapp_verified_at     timestamptz,
  whatsapp_attempts        integer     NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_deletion_requests_phone_idx
  ON public.account_deletion_requests (requested_phone);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_requests FROM PUBLIC, anon, authenticated;

-- ── account_deletion_log -- permanent, deliberately PII-free audit trail.
-- By the time this is written, site_accounts is already anonymized -- no
-- email/phone, hashed or otherwise, is kept here at all, per DPDP
-- minimization. Proves a legitimate (dual-channel-verified, or authenticated
-- self-service) deletion occurred, when, and how -- nothing more.
CREATE TABLE IF NOT EXISTS public.account_deletion_log (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        REFERENCES auth.users(id),
  method                text        NOT NULL CHECK (method IN ('self_service', 'verified_request')),
  requested_at          timestamptz NOT NULL DEFAULT now(),
  email_verified_at     timestamptz,
  whatsapp_verified_at  timestamptz,
  completed_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_deletion_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_log FROM PUBLIC, anon, authenticated;
-- Admin-readable via the existing 'settings' capability (migration 020) --
-- reuses the same admin-only gate as the feature-flags table rather than
-- inventing a new capability for one small read-only audit view.
DROP POLICY IF EXISTS "account_deletion_log_admin_read" ON public.account_deletion_log;
CREATE POLICY "account_deletion_log_admin_read"
  ON public.account_deletion_log FOR SELECT
  TO authenticated
  USING (user_has_capability(auth.uid(), 'settings', 'edit'));
GRANT SELECT ON public.account_deletion_log TO authenticated;
