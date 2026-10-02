import { notFound } from 'next/navigation';

import { query } from '../../../lib/db';
import { PageHeader } from '../../../components/PageHeader';
import { updateLandingPage } from '../../actions';
import { LandingPageForm, type LandingFormPage, type MenuOptions, type ProductOption } from '../../LandingPageForm';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditLandingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const [pages, products, tops, placed] = await Promise.all([
    query<LandingFormPage>(
      `SELECT id, slug, title, subtitle, body_blocks, seo_title, seo_description, og_image_url,
              product_id, cta_label, cta_url, status
         FROM public.landing_pages WHERE id = $1`,
      [id],
    ),
    query<ProductOption>(`SELECT id, title, status, price_paise FROM public.products ORDER BY status, title`),
    query<{ id: string; label: string }>(`SELECT id, label FROM public.nav_items WHERE parent_id IS NULL ORDER BY position`),
    query<{ parent_id: string | null; label: string }>(
      `SELECT parent_id, label FROM public.nav_items WHERE landing_page_id = $1 ORDER BY created_at LIMIT 1`,
      [id],
    ),
  ]);
  const menu: MenuOptions = {
    parents: tops,
    current: placed[0] ? { parent: placed[0].parent_id ?? '__top__', label: placed[0].label } : null,
  };
  const page = pages[0];
  if (!page) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Edit landing page"
        description={`/services/${page.slug}`}
        breadcrumbs={[{ label: 'CMS' }, { label: 'Landing pages', href: '/admin/landing-pages' }, { label: 'Edit' }]}
      />
      <LandingPageForm page={page} products={products} menu={menu} action={updateLandingPage.bind(null, id)} submitLabel="Save changes" />
    </div>
  );
}
