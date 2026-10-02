'use client';

import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarList } from '@/components/ui/bar-list';

// Polls GA4 Realtime (via /admin/analytics/realtime, session-gated by
// middleware.ts) every 45s. GA4 Realtime data itself only refreshes ~60s
// server-side, so polling faster buys nothing. Cleared on unmount.
const POLL_INTERVAL_MS = 45_000;

interface RealtimeData {
  activeUsers: number;
  byCountry: Array<{ label: string; alpha2: string; value: number }>;
}

export function LiveVisitorsWidget() {
  const [data, setData] = useState<RealtimeData | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch('/admin/analytics/realtime');
        if (!res.ok) return;
        const json: RealtimeData = await res.json();
        if (!cancelled) setData(json);
      } catch {
        // Transient network error -- next poll will retry; don't clear
        // existing data over one failed fetch.
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const activeUsers = data?.activeUsers ?? 0;
  const isLive = activeUsers > 0;

  return (
    <Card className={cn(isLive && 'shadow-glow-saffron')}>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted">
          <Radio className={cn('h-3 w-3', isLive && 'text-saffron-ink')} /> Right now
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-baseline gap-2">
          <p className="text-3xl font-semibold text-ink">{activeUsers}</p>
          <p className="text-xs text-muted">active visitor{activeUsers === 1 ? '' : 's'} on site</p>
        </div>
        {data && data.byCountry.length > 0 ? (
          <BarList
            items={data.byCountry.map((row) => ({ label: row.label, value: row.value }))}
            valueFormatter={(v) => `${v} active`}
          />
        ) : (
          <p className="text-sm text-muted">No one on the site right now.</p>
        )}
      </CardContent>
    </Card>
  );
}
