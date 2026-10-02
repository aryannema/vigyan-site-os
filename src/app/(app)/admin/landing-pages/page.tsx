import Link from 'next/link';

import { query } from '../lib/db';
import DeleteLandingPageButton from './DeleteLandingPageButton';

export const dynamic = 'force-dynamic';

type Row = {
  id: string; slug: string; title: string; status: string; updated_at: string;
  product_title: string | null;
};

const BADGE: Record<string, string> = {
  published: 'bg-brand-bytes/20 text-green-ink border-brand-bytes/30',
  draft: 'bg-brand-primary/20 text-saffron-ink border-brand-primary/30',
  archived: 'bg-ink/10 text-muted border-hairline-strong',
};

export default async function LandingPagesAdmin() {
  const pages = await query<Row>(
    `SELECT l.id, l.slug, l.title, l.status, l.updated_at, p.title AS product_title
       FROM public.landing_pages l LEFT JOIN public.products p ON p.id = l.product_id
      ORDER BY l.updated_at DESC`,
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Landing pages</h1>
          <p className="mt-1 text-sm text-muted">
            {pages.length} total. Each lives at /services/&lt;slug&gt;, is server-rendered for search, and can sell a product.
          </p>
        </div>
        <Link href="/admin/landing-pages/new" className="rounded-xl bg-brand-primary px-5 py-2.5 text-sm font-bold text-[#1c1814] shadow-lg shadow-brand-primary/20 transition hover:brightness-110">
          + New page
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        {pages.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted">No landing pages yet.</p>
            <Link href="/admin/landing-pages/new" className="mt-4 inline-block text-sm font-bold text-saffron-ink hover:underline">Create your first page →</Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-[10px] font-bold uppercase tracking-widest text-muted">
                  <th className="px-6 py-4 text-left">Page</th>
                  <th className="px-4 py-4 text-left">Sells</th>
                  <th className="px-4 py-4 text-left">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline-faint">
                {pages.map((p) => (
                  <tr key={p.id} className="group transition hover:bg-sand">
                    <td className="px-6 py-4">
                      <span className="font-medium text-ink line-clamp-1">{p.title}</span>
                      <span className="mt-0.5 block font-mono text-[11px] text-muted">/services/{p.slug}</span>
                    </td>
                    <td className="px-4 py-4 text-xs text-muted">{p.product_title ?? '—'}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${BADGE[p.status] ?? BADGE.draft}`}>{p.status}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-4">
                        <Link href={`/admin/links/campaign?page=${p.slug}`} className="text-xs text-muted transition hover:text-ink">Campaign</Link>
                        <Link href={`/admin/landing-pages/${p.id}/edit`} className="text-xs font-bold text-saffron-ink hover:underline">Edit</Link>
                        <DeleteLandingPageButton id={p.id} title={p.title} />
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
