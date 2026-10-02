// Single source of truth for "which model is vLLM actually serving right now."
//
// Never hardcode a model name elsewhere in this repo. The served model changes
// between sessions on gpu-box (confirmed 2026-08-10: a stale gemma-4-26b
// config silently broke replies for weeks after the lane switched to
// qwen3.6-35b-a3b-nvfp4-fp8 -- vLLM returned a clean 404, not a hang, but
// nothing surfaced it until someone actually read the logs).
//
// Callers should use getLocalAiModel() instead of process.env.LOCAL_AI_MODEL
// directly. The env var remains only as a last-resort fallback if the /v1/models
// call itself fails (e.g. vLLM is down) -- in that case the caller should
// probably fail over to the cloud AI path anyway, not trust a stale name.

let cachedModel: string | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000; // re-check at most once a minute, not per-request

export async function getLocalAiModel(localAiUrl: string, authSecret?: string): Promise<string | null> {
  const now = Date.now();
  if (cachedModel && now - cachedAt < CACHE_TTL_MS) {
    return cachedModel;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${localAiUrl}/models`, {
      signal: controller.signal,
      headers: authSecret ? { Authorization: `Bearer ${authSecret}` } : undefined,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const modelId: string | undefined = data?.data?.[0]?.id;
    if (!modelId) return null;
    cachedModel = modelId;
    cachedAt = now;
    return modelId;
  } catch {
    return null; // vLLM unreachable -- caller should fail over, not guess a name
  }
}
