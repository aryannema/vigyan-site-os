import { MousePointerClick, Eye, Percent, ArrowUpDown, Search } from 'lucide-react';
import type { searchconsole_v1 } from 'googleapis';

import { StatTile } from '@/components/ui/stat-tile';
import { BarList } from '@/components/ui/bar-list';
import { LineChart } from '@/components/ui/line-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

import { PageHeader } from '../../components/PageHeader';
import { getSearchConsoleClient } from '../search-console-client';
import { inspectUrl, type UrlInspectionResult } from './url-inspection-actions';

export const dynamic = 'force-dynamic';

interface QueryRow {
  label: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface SeoData {
  clicksTotal: number;
  impressionsTotal: number;
  ctrAvg: number;
  positionAvg: number;
  dailySeries: Array<{ label: string; value: number }>;
  topQueries: QueryRow[];
  topPages: QueryRow[];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  // GSC data typically lags 2-3 days behind real-time -- end the default
  // window there instead of "today", where it would just show zeros.
  const to = new Date();
  to.setDate(to.getDate() - 3);
  const from = new Date(to);
  from.setDate(from.getDate() - 27); // 28-day window inclusive, GSC's own default
  return { from: isoDate(from), to: isoDate(to) };
}

function toRows(rows: searchconsole_v1.Schema$ApiDataRow[] | undefined): QueryRow[] {
  return (rows ?? []).map((row) => ({
    label: row.keys?.[0] ?? '(unknown)',
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }));
}

async function getSeoData(from: string, to: string): Promise<SeoData | null> {
  const gsc = getSearchConsoleClient();
  if (!gsc) return null;
  const { client, siteUrl } = gsc;

  try {
    const [totalsRes, dailyRes, queriesRes, pagesRes] = await Promise.all([
      client.searchanalytics.query({
        siteUrl,
        requestBody: { startDate: from, endDate: to },
      }),
      client.searchanalytics.query({
        siteUrl,
        requestBody: { startDate: from, endDate: to, dimensions: ['date'] },
      }),
      client.searchanalytics.query({
        siteUrl,
        requestBody: { startDate: from, endDate: to, dimensions: ['query'], rowLimit: 10 },
      }),
      client.searchanalytics.query({
        siteUrl,
        requestBody: { startDate: from, endDate: to, dimensions: ['page'], rowLimit: 10 },
      }),
    ]);

    const totals = totalsRes.data.rows?.[0];
    const dailyRows = toRows(dailyRes.data.rows);

    return {
      clicksTotal: totals?.clicks ?? 0,
      impressionsTotal: totals?.impressions ?? 0,
      ctrAvg: totals?.ctr ?? 0,
      positionAvg: totals?.position ?? 0,
      dailySeries: dailyRows.map((row) => ({
        label: new Date(`${row.label}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
        value: row.clicks,
      })),
      topQueries: toRows(queriesRes.data.rows),
      topPages: toRows(pagesRes.data.rows).map((row) => ({ ...row, label: row.label.replace(siteUrl, '') || '/' })),
    };
  } catch (err) {
    console.error('[admin/seo] getSeoData failed', err);
    return null;
  }
}

function formatNumber(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

const VERDICT_LABEL: Record<string, string> = {
  PASS: 'Indexed',
  FAIL: 'Not indexed',
  NEUTRAL: 'Unknown',
  PARTIAL: 'Partially indexed',
  VERDICT_UNSPECIFIED: 'Unknown',
};

function InspectionResultCard({ result }: { result: UrlInspectionResult }) {
  if (result.error) {
    return (
      <div className="rounded-xl border border-hairline bg-sand p-4 text-sm text-muted">{result.error}</div>
    );
  }
  const verdict = result.verdict ? VERDICT_LABEL[result.verdict] ?? result.verdict : 'Unknown';
  const ok = result.verdict === 'PASS';
  return (
    <div className="space-y-1.5 rounded-xl border border-hairline bg-sand p-4 text-sm">
      <p className={ok ? 'font-bold text-green-ink' : 'font-bold text-destructive'}>{verdict}</p>
      {result.coverageState && <p className="text-muted">Coverage: {result.coverageState}</p>}
      {result.lastCrawlTime && (
        <p className="text-muted">
          Last crawled: {new Date(result.lastCrawlTime).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
      )}
      {!result.lastCrawlTime && <p className="text-muted">Last crawled: never</p>}
      {result.robotsTxtState && <p className="text-muted">robots.txt: {result.robotsTxtState}</p>}
      {result.indexingState && <p className="text-muted">Indexing allowed: {result.indexingState}</p>}
    </div>
  );
}

export default async function SeoPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; inspect?: string }>;
}) {
  const params = await searchParams;
  const defaults = defaultRange();
  const from = params.from || defaults.from;
  const to = params.to || defaults.to;

  const data = await getSeoData(from, to);
  const inspection = params.inspect ? await inspectUrl(params.inspect) : null;

  const rangeLabel = `${new Date(`${from}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })} – ${new Date(`${to}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;

  const dateForm = (
    <form action="/admin/analytics/seo" className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="from" className="text-xs">From</Label>
        <Input id="from" name="from" type="date" defaultValue={from} max={to} className="w-40" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="to" className="text-xs">To</Label>
        <Input id="to" name="to" type="date" defaultValue={to} max={defaults.to} className="w-40" />
      </div>
      <Button type="submit" size="sm">Apply</Button>
    </form>
  );

  if (!data) {
    return (
      <div className="mx-auto max-w-5xl space-y-8">
        <PageHeader
          title="Search Console"
          description="Google Search Console"
          breadcrumbs={[{ label: 'Insights' }, { label: 'Search Console' }]}
        />
        <div className="rounded-2xl border border-hairline bg-surface p-12 text-center">
          <p className="mb-2 font-bold text-ink">Search Console not configured</p>
          <p className="mx-auto max-w-md text-sm text-muted">
            Add <code className="font-mono text-saffron-ink">GSC_SITE_URL</code> to your environment
            variables (reuses the existing <code className="font-mono text-saffron-ink">GCP_SERVICE_ACCOUNT_KEY</code>{' '}
            from GA4 — see docs/OPS.md §9.3 for the one-time Search Console access grant this
            service account still needs).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="Search Console"
        description={`Google Search Console — ${rangeLabel}`}
        breadcrumbs={[{ label: 'Insights' }, { label: 'Search Console' }]}
      />

      <Card>
        <CardContent>{dateForm}</CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatTile label="Clicks" value={formatNumber(data.clicksTotal)} icon={MousePointerClick} accent="saffron" />
        <StatTile label="Impressions" value={formatNumber(data.impressionsTotal)} icon={Eye} accent="green" />
        <StatTile label="Avg. CTR" value={`${(data.ctrAvg * 100).toFixed(1)}%`} icon={Percent} />
        <StatTile label="Avg. position" value={data.positionAvg.toFixed(1)} icon={ArrowUpDown} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Clicks over time
          </CardTitle>
        </CardHeader>
        <CardContent>
          <LineChart points={data.dailySeries} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted">
              Top Queries
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.topQueries.length > 0 ? (
              <BarList
                items={data.topQueries.map((q) => ({ label: q.label, value: q.clicks }))}
                valueFormatter={(v) => `${v.toLocaleString()} clicks`}
              />
            ) : (
              <p className="text-sm text-muted">No query data yet for this range.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted">
              Top Pages
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.topPages.length > 0 ? (
              <BarList
                items={data.topPages.map((p) => ({ label: p.label, value: p.clicks }))}
                valueFormatter={(v) => `${v.toLocaleString()} clicks`}
              />
            ) : (
              <p className="text-sm text-muted">No page data yet for this range.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted">
            <Search className="h-3 w-3" /> Check a page&apos;s live indexing status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action="/admin/analytics/seo" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="to" value={to} />
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="inspect" className="text-xs">Page path (e.g. /voice)</Label>
              <Input id="inspect" name="inspect" type="text" defaultValue={params.inspect} placeholder="/voice" />
            </div>
            <Button type="submit" size="sm">Inspect</Button>
          </form>
          {inspection && <InspectionResultCard result={inspection} />}
        </CardContent>
      </Card>
    </div>
  );
}
