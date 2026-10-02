/**
 * Renders a `markdown` block: full GFM (tables, task lists, strikethrough,
 * footnotes, autolinks), LaTeX math via KaTeX, ```mermaid fences, images, and a
 * YouTube link on its own line as an embedded video.
 *
 * Still safe by construction: NO rehype-raw and NO MDX, so raw HTML is shown as
 * inert text (never turned into elements) and nothing is evaluated. KaTeX runs
 * with `trust: false`. Link/image URLs go through `isSafeUrl`. The only client
 * JS is MermaidDiagram, and only on pages that contain a diagram.
 */

import * as React from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

import { isSafeUrl } from './blocks';
import { MermaidDiagram } from './MermaidDiagram';
import { parseYouTubeId, youtubeEmbedUrl } from './video';

const safeUrlTransform = (url: string): string | undefined => (isSafeUrl(url) ? url : undefined);

const rawHtmlAsText = (_state: unknown, node: { value?: unknown }) => ({
  type: 'text' as const,
  value: typeof node.value === 'string' ? node.value : '',
});

const textOf = (children: React.ReactNode): string =>
  React.Children.toArray(children)
    .map((c) => (typeof c === 'string' ? c : ''))
    .join('');

export function MarkdownBlock({ text }: { text: string }): React.JSX.Element {
  const components: Components = {
    // The page title owns the only h1.
    h1: ({ node: _n, children }) => <h2 className="mt-8 text-2xl font-bold tracking-[-0.02em] text-ink">{children}</h2>,
    h2: ({ node: _n, children }) => <h2 className="mt-8 text-2xl font-bold tracking-[-0.02em] text-ink">{children}</h2>,
    h3: ({ node: _n, children }) => <h3 className="mt-6 text-xl font-bold text-ink">{children}</h3>,
    h4: ({ node: _n, children }) => <h4 className="mt-5 text-lg font-bold text-ink">{children}</h4>,
    a: ({ node: _n, href, children }) => {
      if (typeof href !== 'string' || href === '') return <>{children}</>;
      const external = /^https?:\/\//i.test(href);
      return (
        <a
          href={href}
          className="text-saffron-ink underline underline-offset-2 hover:no-underline"
          {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {children}
        </a>
      );
    },
    img: ({ node: _n, src, alt }) =>
      typeof src === 'string' && isSafeUrl(src) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt ?? ''} className="my-2 w-full rounded-card border border-hairline" />
      ) : null,
    p: ({ node, children }) => {
      // A paragraph that is only a YouTube link becomes an embedded video.
      const kids = node?.children ?? [];
      if (kids.length === 1) {
        const k = kids[0] as { type: string; tagName?: string; properties?: { href?: string }; children?: { value?: string }[] };
        if (k.type === 'element' && k.tagName === 'a') {
          const id = parseYouTubeId(k.properties?.href);
          if (id) {
            return (
              <div className="aspect-video w-full overflow-hidden rounded-card border border-hairline bg-well">
                <iframe
                  src={youtubeEmbedUrl(id)}
                  title={textOf(children) || 'Video'}
                  loading="lazy"
                  allow="accelerometer; encrypted-media; picture-in-picture"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                  className="h-full w-full"
                />
              </div>
            );
          }
        }
      }
      return <p className="leading-relaxed">{children}</p>;
    },
    ul: ({ node: _n, children, className }) => (
      <ul className={`${className?.includes('contains-task-list') ? 'list-none pl-0' : 'list-disc pl-6'} flex flex-col gap-2 marker:text-saffron-500`}>{children}</ul>
    ),
    ol: ({ node: _n, children }) => <ol className="flex list-decimal flex-col gap-2 pl-6 marker:text-saffron-500">{children}</ol>,
    blockquote: ({ node: _n, children }) => (
      <blockquote className="border-l-2 border-saffron-500 pl-4 italic text-muted">{children}</blockquote>
    ),
    hr: () => <hr className="my-6 border-hairline" />,
    table: ({ node: _n, children }) => (
      <div className="my-2 overflow-x-auto rounded-card border border-hairline">
        <table className="w-full border-collapse text-left text-sm">{children}</table>
      </div>
    ),
    th: ({ node: _n, children, style }) => (
      <th style={style} className="border-b border-hairline bg-sand px-3 py-2 font-bold text-ink">{children}</th>
    ),
    td: ({ node: _n, children, style }) => (
      <td style={style} className="border-b border-hairline px-3 py-2 align-top">{children}</td>
    ),
    input: ({ node: _n, checked }) => (
      <input type="checkbox" checked={Boolean(checked)} disabled readOnly className="mr-2 align-middle" />
    ),
    pre: ({ node: _n, children }) => <>{children}</>,
    code: ({ node: _n, className, children }) => {
      const lang = /language-([\w-]+)/.exec(className ?? '')?.[1];
      const isBlock = Boolean(lang) || textOf(children).includes('\n');
      if (lang === 'mermaid') {
        return <MermaidDiagram code={textOf(children).replace(/\n$/, '')} classNames="overflow-x-auto rounded-card border border-hairline bg-well p-4" />;
      }
      if (lang === 'math') return <code className={className}>{children}</code>; // consumed by rehype-katex
      if (!isBlock) {
        return <code className="rounded-sm bg-sand px-1 py-0.5 font-mono text-[0.9em]">{children}</code>;
      }
      return (
        <pre className="overflow-x-auto rounded-card border border-hairline bg-well p-4">
          <code className={`font-mono text-sm text-ink ${className ?? ''}`}>{children}</code>
        </pre>
      );
    },
  };

  return (
    <div className="flex flex-col gap-6 text-body [&_.katex-display]:overflow-x-auto [&_sup]:text-xs">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore', trust: false, output: 'htmlAndMathml' }]]}
        remarkRehypeOptions={{ allowDangerousHtml: false, handlers: { html: rawHtmlAsText } }}
        urlTransform={safeUrlTransform}
        components={components}
      >
        {text}
      </Markdown>
    </div>
  );
}
