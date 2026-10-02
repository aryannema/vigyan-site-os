import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { ShortLink } from '@/lib/links-schema';

import { query } from '../../../lib/db';
import { updateLink } from '../../actions';
import { LinkForm } from '../../LinkForm';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditLinkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const [links, products] = await Promise.all([
    query<ShortLink>(`SELECT * FROM public.link_shortener WHERE id = $1`, [id]),
    query<{ slug: string }>(`SELECT slug FROM public.products WHERE status = 'active'`),
  ]);

  const link = links[0];
  if (!link) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border-b border-hairline pb-6">
        <Link
          href="/admin/links"
          className="mb-2 inline-block text-xs text-muted transition hover:text-saffron-ink"
        >
          ← All Links
        </Link>
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink">Edit Link</h1>
        <p className="mt-1 font-mono text-sm text-faint">/go/{link.slug}</p>
      </div>

      <LinkForm
        link={link}
        action={updateLink.bind(null, id)}
        submitLabel="Save changes"
        productSlugs={products.map((p) => p.slug)}
      />
    </div>
  );
}
