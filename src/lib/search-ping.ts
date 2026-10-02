// SERVER ONLY. Tells search engines that something changed.
//
// WHAT IS ACTUALLY POSSIBLE, because the answer is not symmetric and the
// asymmetry is the whole design:
//
//   Bing, Yandex   IndexNow. Push a URL, crawled within minutes. No OAuth, no
//                  service account, no quota worth worrying about. See
//                  src/lib/indexnow.ts — fully automated already.
//
//   Google         NO general-purpose "index this URL" API exists. The
//                  Indexing API is restricted to two schema types (JobPosting
//                  and BroadcastEvent) and Google states plainly that using it
//                  for anything else will not work. For ordinary pages the only
//                  levers are: keep the sitemap accurate, resubmit it when it
//                  changes, and use "Request Indexing" MANUALLY in the Search
//                  Console UI.
//
// So "programmatically nudge Google" has a narrow true answer and a wide false
// one. The true part is implemented below. Anything promising more — services
// that claim instant Google indexing via API — is either using the JobPosting
// loophole on non-job pages (which does nothing) or lying.
//
// URL Inspection (admin/analytics/seo/url-inspection-actions.ts) is READ-ONLY:
// it answers "is this indexed right now", it does not ask for indexing. Easy to
// mistake for a nudge; it is a thermometer, not a heater.

import { google } from 'googleapis';
import { siteConfig } from '@/config/site';

const KEY_ENV = 'GCP_SERVICE_ACCOUNT_KEY';

function credentials(): Record<string, unknown> | null {
  const raw = process.env[KEY_ENV];
  if (!raw) return null;
  try {
    // Accept either raw JSON or base64, since deployment platforms differ on
    // whether they tolerate newlines in an environment variable.
    const json = raw.trim().startsWith('{')
      ? raw
      : Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (err) {
    console.error(`[search-ping] ${KEY_ENV} is set but is not valid JSON or base64 JSON`, err);
    return null;
  }
}

/**
 * Resubmit the sitemap to Search Console.
 *
 * This does NOT request indexing of anything. It tells Google the sitemap
 * changed, which moves the recrawl decision forward — the difference between
 * "we will notice within a week" and "we will look now".
 *
 * NOTE THE SCOPE. The reporting client elsewhere uses `webmasters.readonly`,
 * which cannot submit. This needs read-write `webmasters`, and the service
 * account must hold at least Full permission on the property in Search Console
 * (Settings -> Users and permissions). A readonly service account fails here
 * with a 403 that reads like an auth bug rather than a missing scope.
 */
export async function resubmitSitemap(): Promise<{ ok: boolean; detail: string }> {
  const creds = credentials();
  if (!creds) return { ok: false, detail: `${KEY_ENV} is not configured` };

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/webmasters'],
    });
    const gsc = google.searchconsole({ version: 'v1', auth });
    const feedpath = `${siteConfig.url}/sitemap.xml`;

    // The GSC property is a Domain property (sc-domain:...), not the www URL;
    // addressing it by URL fails with "insufficient permission".
    const siteUrl = process.env.GSC_SITE_URL ?? `sc-domain:${new URL(siteConfig.url).hostname.replace(/^www\./, '')}`;
    await gsc.sitemaps.submit({ siteUrl, feedpath });
    return { ok: true, detail: `resubmitted ${feedpath}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[search-ping] sitemap resubmission failed:', msg);
    return { ok: false, detail: msg };
  }
}

/**
 * Ask Google to crawl a job posting, via the Indexing API.
 *
 * This is the ONE case where a real per-URL nudge to Google is available, and
 * it is available because job listings go stale fast — a role that closed
 * should stop appearing in results quickly.
 *
 * Three conditions, all easy to miss:
 *   1. The page must carry JobPosting structured data. Without it the call
 *      succeeds and achieves nothing.
 *   2. The service account needs the `indexing` scope AND must be added as an
 *      OWNER of the property in Search Console — a stricter grant than the
 *      reporting client's.
 *   3. `URL_DELETED` should be sent when a role closes. Skipping it leaves the
 *      posting in results after it is gone, which is worse than never having
 *      submitted it.
 */
export async function pingJobPosting(
  path: string,
  type: 'URL_UPDATED' | 'URL_DELETED' = 'URL_UPDATED',
): Promise<{ ok: boolean; detail: string }> {
  const creds = credentials();
  if (!creds) return { ok: false, detail: `${KEY_ENV} is not configured` };

  const url = path.startsWith('http') ? path : `${siteConfig.url}${path}`;
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/indexing'],
    });
    const indexing = google.indexing({ version: 'v3', auth });
    await indexing.urlNotifications.publish({ requestBody: { url, type } });
    return { ok: true, detail: `${type} ${url}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[search-ping] indexing API failed:', msg);
    return { ok: false, detail: msg };
  }
}

/**
 * The one call a publish path should make.
 *
 * Fire-and-forget by construction: every branch catches, so a slow or
 * misconfigured search API can never block or fail the publish that triggered
 * it. Publishing content matters; telling Google about it is best-effort.
 *
 * `isJobPosting` exists because the Indexing API silently does nothing for
 * pages without JobPosting markup — so calling it for a blog post would look
 * like it worked while achieving nothing at all.
 */
export async function onContentPublished(opts: {
  paths: string[];
  isJobPosting?: boolean;
  deleted?: boolean;
}): Promise<void> {
  const { paths, isJobPosting = false, deleted = false } = opts;
  if (paths.length === 0) return;

  try {
    const { pingIndexNow } = await import('@/lib/indexnow');
    // Bing and Yandex take any URL. Always worth doing; costs nothing.
    void pingIndexNow(paths);

    // Google, for the one type it accepts.
    if (isJobPosting) {
      for (const p of paths) {
        void pingJobPosting(p, deleted ? 'URL_DELETED' : 'URL_UPDATED');
      }
    }

    // And nudge the sitemap so Google re-reads the inventory. Not per-URL, but
    // it is the only general lever there is.
    void resubmitSitemap();
  } catch (err) {
    console.error('[search-ping] onContentPublished failed (ignored):', err);
  }
}
