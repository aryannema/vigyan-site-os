// SERVER ONLY. Fires on every blog-post transition INTO status='published',
// from any of its real call sites: the cron job (scheduled -> published,
// src/app/api/cron/publish-scheduled/route.ts), the admin UI's direct publish
// paths (src/app/(app)/admin/blog/actions.ts), and the MCP route's
// create_blog_post/update_blog_post when status is set to published
// (src/app/api/mcp/route.ts). Centralized here because the n8n webhook
// previously only fired from the cron path -- a direct admin-UI publish or an
// MCP-driven publish never notified n8n at all. One function, several call
// sites, instead of three drifting copies.
//
// STRICTLY fire-and-forget -- see docs/LINK_BUILDER_AND_CAMPAIGNS.md. Never
// throws (every internal step is individually try/caught), so a short-link
// creation failure or a slow/unreachable n8n webhook can never block or fail
// an actual blog publish. Callers must not `await` this inline in a way that
// delays their own response -- fire it and move on; this app runs as a
// persistent Node process (`next start` under Coolify, not Vercel serverless),
// so an un-awaited promise keeps running in the background rather than being
// frozen the instant a response is sent.

import { supabaseAdmin } from '@/lib/supabase';
import { siteConfig } from '@/config/site';
import { pingIndexNow } from '@/lib/indexnow';

export interface PublishedPostInfo {
  id: string;
  slug: string;
  title: string;
  seo_description?: string | null;
  published_at?: string | null;
}

/**
 * Ensures a `platform: 'blog'` short link exists for this post, tagged with a
 * stable per-post campaign (`blog-<slug>`) that every platform-specific link
 * created later (via the create_short_link MCP tool) should reuse — see
 * docs/LINK_BUILDER_AND_CAMPAIGNS.md for the convention this sets up.
 * Idempotent: looks up an existing row by (target_url, platform) first, so
 * re-publishing the same post (e.g. cron promoting it, then an admin edit)
 * never creates a duplicate.
 */
async function ensureShortLink(post: PublishedPostInfo): Promise<string | null> {
  const targetUrl = `${siteConfig.url}/blog/${post.slug}`;
  try {
    const { data: existing } = await supabaseAdmin
      .from('link_shortener')
      .select('slug')
      .eq('target_url', targetUrl)
      .eq('platform', 'blog')
      .maybeSingle();
    if (existing) return `${siteConfig.url}/go/${existing.slug}`;

    const linkSlug = `blog-${post.slug}`.slice(0, 80);
    const { data: created, error } = await supabaseAdmin
      .from('link_shortener')
      .insert({
        slug: linkSlug,
        target_url: targetUrl,
        platform: 'blog',
        utm_campaign: `blog-${post.slug}`,
        offer_type: 'free',
        status: 'active',
      })
      .select('slug')
      .single();

    if (error) {
      // Most likely a unique-slug collision from a racing publish path (e.g.
      // cron and an admin edit landing at nearly the same time) — not a real
      // failure, some row for this post already exists or now does.
      console.error('[blog-publish-hooks] short link creation failed for', post.slug, error);
      return null;
    }
    return `${siteConfig.url}/go/${created.slug}`;
  } catch (err) {
    console.error('[blog-publish-hooks] ensureShortLink threw for', post.slug, err);
    return null;
  }
}

async function postToN8n(post: PublishedPostInfo, shortUrl: string | null): Promise<void> {
  const webhookUrl = process.env.N8N_BLOG_PUBLISHED_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'blog_post_published',
        id: post.id,
        slug: post.slug,
        title: post.title,
        seo_description: post.seo_description ?? null,
        url: `${siteConfig.url}/blog/${post.slug}`,
        short_url: shortUrl,
        published_at: post.published_at ?? new Date().toISOString(),
      }),
    });
  } catch (err) {
    // Best-effort, same as the original inline cron webhook POST: the post is
    // already published regardless of whether n8n heard about it.
    console.error('[blog-publish-hooks] n8n webhook failed for', post.slug, err);
  }
}

export async function onBlogPostPublished(post: PublishedPostInfo): Promise<void> {
  try {
    const shortUrl = await ensureShortLink(post);
    await postToN8n(post, shortUrl);
    // Bing + Yandex only (Google doesn't consume IndexNow) — ping both the
    // new/updated post and the index page it now appears on.
    void pingIndexNow([`/blog/${post.slug}`, '/blog']);
    // Google takes no per-URL request for ordinary pages; resubmitting the
    // sitemap is the only general lever there is. See lib/search-ping.ts.
    void import('@/lib/search-ping').then((m) => m.resubmitSitemap());
  } catch (err) {
    // Unreachable in practice (both helpers already catch internally) — kept
    // as a last-resort guard so this truly never throws into a caller that
    // may not itself be wrapped in try/catch.
    console.error('[blog-publish-hooks] onBlogPostPublished failed for', post.slug, err);
  }
}
