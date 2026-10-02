import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { Product } from '@/lib/products-schema';

import { query } from '../../../lib/db';
import { updateProduct } from '../../actions';
import SchemaForm from '@/components/forms/SchemaForm';
import { PRODUCT_FORM, paiseToRupees } from '@/lib/form-schema';
import { bpToPercent } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const products = await query<Product>(
    `SELECT id, slug, title, description, category, price_paise, currency, status, external_link,
            discount_bp, offer_ends_at, offer_label,
            fulfilment_kind, fulfilment_config, grants_entitlements, created_at, updated_at
       FROM public.products WHERE id = $1`,
    [id],
  );

  const product = products[0];
  if (!product) notFound();

  // Shown back as slugs, which is what the field accepts.
  const bundleItems = await query<{ slug: string }>(
    `SELECT p.slug FROM public.product_bundle_items b
       JOIN public.products p ON p.id = b.item_product_id
      WHERE b.bundle_product_id = $1 ORDER BY b.position`,
    [id],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border-b border-hairline pb-6">
        <Link
          href="/admin/products"
          className="mb-2 inline-block text-xs text-muted transition hover:text-saffron-ink"
        >
          ← All Products
        </Link>
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink">Edit Product</h1>
        <p className="mt-1 font-mono text-sm text-faint">/{product.slug}</p>
      </div>

      {/* Same PRODUCT_FORM definition as the create page, so the two can never
          drift apart. Price is held in paise in the DB and edited in rupees. */}
      <SchemaForm
        schema={PRODUCT_FORM}
        initial={{
          title: product.title,
          slug: product.slug,
          description: product.description ?? '',
          category: product.category ?? 'saas',
          price_rupees: paiseToRupees(product.price_paise ?? 0),
          status: product.status,
          external_link: product.external_link ?? '',
          discount_percent: product.discount_bp != null ? bpToPercent(product.discount_bp) : '',
          // datetime-local wants 'YYYY-MM-DDTHH:mm' in LOCAL time; an ISO string
          // with a Z would be rejected by the input and silently render blank.
          offer_ends_at: product.offer_ends_at
            ? new Date(product.offer_ends_at).toISOString().slice(0, 16)
            : '',
          offer_label: product.offer_label ?? '',
          fulfilment_kind: product.fulfilment_kind ?? 'none',
          fulfilment_url: product.fulfilment_config?.url ?? '',
          fulfilment_repo: product.fulfilment_config?.repo ?? '',
          fulfilment_tag: product.fulfilment_config?.tag ?? '',
          fulfilment_path: product.fulfilment_config?.path ?? '',
          fulfilment_notion_page_id: product.fulfilment_config?.notion_page_id ?? '',
          fulfilment_slug: product.fulfilment_config?.slug ?? '',
          grants_entitlements: (product.grants_entitlements ?? []).join(', '),
          bundle_items: bundleItems.map((b) => b.slug).join('\n'),
        }}
        action={updateProduct.bind(null, id)}
        submitLabel="Save changes"
      />
    </div>
  );
}
