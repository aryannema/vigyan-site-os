/**
 * lib/content/blocks.ts — the concrete block vocabulary this template ships with.
 *
 * `types/schema.ts` deliberately types `posts.content_blocks` as the loose
 * `ContentBlock { type: string; [key: string]: Json | undefined }`, and says
 * "deployments should declare their own per-section interfaces and narrow this
 * on read". THIS FILE IS THAT NARROWING — the reference implementation. It
 * imports the base type and never modifies it, so a deployment that wants a
 * different block set can replace this module without touching the database
 * contract.
 *
 * Two layers, deliberately separated:
 *
 *   1. BLOCK STRUCTURE lives in typed JSON. `type` is the discriminant; every
 *      renderer switches on it. Structure is never expressed in Markdown — no
 *      block-level Markdown is parsed anywhere in this template.
 *
 *   2. INLINE FORMATTING lives inside a block's text fields, as a RESTRICTED
 *      Markdown subset: **bold**, _italic_, `code`, [text](url). Nothing else.
 *      See `FormattedText.tsx` — it is the only place that subset is parsed,
 *      and `FORMAT.md` for the full rules and rationale.
 *
 * Why that split: AI/LLM writers (via MCP tools) are fluent in Markdown and
 * fight any bespoke inline representation, while a WYSIWYG editor needs stable
 * block boundaries. Blocks-as-JSON + inline-Markdown-as-string gives both one
 * canonical format, and keeps rendering safe — no raw HTML, no MDX/JSX, so
 * untrusted generated content can never execute anything.
 *
 * Runtime validation (zod) is exported alongside the types because the
 * interesting callers — MCP tool calls, admin form posts, imported JSON — are
 * all untrusted. Never cast `content_blocks` to `Block[]`; run it through
 * `parseBlocks()` / `safeParseBlocks()`.
 *
 * Named exports only.
 */

import { z } from 'zod';
import type { ContentBlock } from '@/types/schema';
import { parseYouTubeId } from './video';

/* ────────────────────────────────────────────────────────────────────────────
 * Block types
 * ──────────────────────────────────────────────────────────────────────────*/

export const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'list',
  'quote',
  'image',
  'video',
  'markdown',
  'code',
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

/**
 * h1 is intentionally absent. The page/post title owns the single h1; a body
 * block that could emit another one is an accessibility and SEO regression that
 * no editor UI would surface. Body headings start at h2.
 */
export const HEADING_LEVELS = [2, 3, 4, 5, 6] as const;

export type HeadingLevel = (typeof HEADING_LEVELS)[number];

export const DEFAULT_HEADING_LEVEL: HeadingLevel = 2;

/**
 * These are `type` aliases, not `interface`s, on purpose: TypeScript only gives
 * *type aliases* an implicit index signature, so only they stay assignable to
 * the base `ContentBlock` (which has `[key: string]: Json | undefined`). Change
 * one to an interface and the `AssignableToContentBlock` check below fails.
 */

/** Body copy. `text` may contain the inline-Markdown subset. */
export type ParagraphBlock = {
  type: 'paragraph';
  text: string;
};

/** A section heading. `level` defaults to 2; see HEADING_LEVELS. */
export type HeadingBlock = {
  type: 'heading';
  text: string;
  level?: HeadingLevel;
};

/** Bulleted (default) or numbered list. Each item may contain inline Markdown. */
export type ListBlock = {
  type: 'list';
  items: string[];
  ordered?: boolean;
};

/** A pull quote. `attribution` renders as the citation line. */
export type QuoteBlock = {
  type: 'quote';
  text: string;
  attribution?: string;
};

/**
 * An image. `alt` is required — it is a plain-text attribute and is NOT parsed
 * as Markdown (alt text lands in an HTML attribute, where markup is meaningless
 * and `"`-escaping is the only thing that matters). `caption` IS formatted.
 */
export type ImageBlock = {
  type: 'image';
  url: string;
  alt: string;
  caption?: string;
};

/**
 * A YouTube video (unlisted works). `url` is any YouTube link; the renderer
 * embeds it from the extracted id via youtube-nocookie.com. `title` is required
 * — it is the iframe's accessible name and the VideoObject name for search.
 */
export type VideoBlock = {
  type: 'video';
  url: string;
  title: string;
  caption?: string;
};

/**
 * A passage of full Markdown, stored verbatim (lossless): GFM tables, task
 * lists, footnotes, LaTeX math ($…$ / $$…$$), ```mermaid fences, images and
 * YouTube links. Rendered by MarkdownBlock.tsx with no raw HTML and no MDX.
 * Use it when the structured blocks above cannot express the content.
 */
export type MarkdownBlockT = {
  type: 'markdown';
  text: string;
};

/**
 * A code sample. `text` is rendered VERBATIM — it is deliberately the one field
 * that is never Markdown-parsed, because code samples are full of backticks,
 * underscores and asterisks that must survive untouched.
 */
export type CodeBlock = {
  type: 'code';
  text: string;
  language?: string;
  filename?: string;
};

/** The discriminated union every renderer switches on. */
export type Block =
  | ParagraphBlock
  | HeadingBlock
  | ListBlock
  | QuoteBlock
  | ImageBlock
  | VideoBlock
  | MarkdownBlockT
  | CodeBlock;

/** Narrow a `Block` by its `type`, e.g. `BlockOfType<'image'>`. */
export type BlockOfType<T extends BlockType> = Extract<Block, { type: T }>;

/**
 * Compile-time proof that every member of the union still satisfies the base
 * `ContentBlock` from types/schema.ts. If someone adds a block with a field
 * that is not JSON-serialisable (a Date, a function, undefined-only), this
 * line stops the build rather than the database rejecting the row at runtime.
 */
type AssignableToContentBlock = Block extends ContentBlock ? true : never;
const _blocksAreContentBlocks: AssignableToContentBlock = true;
void _blocksAreContentBlocks;

/**
 * Which fields of which block carry the inline-Markdown subset.
 *
 * This is the machine-readable form of the rule stated in FORMAT.md. Editors,
 * MCP tool descriptions and migration scripts should read it rather than
 * re-deriving the list — `code.text` being absent here is load-bearing.
 * `[]` suffix means "every element of that array".
 */
export const INLINE_FORMATTED_FIELDS: Readonly<
  Record<BlockType, readonly string[]>
> = {
  paragraph: ['text'],
  heading: ['text'],
  list: ['items[]'],
  quote: ['text', 'attribution'],
  image: ['caption'],
  video: ['caption'],
  markdown: [],
  code: [],
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * URL safety
 *
 * Used both by the block validator (image.url) and by FormattedText's
 * urlTransform (link hrefs). Keeping it here means the editor can reject a bad
 * URL at write time with the same rule the renderer applies at read time.
 * ──────────────────────────────────────────────────────────────────────────*/

/** Schemes a link or image may use. Everything else is rejected. */
export const ALLOWED_URL_PROTOCOLS = [
  'http:',
  'https:',
  'mailto:',
  'tel:',
] as const;

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/;
/** Control chars are how `java\0script:` / `java\nscript:` evasions are built. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/;

/**
 * True when `raw` is a URL this template is willing to emit into an href/src.
 *
 * Accepts: the schemes in ALLOWED_URL_PROTOCOLS, site-relative paths (`/x`),
 * document-relative paths (`x`, `./x`, `../x`), fragments (`#x`) and queries.
 * Rejects: `javascript:`, `data:`, `vbscript:`, `file:`, any other scheme,
 * protocol-relative `//host` (a scheme-laundering foot-gun), anything with a
 * control character in it, and the empty string.
 */
export const isSafeUrl = (raw: unknown): raw is string => {
  if (typeof raw !== 'string') return false;
  const value = raw.trim();
  if (value === '') return false;
  if (CONTROL_CHARS_RE.test(value)) return false;
  // `//evil.example` inherits the page's scheme; require an explicit one.
  if (value.startsWith('//')) return false;
  if (value.startsWith('/') || value.startsWith('#') || value.startsWith('?')) {
    return true;
  }
  const match = SCHEME_RE.exec(value);
  const scheme = match?.[1];
  // No scheme at all -> a relative path, which cannot execute.
  if (scheme === undefined) return true;
  return (ALLOWED_URL_PROTOCOLS as readonly string[]).includes(
    `${scheme.toLowerCase()}:`,
  );
};

/* ────────────────────────────────────────────────────────────────────────────
 * Runtime validation
 *
 * `strictObject` everywhere: unknown keys are an error, not a silent pass. A
 * block carrying a field no renderer reads is content that will look wrong to
 * whoever wrote it, and it is the usual shape of a typo'd MCP tool call
 * (`{"type":"image","src":"..."}` — `src` is not this schema's field name).
 * ──────────────────────────────────────────────────────────────────────────*/

const nonEmpty = (label: string) =>
  z.string().min(1, { message: `${label} must not be empty` });

const safeUrl = z
  .string()
  .refine(isSafeUrl, {
    message: `url must be relative or use one of: ${ALLOWED_URL_PROTOCOLS.join(', ')}`,
  });

export const paragraphBlockSchema = z.strictObject({
  type: z.literal('paragraph'),
  text: nonEmpty('text'),
});

export const headingBlockSchema = z.strictObject({
  type: z.literal('heading'),
  text: nonEmpty('text'),
  level: z
    .union([
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ])
    .optional(),
});

export const listBlockSchema = z.strictObject({
  type: z.literal('list'),
  items: z.array(nonEmpty('item')).min(1, { message: 'items must not be empty' }),
  ordered: z.boolean().optional(),
});

export const quoteBlockSchema = z.strictObject({
  type: z.literal('quote'),
  text: nonEmpty('text'),
  attribution: z.string().optional(),
});

export const imageBlockSchema = z.strictObject({
  type: z.literal('image'),
  url: safeUrl,
  // Required, and allowed to be "" — an empty alt is the correct markup for a
  // purely decorative image, whereas a missing alt is always a bug.
  alt: z.string(),
  caption: z.string().optional(),
});

export const videoBlockSchema = z.strictObject({
  type: z.literal('video'),
  url: z.string().refine((u) => parseYouTubeId(u) !== null, {
    message: 'url must be a YouTube link (youtube.com/watch?v=…, youtu.be/…, or /embed/…)',
  }),
  title: nonEmpty('title'),
  caption: z.string().optional(),
});

export const markdownBlockSchema = z.strictObject({
  type: z.literal('markdown'),
  text: z.string().min(1, { message: 'text must not be empty' }).max(200_000, { message: 'markdown is too long (200,000 characters max)' }),
});

export const codeBlockSchema = z.strictObject({
  type: z.literal('code'),
  text: z.string(),
  language: z.string().optional(),
  filename: z.string().optional(),
});

/** One block, discriminated on `type`. */
export const blockSchema = z.discriminatedUnion('type', [
  paragraphBlockSchema,
  headingBlockSchema,
  listBlockSchema,
  quoteBlockSchema,
  imageBlockSchema,
  videoBlockSchema,
  markdownBlockSchema,
  codeBlockSchema,
]);

/** A whole `posts.content_blocks` document. */
export const blockArraySchema = z.array(blockSchema);

/* ────────────────────────────────────────────────────────────────────────────
 * Type guards and parsers
 * ──────────────────────────────────────────────────────────────────────────*/

/** True when `value` is a valid block of any type. */
export const isBlock = (value: unknown): value is Block =>
  blockSchema.safeParse(value).success;

/** True when `value` is specifically a block of type `type`. */
export const isBlockOfType = <T extends BlockType>(
  value: unknown,
  type: T,
): value is BlockOfType<T> =>
  isBlock(value) && value.type === type;

/** True when `value` is a valid array of blocks. */
export const isBlockArray = (value: unknown): value is Block[] =>
  blockArraySchema.safeParse(value).success;

/** A human-readable `blocks[2].items[0]: message` line per problem. */
const formatIssues = (error: z.ZodError): string[] =>
  error.issues.map((issue) => {
    const path = issue.path.reduce<string>((acc, segment) => {
      if (typeof segment === 'number') return `${acc}[${segment}]`;
      return acc === '' ? String(segment) : `${acc}.${String(segment)}`;
    }, '');
    return path === '' ? issue.message : `${path}: ${issue.message}`;
  });

export type BlockParseResult =
  | { ok: true; blocks: Block[] }
  | { ok: false; errors: string[] };

/**
 * Validate untrusted JSON as a block array without throwing.
 *
 * This is the entry point for MCP tool arguments, admin form submissions and
 * anything else that arrives from outside the database.
 */
export const safeParseBlocks = (value: unknown): BlockParseResult => {
  const result = blockArraySchema.safeParse(value);
  return result.success
    ? { ok: true, blocks: result.data }
    : { ok: false, errors: formatIssues(result.error) };
};

/**
 * Validate untrusted JSON as a block array, throwing on failure.
 *
 * Use in write paths that should abort (an MCP `create_post` handler); use
 * `safeParseBlocks` where you need to report every problem back to a human.
 */
export const parseBlocks = (value: unknown): Block[] => {
  const result = safeParseBlocks(value);
  if (!result.ok) {
    throw new Error(`Invalid content_blocks:\n  ${result.errors.join('\n  ')}`);
  }
  return result.blocks;
};

/**
 * Read path: narrow a `Post['content_blocks']` to this deployment's union,
 * DROPPING anything that does not validate rather than failing the render.
 *
 * A published post whose fifth block has a typo should lose that block, not the
 * whole page. Rejected blocks are reported through `onInvalid` so a caller can
 * log them; the default logs to console in development and is silent in
 * production. Write paths want `parseBlocks`, not this.
 */
export const narrowBlocks = (
  value: readonly ContentBlock[] | null | undefined,
  onInvalid: (block: unknown, index: number, errors: string[]) => void = (
    block,
    index,
    errors,
  ) => {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[lib/content] dropped invalid block at index ${index}: ${errors.join('; ')}`,
        block,
      );
    }
  },
): Block[] => {
  if (!Array.isArray(value)) return [];
  const kept: Block[] = [];
  value.forEach((block, index) => {
    const result = blockSchema.safeParse(block);
    if (result.success) kept.push(result.data);
    else onInvalid(block, index, formatIssues(result.error));
  });
  return kept;
};

/* ────────────────────────────────────────────────────────────────────────────
 * Small helpers renderers and editors both need
 * ──────────────────────────────────────────────────────────────────────────*/

/** The heading level a heading block actually renders at. */
export const headingLevelOf = (block: HeadingBlock): HeadingLevel =>
  block.level ?? DEFAULT_HEADING_LEVEL;

/**
 * Plain-text projection of a block array: inline Markdown stripped, blocks
 * joined by blank lines. For SEO descriptions, search indexes, excerpts and
 * OpenGraph text — anywhere the formatting must not leak through as literal
 * asterisks. Code blocks are excluded; their text is not prose.
 */
export const blocksToPlainText = (blocks: readonly Block[]): string =>
  blocks
    .flatMap((block): string[] => {
      switch (block.type) {
        case 'paragraph':
        case 'heading':
          return [stripInlineMarkdown(block.text)];
        case 'quote':
          return [
            stripInlineMarkdown(block.text),
            ...(block.attribution
              ? [stripInlineMarkdown(block.attribution)]
              : []),
          ];
        case 'list':
          return block.items.map(stripInlineMarkdown);
        case 'image':
          return block.caption ? [stripInlineMarkdown(block.caption)] : [];
        case 'video':
          return block.caption ? [stripInlineMarkdown(block.caption)] : [];
        case 'markdown':
          return [markdownToPlainText(block.text)];
        case 'code':
          return [];
      }
    })
    .filter((line) => line.length > 0)
    .join('\n\n');

/**
 * Remove the inline-Markdown subset's syntax, keeping the visible text.
 *
 * Deliberately a small set of regexes rather than a Markdown parse: the subset
 * is four constructs wide, and this runs on every list item of every post in a
 * search index build. It is a *projection for text contexts*, never a security
 * boundary — escaping for HTML is FormattedText's job.
 */
export const stripInlineMarkdown = (text: string): string =>
  text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [label](url) -> label
    .replace(/\*\*([^*]+)\*\*/g, '$1') // **bold**
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?![\w*])/g, '$1$2') // *italic*
    .replace(/(^|[^\w_])_([^_\n]+)_(?![\w_])/g, '$1$2') // _italic_
    .replace(/`([^`]*)`/g, '$1') // `code`
    .trim();


/** Prose-only projection of a Markdown passage (for SEO descriptions/search). */
export const markdownToPlainText = (md: string): string =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .split('\n')
    .map((l) => stripInlineMarkdown(l.replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/, '').replace(/^\|?[\s:|-]+\|?$/, '')))
    .filter((l) => l.length > 0)
    .join('\n\n');
