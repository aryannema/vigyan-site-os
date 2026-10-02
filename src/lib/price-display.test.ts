import { describe, it, expect } from 'vitest';
import { formatAmount, formatPrice, cheapest, defaultPrice, annualSavingBp, currencyForPhone, tiersFor, priceFor, monthlyEquivalentMinor, monthsCovered, type PriceRow } from './price-display';

const row = (o: Partial<PriceRow> = {}): PriceRow => ({
  id: 'x', nickname: 'Standard', price_model: 'fixed', amount_minor: 99900, currency: 'INR',
  billing_period: 'one_time', interval_count: 1, unit: 'flat', min_units: null,
  sort_order: 0, is_default: false, ...o,
});

describe('formatAmount', () => {
  it('uses Indian grouping for INR and Western for USD', () => {
    expect(formatAmount(15000000, 'INR')).toBe('₹1,50,000');   // lakh grouping
    expect(formatAmount(15000000, 'USD')).toBe('$150,000');
  });
  it('drops decimals on whole amounts, keeps them otherwise', () => {
    expect(formatAmount(99900, 'INR')).toBe('₹999');
    expect(formatAmount(99950, 'INR')).toBe('₹999.50');  // money always shows both decimals
  });
});

describe('formatPrice', () => {
  it('labels a quote without inventing a number', () => {
    expect(formatPrice(row({ price_model: 'quote', amount_minor: null }))).toBe('Talk to us');
  });
  it('labels zero as Free, not ₹0', () => {
    expect(formatPrice(row({ amount_minor: 0 }))).toBe('Free');
  });
  it('shows the term for recurring prices', () => {
    expect(formatPrice(row({ amount_minor: 99900, billing_period: 'month' }))).toBe('₹999/mo');
    expect(formatPrice(row({ amount_minor: 999000, billing_period: 'year' }))).toBe('₹9,990/yr');
  });
  it('shows "From" for an open-ended band', () => {
    expect(formatPrice(row({ price_model: 'from', amount_minor: 15000000 }))).toBe('From ₹1,50,000');
  });
  it('shows the unit and minimum for hourly work', () => {
    expect(formatPrice(row({ amount_minor: 600000, unit: 'hour', min_units: 10 })))
      .toBe('₹6,000/hour (10 hour min)');
  });
  it('handles USD', () => {
    expect(formatPrice(row({ amount_minor: 1900, currency: 'USD', billing_period: 'month' }))).toBe('$19/mo');
  });
});

describe('annualSavingBp', () => {
  it('derives the saving from the two rows', () => {
    // ₹999/mo × 12 = ₹11,988 vs ₹9,990 annual -> 16.67%
    const prices = [row({ amount_minor: 99900, billing_period: 'month' }),
                    row({ amount_minor: 999000, billing_period: 'year' })];
    expect(annualSavingBp(prices, 'INR')).toBe(1667);
  });
  it('returns null rather than a negative saving', () => {
    // An annual price that is not actually cheaper must not print "save -4%".
    const prices = [row({ amount_minor: 99900, billing_period: 'month' }),
                    row({ amount_minor: 1300000, billing_period: 'year' })];
    expect(annualSavingBp(prices, 'INR')).toBeNull();
  });
  it('returns null when the pair is incomplete', () => {
    expect(annualSavingBp([row({ billing_period: 'month' })], 'INR')).toBeNull();
    expect(annualSavingBp([], 'INR')).toBeNull();
  });
  it('does not mix currencies', () => {
    // A USD annual against an INR monthly would produce nonsense.
    const prices = [row({ amount_minor: 99900, billing_period: 'month', currency: 'INR' }),
                    row({ amount_minor: 19000, billing_period: 'year', currency: 'USD' })];
    expect(annualSavingBp(prices, 'INR')).toBeNull();
    expect(annualSavingBp(prices, 'USD')).toBeNull();
  });
});

describe('cheapest / defaultPrice', () => {
  const prices = [
    row({ id: 'm', amount_minor: 99900, billing_period: 'month' }),
    row({ id: 'y', amount_minor: 999000, billing_period: 'year', is_default: true }),
    row({ id: 'u', amount_minor: 1900, currency: 'USD', billing_period: 'month' }),
  ];
  it('picks the cheapest within one currency only', () => {
    expect(cheapest(prices, 'INR')!.id).toBe('m');
    expect(cheapest(prices, 'USD')!.id).toBe('u');
  });
  it('prefers the flagged default over the cheapest', () => {
    expect(defaultPrice(prices, 'INR')!.id).toBe('y');
  });
  it('falls back to cheapest when nothing is flagged', () => {
    expect(defaultPrice(prices.map((p) => ({ ...p, is_default: false })), 'INR')!.id).toBe('m');
  });
  it('ignores quote rows when finding a number', () => {
    expect(cheapest([row({ price_model: 'quote', amount_minor: null })], 'INR')).toBeNull();
  });
});

describe('currencyForPhone', () => {
  it('bills Indian numbers in INR and everyone else in USD', () => {
    expect(currencyForPhone('919740796662')).toBe('INR');
    expect(currencyForPhone('+91 97407 96662')).toBe('INR');
    expect(currencyForPhone('14155552671')).toBe('USD');
    expect(currencyForPhone('447911123456')).toBe('USD');
    expect(currencyForPhone('')).toBe('USD');
  });
});

describe('SaaS tiers', () => {
  // The grid: tier x term x currency. Deliberately mixed order, because real
  // rows arrive in insertion order, not a convenient one.
  const grid: PriceRow[] = [
    row({ id: 'f-m', tier: 'free', tier_rank: 0, nickname: 'Free',  amount_minor: 0,      billing_period: 'month' }),
    row({ id: 'p-y', tier: 'pro',  tier_rank: 1, nickname: 'Pro',   amount_minor: 999000, billing_period: 'year' }),
    row({ id: 'f-y', tier: 'free', tier_rank: 0, nickname: 'Free',  amount_minor: 0,      billing_period: 'year' }),
    row({ id: 'p-m', tier: 'pro',  tier_rank: 1, nickname: 'Pro',   amount_minor: 99900,  billing_period: 'month', is_recommended: true }),
    row({ id: 's-m', tier: 'scale', tier_rank: 2, nickname: 'Scale', amount_minor: 299900, billing_period: 'month' }),
  ];

  it('derives the annual saving WITHIN a tier, not across tiers', () => {
    // Pro: 999x12 = 11,988 vs 9,990 annual -> 16.67%.
    expect(annualSavingBp(grid, 'INR', 'pro')).toBe(1667);
  });

  it('does NOT compare Free-monthly to Pro-annual', () => {
    // The bug this test exists for: without a tier filter, .find() takes the
    // first month row (Free, 0) and the first year row (Pro), and prints
    // nonsense to a customer as a saving.
    const naive = annualSavingBp(grid, 'INR', 'free');
    expect(naive).toBeNull();                       // free has nothing to save
    expect(annualSavingBp(grid, 'INR', 'scale')).toBeNull();  // monthly only
  });

  it('never divides by zero on a free tier', () => {
    expect(annualSavingBp(grid, 'INR', 'free')).toBeNull();
  });

  it('lists tiers cheapest first, whatever order the rows arrive in', () => {
    expect(tiersFor(grid, 'INR')).toEqual(['free', 'pro', 'scale']);
  });

  it('picks the exact cell of the grid', () => {
    expect(priceFor(grid, 'INR', 'pro', 'month')!.id).toBe('p-m');
    expect(priceFor(grid, 'INR', 'pro', 'year')!.id).toBe('p-y');
    expect(priceFor(grid, 'INR', 'scale', 'year')).toBeNull();   // not offered
  });

  it('keeps working for untiered products', () => {
    // A one-off product or a service band has tier = null and must not be
    // broken by tier logic existing.
    const flat = [row({ amount_minor: 99900, billing_period: 'month' }),
                  row({ amount_minor: 999000, billing_period: 'year' })];
    expect(annualSavingBp(flat, 'INR', null)).toBe(1667);
    expect(tiersFor(flat, 'INR')).toEqual([]);
    expect(priceFor(flat, 'INR', null, 'month')).not.toBeNull();
  });
});

describe('annual margin trap', () => {
  const monthly = row({ amount_minor: 99900, billing_period: 'month', tier: 'pro' });
  const annual  = row({ amount_minor: 999000, billing_period: 'year', tier: 'pro' });

  it('derives the saving from the pair', () => {
    expect(annualSavingBp([monthly, annual], 'INR', 'pro')).toBe(1667);   // 16.67%
  });

  it('shows annual earns LESS per month, which is the trap', () => {
    // The saving the customer sees IS revenue we forgo, every month, while the
    // vendor cost carries on unchanged. Checking a floor against the ₹9,990
    // sticker passes something that loses money.
    expect(monthlyEquivalentMinor(monthly)).toBe(99900);
    expect(monthlyEquivalentMinor(annual)).toBe(83250);
    expect(monthlyEquivalentMinor(annual)!).toBeLessThan(monthlyEquivalentMinor(monthly)!);
  });

  it('reports how many months of cost each purchase must cover', () => {
    expect(monthsCovered(monthly)).toBe(1);
    expect(monthsCovered(annual)).toBe(12);
    expect(monthsCovered(row({ billing_period: 'one_time' }))).toBe(1);
  });

  it('handles a multi-month interval', () => {
    const quarterly = row({ amount_minor: 299700, billing_period: 'month', interval_count: 3 });
    expect(monthsCovered(quarterly)).toBe(3);
    expect(monthlyEquivalentMinor(quarterly)).toBe(99900);
  });

  it('treats a quote as having no monthly equivalent rather than zero', () => {
    expect(monthlyEquivalentMinor(row({ price_model: 'quote', amount_minor: null }))).toBeNull();
  });
});
