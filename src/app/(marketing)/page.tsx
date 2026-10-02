import type { Metadata } from 'next';
import HomeExperience, { HomeContent } from '@/components/site/HomeExperience';
import { siteConfig } from '@/config/site';
import { getSectionContent } from '@/lib/getContent';
import { supabaseAdmin } from '@/lib/supabase';
import { BlogPost } from '@/lib/blog-schema';
import { BRAND_LABEL } from '@/lib/brand';
import { isFeatureEnabled } from '@/lib/feature-flags';

// Homepage: hero copy and the recent-posts carousel.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: { absolute: `${siteConfig.name} — ${siteConfig.tagline}` },
  description: siteConfig.description,
  alternates: { canonical: '/' },
};

async function getRecentPosts(): Promise<BlogPost[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('posts')
      .select('id, title, slug, category, seo_description, published_at, created_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(8);
    if (error || !data) return [];
    return data as BlogPost[];
  } catch (err) {
    console.error('Error fetching posts for homepage carousel:', err);
    return [];
  }
}

export default async function SiteHomePage() {
  // Every block below reads the CMS (page sections, editable in admin or via
  // the site MCP) and falls back to this placeholder copy when a key is empty.

  // --- Hero ---
  const heroTagline = await getSectionContent('home-hero-tagline', { text: BRAND_LABEL });
  const heroHeading = await getSectionContent('home-hero-heading', { text: 'Your tagline', highlight: 'goes here.' });
  const heroDescription = await getSectionContent('home-hero-description', { text: 'One or two sentences on what you offer, who it is for, and why it is different.' });
  const heroPrimary = await getSectionContent('home-hero-cta-primary', { label: 'Get in touch', link: '/contact' });
  // The secondary CTA points at the waitlist product page only while its
  // feature flag is on; otherwise at Services. Flip at /admin/settings.
  const productLive = await isFeatureEnabled('sample_product_live');
  const heroSecondary = productLive
    ? await getSectionContent('home-hero-cta-secondary', { label: 'See Sample Product', link: '/sample-product' })
    : { label: 'See our services', link: '/services' };

  // --- Three blocks: Products · Services · How we work ---
  const productHeading = await getSectionContent('home-product-heading', { text: 'Products, services, and one way of working' });
  const productSubtitle = await getSectionContent('home-product-subtitle', { text: 'Replace this line with a short subtitle.' });
  const productCards = await getSectionContent('home-product-cards', {
    items: [
      {
        title: 'Products',
        blurb: 'A product you sell once — a download, a template or a tool.',
        items: 'One-off purchase · instant delivery · invoice included',
        href: productLive ? '/sample-product' : '/templates',
      },
      {
        title: 'Services',
        blurb: 'The work you do for clients, in a sentence.',
        items: 'Sample service one · sample service two · sample service three',
        href: '/services',
      },
      {
        title: 'How we work',
        blurb: 'The promise behind everything you deliver.',
        items: 'Clear scope · fixed milestones · honest reporting',
        href: '/about',
      },
    ],
  });

  // --- Platform (dark section) ---
  const platformEyebrow = await getSectionContent('home-platform-eyebrow', { text: 'Our approach' });
  const platformHeading = await getSectionContent('home-platform-heading', { text: 'A headline for\nyour second section.' });
  const platformDescription = await getSectionContent('home-platform-description', { text: 'Describe the platform, method or capability that sets you apart.' });
  const platformPrimary = await getSectionContent('home-platform-cta-primary', { label: 'Explore our services', link: '/services' });
  const platformSecondary = await getSectionContent('home-platform-cta-secondary', { label: 'Get in touch', link: '/contact' });
  const platformCards = await getSectionContent('home-platform-cards', {
    items: [
      { title: 'Feature one', description: 'A short line about the first feature.' },
      { title: 'Feature two', description: 'A short line about the second feature.' },
      { title: 'Feature three', description: 'A short line about the third feature.' },
      { title: 'Feature four', description: 'A short line about the fourth feature.' },
    ],
  });

  // --- Proof strip ---
  const researchEyebrow = await getSectionContent('home-research-eyebrow', { text: 'By the numbers' });
  const researchHeading = await getSectionContent('home-research-heading', { text: 'Numbers we hold ourselves to' });
  const researchMetrics = await getSectionContent('home-research-metrics', {
    items: [
      { value: '10+', label: 'years of experience' },
      { value: '100', label: 'projects delivered' },
      { value: '24h', label: 'first response time' },
      { value: '3', label: 'countries served' },
    ],
  });
  const researchLineage = await getSectionContent('home-research-lineage', { text: '' });

  // --- Journal / Blog carousel (only rendered when posts exist) ---
  const posts = await getRecentPosts();
  const journalEyebrow = await getSectionContent('home-journal-eyebrow', { text: 'The Journal' });
  const journalHeading = await getSectionContent('home-journal-heading', { text: 'Latest from the blog' });

  // --- Philosophy ---
  const philoEyebrow = await getSectionContent('home-philosophy-eyebrow', { text: 'Philosophy' });
  const philoDeva = await getSectionContent('home-philosophy-deva', { text: '' });
  const philoTitle = await getSectionContent('home-philosophy-title', { text: ' — a line about what you believe.', highlight: 'Your motto' });
  const philoBody = await getSectionContent('home-philosophy-body', { text: 'A short paragraph on the values behind the business. Edit it in admin.' });
  const philoCta = await getSectionContent('home-philosophy-cta', { label: 'Read our story', link: '/about' });

  // --- Closing CTA ---
  const ctaTitle = await getSectionContent('home-cta-title', { text: 'Ready to get started?' });
  const ctaDescription = await getSectionContent('home-cta-description', { text: 'Tell us what you need and we will reply within a day.' });
  const ctaPrimary = await getSectionContent('home-cta-primary', { label: 'Get in touch', link: '/contact' });
  const ctaSecondary = productLive
    ? await getSectionContent('home-cta-secondary', { label: 'See Sample Product', link: '/sample-product' })
    : { label: 'See our services', link: '/services' };

  const content: HomeContent = {
    hero: {
      tagline: heroTagline.text,
      headingText: heroHeading.text,
      headingHighlight: heroHeading.highlight || '',
      lead: heroDescription.text,
      primary: heroPrimary,
      secondary: heroSecondary,
    },
    product: {
      eyebrow: 'What we offer',
      heading: productHeading.text,
      subtitle: productSubtitle.text,
      cards: productCards.items,
    },
    platform: {
      eyebrow: platformEyebrow.text,
      heading: platformHeading.text,
      description: platformDescription.text,
      primary: platformPrimary,
      secondary: platformSecondary,
      cards: platformCards.items,
    },
    research: {
      eyebrow: researchEyebrow.text,
      heading: researchHeading.text,
      metrics: researchMetrics.items,
      lineage: researchLineage.text,
    },
    journal: {
      eyebrow: journalEyebrow.text,
      heading: journalHeading.text,
      posts: posts.map((p) => ({
        slug: p.slug,
        title: p.title,
        category: p.category,
        excerpt: p.seo_description || '',
        date: p.published_at
          ? new Date(p.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
          : '',
      })),
    },
    philosophy: {
      eyebrow: philoEyebrow.text,
      deva: philoDeva.text,
      title: philoTitle.text,
      titleHighlight: philoTitle.highlight || '',
      body: philoBody.text,
      cta: philoCta,
    },
    cta: {
      title: ctaTitle.text,
      description: ctaDescription.text,
      primary: ctaPrimary,
      secondary: ctaSecondary,
    },
  };

  return <HomeExperience content={content} />;
}
