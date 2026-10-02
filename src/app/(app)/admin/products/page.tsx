import Link from 'next/link';

import { query } from '../lib/db';
import { formatPrice, type Product } from '@/lib/products-schema';
import DeleteProductButton from './DeleteProductButton';

export const dynamic = 'force-dynamic';

async function getAllProducts(): Promise<Product[]> {
  return query<Product>(
    `SELECT id, slug, title, description, category, price_paise, currency, status, external_link, created_at, updated_at
       FROM public.products
      ORDER BY created_at DESC`,
  );
}

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-brand-bytes/20 text-green-ink border-brand-bytes/30',
  draft: 'bg-brand-primary/20 text-saffron-ink border-brand-primary/30',
  archived: 'bg-ink/10 text-muted border-hairline-strong',
};

export default async function ProductsManagementPage() {
  const products = await getAllProducts();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Products</h1>
          <p className="mt-1 text-sm text-muted">{products.length} total items</p>
        </div>
        <Link
          href="/admin/products/new"
          className="rounded-xl bg-brand-primary px-5 py-2.5 text-sm font-bold text-[#1c1814] shadow-lg shadow-brand-primary/20 transition hover:brightness-110"
        >
          + New Product
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        {products.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted">No products yet.</p>
            <Link href="/admin/products/new" className="mt-4 inline-block text-sm font-bold text-saffron-ink hover:underline">
              Add your first product →
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-[10px] font-bold uppercase tracking-widest text-muted">
                  <th className="px-6 py-4 text-left">Product</th>
                  <th className="px-4 py-4 text-left">Category</th>
                  <th className="px-4 py-4 text-left">Price</th>
                  <th className="px-4 py-4 text-left">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline-faint">
                {products.map((product) => (
                  <tr key={product.id} className="group transition hover:bg-sand">
                    <td className="px-6 py-4">
                      <span className="font-medium text-ink transition line-clamp-1 group-hover:text-saffron-ink">
                        {product.title}
                      </span>
                      <span className="mt-0.5 block font-mono text-[11px] text-muted">/{product.slug}</span>
                    </td>
                    <td className="px-4 py-4 text-xs text-muted">{product.category || '—'}</td>
                    <td className="px-4 py-4 text-xs font-semibold text-ink">
                      {formatPrice(product.price_paise, product.currency)}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[product.status] || STATUS_BADGE.draft}`}
                      >
                        {product.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {/* Draft products are viewable only at /products/[slug]/preview, which
                            is the launch preview: the real page, exactly as a
                            customer will see it, but noindex and unpublished. */}
                        <Link
                          href={`/products/${product.slug}${product.status === 'active' ? '' : '/preview'}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-bold text-body hover:text-saffron-ink hover:underline"
                        >
                          {product.status === 'active' ? 'View' : 'Preview'}
                        </Link>
                        <Link href={`/admin/products/${product.id}/edit`} className="text-xs font-bold text-saffron-ink hover:underline">
                          Edit
                        </Link>
                        <DeleteProductButton id={product.id} title={product.title} />
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
