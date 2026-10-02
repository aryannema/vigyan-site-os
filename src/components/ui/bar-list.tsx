import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A ranked horizontal bar list -- "top N entities by magnitude" (top pages,
 * top traffic sources, that kind of thing). This is one series over distinct
 * entities, not a multi-category comparison, so it uses exactly one fill
 * color throughout (dataviz rule: sequential/magnitude = one hue) rather than
 * a different color per row. The number is always rendered as real text next
 * to the bar -- never bar-only -- so the list stays legible without color.
 */
export function BarList({
  items,
  valueFormatter = (v: number) => v.toLocaleString(),
  className,
}: {
  items: Array<{ label: string; value: number; href?: string }>;
  valueFormatter?: (value: number) => string;
  className?: string;
}) {
  const max = Math.max(1, ...items.map((item) => item.value));

  return (
    <ul className={cn('flex flex-col gap-2', className)}>
      {items.map((item) => {
        const widthPct = Math.max(2, Math.round((item.value / max) * 100));
        const row = (
          <div className="flex items-center gap-3">
            <span className="w-0 flex-1 truncate text-sm text-body">{item.label}</span>
            <span className="shrink-0 text-sm font-medium tabular-nums text-ink">
              {valueFormatter(item.value)}
            </span>
          </div>
        );
        return (
          <li key={item.label} className="flex flex-col gap-1">
            {item.href ? (
              <a href={item.href} className="transition hover:opacity-80">
                {row}
              </a>
            ) : (
              row
            )}
            <div className="h-1.5 overflow-hidden rounded-full bg-well" aria-hidden="true">
              <div
                className="h-full rounded-full bg-saffron-500"
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </li>
        );
      })}
      {items.length === 0 ? <p className="text-sm text-muted">No data yet.</p> : null}
    </ul>
  );
}
