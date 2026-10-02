import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A real time-series line chart -- single series, thin 2px line, recessive
 * gridlines, direct axis labels (dataviz mark spec: one hue for a single
 * series, numbers stay legible as text, not just a visual shape). Plain SVG,
 * no charting library -- this repo has no chart dependency and every series
 * here is small (daily points over a bounded date range), well within
 * hand-rolled scope. Each point carries a native <title> for a browser-native
 * hover tooltip instead of a custom tooltip layer.
 */
export function LineChart({
  points,
  height = 220,
  valueFormatter = (v: number) => v.toLocaleString(),
  className,
}: {
  points: Array<{ label: string; value: number }>;
  height?: number;
  valueFormatter?: (value: number) => string;
  className?: string;
}) {
  const width = 640; // viewBox units; scales to container via CSS width:100%
  const padLeft = 40;
  const padRight = 8;
  const padTop = 12;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  if (points.length < 2) {
    return (
      <div className={cn('flex h-[220px] items-center justify-center text-sm text-muted', className)}>
        Not enough data yet.
      </div>
    );
  }

  const values = points.map((p) => p.value);
  const max = Math.max(...values, 1);
  const min = 0; // sessions/pageviews are never negative -- baseline at zero, not min(values)
  const range = max - min || 1;

  const x = (i: number) => padLeft + (i / (points.length - 1)) * plotW;
  const y = (v: number) => padTop + plotH - ((v - min) / range) * plotH;

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${(padTop + plotH).toFixed(1)} L${x(0).toFixed(1)},${(padTop + plotH).toFixed(1)} Z`;

  // 3 horizontal gridlines (0, mid, max) -- recessive, value-labeled.
  const gridValues = [max, max / 2, 0];

  // Thin out x-axis labels so they don't collide -- show at most ~6.
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div className={cn('w-full', className)}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Sessions over time">
        {gridValues.map((v) => (
          <g key={v}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={y(v)}
              y2={y(v)}
              stroke="currentColor"
              className="text-hairline"
              strokeWidth={1}
            />
            <text x={padLeft - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" className="fill-faint text-[9px]">
              {valueFormatter(Math.round(v))}
            </text>
          </g>
        ))}

        <path d={areaPath} className="fill-saffron-500/10" stroke="none" />
        <path d={linePath} fill="none" className="stroke-saffron-500" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {points.map((p, i) => (
          <g key={p.label}>
            <circle cx={x(i)} cy={y(p.value)} r={2.5} className="fill-saffron-500">
              <title>{`${p.label}: ${valueFormatter(p.value)}`}</title>
            </circle>
            {i % labelEvery === 0 && (
              <text
                x={x(i)}
                y={height - 8}
                textAnchor="middle"
                className="fill-faint text-[9px]"
              >
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
