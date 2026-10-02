/**
 * lib/content/renderer.tsx — renders a `Block[]` (posts.content_blocks, or any
 * rich-text section of site_content.content_data).
 *
 * The important line in here is that every prose field goes through
 * `<FormattedText />` rather than being interpolated as a raw string. Raw
 * interpolation is safe, but it renders `**bold**` as four literal asterisks —
 * which means authors either get no emphasis at all, or someone eventually
 * reaches for `dangerouslySetInnerHTML` and turns AI-written content into an
 * XSS sink. FormattedText is the third option: a four-construct Markdown subset
 * with an element allow-list.
 *
 * The one deliberate exception is `code.text`, interpolated verbatim. A code
 * sample is not prose; its backticks, asterisks and underscores must survive.
 *
 * Robustness: this component never throws on bad data. Blocks that do not
 * validate are dropped (with a dev-mode warning) rather than failing the page,
 * because a typo in block 5 of a published post should cost block 5, not the
 * whole article.
 *
 * Styling: the defaults below use THIS repo's real design tokens (ink / body /
 * muted / faint / hairline / sand / well / saffron, declared in
 * `src/app/globals.css` and mapped in `tailwind.config.ts`) rather than the
 * template's brand-neutral ones — there must not be two parallel token systems
 * in this codebase. Every element still takes a class override through the
 * `classNames` prop, and `components` lets a caller replace a whole block
 * renderer without forking this file.
 *
 * No 'use client' — this renders on the server and ships no JavaScript, with
 * one isolated exception: a `code` block with `language: 'mermaid'` delegates
 * to MermaidDiagram.tsx, a client leaf that only loads on pages that actually
 * contain one. See that file's header for the sanitization/fallback contract.
 */

import * as React from 'react';

import type { ContentBlock } from '@/types/schema';

import {
  headingLevelOf,
  narrowBlocks,
  type Block,
  type BlockType,
  type CodeBlock,
  type HeadingBlock,
  type ImageBlock,
  type ListBlock,
  type ParagraphBlock,
  type QuoteBlock,
  type VideoBlock,
} from './blocks';
import { MarkdownBlock } from './MarkdownBlock';
import { parseYouTubeId, youtubeEmbedUrl } from './video';
import { FormattedText } from './FormattedText';
import { MermaidDiagram } from './MermaidDiagram';

/* ────────────────────────────────────────────────────────────────────────────
 * Customisation surface
 * ──────────────────────────────────────────────────────────────────────────*/

/** Per-element class overrides. Anything omitted keeps the default. */
export interface BlockClassNames {
  root?: string;
  paragraph?: string;
  heading?: string;
  list?: string;
  listItem?: string;
  quote?: string;
  quoteAttribution?: string;
  figure?: string;
  image?: string;
  caption?: string;
  video?: string;
  pre?: string;
  code?: string;
  codeFilename?: string;
}

const DEFAULT_CLASS_NAMES: Required<BlockClassNames> = {
  root: 'flex flex-col gap-6 text-body',
  paragraph: 'leading-relaxed',
  heading: 'font-bold tracking-[-0.02em] text-ink',
  list: 'flex flex-col gap-2 pl-6 marker:text-saffron-500',
  listItem: 'leading-relaxed',
  quote: 'border-l-2 border-saffron-500 pl-4 italic text-muted',
  quoteAttribution: 'mt-2 text-sm not-italic text-faint',
  figure: 'flex flex-col gap-2',
  image: 'w-full rounded-card border border-hairline',
  caption: 'text-center text-sm text-faint',
  video: 'aspect-video w-full overflow-hidden rounded-card border border-hairline bg-well',
  pre: 'overflow-x-auto rounded-card border border-hairline bg-well p-4',
  code: 'font-mono text-sm text-ink',
  codeFilename:
    'rounded-t-card border border-b-0 border-hairline bg-sand px-4 py-2 font-mono text-xs text-muted',
};

/** A replacement renderer for one block type. */
export type BlockComponent<T extends BlockType> = (props: {
  block: Extract<Block, { type: T }>;
  classNames: Required<BlockClassNames>;
}) => React.ReactNode;

/** Per-type renderer overrides, e.g. `{ image: MyNextImageBlock }`. */
export type BlockComponents = {
  [T in BlockType]?: BlockComponent<T>;
};

export interface BlockRendererProps {
  /**
   * Accepts the loose `ContentBlock[]` straight off a `Post` row as well as an
   * already-narrowed `Block[]`. Invalid entries are dropped, so callers do not
   * have to validate first — though write paths still should.
   */
  blocks: readonly (Block | ContentBlock)[] | null | undefined;
  classNames?: BlockClassNames;
  components?: BlockComponents;
  /** Rendered when there is nothing valid to show. Default: nothing. */
  fallback?: React.ReactNode;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Per-block renderers
 * ──────────────────────────────────────────────────────────────────────────*/

const Paragraph = ({
  block,
  classNames,
}: {
  block: ParagraphBlock;
  classNames: Required<BlockClassNames>;
}) => (
  <p className={classNames.paragraph}>
    <FormattedText text={block.text} />
  </p>
);

const Heading = ({
  block,
  classNames,
}: {
  block: HeadingBlock;
  classNames: Required<BlockClassNames>;
}) => {
  // h2–h6 only; h1 belongs to the page title. See HEADING_LEVELS in blocks.ts.
  const Tag = `h${headingLevelOf(block)}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  return (
    <Tag className={classNames.heading}>
      <FormattedText text={block.text} />
    </Tag>
  );
};

const List = ({
  block,
  classNames,
}: {
  block: ListBlock;
  classNames: Required<BlockClassNames>;
}) => {
  const Tag = block.ordered ? 'ol' : 'ul';
  return (
    <Tag
      className={`${block.ordered ? 'list-decimal' : 'list-disc'} ${classNames.list}`}
    >
      {block.items.map((item, index) => (
        <li key={index} className={classNames.listItem}>
          <FormattedText text={item} />
        </li>
      ))}
    </Tag>
  );
};

const Quote = ({
  block,
  classNames,
}: {
  block: QuoteBlock;
  classNames: Required<BlockClassNames>;
}) => (
  <blockquote className={classNames.quote}>
    <p>
      <FormattedText text={block.text} />
    </p>
    {block.attribution ? (
      <footer className={classNames.quoteAttribution}>
        {/* <cite> is the correct element for the *source*, and the em dash is
            presentational, so it stays outside it. */}
        <span aria-hidden="true">— </span>
        <cite>
          <FormattedText text={block.attribution} />
        </cite>
      </footer>
    ) : null}
  </blockquote>
);

const Image = ({
  block,
  classNames,
}: {
  block: ImageBlock;
  classNames: Required<BlockClassNames>;
}) => (
  <figure className={classNames.figure}>
    {/* Plain <img>: next/image needs per-deployment remotePatterns config, and
        this template does not know where a deployment hosts its media. Swap in
        next/image through the `components` prop once that config exists. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={block.url} alt={block.alt} className={classNames.image} />
    {block.caption ? (
      <figcaption className={classNames.caption}>
        <FormattedText text={block.caption} />
      </figcaption>
    ) : null}
  </figure>
);

const Video = ({
  block,
  classNames,
}: {
  block: VideoBlock;
  classNames: Required<BlockClassNames>;
}) => {
  const id = parseYouTubeId(block.url);
  if (!id) return null;
  return (
    <figure className={classNames.figure}>
      <div className={classNames.video}>
        <iframe
          src={youtubeEmbedUrl(id)}
          title={block.title}
          loading="lazy"
          allow="accelerometer; encrypted-media; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="h-full w-full"
        />
      </div>
      {block.caption ? (
        <figcaption className={classNames.caption}>
          <FormattedText text={block.caption} />
        </figcaption>
      ) : null}
    </figure>
  );
};

const Code = ({
  block,
  classNames,
}: {
  block: CodeBlock;
  classNames: Required<BlockClassNames>;
}) => {
  if (block.language === 'mermaid') {
    return <MermaidDiagram code={block.text} classNames={classNames.pre} />;
  }
  return (
    <div>
      {block.filename ? (
        <div className={classNames.codeFilename}>{block.filename}</div>
      ) : null}
      <pre className={block.filename ? `${classNames.pre} rounded-t-none` : classNames.pre}>
        {/* Verbatim on purpose — see the file header. React escapes this, so a
            code sample containing "<script>" displays as text, as it should. */}
        <code
          className={`${classNames.code} language-${block.language ?? 'text'}`}
        >
          {block.text}
        </code>
      </pre>
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
 * The renderer
 * ──────────────────────────────────────────────────────────────────────────*/

/** Renders a single validated block. Exported for one-off/embedded use. */
export function BlockView({
  block,
  classNames: overrides,
  components,
}: {
  block: Block;
  classNames?: BlockClassNames;
  components?: BlockComponents;
}): React.ReactNode {
  const classNames = { ...DEFAULT_CLASS_NAMES, ...overrides };

  switch (block.type) {
    case 'paragraph': {
      const Custom = components?.paragraph;
      return Custom ? (
        <Custom block={block} classNames={classNames} />
      ) : (
        <Paragraph block={block} classNames={classNames} />
      );
    }
    case 'heading': {
      const Custom = components?.heading;
      return Custom ? (
        <Custom block={block} classNames={classNames} />
      ) : (
        <Heading block={block} classNames={classNames} />
      );
    }
    case 'list': {
      const Custom = components?.list;
      return Custom ? (
        <Custom block={block} classNames={classNames} />
      ) : (
        <List block={block} classNames={classNames} />
      );
    }
    case 'quote': {
      const Custom = components?.quote;
      return Custom ? (
        <Custom block={block} classNames={classNames} />
      ) : (
        <Quote block={block} classNames={classNames} />
      );
    }
    case 'image': {
      const Custom = components?.image;
      return Custom ? (
        <Custom block={block} classNames={classNames} />
      ) : (
        <Image block={block} classNames={classNames} />
      );
    }
    case 'video': {
      const Custom = components?.video;
      return Custom ? (
        <Custom block={block} classNames={classNames} />
      ) : (
        <Video block={block} classNames={classNames} />
      );
    }
    case 'markdown': {
      const Custom = components?.markdown;
      return Custom ? (
        <Custom block={block} classNames={classNames} />
      ) : (
        <MarkdownBlock text={block.text} />
      );
    }
    case 'code': {
      const Custom = components?.code;
      return Custom ? (
        <Custom block={block} classNames={classNames} />
      ) : (
        <Code block={block} classNames={classNames} />
      );
    }
  }
}

/**
 * Render a whole block document.
 *
 * @example
 *   const post = await getPost(slug);
 *   return <BlockRenderer blocks={post.content_blocks} />;
 */
export function BlockRenderer({
  blocks,
  classNames: overrides,
  components,
  fallback = null,
}: BlockRendererProps): React.JSX.Element | null {
  const classNames = { ...DEFAULT_CLASS_NAMES, ...overrides };
  const valid = narrowBlocks(blocks as readonly ContentBlock[] | null | undefined);

  if (valid.length === 0) return <>{fallback}</>;

  return (
    <div className={classNames.root}>
      {valid.map((block, index) => (
        <BlockView
          key={index}
          block={block}
          classNames={overrides}
          components={components}
        />
      ))}
    </div>
  );
}
