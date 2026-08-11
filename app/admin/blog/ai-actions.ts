'use server';

/**
 * AI writing assistance for the blog editor — the "post creator" AI, admin-only.
 *
 * Uses Gemini directly via REST (no SDK dependency — the API surface used here
 * is small enough that a fetch call is simpler than a package). Deliberately a
 * cloud provider, not the local Qwen/vLLM endpoint: this needs to work
 * reliably from the deployed Vercel site, which cannot reach a LAN-only local
 * model without a public tunnel (a real availability dependency, discussed and
 * intentionally not taken on for this feature — see SETUP.md).
 *
 * Every function here returns a plain string/array — never HTML, never raw
 * Tiptap/ProseMirror JSON. The caller is responsible for putting the result
 * into the editor through normal Tiptap commands, so nothing here can inject
 * unvalidated content into the document.
 *
 * ── Writing style ────────────────────────────────────────────────────────────
 * Default AI output reads as generic AI-generated text — a real, named
 * complaint, not a nicety. `getWritingStyle()`/`setWritingStyle()` persist a
 * short operator-written style description in `site_content` (section_id
 * `ai_writing_style` — the existing generic content store, not a new table),
 * and every prompt below prepends it as a hard instruction. Empty by default;
 * the operator writes it once from `/admin/blog/settings` (or wherever it
 * ends up mounted) and every future generation uses it.
 */

import { query, mutate } from '../lib/db';

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const WRITING_STYLE_SECTION_ID = 'ai_writing_style';

class AiConfigError extends Error {}

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

function styleInstruction(style: string): string {
  if (!style.trim()) return '';
  return (
    `Write in this specific voice, not a generic AI-assistant tone: ${style.trim()}\n` +
    `Do not write like a typical AI-generated post — avoid the "professional LinkedIn AI" cadence ` +
    `(no "In today's fast-paced world", no excessive em-dashes, no listy false-enthusiasm, no ` +
    `summarizing what you just said). Write like the specific person described above actually writes.\n\n`
  );
}

async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AiConfigError(
      'GEMINI_API_KEY is not configured. Add it to .env.local (local) or the Vercel project env vars (deployed).',
    );
  }

  const style = await getWritingStyle();

  const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: styleInstruction(style) + prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
    }),
  });

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

/** Rewrites/improves a piece of body text. Returns plain text — no markup added beyond what was already there. */
export async function improveText(text: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!text.trim()) return { ok: false, error: 'Nothing to improve — select or write some text first.' };
  try {
    const result = await callGemini(
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
    const result = await callGemini(
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
    const result = await callGemini(
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
