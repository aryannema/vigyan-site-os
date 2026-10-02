import type { Metadata } from 'next';
import { getLandingPage, listPublishedLandingSlugs, landingPagePath } from '@/lib/landing-pages';
import LandingView from './LandingView';

// Cached; content-revalidation purges it the moment an admin publishes or edits.
export const revalidate = 60;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return (await listPublishedLandingSlugs()).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getLandingPage(slug, false);
  if (!page) return { title: 'Not found' };
  const title = page.seo_title || page.title;
  const description = page.seo_description || page.subtitle || undefined;
  return {
    title,
    description,
    alternates: { canonical: landingPagePath(page.slug) },
    openGraph: { title, description, type: 'website', images: page.og_image_url ? [page.og_image_url] : undefined },
  };
}

export default async function LandingPageRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <LandingView slug={slug} preview={false} />;
}
