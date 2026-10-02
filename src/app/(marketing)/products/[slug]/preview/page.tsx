import type { Metadata } from 'next';
import ProductView from '../ProductView';

// Draft preview for the admin. Deliberately separate from the public product
// page: that one is cached and cannot read the query string, and a draft must
// never be cached or indexed.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Product preview',
  robots: { index: false, follow: false },
};

export default async function ProductPreviewPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return <ProductView slug={slug} preview />;
}
