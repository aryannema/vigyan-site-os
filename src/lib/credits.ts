/**
 * Credit economics for a SaaS tier.
 *
 * A tier is not "₹999/month" -- it is "₹999/month for 500 images", and the 500
 * is where the margin lives. The failure this exists to catch: 500 images at ₹2
 * of vendor cost is ₹1,000 against ₹999 of revenue, a loss on every subscriber,
 * growing with every signup, invisible until a vendor invoice arrives.
 *
 * product_costs models a FLAT monthly cost and cannot see this -- the cost
 * depends on an allowance the plan itself sets.
 *
 * Pure, integer minor units throughout.
 */

export interface CreditType {
  key: string;
  label: string;
  /** What WE pay per unit, before the vendor discount. */
  unitCostMinor: number;
  vendorDiscountBp: number;
}

export interface PlanCredit {
  creditKey: string;
  /** Per billing period. null = unlimited. */
  includedQty: number | null;
  /** What we charge per extra unit. null = hard stop. */
  overagePriceMinor: number | null;
}

/** True cost of one unit, after whatever the vendor knocks off our bill. */
export function unitCostAfterDiscount(t: CreditType): number {
  const off = Math.round((t.unitCostMinor * t.vendorDiscountBp) / 10000);
  return Math.max(0, t.unitCostMinor - off);
}

export interface AllowanceCost {
  creditKey: string;
  includedQty: number | null;
  unitCostMinor: number;
  /** What the allowance costs us if a subscriber uses ALL of it. */
  worstCaseCostMinor: number;
  unlimited: boolean;
}

/**
 * What a tier's allowances cost us at FULL consumption.
 *
 * Worst case, deliberately. Average consumption is the comfortable number and
 * the wrong one to price against: a plan that only works while customers
 * under-use it is a plan that breaks when they start getting value from it.
 */
export function allowanceCost(
  credits: PlanCredit[],
  types: Record<string, CreditType>,
): { lines: AllowanceCost[]; totalMinor: number; hasUnlimited: boolean } {
  const lines = credits.map((c) => {
    const t = types[c.creditKey];
    const unit = t ? unitCostAfterDiscount(t) : 0;
    const unlimited = c.includedQty === null;
    return {
      creditKey: c.creditKey,
      includedQty: c.includedQty,
      unitCostMinor: unit,
      // Unlimited has no worst case that arithmetic can express. Reported as 0
      // and flagged, never silently treated as free.
      worstCaseCostMinor: unlimited ? 0 : unit * (c.includedQty ?? 0),
      unlimited,
    };
  });
  return {
    lines,
    totalMinor: lines.reduce((n, l) => n + l.worstCaseCostMinor, 0),
    hasUnlimited: lines.some((l) => l.unlimited),
  };
}

export interface TierMarginCheck {
  ok: boolean;
  netBeforeCreditsMinor: number;
  allowanceCostMinor: number;
  netAfterCreditsMinor: number;
  hasUnlimited: boolean;
  reason: string;
}

/**
 * Does this tier survive a subscriber who uses everything they paid for?
 *
 * `netBeforeCreditsMinor` comes from analyseSale() -- price after GST, gateway
 * and flat costs. This subtracts the allowance on top.
 */
export function checkTierMargin(
  netBeforeCreditsMinor: number,
  credits: PlanCredit[],
  types: Record<string, CreditType>,
  minNetMinor = 0,
): TierMarginCheck {
  const { totalMinor, hasUnlimited } = allowanceCost(credits, types);
  const after = netBeforeCreditsMinor - totalMinor;

  let reason: string;
  if (hasUnlimited) {
    reason = after >= minNetMinor
      ? `Keeps ${after} per period at metered usage, but an UNLIMITED allowance has no worst case — cost is unbounded against fixed revenue.`
      : `Loses money before unlimited usage is even counted.`;
  } else if (after < 0) {
    reason = `A subscriber using their full allowance costs ${totalMinor}, against ${netBeforeCreditsMinor} of net revenue — a loss of ${-after} on every one.`;
  } else if (after < minNetMinor) {
    reason = `Keeps only ${after} at full usage, below the ${minNetMinor} floor.`;
  } else {
    reason = `Keeps ${after} even if the allowance is fully used.`;
  }

  return {
    // Unlimited can never be ok by arithmetic -- it is a judgement call, and
    // passing it silently is how it gets made by accident.
    ok: !hasUnlimited && after >= minNetMinor,
    netBeforeCreditsMinor,
    allowanceCostMinor: totalMinor,
    netAfterCreditsMinor: after,
    hasUnlimited,
    reason,
  };
}

/** Markup on an overage: what we charge per extra unit against what it costs. */
export function overageMarkupBp(c: PlanCredit, t: CreditType): number | null {
  if (c.overagePriceMinor === null) return null;      // hard stop, nothing sold
  const cost = unitCostAfterDiscount(t);
  if (cost === 0) return null;                        // free to us, markup meaningless
  return Math.round(((c.overagePriceMinor - cost) * 10000) / cost);
}


// ── Markup: a small, deliberate gain on every credit ─────────────────────────

export interface MarkupPolicy {
  /** Minimum gain over cost, in basis points. 2000 = every credit earns 20%. */
  minMarkupBp: number;
  /** Round the result up to this, so prices read as prices. 100 = whole rupees. */
  roundToMinor?: number;
}

/**
 * What to charge per credit: cost plus a markup, rounded up.
 *
 * Small and applied to EVERY credit, which is the point -- a thin per-unit gain
 * that holds at any volume beats a large margin that only works until someone
 * uses the plan properly. Rounding is always UP: rounding to the nearest would
 * price some credits below cost, which is the one outcome this exists to stop.
 */
export function creditPrice(type: CreditType, policy: MarkupPolicy): number {
  const cost = unitCostAfterDiscount(type);
  const withMarkup = Math.ceil(cost * (1 + policy.minMarkupBp / 10000));
  const step = policy.roundToMinor ?? 1;
  const rounded = Math.ceil(withMarkup / step) * step;
  // A free unit stays free: marking up zero yields zero, and forcing a minimum
  // price onto something that costs nothing is a decision, not arithmetic.
  return cost === 0 ? 0 : Math.max(rounded, cost + 1);
}

/**
 * Whether every credit in a plan clears the markup floor.
 *
 * Checks the OVERAGE price, because that is the one sold per unit. The included
 * allowance is checked by checkTierMargin() instead -- it is paid for by the
 * subscription, not per credit.
 */
export function checkCreditMarkups(
  credits: PlanCredit[],
  types: Record<string, CreditType>,
  policy: MarkupPolicy,
): { ok: boolean; failures: { creditKey: string; charged: number; cost: number; markupBp: number | null; shouldCharge: number }[] } {
  const failures = [];
  for (const c of credits) {
    const t = types[c.creditKey];
    if (!t || c.overagePriceMinor === null) continue;   // hard stop sells nothing
    const cost = unitCostAfterDiscount(t);
    const markup = overageMarkupBp(c, t);
    if (markup === null || markup < policy.minMarkupBp) {
      failures.push({
        creditKey: c.creditKey,
        charged: c.overagePriceMinor,
        cost,
        markupBp: markup,
        shouldCharge: creditPrice(t, policy),
      });
    }
  }
  return { ok: failures.length === 0, failures };
}


// ── Competitive band: a floor AND a ceiling ──────────────────────────────────

export interface CompetitiveBand {
  /** Never price below this over cost. Protects the business. */
  minMarkupBp: number;
  /** The cheapest comparable offer we know of, in minor units per unit. */
  marketLowMinor?: number | null;
  /** When that observation was made. Stale evidence is not evidence. */
  observedAt?: string | null;
  /** How far under the market we aim to sit. 500 = undercut by 5%. */
  targetUndercutBp?: number;
}

export type PricingVerdict =
  | { ok: true; priceMinor: number; basis: 'markup' | 'market'; note: string }
  | { ok: false; priceMinor: number; basis: 'impossible'; note: string };

/**
 * Price a credit competitively WITHOUT pricing it into a loss.
 *
 * Two bounds, and they can conflict:
 *   floor   = cost + minMarkupBp        -- below this the business loses
 *   ceiling = market price - undercut   -- above this we are not competitive
 *
 * When the floor exceeds the ceiling, THERE IS NO PRICE THAT IS BOTH. That is a
 * real finding and the function says so rather than silently picking one:
 * either the cost has to come down (a better vendor rate, a cheaper model) or
 * the product competes on something other than price. Quietly returning the
 * market price would be exactly the guesswork that becomes a loss-making
 * business.
 *
 * A market observation older than 90 days is IGNORED rather than trusted --
 * competitor pricing pages change without notice, and stale evidence used
 * confidently is worse than no evidence.
 */
export function priceCompetitively(
  type: CreditType,
  band: CompetitiveBand,
  now: Date = new Date(),
): PricingVerdict {
  const cost = unitCostAfterDiscount(type);
  const floor = creditPrice(type, { minMarkupBp: band.minMarkupBp });

  const STALE_DAYS = 90;
  const fresh =
    band.marketLowMinor != null &&
    band.observedAt != null &&
    (now.getTime() - new Date(band.observedAt).getTime()) / 86_400_000 <= STALE_DAYS;

  if (!fresh) {
    return {
      ok: true,
      priceMinor: floor,
      basis: 'markup',
      note: band.marketLowMinor == null
        ? `No market data. Priced at cost plus ${band.minMarkupBp / 100}%. Competitiveness is unverified.`
        : `Market observation is older than ${STALE_DAYS} days and was ignored. Priced at cost plus ${band.minMarkupBp / 100}%.`,
    };
  }

  const undercut = band.targetUndercutBp ?? 0;
  const ceiling = Math.floor((band.marketLowMinor! * (10000 - undercut)) / 10000);

  if (floor > ceiling) {
    return {
      ok: false,
      priceMinor: floor,
      basis: 'impossible',
      note:
        `No price works: the floor is ${floor} (cost ${cost} plus ${band.minMarkupBp / 100}%) but the market ` +
        `sits at ${band.marketLowMinor}. Matching it would earn ${Math.round(((ceiling - cost) * 10000) / Math.max(cost, 1)) / 100}% ` +
        `against a ${band.minMarkupBp / 100}% floor. Reduce the cost or compete on something other than price.`,
    };
  }

  return {
    ok: true,
    priceMinor: ceiling,
    basis: 'market',
    note: `Priced at ${ceiling}, ${undercut / 100}% under the market's ${band.marketLowMinor}, earning ${Math.round(((ceiling - cost) * 10000) / Math.max(cost, 1)) / 100}% over cost.`,
  };
}
