import Link from 'next/link';

import { query } from '../../lib/db';
import { createLink } from '../actions';
import { LinkForm } from '../LinkForm';

export const dynamic = 'force-dynamic';

export default async function NewLinkPage() {
  const products = await query<{ slug: string }>(
    `SELECT slug FROM public.products WHERE status = 'active'`,
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border-b border-hairline pb-6">
        <Link
          href="/admin/links"
          className="mb-2 inline-block text-xs text-muted transition hover:text-saffron-ink"
        >
          ← All Links
        </Link>
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink">Create Link</h1>
        <p className="mt-1 text-sm text-faint">
          UTM params are appended at redirect time, so you can fix a typo later without a new slug.
        </p>
      </div>

      <LinkForm action={createLink} submitLabel="Create link" productSlugs={products.map((p) => p.slug)} />
    </div>
  );
}
