import { priceState, type Priceable } from '@/lib/pricing';

import { OfferCountdown } from './OfferCountdown';

/**
 * A product's price, with its offer if one is running.
 *
 * Server component: the offer decision is made here, from the same rule as
 * effective_price_paise(), so the page cannot advertise a price that checkout
 * will not honour. The countdown beneath it is the only client-side part, and
 * it is decoration.
 */

const rupees = (p: number) =>
  `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export function PriceTag({
  product,
  className,
}: {
  product: Priceable;
  className?: string;
}) {
  const s = priceState(product);

  // Zero is "request a quote", not free — the same rule the order route
  // enforces when it refuses to create a checkout for a zero-priced item.
  if (s.effectiveP <= 0 && !s.offerActive) {
    return <p className={`text-lg font-semibold text-foreground ${className ?? ''}`}>Request a quote</p>;
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-3xl text-foreground">{rupees(s.effectiveP)}</span>
        {s.offerActive && (
          <>
            <span className="text-lg text-muted-foreground line-through">{rupees(s.listP)}</span>
            <span className="rounded-full bg-green-600/10 px-2 py-0.5 text-xs font-bold text-green-700">
              Save {rupees(s.savedP)}
            </span>
          </>
        )}
      </div>

      {s.offerActive && s.offerEndsAt && (
        <OfferCountdown
          endsAt={s.offerEndsAt}
          label={s.offerLabel}
          discountPercent={s.discountPercent}
          className="mt-3"
        />
      )}
    </div>
  );
}
