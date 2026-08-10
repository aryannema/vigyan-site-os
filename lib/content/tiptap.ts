/**
 * lib/content/tiptap.ts — serialisation contract between this template's block
 * format and Tiptap's ProseMirror JSON.
 *
 * STATUS: a working sketch, not a shipped editor. The editor itself is future
 * work; what this file pins down is the part that has to be right *before* the
 * editor is built — the mapping — so a human typing in a WYSIWYG and a model
 * writing through an MCP tool produce the same canonical document. Without an
 * agreed mapping the two diverge, and every save from one silently degrades
 * what the other wrote.
 *
 * ── The mapping ─────────────────────────────────────────────────────────────
 *
 *   Block                     ProseMirror node
 *   ─────────────────────────────────────────────────────────────────────────
 *   paragraph                 paragraph
 *   heading{level}            heading{attrs.level}
 *   list{ordered}             bulletList | orderedList > listItem > paragraph
 *   quote                     blockquote > paragraph
 *   image                     image{attrs: src, alt, title}
 *   code{language}            codeBlock{attrs.language}
 *
 *   Inline subset             ProseMirror mark
 *   ─────────────────────────────────────────────────────────────────────────
 *   **bold**                  bold
 *   _italic_                  italic
 *   `code`                    code
 *   [text](url)               link{attrs.href}
 *
 * The mark set is exactly the inline subset — that is the contract. An editor
 * built on this must configure StarterKit with strike, and any other mark,
 * DISABLED; otherwise a user can produce formatting this format cannot store,
 * and it vanishes on save. `EXPECTED_TIPTAP_MARKS` below is the list to check.
 *
 * Extensions required beyond `@tiptap/starter-kit`: `@tiptap/extension-link`
 * (installed) and `@tiptap/extension-image` (not yet installed — an image node
 * is needed for ImageBlock to round-trip).
 *
 * ── What is deliberately lossy ──────────────────────────────────────────────
 *
 *   - `quote.attribution` has no ProseMirror equivalent in StarterKit. It is
 *     encoded as a trailing paragraph inside the blockquote beginning with
 *     "— " (ATTRIBUTION_PREFIX) and decoded back on the return trip. An author
 *     who types that prefix by hand gets it read back as an attribution.
 *   - `image.caption` rides in `attrs.title`, and `code.filename` in a custom
 *     `attrs.filename`. Both need the corresponding attribute declared on the
 *     node extension or ProseMirror will drop them.
 *   - A backtick inside `` `code` `` cannot be represented in the inline subset
 *     (there is no fenced-span escape), so it is dropped on serialisation.
 *   - Nested lists, tables and hard breaks have no block type. An editor must
 *     not offer them.
 *
 * ── On the inline tokenizer ─────────────────────────────────────────────────
 *
 * `parseInline` below hand-tokenises the four constructs rather than pulling in
 * a Markdown parser. It is NOT the canonical parse — `FormattedText.tsx` is,
 * and it uses the real CommonMark implementation. This one exists because the
 * editor path needs the subset only, and shipping a second full parser into the
 * bundle to re-derive four constructs is not a trade worth making. The
 * round-trip tests assert the two agree on the strings this format allows.
 *
 * Named exports only.
 */

import {
  headingLevelOf,
  type Block,
  type HeadingLevel,
  type ListBlock,
  isSafeUrl,
} from './blocks';

/* ────────────────────────────────────────────────────────────────────────────
 * ProseMirror JSON shapes (the subset this contract uses)
 * ──────────────────────────────────────────────────────────────────────────*/

export type TiptapMark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'code' }
  | { type: 'link'; attrs: { href: string } };

export type TiptapText = {
  type: 'text';
  text: string;
  marks?: TiptapMark[];
};

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Array<TiptapNode | TiptapText>;
  text?: string;
  marks?: TiptapMark[];
}

export interface TiptapDoc {
  type: 'doc';
  content: TiptapNode[];
}

/** The complete mark set an editor on this format may enable. */
export const EXPECTED_TIPTAP_MARKS = ['bold', 'italic', 'code', 'link'] as const;

/** The complete node set. Anything else must be disabled in StarterKit. */
export const EXPECTED_TIPTAP_NODES = [
  'doc',
  'text',
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'image',
] as const;

/** Marker used to smuggle `quote.attribution` through a blockquote. */
export const ATTRIBUTION_PREFIX = '— ';

/* ────────────────────────────────────────────────────────────────────────────
 * Inline: restricted Markdown  ->  marked text nodes
 * ──────────────────────────────────────────────────────────────────────────*/

const sameMarks = (a: TiptapMark[] | undefined, b: TiptapMark[] | undefined) =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** Merge neighbouring runs carrying identical marks — ProseMirror normalises
 *  this anyway, and it keeps round-trip comparisons stable. */
const mergeRuns = (runs: TiptapText[]): TiptapText[] =>
  runs.reduce<TiptapText[]>((acc, run) => {
    if (run.text === '') return acc;
    const previous = acc[acc.length - 1];
    if (previous && sameMarks(previous.marks, run.marks)) {
      previous.text += run.text;
      return acc;
    }
    acc.push({ ...run });
    return acc;
  }, []);

const withMark = (marks: TiptapMark[], mark: TiptapMark): TiptapMark[] =>
  marks.some((m) => m.type === mark.type) ? marks : [...marks, mark];

const closingIndex = (src: string, token: string, from: number): number => {
  for (let i = from; i <= src.length - token.length; i += 1) {
    if (src[i] === '\\') {
      i += 1;
      continue;
    }
    if (src.startsWith(token, i)) return i;
  }
  return -1;
};

/**
 * Tokenise one inline-Markdown string into ProseMirror text nodes.
 *
 * Unmatched or malformed delimiters are emitted as literal characters, which is
 * the same "degrade to text" posture FormattedText takes.
 */
export const parseInline = (
  source: string,
  inherited: TiptapMark[] = [],
): TiptapText[] => {
  const out: TiptapText[] = [];
  let buffer = '';
  let i = 0;

  const flush = () => {
    if (buffer === '') return;
    out.push(
      inherited.length > 0
        ? { type: 'text', text: buffer, marks: [...inherited] }
        : { type: 'text', text: buffer },
    );
    buffer = '';
  };

  while (i < source.length) {
    const char = source[i] as string;

    // Backslash escape: the next character is literal.
    if (char === '\\' && i + 1 < source.length) {
      buffer += source[i + 1];
      i += 2;
      continue;
    }

    // `code` — opaque, no nested marks.
    if (char === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push({
          type: 'text',
          text: source.slice(i + 1, end),
          marks: withMark(inherited, { type: 'code' }),
        });
        i = end + 1;
        continue;
      }
    }

    // **bold**
    if (source.startsWith('**', i)) {
      const end = closingIndex(source, '**', i + 2);
      if (end > i + 1) {
        flush();
        out.push(
          ...parseInline(
            source.slice(i + 2, end),
            withMark(inherited, { type: 'bold' }),
          ),
        );
        i = end + 2;
        continue;
      }
    }

    // _italic_ / *italic*
    if (char === '_' || char === '*') {
      const end = closingIndex(source, char, i + 1);
      if (end > i + 1) {
        flush();
        out.push(
          ...parseInline(
            source.slice(i + 1, end),
            withMark(inherited, { type: 'italic' }),
          ),
        );
        i = end + 1;
        continue;
      }
    }

    // [label](url)
    if (char === '[') {
      const labelEnd = closingIndex(source, ']', i + 1);
      if (labelEnd > i && source[labelEnd + 1] === '(') {
        const urlEnd = source.indexOf(')', labelEnd + 2);
        if (urlEnd > labelEnd) {
          const href = source.slice(labelEnd + 2, urlEnd);
          // Same predicate as the renderer: an unsafe href yields plain text,
          // not a link, so the editor cannot round-trip one back into content.
          if (isSafeUrl(href)) {
            flush();
            out.push(
              ...parseInline(
                source.slice(i + 1, labelEnd),
                withMark(inherited, { type: 'link', attrs: { href } }),
              ),
            );
            i = urlEnd + 1;
            continue;
          }
        }
      }
    }

    buffer += char;
    i += 1;
  }

  flush();
  return mergeRuns(out);
};

/* ────────────────────────────────────────────────────────────────────────────
 * Inline: marked text nodes  ->  restricted Markdown
 * ──────────────────────────────────────────────────────────────────────────*/

/** Escape the five characters that would otherwise be read back as syntax. */
export const escapeInline = (text: string): string =>
  text.replace(/([\\`*_[\]])/g, '\\$1');

/**
 * Nesting order, outermost first.
 *
 * ProseMirror stores marks per text run, so a bold span interrupted by a link
 * arrives as three runs each carrying `bold`. Emitting each run's marks
 * independently produces `**a **[**link**](/x)** b**` — broken nesting that
 * re-parses into a different tree. The serialiser below instead finds the
 * longest run of neighbours sharing a mark and wraps that group once, which is
 * what makes the round trip stable. (Caught by the round-trip render test.)
 */
const MARK_ORDER: ReadonlyArray<TiptapMark['type']> = [
  'link',
  'bold',
  'italic',
  'code',
];

/** Identity of a mark for grouping: two links group only if the href matches. */
const markKey = (mark: TiptapMark): string =>
  mark.type === 'link' ? `link:${mark.attrs.href}` : mark.type;

const wrapMark = (mark: TiptapMark, inner: string): string => {
  switch (mark.type) {
    case 'bold':
      return `**${inner}**`;
    case 'italic':
      return `_${inner}_`;
    case 'code':
      return `\`${inner}\``;
    case 'link':
      // An href the renderer would reject must not be written back out.
      return isSafeUrl(mark.attrs.href)
        ? `[${inner}](${mark.attrs.href})`
        : inner;
  }
};

const serializeRuns = (
  runs: readonly TiptapText[],
  applied: readonly string[],
): string => {
  const first = runs[0];
  if (first === undefined) return '';

  const marks = first.marks ?? [];
  const candidate = MARK_ORDER.map((type) =>
    marks.find((mark) => mark.type === type),
  ).find((mark) => mark !== undefined && !applied.includes(markKey(mark)));

  if (candidate === undefined) {
    // No unapplied marks left on this run: emit its text.
    // Inside a code span the text is literal, and a backtick within it is
    // unrepresentable in the subset, so it is dropped.
    const text = applied.includes('code')
      ? first.text.replace(/`/g, '')
      : escapeInline(first.text);
    return text + serializeRuns(runs.slice(1), applied);
  }

  const key = markKey(candidate);
  let span = 1;
  while (
    span < runs.length &&
    (runs[span]?.marks ?? []).some((mark) => markKey(mark) === key)
  ) {
    span += 1;
  }

  const inner = serializeRuns(runs.slice(0, span), [...applied, key]);
  return wrapMark(candidate, inner) + serializeRuns(runs.slice(span), applied);
};

/** Serialise ProseMirror text nodes back to one inline-Markdown string. */
export const serializeInline = (
  nodes: Array<TiptapNode | TiptapText> | undefined,
): string =>
  serializeRuns(
    (nodes ?? []).filter(
      (node): node is TiptapText =>
        node.type === 'text' && typeof node.text === 'string',
    ),
    [],
  );

/* ────────────────────────────────────────────────────────────────────────────
 * Blocks  ->  ProseMirror doc
 * ──────────────────────────────────────────────────────────────────────────*/

const paragraphNode = (text: string): TiptapNode => {
  const content = parseInline(text);
  // ProseMirror represents an empty paragraph as a node with no `content` key.
  return content.length > 0
    ? { type: 'paragraph', content }
    : { type: 'paragraph' };
};

const listNode = (block: ListBlock): TiptapNode => ({
  type: block.ordered ? 'orderedList' : 'bulletList',
  content: block.items.map((item) => ({
    type: 'listItem',
    content: [paragraphNode(item)],
  })),
});

/** Convert one block to its ProseMirror node. */
export const blockToTiptapNode = (block: Block): TiptapNode => {
  switch (block.type) {
    case 'paragraph':
      return paragraphNode(block.text);
    case 'heading':
      return {
        type: 'heading',
        attrs: { level: headingLevelOf(block) },
        content: parseInline(block.text),
      };
    case 'list':
      return listNode(block);
    case 'quote':
      return {
        type: 'blockquote',
        content: [
          paragraphNode(block.text),
          ...(block.attribution
            ? [paragraphNode(`${ATTRIBUTION_PREFIX}${block.attribution}`)]
            : []),
        ],
      };
    case 'image':
      return {
        type: 'image',
        attrs: {
          src: block.url,
          alt: block.alt,
          ...(block.caption === undefined ? {} : { title: block.caption }),
        },
      };
    case 'code':
      return {
        type: 'codeBlock',
        attrs: {
          language: block.language ?? null,
          ...(block.filename === undefined ? {} : { filename: block.filename }),
        },
        // A codeBlock holds a single unmarked text node; markdown is not parsed.
        ...(block.text === ''
          ? {}
          : { content: [{ type: 'text', text: block.text } as TiptapText] }),
      };
  }
};

/** Convert a block document into a Tiptap/ProseMirror `doc`. */
export const blocksToTiptapDoc = (blocks: readonly Block[]): TiptapDoc => ({
  type: 'doc',
  content: blocks.map(blockToTiptapNode),
});

/* ────────────────────────────────────────────────────────────────────────────
 * ProseMirror doc  ->  Blocks
 * ──────────────────────────────────────────────────────────────────────────*/

const textOf = (node: TiptapNode): string =>
  (node.content ?? [])
    .map((child) =>
      child.type === 'text' ? (child.text ?? '') : textOf(child as TiptapNode),
    )
    .join('');

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const listItemsOf = (node: TiptapNode): string[] =>
  (node.content ?? [])
    .filter((child): child is TiptapNode => child.type === 'listItem')
    .map((item) =>
      (item.content ?? [])
        .map((child) => serializeInline((child as TiptapNode).content))
        .join(' ')
        .trim(),
    )
    .filter((text) => text !== '');

/**
 * Convert one ProseMirror node back to a block, or `null` if the node has no
 * representation in this format.
 *
 * Returning `null` rather than throwing is deliberate: if an editor is
 * misconfigured and lets a user insert a table, the save should drop the table,
 * not reject the whole document and lose everything they wrote.
 */
export const tiptapNodeToBlock = (node: TiptapNode): Block | null => {
  switch (node.type) {
    case 'paragraph': {
      const text = serializeInline(node.content);
      return text === '' ? null : { type: 'paragraph', text };
    }
    case 'heading': {
      const text = serializeInline(node.content);
      if (text === '') return null;
      const raw = Number(node.attrs?.['level'] ?? 2);
      const level = (raw >= 2 && raw <= 6 ? raw : 2) as HeadingLevel;
      return { type: 'heading', text, level };
    }
    case 'bulletList':
    case 'orderedList': {
      const items = listItemsOf(node);
      if (items.length === 0) return null;
      return node.type === 'orderedList'
        ? { type: 'list', items, ordered: true }
        : { type: 'list', items };
    }
    case 'blockquote': {
      const paragraphs = (node.content ?? []).filter(
        (child): child is TiptapNode => child.type === 'paragraph',
      );
      const texts = paragraphs.map((p) => serializeInline(p.content));
      const last = texts[texts.length - 1];
      const hasAttribution =
        texts.length > 1 && last !== undefined && last.startsWith(ATTRIBUTION_PREFIX);
      const body = (hasAttribution ? texts.slice(0, -1) : texts)
        .join(' ')
        .trim();
      if (body === '') return null;
      return hasAttribution && last !== undefined
        ? {
            type: 'quote',
            text: body,
            attribution: last.slice(ATTRIBUTION_PREFIX.length),
          }
        : { type: 'quote', text: body };
    }
    case 'image': {
      const url = asString(node.attrs?.['src']);
      if (url === undefined || !isSafeUrl(url)) return null;
      const caption = asString(node.attrs?.['title']);
      const alt = node.attrs?.['alt'];
      return {
        type: 'image',
        url,
        alt: typeof alt === 'string' ? alt : '',
        ...(caption === undefined ? {} : { caption }),
      };
    }
    case 'codeBlock': {
      const language = asString(node.attrs?.['language']);
      const filename = asString(node.attrs?.['filename']);
      return {
        type: 'code',
        text: textOf(node),
        ...(language === undefined ? {} : { language }),
        ...(filename === undefined ? {} : { filename }),
      };
    }
    default:
      return null;
  }
};

/** Convert a Tiptap/ProseMirror `doc` back into a block document. */
export const tiptapDocToBlocks = (doc: TiptapDoc | null | undefined): Block[] => {
  if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content)) return [];
  return doc.content
    .map(tiptapNodeToBlock)
    .filter((block): block is Block => block !== null);
};
