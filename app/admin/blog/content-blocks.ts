import type { ContentBlock } from '@/types/schema';

/**
 * `posts.content_blocks` is an open-ended `jsonb` array at the database-contract
 * level (`types/schema.ts` deliberately declines to dictate block shapes), but
 * this repo DOES ship a concrete reference schema for it — `lib/content/blocks.ts`
 * — and that is what every renderer (`lib/content/renderer.tsx`) actually
 * understands. Only `paragraph` / `heading` / `list` / `quote` / `image` / `code`
 * are recognized; anything else is silently filtered out by `narrowBlocks()`, not
 * rejected — a post saved with an unrecognized block type would save
 * successfully and then render as empty content, with no error anywhere. (This
 * file used to invent its own `{ type: 'markdown', text }` block instead of using
 * that schema — fixed 2026-08-11, see git history if you need the old shape.)
 *
 * The compromise: a plain body textarea covers the common case by storing one
 * `paragraph` block per blank-line-separated chunk of text — real blocks the
 * renderer understands, with `FormattedText`'s restricted inline-Markdown
 * (**bold**, _italic_, `code`, [text](url)) available inside each paragraph's
 * text, exactly as `lib/content/FORMAT.md` documents. Anything richer (headings,
 * lists, images, code blocks, or content that didn't originate as plain
 * paragraphs) falls back to editing the raw JSON — without that fallback,
 * opening a post whose blocks came from somewhere else (an import, the MCP
 * tools, a future WYSIWYG editor) and pressing Save would silently destroy them.
 */
export type BodyMode = 'markdown' | 'json';

export interface DecodedBody {
  mode: BodyMode;
  value: string;
}

function isPlainParagraphBlock(
  block: unknown,
): block is { type: 'paragraph'; text: string } {
  if (typeof block !== 'object' || block === null) return false;
  const keys = Object.keys(block as Record<string, unknown>);
  return (
    (block as { type?: unknown }).type === 'paragraph' &&
    typeof (block as { text?: unknown }).text === 'string' &&
    // Only bare {type, text} — a paragraph carrying extra fields this form
    // doesn't round-trip (were any ever added) must not be silently dropped.
    keys.every((k) => k === 'type' || k === 'text')
  );
}

/** Chooses the editing mode for an existing post's blocks. */
export function decodeContentBlocks(blocks: unknown): DecodedBody {
  if (!Array.isArray(blocks) || blocks.length === 0) return { mode: 'markdown', value: '' };

  if (blocks.every(isPlainParagraphBlock)) {
    return { mode: 'markdown', value: blocks.map((block) => block.text).join('\n\n') };
  }

  return { mode: 'json', value: JSON.stringify(blocks, null, 2) };
}

/** Inverse of {@link decodeContentBlocks}. Throws a readable message on bad JSON. */
export function encodeContentBlocks(mode: BodyMode, value: string): ContentBlock[] {
  if (mode === 'markdown') {
    // Blank-line-separated chunks -> one real `paragraph` block each, so the
    // renderer actually recognizes them. A lone `\n` stays inside one
    // paragraph's text (FormattedText renders it as a soft line break via
    // react-markdown's default paragraph handling), matching normal
    // Markdown-authoring expectations.
    return value
      .split(/\n{2,}/)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0)
      .map((text) => ({ type: 'paragraph', text }));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value || '[]');
  } catch (error) {
    throw new Error(`Content blocks must be valid JSON: ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('Content blocks must be a JSON array.');
  for (const [index, block] of parsed.entries()) {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) {
      throw new Error(`Content block ${index + 1} must be an object.`);
    }
    if (typeof (block as { type?: unknown }).type !== 'string') {
      throw new Error(`Content block ${index + 1} needs a string "type" field.`);
    }
  }
  return parsed as ContentBlock[];
}
