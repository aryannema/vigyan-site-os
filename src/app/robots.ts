import { MetadataRoute } from 'next';
import { siteConfig } from '@/config/site';

/**
 * robots.txt says what a crawler MAY fetch. It is not an index of the site —
 * that is sitemap.xml's job, and listing public routes here would add nothing a
 * crawler cannot already discover while making the file harder to keep true.
 *
 * So this file only needs to get two things right: keep crawlers out of pages
 * that are private, useless or duplicative, and point at the sitemap.
 *
 * The disallow list below is the one that was missing. `/admin/` and `/api/`
 * were covered; the authenticated and transactional routes were not, so
 * /account, /complete-profile and the auth pages were all crawlable. None of
 * them render anything useful to a logged-out crawler — they redirect or show a
 * login — and every one of them spends crawl budget that should go to content.
 *
 * A note on what this does NOT do: robots.txt controls CRAWLING, not INDEXING.
 * A URL that is disallowed here can still appear in results if something links
 * to it, because the crawler obeys the rule and indexes the URL without the
 * page. To keep something out of the index, let it be crawled and serve
 * `noindex` — or, as here, do both only where the page genuinely must not be
 * fetched.
 */
export default function robots(): MetadataRoute.Robots {
  const disallow = [
    // Admin and machine surfaces.
    '/admin/',
    '/api/',
    '/auth/',

    // Authenticated pages. A crawler sees a redirect or a login form.
    '/account',
    '/account/',
    '/complete-profile',
    '/login',
    '/pending-approval',

    // The short-link redirector. These are campaign URLs that resolve to
    // canonical pages already in the sitemap; indexing them would put a
    // tracking URL in results instead of the real one.
    '/go/',

    // Draft previews render unpublished content, and a crawler that finds
    // one would index a draft.
    '/products/*/preview',

    // Query-string duplicates of pages already listed canonically. Without
    // this, one article shared with five different campaign tags looks like
    // five pages competing with each other.
    '/*?utm_',
    '/*?ref=',
  ];

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow,
      },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}
