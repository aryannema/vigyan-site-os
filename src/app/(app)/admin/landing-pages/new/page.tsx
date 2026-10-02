import { query } from '../../lib/db';
import { PageHeader } from '../../components/PageHeader';
import { createLandingPage } from '../actions';
import { LandingPageForm, type MenuOptions, type ProductOption } from '../LandingPageForm';

export const dynamic = 'force-dynamic';

export default async function NewLandingPage() {
  const products = await query<ProductOption>(
    `SELECT id, title, status, price_paise FROM public.products ORDER BY status, title`,
  );
  const tops = await query<{ id: string; label: string }>(
    `SELECT id, label FROM public.nav_items WHERE parent_id IS NULL ORDER BY position`,
  );
  const menu: MenuOptions = { parents: tops, current: null };
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="New landing page"
        description="Built without a deploy. Live at /services/your-slug the moment you publish."
        breadcrumbs={[{ label: 'CMS' }, { label: 'Landing pages', href: '/admin/landing-pages' }, { label: 'New' }]}
      />
      <LandingPageForm action={createLandingPage} submitLabel="Create page" products={products} menu={menu} />
    </div>
  );
}
