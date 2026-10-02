import { google, searchconsole_v1 } from 'googleapis';

/**
 * Search Console Data API client, built to the same pattern as ga4-client.ts:
 * reuses the SAME GCP service account and GCP_SERVICE_ACCOUNT_KEY as GA4
 * (see docs/VIGYAN_SECRETS.md) rather than provisioning a second one --
 * Search Console access is granted separately from GA4 access (Search
 * Console -> Settings -> Users and permissions -> add this same service
 * account's email), same two-layer model as GA4's Property Access
 * Management being separate from GCP IAM.
 *
 * Unlike @google-analytics/data's BetaAnalyticsDataClient, googleapis's
 * REST-based clients don't default to gRPC, so the fallback:true gotcha
 * documented in docs/VIGYAN_SECRETS.md doesn't apply here -- this uses
 * plain HTTP under the hood already.
 *
 * Returns null (never throws) if the env vars aren't set or the key can't
 * be parsed, matching getGa4Client()'s "not configured" empty-state
 * convention -- callers should treat null the same way.
 */
export function getSearchConsoleClient(): { client: searchconsole_v1.Searchconsole; siteUrl: string } | null {
  const siteUrl = process.env.GSC_SITE_URL;
  const serviceAccountKey = process.env.GCP_SERVICE_ACCOUNT_KEY;
  if (!siteUrl || !serviceAccountKey) return null;

  try {
    const credentials = JSON.parse(serviceAccountKey);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
    const client = google.searchconsole({ version: 'v1', auth });
    return { client, siteUrl };
  } catch {
    return null;
  }
}
