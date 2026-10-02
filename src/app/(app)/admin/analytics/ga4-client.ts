import { BetaAnalyticsDataClient } from '@google-analytics/data';

/**
 * Single source of truth for constructing the GA4 Data API client, shared by
 * the historical-report page (page.tsx) and the realtime poller
 * (realtime/route.ts) -- previously duplicated inline in page.tsx.
 *
 * fallback:true forces REST/HTTP1.1 transport -- the default gRPC transport
 * fails inside Next.js's bundled server code (see docs/VIGYAN_SECRETS.md).
 *
 * Returns null (never throws) if the env vars aren't set, matching the
 * existing "GA4 not configured" empty-state pattern -- callers should treat
 * null the same way getAnalyticsData() already does.
 */
export function getGa4Client(): { client: BetaAnalyticsDataClient; propertyId: string } | null {
  const propertyId = process.env.GA4_PROPERTY_ID;
  const serviceAccountKey = process.env.GCP_SERVICE_ACCOUNT_KEY;
  if (!propertyId || !serviceAccountKey) return null;

  try {
    const credentials = JSON.parse(serviceAccountKey);
    const client = new BetaAnalyticsDataClient({ credentials, fallback: true });
    return { client, propertyId };
  } catch {
    return null;
  }
}
