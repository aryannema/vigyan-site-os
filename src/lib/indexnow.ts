// SERVER ONLY. Pushes "this URL changed" pings to IndexNow — the protocol
// Bing and Yandex both consume to crawl a changed/new URL almost immediately,
// instead of waiting for their next scheduled crawl. Google does not
// participate in IndexNow; for Google, GSC's own "Request Indexing" (manual)
// or sitemap resubmission (see src/lib/search-console.ts, once wired) remain
// the only levers. Full context: docs/OPS_SEO.md.
//
// No OAuth, no service account — auth is just "does the key file below
// resolve on our own domain", which is why this needs zero secrets. The key
// itself is meant to be public (it's served as a plain .txt file), so it is
// safe to hardcode rather than pull from an env var.
//
// STRICTLY fire-and-forget, same convention as onBlogPostPublished() in
// blog-publish-hooks.ts: never throws, so a slow/unreachable IndexNow
// endpoint can never block or fail the actual content publish it's reporting.

import { siteConfig } from '@/config/site';

const INDEXNOW_KEY = '6cee0ce64faf27eae2fc68b7f11edc5d';
const INDEXNOW_KEY_LOCATION = `${siteConfig.url}/${INDEXNOW_KEY}.txt`;

// api.indexnow.org fans out to every participating engine (currently Bing and
// Yandex) from one call — no need to POST to bing.com/indexnow and
// yandex.com/indexnow separately.
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

export type IndexNowResult = { ok: boolean; status: number; detail: string; count: number };

/** Submit URLs to IndexNow and report the engine's answer. Never throws. */
export async function submitIndexNow(urls: string[]): Promise<IndexNowResult> {
  const urlList = urls.filter(Boolean).map((u) => (u.startsWith('http') ? u : `${siteConfig.url}${u}`));
  if (urlList.length === 0) return { ok: false, status: 0, detail: 'no URLs', count: 0 };
  try {
    const host = new URL(siteConfig.url).host;
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation: INDEXNOW_KEY_LOCATION, urlList }),
      signal: AbortSignal.timeout(15000),
    });
    // 200/202 accepted; 400/403/422/429 rejected.
    const detail = res.ok ? 'accepted' : await res.text().catch(() => '');
    if (!res.ok) console.error('[indexnow] rejected', res.status, detail);
    return { ok: res.ok, status: res.status, detail, count: urlList.length };
  } catch (err) {
    console.error('[indexnow] request failed for', urlList, err);
    return { ok: false, status: 0, detail: String(err), count: urlList.length };
  }
}

/** Fire-and-forget variant used by publish hooks. */
export async function pingIndexNow(urls: string[]): Promise<void> {
  await submitIndexNow(urls);
}
