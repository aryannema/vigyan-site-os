// Single source of truth for "which Gemini model actually exists right now,"
// for both text and image generation.
//
// Hardcoding a dated model name (gemini-1.5-flash, gemini-2.0-flash, ...) goes
// stale the moment Google retires it -- generateContent then 404s, which every
// caller here already treats as "provider failed" and fails over/errors out
// silently (see the WhatsApp bot's Gemini fallback, which is exactly how the
// 1.5-flash retirement was discovered: a valid key, a dead model name, zero
// error surfaced to an operator). This queries ListModels for real instead, so
// the resolved name only ever comes from what the key can currently call.
//
// Mirrors getLocalAiModel()'s pattern (src/lib/local-ai-model.ts): discover via
// API, cache briefly, return null on failure so the caller fails over instead
// of guessing a name.

type GeminiModel = { name: string; supportedGenerationMethods?: string[] };

type DiscoveryConfig = {
  cacheKey: 'text' | 'image';
  include: RegExp;
  exclude: RegExp;
  preferredAlias?: string; // Google's own rolling alias, when one exists for this kind
};

const CACHE_TTL_MS = 3600_000; // Gemini's model lineup doesn't change minute to minute
const cache = new Map<string, { model: string; cachedAt: number }>();

async function discoverModel(apiKey: string, config: DiscoveryConfig): Promise<string | null> {
  const now = Date.now();
  const cached = cache.get(config.cacheKey);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) return cached.model;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const models: GeminiModel[] = data?.models ?? [];
    const candidates = models
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .filter((m) => config.include.test(m.name) && !config.exclude.test(m.name));
    if (candidates.length === 0) return null;

    // Prefer Google's own rolling alias when one exists AND is actually present
    // in this key's model list -- it's the one name guaranteed to keep tracking
    // "current" without this cache needing to re-sort on every retirement.
    const alias = config.preferredAlias
      ? candidates.find((m) => m.name === config.preferredAlias)
      : undefined;
    const chosen = alias ?? candidates.sort((a, b) => b.name.localeCompare(a.name))[0];

    const modelId = chosen.name.replace(/^models\//, '');
    cache.set(config.cacheKey, { model: modelId, cachedAt: now });
    return modelId;
  } catch {
    return null; // ListModels unreachable/erroring -- caller should fail over, not guess a name
  }
}

export function getGeminiModel(apiKey: string): Promise<string | null> {
  return discoverModel(apiKey, {
    cacheKey: 'text',
    include: /flash/,
    exclude: /lite|image|tts|preview|embedding/,
    preferredAlias: 'models/gemini-flash-latest',
  });
}

export function getGeminiImageModel(apiKey: string): Promise<string | null> {
  // No rolling "-latest" alias exists for image models as of this writing
  // (confirmed against ListModels) -- newest-by-name is the best available
  // signal, same as the local vLLM discovery falls back to when unsure.
  return discoverModel(apiKey, {
    cacheKey: 'image',
    include: /image/,
    exclude: /lite|preview/,
  });
}
