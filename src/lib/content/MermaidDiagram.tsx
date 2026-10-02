'use client';

/**
 * Renders a `code` block whose `language` is `mermaid` as an actual diagram
 * instead of verbatim text. This is the one exception to renderer.tsx's
 * "no client JS" invariant -- isolated to this leaf component, and only loaded
 * (dynamic import) on pages that actually contain a mermaid block.
 *
 * mermaid's default `securityLevel: 'strict'` sanitizes the SVG it produces
 * (script tags and inline event handlers in labels are stripped), so the
 * dangerouslySetInnerHTML below renders mermaid's own output, not raw
 * user/AI-authored HTML -- same trust boundary as any other code block, whose
 * `text` is already verbatim-on-purpose per the file header.
 *
 * Renders the raw source in a <pre> (matching the plain code-block look)
 * until the client-side render resolves, and falls back to it permanently if
 * the diagram syntax is invalid -- a typo in one diagram should cost that
 * block, not the page, matching this whole renderer's robustness rule.
 */

import * as React from 'react';
import { useTheme } from 'next-themes';

let idCounter = 0;

export function MermaidDiagram({ code, classNames }: { code: string; classNames: string }) {
  const [svg, setSvg] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const { resolvedTheme } = useTheme();

  React.useEffect(() => {
    let cancelled = false;
    import('mermaid').then(async ({ default: mermaid }) => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          // Matches the site's actual current theme instead of a hardcoded
          // 'dark' -- on a light-mode page a forced-dark diagram renders
          // with colors that don't read against the surrounding content.
          theme: resolvedTheme === 'dark' ? 'dark' : 'default',
          securityLevel: 'strict',
        });
        // A fresh id on every call, not a stable one reused across
        // re-renders -- LivePreview re-runs this effect on every keystroke
        // while a diagram is being edited, and mermaid.render() can error
        // or misbehave if the same id's previous render hasn't finished
        // cleaning up its temporary DOM node yet.
        const id = `mermaid-${++idCounter}`;
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) {
          setSvg(rendered);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true); // invalid diagram syntax -- fall back to raw text below
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, resolvedTheme]);

  if (svg && !failed) {
    // eslint-disable-next-line react/no-danger -- see file header: mermaid's own sanitized SVG output
    return <div className={classNames} dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  return (
    <pre className={classNames}>
      <code>{code}</code>
    </pre>
  );
}
