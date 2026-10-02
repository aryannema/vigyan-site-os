import { NextResponse } from 'next/server';
import { getGa4Client } from '../ga4-client';

// Resolves to /admin/analytics/realtime -- deliberately placed UNDER /admin,
// not /api/*. middleware.ts's matcher is exactly
// ['/admin/:path*', '/login', '/pending-approval'] -- a route under /api/*
// would be completely unauthenticated. This path IS covered by /admin/:path*,
// so the existing session gate protects it automatically with zero new auth
// code. Verify with a cookie-less curl post-deploy: expect a redirect to
// /login, not a 200 with data.
//
// GA4 Realtime data itself only refreshes ~60s server-side (separate from,
// and independent of, the historical runReport data on the main analytics
// page) -- polling this faster than ~30s buys nothing. Defensive: never
// throws, always returns a valid (possibly empty) shape so the poller never
// breaks on a transient GA4 error.

export const dynamic = 'force-dynamic';

export async function GET() {
  const ga4 = getGa4Client();
  if (!ga4) {
    return NextResponse.json({ activeUsers: 0, byCountry: [] });
  }

  try {
    const [report] = await ga4.client.runRealtimeReport({
      property: `properties/${ga4.propertyId}`,
      dimensions: [{ name: 'country' }, { name: 'countryId' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      limit: 10,
    });

    const byCountry = (report.rows ?? []).map((row) => ({
      label: row.dimensionValues?.[0]?.value ?? 'Unknown',
      alpha2: row.dimensionValues?.[1]?.value ?? '',
      value: parseInt(row.metricValues?.[0]?.value ?? '0'),
    }));

    const activeUsers = byCountry.reduce((sum, row) => sum + row.value, 0);

    return NextResponse.json({ activeUsers, byCountry });
  } catch (err) {
    console.error('[admin/analytics/realtime] GA4 realtime report failed:', err);
    return NextResponse.json({ activeUsers: 0, byCountry: [] });
  }
}
