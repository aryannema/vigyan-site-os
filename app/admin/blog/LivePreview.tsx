/**
 * Renders the SAME `BlockRenderer` (`lib/content/renderer.tsx`) that a public
 * post page would use — not a lookalike, the actual renderer — so this panel
 * shows exactly what the content will look like once published, not an
 * approximation. Server Component: no client JS beyond what BlockRenderer
 * itself needs (none — it is plain RSC).
 */

import { BlockRenderer } from '@/lib/content/renderer';
import type { Block } from '@/lib/content/blocks';

export function LivePreview({
  title,
  blocks,
}: {
  title: string;
  blocks: Block[];
}) {
  return (
    <div className="h-full overflow-y-auto rounded-lg border border-border bg-background">
      <article className="prose prose-sm dark:prose-invert max-w-none px-6 py-6">
        <h1 className="mb-4 text-2xl font-bold text-foreground">
          {title.trim() || <span className="text-muted-foreground">Untitled post</span>}
        </h1>
        <BlockRenderer
          blocks={blocks}
          fallback={
            <p className="text-sm text-muted-foreground">
              Nothing to preview yet — start typing on the left.
            </p>
          }
        />
      </article>
    </div>
  );
}
