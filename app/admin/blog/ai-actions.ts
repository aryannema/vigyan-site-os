'use server';

/**
 * AI writing/image assistance for the blog editor — the "post creator" AI,
 * admin-only. Provider-agnostic: which provider/model/key is active per
 * capability ('text' | 'image' | 'video') is admin-configurable, stored in
 * `ai_provider_config` (009_ai_provider_config.sql), not hardcoded. See that
 * migration's header for why API keys live in that table rather than an env
 * var or `site_content`.
 *
 * Three provider kinds, dispatched on `provider`:
 *   - gemini          Google's REST API directly (no SDK dependency).
 *   - openrouter       OpenAI-compatible chat completions — TEXT ONLY for now;
 *                      OpenRouter's image-generation API shape was not
 *                      verified against a live call, so 'image'/'video' with
 *                      this provider return a clear "not yet supported" error
 *                      rather than a guessed, possibly-wrong implementation.
 *   - custom_webhook   For operators running their own model (e.g. a local
 *                      GPU-hosted vLLM/Qwen endpoint behind a Tailscale
 *                      Funnel). Contract, deliberately minimal:
 *                        text:  POST {prompt} -> {text: string}
 *                        image: POST {prompt} -> {mimeType: string, data: base64 string}
 *                      The operator's own webhook adapts whatever they're
 *                      actually running to this shape.
 *
 * Every text function returns a plain string/array — never HTML, never raw
 * Tiptap/ProseMirror JSON. The caller puts the result into the editor through
 * normal Tiptap commands, so nothing here can inject unvalidated content into
 * the document.
 *
 * ── Writing style ────────────────────────────────────────────────────────────
 * Default AI output reads as generic AI-generated text — a real, named
 * complaint, not a nicety. `getWritingStyle()`/`setWritingStyle()` persist a
 * short operator-written style description in `site_content` (section_id
 * `ai_writing_style` — a generic content field, not a secret, unlike provider
 * config), and every text prompt below prepends it as a hard instruction.
 */

import { query, mutate } from '../lib/db';
import { uploadBytesToStorage } from './upload-actions';

const WRITING_STYLE_SECTION_ID = 'ai_writing_style';

export async function getWritingStyle(): Promise<string> {
  const rows = await query<{ content_data: { text?: string } }>(
    `SELECT content_data FROM public.site_content WHERE section_id = $1`,
    [WRITING_STYLE_SECTION_ID],
  );
  return rows[0]?.content_data?.text ?? '';
}

export async function setWritingStyle(text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await mutate(async (client) => {
      const before = await client.query<{ content_data: unknown }>(
        `SELECT content_data FROM public.site_content WHERE section_id = $1`,
        [WRITING_STYLE_SECTION_ID],
      );
      await client.query(
        `INSERT INTO public.site_content (section_id, content_data, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (section_id) DO UPDATE SET content_data = $2::jsonb, updated_at = now()`,
        [WRITING_STYLE_SECTION_ID, JSON.stringify({ text })],
      );
      return {
        result: undefined,
        audit: {
          resourceKey: 'cms',
          action: before.rows.length > 0 ? ('edit' as const) : ('create' as const),
          targetId: WRITING_STYLE_SECTION_ID,
          before: before.rows[0]?.content_data ?? null,
          after: { text },
        },
      };
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error.' };
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Provider configuration
 * ──────────────────────────────────────────────────────────────────────────*/

export type AiCapability = 'text' | 'image' | 'video';
export type AiProviderKind = 'gemini' | 'openrouter' | 'custom_webhook';

export interface AiProviderConfig {
  capability: AiCapability;
  provider: AiProviderKind;
  model: string | null;
  api_key: string | null;
  webhook_url: string | null;
}

/** Never returns the raw api_key — for rendering the settings page safely. */
export interface AiProviderConfigPublic {
  capability: AiCapability;
  provider: AiProviderKind;
  model: string | null;
  webhook_url: string | null;
  hasKey: boolean;
}

async function getProviderConfig(capability: AiCapability): Promise<AiProviderConfig | null> {
  const rows = await query<AiProviderConfig>(
    `SELECT capability, provider, model, api_key, webhook_url
       FROM public.ai_provider_config WHERE capability = $1`,
    [capability],
  );
  return rows[0] ?? null;
}

/** For the settings page — every configured capability, keys redacted. */
export async function listProviderConfigs(): Promise<AiProviderConfigPublic[]> {
  const rows = await query<AiProviderConfig>(
    `SELECT capability, provider, model, api_key, webhook_url FROM public.ai_provider_config ORDER BY capability`,
  );
  return rows.map(({ api_key, ...rest }) => ({ ...rest, hasKey: Boolean(api_key) }));
}

/**
 * Upserts one capability's config. `apiKey` is optional on purpose: leaving it
 * unset (vs. explicitly clearing it) keeps the existing key, so the settings
 * form never has to re-display or round-trip the real secret value.
 */
export async function setProviderConfig(input: {
  capability: AiCapability;
  provider: AiProviderKind;
  model: string;
  apiKey?: string;
  webhookUrl?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await mutate(async (client) => {
      const before = await client.query<{ provider: string; model: string | null }>(
        `SELECT provider, model FROM public.ai_provider_config WHERE capability = $1`,
        [input.capability],
      );
      await client.query(
        `INSERT INTO public.ai_provider_config (capability, provider, model, api_key, webhook_url, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (capability) DO UPDATE SET
           provider = $2,
           model = $3,
           api_key = COALESCE($4, public.ai_provider_config.api_key),
           webhook_url = $5,
           updated_at = now()`,
        [input.capability, input.provider, input.model, input.apiKey ?? null, input.webhookUrl ?? null],
      );
      return {
        result: undefined,
        audit: {
          resourceKey: 'cms',
          action: before.rows.length > 0 ? ('edit' as const) : ('create' as const),
          targetId: `ai_provider_config:${input.capability}`,
          before: before.rows[0] ?? null,
          // Never audit-log the key itself.
          after: { provider: input.provider, model: input.model },
        },
      };
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error.' };
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Text generation — dispatches on the configured provider
 * ──────────────────────────────────────────────────────────────────────────*/

function styleInstruction(style: string): string {
  if (!style.trim()) return '';
  return (
    `Write in this specific voice, not a generic AI-assistant tone: ${style.trim()}\n` +
    `Do not write like a typical AI-generated post — avoid the "professional LinkedIn AI" cadence ` +
    `(no "In today's fast-paced world", no excessive em-dashes, no listy false-enthusiasm, no ` +
    `summarizing what you just said). Write like the specific person described above actually writes.\n\n`
  );
}

async function callGeminiText(config: AiProviderConfig, prompt: string): Promise<string> {
  if (!config.api_key) throw new Error('Gemini is selected for text, but no API key is configured.');
  const model = config.model || 'gemini-flash-latest';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.api_key}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Gemini request failed (${response.status}): ${body.slice(0, 300)}`);
  }
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no text — the response may have been blocked by a safety filter.');
  return text.trim();
}

async function callOpenRouterText(config: AiProviderConfig, prompt: string): Promise<string> {
  if (!config.api_key) throw new Error('OpenRouter is selected for text, but no API key is configured.');
  if (!config.model) throw new Error('OpenRouter is selected for text, but no model is configured.');
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.api_key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1024,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenRouter request failed (${response.status}): ${body.slice(0, 300)}`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenRouter returned no text.');
  return text.trim();
}

async function callWebhookText(config: AiProviderConfig, prompt: string): Promise<string> {
  if (!config.webhook_url) throw new Error('Custom webhook is selected for text, but no URL is configured.');
  const response = await fetch(config.webhook_url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.api_key ? { Authorization: `Bearer ${config.api_key}` } : {}),
    },
    body: JSON.stringify({ prompt }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Webhook request failed (${response.status}): ${body.slice(0, 300)}`);
  }
  const data = (await response.json()) as { text?: string };
  if (!data.text) throw new Error('Webhook response did not include a "text" field.');
  return data.text.trim();
}

async function callTextProvider(prompt: string): Promise<string> {
  const config = await getProviderConfig('text');
  if (!config) throw new Error('No text-generation provider is configured. Set one in AI settings.');

  const style = await getWritingStyle();
  const fullPrompt = styleInstruction(style) + prompt;

  switch (config.provider) {
    case 'gemini':
      return callGeminiText(config, fullPrompt);
    case 'openrouter':
      return callOpenRouterText(config, fullPrompt);
    case 'custom_webhook':
      return callWebhookText(config, fullPrompt);
  }
}

/** Rewrites/improves a piece of body text. Returns plain text — no markup added beyond what was already there. */
export async function improveText(text: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!text.trim()) return { ok: false, error: 'Nothing to improve — select or write some text first.' };
  try {
    const result = await callTextProvider(
      `Improve the clarity, flow, and concision of this blog paragraph. Keep the same meaning and roughly the same length. ` +
        `Preserve any **bold**, _italic_, \`code\`, or [link](url) Markdown formatting already present — do not add new formatting. ` +
        `Return ONLY the improved text, no preamble, no quotes around it:\n\n${text}`,
    );
    return { ok: true, text: result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error.' };
  }
}

/** Suggests 3-5 title options based on the current draft content. */
export async function suggestTitles(
  content: string,
): Promise<{ ok: true; titles: string[] } | { ok: false; error: string }> {
  if (!content.trim()) return { ok: false, error: 'Write some content first, then ask for title suggestions.' };
  try {
    const result = await callTextProvider(
      `Suggest 5 concise, specific blog post titles for this content. Avoid generic/clickbait phrasing. ` +
        `Return ONLY the 5 titles, one per line, no numbering, no quotes:\n\n${content.slice(0, 4000)}`,
    );
    const titles = result
      .split('\n')
      .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
      .filter((line) => line.length > 0)
      .slice(0, 5);
    return { ok: true, titles };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error.' };
  }
}

/** Suggests SEO keywords/tags for the current draft. */
export async function suggestKeywords(
  title: string,
  content: string,
): Promise<{ ok: true; keywords: string[] } | { ok: false; error: string }> {
  if (!content.trim() && !title.trim()) {
    return { ok: false, error: 'Write a title or some content first, then ask for keyword suggestions.' };
  }
  try {
    const result = await callTextProvider(
      `Suggest 8-12 SEO keywords/key phrases for this blog post — a realistic mix of short and long-tail phrases a reader ` +
        `might actually search for. Return ONLY the keywords, one per line, no numbering, no quotes:\n\n` +
        `Title: ${title}\n\nContent: ${content.slice(0, 4000)}`,
    );
    const keywords = result
      .split('\n')
      .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
      .filter((line) => line.length > 0)
      .slice(0, 12);
    return { ok: true, keywords };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error.' };
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Image generation — dispatches on the configured provider
 * ──────────────────────────────────────────────────────────────────────────*/

async function callGeminiImage(
  config: AiProviderConfig,
  prompt: string,
  reference?: { mimeType: string; data: string },
): Promise<{ mimeType: string; data: string }> {
  if (!config.api_key) throw new Error('Gemini is selected for image, but no API key is configured.');
  const model = config.model || 'gemini-3.1-flash-image';
  // Reference image support confirmed working via a live test call
  // 2026-08-11: passing an inlineData part alongside the text prompt lets the
  // model use it for visual/character consistency across generations (e.g.
  // "same character, new pose"). Text part first, image part second — matches
  // the order used in that successful test.
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
    { text: prompt },
  ];
  if (reference) parts.push({ inlineData: reference });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.api_key}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Gemini image request failed (${response.status}): ${body.slice(0, 300)}`);
  }
  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
    }>;
  };
  const inline = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!inline?.data) {
    throw new Error('Gemini did not return image data — the prompt may have been blocked by a safety filter.');
  }
  return { mimeType: inline.mimeType || 'image/jpeg', data: inline.data };
}

async function callWebhookImage(
  config: AiProviderConfig,
  prompt: string,
): Promise<{ mimeType: string; data: string }> {
  if (!config.webhook_url) throw new Error('Custom webhook is selected for image, but no URL is configured.');
  const response = await fetch(config.webhook_url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.api_key ? { Authorization: `Bearer ${config.api_key}` } : {}),
    },
    body: JSON.stringify({ prompt }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Webhook request failed (${response.status}): ${body.slice(0, 300)}`);
  }
  const data = (await response.json()) as { mimeType?: string; data?: string };
  if (!data.data) throw new Error('Webhook response did not include a "data" (base64) field.');
  return { mimeType: data.mimeType || 'image/png', data: data.data };
}

/**
 * Fetches an already-hosted image (e.g. from our own post-images bucket, or
 * any public URL) and returns it base64-encoded, for use as a reference
 * image. Size-limited to the same 10MB the upload path enforces — a giant
 * reference image would otherwise bloat every generation request.
 */
async function fetchAsReference(url: string): Promise<{ mimeType: string; data: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch reference image (${response.status}).`);
  const mimeType = response.headers.get('content-type') || 'image/jpeg';
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > 10 * 1024 * 1024) throw new Error('Reference image is larger than 10MB.');
  return { mimeType, data: Buffer.from(buffer).toString('base64') };
}

/**
 * Generates an image from a text prompt — optionally using an existing image
 * (e.g. picked from the media library) as a reference for visual/character
 * consistency, confirmed working with Gemini via a live test 2026-08-11 —
 * and saves the result to the SAME public `post-images` Supabase Storage
 * bucket real uploads go to (`uploadBytesToStorage`, upload-actions.ts).
 */
export async function generateAndSaveImage(
  prompt: string,
  referenceImageUrl?: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!prompt.trim()) return { ok: false, error: 'Describe the image you want first.' };

  try {
    const config = await getProviderConfig('image');
    if (!config) return { ok: false, error: 'No image-generation provider is configured. Set one in AI settings.' };

    const style = await getWritingStyle();
    const fullPrompt = style.trim()
      ? `${prompt.trim()} (visual style/brand context, if relevant: ${style.trim()})`
      : prompt.trim();

    const reference = referenceImageUrl?.trim() ? await fetchAsReference(referenceImageUrl.trim()) : undefined;

    let inline: { mimeType: string; data: string };
    switch (config.provider) {
      case 'gemini':
        inline = await callGeminiImage(config, fullPrompt, reference);
        break;
      case 'custom_webhook':
        inline = await callWebhookImage(config, fullPrompt);
        break;
      case 'openrouter':
        return {
          ok: false,
          error: 'OpenRouter image generation is not yet implemented here — use Gemini or a custom webhook for images.',
        };
    }

    const ext = inline.mimeType.split('/')[1] || 'jpg';
    const bytes = Buffer.from(inline.data, 'base64');
    return await uploadBytesToStorage(new Uint8Array(bytes), inline.mimeType, ext);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Image generation failed.' };
  }
}
