-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 018: mandatory profile completion (name + OTP-verified WhatsApp
-- number), an OTP-challenge table for that verification, and a real `orders`
-- table replacing a live bug in account/page.tsx.
--
-- Three pieces, bundled because they were all requested together and the
-- first two share the same site_accounts row:
--
--   1. site_accounts gains first_name/last_name/whatsapp_verified_at.
--      Profile "complete" = first_name && last_name && whatsapp_verified_at,
--      computed in application code (src/lib/site-accounts.ts), not stored
--      here as a redundant boolean -- a cached flag could drift from the
--      fields it summarizes.
--   2. whatsapp_otp_challenges -- server-side-only OTP state. Deliberately
--      zero RLS policies, same unreachable-via-session-role pattern as
--      payment_gateway_config (011 §2): a client must never be able to read
--      or compare a code, only supabaseAdmin (service role) touches this
--      table.
--   3. orders -- account/page.tsx has been querying order_id/amount/status
--      from user_entitlements since it was written, but that table (001)
--      only ever had id/user_id/entitlement/created_at -- those columns have
--      never existed, confirmed live against production. It silently fails
--      today; every user sees "No purchases yet." regardless of reality.
--      user_entitlements stays as-is (still used for coarse-grained paid-
--      content access grants elsewhere) -- orders is the real purchase-
--      history record, with an actual FK to products instead of a free-text
--      label, and account/page.tsx is repointed at it in the same session
--      this migration ships in.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. site_accounts -- profile-completion fields ──────────────────────────
ALTER TABLE public.site_accounts
  ADD COLUMN IF NOT EXISTS first_name           text,
  ADD COLUMN IF NOT EXISTS last_name            text,
  ADD COLUMN IF NOT EXISTS whatsapp_verified_at timestamptz;

COMMENT ON COLUMN public.site_accounts.whatsapp_verified_at IS
  'Set only by POST /api/profile/whatsapp/verify-otp on a successful code match. Distinct from whatsapp_collected_at (013), which just meant "the old skippable prompt was answered, verified or not". A non-null value here means this exact whatsapp_number was OTP-confirmed.';

-- Existing site_accounts_self_update policy (011 §4) already covers writes to
-- these new columns (USING/WITH CHECK is user_id = auth.uid(), column-
-- agnostic) -- no new RLS policy needed.

-- ── 2. whatsapp_otp_challenges -- server-side-only OTP state ───────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_otp_challenges (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number text        NOT NULL,
  code_hash    text        NOT NULL,   -- HMAC-SHA256(code, OTP_HASH_SECRET) -- never plaintext
  attempts     integer     NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_otp_challenges_user_idx
  ON public.whatsapp_otp_challenges (user_id, created_at DESC);

COMMENT ON TABLE public.whatsapp_otp_challenges IS
  'Server-side OTP state for WhatsApp number verification during profile completion. Deliberately zero RLS policies, same unreachable-via-session-role pattern as payment_gateway_config (011 §2) -- verification must happen server-side only, reachable exclusively via supabaseAdmin.';

ALTER TABLE public.whatsapp_otp_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_otp_challenges FROM PUBLIC, anon, authenticated;

-- ── 3. orders -- real purchase history, replacing the broken query ─────────
CREATE TABLE IF NOT EXISTS public.orders (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id         uuid        REFERENCES public.products(id),
  razorpay_order_id  text,
  razorpay_payment_id text,
  amount_paise       integer     NOT NULL DEFAULT 0,
  status             text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_user_idx ON public.orders (user_id, created_at DESC);

COMMENT ON TABLE public.orders IS
  'resource:orders -- real purchase-history record with an actual FK to products.id, replacing the free-text user_entitlements.entitlement column that account/page.tsx was never actually able to query (order_id/amount/status never existed on that table). user_entitlements (001) is unchanged and still used elsewhere for coarse-grained paid-content access grants.';

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders_self_read" ON public.orders;
CREATE POLICY "orders_self_read"
  ON public.orders FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.orders TO authenticated;
-- Deliberately no INSERT/UPDATE policy for `authenticated` -- orders are
-- only ever written server-side (Razorpay webhook, once that flow exists),
-- via the owner-role connection, matching payment_gateway_config's write
-- model. Reads only, same as user_entitlements_self_read (011 §4).
