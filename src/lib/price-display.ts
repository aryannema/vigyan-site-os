/**
 * Formatting and derivation over product_prices rows.
 *
 * One place, because the product page, the WhatsApp menu, the admin list and
 * the checkout must all describe the same price the same way. Pure -- no DB, no
 * React -- so it is testable.
 */

export type BillingPeriod = 'one_time' | 'month' | 'year';
export type PriceModel = 'fixed' | 'from' | 'quote';
export type Currency = 'INR' | 'USD';

export interface PriceRow {
  id: string;
  nickname: string;
  /** Plan tier: 'free', 'pro', 'scale'. Null for anything not tiered. */
  tier?: string | null;
  tier_rank?: number;
  is_recommended?: boolean;
  price_model: PriceModel;
  amount_minor: number | null;
  currency: Currency;
  billing_period: BillingPeriod;
  interval_count: number;
  unit: string;
  min_units: number | null;
  sort_order: number;
  is_default: boolean;
}

const SYMBOL: Record<Currency, string> = { INR: '₹', USD: '$' };
const PERIOD_SUFFIX: Record<BillingPeriod, string> = { one_time: '', month: '/mo', year: '/yr' };

/** Minor units to a display string. 99900 INR -> "₹999". 1900 USD -> "$19". */
export function formatAmount(minor: number, currency: Currency): string {
  const major = minor / 100;
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return `${SYMBOL[currency]}${major.toLocaleString(locale, {
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The full label for one price row: "From ₹1,50,000", "₹999/mo", "Talk to us",
 * "₹6,000/hour (10 hour min)".
 */
export function formatPrice(p: PriceRow): string {
  if (p.price_model === 'quote' || p.amount_minor === null) return 'Talk to us';
  if (p.amount_minor === 0) return 'Free';

  const amount = formatAmount(p.amount_minor, p.currency);
  const every = p.interval_count > 1 ? `/${p.interval_count} ${p.billing_period}s` : PERIOD_SUFFIX[p.billing_period];
  const per = p.unit !== 'flat' && p.billing_period === 'one_time' ? `/${p.unit}` : '';
  const min = p.min_units ? ` (${p.min_units} ${p.unit} min)` : '';
  const prefix = p.price_model === 'from' ? 'From ' : '';

  return `${prefix}${amount}${every || per}${min}`;
}

/**
 * The cheapest real price, used for a "from ₹X" summary in a list or a menu
 * row. Quote-only products have no number, and that is not an error.
 */
export function cheapest(prices: PriceRow[], currency: Currency): PriceRow | null {
  const priced = prices.filter((p) => p.currency === currency && p.amount_minor !== null);
  if (priced.length === 0) return null;
  return priced.reduce((lo, p) => (p.amount_minor! < lo.amount_minor! ? p : lo));
}

/** The row to show by default: the flagged one, else the cheapest, else the first. */
export function defaultPrice(prices: PriceRow[], currency: Currency): PriceRow | null {
  const inCurrency = prices.filter((p) => p.currency === currency);
  return inCurrency.find((p) => p.is_default) ?? cheapest(prices, currency) ?? inCurrency[0] ?? null;
}

/**
 * The annual saving, DERIVED by comparing the year row to the month row.
 *
 * Never stored: an annual price is simply cheaper than twelve monthly ones, and
 * a stored percentage drifts the moment either price is replaced. Returns null
 * when the pair does not exist or annual is not actually cheaper -- rather than
 * printing "save -4%".
 */
export function annualSavingBp(
  prices: PriceRow[],
  currency: Currency,
  tier?: string | null,
): number | null {
  // WITHIN ONE TIER. Without this filter, .find() takes the first month row and
  // the first year row -- across tiers that is Free-monthly against Pro-annual,
  // a meaningless number printed to a customer as a saving.
  const inScope = prices.filter(
    (p) => p.currency === currency && p.amount_minor !== null &&
      (tier === undefined || (p.tier ?? null) === (tier ?? null)),
  );
  const monthly = inScope.find((p) => p.billing_period === 'month');
  const annual = inScope.find((p) => p.billing_period === 'year');
  if (!monthly || !annual) return null;

  const twelve = monthly.amount_minor! * 12;
  // A free tier has nothing to save, and dividing by zero would yield Infinity.
  if (twelve === 0) return null;
  if (annual.amount_minor! >= twelve) return null;
  return Math.round(((twelve - annual.amount_minor!) * 10000) / twelve);
}

/** The distinct tiers offered in a currency, cheapest first. */
export function tiersFor(prices: PriceRow[], currency: Currency): string[] {
  const seen = new Map<string, number>();
  for (const p of prices) {
    if (p.currency !== currency || !p.tier) continue;
    if (!seen.has(p.tier)) seen.set(p.tier, p.tier_rank ?? 0);
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([t]) => t);
}

/** The price row for one cell of the tier x term grid. */
export function priceFor(
  prices: PriceRow[],
  currency: Currency,
  tier: string | null,
  billingPeriod: BillingPeriod,
): PriceRow | null {
  return prices.find(
    (p) => p.currency === currency && (p.tier ?? null) === tier && p.billing_period === billingPeriod,
  ) ?? null;
}

/**
 * Currency for a WhatsApp contact, from their country code.
 *
 * A +91 number is billed in INR; everyone else in USD. Crude but right far more
 * often than a single hardcoded currency, and an export is zero-rated anyway --
 * so a foreign sale at the same nominal number keeps more.
 */
export function currencyForPhone(phone: string): Currency {
  return (phone ?? '').replace(/\D/g, '').startsWith('91') ? 'INR' : 'USD';
}

/**
 * Revenue per MONTH from a price row, whatever its term.
 *
 * The number that matters for a margin check on an annual plan. A ₹9,990/year
 * plan is ₹832.50/month of revenue against twelve months of vendor cost -- 17%
 * less than the ₹999 monthly plan, every month. Checking an annual price
 * against a monthly floor passes something that loses money, because ₹9,990
 * looks large next to a ₹500 floor until it is divided by twelve.
 */
export function monthlyEquivalentMinor(p: PriceRow): number | null {
  if (p.amount_minor === null) return null;
  const months =
    p.billing_period === 'year' ? 12 * p.interval_count
    : p.billing_period === 'month' ? p.interval_count
    : 0;                                   // one_time recurs never
  if (months === 0) return p.amount_minor;
  return Math.round(p.amount_minor / months);
}

/** How many months of vendor cost one purchase of this price must cover. */
export function monthsCovered(p: PriceRow): number {
  return p.billing_period === 'year' ? 12 * p.interval_count
    : p.billing_period === 'month' ? p.interval_count
    : 1;
}
