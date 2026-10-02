import { supabaseAdmin } from '@/lib/supabase';

export type NavChild = { id: string; label: string; href: string };
export type NavItem = NavChild & { flag: string | null; children: NavChild[] };

/** Used when the table is empty or unreachable, so the header is never blank. */
export const DEFAULT_NAV: NavItem[] = [
  { id: 'd-ss', label: 'Sample Product', href: '/sample-product', flag: 'sample_product_live', children: [] },
  { id: 'd-sv', label: 'Services', href: '/services', flag: null, children: [] },
  { id: 'd-ab', label: 'About', href: '/about', flag: null, children: [] },
  { id: 'd-bl', label: 'Blog', href: '/blog', flag: null, children: [] },
  { id: 'd-ct', label: 'Contact', href: '/contact', flag: null, children: [] },
];

type Embedded<T> = T | T[] | null;

/** A row as stored, with the joined target (if any). */
export type NavRow = {
  id: string;
  parent_id: string | null;
  label: string;
  target_type: 'route' | 'url' | 'landing_page' | 'product';
  href: string | null;
  position: number;
  flag: string | null;
  landing_pages?: Embedded<{ slug: string; status: string }>;
  products?: Embedded<{ slug: string; status: string }>;
};

const one = <T,>(v: Embedded<T> | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * The live address for a menu item, or null when it should not show: a landing
 * page that is not published, or a product that is not active, drops out of the
 * menu by itself instead of leaving a link to a 404.
 */
export function resolveHref(r: NavRow): string | null {
  switch (r.target_type) {
    case 'landing_page': {
      const t = one(r.landing_pages);
      return t && t.status === 'published' ? `/services/${t.slug}` : null;
    }
    case 'product': {
      const t = one(r.products);
      return t && t.status === 'active' ? `/products/${t.slug}` : null;
    }
    default:
      return r.href;
  }
}

type Resolved = Pick<NavRow, 'id' | 'parent_id' | 'label' | 'position' | 'flag'> & { href: string };

export function buildNavTree(rows: NavRow[]): NavItem[] {
  const live: Resolved[] = [];
  for (const r of rows) {
    const href = resolveHref(r);
    if (href) live.push({ id: r.id, parent_id: r.parent_id, label: r.label, position: r.position, flag: r.flag, href });
  }
  const sorted = live.sort((a, b) => a.position - b.position);
  const top = sorted.filter((r) => !r.parent_id);
  return top.map((t) => ({
    id: t.id,
    label: t.label,
    href: t.href,
    flag: t.flag,
    children: sorted
      .filter((c) => c.parent_id === t.id)
      .map((c) => ({ id: c.id, label: c.label, href: c.href })),
  }));
}

export async function getNav(): Promise<NavItem[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('nav_items')
      .select(
        'id, parent_id, label, target_type, href, position, flag, landing_pages(slug, status), products(slug, status)',
      )
      .eq('enabled', true);
    if (error || !data || data.length === 0) {
      if (error) console.error('[nav] read failed:', error.message);
      return DEFAULT_NAV;
    }
    const tree = buildNavTree(data as unknown as NavRow[]);
    return tree.length > 0 ? tree : DEFAULT_NAV;
  } catch (err) {
    console.error('[nav] read threw:', err);
    return DEFAULT_NAV;
  }
}
