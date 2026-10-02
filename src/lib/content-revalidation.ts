import { revalidatePath } from 'next/cache';
import { onContentPublished } from '@/lib/search-ping';
import { getSecret } from '@/lib/app-secrets';
import { siteConfig } from '@/config/site';
import { warmSitemap } from '@/lib/cache-warm';

/**
 * ONE PLACE THAT KNOWS WHAT A CONTENT CHANGE AFFECTS.
 *
 * Every write path — admin server actions, the MCP route, the scheduled
 * publish cron, the waitlist form — calls `revalidateFor()` and nothing else.
 * None of them decides which pages to refresh, because that decision was the
 * thing that kept going wrong:
 *
 *   - `admin/blog/actions.ts` revalidated `/blog` but never `/blog/<slug>`, so
 *     an edited post served the old body. The response was to mark every post
 *     page `force-dynamic` (see the comment in blog/[slug]/page.tsx), which
 *     fixed staleness by never caching anything again — and that is why
 *     Googlebot now gets `no-store` on every marketing page and Search Console
 *     reports "Discovered - currently not indexed".
 *   - The MCP route has eight handlers that change public content and calls
 *     `revalidatePath` in none of them. `force-dynamic` hid that completely.
 *
 * Both bugs are the same bug: the knowledge of "editing X makes pages Y and Z
 * wrong" lived in the caller, so every new caller had to rediscover it and
 * some never did. Here it lives in one table, and a new write path gets it
 * right by calling one function.
 *
 * NOT A BASE CLASS, deliberately. What varies between content types is *data*
 * — which paths are affected — not behaviour. Inheritance would give every
 * caller a class to extend and an override to forget; a registry gives them a
 * key to pass, and a missing key is a type error at compile time rather than a
 * silently stale page in production.
 */

/** Kinds of change a caller can report. Adding one here forces adding its
 *  affected paths below — that is the point of the exhaustive Record. */
export type ContentKind =
  | 'blog_post'
  | 'product'
  | 'job'
  | 'section'
  | 'waitlist'
  | 'feature_flag'
  | 'landing_page'
  | 'nav';

/**
 * Generated routes that go stale whenever the inventory changes. Kept separate
 * because they are easy to forget and expensive to get wrong: a sitemap that
 * still lists a deleted URL is a 404 in a sitemap, which Google reads as a
 * quality signal about the whole file.
 */
const GENERATED = ['/sitemap.xml', '/llms.txt'];

/**
 * What each kind of change invalidates.
 *
 * `slug` is optional because a caller may be reporting a change with no single
 * subject — a bulk import, or a section edit that touches several pages.
 *
 * Only PUBLIC paths belong here. Admin screens are `force-dynamic` by design
 * (they are behind auth and carry noindex) and never need revalidating.
 */
const AFFECTED: Record<ContentKind, (slug?: string) => string[]> = {
  // A post appears on its own page, on the index, and in the homepage's
  // recent-posts carousel.
  blog_post: (slug) => ['/blog', '/', ...(slug ? [`/blog/${slug}`] : []), ...GENERATED],

  // /templates is the catalogue; /products has no index page of its own.
  product: (slug) => ['/templates', ...(slug ? [`/products/${slug}`] : []), ...GENERATED],

  job: (slug) => ['/careers', ...(slug ? [`/careers/${slug}`] : []), ...GENERATED],

  // site_content drives copy AND per-page SEO metadata (lib/page-seo.ts), so a
  // section edit can change the <title> of a page that does not obviously
  // belong to that section. Refresh the lot rather than guess.
  section: () => [
    '/', '/about', '/services', '/contact', '/blog', '/careers',
    '/templates', '/voice', '/sample-product',
    '/privacy', '/terms', '/refund-policy', '/data-deletion',
    ...GENERATED,
  ],

  // A signup changes no public page. Present so the waitlist route has a
  // legitimate key to call rather than being the one write path that skips
  // this module — and so search engines are not pinged for it, which would be
  // noise.
  waitlist: () => [],

  // Flags are read in the layout itself (whatsapp_live gates the FAB on every
  // page), so nothing narrower than the whole tree is correct. See
  // `revalidateFor` for how this one is special-cased.
  feature_flag: () => [],

  // A landing page lives at /services/<slug> and is listed in the sitemap.
  landing_page: (slug) => ['/services', ...(slug ? [`/services/${slug}`] : []), ...GENERATED],

  // The header renders in the root layout on every page; handled like a flag.
  nav: () => [],
};

/** Changes that should also tell Bing, Yandex and Google's sitemap endpoint.
 *  A waitlist signup or a flag toggle publishes nothing, so pinging for them
 *  would train the engines to ignore us. */
const PINGS_SEARCH_ENGINES: ReadonlySet<ContentKind> = new Set<ContentKind>([
  'blog_post', 'product', 'job', 'section', 'landing_page',
]);

/**
 * Purge the same URLs from Cloudflare's edge.
 *
 * WHY THIS IS SEPARATE FROM revalidatePath. There are TWO caches and they do
 * not know about each other. `revalidatePath` refreshes what NEXT holds on the
 * origin; Cloudflare keeps its own copy for however long `s-maxage` said, and
 * nothing in Next can reach it. So without this, a change is live at the origin
 * and still stale at the edge for up to one full revalidate window.
 *
 * That is tolerable for a blog post and NOT tolerable for a price: a stale
 * price is wrong in Google's structured data and wrong to a buyer, which is a
 * trust problem rather than a cosmetic one.
 *
 * NO-OP WITHOUT CREDENTIALS, deliberately. The token and zone id are optional
 * secrets; when they are absent this returns quietly and the short revalidate
 * window remains the backstop. A missing purge must never fail the publish that
 * triggered it — the content is already saved by the time we get here.
 */
async function purgeCloudflare(paths: string[]): Promise<void> {
  try {
    const [token, zone] = await Promise.all([
      getSecret('CLOUDFLARE_CACHE_PURGE_TOKEN'),
      getSecret('CLOUDFLARE_ZONE_ID'),
    ]);
    if (!token || !zone) return;

    // Cloudflare purges by absolute URL, and it treats the apex and www as
    // different cache entries. siteConfig.url is www, which is what Google has
    // settled on as canonical, so that is the one that matters.
    const urls = paths.map((p) => `${siteConfig.url}${p}`);

    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: urls }),
      // A hung CDN call must not hold a publish open.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error('[revalidate] Cloudflare purge failed:', res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.error('[revalidate] Cloudflare purge threw (ignored):', err);
  }
}

/** Whole-zone purge. Used only for a layout-level change, where naming
 *  individual URLs would be both long and wrong the next time a page is added. */
async function purgeCloudflareEverything(): Promise<void> {
  try {
    const [token, zone] = await Promise.all([
      getSecret('CLOUDFLARE_CACHE_PURGE_TOKEN'),
      getSecret('CLOUDFLARE_ZONE_ID'),
    ]);
    if (!token || !zone) return;
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ purge_everything: true }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error('[revalidate] CF purge_everything failed:', res.status);
  } catch (err) {
    console.error('[revalidate] CF purge_everything threw (ignored):', err);
  }
}

/**
 * Fetch each URL once from its public address so the origin renders it and
 * Cloudflare stores the result BEFORE any search engine is told about it.
 * Without this, the first crawler to arrive pays for the render and may hit a
 * page that was just purged. Best-effort: failures never block the publish.
 */
async function warmUrls(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map(async (p) => {
      try {
        await fetch(`${siteConfig.url}${p}`, {
          headers: { 'User-Agent': 'site-cache-warmer' },
          signal: AbortSignal.timeout(15000),
        });
      } catch (err) {
        console.error(`[revalidate] warm ${p} failed (ignored):`, err);
      }
    }),
  );
}

export type RevalidateOpts = {
  kind: ContentKind;
  /** The subject's slug, where there is one. */
  slug?: string;
  /** True when the content was removed — search engines are told URL_DELETED
   *  rather than URL_UPDATED, and the paths are still refreshed so the sitemap
   *  stops listing it. */
  deleted?: boolean;
};

/**
 * Refresh our own caches, then tell the search engines.
 *
 * Fire-and-forget by construction, matching `onContentPublished`: every branch
 * catches. Publishing content matters; refreshing a cache and notifying Google
 * are both best-effort, and neither may take down the write that triggered it.
 *
 * Returns the paths it revalidated so callers and tests can assert on them.
 */
export function revalidateFor({ kind, slug, deleted = false }: RevalidateOpts): string[] {
  let paths: string[] = [];

  try {
    // A flag read in the root layout affects every page beneath it. Next's
    // 'layout' mode invalidates the whole subtree in one call, which is both
    // correct and cheaper than listing 16 paths that would drift from reality
    // the next time a page is added.
    if (kind === 'feature_flag' || kind === 'nav') {
      revalidatePath('/', 'layout');
      // The flag gates the WhatsApp FAB on every page, so every page's edge
      // copy is now wrong. purge_everything is the honest call here; listing 16
      // URLs would drift the next time a page is added.
      void purgeCloudflareEverything()
        .then(() => warmSitemap())
        .catch((err) => console.error('[revalidate] warm after purge failed:', err));
      return ['/ (layout)'];
    }

    paths = AFFECTED[kind](slug);
    for (const p of paths) {
      try {
        revalidatePath(p);
      } catch (err) {
        // One bad path must not stop the rest. A typo'd slug should leave the
        // index page refreshed, not leave everything stale.
        console.error(`[revalidate] ${kind}: revalidatePath(${p}) failed:`, err);
      }
    }
  } catch (err) {
    console.error(`[revalidate] ${kind} failed:`, err);
    return paths;
  }

  // Order matters: purge the stale edge copy, render the fresh page once so the
  // edge holds it, and only THEN tell the search engines. Each step is
  // best-effort and the whole chain is fire-and-forget.
  const publicPaths = paths.filter((p) => !GENERATED.includes(p));
  const pings = PINGS_SEARCH_ENGINES.has(kind) && publicPaths.length > 0;

  if (paths.length > 0 || pings) {
    void (async () => {
      if (paths.length > 0) await purgeCloudflare(paths);
      if (!deleted && publicPaths.length > 0) await warmUrls([...publicPaths, ...GENERATED]);
      if (pings) {
        await onContentPublished({
          paths: publicPaths,
          isJobPosting: kind === 'job',
          deleted,
        });
      }
    })().catch((err) => console.error(`[revalidate] ${kind} follow-up failed:`, err));
  }

  return paths;
}
