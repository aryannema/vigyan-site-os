import type { ContentBlock } from '@/types/schema';

/**
 * `posts.content_blocks` is an open-ended `jsonb` array — the type contract
 * deliberately declines to dictate block shapes, so this template cannot ship a
 * block editor without inventing a schema it has no right to invent.
 *
 * The compromise: a plain body textarea covers the common case by storing a
 * single `{ type: 'markdown', text }` block, and anything richer falls back to
 * editing the raw JSON. The fallback is not a nicety — without it, opening a post
 * whose blocks came from somewhere else (an import, the MCP tools, a future
 * editor) and pressing Save would silently destroy them.
 */
export type BodyMode = 'markdown' | 'json';

export interface DecodedBody {
  mode: BodyMode;
  value: string;
}

function isMarkdownBlock(block: unknown): block is { type: 'markdown'; text: string } {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'markdown' &&
    typeof (block as { text?: unknown }).text === 'string'
  );
}

/** Chooses the editing mode for an existing post's blocks. */
export function decodeContentBlocks(blocks: unknown): DecodedBody {
  if (!Array.isArray(blocks) || blocks.length === 0) return { mode: 'markdown', value: '' };

  if (blocks.every(isMarkdownBlock)) {
    return { mode: 'markdown', value: blocks.map((block) => block.text).join('\n\n') };
  }

  return { mode: 'json', value: JSON.stringify(blocks, null, 2) };
}

/** Inverse of {@link decodeContentBlocks}. Throws a readable message on bad JSON. */
export function encodeContentBlocks(mode: BodyMode, value: string): ContentBlock[] {
  if (mode === 'markdown') {
    const text = value.trim();
    return text ? [{ type: 'markdown', text }] : [];
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
