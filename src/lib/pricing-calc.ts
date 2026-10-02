import { margin, checkFloor, maxDiscountBp, priceForTargetNet, listPriceForTargetNet, type FloorPolicy, type MarginResult, type FloorCheck, type ListPriceResult } from '@/lib/margin';

/**
 * The pricing calculator's arithmetic, as a pure function.
 *
 * Extracted from the component on purpose: maths trapped inside JSX cannot be
 * tested, and this decides what we charge and what we keep. The component now
 * only renders what this returns.
 */

export type PlaceOfSupply = 'intra' | 'inter' | 'export';

export interface CalcInput {
  listRupees: string | number;
  discountPercent: string | number;
  targetNetRupees: string | number;
  place: PlaceOfSupply;
  policy: FloorPolicy;
}

export interface CalcResult {
  listP: number;
  chargedP: number;
  savedP: number;
  gstRateBp: number;
  margin: MarginResult;
  floor: FloorCheck;
  /** Largest discount, in basis points, that still clears the floor. */
  maxDiscountBp: number;
  target: { pricePaise: number; upliftPaise: number; achievedNetPaise: number };
  /**
   * The answer to "I want to earn X and advertise Y% off -- what do I list?".
   * Uses the SAME discount as the box above, so the two halves of the page
   * describe one plan rather than two unrelated sums.
   */
  listForTarget: ListPriceResult;
}

/** Rupee string from a form field to paise. Never NaN, never negative. */
export function rupeesToPaise(v: string | number): number {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/** Percent from a form field to basis points, clamped to 0..100%. */
export function percentToBp(v: string | number): number {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(10000, Math.round(n * 100));
}

export function calculatePricing(input: CalcInput): CalcResult {
  const listP = rupeesToPaise(input.listRupees);
  const discBp = percentToBp(input.discountPercent);

  // An export is zero-rated, so the rate itself changes -- not just the split
  // between CGST/SGST and IGST. Getting this wrong overstates tax on every
  // foreign sale and understates what we keep.
  const gstRateBp = input.place === 'export' ? 0 : input.policy.gstRateBp;
  const policy: FloorPolicy = { ...input.policy, gstRateBp };

  // Round the discount and subtract; never round the result. Rounding the final
  // price can leave the saving shown and the saving charged a paisa apart.
  const savedP = Math.round((listP * discBp) / 10000);
  const chargedP = listP - savedP;

  const baseP = Math.round((chargedP * 10000) / (10000 + gstRateBp));
  const gstP = chargedP - baseP;

  return {
    listP,
    chargedP,
    savedP,
    gstRateBp,
    margin: margin({
      chargedPaise: chargedP,
      gstPaise: gstP,
      gatewayFeeBp: policy.gatewayFeeBp,
      gatewayFeeGstBp: policy.gatewayFeeGstBp,
      hostingPaise: policy.hostingPerSalePaise ?? 0,
    }),
    floor: checkFloor(chargedP, policy),
    maxDiscountBp: maxDiscountBp(listP, policy),
    listForTarget: listPriceForTargetNet({
      targetNetPaise: rupeesToPaise(input.targetNetRupees),
      discountBp: discBp,
      gstRateBp,
      gatewayFeeBp: policy.gatewayFeeBp,
      gatewayFeeGstBp: policy.gatewayFeeGstBp,
      hostingPerSalePaise: policy.hostingPerSalePaise ?? 0,
    }),
    target: priceForTargetNet({
      targetNetPaise: rupeesToPaise(input.targetNetRupees),
      gstRateBp,
      gatewayFeeBp: policy.gatewayFeeBp,
      gatewayFeeGstBp: policy.gatewayFeeGstBp,
      hostingPerSalePaise: policy.hostingPerSalePaise ?? 0,
    }),
  };
}
