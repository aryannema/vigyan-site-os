import Link from 'next/link';

import { queryAsActor } from '../lib/db';
import { PageHeader } from '../components/PageHeader';

export const dynamic = 'force-dynamic';

interface CrmInquiry {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_number: string | null;
  whatsapp_opt_in: boolean | null;
  message: string | null;
  source: 'contact_form' | 'blueprint_request';
  created_at: string;
  pii_masked: boolean;
}

const SOURCE_LABEL: Record<CrmInquiry['source'], string> = {
  contact_form: 'Contact form',
  blueprint_request: 'Blueprint request',
};

const SOURCE_BADGE: Record<CrmInquiry['source'], string> = {
  contact_form: 'bg-brand-primary/20 text-saffron-ink border-brand-primary/30',
  blueprint_request: 'bg-brand-bytes/20 text-green-ink border-brand-bytes/30',
};

/**
 * Everything that came in through a site form — general contact enquiries
 * and blueprint requests — unioned with WhatsApp under one CRM view. Reads
 * via queryAsActor(), not query(), because crm_inquiries_view wraps
 * contact_inquiries_view (005/010), whose row visibility AND PII masking
 * both depend on auth.uid() — a plain owner-connection read would bypass
 * that masking, which is exactly what 005 exists to prevent.
 */
export default async function CrmPage() {
  const { rows: inquiries, actorId } = await queryAsActor<CrmInquiry>(
    `SELECT id, full_name, first_name, last_name, email, phone_number, whatsapp_opt_in,
            message, source, created_at, pii_masked
       FROM public.crm_inquiries_view
      ORDER BY created_at DESC
      LIMIT 200`,
  );

  return (
    <>
      <PageHeader
        title="CRM — All Inquiries"
        description="Every contact-form and blueprint-request submission, in one place. See WhatsApp for chat conversations."
      />

      {!actorId ? (
        <p className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-600">
          No authenticated actor — showing zero rows. Sign in as an admin to view inquiries.
        </p>
      ) : null}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">{inquiries.length} recent inquiries</p>
        <Link href="/admin/whatsapp" className="text-xs font-bold text-saffron-ink hover:underline">
          View WhatsApp conversations →
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        {inquiries.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted">No inquiries yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-[10px] font-bold uppercase tracking-widest text-muted">
                  <th className="px-6 py-4 text-left">Name</th>
                  <th className="px-4 py-4 text-left">Contact</th>
                  <th className="px-4 py-4 text-left">Source</th>
                  <th className="px-4 py-4 text-left">Message</th>
                  <th className="px-6 py-4 text-right">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {inquiries.map((inquiry) => (
                  <tr key={inquiry.id} className="transition hover:bg-sand">
                    <td className="px-6 py-4">
                      <span className="font-medium text-ink">
                        {inquiry.full_name || [inquiry.first_name, inquiry.last_name].filter(Boolean).join(' ') || '—'}
                      </span>
                      {inquiry.pii_masked ? (
                        <span className="mt-0.5 block text-[10px] uppercase tracking-wider text-muted">masked</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-4 text-xs text-muted">
                      <div>{inquiry.email || '—'}</div>
                      <div>
                        {inquiry.phone_number || '—'}
                        {inquiry.whatsapp_opt_in ? ' (WhatsApp opt-in)' : ''}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${SOURCE_BADGE[inquiry.source]}`}>
                        {SOURCE_LABEL[inquiry.source]}
                      </span>
                    </td>
                    <td className="max-w-xs px-4 py-4 text-xs text-body">
                      <p className="line-clamp-2">{inquiry.message || '—'}</p>
                    </td>
                    <td className="px-6 py-4 text-right text-xs text-muted">
                      {new Date(inquiry.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
