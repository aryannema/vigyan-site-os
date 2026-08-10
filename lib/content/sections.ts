/**
 * lib/content/sections.ts — the reference vocabulary for `site_content`.
 *
 * `posts.content_blocks` is always a block array (blocks.ts). `site_content`
 * is the other half of the problem: one row per addressable region of the site,
 * each holding a `content_data` jsonb document whose shape depends entirely on
 * what that region is. `types/schema.ts` therefore types it as plain
 * `JsonObject` and says the application layer should narrow it.
 *
 * This file is that narrowing, done as a small closed set of SECTION KINDS
 * rather than one interface per section. A deployment declares
 *
 *     export const SECTIONS = defineSections({
 *       'home.hero.heading': { kind: 'heading', description: 'Hero H1' },
 *       'home.hero.cta':     { kind: 'cta',     description: 'Hero button' },
 *       'about.body':        { kind: 'richText', description: 'About copy' },
 *     });
 *
 * and gets, from that one declaration: compile-time types, runtime validation,
 * an admin UI that knows which editor to render, and an MCP tool that can
 * describe every editable section to a model. The alternative — a bespoke
 * interface per section, as the section count grows past a hundred — makes the
 * admin UI a switch statement nobody maintains.
 *
 * The `richText` kind is `{ blocks: Block[] }`: literally the same block array,
 * the same `<BlockRenderer />`, the same inline-Markdown subset as the blog.
 * Keeping both content systems on one format is the entire point.
 *
 * Named exports only.
 */

import { z } from 'zod';
import type { CSSProperties } from 'react';

import type { ContentData } from '@/types/schema';

import { blockArraySchema, isSafeUrl, type Block } from './blocks';

/* ────────────────────────────────────────────────────────────────────────────
 * Section content shapes
 *
 * `text` fields carry the same restricted inline-Markdown subset as blocks and
 * should be rendered with <FormattedText />. Fields that land in an HTML
 * attribute (`alt`, `href`) never do.
 * ──────────────────────────────────────────────────────────────────────────*/

/** A single run of prose: a tagline, a description, a caption. */
export type TextContent = { text: string };

/** A heading, optionally with the small label above it and the line below it. */
export type HeadingContent = {
  text: string;
  eyebrow?: string;
  subtitle?: string;
};

/** A block document — same format as `posts.content_blocks`. */
export type RichTextContent = { blocks: Block[] };

/** A flat list of prose items: feature bullets, marquee entries. */
export type ListContent = { items: string[] };

/**
 * A call-to-action. `visible` exists so a deployment can retire a button from
 * the CMS without a deploy, and without the row disappearing (which would lose
 * the copy someone wrote).
 */
export type CTAContent = {
  label: string;
  href: string;
  visible?: boolean;
};

/** An image. `url`, not `src`, to match ImageBlock — one name for one thing. */
export type ImageContent = {
  url: string;
  alt: string;
  width?: number;
  height?: number;
};

/**
 * Per-region presentation overrides.
 *
 * Every field is constrained to a narrow token grammar (hex colours, a fixed
 * unit set, an enum) rather than accepting free CSS. Free CSS from a CMS row is
 * an injection surface — `1px; background-image: url(...)` — and a support
 * burden. If a deployment needs more than this, it needs a theme, not a
 * free-text field.
 */
export type StyleContent = {
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundOverlay?: string;
  textColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  paddingTop?: string;
  paddingBottom?: string;
};

/* ────────────────────────────────────────────────────────────────────────────
 * Constrained value grammars
 * ──────────────────────────────────────────────────────────────────────────*/

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGBA_RE =
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/;
/** A CSS length, and only a length — no semicolons, no functions, no vars. */
const CSS_LENGTH_RE = /^\d+(?:\.\d+)?(?:rem|em|px|%|vh|vw)$/;

const hexColor = z
  .string()
  .regex(HEX_COLOR_RE, { message: 'must be a hex colour such as #1a2b3c' });

const cssLength = z.string().regex(CSS_LENGTH_RE, {
  message: 'must be a plain CSS length such as 4rem, 64px or 50%',
});

const safeUrl = z
  .string()
  .refine(isSafeUrl, { message: 'must be a relative or http(s)/mailto/tel URL' });

/* ────────────────────────────────────────────────────────────────────────────
 * Schemas
 * ──────────────────────────────────────────────────────────────────────────*/

export const textContentSchema = z.strictObject({
  text: z.string().min(1),
});

export const headingContentSchema = z.strictObject({
  text: z.string().min(1),
  eyebrow: z.string().optional(),
  subtitle: z.string().optional(),
});

export const richTextContentSchema = z.strictObject({
  blocks: blockArraySchema,
});

export const listContentSchema = z.strictObject({
  items: z.array(z.string().min(1)),
});

export const ctaContentSchema = z.strictObject({
  label: z.string().min(1),
  href: safeUrl,
  visible: z.boolean().optional(),
});

export const imageContentSchema = z.strictObject({
  url: safeUrl,
  alt: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const styleContentSchema = z.strictObject({
  backgroundColor: hexColor.optional(),
  backgroundImage: safeUrl.optional(),
  backgroundOverlay: z
    .string()
    .refine((v) => HEX_COLOR_RE.test(v) || RGBA_RE.test(v), {
      message: 'must be a hex colour or an rgb()/rgba() value',
    })
    .optional(),
  textColor: hexColor.optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  paddingTop: cssLength.optional(),
  paddingBottom: cssLength.optional(),
});

/* ────────────────────────────────────────────────────────────────────────────
 * The kind registry
 * ──────────────────────────────────────────────────────────────────────────*/

export const SECTION_KINDS = [
  'text',
  'heading',
  'richText',
  'list',
  'cta',
  'image',
  'style',
] as const;

export type SectionKind = (typeof SECTION_KINDS)[number];

/** Maps a kind to the shape its `content_data` must have. */
export interface SectionContentByKind {
  text: TextContent;
  heading: HeadingContent;
  richText: RichTextContent;
  list: ListContent;
  cta: CTAContent;
  image: ImageContent;
  style: StyleContent;
}

export type SectionContent<K extends SectionKind = SectionKind> =
  SectionContentByKind[K];

export const SECTION_SCHEMAS = {
  text: textContentSchema,
  heading: headingContentSchema,
  richText: richTextContentSchema,
  list: listContentSchema,
  cta: ctaContentSchema,
  image: imageContentSchema,
  style: styleContentSchema,
} as const satisfies Record<SectionKind, z.ZodType>;

/**
 * Which fields of which kind carry inline Markdown — the section-side twin of
 * `INLINE_FORMATTED_FIELDS` in blocks.ts. `richText` is absent because its
 * formatting rules live in the blocks it contains.
 */
export const INLINE_FORMATTED_SECTION_FIELDS: Readonly<
  Record<SectionKind, readonly string[]>
> = {
  text: ['text'],
  heading: ['text', 'eyebrow', 'subtitle'],
  richText: [],
  list: ['items[]'],
  cta: [],
  image: [],
  style: [],
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * Declaring a deployment's sections
 * ──────────────────────────────────────────────────────────────────────────*/

export interface SectionDefinition<K extends SectionKind = SectionKind> {
  kind: K;
  /** Shown in the admin UI and handed to MCP tools as the field description. */
  description: string;
  /** Seeded when the row does not exist yet. Must match `kind`. */
  defaultValue?: SectionContentByKind[K];
}

export type SectionRegistry = Readonly<Record<string, SectionDefinition>>;

/**
 * Identity function with inference. It exists so a deployment's registry keeps
 * its literal key and kind types (`'home.hero.cta'` -> `CTAContent`) instead of
 * widening to `Record<string, SectionDefinition>`.
 */
export const defineSections = <
  T extends Readonly<Record<string, SectionDefinition>>,
>(
  definitions: T,
): T => definitions;

/** The content type of one section id in a registry. */
export type ContentOf<
  T extends SectionRegistry,
  Id extends keyof T,
> = T[Id] extends SectionDefinition<infer K> ? SectionContentByKind[K] : never;

export type SectionParseResult<T> =
  | { ok: true; content: T }
  | { ok: false; errors: string[] };

const formatIssues = (error: z.ZodError): string[] =>
  error.issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    return path === '' ? issue.message : `${path}: ${issue.message}`;
  });

/**
 * Validate one `site_content.content_data` document against its declared kind.
 *
 * Returns an error rather than throwing for an unregistered section id: rows
 * outlive the code that reads them, and a section retired in a refactor should
 * surface as a message in the admin UI, not a 500.
 */
export const parseSectionContent = <
  T extends SectionRegistry,
  Id extends keyof T & string,
>(
  registry: T,
  sectionId: Id,
  data: unknown,
): SectionParseResult<ContentOf<T, Id>> => {
  const definition = registry[sectionId];
  if (!definition) {
    return { ok: false, errors: [`unknown section id: ${sectionId}`] };
  }
  const result = SECTION_SCHEMAS[definition.kind].safeParse(data);
  return result.success
    ? { ok: true, content: result.data as ContentOf<T, Id> }
    : { ok: false, errors: formatIssues(result.error) };
};

/**
 * Read path: validated content, or the declared default, or `null`.
 *
 * A missing or malformed section should render the fallback copy, not blow up a
 * marketing page. Pair it with `parseSectionContent` on the write path, where
 * the error does need to reach the author.
 */
export const readSectionContent = <
  T extends SectionRegistry,
  Id extends keyof T & string,
>(
  registry: T,
  sectionId: Id,
  data: ContentData | null | undefined,
): ContentOf<T, Id> | null => {
  const result = parseSectionContent(registry, sectionId, data);
  if (result.ok) return result.content;
  const fallback = registry[sectionId]?.defaultValue;
  return (fallback as ContentOf<T, Id> | undefined) ?? null;
};

/* ────────────────────────────────────────────────────────────────────────────
 * Style application
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Turn a validated `StyleContent` into a React `style` object.
 *
 * Only ever call this with content that has been through `styleContentSchema` —
 * the schema is what makes the values safe to interpolate. This helper does not
 * re-validate, so passing raw jsonb straight in would defeat the point.
 */
export const styleToCSSProperties = (
  style: StyleContent | null | undefined,
): CSSProperties => {
  if (!style) return {};
  const css: CSSProperties = {};
  if (style.backgroundColor) css.backgroundColor = style.backgroundColor;
  if (style.backgroundImage) css.backgroundImage = `url("${style.backgroundImage}")`;
  if (style.textColor) css.color = style.textColor;
  if (style.textAlign) css.textAlign = style.textAlign;
  if (style.paddingTop) css.paddingTop = style.paddingTop;
  if (style.paddingBottom) css.paddingBottom = style.paddingBottom;
  return css;
};
