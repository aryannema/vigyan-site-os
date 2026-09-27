/**
 * lib/content/content.test.tsx — real render tests for the block + inline format.
 *
 * The two things worth proving here:
 *
 *   1. The supported inline subset actually produces the elements it claims to
 *      (`**bold**` -> <strong>, `[a](/b)` -> <a href="/b">), because the whole
 *      point of this module is that the upstream site's `{block.text}` raw
 *      interpolation rendered those as literal asterisks and brackets.
 *
 *   2. Everything OUTSIDE the subset degrades instead of executing. Content here
 *      is written by LLMs through MCP tools, so `<script>`, `<img onerror>` and
 *      `javascript:` hrefs are the realistic hostile inputs, not a thought
 *      experiment.
 *
 * Run:  pnpm vitest run lib/content
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  blocksToPlainText,
  isBlock,
  isSafeUrl,
  narrowBlocks,
  parseBlocks,
  safeParseBlocks,
  stripInlineMarkdown,
  type Block,
} from './blocks';
import { FormattedText } from './FormattedText';
import { BlockRenderer } from './renderer';

const inline = (text: string, props: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(<FormattedText text={text} {...props} />);

const render = (blocks: unknown): string =>
  renderToStaticMarkup(
    <BlockRenderer blocks={blocks as Block[]} />,
  );

/**
 * The assertion that actually matters. Note that `expect(html).not.toContain(
 * 'onerror')` is the WRONG check: raw HTML degrades to *escaped text*, so the
 * literal word "onerror" is expected to appear — inert, visible, harmless. What
 * must never appear is an actual element carrying an event handler, or a
 * script/iframe/svg/object tag. Matching on the un-escaped `<` is what
 * distinguishes "rendered" from "displayed as text".
 */
const executableMarkup = (html: string): string[] => {
  const findings: string[] = [];
  const eventHandler = /<[a-zA-Z][^>]*\son[a-z]+\s*=/g;
  const dangerousTag = /<\/?(script|iframe|object|embed|svg|style|form|link|meta|base)\b/gi;
  findings.push(...(html.match(eventHandler) ?? []));
  findings.push(
    // React 19 emits its own <link rel="preload" as="image"> for <img>; that is
    // React's resource hint, not author content, so it is not a finding.
    ...(html.match(dangerousTag) ?? []).filter(
      (tag) => !(tag.toLowerCase() === '<link' && html.includes('rel="preload"')),
    ),
  );
  findings.push(...(html.match(/javascript:/gi) ?? []));
  return findings;
};

/* ────────────────────────────────────────────────────────────────────────────
 * 1. The supported inline subset renders
 * ──────────────────────────────────────────────────────────────────────────*/

describe('FormattedText — supported subset', () => {
  it('renders **bold** as <strong>', () => {
    expect(inline('a **bold** word')).toContain('<strong>bold</strong>');
  });

  it('renders _italic_ and *italic* as <em>', () => {
    expect(inline('_soft_')).toContain('<em>soft</em>');
    expect(inline('*soft*')).toContain('<em>soft</em>');
  });

  it('renders `code` as <code>', () => {
    const html = inline('call `render()` first');
    expect(html).toContain('<code');
    expect(html).toContain('render()');
  });

  it('renders [text](url) as <a> with the href intact', () => {
    const html = inline('see [the docs](/docs/blocks)');
    expect(html).toContain('href="/docs/blocks"');
    expect(html).toContain('the docs</a>');
  });

  it('renders bold and a link together in one string', () => {
    const html = inline('**bold** and a [link](https://example.com/x)');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<a href="https://example.com/x"');
    expect(html).toContain('>link</a>');
  });

  it('emits no block wrapper, so output is legal inside <p>/<li>', () => {
    const html = inline('just text');
    expect(html).toBe('just text');
    expect(html).not.toContain('<p>');
    expect(html).not.toContain('<div');
  });

  it('marks absolute external links target=_blank rel=noopener', () => {
    const html = inline('[out](https://example.com)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('leaves relative links in the same tab', () => {
    const html = inline('[in](/about)');
    expect(html).not.toContain('target="_blank"');
  });

  it('renders nothing for null/empty text', () => {
    expect(renderToStaticMarkup(<FormattedText text={null} />)).toBe('');
    expect(renderToStaticMarkup(<FormattedText text="" />)).toBe('');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Everything else degrades to plain text — the security contract
 * ──────────────────────────────────────────────────────────────────────────*/

describe('FormattedText — hostile and out-of-subset input degrades', () => {
  it('shows a <script> tag as escaped text and never as an element', () => {
    const html = inline('hello <script>alert(1)</script> world');
    expect(executableMarkup(html)).toEqual([]);
    // The whole payload survives, escaped and visible — no silent truncation.
    expect(html).toBe('hello &lt;script&gt;alert(1)&lt;/script&gt; world');
  });

  it('shows <img onerror=...> as escaped text and never as an element', () => {
    const html = inline('<img src=x onerror="alert(1)">');
    expect(executableMarkup(html)).toEqual([]);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=');
  });

  it('shows arbitrary raw HTML as escaped text, losing nothing', () => {
    const html = inline('<b>not bold</b> and <iframe src="//evil"></iframe>');
    expect(executableMarkup(html)).toEqual([]);
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;not bold&lt;/b&gt;');
    expect(html).toContain('&lt;iframe');
  });

  it('does not turn a stray "# heading" into a heading element', () => {
    const html = inline('# Not A Heading');
    expect(html).not.toMatch(/<h[1-6]/);
    expect(html).toBe('Not A Heading');
  });

  it('does not turn block-level markdown into lists or rules', () => {
    expect(inline('- one\n- two')).not.toContain('<ul');
    expect(inline('1. one\n2. two')).not.toContain('<ol');
    expect(inline('> quoted')).not.toContain('<blockquote');
    expect(inline('---')).not.toContain('<hr');
  });

  it('does not render an image from markdown image syntax', () => {
    const html = inline('![alt](https://example.com/a.png)');
    expect(html).not.toContain('<img');
  });

  it('drops a javascript: href but keeps the link text', () => {
    const html = inline('[click me](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('href=');
    expect(html).toContain('click me');
  });

  it('drops a data: href', () => {
    const html = inline('[x](data:text/html;base64,PHNjcmlwdD4=)');
    expect(html).not.toContain('data:');
    expect(html).not.toContain('href=');
  });

  it('drops a protocol-relative href', () => {
    const html = inline('[x](//evil.example/path)');
    expect(html).not.toContain('href=');
  });

  it('escapes quotes and angle brackets that survive as text', () => {
    const html = inline('a " quote and 5 < 6 & 7 > 6');
    expect(html).not.toContain('<6');
    expect(html).toMatch(/&lt;|&#x3C;/);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3. isSafeUrl
 * ──────────────────────────────────────────────────────────────────────────*/

describe('isSafeUrl', () => {
  it('accepts the allowed schemes and relative forms', () => {
    for (const url of [
      'https://example.com/a?b=c#d',
      'http://example.com',
      'mailto:hi@example.com',
      'tel:+911234567890',
      '/about',
      './sibling',
      '../parent',
      'plain/path',
      '#anchor',
      '?q=1',
    ]) {
      expect(isSafeUrl(url), url).toBe(true);
    }
  });

  it('rejects executable, exotic and laundered schemes', () => {
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)  ',
      'java\u0000script:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.example',
      '',
      '   ',
    ]) {
      expect(isSafeUrl(url), url).toBe(false);
    }
  });

  it('rejects non-strings', () => {
    expect(isSafeUrl(null)).toBe(false);
    expect(isSafeUrl(42)).toBe(false);
    expect(isSafeUrl(undefined)).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 4. Block validation
 * ──────────────────────────────────────────────────────────────────────────*/

const VALID_DOC: Block[] = [
  { type: 'heading', text: 'Getting **started**', level: 2 },
  { type: 'paragraph', text: 'Run `pnpm dev` and open [localhost](/).' },
  { type: 'list', items: ['a **bold** item', 'a [linked](/x) item'] },
  { type: 'quote', text: 'Ship it.', attribution: 'Someone' },
  { type: 'image', url: '/media/a.png', alt: 'A diagram', caption: 'Fig _1_' },
  { type: 'code', text: 'const x = 1;', language: 'ts' },
];

describe('block validation', () => {
  it('accepts a well-formed document', () => {
    expect(parseBlocks(VALID_DOC)).toHaveLength(6);
    expect(VALID_DOC.every(isBlock)).toBe(true);
  });

  it('rejects an unknown block type', () => {
    const result = safeParseBlocks([{ type: 'video', url: '/a.mp4' }]);
    expect(result.ok).toBe(false);
  });

  it('rejects unknown keys (the shape of a typo\'d MCP call)', () => {
    // `src` instead of `url` — silently accepting this renders a broken image.
    const result = safeParseBlocks([
      { type: 'image', src: '/a.png', alt: 'x' },
    ]);
    expect(result.ok).toBe(false);
  });

  it('rejects h1 and out-of-range heading levels', () => {
    expect(safeParseBlocks([{ type: 'heading', text: 'x', level: 1 }]).ok).toBe(
      false,
    );
    expect(safeParseBlocks([{ type: 'heading', text: 'x', level: 7 }]).ok).toBe(
      false,
    );
  });

  it('rejects an unsafe image url at write time', () => {
    const result = safeParseBlocks([
      { type: 'image', url: 'javascript:alert(1)', alt: 'x' },
    ]);
    expect(result.ok).toBe(false);
  });

  it('reports a readable path for each problem', () => {
    const result = safeParseBlocks([
      { type: 'paragraph', text: 'fine' },
      { type: 'paragraph', text: 42 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/\[1\]\.text/);
    }
  });

  it('parseBlocks throws with all of the problems in the message', () => {
    expect(() => parseBlocks([{ type: 'nope' }])).toThrow(
      /Invalid content_blocks/,
    );
  });

  it('narrowBlocks drops bad blocks instead of failing the page', () => {
    const dropped: number[] = [];
    const kept = narrowBlocks(
      [
        { type: 'paragraph', text: 'keep me' },
        { type: 'paragraph' },
        { type: 'heading', text: 'keep me too', level: 3 },
      ] as never,
      (_block, index) => dropped.push(index),
    );
    expect(kept).toHaveLength(2);
    expect(dropped).toEqual([1]);
  });

  it('narrowBlocks tolerates null / non-array input', () => {
    expect(narrowBlocks(null)).toEqual([]);
    expect(narrowBlocks(undefined)).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 5. BlockRenderer end to end
 * ──────────────────────────────────────────────────────────────────────────*/

describe('BlockRenderer', () => {
  const html = render(VALID_DOC);

  it('renders inline formatting inside every prose block', () => {
    expect(html).toContain('<h2'); //                       heading
    expect(html).toContain('<strong>started</strong>'); //   heading inline
    expect(html).toContain('<code'); //                      paragraph inline code
    expect(html).toContain('href="/"'); //                   paragraph link
    expect(html).toContain('<strong>bold</strong>'); //       list item inline
    expect(html).toContain('href="/x"'); //                  list item link
    expect(html).toContain('<em>1</em>'); //                  figcaption inline
  });

  it('renders the structural elements each block owns', () => {
    expect(html).toContain('<ul');
    expect(html).toContain('<li');
    expect(html).toContain('<blockquote');
    expect(html).toContain('<cite>Someone</cite>');
    expect(html).toContain('<figure');
    expect(html).toContain('<img src="/media/a.png" alt="A diagram"');
    expect(html).toContain('<figcaption');
    expect(html).toContain('<pre');
    expect(html).toContain('language-ts');
  });

  it('renders ordered lists as <ol>', () => {
    const ol = render([{ type: 'list', ordered: true, items: ['one'] }]);
    expect(ol).toContain('<ol');
  });

  it('renders heading levels 2-6', () => {
    for (const level of [2, 3, 4, 5, 6]) {
      expect(render([{ type: 'heading', text: 'x', level }])).toContain(
        `<h${level}`,
      );
    }
  });

  it('never emits an h1 — the page title owns it', () => {
    expect(html).not.toContain('<h1');
  });

  it('leaves code block text verbatim and escaped', () => {
    const code = render([
      {
        type: 'code',
        text: 'if (a < b && c) alert("**not bold**");\n<script>x</script>',
        language: 'js',
      },
    ]);
    // Markdown syntax survives literally...
    expect(code).toContain('**not bold**');
    // ...and the HTML in the sample is escaped, not executed.
    expect(code).not.toContain('<script>');
    expect(code).toMatch(/&lt;script&gt;/);
  });

  it('drops an invalid block mid-document rather than failing the render', () => {
    const partial = render([
      { type: 'paragraph', text: 'before' },
      { type: 'paragraph', text: null },
      { type: 'paragraph', text: 'after' },
    ]);
    expect(partial).toContain('before');
    expect(partial).toContain('after');
    expect(partial.match(/<p /g) ?? []).toHaveLength(2);
  });

  it('renders the fallback for empty/absent content', () => {
    expect(
      renderToStaticMarkup(
        <BlockRenderer blocks={null} fallback={<p>Nothing here.</p>} />,
      ),
    ).toBe('<p>Nothing here.</p>');
  });

  it('emits no executable markup for a fully hostile document', () => {
    const hostile = render([
      { type: 'paragraph', text: '<script>alert(1)</script>' },
      { type: 'heading', text: '<img src=x onerror=alert(1)>', level: 2 },
      { type: 'list', items: ['[x](javascript:alert(1))'] },
      { type: 'quote', text: '<svg onload=alert(1)>' },
      // Attribute-escaping check: alt goes into an HTML attribute, so the
      // quote is the thing that must not break out of it.
      { type: 'image', url: '/ok.png', alt: '"><script>alert(1)</script>' },
      { type: 'code', text: '</code></pre><script>alert(1)</script>' },
    ]);
    expect(executableMarkup(hostile)).toEqual([]);
    // Every payload is present, escaped — degraded, not swallowed.
    expect(hostile).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(hostile).toContain('&quot;&gt;&lt;script&gt;');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 6. Plain-text projection
 * ──────────────────────────────────────────────────────────────────────────*/

describe('plain text projection', () => {
  it('strips the inline subset', () => {
    expect(stripInlineMarkdown('a **b** _c_ `d` [e](/f)')).toBe('a b c d e');
  });

  it('leaves code blocks out and joins the rest', () => {
    const text = blocksToPlainText(VALID_DOC);
    expect(text).toContain('Getting started');
    expect(text).toContain('Run pnpm dev and open localhost.');
    expect(text).not.toContain('const x = 1;');
    expect(text).not.toContain('**');
  });
});
