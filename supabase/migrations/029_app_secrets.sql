-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 029: app_secrets — admin-configurable SECRETS, encrypted at rest.
--
-- Migration 028 moved the CONFIGURABLE (non-secret) WhatsApp values into
-- public.app_config so they could be edited without a redeploy. This finishes
-- that job for the values 028 deliberately could not touch: the tokens.
--
-- Why a second table instead of reusing app_config: app_config grants SELECT to
-- `anon` (migration 023, `USING (true)`), and the anon key ships inside the
-- browser bundle. A secret written there would be published, not stored. This
-- table therefore has NO anon grant, no authenticated grant, and no RLS policy
-- permitting either -- it is reachable only through the service role, which
-- exists solely in server-side code.
--
-- Values are AES-256-GCM encrypted with CONFIG_ENCRYPTION_KEY before they are
-- written, so a database dump, a backup, or a replica does not hand over the
-- estate. The ciphertext format matches src/lib/account-deletion.ts:
--   base64(iv[12] || authTag[16] || ciphertext)
--
-- The key itself stays in env, necessarily: it is what decrypts this table, so
-- it cannot live in it. See docs/OPS.md §3 "Tier 0 — Bootstrap".
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_secrets (
  key          TEXT PRIMARY KEY,
  -- AES-256-GCM ciphertext, base64. NEVER plaintext.
  value_enc    TEXT        NOT NULL,
  description  TEXT,
  -- The env var this supersedes, so getSecret() knows what to fall back to
  -- during the migration window and operators can see the mapping.
  env_fallback TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   TEXT
);

COMMENT ON TABLE public.app_secrets IS
  'Admin-configurable secrets, AES-256-GCM encrypted. Service role only -- never grant to anon or authenticated.';
COMMENT ON COLUMN public.app_secrets.value_enc IS
  'base64(iv[12] || authTag[16] || ciphertext), key = CONFIG_ENCRYPTION_KEY.';

ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;

-- No policies are defined on purpose. With RLS enabled and no policy, anon and
-- authenticated can do nothing at all. The service role bypasses RLS, which is
-- the only intended access path.
--
-- Explicitly revoke, so a future blanket GRANT on the schema cannot widen this
-- table by accident.
REVOKE ALL ON public.app_secrets FROM anon, authenticated;

-- Audit: every write is recorded, and the VALUE IS NEVER STORED IN THE LOG --
-- only the fact that the key changed, and who changed it. A secret that is
-- audited in plaintext has not been protected.
CREATE TABLE IF NOT EXISTS public.app_secrets_audit (
  id         BIGSERIAL PRIMARY KEY,
  key        TEXT        NOT NULL,
  action     TEXT        NOT NULL CHECK (action IN ('set', 'rotate', 'delete')),
  actor      TEXT        NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_secrets_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_secrets_audit FROM anon;

-- Admins may READ the audit trail (not the secrets themselves).
DROP POLICY IF EXISTS "app_secrets_audit_admin_read" ON public.app_secrets_audit;
CREATE POLICY "app_secrets_audit_admin_read"
  ON public.app_secrets_audit FOR SELECT
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'settings', 'edit'));

GRANT SELECT ON public.app_secrets_audit TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.app_secrets_audit_id_seq TO authenticated;

CREATE INDEX IF NOT EXISTS app_secrets_audit_key_idx
  ON public.app_secrets_audit (key, changed_at DESC);
