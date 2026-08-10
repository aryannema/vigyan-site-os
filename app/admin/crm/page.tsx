import type { ContactInquiryView } from '@/types/schema';

import { Badge } from '../../../components/ui/badge';
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
import { query, queryAsActor } from '../lib/db';

export const dynamic = 'force-dynamic';

/**
 * Read-only for now. Inquiries arrive from the public contact form; triage
 * (crm:edit) is a separate surface and is not part of this phase.
 *
 * Read through `contact_inquiries_view`, never the base table. The view is the
 * supported read path for every role (005 §3): it applies the row gate and masks
 * email/phone_number according to the caller's capabilities. Reading
 * `contact_inquiries` directly would work — this connection owns the table — and
 * would return raw customer PII regardless of who is looking, which is exactly
 * the bypass 005 §4 closes.
 */
export default async function CrmPage() {
  const { rows, actorId } = await queryAsActor<ContactInquiryView>(
    `SELECT id, full_name, email, phone_number, message, created_at, pii_masked
       FROM public.contact_inquiries_view
      ORDER BY created_at DESC NULLS LAST
      LIMIT 200`,
  );

  // Service-role count of the underlying table, used only to tell "there are no
  // inquiries" apart from "the view is filtering them all out".
  const [totals] = await query<{ total: string }>(
    `SELECT count(*)::text AS total FROM public.contact_inquiries`,
  );
  const total = Number(totals?.total ?? 0);
  const masked = rows.some((row) => row.pii_masked);

  return (
    <>
      <PageHeader
        title="Contact inquiries"
        description="Submissions from the public contact form, read through contact_inquiries_view."
      />

      {rows.length > 0 ? (
        <p className="mb-4 text-xs text-muted-foreground">
          {masked
            ? 'Email and phone number are masked: the acting identity holds crm:view but not crm:edit or crm:create, so it may count these leads but not contact them.'
            : 'Showing raw contact details: the acting identity holds crm:edit or crm:create.'}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title={total === 0 ? 'No inquiries yet' : 'No inquiries visible to the current identity'}
          description={
            total === 0 ? (
              <>
                Rows appear here as soon as the public contact form is submitted — this page
                queries the real view.
              </>
            ) : actorId ? (
              <>
                <code>contact_inquiries</code> holds {total} row{total === 1 ? '' : 's'}, but the
                acting identity does not hold <code>crm:view</code>, so the view returns none.
                Grant it on the Capabilities page.
              </>
            ) : (
              <>
                <code>contact_inquiries</code> holds {total} row{total === 1 ? '' : 's'}, but no
                acting identity is configured, so <code>auth.uid()</code> is NULL and the view&rsquo;s
                row gate excludes everything. This is a missing identity, not missing data — see
                BLOCKERS.md.
              </>
            )
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.full_name}</TableCell>
                <TableCell className="text-xs">
                  {/* pii_masked is decided in the database; never re-derive it
                      from the user's role here or the rule will drift. */}
                  {row.pii_masked ? (
                    <span className="font-mono text-muted-foreground">{row.email}</span>
                  ) : (
                    <a className="underline" href={`mailto:${row.email}`}>
                      {row.email}
                    </a>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {row.phone_number === null ? (
                    '—'
                  ) : row.pii_masked ? (
                    <span className="font-mono text-muted-foreground">{row.phone_number}</span>
                  ) : (
                    <a className="underline" href={`tel:${row.phone_number}`}>
                      {row.phone_number}
                    </a>
                  )}
                </TableCell>
                <TableCell className="max-w-md text-xs text-muted-foreground">
                  <span className="line-clamp-2">{row.message}</span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : '—'}
                  {row.pii_masked ? (
                    <Badge variant="muted" className="ml-2">
                      masked
                    </Badge>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
