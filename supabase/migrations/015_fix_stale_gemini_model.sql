-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 015: Fix stale gemini-1.5-flash model names
--
-- Root cause of the WhatsApp bot's cloud fallback silently failing whenever
-- the local vLLM node is unreachable: 'gemini-1.5-flash', seeded by migration
-- 014 and hardcoded as route.ts's env-var-fallback model name, has been
-- retired by Google -- generateContent now 404s on it ("models/gemini-1.5-flash
-- is not found for API version v1beta"). tryGemini() treats any non-2xx as a
-- failed call and returns null, so generateReply() fell through past both
-- local AND cloud to the canned "having trouble reaching our AI service"
-- message. Confirmed live against the production key (which is itself valid --
-- this was a model-name problem, not a key/auth problem).
--
-- 'gemini-flash-latest' is Google's stable rolling alias, so this doesn't go
-- stale again the next time a dated model is retired. route.ts's hardcoded
-- fallback was updated to match in the same change.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.ai_provider_config
SET model = 'gemini-flash-latest'
WHERE capability IN ('text', 'image', 'whatsapp_chat')
  AND provider = 'gemini'
  AND model IN ('gemini-1.5-flash', 'gemini-1.5-pro');
