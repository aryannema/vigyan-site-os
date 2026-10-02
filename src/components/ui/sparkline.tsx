import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A small inline trend line for a `StatTile` -- not a full chart (no axes,
 * no gridlines, deliberately illegible as anything but a shape), so it skips
 * the hover/tooltip layer a real chart would need; a native `<title>` gives
 * the raw values on hover as a minimal affordance instead. Single 2px stroke,
 * rounded terminus dot on the last point, one color (this repo's saffron
 * accent) -- matches the dataviz mark spec for a single-series line.
 */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 4) - 2; // 2px padding top/bottom
    return [x, y] as const;
  });
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('overflow-visible text-saffron-500', className)}
      role="img"
      aria-label={`Trend from ${values[0]} to ${values[values.length - 1]}`}
    >
      <title>{values.join(', ')}</title>
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.5} fill="currentColor" />
    </svg>
  );
}
