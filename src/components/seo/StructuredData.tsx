import { structuredDataScript, type StructuredKind, type StructuredEntity } from '@/lib/structured-data';

/**
 * Emits schema.org JSON-LD for a piece of content.
 *
 * A server component with no styling and no layout impact — it renders one
 * script tag. Put it anywhere inside the page; position does not matter to a
 * crawler.
 *
 * Renders NOTHING when there is nothing honest to say (see structuredData).
 * dangerouslySetInnerHTML is required for JSON-LD, and is safe here because
 * structuredDataScript escapes `<`, so a database value containing `</script>`
 * cannot break out of the tag.
 */
export function StructuredData({ kind, entity }: { kind: StructuredKind; entity: StructuredEntity }) {
  const json = structuredDataScript(kind, entity);
  if (!json) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
