import Link from 'next/link';

import { createProduct } from '../actions';
import SchemaForm from '@/components/forms/SchemaForm';
import { PRODUCT_FORM } from '@/lib/form-schema';

export const dynamic = 'force-dynamic';

export default function NewProductPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border-b border-hairline pb-6">
        <Link
          href="/admin/products"
          className="mb-2 inline-block text-xs text-muted transition hover:text-saffron-ink"
        >
          ← All Products
        </Link>
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink">Add Product</h1>
        <p className="mt-1 text-sm text-faint">
          New products default to draft — set status to active once ready for checkout.
        </p>
      </div>

      {/* Schema-driven: the fields, copy and validation rules come from
          PRODUCT_FORM in src/lib/form-schema.ts, and the SAME rules array is
          re-run server-side. Adding a field is an edit to that definition. */}
      <SchemaForm
        schema={PRODUCT_FORM}
        initial={{
          status: 'draft',
          category: 'saas',
          price_rupees: '0',
          fulfilment_kind: 'none',
        }}
        action={createProduct}
        submitLabel="Create product"
      />
    </div>
  );
}
