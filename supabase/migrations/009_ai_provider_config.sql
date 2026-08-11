-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 009: AI provider configuration — admin-configurable, not hardcoded
--
-- Until this migration, every AI capability (text generation, image generation)
-- was hardcoded to Gemini in app code (app/admin/blog/ai-actions.ts), with the
-- API key read from a raw env var. This table makes the PROVIDER configurable
-- per capability (text/image/video) from the admin UI, including a
-- 'custom_webhook' provider type for operators running their own model
-- (e.g. a local GPU-hosted vLLM/Qwen endpoint, reachable via a Tailscale
-- Funnel or similar public tunnel) instead of a cloud provider.
--
-- ── Why this table holds API keys, and why that's still safe ──────────────────
--
-- `ai_provider_config` is intentionally NOT reachable via RLS by ANY session
-- role, not even 'admin' — no policies exist, matching the same pattern
-- `admin_users` and `role_capabilities` already use ("governing something
-- sensitive through the same path a browser session reaches is a privilege
-- escalation surface, even for an admin session — the boundary should be
-- 'can this server-side code read it', not 'does this browser session have
-- the right role'"). The admin UI's Server Actions connect via DATABASE_URL
-- (the table owner, bypasses RLS entirely — see app/admin/lib/db.ts's module
-- header) and are the only reader/writer, gated by middleware's session check
-- plus whatever capability check the settings page itself adds.
--
-- Keys are stored in PLAINTEXT in this table, not encrypted at rest. This is a
-- known, accepted limitation for now (matching this project's plaintext
-- Nextcloud secrets file convention, per explicit operator instruction earlier
-- this session) — revisit with pgcrypto column encryption if this table's
-- exposure surface ever changes (e.g. if a future integration reads it over
-- PostgREST/supabase-js rather than only the owner connection).
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_provider_config (
  capability    text        PRIMARY KEY CHECK (capability IN ('text', 'image', 'video')),
  provider      text        NOT NULL CHECK (provider IN ('gemini', 'openrouter', 'custom_webhook')),
  model         text,
  api_key       text,
  webhook_url   text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);

COMMENT ON TABLE public.ai_provider_config IS
  'Admin-configurable AI provider per capability (text/image/video). Intentionally NOT resource-tagged and NOT reachable via any RLS policy -- holds API keys, readable only by the owner-role server connection (app/admin/lib/db.ts), never through the capability system or a browser session.';

-- No RLS policies (matches admin_users, role_capabilities). RLS IS enabled —
-- with zero policies, every role except the table owner gets zero rows,
-- which is the deny-by-default behavior this needs.
ALTER TABLE public.ai_provider_config ENABLE ROW LEVEL SECURITY;

-- Seed: text/image default to gemini with the models confirmed working live
-- 2026-08-11 (see ai-actions.ts's history for the gemini-2.0-flash deprecation
-- that motivated making this configurable in the first place). No api_key
-- seeded — the operator sets it from the new admin settings page; until set,
-- calls fail with a clear "provider not configured" error, not a silent
-- fallback to an env var.
INSERT INTO public.ai_provider_config (capability, provider, model)
VALUES
  ('text', 'gemini', 'gemini-flash-latest'),
  ('image', 'gemini', 'gemini-3.1-flash-image')
ON CONFLICT (capability) DO NOTHING;
