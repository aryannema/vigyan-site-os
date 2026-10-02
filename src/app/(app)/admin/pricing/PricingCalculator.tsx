'use client';

import { useMemo, useState } from 'react';
import type { FloorPolicy } from '@/lib/margin';
import { calculatePricing, type PlaceOfSupply } from '@/lib/pricing-calc';

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The pricing calculator.
 *
 * Every number here already existed in src/lib/margin.ts, but only ever ran
 * server-side to REFUSE a save. So a price was set blind and the floor was
 * discovered by hitting it. This shows the same arithmetic before the decision
 * instead of after, including the one thing a list price never reveals: what a
 * discount does to the cut.
 *
 * Runs entirely in the browser off a policy passed from the server. It reads
 * nothing and writes nothing -- it is a worksheet, not a form. Prices are set
 * on the product itself, and this links there.
 */
export function PricingCalculator({ policy }: { policy: FloorPolicy }) {
  const [priceRupees, setPriceRupees] = useState('999');
  const [discountPercent, setDiscountPercent] = useState('20');
  const [targetNetRupees, setTargetNetRupees] = useState('500');
  const [place, setPlace] = useState<PlaceOfSupply>('intra');

  // All arithmetic lives in calculatePricing(), which is pure and tested --
  // maths trapped inside JSX cannot be tested, and this decides what we charge
  // and what we keep. This component only renders the result.
  const view = useMemo(
    () => calculatePricing({ listRupees: priceRupees, discountPercent, targetNetRupees, place, policy }),
    [priceRupees, discountPercent, targetNetRupees, place, policy],
  );

  const { margin: m, floor, maxDiscountBp: maxDisc, target, listForTarget, chargedP: chargedPaise, listP: listPaise } = view;


  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ── What you charge ─────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-2xl border border-hairline bg-surface p-6">
        <h3 className="text-lg font-bold text-ink">What you charge</h3>

        <label className="block">
          <span className="text-sm font-bold text-ink">List price (₹)</span>
          <input
            type="number" min="0" value={priceRupees}
            onChange={(e) => setPriceRupees(e.target.value)}
            className="mt-1 w-full rounded-lg border border-hairline-strong bg-sand px-3 py-2 text-sm text-ink outline-none focus:border-saffron-500/60"
          />
        </label>

        <label className="block">
          <span className="text-sm font-bold text-ink">Discount (%)</span>
          <input
            type="number" min="0" max="100" value={discountPercent}
            onChange={(e) => setDiscountPercent(e.target.value)}
            className="mt-1 w-full rounded-lg border border-hairline-strong bg-sand px-3 py-2 text-sm text-ink outline-none focus:border-saffron-500/60"
          />
          <span className="mt-1 block text-xs text-muted">
            Safe up to <strong>{(maxDisc / 100).toFixed(1)}%</strong> at this list price. Past that the sale
            breaches the floor.
          </span>
        </label>

        <fieldset className="block">
          <legend className="text-sm font-bold text-ink">Buyer location</legend>
          <div className="mt-1 flex gap-2">
            {([['intra', 'Same state'], ['inter', 'Other state'], ['export', 'Outside India']] as const).map(
              ([v, label]) => (
                <button
                  key={v} type="button" onClick={() => setPlace(v)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    place === v ? 'bg-saffron-500 text-[#1c1814]' : 'bg-sand text-body hover:bg-hairline'
                  }`}
                >
                  {label}
                </button>
              ),
            )}
          </div>
          <span className="mt-1 block text-xs text-muted">
            {place === 'export'
              ? 'Zero-rated export — no GST, so the whole price is yours before fees.'
              : place === 'intra'
                ? 'CGST + SGST, split evenly. Same total as IGST.'
                : 'IGST. Same total as CGST + SGST — the split changes, your cut does not.'}
          </span>
        </fieldset>

        <div className="rounded-xl border border-hairline bg-sand p-4">
          <p className="text-xs text-muted">Customer pays</p>
          <p className="text-2xl font-bold text-ink">{rupees(chargedPaise)}</p>
          {listPaise !== chargedPaise && (
            <p className="text-xs text-muted">
              <s>{rupees(listPaise)}</s> — saving {rupees(listPaise - chargedPaise)}
            </p>
          )}
        </div>
      </section>

      {/* ── What you keep ───────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-2xl border border-hairline bg-surface p-6">
        <h3 className="text-lg font-bold text-ink">What you keep</h3>

        <dl className="space-y-1.5 text-sm">
          {[
            ['Customer pays', m.chargedPaise, false],
            [place === 'export' ? 'GST (zero-rated export)' : 'GST (collected for the government)', -m.gstPaise, true],
            ['Gateway fee', -m.gatewayFeePaise, true],
            ['GST on gateway fee', -m.gatewayFeeGstPaise, true],
            ['Hosting for this sale', -m.hostingPaise, true],
          ].map(([label, paise, muted]) => (
            <div key={label as string} className="flex justify-between">
              <dt className={muted ? 'text-muted' : 'text-body'}>{label as string}</dt>
              <dd className={`font-mono ${muted ? 'text-muted' : 'text-ink'}`}>{rupees(paise as number)}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-hairline pt-2">
            <dt className="font-bold text-ink">You keep</dt>
            <dd className="font-mono font-bold text-ink">
              {rupees(m.netPaise)} <span className="text-xs font-normal text-muted">({m.netPercent}%)</span>
            </dd>
          </div>
        </dl>

        <div
          className={`rounded-xl border p-4 ${
            floor.ok ? 'border-hairline bg-sand' : 'border-destructive/40 bg-destructive/5'
          }`}
        >
          <p className={`text-sm font-bold ${floor.ok ? 'text-ink' : 'text-destructive'}`}>
            {floor.ok ? 'Clears the floor' : 'Below the floor — this would be refused'}
          </p>
          <p className="mt-1 text-xs text-muted">{floor.reason}</p>
          {!floor.ok && (
            <p className="mt-1 text-xs text-muted">
              Short by {rupees(floor.shortfallPaise)}. Charge {rupees(floor.suggestedPricePaise)} or more.
            </p>
          )}
        </div>
      </section>

      {/* ── Work backwards from what you want to earn ───────────────────── */}
      <section className="space-y-4 rounded-2xl border-2 border-saffron-500/30 bg-surface p-6 lg:col-span-2">
        <div>
          <h3 className="text-lg font-bold text-ink">Start from what you want to earn</h3>
          <p className="mt-1 text-xs text-muted">
            Enter what you want to keep, and the discount you want to advertise. This works out the list
            price to set so the discount comes out of the sticker, not out of your margin.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="text-sm font-bold text-ink">I want to keep (₹)</span>
            <input
              type="number" min="0" value={targetNetRupees}
              onChange={(e) => setTargetNetRupees(e.target.value)}
              className="mt-1 w-40 rounded-lg border border-hairline-strong bg-sand px-3 py-2 text-sm text-ink outline-none focus:border-saffron-500/60"
            />
          </label>
          <div className="pb-2 text-sm text-muted">
            advertising <strong className="text-ink">{discountPercent || 0}% off</strong>
            <span className="block text-xs">(change it in the discount box above)</span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border-2 border-saffron-500/40 bg-saffron-500/5 p-4">
            <p className="text-xs font-bold text-saffron-ink">SET THIS AS THE PRICE</p>
            <p className="mt-1 text-2xl font-bold text-ink">{rupees(listForTarget.listPricePaise)}</p>
          </div>
          <div className="rounded-xl border border-hairline bg-sand p-4">
            <p className="text-xs text-muted">Customer pays</p>
            <p className="mt-1 text-xl font-bold text-ink">{rupees(listForTarget.chargedPaise)}</p>
          </div>
          <div className="rounded-xl border border-hairline bg-sand p-4">
            <p className="text-xs text-muted">They think they saved</p>
            <p className="mt-1 text-xl font-bold text-ink">{rupees(listForTarget.savedPaise)}</p>
          </div>
          <div className="rounded-xl border border-hairline bg-sand p-4">
            <p className="text-xs text-muted">You keep</p>
            <p className="mt-1 text-xl font-bold text-ink">{rupees(listForTarget.achievedNetPaise)}</p>
          </div>
        </div>

        <p className="text-xs text-muted">
          At full price you would list {rupees(target.pricePaise)}. Raising a price raises the
          gateway&apos;s cut too, so the uplift is more than the discount alone —
          {' '}{rupees(listForTarget.listPricePaise - target.pricePaise)} more here.
        </p>
      </section>

    </div>
  );
}
