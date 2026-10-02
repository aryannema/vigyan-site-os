'use client';

import { useEffect, useState } from 'react';

/**
 * Offer countdown.
 *
 * DECORATION, and deliberately so. The price a buyer is charged is decided by
 * the server at order time from offer_ends_at -- if this timer says 00:00:00 and
 * the deadline has not actually passed, the discount still applies, and if a
 * browser tab sat open for a week the stale price it shows is simply ignored.
 * Nothing here is trusted by the checkout.
 */
export function CountdownTimer({ endsAt }: { endsAt: string }) {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setLeft(new Date(endsAt).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  // Render nothing until the first client tick: server and client clocks differ,
  // and rendering a server-computed duration would hydrate into a mismatch.
  if (left === null) return null;
  if (left <= 0) return <span className="font-mono text-sm text-muted">Offer ended</span>;

  const s = Math.floor(left / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <span className="font-mono text-sm font-bold text-saffron-ink" aria-live="off">
      {d > 0 && `${d}d `}{pad(h)}:{pad(m)}:{pad(sec)} left
    </span>
  );
}
