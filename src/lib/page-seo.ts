import type { Metadata } from 'next';
import { getSectionContent } from '@/lib/getContent';
import { siteConfig } from '@/config/site';

/**
 * Page titles and descriptions, editable from the database.
 *
 * WHY THIS IS WORTH DOING. SEO copy is not write-once content — it is tuned
 * against Search Console data. A title that gets impressions but no clicks
 * needs rewording; a description Google keeps replacing with its own snippet
 * needs shortening. Hardcoded in a .tsx file, every one of those iterations is
 * a code change, a review and a deploy, so in practice it never happens and the
 * copy written on day one stays forever.
 *
 * WHY IT COSTS ALMOST NOTHING. `getSectionContent` goes through
 * `loadAllContent`, which already fetches EVERY site_content row in one query
 * and memoizes it per request with React's cache(). This adds no round trip —
 * the query is already happening for the page body, and the SEO row rides along
 * in the same result.
 *
 * WHY THE FALLBACK IS NOT OPTIONAL. An empty table, a missing row, or an
 * unreachable database must never strip a page's title and description — that
 * would turn a transient database problem into an SEO one that outlives it,
 * because a crawl that lands during the outage records the blank version. So
 * every call passes the hardcoded value it is replacing, and the database only
 * ever OVERRIDES.
 *
 * Content lives under one `page_seo` section rather than a row per page, so the
 * whole set is edited and versioned together in content_history — a title
 * change and the description change that goes with it land as one revision.
 *
 *   section_id: 'page_seo'
 *   content_data: {
 *     "/privacy": { "title": "…", "description": "…" },
 *     "/voice":   { "title": "…", "description": "…", "noindex": true }
 *   }
 */

export interface PageSeo {
  title?: string;
  description?: string;
  /** Keep a page out of the index without a deploy — useful for a WIP page. */
  noindex?: boolean;
  /** Override only when the canonical is not simply the path. */
  canonical?: string;
}

type SeoMap = Record<string, PageSeo>;

/**
 * Build a page's Metadata, preferring the database and falling back to what the
 * page already declared.
 *
 * `path` is the route as it appears in a URL ('/privacy'), and doubles as the
 * canonical unless one is given — an absolute canonical on every page is the
 * fix for apex/www and tracking-parameter duplicates.
 */
export async function pageMetadata(
  path: string,
  fallback: { title: string; description: string },
): Promise<Metadata> {
  // The cast is safe: getSectionContent returns whatever jsonb holds, and a
  // malformed row degrades to the fallback below rather than throwing.
  const all = (await getSectionContent('page_seo', {} as never)) as SeoMap;
  const seo = (all && typeof all === 'object' ? all[path] : undefined) ?? {};

  const title = seo.title?.trim() || fallback.title;
  const description = seo.description?.trim() || fallback.description;
  const canonical = seo.canonical?.trim() || `${siteConfig.url}${path}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      title,
      description,
      url: canonical,
      siteName: siteConfig.name,
    },
    ...(seo.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}
