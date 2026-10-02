import Link from 'next/link';

import { query } from '../lib/db';
import { shortLinkUrl, type ShortLinkWithClicks } from '@/lib/links-schema';
import CopyLinkButton from './CopyLinkButton';
import DeleteLinkButton from './DeleteLinkButton';

export const dynamic = 'force-dynamic';

async function getAllLinks(): Promise<ShortLinkWithClicks[]> {
  return query<ShortLinkWithClicks>(
    `SELECT l.*,
            COUNT(c.id)::int AS click_count,
            MAX(c.clicked_at) AS last_clicked_at
       FROM public.link_shortener l
       LEFT JOIN public.link_clicks c ON c.link_id = l.id
      GROUP BY l.id
      ORDER BY l.created_at DESC`,
  );
}

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-brand-bytes/20 text-green-ink border-brand-bytes/30',
  draft: 'bg-brand-primary/20 text-saffron-ink border-brand-primary/30',
  archived: 'bg-ink/10 text-muted border-hairline-strong',
};

const OFFER_BADGE: Record<string, string> = {
  paid: 'bg-brand-primary/20 text-saffron-ink border-brand-primary/30',
  lead_magnet: 'bg-brand-bytes/20 text-green-ink border-brand-bytes/30',
  free: 'bg-ink/10 text-muted border-hairline-strong',
};

export default async function LinksManagementPage() {
  const links = await getAllLinks();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Link Builder</h1>
          <p className="mt-1 text-sm text-muted">
            {links.length} short link{links.length === 1 ? '' : 's'} — UTM-tagged, click-tracked
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/links/new"
            className="rounded-xl border border-hairline px-5 py-2.5 text-sm font-bold text-ink transition hover:border-hairline-strong"
          >
            + Single link
          </Link>
          <Link
            href="/admin/links/campaign"
            className="rounded-xl bg-brand-primary px-5 py-2.5 text-sm font-bold text-[#1c1814] shadow-lg shadow-brand-primary/20 transition hover:brightness-110"
          >
            + New campaign
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        {links.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted">No short links yet.</p>
            <Link href="/admin/links/new" className="mt-4 inline-block text-sm font-bold text-saffron-ink hover:underline">
              Create your first link →
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-[10px] font-bold uppercase tracking-widest text-muted">
                  <th className="px-6 py-4 text-left">Link</th>
                  <th className="px-4 py-4 text-left">Campaign</th>
                  <th className="px-4 py-4 text-left">Platform</th>
                  <th className="px-4 py-4 text-left">Offer</th>
                  <th className="px-4 py-4 text-left">Status</th>
                  <th className="px-4 py-4 text-right">Clicks</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline-faint">
                {links.map((link) => (
                  <tr key={link.id} className="group transition hover:bg-sand">
                    <td className="px-6 py-4">
                      <span className="font-mono text-xs font-medium text-ink transition group-hover:text-saffron-ink">
                        /go/{link.slug}
                      </span>
                      <span className="mt-0.5 block max-w-[240px] truncate text-[11px] text-muted" title={link.target_url}>
                        → {link.target_url}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-xs text-muted">{link.utm_campaign || '—'}</td>
                    <td className="px-4 py-4 text-xs text-muted">{link.platform || '—'}</td>
                    <td className="px-4 py-4">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${OFFER_BADGE[link.offer_type] || OFFER_BADGE.free}`}
                      >
                        {link.offer_type.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[link.status] || STATUS_BADGE.draft}`}
                      >
                        {link.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right text-xs font-semibold text-ink">{link.click_count}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <CopyLinkButton url={shortLinkUrl(link.slug)} />
                        <Link href={`/admin/links/${link.id}/edit`} className="text-xs font-bold text-saffron-ink hover:underline">
                          Edit
                        </Link>
                        <DeleteLinkButton id={link.id} slug={link.slug} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
