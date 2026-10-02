import Link from 'next/link';
import { Activity, IndianRupee, Users } from 'lucide-react';
import { supabaseAdmin } from '@/lib/supabase';
import { BetaAnalyticsDataClient } from '@google-analytics/data';

import { StatTile } from '@/components/ui/stat-tile';
import { LineChart } from '@/components/ui/line-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

interface GaSummary {
  sessions30d: number;
  dailySeries: Array<{ label: string; value: number }>;
}

/** GA4 returns dates as YYYYMMDD with no separators. */
function formatGaDate(yyyymmdd: string): string {
  if (!/^\d{8}$/.test(yyyymmdd)) return yyyymmdd;
  const d = new Date(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

async function getGaSummary(): Promise<GaSummary | null> {
  const propertyId = process.env.GA4_PROPERTY_ID;
  const serviceAccountKey = process.env.GCP_SERVICE_ACCOUNT_KEY;
  if (!propertyId || !serviceAccountKey) return null;
  try {
    const credentials = JSON.parse(serviceAccountKey);
    // fallback:true forces the REST/HTTP1.1 transport instead of gRPC. The
    // default gRPC transport fails inside Next.js's webpack-bundled server
    // code with an opaque "undefined undefined: undefined" error (confirmed
    // live 2026-08-16 -- the exact same call succeeds via a plain unbundled
    // `node -e` script using identical credentials) -- gRPC-js isn't really
    // bundler-safe. See docs/VIGYAN_SECRETS.md.
    const client = new BetaAnalyticsDataClient({ credentials, fallback: true });
    const [totalsReport, dailyReport] = await Promise.all([
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        metrics: [{ name: 'sessions' }],
      }),
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      }),
    ]);
    const sessions30d = parseInt(totalsReport[0]?.rows?.[0]?.metricValues?.[0]?.value ?? '0');
    const dailySeries = (dailyReport[0]?.rows ?? []).map((row) => ({
      label: formatGaDate(row.dimensionValues?.[0]?.value ?? ''),
      value: parseInt(row.metricValues?.[0]?.value ?? '0'),
    }));
    return { sessions30d, dailySeries };
  } catch {
    return null;
  }
}

async function getLeadsThisWeek(): Promise<number> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from('contact_inquiries')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', weekAgo);
  return count ?? 0;
}

async function getTotalRevenue(): Promise<number> {
  const { data } = await supabaseAdmin
    .from('user_entitlements')
    .select('amount')
    .eq('status', 'active');
  return (data ?? []).reduce((sum, row) => sum + (row.amount || 0), 0);
}

async function getRecentPosts() {
  const { data } = await supabaseAdmin
    .from('posts')
    .select('id, title, status, updated_at')
    .order('updated_at', { ascending: false })
    .limit(5);
  return data ?? [];
}

function formatINR(amount: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

function formatNumber(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function AdminDashboardPage() {
  const [ga, leads, revenue, recentPosts] = await Promise.all([
    getGaSummary(),
    getLeadsThisWeek(),
    getTotalRevenue(),
    getRecentPosts(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-ink">Dashboard</h1>
        <p className="mt-2 text-muted">Here is what is happening with YourSite today.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatTile
          label="Sessions (30d)"
          value={ga ? formatNumber(ga.sessions30d) : '—'}
          icon={Activity}
          accent="saffron"
        />
        <StatTile label="New leads (7d)" value={leads} icon={Users} accent="green" />
        <StatTile label="Total revenue" value={formatINR(revenue)} icon={IndianRupee} />
      </div>

      {ga && ga.dailySeries.length >= 2 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted">
              <span>Sessions, last 30 days</span>
              <Link href="/admin/analytics" className="font-bold normal-case tracking-normal text-saffron-ink hover:underline">
                Full analytics →
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LineChart points={ga.dailySeries} height={180} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted">
            GA4 not configured — add <code className="rounded bg-sand px-1">GA4_PROPERTY_ID</code> and{' '}
            <code className="rounded bg-sand px-1">GCP_SERVICE_ACCOUNT_KEY</code> to see a sessions chart here.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base font-bold text-ink">
              <span>Recent Posts</span>
              <Link href="/admin/blog" className="text-xs font-bold text-saffron-ink hover:underline">All Posts →</Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentPosts.length === 0 ? (
              <p className="text-sm text-muted">No posts yet. Create your first post.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {recentPosts.map((post) => (
                  <div key={post.id} className="flex items-center justify-between rounded-xl border border-hairline bg-sand p-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-ink">{post.title}</span>
                      <span className="mt-0.5 text-[10px] capitalize text-muted">
                        {post.status} · {timeAgo(post.updated_at)}
                      </span>
                    </div>
                    <Link
                      href={`/admin/blog/${post.id}/edit`}
                      className="ml-3 shrink-0 text-[10px] font-bold uppercase text-saffron-ink hover:underline"
                    >
                      Edit
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-bold text-ink">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <Link
                href="/admin/blog/new"
                className="rounded-xl border border-brand-primary/20 bg-brand-primary/10 p-4 text-center text-sm font-bold text-saffron-ink transition hover:bg-brand-primary/20"
              >
                New Post
              </Link>
              <Link
                href="/admin/content"
                className="rounded-xl border border-brand-bytes/20 bg-brand-bytes/10 p-4 text-center text-sm font-bold text-green-ink transition hover:bg-brand-bytes/20"
              >
                Edit Content
              </Link>
              <Link
                href="/admin/payments"
                className="rounded-xl border border-hairline bg-sand p-4 text-center text-sm font-bold text-body transition hover:bg-well"
              >
                Payments
              </Link>
              <Link
                href="/admin/analytics"
                className="rounded-xl border border-hairline bg-sand p-4 text-center text-sm font-bold text-body transition hover:bg-well"
              >
                Analytics
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
