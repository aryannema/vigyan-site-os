'use client';

import { useEffect, useState } from 'react';

/**
 * Countdown to an offer's deadline.
 *
 * DECORATION BY DESIGN. The price is decided server-side by
 * effective_price_paise() and re-checked when the order is created, so a wrong
 * clock here — a skewed machine, a paused tab, a user editing the DOM — can
 * never change what anyone is charged. That is deliberate: a countdown the
 * buyer's own browser controls must not be load-bearing.
 *
 * Renders the deadline as plain text on the server, then upgrades to a ticking
 * clock once mounted. Without JS, or before hydration, the reader still sees
 * when the offer ends rather than an empty box.
 */

function remaining(endsAt: string, now: number) {
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 0) return null;
  return {
    days: Math.floor(ms / 86_400_000),
    hours: Math.floor((ms / 3_600_000) % 24),
    minutes: Math.floor((ms / 60_000) % 60),
    seconds: Math.floor((ms / 1000) % 60),
    totalMs: ms,
  };
}

export function OfferCountdown({
  endsAt,
  label,
  discountPercent,
  className,
}: {
  endsAt: string;
  label?: string | null;
  discountPercent: number;
  className?: string;
}) {
  // Null until mounted, so server and client render the same markup and
  // hydration does not mismatch on a clock that has already moved.
  const [left, setLeft] = useState<ReturnType<typeof remaining>>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const tick = () => setLeft(remaining(endsAt, Date.now()));
    tick();
    // Every second only while more than an hour remains would be wasteful, but
    // the last hour is exactly when the seconds matter, so keep it simple and
    // let the browser throttle background tabs.
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  // Expired: render nothing. The server has already reverted to the standard
  // price, so leaving a dead "offer ended" banner would only confuse.
  if (mounted && !left) return null;

  const urgent = left !== null && left.totalMs < 3_600_000;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-ui-md border px-3 py-2 text-sm ${
        urgent
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-saffron-500/30 bg-saffron-500/10 text-saffron-ink'
      } ${className ?? ''}`}
    >
      <span className="font-semibold">
        {label || `${discountPercent}% off`}
      </span>

      {!mounted || !left ? (
        // Server render and pre-hydration: the fact, not the ticking.
        <span className="text-muted-foreground">
          until{' '}
          {new Date(endsAt).toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </span>
      ) : (
        <span
          // Announced on a timer politely, and only the whole phrase — a
          // per-second live region would make a screen reader unusable.
          aria-live="off"
          className="font-mono tabular-nums"
        >
          ends in{' '}
          {left.days > 0 && `${left.days}d `}
          {(left.days > 0 || left.hours > 0) && `${left.hours}h `}
          {left.minutes}m {String(left.seconds).padStart(2, '0')}s
        </span>
      )}

      {/* The real deadline, always available to assistive tech and to anyone
          who wants the actual date rather than a relative countdown. */}
      <time dateTime={endsAt} className="sr-only">
        Offer ends {new Date(endsAt).toLocaleString('en-IN')}
      </time>
    </div>
  );
}
