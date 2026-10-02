import { createHash } from 'crypto';

import { query } from '@/app/(app)/admin/lib/db';

/**
 * The issued invoice PDF, stored in Postgres (migration 032).
 *
 * Read and written through the `pg` pool rather than the Supabase REST client:
 * PostgREST moves bytea as a hex-escaped string, which inflates a binary
 * document over the wire and back again. The pool hands back a Buffer.
 */

export interface ArchivedInvoice {
  pdf: Buffer;
  sha256: string;
  renderedAt: string;
}

export async function getArchivedInvoice(orderId: string): Promise<ArchivedInvoice | null> {
  const rows = await query<{ pdf: Buffer; sha256: string; rendered_at: string }>(
    'SELECT pdf, sha256, rendered_at FROM public.invoice_archive WHERE order_id = $1',
    [orderId],
  );
  const row = rows[0];
  return row ? { pdf: row.pdf, sha256: row.sha256, renderedAt: row.rendered_at } : null;
}

/**
 * Archives the PDF, once.
 *
 * ON CONFLICT DO NOTHING rather than an upsert: the table is append-only and
 * has a trigger refusing UPDATE, because correcting a wrong invoice is a credit
 * note plus a new invoice, not an edit to the document already in the
 * customer's hands. A concurrent second call is therefore a no-op, not an
 * error — which matters because Razorpay redelivers webhooks.
 */
export async function archiveInvoice(orderId: string, pdf: Buffer): Promise<string> {
  const sha256 = createHash('sha256').update(pdf).digest('hex');
  await query(
    `INSERT INTO public.invoice_archive (order_id, pdf, byte_size, sha256)
          VALUES ($1, $2, $3, $4)
     ON CONFLICT (order_id) DO NOTHING`,
    [orderId, pdf, pdf.length, sha256],
  );
  return sha256;
}

/** Proves an archived document has not changed since it was issued. */
export function verifyArchived(a: ArchivedInvoice): boolean {
  return createHash('sha256').update(a.pdf).digest('hex') === a.sha256;
}
