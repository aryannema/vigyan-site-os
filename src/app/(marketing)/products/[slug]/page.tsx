import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase';
import ProductView, { getProduct } from './ProductView';

// Cacheable: revalidated on publish via revalidateFor({ kind: 'product' }).
// Price and availability changes go through the admin write path, which
// invalidates this page by slug. See lib/content-revalidation.ts.
// PRICE AND OFFER DATES live on this page. A stale price is wrong in Google's
// structured data and wrong to a buyer -- a trust problem, not a cosmetic one.
// 60s is the backstop for when a write path forgets to call revalidateFor();
// the normal case is that revalidateFor + the Cloudflare purge make it instant.
export const revalidate = 60;

/**
 * Prerender every active product.
 *
 * Without this Next cannot know the slugs, treats the route as fully dynamic,
 * and emits `no-store` no matter what `revalidate` says -- exactly the trap
 * that left all ten blog posts uncrawled. A product page that cannot be cached
 * also cannot be crawled, and an uncrawled product page cannot be found.
 *
 * dynamicParams stays at its default so a product activated AFTER the build
 * still renders on first request and caches from then on.
 */
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('slug')
      .eq('status', 'active');
    if (error) {
      console.error('[products/[slug]] generateStaticParams failed:', error.message);
      return [];
    }
    return (data ?? []).map((p: { slug: string }) => ({ slug: p.slug }));
  } catch (err) {
    console.error('[products/[slug]] generateStaticParams threw:', err);
    return [];
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug, false);
  if (!product) return { title: 'Not found' };

  return {
    title: product.title,
    description: product.description?.slice(0, 160) ?? undefined,
    alternates: { canonical: `/products/${product.slug}` },
  };
}

/**
 * The public product page.
 *
 * It must NOT read `searchParams`. Reading it is a dynamic API: on a route that
 * is cached (revalidate + generateStaticParams) Next throws DYNAMIC_SERVER_USAGE
 * and every product page returns a 500. Drafts therefore live at
 * /products/[slug]/preview, which is always dynamic and always noindex.
 */
export default async function ProductPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return <ProductView slug={slug} preview={false} />;
}
