'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { INDIAN_STATES } from '@/lib/gst';

interface TaxBreakdown {
  baseP: number; cgstP: number; sgstP: number; igstP: number; totalP: number; label: string;
  treatment?: string;
}

interface Billing { country: string; stateCode: string | null; gstin: string | null }

declare global {
  interface Window { Razorpay?: new (options: Record<string, unknown>) => { open: () => void } }
}

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Razorpay's checkout.js is loaded on demand rather than on every page.
 * It is a third-party script on a marketing site; pulling it in for visitors
 * who never reach a Buy button costs them bytes and hands Razorpay a page view
 * of everyone who merely browsed.
 */
function loadCheckoutScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const el = document.createElement('script');
    el.src = 'https://checkout.razorpay.com/v1/checkout.js';
    el.onload = () => resolve(true);
    el.onerror = () => resolve(false);
    document.body.appendChild(el);
  });
}

export function BuyButton({
  productId,
  priceP,
  label = 'Buy now',
  className,
}: {
  productId: string;
  /** Display price only. The charged amount is decided server-side. */
  priceP: number;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tax, setTax] = useState<TaxBreakdown | null>(null);

  // 'idle' -> 'billing' (first purchase only) -> paying
  const [stage, setStage] = useState<'idle' | 'billing'>('idle');
  const [billing, setBilling] = useState<Billing>({ country: 'IN', stateCode: null, gstin: '' });
  const [needsState, setNeedsState] = useState(false);

  /** Re-price whenever the location changes. Writes nothing. */
  const quote = useCallback(async (b: Billing) => {
    const res = await fetch('/api/checkout/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, country: b.country, stateCode: b.stateCode, gstin: b.gstin }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data?.error ?? 'Could not price this item.'); return; }
    setError(null);
    setTax(data.tax);
    setNeedsState(Boolean(data.needsState));
  }, [productId]);

  useEffect(() => {
    if (stage === 'billing') void quote(billing);
  }, [stage, billing, quote]);

  const beginCheckout = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // A returning buyer has already told us where they are; asking again is
      // friction for no information.
      const res = await fetch('/api/profile/billing');
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      const existing = await res.json();
      if (existing.complete) {
        await pay({ country: existing.country, stateCode: existing.stateCode, gstin: existing.gstin });
        return;
      }
      setBilling({ country: existing.country ?? 'IN', stateCode: existing.stateCode, gstin: existing.gstin ?? '' });
      setStage('billing');
      setBusy(false);
    } catch {
      setError('Could not start checkout.');
      setBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const pay = useCallback(async (b: Billing) => {
    setBusy(true);
    setError(null);
    try {
      // The server decides the price, the tax and the order. Nothing about the
      // amount is sent from here -- a browser-supplied amount is a
      // browser-chosen price.
      const res = await fetch('/api/checkout/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, billing: b }),
      });

      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Could not start checkout.');

      setTax(data.tax);

      if (!(await loadCheckoutScript()) || !window.Razorpay) {
        // The order row already exists and stays 'pending'. Nothing was
        // charged, and support can see the attempt.
        throw new Error('Could not reach the payment provider. Please try again.');
      }

      new window.Razorpay({
        key: data.keyId,
        order_id: data.orderId,
        amount: data.amount,
        currency: data.currency,
        name: 'YourSite',
        description: data.productTitle,
        // Payment is confirmed by the webhook, server to server. This handler
        // only moves the visitor along -- a browser that never comes back must
        // not be the difference between a paid order and a lost one.
        handler: () => router.push(`/account/orders?order=${data.internalOrderId}`),
        modal: {
          ondismiss: () => setBusy(false),
        },
        theme: { color: '#e8821a' },
      }).open();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setBusy(false);
    }
  }, [productId, router]);

  return (
    <div className={className}>
      <button
        type="button"
        onClick={stage === 'billing' ? () => pay(billing) : beginCheckout}
        disabled={busy || (stage === 'billing' && billing.country === 'IN' && !billing.stateCode)}
        className="inline-flex h-12 items-center justify-center rounded-ui-lg bg-primary px-7 text-sm font-bold text-primary-foreground transition hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy
          ? 'Opening checkout…'
          : stage === 'billing'
            ? `Pay ${rupees(tax?.totalP ?? priceP)}`
            : `${label} — ${rupees(priceP)}`}
      </button>

      {/* Asked once, on the first purchase, and stored. GST is decided by place
          of supply, so without it an Indian buyer is priced against OUR state
          and may be charged the wrong split. */}
      {stage === 'billing' && (
        <div className="mt-4 space-y-3 rounded-ui-lg border border-input bg-card p-4">
          <p className="text-xs text-muted-foreground">
            Where should we bill this? Needed to apply the right tax — we&apos;ll remember it.
          </p>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ck-country" className="text-[13px] font-semibold text-foreground">Country</label>
            <select
              id="ck-country"
              value={billing.country}
              onChange={(e) => setBilling((b) => ({ ...b, country: e.target.value, stateCode: null }))}
              className="rounded-ui-md border border-input bg-card px-3 py-2.5 text-sm text-foreground"
            >
              <option value="IN">India</option>
              <option value="OTHER">Outside India</option>
            </select>
          </div>

          {billing.country === 'IN' && (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ck-state" className="text-[13px] font-semibold text-foreground">State</label>
                <select
                  id="ck-state"
                  value={billing.stateCode ?? ''}
                  onChange={(e) => setBilling((b) => ({ ...b, stateCode: e.target.value || null }))}
                  className="rounded-ui-md border border-input bg-card px-3 py-2.5 text-sm text-foreground"
                >
                  <option value="">Select a state…</option>
                  {INDIAN_STATES.map((st) => (
                    <option key={st.code} value={st.code}>{st.name}</option>
                  ))}
                </select>
                {needsState && (
                  <span className="text-xs text-amber-700">
                    Choose a state — the total below is provisional until you do.
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="ck-gstin" className="text-[13px] font-semibold text-foreground">
                  GSTIN <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <input
                  id="ck-gstin"
                  value={billing.gstin ?? ''}
                  onChange={(e) => setBilling((b) => ({ ...b, gstin: e.target.value.toUpperCase() }))}
                  placeholder="29ABCDE1234F1Z5"
                  className="rounded-ui-md border border-input bg-card px-3 py-2.5 font-mono text-sm text-foreground"
                />
                <span className="text-xs text-muted-foreground">
                  For a business purchase — printed on the invoice so you can claim input credit.
                </span>
              </div>
            </>
          )}

          {billing.country !== 'IN' && (
            <p className="text-xs text-green-700">
              Treated as an export of services — no Indian GST is charged.
            </p>
          )}
        </div>
      )}

      {/* Shown after the server has priced it, so the visitor sees the real
          split rather than a guess made in the browser. */}
      {tax && (
        <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between gap-6">
            <dt>Subtotal</dt><dd>{rupees(tax.baseP)}</dd>
          </div>
          {tax.cgstP > 0 && (
            <>
              <div className="flex justify-between gap-6"><dt>CGST</dt><dd>{rupees(tax.cgstP)}</dd></div>
              <div className="flex justify-between gap-6"><dt>SGST</dt><dd>{rupees(tax.sgstP)}</dd></div>
            </>
          )}
          {tax.igstP > 0 && (
            <div className="flex justify-between gap-6"><dt>IGST</dt><dd>{rupees(tax.igstP)}</dd></div>
          )}
          <div className="flex justify-between gap-6 border-t border-hairline pt-1 font-semibold text-foreground">
            <dt>Total</dt><dd>{rupees(tax.totalP)}</dd>
          </div>
          <p className="pt-1">{tax.label}</p>
        </dl>
      )}

      {error && <p role="alert" className="mt-2 text-xs font-semibold text-destructive">{error}</p>}
    </div>
  );
}
