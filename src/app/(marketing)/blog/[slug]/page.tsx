import type { Metadata } from "next";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";
import { siteConfig } from "@/config/site";
// The renderer moved from src/components/blog/BlockRenderer (which interpolated
// every field as a raw string, so a post written with **bold** rendered four
// literal asterisks) to src/lib/content/renderer, which parses the restricted
// inline-Markdown subset through FormattedText. This is the SAME component the
// admin editor's live preview uses, so what an author sees while writing is
// what this page renders — if they diverged, the two would drift into
// incompatible content shapes. See src/lib/content/FORMAT.md.
import { BlockRenderer } from "@/lib/content/renderer";
import { normalizeLegacyBlocks } from "@/lib/content/legacy";
import { BlogPost } from "@/lib/blog-schema";
import { notFound } from "next/navigation";
import CommentSection from "@/components/blog/CommentSection";
import { StructuredData } from "@/components/seo/StructuredData";

// This page was `force-dynamic` because posts were never revalidated per-slug
// when edited -- only `/blog`, the index -- and were caught serving a stale
// response in production (2026-08-15/16 blog 404 incident). The note here said
// it was cheaper to render fresh forever than to add "per-slug revalidatePath
// calls to every write path".
//
// That work is now done, in one place instead of every write path:
// lib/content-revalidation.ts owns which paths a change affects, and every
// caller -- admin server actions, all eight MCP handlers, the publish cron --
// passes a kind and a slug. Deletes read the slug BEFORE deleting so the
// vanished URL is refreshed too, which is the case the original approach could
// not have handled at all.
//
// So the staleness that justified force-dynamic is addressed at its cause,
// and the page can be cached -- which it must be, because force-dynamic here
// meant `no-store` on every blog post and Google has never crawled a single
// one of them.
export const revalidate = 300;

/**
 * Prerender every published post at build time.
 *
 * Without this, Next cannot know the slugs ahead of time, so it treats the
 * route as fully dynamic and emits `no-store` even with `revalidate` set --
 * which is exactly the state that left Google reporting "URL is unknown to
 * Google" for all ten posts. With it, each post is real static HTML from the
 * first request, revalidated every 5 minutes and on demand by
 * revalidateFor({ kind: 'blog_post' }).
 *
 * dynamicParams stays at its default (true) so a post published AFTER the
 * build still renders on first request rather than 404ing -- it is simply
 * rendered on demand and then cached, instead of being prebuilt.
 */
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('posts')
      .select('slug')
      .eq('status', 'published');
    if (error) {
      // Never fail the build over this. An empty list means posts render on
      // demand and cache on first hit -- slower for the first visitor, but a
      // deploy that cannot happen is worse than one that warms lazily.
      console.error('[blog/[slug]] generateStaticParams failed:', error.message);
      return [];
    }
    return (data ?? []).map((p: { slug: string }) => ({ slug: p.slug }));
  } catch (err) {
    console.error('[blog/[slug]] generateStaticParams threw:', err);
    return [];
  }
}

async function getPost(slug: string): Promise<BlogPost | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('posts')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .single();

    if (error || !data) return null;
    return data as BlogPost;
  } catch (err) {
    console.error(`Error fetching post ${slug}:`, err);
    return null;
  }
}

/**
 * Every post used to inherit the root layout's metadata, which meant all ten
 * published articles served the HOMEPAGE title, description and og:url. To a
 * crawler they were ten pages claiming to be the same page — which is a good
 * way to have none of them rank.
 *
 * Four things matter here and each fixes a distinct failure:
 *
 *   title        what appears as the clickable line in a result
 *   description  the snippet beneath it; if absent the engine invents one from
 *                the page, usually badly
 *   canonical    the definitive URL for this content. Without it, the same post
 *                reachable with a tracking parameter, or on the apex instead of
 *                www, competes with itself
 *   openGraph    what a link looks like when shared — and increasingly what an
 *                AI search result quotes
 *
 * `openGraph.type: 'article'` with publishedTime is not decoration: it is how a
 * crawler tells an article from a landing page, and it is what makes a date
 * appear beside the result.
 */
export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);

  // A 404 must not advertise itself. Without noindex, a deleted post keeps its
  // place in the index and serves a "not found" page to whoever clicks it.
  if (!post) {
    return { title: "Post not found", robots: { index: false, follow: false } };
  }

  const url = `${siteConfig.url}/blog/${post.slug}`;

  // Prefer what the author wrote. Fall back to the opening of the post rather
  // than to the site description, which would put identical text on every page
  // and recreate the problem this function exists to fix.
  const description =
    post.seo_description?.trim() ||
    blocksToText(post.content_blocks).slice(0, 155).trim() ||
    undefined;

  const image = post.featured_image || siteConfig.branding.logo.og;

  return {
    title: post.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: post.title,
      description,
      url,
      siteName: siteConfig.name,
      publishedTime: post.published_at ?? post.created_at ?? undefined,
      ...(post.category ? { section: post.category } : {}),
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

/**
 * First readable prose from the block content, for a description fallback.
 * Deliberately shallow: this runs on every request for every post, and a
 * thorough walk of arbitrarily nested blocks is not worth the latency when the
 * answer is only ever the first ~155 characters.
 */
function blocksToText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const out: string[] = [];
  for (const b of blocks) {
    if (out.join(" ").length > 200) break;
    if (typeof b === "string") { out.push(b); continue; }
    if (b && typeof b === "object") {
      const v = (b as Record<string, unknown>).text ?? (b as Record<string, unknown>).content;
      if (typeof v === "string") out.push(v);
    }
  }
  return out.join(" ").replace(/\s+/g, " ").replace(/[*_`#]/g, "");
}


export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  
  if (!post) {
    notFound();
  }

  return (
    <article className="mx-auto max-w-[760px] space-y-8 px-6 py-16">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Link href="/blog" className="text-sm font-bold text-saffron-ink underline-offset-4 hover:underline">
            ← Back to Blog
          </Link>
          <span className="text-hairline-strong" aria-hidden="true">/</span>
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-green-ink">
            {post.category}
          </span>
        </div>
        <h1 className="text-[clamp(2.25rem,5vw,3rem)] font-extrabold tracking-[-0.03em] text-ink">
          {post.title}
        </h1>
        <div className="flex items-center gap-3 font-mono text-sm text-muted">
          <span>{post.published_at ? new Date(post.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Draft'}</span>
          <span aria-hidden="true">·</span>
          <span>YourSite Team</span>
        </div>
      </div>

      <div className="prose max-w-none vb-prose-clearfix
          prose-headings:text-ink prose-headings:font-bold prose-headings:tracking-[-0.02em]
          prose-p:text-body prose-p:leading-relaxed
          prose-a:text-saffron-ink prose-a:no-underline hover:prose-a:underline
          prose-strong:text-ink prose-li:text-body">
        {/* normalizeLegacyBlocks repairs rows written by the older Notion sync
            and blog webhook (level-1 headings, images with no alt) which the
            strict schema would otherwise drop silently. */}
        <BlockRenderer blocks={normalizeLegacyBlocks(post.content_blocks)} />
      </div>

      <div className="mt-12 border-t border-hairline pt-8">
        <h3 className="mb-4 font-bold text-ink">Share this insight</h3>
        <span className="text-xs italic text-muted">Social sharing integrated via Postiz automation roadmap.</span>
      </div>

      <CommentSection postId={post.id} />

      {/* Blog posts were the only content type emitting no structured data:
          products declare Product, job openings declare JobPosting, the root
          layout declares Organization. The pages most likely to answer a search
          query directly were the ones declaring nothing at all.

          See lib/structured-data.ts for why this is a registry keyed by content
          type rather than markup written into each page — a new type
          (blueprint, service, whatever comes next) is one entry there, not an
          edit to every page that renders it. */}
      <StructuredData
        kind="blog_post"
        entity={{
          path: `/blog/${post.slug}`,
          title: post.title,
          description: post.seo_description,
          publishedAt: post.published_at ?? post.created_at,
          category: post.category,
        }}
      />
    </article>
  );
}
