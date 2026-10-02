import { siteConfig } from '@/config/site';

export type WarmReport = { total: number; html: number; failed: { url: string; reason: string }[] };

const CONCURRENCY = 4;

/** Absolute URLs listed in the live sitemap, restricted to our own origin. */
export async function getSitemapUrls(): Promise<string[]> {
  const res = await fetch(`${siteConfig.url}/sitemap.xml`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`sitemap.xml returned ${res.status}`);
  const xml = await res.text();
  const origin = new URL(siteConfig.url).origin;
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]).filter((u) => u.startsWith(origin));
}

/**
 * Request every URL in the live sitemap once so Cloudflare re-caches it after a
 * purge. Each response must be a 200 text/html page; anything else is reported.
 * Cloudflare caches per data centre: this fills the one the server reaches (and,
 * with Tiered Cache on, the upper tier every other location pulls from).
 */
export async function warmSitemap(): Promise<WarmReport> {
  const report: WarmReport = { total: 0, html: 0, failed: [] };
  let urls: string[];
  try {
    urls = await getSitemapUrls();
  } catch (err) {
    report.failed.push({ url: '/sitemap.xml', reason: String(err) });
    return report;
  }

  report.total = urls.length;
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'site-cache-warmer', Accept: 'text/html' },
          signal: AbortSignal.timeout(20000),
        });
        const type = res.headers.get('content-type') ?? '';
        await res.arrayBuffer();
        if (res.ok && type.includes('text/html')) report.html++;
        else report.failed.push({ url, reason: `${res.status} ${type}` });
      } catch (err) {
        report.failed.push({ url, reason: String(err) });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return report;
}
