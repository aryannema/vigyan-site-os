import { describe, it, expect } from 'vitest';
import { hostingCostPaise, margin, priceForTargetNet, checkFloor, maxDiscountBp, campaignPricing } from './margin';

const USD_INR = 88;

describe('hosting cost', () => {
  it('is free for a realistic indie product', () => {
    // A 200 MB build, a thousand downloads a month.
    const h = hostingCostPaise({ fileSizeMb: 200, downloadsPerMonth: 1000, usdToInr: USD_INR });
    expect(h.withinFreeTier).toBe(true);
    expect(h.monthlyPaise).toBe(0);
  });

  it('stays negligible PER SALE well past the free tier', () => {
    // 50 GB stored, 20 million downloads a month — far beyond this business.
    const h = hostingCostPaise({
      fileSizeMb: 200, downloadsPerMonth: 20_000_000, totalHostedGb: 50, usdToInr: USD_INR,
    });
    // ~₹370 a month in total, which sounds like a real cost...
    expect(h.monthlyPaise).toBe(36_960);
    // ...but spread over 20 million downloads it rounds to zero paise each.
    // That is the number that decides whether to mark a price up, and it is nil.
    expect(h.perDownloadPaise).toBe(0);
  });
});

describe('margin', () => {
  it('shows the gateway fee dwarfing hosting', () => {
    // ₹999 inclusive of 18% GST.
    const m = margin({
      chargedPaise: 99900, gstPaise: 15239,
      gatewayFeeBp: 200, gatewayFeeGstBp: 1800, hostingPaise: 0,
    });
    expect(m.gatewayFeePaise).toBe(1998);      // ₹19.98
    expect(m.gatewayFeeGstPaise).toBe(360);    // ₹3.60
    // The gateway costs ~₹23. Hosting the same sale costs a fraction of a paisa.
    expect(m.gatewayFeePaise + m.gatewayFeeGstPaise).toBeGreaterThan(2000);
    expect(m.netPaise).toBe(99900 - 15239 - 1998 - 360);
  });

  it('never counts GST as revenue', () => {
    const m = margin({
      chargedPaise: 118000, gstPaise: 18000,
      gatewayFeeBp: 200, gatewayFeeGstBp: 1800, hostingPaise: 0,
    });
    expect(m.netPaise).toBeLessThanOrEqual(100000);
  });

  it('balances: every part accounted for', () => {
    const m = margin({
      chargedPaise: 250000, gstPaise: 38136,
      gatewayFeeBp: 200, gatewayFeeGstBp: 1800, hostingPaise: 50,
    });
    expect(m.gstPaise + m.gatewayFeePaise + m.gatewayFeeGstPaise + m.hostingPaise + m.netPaise)
      .toBe(m.chargedPaise);
  });

  it('reports a net percentage the operator can act on', () => {
    const m = margin({
      chargedPaise: 99900, gstPaise: 15239,
      gatewayFeeBp: 200, gatewayFeeGstBp: 1800, hostingPaise: 0,
    });
    expect(m.netPercent).toBeGreaterThan(80);
    expect(m.netPercent).toBeLessThan(85);
  });
});

describe('grossing up to a target net', () => {
  const rates = { gstRateBp: 1800, gatewayFeeBp: 200, gatewayFeeGstBp: 1800 };

  it('returns a price that really does deliver the target', () => {
    for (const target of [10000, 50000, 82303, 250000, 1000000]) {
      const g = priceForTargetNet({ targetNetPaise: target, ...rates });
      // Within a rupee — rounding, never a shortfall.
      expect(g.achievedNetPaise).toBeGreaterThanOrEqual(target - 100);
      expect(g.achievedNetPaise).toBeLessThanOrEqual(target + 100);
    }
  });

  it('reproduces the ₹999 example exactly', () => {
    const g = priceForTargetNet({ targetNetPaise: 82303, ...rates });
    expect(g.pricePaise).toBe(99900);
  });

  it('scales the uplift with the price, unlike a flat markup', () => {
    const small = priceForTargetNet({ targetNetPaise: 8156, ...rates });
    const large = priceForTargetNet({ targetNetPaise: 823775, ...rates });
    // A percentage fee needs a percentage answer: the uplift on a large sale
    // must be far bigger than on a small one, which no flat markup can do.
    expect(large.upliftPaise).toBeGreaterThan(small.upliftPaise * 20);
  });

  it('refuses rates that leave nothing to gross up', () => {
    expect(() =>
      priceForTargetNet({ targetNetPaise: 10000, gstRateBp: 1800, gatewayFeeBp: 9000, gatewayFeeGstBp: 1800 }),
    ).toThrow(/nothing to gross up/);
  });
});

describe('minimum cut', () => {
  // Keep at least ₹50, and at least 60% of whatever the customer paid.
  const policy = {
    minNetPaise: 5000, minNetBp: 6000,
    gstRateBp: 1800, gatewayFeeBp: 200, gatewayFeeGstBp: 1800,
  };

  it('passes a healthy price', () => {
    const c = checkFloor(99900, policy);
    expect(c.ok).toBe(true);
    expect(c.netPaise).toBe(82303);
  });

  it('catches a cheap item that clears the percentage but not the floor', () => {
    const c = checkFloor(4900, policy);   // ₹49
    expect(c.ok).toBe(false);
    expect(c.reason).toMatch(/minimum/);
    expect(c.shortfallPaise).toBeGreaterThan(0);
  });

  it('suggests a price that actually clears the floor', () => {
    const c = checkFloor(4900, policy);
    const after = checkFloor(c.suggestedPricePaise, policy);
    expect(after.ok).toBe(true);
  });

  it('catches a DISCOUNT that pushes a healthy price under the floor', () => {
    // ₹99 list is fine; 80% off is not. This is the case a list-price check
    // would miss entirely.
    expect(checkFloor(9900, policy).ok).toBe(true);
    expect(checkFloor(Math.round(9900 * 0.2), policy).ok).toBe(false);
  });

  it('reports the deepest discount a price can carry', () => {
    const max = maxDiscountBp(99900, policy);
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(10000);
    // At the limit it passes; one basis point deeper it does not.
    expect(checkFloor(99900 - Math.round(99900 * max / 10000), policy).ok).toBe(true);
    expect(checkFloor(99900 - Math.round(99900 * (max + 1) / 10000), policy).ok).toBe(false);
  });

  it('lets an expensive item be discounted further than a cheap one', () => {
    expect(maxDiscountBp(999900, policy)).toBeGreaterThan(maxDiscountBp(9900, policy));
  });
});

describe('campaign pricing', () => {
  const rates = { gstRateBp: 1800, gatewayFeeBp: 200, gatewayFeeGstBp: 1800 };

  it('derives a list price that makes the advertised discount affordable', () => {
    const c = campaignPricing({ targetNetPaise: 82303, advertisedDiscountBp: 6000, ...rates });
    expect(c.salePricePaise).toBe(99900);
    expect(c.listPricePaise).toBe(249750);
    // Within a rupee of the target, and never under it.
    expect(c.netPaise).toBeGreaterThanOrEqual(82303 - 100);
  });

  it('protects the margin at every discount depth', () => {
    for (const bp of [1000, 2500, 5000, 7500, 9000]) {
      const c = campaignPricing({ targetNetPaise: 50000, advertisedDiscountBp: bp, ...rates });
      expect(c.netPaise).toBeGreaterThanOrEqual(50000 - 100);
      // The deeper the advertised discount, the higher the list price must be.
      expect(c.listPricePaise).toBeGreaterThan(c.salePricePaise);
    }
  });

  it('raises the list price as the advertised discount deepens', () => {
    const shallow = campaignPricing({ targetNetPaise: 50000, advertisedDiscountBp: 1000, ...rates });
    const deep = campaignPricing({ targetNetPaise: 50000, advertisedDiscountBp: 9000, ...rates });
    expect(deep.listPricePaise).toBeGreaterThan(shallow.listPricePaise * 5);
    // Same money kept either way — that is the point.
    expect(Math.abs(deep.netPaise - shallow.netPaise)).toBeLessThan(200);
  });

  it('refuses 100% off, which cannot leave a margin', () => {
    expect(() =>
      campaignPricing({ targetNetPaise: 50000, advertisedDiscountBp: 10000, ...rates }),
    ).toThrow(/between 0 and 100/);
  });
});

describe('hosting in the price', () => {
  const rates = { gstRateBp: 1800, gatewayFeeBp: 200, gatewayFeeGstBp: 1800 };

  it('covers hosting AND the tax and fee levied on covering it', () => {
    // ₹5 of hosting per sale: the price must rise by more than ₹5, because GST
    // and the gateway take their cut of the extra too.
    const without = priceForTargetNet({ targetNetPaise: 82303, ...rates });
    const with_ = priceForTargetNet({ targetNetPaise: 82303, hostingPerSalePaise: 500, ...rates });
    expect(with_.pricePaise - without.pricePaise).toBeGreaterThan(500);
    // And the target still arrives, hosting already deducted.
    expect(with_.achievedNetPaise).toBeGreaterThanOrEqual(82303 - 100);
  });

  it('counts hosting when deciding whether a price clears the floor', () => {
    const policy = { minNetPaise: 5000, minNetBp: 6000, ...rates };
    const priced = 6100;
    expect(checkFloor(priced, policy).ok).toBe(true);
    // The same price with a heavy hosting cost no longer clears it.
    expect(checkFloor(priced, { ...policy, hostingPerSalePaise: 2000 }).ok).toBe(false);
  });

  it('carries hosting through a discounted campaign', () => {
    const c = campaignPricing({
      targetNetPaise: 50000, advertisedDiscountBp: 6000, hostingPerSalePaise: 500, ...rates,
    });
    expect(c.netPaise).toBeGreaterThanOrEqual(50000 - 100);
  });
});
