// SERVER ONLY. Wraps the Search Console URL Inspection API
// (urlInspection.index.inspect) -- the one live, per-URL "is this actually
// indexed right now" check, as opposed to searchanalytics.query's aggregate
// click/impression reports. Called on-demand from admin/analytics/seo's page
// (a query param, not polled/looped) since Search Console rate-limits this
// endpoint per property; never call it in a loop over many URLs.

import { siteConfig } from '@/config/site';
import { getSearchConsoleClient } from '../search-console-client';

export interface UrlInspectionResult {
  verdict?: string;
  coverageState?: string | null;
  lastCrawlTime?: string | null;
  robotsTxtState?: string | null;
  indexingState?: string | null;
  error?: string;
}

export async function inspectUrl(path: string): Promise<UrlInspectionResult> {
  const gsc = getSearchConsoleClient();
  if (!gsc) return { error: 'Search Console not configured.' };

  const inspectionUrl = path.startsWith('http') ? path : `${siteConfig.url}${path.startsWith('/') ? path : `/${path}`}`;

  try {
    const res = await gsc.client.urlInspection.index.inspect({
      requestBody: { inspectionUrl, siteUrl: gsc.siteUrl },
    });
    const result = res.data.inspectionResult?.indexStatusResult;
    if (!result) return { error: 'No inspection result returned.' };
    return {
      verdict: result.verdict ?? undefined,
      coverageState: result.coverageState,
      lastCrawlTime: result.lastCrawlTime,
      robotsTxtState: result.robotsTxtState,
      indexingState: result.indexingState,
    };
  } catch (err) {
    console.error('[admin/seo] inspectUrl failed for', inspectionUrl, err);
    return { error: 'Inspection request failed — check the path and try again.' };
  }
}
