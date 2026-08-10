import type { SiteContent } from '@/types/schema';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { query } from '../lib/db';

export const dynamic = 'force-dynamic';

interface SiteContentRow extends SiteContent {
  revisions: string;
}

/**
 * Read-only inventory of the addressable sections of the site.
 *
 * A section editor is deliberately not built here: `site_content.content_data`
 * is an open `jsonb` document and the type contract explicitly declines to
 * dictate section shapes, so a generic editor would either be a raw JSON box or
 * an invented schema. Which one this template should ship is a content-model
 * decision, not an admin-UI one.
 */
export default async function CmsPage() {
  const rows = await query<SiteContentRow>(
    `SELECT sc.section_id,
            sc.content_data,
            sc.updated_at,
            (SELECT count(*)::text
               FROM public.content_history ch
              WHERE ch.section_id = sc.section_id) AS revisions
       FROM public.site_content sc
      ORDER BY sc.section_id`,
  );

  return (
    <>
      <PageHeader
        title="Site content"
        description="Sections stored in site_content. Every section is publicly readable — it is the rendered marketing site."
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No sections yet"
          description="Rows appear here once site_content is populated. This page reads the real table."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Section</TableHead>
              <TableHead>Top-level keys</TableHead>
              <TableHead>Revisions</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const keys =
                row.content_data && typeof row.content_data === 'object'
                  ? Object.keys(row.content_data)
                  : [];
              return (
                <TableRow key={row.section_id}>
                  <TableCell className="font-mono text-xs">{row.section_id}</TableCell>
                  <TableCell className="max-w-md text-xs text-muted-foreground">
                    {keys.length === 0 ? '—' : keys.join(', ')}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.revisions}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.updated_at ? new Date(row.updated_at).toISOString().slice(0, 10) : '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </>
  );
}
