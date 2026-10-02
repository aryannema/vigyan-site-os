-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 014: WhatsApp bot's Gemini fallback joins ai_provider_config
--
-- Until now, the blog editor's AI-assist (009_ai_provider_config.sql) and the
-- WhatsApp bot's cloud-fallback reply (src/app/api/webhook/whatsapp/route.ts)
-- each had their own separate idea of "the Gemini key": the blog editor read
-- from this table, the WhatsApp bot read a raw GEMINI_API_KEY env var set in
-- Coolify. Same provider, same underlying capability (call Gemini, get text
-- back), two disconnected places to configure it — a real source of confusion,
-- not a deliberate design.
--
-- This adds 'whatsapp_chat' as a fourth capability on the same table, so both
-- consumers read through the same shared module (src/lib/ai-provider-config.ts)
-- and the same admin screen (/admin/ai-settings) governs both. No api_key is
-- seeded here — the app falls back to the GEMINI_API_KEY env var when this
-- row's api_key is NULL (see route.ts), so this migration is a pure addition,
-- zero behavior change until an operator explicitly sets a key via the UI.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.ai_provider_config DROP CONSTRAINT IF EXISTS ai_provider_config_capability_check;
ALTER TABLE public.ai_provider_config
  ADD CONSTRAINT ai_provider_config_capability_check
  CHECK (capability IN ('text', 'image', 'video', 'whatsapp_chat'));

INSERT INTO public.ai_provider_config (capability, provider, model)
VALUES ('whatsapp_chat', 'gemini', 'gemini-1.5-flash')
ON CONFLICT (capability) DO NOTHING;
