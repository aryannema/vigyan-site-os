/**
 * src/lib/content/legacy.ts — site-os-specific adapter, NOT part of the
 * ported vigyan-site-os content library.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * `blocks.ts` (ported verbatim) is deliberately strict, and two of its rules
 * disagree with content this repo's OWN older writers already produce:
 *
 *   1. `heading.level` is constrained to 2–6, because the page/post title owns
 *      the single h1. But `src/app/api/sync/notion/route.ts` maps Notion's
 *      `heading_1` to `level: 1`, and `src/app/api/webhook/blog/route.ts` maps
 *      a Markdown `# Title` to `level: 1` the same way.
 *
 *   2. `image.alt` is REQUIRED (it may be `""` for a decorative image, but the
 *      key must be present). The Notion importer omits it entirely when the
 *      Notion block carries no caption.
 *
 * `narrowBlocks()` DROPS anything that fails validation rather than failing the
 * whole render — correct behaviour, but it means an imported post would quietly
 * lose its top heading and its images. Normalising is the honest fix: the block
 * is repaired to the canonical shape instead of being discarded.
 *
 * The two writers above have been fixed to emit canonical blocks going forward;
 * this handles rows that were already written, and any future importer that
 * gets it wrong. It is a READ-path helper only — never use it to launder
 * untrusted input on a write path, which is what `parseBlocks()` is for.
 *
 * Deliberately NOT a fork of `blocks.ts`: keeping the ported file byte-identical
 * to its upstream means the next sync from vigyan-site-os stays a clean copy.
 */

import type { ContentBlock } from '@/types/schema';

/** h1 in body copy becomes h2; anything out of range is clamped into 2–6. */
function clampHeadingLevel(value: unknown): number {
  const level = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(level)) return 2;
  if (level < 2) return 2;
  if (level > 6) return 6;
  return Math.trunc(level);
}

/**
 * Repair one legacy block into a shape `blockSchema` accepts, where the repair
 * is unambiguous. Blocks that are already canonical are returned untouched;
 * blocks that are broken in ways with no single correct fix are returned as-is
 * and will be dropped downstream, which is the right outcome.
 */
function normalizeBlock(block: ContentBlock): ContentBlock {
  switch (block.type) {
    case 'heading':
      return { ...block, level: clampHeadingLevel(block.level) };

    case 'image':
      // `alt: undefined` and a missing `alt` are the same thing to the strict
      // schema (both fail); `""` is the correct markup for a decorative image.
      return typeof block.alt === 'string' ? block : { ...block, alt: '' };

    case 'code':
      // `language: undefined` is fine, but a null from jsonb is not a string.
      return block.language === null ? { ...block, language: undefined } : block;

    default:
      return block;
  }
}

/**
 * Normalise a whole `posts.content_blocks` document read out of the database.
 *
 * Pass the result straight to `<BlockRenderer />` or `safeParseBlocks()`.
 * Non-arrays (a NULL column, a jsonb object) return `[]` rather than throwing.
 */
export function normalizeLegacyBlocks(value: unknown): ContentBlock[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (block): block is ContentBlock =>
        typeof block === 'object' && block !== null && !Array.isArray(block),
    )
    .map(normalizeBlock);
}
