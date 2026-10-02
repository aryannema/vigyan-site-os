import type { Metadata } from 'next';
import LandingView from '../LandingView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Page preview',
  robots: { index: false, follow: false },
};

export default async function LandingPreviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <LandingView slug={slug} preview />;
}
