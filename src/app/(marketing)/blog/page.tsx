import type { Metadata } from 'next';
import CTASection from '@/components/site/CTASection';
import Eyebrow from '@/components/site/Eyebrow';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { BlogPost } from '@/lib/blog-schema';
import { getSectionContent } from '@/lib/getContent';
import { TextContent } from '@/lib/content-schema';

// Blog index: must pick up a new post quickly.
export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Blog',
  description: 'News, guides and updates from the YourSite team.',
  alternates: { canonical: '/blog' },
};

async function getPosts(): Promise<BlogPost[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('posts')
      .select('id, title, slug, category, seo_description, published_at, created_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false });

    if (error || !data) return [];
    return data as BlogPost[];
  } catch (err) {
    console.error('Error fetching posts:', err);
    return [];
  }
}

export default async function BlogPage() {
  const posts = await getPosts();

  const headerTitle = await getSectionContent('blog-header-title', { text: "Insights & Architecture" } as TextContent);
  const headerSubtitle = await getSectionContent('blog-header-subtitle', { text: "News, guides and updates from the YourSite team." } as TextContent);

  return (
    <div>
      <section className="mx-auto w-full max-w-[1200px] px-6 pb-20 pt-16 md:pb-24 md:pt-20">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow dot={false} className="justify-center">The Journal</Eyebrow>
          <h1 className="mt-4 text-[clamp(2.5rem,5.5vw,3rem)] font-extrabold tracking-[-0.03em] text-ink">{headerTitle.text}</h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-body md:text-xl">{headerSubtitle.text}</p>
        </div>

        {posts.length > 0 ? (
          <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="vb-card vb-card-interactive vb-card-accent relative flex flex-col justify-between overflow-hidden p-8 pt-9"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center rounded-full border border-green-700/25 bg-green-700/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em] text-green-ink">
                      {post.category}
                    </span>
                    <span className="font-mono text-xs text-faint">
                      {post.published_at ? new Date(post.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Draft'}
                    </span>
                  </div>
                  <h2 className="text-xl font-bold leading-snug text-ink">{post.title}</h2>
                  <p className="line-clamp-3 text-sm leading-relaxed text-muted">{post.seo_description}</p>
                </div>
                <span className="mt-8 text-sm font-bold text-saffron-ink">Read article →</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="mt-14 rounded-feature border border-dashed border-hairline-strong bg-sand py-20 text-center">
            <p className="text-muted">No published posts found. Check back soon.</p>
          </div>
        )}
      </section>

      <CTASection />
    </div>
  );
}
