import { MetadataRoute } from 'next';
import { siteConfig } from '@/config/site';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * The sitemap is how a new URL gets discovered in hours instead of weeks.
 *
 * This file used to list ten static routes and nothing else. `/blog` was in it;
 * the posts were not — so ten published articles existed that Google could only
 * reach by crawling links from the index, and only on whatever schedule it
 * happened to choose. The same was true of every product and job opening.
 *
 * So it is now async and queries the database. Anything published appears in
 * the sitemap on the next fetch, which means a new product page is discoverable
 * the day it ships rather than the week after.
 *
 * `lastModified` matters as much as the URL. It is the only signal that tells a
 * crawler a page it already knows has CHANGED and is worth re-reading. A
 * sitemap that stamps `new Date()` on every entry — as this one did — tells
 * crawlers everything changed every time, which quickly teaches them to ignore
 * the field. Real timestamps, from the rows themselves.
 *
 * A failed query returns the static routes rather than throwing. A sitemap that
 * 500s is worse than a short one: crawlers back off from a URL that errors.
 */

// None of these tables carries an updated_at, so lastModified is the best
// available publication timestamp rather than a true modification time. If an
// updated_at is ever added, prefer it here — a real modification time is what
// makes a crawler re-read a page it already has.
/**
 * Re-query hourly instead of freezing at build time.
 *
 * Next prerenders sitemap.xml as a static route by default. With a database
 * query in it that is a trap: the sitemap is generated once during `next build`
 * and then never again, so a post published after the deploy is absent from the
 * sitemap until somebody happens to rebuild — which for a blog is exactly
 * backwards, since new content is what most needs discovering.
 *
 * An hour is the balance. Short enough that a new post is in the sitemap before
 * a crawler is likely to ask, long enough that the three queries below run at
 * most 24 times a day no matter how often the file is fetched.
 */
export const revalidate = 3600;

type Row = { slug: string; published_at?: string | null;
             posted_at?: string | null; created_at?: string | null };

const when = (r: Row) =>
  r.published_at ?? r.posted_at ?? r.created_at ?? new Date().toISOString();

async function rows(
  table: string,
  columns: string,
  filter?: { column: string; value: string },
): Promise<Row[]> {
  try {
    let q = supabaseAdmin.from(table).select(columns);
    if (filter) q = q.eq(filter.column, filter.value);
    const { data, error } = await q;
    if (error) {
      // Log it. A silent [] here is how a section vanishes from the sitemap
      // with nothing to notice — including, once, because this file selected a
      // column the table did not have.
      console.error(`[sitemap] ${table} query failed:`, error.message);
      return [];
    }
    return (data ?? []) as unknown as Row[];
  } catch (err) {
    console.error(`[sitemap] ${table} threw:`, err);
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date().toISOString();

  // Kept in step with what is actually linked and actually indexable. Three
  // rules, each of which this list has broken at least once:
  //
  //   a URL here must return 200          — a 404 in a sitemap is read as a
  //                                         quality signal about the whole file
  //   a URL here must not be noindex      — asking a crawler to fetch a page you
  //                                         have told it not to index wastes the
  //                                         request and contradicts itself
  //   a page linked in the footer belongs — /refund-policy and /sample-product
  //   here                                  were reachable by users and invisible
  //                                         to crawlers
  const staticRoutes = [
    '',
    '/services',
    '/about',
    '/blog',
    '/templates',        // the product catalogue; /products has no index page
    '/sample-product',    // renders a waitlist until the flag is on — always 200
    '/contact',
    '/careers',
    '/privacy',
    '/terms',
    '/refund-policy',
    '/data-deletion',
    // '/voice' is deliberately absent while it is a stub carrying noindex
    // (seeded in migration 076). Add it back in the same change that removes
    // the noindex, so the two never disagree.
  ].map((route) => ({
    url: `${siteConfig.url}${route}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority:
      route === ''
        ? 1
        : ['/privacy', '/terms', '/refund-policy', '/data-deletion'].includes(route)
          ? 0.3
          : 0.8,
  }));

  // Queried in parallel: three round trips in sequence would put the slowest of
  // them on the critical path of every sitemap request.
  const [posts, products, jobs, landings] = await Promise.all([
    rows('posts', 'slug, published_at, created_at', { column: 'status', value: 'published' }),
    rows('products', 'slug, created_at', { column: 'status', value: 'active' }),
    rows('job_openings', 'slug, posted_at, created_at', { column: 'status', value: 'open' }),
    rows('landing_pages', 'slug, published_at, created_at', { column: 'status', value: 'published' }),
  ]);

  return [
    ...staticRoutes,


    // Articles are the pages most worth crawling often: they are the ones that
    // answer a search query directly, and the ones that get edited after
    // publication.
    ...posts.map((p) => ({
      url: `${siteConfig.url}/blog/${p.slug}`,
      lastModified: when(p),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),

    ...products.map((p) => ({
      url: `${siteConfig.url}/products/${p.slug}`,
      lastModified: when(p),
      changeFrequency: 'weekly' as const,
      priority: 0.9, // a page that can be bought from outranks one that cannot
    })),

    // Admin-built landing pages under /services/<slug>.
    ...landings.map((l) => ({
      url: `${siteConfig.url}/services/${l.slug}`,
      lastModified: when(l),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),

    // Roles close. A daily changeFrequency asks crawlers to notice quickly,
    // which matters in both directions — listing and de-listing.
    ...jobs.map((j) => ({
      url: `${siteConfig.url}/careers/${j.slug}`,
      lastModified: when(j),
      changeFrequency: 'daily' as const,
      priority: 0.6,
    })),
  ];
}
