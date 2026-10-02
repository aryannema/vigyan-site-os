import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDown, ArrowUp } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Sparkline } from '@/components/ui/sparkline';

/**
 * A single dashboard metric: a big number, its label, and optionally an icon
 * and a trend delta. Built on the existing `Card` primitive -- no new visual
 * language, just a consistent shape for the plain-number cards currently
 * hand-rolled per page (analytics, WhatsApp CRM).
 *
 * Accent is a single optional color for the icon chip -- never assign a
 * different accent per tile in a row "for variety"; that turns structural
 * chrome into a decoration. Trend up/down is a real status signal (green/red),
 * kept separate from `accent`.
 */

const ACCENT_CLASSES = {
  saffron: 'bg-saffron-500/12 text-saffron-ink',
  green: 'bg-green-500/12 text-green-ink',
  /** For a genuine warning/critical status reading (e.g. "needs reply") -- not a decorative option to reach for otherwise. */
  destructive: 'bg-destructive/12 text-destructive',
  none: 'bg-sand text-muted',
} as const;

export function StatTile({
  label,
  value,
  icon: Icon,
  accent = 'none',
  trend,
  sparkline,
  className,
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  accent?: keyof typeof ACCENT_CLASSES;
  /** A real status signal (value went up/down since the prior period), not decoration. */
  trend?: { direction: 'up' | 'down'; label: string };
  /** Daily values, oldest first -- renders as a small inline trend line, e.g. the last 7 days. */
  sparkline?: number[];
  className?: string;
}) {
  return (
    <Card className={cn(className)}>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted">{label}</p>
          <p className="text-2xl font-semibold text-ink">{value}</p>
          {trend ? (
            <p
              className={cn(
                'flex items-center gap-1 text-xs font-medium',
                trend.direction === 'up' ? 'text-green-ink' : 'text-destructive',
              )}
            >
              {trend.direction === 'up' ? (
                <ArrowUp className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ArrowDown className="h-3 w-3" aria-hidden="true" />
              )}
              {trend.label}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          {Icon ? (
            <div className={cn('rounded-lg p-2', ACCENT_CLASSES[accent])}>
              <Icon className="h-4 w-4" aria-hidden="true" />
            </div>
          ) : null}
          {sparkline && sparkline.length >= 2 ? <Sparkline values={sparkline} /> : null}
        </div>
      </CardContent>
    </Card>
  );
}
