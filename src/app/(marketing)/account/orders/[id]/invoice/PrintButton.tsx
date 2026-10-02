'use client';

import { useState } from 'react';

/**
 * Two ways to get the invoice, because they fail differently: the download is
 * immediate but tied to this browser, and the email lands somewhere the buyer
 * keeps things and can forward to an accountant.
 */
export function PrintButton({ orderId }: { orderId: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const email = async () => {
    setState('sending');
    setError(null);
    const res = await fetch(`/api/invoice/${orderId}/email`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error ?? 'Could not send.');
      setState('idle');
      return;
    }
    setState('sent');
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        href={`/api/invoice/${orderId}`}
        className="inline-flex h-10 items-center rounded-ui-lg bg-primary px-5 text-sm font-bold text-primary-foreground transition hover:brightness-[1.04]"
      >
        Download PDF
      </a>
      <button
        type="button"
        onClick={email}
        disabled={state !== 'idle'}
        className="inline-flex h-10 items-center rounded-ui-lg border border-input px-5 text-sm font-semibold text-foreground transition hover:border-primary disabled:opacity-60"
      >
        {state === 'sending' ? 'Sending…' : state === 'sent' ? 'Sent to your email' : 'Email it to me'}
      </button>
      {error && <span className="text-xs font-semibold text-destructive">{error}</span>}
    </div>
  );
}
