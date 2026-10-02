-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 016: Admin-controllable local-AI toggle for the WhatsApp bot
--
-- The WhatsApp bot's local-vLLM-then-Gemini failover (route.ts, tryLocalAi/
-- tryGemini) had its local-AI leg force-disabled via a hardcoded
-- LOCAL_AI_DISABLED const, requiring a code change + redeploy to flip. Moving
-- this into ai_provider_config (same table already governing this
-- capability's provider/model/key) makes it an admin-UI toggle instead --
-- getProviderConfig()'s existing 60s cache means a flip takes effect within a
-- minute, no redeploy needed.
--
-- Only meaningful for the 'whatsapp_chat' capability (the only one with a
-- local-AI leg at all) -- defaults true for the other rows, harmless since
-- nothing reads it there.
--
-- Set to false for whatsapp_chat here to preserve current actual behavior
-- (operator disabled it 2026-08-18 pending a fix to the dev-box relay)
-- -- this migration must not silently re-enable it.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.ai_provider_config
  ADD COLUMN IF NOT EXISTS local_ai_enabled boolean NOT NULL DEFAULT true;

UPDATE public.ai_provider_config
SET local_ai_enabled = false
WHERE capability = 'whatsapp_chat';
