import { query } from '../lib/db';
import { AddNavForm, type PageOption } from './AddNavForm';
import { NavRow, type NavRowData } from './NavRow';

export const dynamic = 'force-dynamic';

type Item = {
  id: string; parent_id: string | null; label: string; target_type: string; href: string | null;
  position: number; enabled: boolean; flag: string | null;
  lp_slug: string | null; lp_title: string | null; lp_status: string | null;
  pr_slug: string | null; pr_title: string | null; pr_status: string | null;
};

/** Where the item points today, and whether visitors can actually see it. */
function describe(i: Item): { target: string; note: string | null } {
  if (i.target_type === 'landing_page') {
    const live = i.lp_status === 'published';
    return { target: `/services/${i.lp_slug} · landing page “${i.lp_title}”`, note: live ? null : `Hidden — the page is ${i.lp_status}. Publish it to show this item.` };
  }
  if (i.target_type === 'product') {
    const live = i.pr_status === 'active';
    return { target: `/products/${i.pr_slug} · product “${i.pr_title}”`, note: live ? null : `Hidden — the product is ${i.pr_status}.` };
  }
  return { target: i.href ?? '', note: null };
}

const STATIC_PAGES: PageOption[] = [
  ['Home', '/'], ['Services', '/services'], ['About', '/about'], ['Blog', '/blog'],
  ['Templates & tools', '/templates'], ['Sample Product', '/sample-product'], ['Contact', '/contact'], ['Careers', '/careers'],
].map(([label, href]) => ({ group: 'Site pages', label: label!, value: `route:${href}`, hint: href! }));

export default async function NavAdminPage() {
  const [items, landings, products] = await Promise.all([
    query<Item>(
      `SELECT n.id, n.parent_id, n.label, n.target_type, n.href, n.position, n.enabled, n.flag,
              l.slug AS lp_slug, l.title AS lp_title, l.status AS lp_status,
              p.slug AS pr_slug, p.title AS pr_title, p.status AS pr_status
         FROM public.nav_items n
         LEFT JOIN public.landing_pages l ON l.id = n.landing_page_id
         LEFT JOIN public.products p ON p.id = n.product_id
        ORDER BY n.position, n.created_at`,
    ),
    query<{ id: string; slug: string; title: string }>(`SELECT id, slug, title FROM public.landing_pages WHERE status = 'published' ORDER BY title`),
    query<{ id: string; slug: string; title: string }>(`SELECT id, slug, title FROM public.products WHERE status = 'active' ORDER BY title`),
  ]);

  const pages: PageOption[] = [
    ...STATIC_PAGES,
    ...landings.map((l) => ({ group: 'Landing pages', label: l.title, value: `landing_page:${l.id}`, hint: `/services/${l.slug}` })),
    ...products.map((p) => ({ group: 'Products', label: p.title, value: `product:${p.id}`, hint: `/products/${p.slug}` })),
  ];

  const top = items.filter((i) => !i.parent_id);
  const rows: NavRowData[] = [];
  for (const [ti, t] of top.entries()) {
    const kids = items.filter((c) => c.parent_id === t.id);
    rows.push({ ...t, ...describe(t), isFirst: ti === 0, isLast: ti === top.length - 1, child: false, childCount: kids.length });
    for (const [ki, k] of kids.entries()) {
      rows.push({ ...k, ...describe(k), isFirst: ki === 0, isLast: ki === kids.length - 1, child: true, childCount: 0 });
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Header menu</h1>
        <p className="mt-1 text-sm text-muted">
          What visitors see at the top of every page. Changes go live in seconds — no deploy. Items with a submenu open as a dropdown on desktop and expand in the mobile menu.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted">
            No custom menu yet — the site is showing its built-in menu. Add your first item below to take over.
          </p>
        ) : (
          <div className="divide-y divide-hairline-faint">
            {rows.map((r) => <NavRow key={r.id} row={r} />)}
          </div>
        )}
      </div>

      <AddNavForm pages={pages} parents={top.map((t) => ({ id: t.id, label: t.label }))} />
    </div>
  );
}
