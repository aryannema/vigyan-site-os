/**
 * Effective price and offer state.
 *
 * Mirrors public.effective_price_paise (migration 033). The rule lives in SQL
 * because that is the one place the product page, the quote and the order all
 * agree; this is the read-side copy used for rendering.
 *
 * An offer is a DISCOUNT PERCENTAGE off the standard price, running until a
 * deadline. Expressed that way because it is how offers are actually described,
 * and because raising the standard price then keeps the offer correct instead
 * of leaving a stale absolute figure behind.
 *
 * The expiry is ALWAYS re-evaluated server-side at order creation. A countdown
 * in a browser is decoration: the obvious move is to open the page while the
 * offer runs and complete the purchase after it ends, and a clock the buyer
 * controls must never decide what they are charged.
 */

export interface Priceable {
  /** Standard price in paise. Mandatory — every product has one. */
  price_paise: number;
  /** Discount in basis points off the standard price. 2500 = 25%. */
  discount_bp: number | null;
  offer_ends_at: string | null;
  offer_label: string | null;
}

export interface PriceState {
  /** What to charge, in paise. */
  effectiveP: number;
  /** The standard price. Struck through while an offer runs. */
  listP: number;
  /** Amount saved, in paise. */
  savedP: number;
  offerActive: boolean;
  offerEndsAt: string | null;
  offerLabel: string | null;
  /** Whole-number percentage, for display. */
  discountPercent: number;
}

export function priceState(p: Priceable, now: Date = new Date()): PriceState {
  const active =
    p.discount_bp !== null &&
    p.discount_bp > 0 &&
    p.discount_bp <= 10000 &&
    p.offer_ends_at !== null &&
    new Date(p.offer_ends_at) > now;

  // Round the discount, then subtract — never round the result. Rounding the
  // final price instead can leave the saving shown and the saving charged a
  // paisa apart.
  const savedP = active ? Math.round((p.price_paise * p.discount_bp!) / 10000) : 0;

  return {
    effectiveP: p.price_paise - savedP,
    listP: p.price_paise,
    savedP,
    offerActive: active,
    offerEndsAt: active ? p.offer_ends_at : null,
    offerLabel: active ? p.offer_label : null,
    discountPercent: active ? Math.round(p.discount_bp! / 100) : 0,
  };
}

/** Basis points from a percentage typed by an admin. 12.5 -> 1250. */
export const percentToBp = (percent: string | number): number =>
  Math.round(Number(percent) * 100);

export const bpToPercent = (bp: number): string => String(bp / 100);
