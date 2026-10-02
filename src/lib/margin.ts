/**
 * What a sale actually leaves you with.
 *
 * Built because "add a markup for hosting" deserves a real number rather than a
 * guessed percentage. The finding, once the arithmetic is done, is that hosting
 * is not the cost worth pricing for -- the gateway fee and GST are roughly a
 * thousand times larger. See hostingCostPaise() below.
 *
 * Every rate is configurable (app_config) because they are set by Razorpay,
 * Cloudflare and the government, not by this codebase.
 */

/** Cloudflare R2, list price, verified 2026-09-16. Egress is free — that is the point of R2. */
export const R2 = {
  freeStorageGb: 10,
  storageUsdPerGbMonth: 0.015,
  /** Class B = reads/downloads. 10 million free each month. */
  freeReadOps: 10_000_000,
  readUsdPerMillion: 0.36,
  egressUsdPerGb: 0, // free, unlike S3's ~$0.09
} as const;

export interface HostingInput {
  /** Size of the downloadable, in megabytes. */
  fileSizeMb: number;
  /** Expected downloads per month across all buyers. */
  downloadsPerMonth: number;
  /** How many products share the free tier. */
  totalHostedGb?: number;
  usdToInr: number;
}

/**
 * Hosting cost per download, in paise.
 *
 * Returns approximately zero for any realistic indie scale, and that is the
 * useful result: a 200 MB build downloaded a thousand times a month costs a
 * fraction of a rupee in total. Marking the price up "for hosting" would be
 * pricing for a cost that is not there.
 */
export function hostingCostPaise(input: HostingInput): {
  perDownloadPaise: number;
  monthlyPaise: number;
  withinFreeTier: boolean;
} {
  const storedGb = input.totalHostedGb ?? input.fileSizeMb / 1024;
  const billableGb = Math.max(0, storedGb - R2.freeStorageGb);
  const billableOps = Math.max(0, input.downloadsPerMonth - R2.freeReadOps);

  const monthlyUsd =
    billableGb * R2.storageUsdPerGbMonth +
    (billableOps / 1_000_000) * R2.readUsdPerMillion;

  const monthlyPaise = Math.round(monthlyUsd * input.usdToInr * 100);

  return {
    monthlyPaise,
    perDownloadPaise:
      input.downloadsPerMonth > 0 ? Math.round(monthlyPaise / input.downloadsPerMonth) : 0,
    withinFreeTier: billableGb === 0 && billableOps === 0,
  };
}

export interface MarginInput {
  /** What the customer pays, in paise, tax included. */
  chargedPaise: number;
  /** GST already inside that, in paise. */
  gstPaise: number;
  /** Gateway fee percentage in basis points. Razorpay's domestic standard rate is around 200 (2%) — confirm yours. */
  gatewayFeeBp: number;
  /** GST charged ON the gateway's fee, in basis points. Normally 1800. */
  gatewayFeeGstBp: number;
  /** Hosting attributable to this sale, in paise. */
  hostingPaise: number;
}

export interface MarginResult {
  chargedPaise: number;
  gstPaise: number;
  gatewayFeePaise: number;
  gatewayFeeGstPaise: number;
  hostingPaise: number;
  /** What actually reaches the bank, less costs. */
  netPaise: number;
  /** Net as a percentage of what the customer paid. */
  netPercent: number;
}

export function margin(input: MarginInput): MarginResult {
  // The gateway takes its cut of the FULL amount charged, GST included -- it
  // does not know or care which part is tax.
  const gatewayFeePaise = Math.round((input.chargedPaise * input.gatewayFeeBp) / 10000);
  const gatewayFeeGstPaise = Math.round((gatewayFeePaise * input.gatewayFeeGstBp) / 10000);

  const netPaise =
    input.chargedPaise -
    input.gstPaise -          // collected on the government's behalf, never ours
    gatewayFeePaise -
    gatewayFeeGstPaise -
    input.hostingPaise;

  return {
    chargedPaise: input.chargedPaise,
    gstPaise: input.gstPaise,
    gatewayFeePaise,
    gatewayFeeGstPaise,
    hostingPaise: input.hostingPaise,
    netPaise,
    netPercent: input.chargedPaise > 0
      ? Math.round((netPaise / input.chargedPaise) * 1000) / 10
      : 0,
  };
}


export interface GrossUpInput {
  /** What you want to be left with, in paise, after GST, the gateway and hosting. */
  targetNetPaise: number;
  /** GST rate on the product, in basis points. */
  gstRateBp: number;
  gatewayFeeBp: number;
  gatewayFeeGstBp: number;
  /**
   * Hosting attributable to one sale, in paise. A flat cost, unlike the
   * percentage ones, so it is added to the target BEFORE the gross-up rather
   * than folded into the divisor -- otherwise the price would not cover it.
   */
  hostingPerSalePaise?: number;
}

/**
 * The price to charge so that a chosen amount actually reaches you.
 *
 * This is what "add a markup to cover the gateway" has to mean arithmetically.
 * A FLAT markup cannot do it, because the gateway fee is a percentage: ₹10
 * added to a ₹99 sale over-covers its ₹2.34 fee by three and a half times,
 * while the same ₹10 on a ₹9,999 sale covers 3% of its ₹236 fee.
 *
 * A flat markup also does not even deliver itself. Add ₹10 to a tax-inclusive
 * price and ₹1.53 leaves as GST and 2% of the rest goes to the gateway, so
 * about ₹8.24 arrives. Anything that has to cover a percentage has to BE a
 * percentage, which is what this solves for:
 *
 *   net = price/(1+gst) − price×fee×(1+feeGst)
 *   price = net / [ 1/(1+gst) − fee×(1+feeGst) ]
 */
export function priceForTargetNet(input: GrossUpInput): {
  pricePaise: number;
  /** What the price had to rise by, over the naive net + GST. */
  upliftPaise: number;
  achievedNetPaise: number;
} {
  const gst = input.gstRateBp / 10000;
  const fee = input.gatewayFeeBp / 10000;
  const feeGst = input.gatewayFeeGstBp / 10000;

  const divisor = 1 / (1 + gst) - fee * (1 + feeGst);
  if (divisor <= 0) {
    // Only reachable with absurd rates, but a negative divisor would silently
    // return a negative price rather than failing.
    throw new Error('Those rates leave nothing to gross up — check the fee and GST.');
  }

  // Hosting is a flat cost per sale, so it joins the target and is then grossed
  // up with it -- the price has to cover the hosting AND the tax and fee levied
  // on the part that covers the hosting.
  const mustCover = input.targetNetPaise + (input.hostingPerSalePaise ?? 0);
  const pricePaise = Math.ceil(mustCover / divisor);

  const base = Math.round((pricePaise * 10000) / (10000 + input.gstRateBp));
  const gatewayFee = Math.round((pricePaise * input.gatewayFeeBp) / 10000);
  const gatewayFeeGst = Math.round((gatewayFee * input.gatewayFeeGstBp) / 10000);

  return {
    pricePaise,
    upliftPaise: pricePaise - Math.round(input.targetNetPaise * (1 + gst)),
    achievedNetPaise: base - gatewayFee - gatewayFeeGst - (input.hostingPerSalePaise ?? 0),
  };
}


export interface FloorPolicy {
  /** Absolute minimum you must keep on any sale, in paise. */
  minNetPaise: number;
  /** And at least this share of what the customer paid, in basis points. */
  minNetBp: number;
  gstRateBp: number;
  gatewayFeeBp: number;
  gatewayFeeGstBp: number;
  /** Hosting attributable to one sale, in paise. */
  hostingPerSalePaise?: number;
}

export interface FloorCheck {
  ok: boolean;
  netPaise: number;
  /** The binding requirement, in paise — whichever of the two is higher. */
  requiredPaise: number;
  shortfallPaise: number;
  /** A price that would satisfy the floor. */
  suggestedPricePaise: number;
  reason: string;
}

/**
 * Whether a sale at this price clears the minimum cut.
 *
 * Checked against the price the customer ACTUALLY PAYS, which during an offer
 * is the discounted price, not the list price. That distinction is the whole
 * point: a product priced comfortably above the floor can be pushed under it by
 * a discount, and the list price would never reveal it.
 *
 * Two requirements, and the higher binds. The absolute floor stops a cheap item
 * being sold at a loss once the gateway has taken its cut; the percentage floor
 * stops an expensive item being discounted into a thin margin that the absolute
 * floor alone would wave through.
 */
export function checkFloor(chargedPaise: number, policy: FloorPolicy): FloorCheck {
  const base = Math.round((chargedPaise * 10000) / (10000 + policy.gstRateBp));
  const fee = Math.round((chargedPaise * policy.gatewayFeeBp) / 10000);
  const feeGst = Math.round((fee * policy.gatewayFeeGstBp) / 10000);
  const netPaise = base - fee - feeGst - (policy.hostingPerSalePaise ?? 0);

  const byPercent = Math.round((chargedPaise * policy.minNetBp) / 10000);
  const requiredPaise = Math.max(policy.minNetPaise, byPercent);
  const binding = policy.minNetPaise >= byPercent ? 'absolute' : 'percentage';

  const ok = netPaise >= requiredPaise;

  // What price WOULD clear it. For the percentage floor the required amount
  // moves with the price, so solve for the absolute equivalent at this price.
  const suggested = priceForTargetNet({
    targetNetPaise: requiredPaise,
    gstRateBp: policy.gstRateBp,
    gatewayFeeBp: policy.gatewayFeeBp,
    gatewayFeeGstBp: policy.gatewayFeeGstBp,
    hostingPerSalePaise: policy.hostingPerSalePaise,
  }).pricePaise;

  return {
    ok,
    netPaise,
    requiredPaise,
    shortfallPaise: Math.max(0, requiredPaise - netPaise),
    suggestedPricePaise: suggested,
    reason: ok
      ? `Keeps ₹${(netPaise / 100).toFixed(2)} of ₹${(chargedPaise / 100).toFixed(2)}.`
      : binding === 'absolute'
        ? `Keeps only ₹${(netPaise / 100).toFixed(2)}, below the ₹${(policy.minNetPaise / 100).toFixed(2)} minimum.`
        : `Keeps only ₹${(netPaise / 100).toFixed(2)}, which is under ${policy.minNetBp / 100}% of ₹${(chargedPaise / 100).toFixed(2)}.`,
  };
}

/**
 * The deepest discount a price can carry and still clear the floor.
 *
 * Shown next to the discount field so the limit is known before a number is
 * typed, rather than as a rejection after.
 */
export function maxDiscountBp(listPricePaise: number, policy: FloorPolicy): number {
  if (listPricePaise <= 0) return 0;
  // Binary search: the relationship is monotonic, and this avoids inverting
  // the max() of two floors that move differently.
  let lo = 0;
  let hi = 10000;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const charged = listPricePaise - Math.round((listPricePaise * mid) / 10000);
    if (checkFloor(charged, policy).ok) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}


export interface CampaignInput {
  /** What you must be left with on each sale, in paise. */
  targetNetPaise: number;
  /** The discount you want to advertise, in basis points. 6000 = "60% off". */
  advertisedDiscountBp: number;
  gstRateBp: number;
  gatewayFeeBp: number;
  gatewayFeeGstBp: number;
  hostingPerSalePaise?: number;
}

export interface CampaignPricing {
  /** The struck-through price to show. */
  listPricePaise: number;
  /** What the customer actually pays. */
  salePricePaise: number;
  /** The saving the banner can claim. */
  savingPaise: number;
  netPaise: number;
  discountPercent: number;
}

/**
 * Works a campaign backwards from the margin instead of forwards from a price.
 *
 * The usual way round is to pick a price, apply a discount, and find out
 * afterwards whether anything is left. This starts from what must be left and
 * derives the list price that makes the advertised discount affordable:
 *
 *   sale = net / (1 − gst_share − fee_share)      // the gross-up, as before
 *   list = sale / (1 − discount)
 *
 * So "keep ₹823 and advertise 60% off" gives a ₹2,497 list price selling at
 * ₹999. The discount is real arithmetic against a real list price -- it is not
 * a number invented for a banner, and the floor is satisfied by construction
 * rather than checked afterwards.
 */
export function campaignPricing(input: CampaignInput): CampaignPricing {
  if (input.advertisedDiscountBp < 0 || input.advertisedDiscountBp >= 10000) {
    throw new Error('A discount must be between 0 and 100 percent, exclusive of 100.');
  }

  const salePricePaise = priceForTargetNet({
    targetNetPaise: input.targetNetPaise,
    gstRateBp: input.gstRateBp,
    gatewayFeeBp: input.gatewayFeeBp,
    gatewayFeeGstBp: input.gatewayFeeGstBp,
    hostingPerSalePaise: input.hostingPerSalePaise,
  }).pricePaise;

  const listPricePaise = Math.round(
    (salePricePaise * 10000) / (10000 - input.advertisedDiscountBp),
  );

  // Re-derive the net from the list price and discount actually stored, rather
  // than trusting the target: rounding the list price moves the sale price a
  // paisa or two, and the number shown should be the one that will occur.
  const actualSale =
    listPricePaise - Math.round((listPricePaise * input.advertisedDiscountBp) / 10000);
  const base = Math.round((actualSale * 10000) / (10000 + input.gstRateBp));
  const fee = Math.round((actualSale * input.gatewayFeeBp) / 10000);
  const feeGst = Math.round((fee * input.gatewayFeeGstBp) / 10000);

  return {
    listPricePaise,
    salePricePaise: actualSale,
    savingPaise: listPricePaise - actualSale,
    netPaise: base - fee - feeGst - (input.hostingPerSalePaise ?? 0),
    discountPercent: input.advertisedDiscountBp / 100,
  };
}


// ── Target earnings, through a discount ──────────────────────────────────────

export interface ListPriceInput extends GrossUpInput {
  /** The discount you intend to advertise, in basis points. 2000 = 20% off. */
  discountBp: number;
}

export interface ListPriceResult {
  /** Set this as the product's price. */
  listPricePaise: number;
  /** What the customer actually pays after the discount. */
  chargedPaise: number;
  /** The headline saving they see. */
  savedPaise: number;
  /** What you keep once GST, the gateway and hosting are paid. */
  achievedNetPaise: number;
  /** What the list price would have been at full price, for comparison. */
  undiscountedPricePaise: number;
}

/**
 * Work backwards from what you want to EARN, through the discount you intend to
 * advertise, to the list price you should set.
 *
 * priceForTargetNet() answers "what must the customer PAY for me to keep X".
 * That is not the number you type into the product form when you plan to
 * discount: a 20% off sticker cuts what they pay, so the list price has to be
 * inflated first or the discount comes straight out of your margin.
 *
 * The order matters and is the whole point:
 *   1. gross up the target for GST, gateway fee and hosting  -> what they must PAY
 *   2. inflate THAT for the discount                         -> what you LIST
 *
 * Doing it the other way round -- discounting a price that was grossed up for
 * the target -- lands below the target every time.
 */
export function listPriceForTargetNet(input: ListPriceInput): ListPriceResult {
  const discountBp = Math.max(0, Math.min(9999, Math.round(input.discountBp)));

  // Step 1: what the customer must actually pay for the target to survive.
  const atFullPrice = priceForTargetNet(input);
  const chargedPaise = atFullPrice.pricePaise;

  // Step 2: inflate so that price, AFTER the discount, is still what they pay.
  // ceil, never round: rounding down lands a paisa under the target.
  const listPricePaise = Math.ceil((chargedPaise * 10000) / (10000 - discountBp));

  // Recompute what the customer pays from the list price the seller will type,
  // using the same rounding as priceState() -- so this agrees with the product
  // page and the checkout rather than being a parallel calculation.
  const savedPaise = Math.round((listPricePaise * discountBp) / 10000);
  const actuallyCharged = listPricePaise - savedPaise;

  const base = Math.round((actuallyCharged * 10000) / (10000 + input.gstRateBp));
  const fee = Math.round((actuallyCharged * input.gatewayFeeBp) / 10000);
  const feeGst = Math.round((fee * input.gatewayFeeGstBp) / 10000);

  return {
    listPricePaise,
    chargedPaise: actuallyCharged,
    savedPaise,
    achievedNetPaise: base - fee - feeGst - (input.hostingPerSalePaise ?? 0),
    undiscountedPricePaise: chargedPaise,
  };
}
