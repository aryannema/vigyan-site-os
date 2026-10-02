export const BLOG_CATEGORIES = ['ENGINEERING', 'DESIGN', 'PERFORMANCE', 'STRATEGY', 'AI'] as const;
export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

/**
 * The block vocabulary as seen at the MCP/webhook INPUT boundary.
 *
 * The canonical, validated render/edit contract now lives in
 * `src/lib/content/blocks.ts` (zod, discriminated union, strict). This
 * interface is deliberately kept loose and structural because it types data
 * arriving from outside — MCP tool calls, the Notion sync, the blog webhook —
 * before it has been validated. Extended 2026-08-11 with the fields the new
 * block schema supports (`ordered`, `attribution`, `caption`, `filename`) so an
 * AI agent writing through MCP can produce the same content a human can produce
 * in the rich editor.
 */
export interface ContentBlock {
  type: 'paragraph' | 'heading' | 'list' | 'quote' | 'image' | 'code';
  text?: string;
  /** Body headings are h2–h6; the post title owns the page's single h1. */
  level?: number;
  items?: string[];
  /** List blocks only: render as <ol> instead of <ul>. */
  ordered?: boolean;
  /** Quote blocks only: the citation line. */
  attribution?: string;
  url?: string;
  alt?: string;
  /** Image blocks only: formatted caption below the figure. */
  caption?: string;
  language?: string;
  /** Code blocks only: filename shown above the sample. */
  filename?: string;
}

export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  category: BlogCategory;
  seo_description: string;
  featured_image?: string;
  content_blocks: ContentBlock[];
  status: 'draft' | 'scheduled' | 'published';
  published_at?: string;
  created_at: string;
}

export const BLOG_POST_SCHEMA = {
  type: 'object',
  required: ['title', 'slug', 'category', 'seo_description', 'content_blocks'],
  properties: {
    title: { type: 'string', minLength: 5, maxLength: 200 },
    slug: { 
      type: 'string', 
      pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
      description: 'URL-safe slug (lowercase, hyphens only)'
    },
    category: { 
      type: 'string', 
      enum: BLOG_CATEGORIES 
    },
    seo_description: { type: 'string', minLength: 100, maxLength: 170 },
    featured_image: { type: 'string', format: 'uri', nullable: true },
    content_blocks: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['type'],
        properties: {
          type: { type: 'string', enum: ['paragraph', 'heading', 'list', 'quote', 'image', 'code'] },
          text: { type: 'string' },
          // Accepts 1 for backwards compatibility with existing callers, but
          // the renderer treats body h1 as invalid — normalizeLegacyBlocks()
          // (src/lib/content/legacy.ts) clamps it to 2 on read.
          level: { type: 'number', minimum: 1, maximum: 6 },
          items: { type: 'array', items: { type: 'string' } },
          ordered: { type: 'boolean' },
          attribution: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          alt: { type: 'string' },
          caption: { type: 'string' },
          language: { type: 'string' },
          filename: { type: 'string' }
        },
        additionalProperties: false
      }
    },
    status: { type: 'string', enum: ['draft', 'scheduled', 'published'], default: 'published' },
    published_at: { type: 'string', format: 'date-time', nullable: true }
  },
  additionalProperties: false
};
