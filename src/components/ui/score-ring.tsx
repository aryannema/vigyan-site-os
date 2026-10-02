import { cn } from '@/lib/utils';

/**
 * A Lighthouse/Wix-style circular score gauge -- plain SVG, no charting
 * library, same convention as line-chart.tsx and sparkline.tsx. Color tiers
 * follow the same red/amber/green threshold Lighthouse uses (0-49 / 50-89 /
 * 90-100), since that's the mental model this UI is deliberately evoking.
 */
const TIER = {
  bad: { stroke: 'stroke-destructive', text: 'text-destructive' },
  ok: { stroke: 'stroke-saffron-500', text: 'text-saffron-ink' },
  good: { stroke: 'stroke-green-700', text: 'text-green-ink' },
} as const;

function tierFor(score: number): keyof typeof TIER {
  if (score >= 90) return 'good';
  if (score >= 50) return 'ok';
  return 'bad';
}

export function ScoreRing({
  score,
  size = 88,
  strokeWidth = 7,
  className,
}: {
  score: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = circumference * (1 - clamped / 100);
  const tier = TIER[tierFor(clamped)];

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          className="fill-none stroke-hairline"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn('fill-none transition-[stroke-dashoffset] duration-500', tier.stroke)}
        />
      </svg>
      <span className={cn('absolute text-lg font-extrabold tabular-nums', tier.text)}>{Math.round(clamped)}</span>
    </div>
  );
}
