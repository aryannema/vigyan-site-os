/**
 * lib/content/FormattedText.tsx — the ONE place inline Markdown is parsed.
 *
 * ── What this renders ───────────────────────────────────────────────────────
 *
 * A restricted inline-Markdown subset, and nothing else:
 *
 *   **bold**        -> <strong>
 *   _italic_        -> <em>          (*italic* also works)
 *   `code`          -> <code>
 *   [text](url)     -> <a>           (url must pass isSafeUrl)
 *
 * Output is INLINE ONLY — no block wrapper is emitted, so the result is legal
 * inside a <p>, <li>, <blockquote>, <figcaption> or heading. The <p> that the
 * Markdown parser always produces is unwrapped away by `unwrapDisallowed`.
 * (Passing `className` to react-markdown would make it wrap the output in a
 * <div>, which is why this component deliberately does not forward one.)
 *
 * ── Why it is restricted (this is a security boundary) ──────────────────────
 *
 * Text reaching this component is written by an LLM through an MCP tool, or by
 * an admin user, and is stored in Postgres as untrusted JSON. A general Markdown
 * renderer would be an XSS sink the moment someone enables `rehype-raw`, and MDX
 * would be arbitrary code execution by design. So:
 *
 *   1. `allowedElements` is a four-element allow-list. Anything the parser
 *      produces outside it is unwrapped to its own text content by
 *      `unwrapDisallowed`, so unexpected syntax silently DEGRADES TO PLAIN TEXT
 *      instead of rendering, throwing, or being dropped. A stray `# Heading`
 *      renders the words "Heading", not an <h1>.
 *   2. No `rehype-raw`, and `skipHtml`. Raw HTML in the source — `<script>`,
 *      `<img onerror=...>`, `<b>` — is never turned into elements. It is
 *      converted to a TEXT node (see `rawHtmlAsText`) and escaped by React, so
 *      it is displayed inert and visible rather than silently dropped. There is
 *      no `dangerouslySetInnerHTML` anywhere in this file, and there must never
 *      be one.
 *   3. No remark/rehype plugins at all. The plugin list is the attack surface;
 *      an empty list is the only one that stays safe as dependencies move.
 *      In particular there is no `remark-gfm`, so no tables, task lists,
 *      footnotes or autolinked bare URLs.
 *   4. Link hrefs go through `isSafeUrl` (blocks.ts) via `urlTransform`, so
 *      `javascript:`, `data:` and friends lose their href rather than becoming
 *      a clickable payload. That is the same predicate the block validator
 *      applies at write time, so the rules cannot drift apart.
 *
 * Block-level structure is NOT Markdown in this template — it is typed JSON
 * (see blocks.ts). If you find yourself wanting to loosen the allow-list to get
 * a list or a heading, add or use a block type instead.
 *
 * ── Rendering environment ───────────────────────────────────────────────────
 *
 * No 'use client'. react-markdown renders synchronously with no hooks or state,
 * so this works as a React Server Component and ships no JavaScript for the
 * common read path.
 */

import * as React from 'react';
import Markdown, { type Components } from 'react-markdown';

import { isSafeUrl } from './blocks';

/** Exactly the elements the inline subset is allowed to produce. */
export const ALLOWED_INLINE_ELEMENTS = ['strong', 'em', 'code', 'a'] as const;

export interface FormattedTextProps {
  /** Source string. May contain the inline subset; anything else degrades. */
  text: string | null | undefined;
  /**
   * Add `target="_blank" rel="noopener noreferrer"` to absolute http(s) links.
   * Relative links (`/about`, `#section`) are always same-tab. Default: true.
   */
  openExternalInNewTab?: boolean;
  /** Class applied to <a>. Anchors are the one element a caller usually themes. */
  linkClassName?: string;
  /** Class applied to inline <code>. */
  codeClassName?: string;
}

/**
 * `urlTransform` runs for every href/src react-markdown is about to emit.
 * Returning `undefined` drops the attribute, so an unsafe link renders as
 * ordinary (non-clickable) text rather than disappearing — the reader still
 * sees the words the author wrote.
 */
const safeUrlTransform = (url: string): string | undefined =>
  isSafeUrl(url) ? url : undefined;

const isExternalHref = (href: string | undefined): boolean =>
  typeof href === 'string' && /^https?:\/\//i.test(href);

/**
 * mdast->hast handler for raw HTML nodes: emit them as a TEXT node.
 *
 * Without this, remark-rehype's default behaviour for raw HTML (with
 * `allowDangerousHtml` off, which is the safe default) is to DROP the node
 * entirely. That is safe but lossy in a way authors notice: `use a <div> here`
 * silently loses the `<div>`, and `5 <b> 6` eats half the sentence.
 *
 * Turning the node into text means React escapes it on the way out, so the
 * reader sees the literal characters the author typed. Same security posture —
 * a text node can never become an element — with no silent content loss, and
 * hostile input (`<script>alert(1)</script>`) is displayed inert and *visible*
 * rather than half-swallowed.
 *
 * This is a local three-line function, not a plugin dependency; the "no
 * plugins" rule in the header is about third-party code in the pipeline.
 */
const rawHtmlAsText = (_state: unknown, node: { value?: unknown }) => ({
  type: 'text' as const,
  value: typeof node.value === 'string' ? node.value : '',
});

/**
 * Render a string of restricted inline Markdown as inline React elements.
 *
 * @example
 *   <p><FormattedText text="Read the **docs** at [example](/docs)." /></p>
 */
export function FormattedText({
  text,
  openExternalInNewTab = true,
  // Defaults use this repo's own tokens (see the note in renderer.tsx): `sand`
  // is the alternate surface, `saffron-ink` the brand-safe link colour.
  linkClassName = 'text-saffron-ink underline underline-offset-2 hover:no-underline',
  codeClassName = 'rounded-sm bg-sand px-1 py-0.5 font-mono text-[0.9em]',
}: FormattedTextProps): React.JSX.Element | null {
  // Untrusted data really does arrive as null/number/undefined. Render nothing
  // rather than letting react-markdown stringify it.
  if (typeof text !== 'string' || text === '') return null;

  // NOTE on `node`: react-markdown passes the hast node as a `node` prop to
  // every component. Spreading props straight onto a DOM element therefore
  // emits a literal `node="[object Object]"` attribute — pull it out and drop
  // it. (Caught by the "bold and a link together" test.)
  const components: Components = {
    a: ({ node: _node, href, children, ...rest }) => {
      // `urlTransform` already dropped unsafe hrefs; without one there is
      // nothing to link to, so emit the label as plain text.
      if (typeof href !== 'string' || href === '') {
        return <>{children}</>;
      }
      const external = openExternalInNewTab && isExternalHref(href);
      return (
        <a
          {...rest}
          href={href}
          className={linkClassName}
          {...(external
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : {})}
        >
          {children}
        </a>
      );
    },
    code: ({ node: _node, children, ...rest }) => (
      <code {...rest} className={codeClassName}>
        {children}
      </code>
    ),
  };

  return (
    <Markdown
      // The allow-list. Note it is mutually exclusive with `disallowedElements`
      // in react-markdown — do not add one alongside it.
      allowedElements={[...ALLOWED_INLINE_ELEMENTS]}
      // Disallowed element -> render its children, drop the element itself.
      // This is what turns unsupported syntax into plain text.
      unwrapDisallowed
      // Belt and braces. With `rawHtmlAsText` below, no `raw` hast node is ever
      // produced, so this is a no-op today — it is here so that removing that
      // handler cannot quietly turn raw HTML back into markup.
      skipHtml
      // Empty on purpose. See the header comment — the plugin list IS the
      // attack surface.
      remarkPlugins={[]}
      rehypePlugins={[]}
      // Raw HTML becomes escaped text instead of being silently dropped.
      remarkRehypeOptions={{
        allowDangerousHtml: false,
        handlers: { html: rawHtmlAsText },
      }}
      urlTransform={safeUrlTransform}
      components={components}
    >
      {text}
    </Markdown>
  );
}
