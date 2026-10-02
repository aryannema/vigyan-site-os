import { Activity, Eye, Gauge, Megaphone, Globe2 } from 'lucide-react';

import { StatTile } from '@/components/ui/stat-tile';
import { BarList } from '@/components/ui/bar-list';
import { LineChart } from '@/components/ui/line-chart';
import { CountryMap, type CountryMapDatum } from '@/components/ui/country-map';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

import { PageHeader } from '../components/PageHeader';
import { query } from '../lib/db';
import { getGa4Client } from './ga4-client';
import { LiveVisitorsWidget } from './LiveVisitorsWidget';

export const dynamic = 'force-dynamic';

interface MetricRow {
  name: string;
  sessions: string;
  pageviews: string;
}

interface BreakdownRow {
  label: string;
  sessions: string;
}

/**
 * One row per utm_campaign, combining GA4's post-click view (sessions,
 * engagement rate, pageviews) with our own pre-click view (clicks, from
 * link_clicks via the link_shortener rows sharing this campaign name) --
 * neither system shows this funnel alone. See docs/LINK_BUILDER_AND_CAMPAIGNS.md
 * for the utm_campaign convention this depends on: every platform-specific
 * short link for the same content reuses one campaign name.
 */
interface CampaignRow {
  campaign: string;
  sessions: number;
  engagementRate: number; // 0-1
  pageviews: number;
  clicks: number;
  offerType: string | null;
}

interface AnalyticsData {
  sessionsTotal: number;
  pageviewsTotal: number;
  engagementRate: number; // 0-1
  /** Daily session counts across the whole selected range, oldest first. */
  dailySeries: Array<{ label: string; value: number }>;
  topPages: MetricRow[];
  topSourceMedium: BreakdownRow[];
  topCampaigns: CampaignRow[];
  topCountries: CountryMapDatum[];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29); // 30-day window inclusive
  return { from: isoDate(from), to: isoDate(to) };
}

/** GA4 returns dates as YYYYMMDD with no separators -- reformat for chart x-axis labels. */
function formatGaDate(yyyymmdd: string): string {
  if (!/^\d{8}$/.test(yyyymmdd)) return yyyymmdd;
  const d = new Date(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

async function getAnalyticsData(from: string, to: string): Promise<AnalyticsData | null> {
  const ga4 = getGa4Client();
  if (!ga4) return null;
  const { client, propertyId } = ga4;

  try {
    const dateRanges = [{ startDate: from, endDate: to }];

    const [totalsReport, dailyReport, pagesReport, sourceMediumReport, campaignReport, countryReport] = await Promise.all([
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges,
        metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }, { name: 'engagementRate' }],
      }),
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges,
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      }),
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges,
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 8,
      }),
      // sessionSourceMedium ("google / organic", "facebook / cpc", etc.) is
      // the real UTM-driven attribution dimension -- richer than plain
      // sessionSource alone, which collapses medium (organic vs paid vs
      // referral) into one bucket per source.
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges,
        dimensions: [{ name: 'sessionSourceMedium' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 8,
      }),
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges,
        dimensions: [{ name: 'sessionCampaignName' }],
        metrics: [{ name: 'sessions' }, { name: 'engagementRate' }, { name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 8,
      }),
      // countryId is ISO alpha-2 ("IN") -- see src/lib/geo/country-codes.ts
      // for the crosswalk to world-atlas's ISO-numeric feature ids, verified
      // live against this exact dimension before CountryMap was built.
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges,
        dimensions: [{ name: 'country' }, { name: 'countryId' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 20,
      }),
    ]);

    const totalsRow = totalsReport[0]?.rows?.[0];
    const sessionsTotal = parseInt(totalsRow?.metricValues?.[0]?.value ?? '0');
    const pageviewsTotal = parseInt(totalsRow?.metricValues?.[1]?.value ?? '0');
    const engagementRate = parseFloat(totalsRow?.metricValues?.[2]?.value ?? '0');

    const dailySeries = (dailyReport[0]?.rows ?? []).map((row) => ({
      label: formatGaDate(row.dimensionValues?.[0]?.value ?? ''),
      value: parseInt(row.metricValues?.[0]?.value ?? '0'),
    }));

    const topPages: MetricRow[] = (pagesReport[0]?.rows ?? []).map((row) => ({
      name: row.dimensionValues?.[0]?.value ?? '/',
      sessions: row.metricValues?.[0]?.value ?? '0',
      pageviews: row.metricValues?.[1]?.value ?? '0',
    }));

    const topSourceMedium: BreakdownRow[] = (sourceMediumReport[0]?.rows ?? []).map((row) => ({
      label: row.dimensionValues?.[0]?.value ?? '(direct) / (none)',
      sessions: row.metricValues?.[0]?.value ?? '0',
    }));

    const gaCampaigns = (campaignReport[0]?.rows ?? [])
      .filter((row) => row.dimensionValues?.[0]?.value !== '(not set)')
      .map((row) => ({
        campaign: row.dimensionValues?.[0]?.value ?? '(not set)',
        sessions: parseInt(row.metricValues?.[0]?.value ?? '0'),
        engagementRate: parseFloat(row.metricValues?.[1]?.value ?? '0'),
        pageviews: parseInt(row.metricValues?.[2]?.value ?? '0'),
      }));

    const clicksByCampaign = await getClicksByCampaign();
    const clickMap = new Map(clicksByCampaign.map((row) => [row.utm_campaign, row]));

    // Union of both sides: a campaign might have GA4 sessions but no clicks
    // logged yet (e.g. direct traffic tagged manually), or clicks but no GA4
    // sessions yet (a link just created, not clicked through to a session).
    const campaignNames = new Set<string>([
      ...gaCampaigns.map((c) => c.campaign),
      ...clicksByCampaign.map((c) => c.utm_campaign),
    ]);

    const topCampaigns: CampaignRow[] = Array.from(campaignNames)
      .map((campaign) => {
        const ga = gaCampaigns.find((c) => c.campaign === campaign);
        const clicks = clickMap.get(campaign);
        return {
          campaign,
          sessions: ga?.sessions ?? 0,
          engagementRate: ga?.engagementRate ?? 0,
          pageviews: ga?.pageviews ?? 0,
          clicks: clicks?.clicks ?? 0,
          offerType: clicks?.offer_type ?? null,
        };
      })
      .sort((a, b) => b.sessions + b.clicks - (a.sessions + a.clicks))
      .slice(0, 10);

    const topCountries: CountryMapDatum[] = (countryReport[0]?.rows ?? [])
      .filter((row) => row.dimensionValues?.[1]?.value && row.dimensionValues[1].value !== '(not set)')
      .map((row) => ({
        label: row.dimensionValues?.[0]?.value ?? 'Unknown',
        alpha2: row.dimensionValues?.[1]?.value ?? '',
        value: parseInt(row.metricValues?.[0]?.value ?? '0'),
      }));

    return {
      sessionsTotal,
      pageviewsTotal,
      engagementRate,
      dailySeries,
      topPages,
      topSourceMedium,
      topCampaigns,
      topCountries,
    };
  } catch {
    return null;
  }
}

interface CampaignClicks {
  utm_campaign: string;
  clicks: number;
  offer_type: string | null;
}

async function getClicksByCampaign(): Promise<CampaignClicks[]> {
  try {
    return await query<CampaignClicks>(
      `SELECT l.utm_campaign,
              COUNT(c.id)::int AS clicks,
              (array_agg(l.offer_type ORDER BY l.created_at))[1] AS offer_type
         FROM public.link_shortener l
         LEFT JOIN public.link_clicks c ON c.link_id = l.id
        WHERE l.utm_campaign IS NOT NULL
        GROUP BY l.utm_campaign`,
    );
  } catch {
    // link_shortener may not exist yet in an older DB, or the admin pool may
    // be unavailable in this render context -- degrade to GA4-only campaigns
    // rather than breaking the whole analytics page over this one join.
    return [];
  }
}

function formatNumber(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const defaults = defaultRange();
  const from = params.from || defaults.from;
  const to = params.to || defaults.to;

  const data = await getAnalyticsData(from, to);

  const rangeLabel = `${new Date(`${from}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })} – ${new Date(`${to}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;

  const dateForm = (
    <form action="/admin/analytics" className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="from" className="text-xs">From</Label>
        <Input id="from" name="from" type="date" defaultValue={from} max={to} className="w-40" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="to" className="text-xs">To</Label>
        <Input id="to" name="to" type="date" defaultValue={to} max={defaults.to} className="w-40" />
      </div>
      <Button type="submit" size="sm">Apply</Button>
      <div className="flex gap-1.5 pb-0.5">
        {[7, 30, 90].map((days) => {
          const rangeTo = new Date();
          const rangeFrom = new Date(rangeTo);
          rangeFrom.setDate(rangeFrom.getDate() - (days - 1));
          return (
            <a
              key={days}
              href={`/admin/analytics?from=${isoDate(rangeFrom)}&to=${isoDate(rangeTo)}`}
              className="rounded-md border border-hairline px-2.5 py-1.5 text-xs text-muted transition hover:bg-sand hover:text-ink"
            >
              {days}d
            </a>
          );
        })}
      </div>
    </form>
  );

  if (!data) {
    return (
      <div className="mx-auto max-w-5xl space-y-8">
        <PageHeader
          title="Analytics"
          description="Google Analytics 4"
          breadcrumbs={[{ label: 'Insights' }, { label: 'Analytics' }]}
        />
        <div className="rounded-2xl border border-hairline bg-surface p-12 text-center">
          <p className="mb-2 font-bold text-ink">GA4 not configured</p>
          <p className="text-sm text-muted">
            Add <code className="font-mono text-saffron-ink">GA4_PROPERTY_ID</code> and{' '}
            <code className="font-mono text-saffron-ink">GCP_SERVICE_ACCOUNT_KEY</code> to your environment variables to enable analytics.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="Analytics"
        description={`Google Analytics 4 — ${rangeLabel}`}
        breadcrumbs={[{ label: 'Insights' }, { label: 'Analytics' }]}
      />

      <LiveVisitorsWidget />

      <Card>
        <CardContent>{dateForm}</CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Sessions" value={formatNumber(data.sessionsTotal)} icon={Activity} accent="saffron" />
        <StatTile label="Pageviews" value={formatNumber(data.pageviewsTotal)} icon={Eye} accent="green" />
        <StatTile label="Engagement rate" value={`${Math.round(data.engagementRate * 100)}%`} icon={Gauge} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Sessions over time
          </CardTitle>
        </CardHeader>
        <CardContent>
          <LineChart points={data.dailySeries} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted">
              <Globe2 className="h-3 w-3" /> Sessions by country
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CountryMap data={data.topCountries} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted">
              Top Countries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BarList
              items={data.topCountries.slice(0, 8).map((row) => ({ label: row.label, value: row.value }))}
              valueFormatter={(v) => `${v.toLocaleString()} sessions`}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted">
              Top Pages
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BarList
              items={data.topPages.map((page) => ({ label: page.name, value: parseInt(page.sessions) }))}
              valueFormatter={(v) => `${v.toLocaleString()} sessions`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted">
              Traffic Sources (source / medium)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BarList
              items={data.topSourceMedium.map((row) => ({ label: row.label, value: parseInt(row.sessions) }))}
              valueFormatter={(v) => `${v.toLocaleString()} sessions`}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted">
            <Megaphone className="h-3 w-3" /> Campaigns (UTM)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.topCampaigns.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-[10px] font-bold uppercase tracking-widest text-muted">
                    <th className="px-2 py-2 text-left">Campaign</th>
                    <th className="px-2 py-2 text-left">Offer</th>
                    <th className="px-2 py-2 text-right">Clicks</th>
                    <th className="px-2 py-2 text-right">Sessions</th>
                    <th className="px-2 py-2 text-right">Engagement</th>
                    <th className="px-2 py-2 text-right">Pageviews</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {data.topCampaigns.map((row) => (
                    <tr key={row.campaign}>
                      <td className="px-2 py-3 font-medium text-ink">{row.campaign}</td>
                      <td className="px-2 py-3 text-xs text-muted">
                        {row.offerType ? row.offerType.replace('_', ' ') : '—'}
                      </td>
                      <td className="px-2 py-3 text-right text-ink">{row.clicks.toLocaleString()}</td>
                      <td className="px-2 py-3 text-right text-ink">{row.sessions.toLocaleString()}</td>
                      <td className="px-2 py-3 text-right text-muted">
                        {row.sessions > 0 ? `${Math.round(row.engagementRate * 100)}%` : '—'}
                      </td>
                      <td className="px-2 py-3 text-right text-muted">{row.pageviews.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted">
              No campaign activity yet — links created in{' '}
              <a href="/admin/links" className="text-saffron-ink hover:underline">Link Builder</a> and sessions
              arriving with <code className="rounded bg-sand px-1">utm_campaign</code> tags will show up here.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
