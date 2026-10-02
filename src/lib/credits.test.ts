import { describe, it, expect } from 'vitest';
import { unitCostAfterDiscount, allowanceCost, checkTierMargin, overageMarkupBp, creditPrice, checkCreditMarkups, priceCompetitively, type CreditType, type PlanCredit } from './credits';

const image: CreditType = { key: 'image', label: 'Image', unitCostMinor: 200, vendorDiscountBp: 0 };
const minute: CreditType = { key: 'minute', label: 'Minute', unitCostMinor: 50, vendorDiscountBp: 2000 };
const types = { image, minute };

describe('vendor discount', () => {
  it('reduces what a unit really costs us', () => {
    expect(unitCostAfterDiscount(image)).toBe(200);
    expect(unitCostAfterDiscount(minute)).toBe(40);      // 50 less 20%
  });
});

describe('allowance cost', () => {
  it('prices the allowance at FULL consumption, not average', () => {
    // Average is the comfortable number and the wrong one: a plan that only
    // works while customers under-use it breaks when they start getting value.
    const credits: PlanCredit[] = [{ creditKey: 'image', includedQty: 500, overagePriceMinor: 300 }];
    expect(allowanceCost(credits, types).totalMinor).toBe(500 * 200);
  });

  it('flags unlimited rather than treating it as free', () => {
    const credits: PlanCredit[] = [{ creditKey: 'image', includedQty: null, overagePriceMinor: null }];
    const r = allowanceCost(credits, types);
    expect(r.hasUnlimited).toBe(true);
    expect(r.totalMinor).toBe(0);      // reported as 0, but flagged
  });
});

describe('checkTierMargin', () => {
  const credits: PlanCredit[] = [{ creditKey: 'image', includedQty: 500, overagePriceMinor: 300 }];

  it('CATCHES the loss this whole thing exists to prevent', () => {
    // Pro at ₹999/mo. After GST and gateway we keep ~₹823. 500 images at ₹2
    // cost ₹1,000 -- a loss on every subscriber, growing with every signup,
    // invisible until a vendor invoice arrives.
    const r = checkTierMargin(82300, credits, types);
    expect(r.ok).toBe(false);
    expect(r.netAfterCreditsMinor).toBeLessThan(0);
    expect(r.reason).toContain('loss');
  });

  it('passes when the allowance genuinely fits', () => {
    const r = checkTierMargin(150000, credits, types);
    expect(r.ok).toBe(true);
    expect(r.netAfterCreditsMinor).toBe(150000 - 100000);
  });

  it('enforces a floor, not merely break-even', () => {
    expect(checkTierMargin(105000, credits, types, 10000).ok).toBe(false);
    expect(checkTierMargin(115000, credits, types, 10000).ok).toBe(true);
  });

  it('never passes an unlimited allowance on arithmetic alone', () => {
    // Unbounded cost against fixed revenue is a judgement call. Passing it
    // silently is how it gets made by accident.
    const unlimited: PlanCredit[] = [{ creditKey: 'image', includedQty: null, overagePriceMinor: null }];
    const r = checkTierMargin(9999999, unlimited, types);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('UNLIMITED');
  });
});

describe('markup', () => {
  it('charges cost plus the markup, rounded UP', () => {
    // Rounding to nearest would price some credits BELOW cost, which is the
    // one outcome this exists to stop.
    expect(creditPrice(image, { minMarkupBp: 2000 })).toBe(240);
    expect(creditPrice(image, { minMarkupBp: 2000, roundToMinor: 100 })).toBe(300);
  });

  it('never returns a price at or below cost', () => {
    for (const bp of [0, 1, 50, 100]) {
      const p = creditPrice(image, { minMarkupBp: bp });
      expect(p).toBeGreaterThan(unitCostAfterDiscount(image));
    }
  });

  it('leaves a free unit free', () => {
    expect(creditPrice({ key: 'x', label: 'X', unitCostMinor: 0, vendorDiscountBp: 0 }, { minMarkupBp: 2000 })).toBe(0);
  });

  it('computes the markup actually being earned', () => {
    expect(overageMarkupBp({ creditKey: 'image', includedQty: 100, overagePriceMinor: 300 }, image)).toBe(5000);
    expect(overageMarkupBp({ creditKey: 'image', includedQty: 100, overagePriceMinor: 150 }, image)).toBe(-2500);
  });

  it('flags every credit priced under the floor, and says what to charge', () => {
    const credits: PlanCredit[] = [
      { creditKey: 'image', includedQty: 100, overagePriceMinor: 210 },   // only 5%
      { creditKey: 'minute', includedQty: 60, overagePriceMinor: 100 },   // 150%, fine
    ];
    const r = checkCreditMarkups(credits, types, { minMarkupBp: 2000 });
    expect(r.ok).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].creditKey).toBe('image');
    expect(r.failures[0].shouldCharge).toBe(240);
  });

  it('ignores a hard stop, which sells nothing', () => {
    const credits: PlanCredit[] = [{ creditKey: 'image', includedQty: 100, overagePriceMinor: null }];
    expect(checkCreditMarkups(credits, types, { minMarkupBp: 2000 }).ok).toBe(true);
  });
});

describe('priceCompetitively', () => {
  const today = new Date('2026-09-20T00:00:00Z');
  const fresh = '2026-09-01T00:00:00Z';
  const stale = '2026-01-01T00:00:00Z';

  it('undercuts the market when that still clears the floor', () => {
    // cost 200, floor at 20% = 240, market 400 -> undercut 5% = 380. Fine.
    const r = priceCompetitively(image, { minMarkupBp: 2000, marketLowMinor: 400, observedAt: fresh, targetUndercutBp: 500 }, today);
    expect(r.ok).toBe(true);
    expect(r.basis).toBe('market');
    expect(r.priceMinor).toBe(380);
  });

  it('REFUSES when no price is both profitable and competitive', () => {
    // This is the guesswork-becomes-a-loss case. Cost 200, floor 240, but the
    // market sells at 210. Silently matching would book a 5% margin against a
    // 20% floor -- and nobody would notice until the year end.
    const r = priceCompetitively(image, { minMarkupBp: 2000, marketLowMinor: 210, observedAt: fresh }, today);
    expect(r.ok).toBe(false);
    expect(r.basis).toBe('impossible');
    expect(r.note).toContain('Reduce the cost');
  });

  it('never returns a price below the floor, even when refusing', () => {
    const r = priceCompetitively(image, { minMarkupBp: 2000, marketLowMinor: 100, observedAt: fresh }, today);
    expect(r.priceMinor).toBeGreaterThanOrEqual(240);
  });

  it('IGNORES a stale market observation rather than trusting it', () => {
    // Competitor pages change without notice. Stale evidence used confidently
    // is worse than no evidence.
    const r = priceCompetitively(image, { minMarkupBp: 2000, marketLowMinor: 400, observedAt: stale }, today);
    expect(r.basis).toBe('markup');
    expect(r.priceMinor).toBe(240);
    expect(r.note).toContain('older than');
  });

  it('falls back to the markup floor when there is no market data, and says so', () => {
    const r = priceCompetitively(image, { minMarkupBp: 2000 }, today);
    expect(r.basis).toBe('markup');
    expect(r.note).toContain('unverified');
  });
});
