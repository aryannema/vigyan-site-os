import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownBlock } from './MarkdownBlock';

const md = [
  '# Title', '', '| a | b |', '|---|---|', '| 1 | 2 |', '',
  '- [x] done', '', 'Inline $E=mc^2$ math.', '', '$$\\int_0^1 x\\,dx$$', '',
  '```mermaid', 'graph TD; A-->B', '```', '',
  '<script>alert(1)</script>', '', '[bad](javascript:alert(1))', '',
  'https://youtu.be/dQw4w9WgXcQ',
].join('\n');

describe('MarkdownBlock', () => {
  const html = renderToStaticMarkup(<MarkdownBlock text={md} />);
  it('renders GFM table, task list, KaTeX', () => {
    expect(html).toContain('<table');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('class="katex');
  });
  it('demotes h1 and embeds YouTube nocookie', () => {
    expect(html).not.toContain('<h1');
    expect(html).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });
  it('never emits script or javascript: links', () => {
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
  });
});
