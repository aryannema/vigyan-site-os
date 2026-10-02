import Link from 'next/link';

import { query } from '../../lib/db';
import { CampaignBuilder, type BuilderLanding, type BuilderProduct } from './CampaignBuilder';

export const dynamic = 'force-dynamic';

export default async function CampaignBuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;
  const products = await query<BuilderProduct>(
    `SELECT id, slug, title, price_paise FROM public.products WHERE status = 'active' ORDER BY title`,
  );

  const landings = await query<BuilderLanding>(
    `SELECT slug, title, product_id FROM public.landing_pages WHERE status = 'published' ORDER BY title`,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="border-b border-hairline pb-6">
        <Link href="/admin/links" className="mb-2 inline-block text-xs text-muted transition hover:text-saffron-ink">
          ← All Links
        </Link>
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink">Campaign Builder</h1>
        <p className="mt-1 max-w-2xl text-sm text-faint">
          Pick what you are promoting and where you will post it. One tracked link per platform is created together,
          so every click and order traces back to the exact place it came from.
        </p>
      </div>
      <CampaignBuilder products={products} landings={landings} initialLanding={page ?? null} />
    </div>
  );
}
