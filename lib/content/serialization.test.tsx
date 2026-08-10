/**
 * lib/content/serialization.test.tsx — section validation and the Tiptap
 * round-trip contract.
 *
 * The interesting assertion is the last group: a string that goes
 * blocks -> ProseMirror -> blocks must RENDER identically, even when the two
 * strings differ (`*x*` normalises to `_x_`). String equality would be the
 * wrong test; visual equality is the actual contract between a WYSIWYG editor
 * and an MCP writer.
 *
 * Run:  pnpm vitest run lib/content
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Block } from './blocks';
import { FormattedText } from './FormattedText';
import {
  defineSections,
  parseSectionContent,
  readSectionContent,
  styleToCSSProperties,
} from './sections';
import {
  blocksToTiptapDoc,
  escapeInline,
  parseInline,
  serializeInline,
  tiptapDocToBlocks,
} from './tiptap';

/* ────────────────────────────────────────────────────────────────────────────
 * Sections
 * ──────────────────────────────────────────────────────────────────────────*/

const SECTIONS = defineSections({
  'home.hero.heading': { kind: 'heading', description: 'Hero headline' },
  'home.hero.cta': {
    kind: 'cta',
    description: 'Hero button',
    defaultValue: { label: 'Get started', href: '/start' },
  },
  'home.hero.style': { kind: 'style', description: 'Hero styling' },
  'about.body': { kind: 'richText', description: 'About page copy' },
});

describe('section content', () => {
  it('accepts content matching the declared kind', () => {
    const result = parseSectionContent(SECTIONS, 'home.hero.heading', {
      text: 'Build **fast**',
      eyebrow: 'Platform',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects content of the wrong kind for that section', () => {
    // A cta document filed under a heading section.
    const result = parseSectionContent(SECTIONS, 'home.hero.heading', {
      label: 'Go',
      href: '/x',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an unsafe cta href', () => {
    const result = parseSectionContent(SECTIONS, 'home.hero.cta', {
      label: 'Click',
      href: 'javascript:alert(1)',
    });
    expect(result.ok).toBe(false);
  });

  it('validates a richText section as a real block array', () => {
    expect(
      parseSectionContent(SECTIONS, 'about.body', {
        blocks: [{ type: 'paragraph', text: 'Hello **world**' }],
      }).ok,
    ).toBe(true);
    expect(
      parseSectionContent(SECTIONS, 'about.body', {
        blocks: [{ type: 'paragraph' }],
      }).ok,
    ).toBe(false);
  });

  it('reports an unknown section id instead of throwing', () => {
    const result = parseSectionContent(
      SECTIONS,
      'retired.section' as 'about.body',
      {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('unknown section id');
  });

  it('falls back to the declared default on malformed data', () => {
    expect(readSectionContent(SECTIONS, 'home.hero.cta', { junk: true })).toEqual(
      { label: 'Get started', href: '/start' },
    );
    expect(readSectionContent(SECTIONS, 'home.hero.heading', null)).toBeNull();
  });

  it('constrains style values to a token grammar', () => {
    const ok = parseSectionContent(SECTIONS, 'home.hero.style', {
      backgroundColor: '#101820',
      textAlign: 'center',
      paddingTop: '4rem',
    });
    expect(ok.ok).toBe(true);

    for (const bad of [
      { backgroundColor: 'red; background-image: url(//evil)' },
      { paddingTop: '4rem; position:fixed' },
      { backgroundImage: 'javascript:alert(1)' },
      { textAlign: 'justify' },
    ]) {
      expect(
        parseSectionContent(SECTIONS, 'home.hero.style', bad).ok,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it('maps style content to React CSS properties', () => {
    expect(
      styleToCSSProperties({ backgroundColor: '#fff', textAlign: 'center' }),
    ).toEqual({ backgroundColor: '#fff', textAlign: 'center' });
    expect(styleToCSSProperties(null)).toEqual({});
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Inline tokenizer
 * ──────────────────────────────────────────────────────────────────────────*/

describe('inline tokenizer', () => {
  it('produces marked text runs for the subset', () => {
    expect(parseInline('a **b** c')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' c' },
    ]);
    expect(parseInline('`x()`')).toEqual([
      { type: 'text', text: 'x()', marks: [{ type: 'code' }] },
    ]);
    expect(parseInline('[go](/x)')).toEqual([
      {
        type: 'text',
        text: 'go',
        marks: [{ type: 'link', attrs: { href: '/x' } }],
      },
    ]);
  });

  it('nests marks', () => {
    expect(parseInline('**bold _and italic_**')).toEqual([
      { type: 'text', text: 'bold ', marks: [{ type: 'bold' }] },
      {
        type: 'text',
        text: 'and italic',
        marks: [{ type: 'bold' }, { type: 'italic' }],
      },
    ]);
  });

  it('refuses to build a link from an unsafe href', () => {
    expect(parseInline('[x](javascript:alert(1))')).toEqual([
      { type: 'text', text: '[x](javascript:alert(1))' },
    ]);
  });

  it('treats unmatched delimiters as literal text', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ type: 'text', text: '2 * 3 = 6' }]);
    expect(parseInline('a **b')).toEqual([{ type: 'text', text: 'a **b' }]);
  });

  it('honours backslash escapes', () => {
    expect(parseInline('\\*not italic\\*')).toEqual([
      { type: 'text', text: '*not italic*' },
    ]);
  });

  it('escapes syntax characters on the way back out', () => {
    expect(escapeInline('a * b _ c [d] `e`')).toBe(
      'a \\* b \\_ c \\[d\\] \\`e\\`',
    );
    // ...and that escape survives a re-parse as literal text.
    expect(parseInline(escapeInline('a * b _ c [d]'))).toEqual([
      { type: 'text', text: 'a * b _ c [d]' },
    ]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Tiptap round trip
 * ──────────────────────────────────────────────────────────────────────────*/

const DOC: Block[] = [
  { type: 'heading', text: 'A **loud** heading', level: 3 },
  { type: 'paragraph', text: 'Body with `code`, _emphasis_ and [a link](/x).' },
  { type: 'list', items: ['first **item**', 'second'] },
  { type: 'list', items: ['step one'], ordered: true },
  { type: 'quote', text: 'Quoted **text**.', attribution: 'Someone' },
  { type: 'quote', text: 'No attribution here.' },
  {
    type: 'image',
    url: '/media/a.png',
    alt: 'Alt text',
    caption: 'A _caption_',
  },
  {
    type: 'code',
    text: 'const a = **not markdown**;',
    language: 'ts',
    filename: 'a.ts',
  },
];

describe('Tiptap serialisation', () => {
  it('produces the documented ProseMirror node types', () => {
    const doc = blocksToTiptapDoc(DOC);
    expect(doc.type).toBe('doc');
    expect(doc.content.map((node) => node.type)).toEqual([
      'heading',
      'paragraph',
      'bulletList',
      'orderedList',
      'blockquote',
      'blockquote',
      'image',
      'codeBlock',
    ]);
    expect(doc.content[0]?.attrs).toEqual({ level: 3 });
  });

  it('round-trips a document back to equivalent blocks', () => {
    const back = tiptapDocToBlocks(blocksToTiptapDoc(DOC));
    expect(back).toHaveLength(DOC.length);
    expect(back.map((block) => block.type)).toEqual(
      DOC.map((block) => block.type),
    );
    // Structural fields must survive exactly.
    expect(back[0]).toMatchObject({ type: 'heading', level: 3 });
    expect(back[3]).toMatchObject({ type: 'list', ordered: true });
    expect(back[4]).toMatchObject({ type: 'quote', attribution: 'Someone' });
    expect(back[5]).toMatchObject({ type: 'quote' });
    expect(back[5]).not.toHaveProperty('attribution');
    expect(back[6]).toMatchObject({
      type: 'image',
      url: '/media/a.png',
      alt: 'Alt text',
      caption: 'A _caption_',
    });
    // Code text is never Markdown-parsed in either direction.
    expect(back[7]).toMatchObject({
      type: 'code',
      text: 'const a = **not markdown**;',
      language: 'ts',
      filename: 'a.ts',
    });
  });

  it('renders identically after a round trip', () => {
    const html = (text: string) =>
      renderToStaticMarkup(<FormattedText text={text} />);
    for (const source of [
      'plain text',
      'a **bold** word',
      'an _italic_ word',
      'an *italic* word', //          normalises to _italic_ — same render
      'some `inline code`',
      'a [link](/docs) here',
      '**bold with a [link](/x) inside**',
      'a literal 2 * 3 = 6',
      'escaped \\*stars\\*',
      'trailing punctuation: **bold**!',
    ]) {
      const roundTripped = serializeInline(parseInline(source));
      expect(html(roundTripped), `${source} -> ${roundTripped}`).toBe(
        html(source),
      );
    }
  });

  it('drops editor nodes this format cannot store, keeping the rest', () => {
    const blocks = tiptapDocToBlocks({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'keep' }] },
        { type: 'table', content: [] },
        { type: 'horizontalRule' },
        { type: 'paragraph', content: [{ type: 'text', text: 'also keep' }] },
      ],
    });
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'keep' },
      { type: 'paragraph', text: 'also keep' },
    ]);
  });

  it('drops an image node with an unsafe src', () => {
    expect(
      tiptapDocToBlocks({
        type: 'doc',
        content: [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }],
      }),
    ).toEqual([]);
  });

  it('tolerates a null or malformed doc', () => {
    expect(tiptapDocToBlocks(null)).toEqual([]);
    expect(tiptapDocToBlocks({ type: 'doc' } as never)).toEqual([]);
  });
});
