// SERVER ONLY. Deliberately NOT a `'use server'` module: this is imported both
// by admin/blog/ai-actions.ts (a Server Actions file) and by the WhatsApp
// webhook route handler. If this file had `'use server'` at its top, every
// exported async function here — including one that returns a raw api_key —
// would become a publicly callable Server Action endpoint. Keeping it a plain
// module is what keeps that impossible.
//
// Single read path for "which provider/key/model backs AI capability X",
// shared by every caller regardless of how often or from where it's called:
//   - admin/blog/ai-actions.ts   text/image/video generation in the blog editor
//   - api/webhook/whatsapp/route.ts   the WhatsApp bot's cloud-fallback reply
// Both read the same public.ai_provider_config table (009_ai_provider_config.sql),
// scoped by `capability` — 'whatsapp_chat' added in 014 alongside the
// pre-existing 'text'/'image'/'video' rows the blog editor already used.
import { Pool, type QueryResultRow } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var __aiProviderConfigPool: Pool | undefined;
}

function getPool(): Pool {
  if (!global.__aiProviderConfigPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set.');
    global.__aiProviderConfigPool = new Pool({ connectionString, max: 5 });
  }
  return global.__aiProviderConfigPool;
}

export type AiCapability = 'text' | 'image' | 'video' | 'whatsapp_chat';
export type AiProviderKind = 'gemini' | 'openrouter' | 'custom_webhook';

export interface AiProviderConfig {
  capability: AiCapability;
  provider: AiProviderKind;
  model: string | null;
  api_key: string | null;
  webhook_url: string | null;
  /** Only meaningful for 'whatsapp_chat' -- whether tryLocalAi() should be attempted before Gemini. */
  local_ai_enabled: boolean;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<AiCapability, { value: AiProviderConfig | null; expiresAt: number }>();

/**
 * Reads one capability's provider config, cached in-memory for CACHE_TTL_MS —
 * the WhatsApp route calls this once per inbound message, so an uncached read
 * would add a DB round trip to every message. Same pattern already used by
 * getLocalAiModel()'s 60s cache.
 */
export async function getProviderConfig(capability: AiCapability): Promise<AiProviderConfig | null> {
  const cached = cache.get(capability);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const { rows } = await getPool().query<AiProviderConfig & QueryResultRow>(
    `SELECT capability, provider, model, api_key, webhook_url, local_ai_enabled
       FROM public.ai_provider_config WHERE capability = $1`,
    [capability],
  );
  const value = rows[0] ?? null;
  cache.set(capability, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
