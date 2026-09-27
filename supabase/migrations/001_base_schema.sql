-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 001: Generic base schema
--
-- vigyan-site-os is a brand-neutral site/CMS template. NOTHING in this file may
-- be specific to any one deployment: no seeded content, no seeded emails, no
-- brand strings, no sample rows. Every table here is a container; the contents
-- come from the deployer.
--
-- Ported (generalised) from the upstream production site's migrations:
--   000_base_schema.sql   -> site_content, content_history, posts,
--                            contact_inquiries, mcp_audit_log, user_entitlements
--   002_careers.sql       -> job_openings
--   003_whatsapp_hitl.sql -> whatsapp_conversations, whatsapp_messages
--
-- RLS is NOT enabled here. RLS + policies live in 003_role_expansion.sql so the
-- whole access-control surface is reviewable in one file. Between applying 001
-- and 003 these tables are unprotected — always apply the full set.
--
-- Safe to re-run: CREATE TABLE / CREATE INDEX use IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ── 1. site_content — keyed CMS document store ───────────────────────────────
-- One row per addressable section of the site (hero, footer, pricing, ...).
-- content_data is an arbitrary JSON document validated by the application layer,
-- deliberately not by the database, so new section shapes need no migration.
CREATE TABLE IF NOT EXISTS public.site_content (
  section_id    text        PRIMARY KEY,
  content_data  jsonb       NOT NULL,
  updated_at    timestamptz DEFAULT now()
);


-- ── 2. content_history — append-only version history for site_content ────────
CREATE TABLE IF NOT EXISTS public.content_history (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id    text        REFERENCES public.site_content(section_id),
  content_data  jsonb       NOT NULL,
  changed_by    text,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_history_section_created_idx
  ON public.content_history (section_id, created_at DESC);


-- ── 3. posts — blog / article store ──────────────────────────────────────────
-- ⚠ SECURITY-RELEVANT DIVERGENCE FROM SOURCE: status DEFAULT is 'draft' here,
--   not 'published'.
--
--   `status='published'` is what makes a row publicly readable by anon (see the
--   posts_public_read_published policy in 003). With the source's default, an
--   INSERT that simply omits `status` publishes to the whole internet — so the
--   `blog:publish` capability could be bypassed entirely by anyone holding
--   `blog:create`. RLS cannot gate a single column, so the default is the fix:
--   publishing now requires an explicit, auditable act.
--
--   To restore the old behaviour (not recommended):
--     ALTER TABLE public.posts ALTER COLUMN status SET DEFAULT 'published';
CREATE TABLE IF NOT EXISTS public.posts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text        NOT NULL,
  slug             text        UNIQUE NOT NULL,
  category         text        NOT NULL,
  seo_description  text,
  featured_image   text,
  content_blocks   jsonb       NOT NULL,
  status           text        NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','scheduled','published','archived')),
  published_at     timestamptz,
  created_at       timestamptz DEFAULT now()
);

-- Idempotent re-assertion for databases created from an earlier revision.
ALTER TABLE public.posts ALTER COLUMN status SET DEFAULT 'draft';

CREATE INDEX IF NOT EXISTS posts_status_published_idx
  ON public.posts (status, published_at DESC);


-- ── 4. contact_inquiries — public contact/lead form submissions ──────────────
CREATE TABLE IF NOT EXISTS public.contact_inquiries (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     text        NOT NULL,
  email         text        NOT NULL,
  phone_number  text,
  message       text        NOT NULL,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_inquiries_created_idx
  ON public.contact_inquiries (created_at DESC);


-- ── 5. mcp_audit_log — legacy MCP-tool-call audit trail ──────────────────────
-- Kept for backward compatibility with the upstream site's existing MCP route.
-- SUPERSEDED BY public.action_audit_log (see 004_audit_by_construction.sql),
-- which is the audit trail for every write path, not just MCP tool calls.
-- New code should write action_audit_log via perform_action().
CREATE TABLE IF NOT EXISTS public.mcp_audit_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name      text        NOT NULL,
  arguments      jsonb,
  success        boolean,
  error_message  text,
  changed_by     text,
  created_at     timestamptz DEFAULT now()
);

-- Present in the source as a separate ALTER in 001_rls_and_roles.sql; folded
-- into the CREATE above, but kept as an idempotent ALTER for databases that
-- were created from an older revision of this file.
ALTER TABLE public.mcp_audit_log ADD COLUMN IF NOT EXISTS changed_by text;


-- ── 6. user_entitlements — paid/gated content access grants ──────────────────
-- Placeholder for the deferred paywalled-content feature. Deliberately minimal:
-- the real shape (price, currency, order reference, expiry) is Phase 3 payments
-- design work and is NOT being guessed at here.
--
-- DIVERGENCE FROM SOURCE: the upstream reconstructed table has `user_id`,
-- but its self-read RLS policy matched on a non-existent `email` column. Here
-- the table carries `user_id uuid` with a real FK to auth.users and the policy
-- matches on `user_id = auth.uid()`, which is internally consistent.
CREATE TABLE IF NOT EXISTS public.user_entitlements (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  entitlement text        NOT NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_entitlements_user_idx
  ON public.user_entitlements (user_id);


-- ── 7. job_openings — careers listings ───────────────────────────────────────
-- ⚠ SECURITY-RELEVANT DIVERGENCE FROM SOURCE: status DEFAULT is 'draft' here,
--   not 'open', for exactly the reason given on posts above — 'open' is the
--   anon-readable state, so it must be entered deliberately, never by omission.
CREATE TABLE IF NOT EXISTS public.job_openings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text        NOT NULL,
  slug             text        NOT NULL UNIQUE,
  department       text,
  location         text,
  employment_type  text        NOT NULL DEFAULT 'FULL_TIME'
                     CHECK (employment_type IN ('FULL_TIME','PART_TIME','CONTRACTOR','INTERN','TEMPORARY')),
  workplace_type   text        CHECK (workplace_type IN ('on-site','remote','hybrid')),
  salary_min       numeric,
  salary_max       numeric,
  salary_currency  text        DEFAULT 'INR',
  salary_period    text        DEFAULT 'YEAR' CHECK (salary_period IN ('YEAR','MONTH','HOUR')),
  description      text        NOT NULL,
  responsibilities text[],
  requirements     text[],
  apply_url        text,
  apply_email      text,
  status           text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  valid_through    date,
  posted_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Idempotent re-assertion for databases created from an earlier revision.
ALTER TABLE public.job_openings ALTER COLUMN status SET DEFAULT 'draft';

CREATE INDEX IF NOT EXISTS job_openings_status_idx ON public.job_openings (status);


-- ── 8. whatsapp_conversations — one row per customer phone number ────────────
-- mode='auto' lets the bot reply; mode='human' means a person has taken over
-- and the bot must stay silent. last_inbound_at tracks the 24h free-text window
-- required by WhatsApp Business Messaging policy.
CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  phone_number      text        PRIMARY KEY,
  mode              text        NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto','human')),
  last_inbound_at   timestamptz,
  escalated_at      timestamptz,
  escalation_reason text,
  unresolved_turns  integer     NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);


-- ── 9. whatsapp_messages — immutable conversation audit trail ────────────────
-- Every inbound message and every outbound reply, with the model used, its
-- confidence, whether it triggered escalation and why, and a cost estimate.
-- This is evidence, not just a chat log — see the deliberate absence of
-- UPDATE/DELETE policies in 003_role_expansion.sql.
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number      text        NOT NULL REFERENCES public.whatsapp_conversations(phone_number) ON DELETE CASCADE,
  direction         text        NOT NULL CHECK (direction IN ('inbound','outbound')),
  body              text        NOT NULL,
  model             text,
  confidence        numeric,
  escalated         boolean     NOT NULL DEFAULT false,
  escalation_reason text,
  cost_estimate_usd numeric,
  wa_message_id     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_messages_phone_created_idx
  ON public.whatsapp_messages (phone_number, created_at DESC);


-- ── 10. Shared updated_at trigger ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_conversations_set_updated_at ON public.whatsapp_conversations;
CREATE TRIGGER whatsapp_conversations_set_updated_at
  BEFORE UPDATE ON public.whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS job_openings_set_updated_at ON public.job_openings;
CREATE TRIGGER job_openings_set_updated_at
  BEFORE UPDATE ON public.job_openings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
