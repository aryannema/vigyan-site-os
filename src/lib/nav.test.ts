import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }));

import { buildNavTree, resolveHref } from './nav';

const row = (id: string, label: string, position: number, parent_id: string | null = null) => ({
  id, parent_id, label, target_type: 'route', href: `/${label.toLowerCase()}`, position, flag: null,
});

describe('buildNavTree', () => {
  it('nests children under their parent in position order', () => {
    const tree = buildNavTree([
      row('b', 'Blog', 1),
      row('s', 'Services', 0),
      row('c2', 'Second', 1, 's'),
      row('c1', 'First', 0, 's'),
    ] as never);
    expect(tree.map((t) => t.label)).toEqual(['Services', 'Blog']);
    expect(tree[0]!.children.map((c) => c.label)).toEqual(['First', 'Second']);
  });

  it('drops children whose parent is missing', () => {
    const tree = buildNavTree([row('a', 'A', 0), row('x', 'Orphan', 0, 'gone')] as never);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children).toHaveLength(0);
  });
});

describe('resolveHref', () => {
  const base = { id: 'x', parent_id: null, label: 'X', position: 0, flag: null, href: null };

  it('follows a published landing page slug', () => {
    const r = { ...base, target_type: 'landing_page', landing_pages: { slug: 'new-slug', status: 'published' } };
    expect(resolveHref(r as never)).toBe('/services/new-slug');
  });

  it('hides a landing page that is not published', () => {
    const r = { ...base, target_type: 'landing_page', landing_pages: { slug: 'a', status: 'draft' } };
    expect(resolveHref(r as never)).toBeNull();
  });

  it('accepts the joined row as an array', () => {
    const r = { ...base, target_type: 'product', products: [{ slug: 'kit', status: 'active' }] };
    expect(resolveHref(r as never)).toBe('/products/kit');
  });

  it('hides an inactive product and keeps plain routes', () => {
    expect(resolveHref({ ...base, target_type: 'product', products: { slug: 'k', status: 'archived' } } as never)).toBeNull();
    expect(resolveHref({ ...base, target_type: 'route', href: '/about' } as never)).toBe('/about');
  });

  it('drops a submenu item whose target is hidden', () => {
    const tree = buildNavTree([
      row('s', 'Services', 0),
      { ...base, id: 'c', parent_id: 's', label: 'Draft', target_type: 'landing_page', landing_pages: { slug: 'd', status: 'draft' } },
    ] as never);
    expect(tree[0]!.children).toHaveLength(0);
  });
});
