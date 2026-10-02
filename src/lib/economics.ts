import type { Currency } from '@/lib/price-display';

/**
 * The full economics of one sale: what the customer pays, and what actually
 * reaches us after tax, the gateway and the vendors we pay to deliver it.
 *
 * margin.ts already modelled GST + a single percentage gateway fee + a flat
 * hosting number. Three things were missing, and each of them turns a price
 * that looks profitable into one that is not:
 *
 *   1. A gateway fee is not one percentage. Stripe charges a percentage PLUS a
 *      fixed amount, and both gateways surcharge foreign cards. On a small sale
 *      the fixed fee dominates -- 30c on $5 is 6%, not 2.9%.
 *   2. Products cost money to RUN. Meta per conversation, Sarvam per minute,
 *      a video API per render. Treated as zero, a SaaS product can be sold at a
 *      loss with every check passing.
 *   3. A vendor discount reduces that cost, and was remembered informally
 *      rather than folded into the sum.
 *
 * Pure. No DB, no React, integers throughout.
 */

export interface GatewayFees {
  gateway: string;
  feePercentBp: number;
  /** Fixed amount per transaction, in the gateway's minor units. */
  feeFixedMinor: number;
  /** GST the gateway charges on its own fee. 0 for a foreign gateway. */
  feeGstBp: number;
  /** Extra bp when the card is foreign. */
  intlSurchargeBp: number;
}

export interface CostLine {
  label: string;
  vendor: string;
  costKind: 'per_sale' | 'per_month' | 'per_unit';
  amountMinor: number;
  expectedUnits?: number | null;
  /** What the vendor knocks off OUR bill. Not a customer discount. */
  vendorDiscountBp: number;
}

export interface SaleInput {
  /** What the customer is charged, tax inclusive, in minor units. */
  chargedMinor: number;
  currency: Currency;
  /** 0 for an export -- zero-rated, so no GST is collected or owed. */
  gstRateBp: number;
  gateway: GatewayFees;
  /** True when the buyer is outside India, which triggers the surcharge. */
  international: boolean;
  costs: CostLine[];
  /** Flat infrastructure attributed to one sale (R2, bandwidth). */
  hostingMinor?: number;
  /** For a subscription: how many months of per_month cost this sale buys. */
  monthsCovered?: number;
}

export interface SaleBreakdown {
  chargedMinor: number;
  gstMinor: number;
  gatewayFeeMinor: number;
  gatewayFeeGstMinor: number;
  vendorCostMinor: number;
  hostingMinor: number;
  netMinor: number;
  netPercent: number;
  /** Per cost line, after its vendor discount -- so the biggest cost is visible. */
  costBreakdown: { label: string; vendor: string; minor: number }[];
}

/** One cost line's true cost for this sale, after the vendor's discount. */
export function costLineMinor(line: CostLine, monthsCovered: number): number {
  const units =
    line.costKind === 'per_unit' ? (line.expectedUnits ?? 0)
    : line.costKind === 'per_month' ? monthsCovered
    : 1;
  const gross = line.amountMinor * units;
  // Round the discount and subtract, never round the result -- the same rule
  // the customer-facing discount follows, for the same reason.
  const off = Math.round((gross * line.vendorDiscountBp) / 10000);
  return Math.max(0, Math.round(gross - off));
}

/** The gateway's cut: percentage (+ surcharge) + fixed, then GST on all of it. */
export function gatewayCostMinor(
  chargedMinor: number,
  g: GatewayFees,
  international: boolean,
): { feeMinor: number; feeGstMinor: number } {
  const bp = g.feePercentBp + (international ? g.intlSurchargeBp : 0);
  // The gateway takes its cut of the FULL amount charged, GST included -- it
  // neither knows nor cares which part of it is tax.
  const feeMinor = Math.round((chargedMinor * bp) / 10000) + g.feeFixedMinor;
  const feeGstMinor = Math.round((feeMinor * g.feeGstBp) / 10000);
  return { feeMinor, feeGstMinor };
}

export function analyseSale(input: SaleInput): SaleBreakdown {
  const charged = Math.max(0, Math.round(input.chargedMinor));
  const months = input.monthsCovered ?? 1;

  // Tax-inclusive: extract the GST sitting inside the charged amount. An export
  // is zero-rated, so gstRateBp is 0 and nothing is extracted.
  const base = Math.round((charged * 10000) / (10000 + input.gstRateBp));
  const gstMinor = charged - base;

  const { feeMinor, feeGstMinor } = gatewayCostMinor(charged, input.gateway, input.international);

  const costBreakdown = input.costs.map((c) => ({
    label: c.label,
    vendor: c.vendor,
    minor: costLineMinor(c, months),
  }));
  const vendorCostMinor = costBreakdown.reduce((n, c) => n + c.minor, 0);
  const hostingMinor = input.hostingMinor ?? 0;

  const netMinor = base - feeMinor - feeGstMinor - vendorCostMinor - hostingMinor;

  return {
    chargedMinor: charged,
    gstMinor,
    gatewayFeeMinor: feeMinor,
    gatewayFeeGstMinor: feeGstMinor,
    vendorCostMinor,
    hostingMinor,
    netMinor,
    netPercent: charged > 0 ? Math.round((netMinor / charged) * 1000) / 10 : 0,
    costBreakdown,
  };
}

/**
 * Work backwards: what must be charged so that, after EVERYTHING, the target
 * survives -- including the advertised discount.
 *
 * Solved by iteration rather than algebraically: the fixed gateway fee and the
 * rounding at each step make a closed form fragile, and twenty passes converges
 * to the paisa. Each pass re-runs the real analyseSale(), so the answer cannot
 * disagree with what is actually charged.
 */
export function priceForTarget(
  targetNetMinor: number,
  discountBp: number,
  input: Omit<SaleInput, 'chargedMinor'>,
): { listMinor: number; chargedMinor: number; achievedNetMinor: number } {
  const disc = Math.max(0, Math.min(9999, Math.round(discountBp)));
  let charged = Math.max(1, targetNetMinor);

  for (let i = 0; i < 24; i++) {
    const { netMinor } = analyseSale({ ...input, chargedMinor: charged });
    const gap = targetNetMinor - netMinor;
    if (gap <= 0) break;
    // Step by the shortfall grossed up for tax; converges from below, so it
    // never lands under the target.
    charged += Math.max(1, Math.ceil(gap * (1 + input.gstRateBp / 10000)));
  }

  // Inflate so the price AFTER the discount is still what must be charged.
  const listMinor = Math.ceil((charged * 10000) / (10000 - disc));
  const saved = Math.round((listMinor * disc) / 10000);
  const actual = listMinor - saved;

  return {
    listMinor,
    chargedMinor: actual,
    achievedNetMinor: analyseSale({ ...input, chargedMinor: actual }).netMinor,
  };
}
