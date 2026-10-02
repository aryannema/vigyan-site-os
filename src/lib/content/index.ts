/**
 * lib/content — block + inline-Markdown content format for this template.
 *
 * Start with FORMAT.md. In short:
 *   - Structure is typed JSON blocks (blocks.ts), never Markdown.
 *   - A block's prose fields may use a four-construct inline subset —
 *     **bold**, _italic_, `code`, [text](url) — and nothing else.
 *   - FormattedText.tsx is the single place that subset is parsed, and the
 *     security boundary for AI-authored content.
 *
 * This barrel is for convenience only; importing the modules directly is fine
 * and keeps `renderer`/`FormattedText` (which pull in React) out of the graph
 * for pure-data callers such as MCP tool handlers.
 */

export {
  ALLOWED_URL_PROTOCOLS,
  BLOCK_TYPES,
  DEFAULT_HEADING_LEVEL,
  HEADING_LEVELS,
  INLINE_FORMATTED_FIELDS,
  blockArraySchema,
  blockSchema,
  blocksToPlainText,
  codeBlockSchema,
  headingBlockSchema,
  headingLevelOf,
  imageBlockSchema,
  isBlock,
  isBlockArray,
  isBlockOfType,
  isSafeUrl,
  listBlockSchema,
  narrowBlocks,
  paragraphBlockSchema,
  parseBlocks,
  quoteBlockSchema,
  safeParseBlocks,
  stripInlineMarkdown,
  videoBlockSchema,
  markdownBlockSchema,
  markdownToPlainText,
  type Block,
  type BlockOfType,
  type BlockParseResult,
  type BlockType,
  type CodeBlock,
  type HeadingBlock,
  type HeadingLevel,
  type ImageBlock,
  type ListBlock,
  type ParagraphBlock,
  type QuoteBlock,
  type VideoBlock,
} from './blocks';

export {
  ALLOWED_INLINE_ELEMENTS,
  FormattedText,
  type FormattedTextProps,
} from './FormattedText';

export {
  BlockRenderer,
  BlockView,
  type BlockClassNames,
  type BlockComponent,
  type BlockComponents,
  type BlockRendererProps,
} from './renderer';

export {
  INLINE_FORMATTED_SECTION_FIELDS,
  SECTION_KINDS,
  SECTION_SCHEMAS,
  ctaContentSchema,
  defineSections,
  headingContentSchema,
  imageContentSchema,
  listContentSchema,
  parseSectionContent,
  readSectionContent,
  richTextContentSchema,
  styleContentSchema,
  styleToCSSProperties,
  textContentSchema,
  type CTAContent,
  type ContentOf,
  type HeadingContent,
  type ImageContent,
  type ListContent,
  type RichTextContent,
  type SectionContent,
  type SectionDefinition,
  type SectionKind,
  type SectionRegistry,
  type StyleContent,
  type TextContent,
} from './sections';

export {
  ATTRIBUTION_PREFIX,
  EXPECTED_TIPTAP_MARKS,
  EXPECTED_TIPTAP_NODES,
  blockToTiptapNode,
  blocksToTiptapDoc,
  escapeInline,
  parseInline,
  serializeInline,
  tiptapDocToBlocks,
  tiptapNodeToBlock,
  type TiptapDoc,
  type TiptapMark,
  type TiptapNode,
  type TiptapText,
} from './tiptap';
