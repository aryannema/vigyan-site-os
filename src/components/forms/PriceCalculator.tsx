'use client';

import { useState } from 'react';

import { margin, priceForTargetNet, campaignPricing } from '@/lib/margin';

/**
 * Works a price out from what the seller wants to KEEP.
 *
 * The product form asks for a sale price, which is the wrong end of the
 * question. What an operator actually decides is "I want ₹800 from this" — and
 * arriving at a price from there is not arithmetic anyone should do in their
 * head, because raising the price raises the gateway's cut of it.
 *
 * Purely a calculator. It writes nothing; it fills in the price field.
 */

const rupees = (p: number) =>
  `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PriceCalculator({
  gstRateBp = 1800,
  gatewayFeeBp = 200,
  gatewayFeeGstBp = 1800,
  hostingPerSalePaise = 50,
  onApply,
}: {
  gstRateBp?: number;
  gatewayFeeBp?: number;
  gatewayFeeGstBp?: number;
  hostingPerSalePaise?: number;
  /** Called with the price and discount the admin decided on. */
  onApply?: (v: { priceRupees: string; discountPercent: string }) => void;
}) {
  const [keepRupees, setKeepRupees] = useState('800');
  const [advertisedDiscount, setAdvertisedDiscount] = useState('0');

  const targetNetPaise = Math.round(Number(keepRupees || '0') * 100);
  const discountBp = Math.round(Number(advertisedDiscount || '0') * 100);
  const valid = targetNetPaise > 0 && discountBp >= 0 && discountBp < 10000;

  let listPaise = 0;
  let salePaise = 0;
  let breakdown: ReturnType<typeof margin> | null = null;

  if (valid) {
    if (discountBp > 0) {
      const c = campaignPricing({
        targetNetPaise, advertisedDiscountBp: discountBp,
        gstRateBp, gatewayFeeBp, gatewayFeeGstBp, hostingPerSalePaise,
      });
      listPaise = c.listPricePaise;
      salePaise = c.salePricePaise;
    } else {
      listPaise = salePaise = priceForTargetNet({
        targetNetPaise, gstRateBp, gatewayFeeBp, gatewayFeeGstBp, hostingPerSalePaise,
      }).pricePaise;
    }

    const base = Math.round((salePaise * 10000) / (10000 + gstRateBp));
    breakdown = margin({
      chargedPaise: salePaise,
      gstPaise: salePaise - base,
      gatewayFeeBp, gatewayFeeGstBp, hostingPaise: hostingPerSalePaise,
    });
  }

  return (
    <div className="rounded-ui-lg border border-saffron-500/30 bg-saffron-500/5 p-5">
      <h3 className="text-[13px] font-semibold text-foreground">Work backwards from what you keep</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Decide what should land in your account and the price follows. Raising a price raises the
        gateway&apos;s cut of it, so this solves for it rather than guessing.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="calc-keep" className="text-[13px] font-semibold text-foreground">
            I want to keep (₹)
          </label>
          <input
            id="calc-keep" value={keepRupees} inputMode="decimal"
            onChange={(e) => setKeepRupees(e.target.value)}
            className="rounded-ui-md border border-input bg-card px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-primary"
          />
          <span className="min-h-4 text-xs text-muted-foreground">After GST, the gateway and hosting.</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="calc-discount" className="text-[13px] font-semibold text-foreground">
            Advertise a discount of (%)
          </label>
          <input
            id="calc-discount" value={advertisedDiscount} inputMode="decimal"
            onChange={(e) => setAdvertisedDiscount(e.target.value)}
            className="rounded-ui-md border border-input bg-card px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-primary"
          />
          <span className="min-h-4 text-xs text-muted-foreground">
            0 for no offer. The list price rises to cover it — what you keep does not change.
          </span>
        </div>
      </div>

      {valid && breakdown && (
        <>
          <dl className="mt-4 space-y-1.5 border-t border-saffron-500/20 pt-4 text-sm">
            {discountBp > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">List price (struck through)</dt>
                <dd className="line-through">{rupees(listPaise)}</dd>
              </div>
            )}
            <div className="flex justify-between font-semibold text-foreground">
              <dt>Customer pays</dt><dd>{rupees(salePaise)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">− GST to the government</dt>
              <dd className="text-muted-foreground">−{rupees(breakdown.gstPaise)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">− Gateway fee and its GST</dt>
              <dd className="text-muted-foreground">
                −{rupees(breakdown.gatewayFeePaise + breakdown.gatewayFeeGstPaise)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">− Hosting</dt>
              <dd className="text-muted-foreground">−{rupees(breakdown.hostingPaise)}</dd>
            </div>
            <div className="flex justify-between border-t border-saffron-500/20 pt-2 text-base font-bold text-foreground">
              <dt>You keep</dt><dd>{rupees(breakdown.netPaise)}</dd>
            </div>
          </dl>

          {onApply && (
            <button
              type="button"
              onClick={() => onApply({
                priceRupees: (listPaise / 100).toFixed(2),
                discountPercent: discountBp > 0 ? String(discountBp / 100) : '',
              })}
              className="mt-4 inline-flex h-10 items-center rounded-ui-lg bg-primary px-5 text-sm font-bold text-primary-foreground transition hover:brightness-[1.04]"
            >
              Use these numbers
            </button>
          )}
        </>
      )}
    </div>
  );
}
