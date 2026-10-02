import { describe, it, expect } from 'vitest';
import { analyseSale, priceForTarget, gatewayCostMinor, costLineMinor, type GatewayFees, type CostLine } from './economics';

const razorpay: GatewayFees = { gateway: 'razorpay', feePercentBp: 200, feeFixedMinor: 0, feeGstBp: 1800, intlSurchargeBp: 100 };
const stripe: GatewayFees   = { gateway: 'stripe',   feePercentBp: 290, feeFixedMinor: 30, feeGstBp: 0,    intlSurchargeBp: 150 };

const base = { currency: 'INR' as const, gstRateBp: 1800, gateway: razorpay, international: false, costs: [] };

describe('gateway fees', () => {
  it('adds the FIXED fee, which a percentage-only model misses entirely', () => {
    // $5.00 through Stripe: 2.9% is 15c, but the 30c fixed fee is twice that.
    const { feeMinor } = gatewayCostMinor(500, stripe, false);
    expect(feeMinor).toBe(Math.round(500 * 0.029) + 30);
    expect(feeMinor / 500).toBeGreaterThan(0.08);   // ~9%, not 2.9%
  });

  it('surcharges a foreign card', () => {
    const dom = gatewayCostMinor(100000, razorpay, false).feeMinor;
    const intl = gatewayCostMinor(100000, razorpay, true).feeMinor;
    expect(intl).toBeGreaterThan(dom);
    expect(intl - dom).toBe(Math.round(100000 * 0.01));   // +100bp
  });

  it('charges no GST on a foreign gateway fee', () => {
    expect(gatewayCostMinor(100000, stripe, false).feeGstMinor).toBe(0);
    expect(gatewayCostMinor(100000, razorpay, false).feeGstMinor).toBeGreaterThan(0);
  });
});

describe('vendor costs', () => {
  const meta: CostLine = { label: 'WhatsApp conversations', vendor: 'meta', costKind: 'per_unit', amountMinor: 80, expectedUnits: 30, vendorDiscountBp: 0 };

  it('multiplies a metered cost by expected volume', () => {
    expect(costLineMinor(meta, 1)).toBe(80 * 30);
  });

  it('applies the VENDOR discount, reducing what we owe', () => {
    expect(costLineMinor({ ...meta, vendorDiscountBp: 2500 }, 1)).toBe(Math.round(80 * 30 * 0.75));
  });

  it('bills a per-month cost for every month the sale covers', () => {
    const sarvam: CostLine = { label: 'Speech', vendor: 'sarvam', costKind: 'per_month', amountMinor: 5000, vendorDiscountBp: 0 };
    expect(costLineMinor(sarvam, 1)).toBe(5000);
    expect(costLineMinor(sarvam, 12)).toBe(60000);   // an annual plan pays 12
  });
});

describe('analyseSale', () => {
  it('never reports keeping more than was charged', () => {
    for (const charged of [100, 5000, 99900, 5000000]) {
      const r = analyseSale({ ...base, chargedMinor: charged });
      expect(r.netMinor).toBeLessThanOrEqual(charged);
    }
  });

  it('keeps more on an export, because no GST is collected', () => {
    const dom = analyseSale({ ...base, chargedMinor: 99900 });
    const exp = analyseSale({ ...base, chargedMinor: 99900, gstRateBp: 0 });
    expect(exp.gstMinor).toBe(0);
    expect(exp.netMinor).toBeGreaterThan(dom.netMinor);
  });

  it('subtracts vendor costs -- the difference between profit and loss', () => {
    const costs: CostLine[] = [
      { label: 'WhatsApp', vendor: 'meta', costKind: 'per_unit', amountMinor: 80, expectedUnits: 200, vendorDiscountBp: 0 },
      { label: 'Speech', vendor: 'sarvam', costKind: 'per_month', amountMinor: 3000, vendorDiscountBp: 1000 },
    ];
    const without = analyseSale({ ...base, chargedMinor: 99900 });
    const with_ = analyseSale({ ...base, chargedMinor: 99900, costs, monthsCovered: 1 });
    expect(with_.netMinor).toBeLessThan(without.netMinor);
    expect(with_.costBreakdown).toHaveLength(2);
    expect(with_.vendorCostMinor).toBe(16000 + 2700);
  });

  it('can go NEGATIVE when vendors cost more than the sale earns', () => {
    // The whole point of tracking costs: this must be visible, not assumed away.
    const costs: CostLine[] = [{ label: 'Video render', vendor: 'api', costKind: 'per_sale', amountMinor: 200000, vendorDiscountBp: 0 }];
    expect(analyseSale({ ...base, chargedMinor: 99900, costs }).netMinor).toBeLessThan(0);
  });

  it('handles a zero price without dividing by zero', () => {
    const r = analyseSale({ ...base, chargedMinor: 0 });
    expect(Number.isFinite(r.netPercent)).toBe(true);
    expect(r.netPercent).toBe(0);
  });

  it('returns whole minor units everywhere', () => {
    const r = analyseSale({ ...base, chargedMinor: 123457, costs: [{ label: 'x', vendor: 'v', costKind: 'per_unit', amountMinor: 37, expectedUnits: 13.5, vendorDiscountBp: 333 }] });
    for (const v of [r.gstMinor, r.gatewayFeeMinor, r.gatewayFeeGstMinor, r.vendorCostMinor, r.netMinor]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe('priceForTarget', () => {
  it('hits the target with costs AND a discount in play', () => {
    const costs: CostLine[] = [{ label: 'WhatsApp', vendor: 'meta', costKind: 'per_unit', amountMinor: 80, expectedUnits: 100, vendorDiscountBp: 0 }];
    for (const disc of [0, 2000, 5000]) {
      const r = priceForTarget(50000, disc, { ...base, costs, monthsCovered: 1 });
      expect(r.achievedNetMinor, `${disc}bp`).toBeGreaterThanOrEqual(50000);
    }
  });

  it('demands a higher price through the costlier gateway', () => {
    const viaRazorpay = priceForTarget(50000, 0, { ...base, gateway: razorpay });
    const viaStripe = priceForTarget(50000, 0, { ...base, gateway: stripe, international: true });
    expect(viaStripe.chargedMinor).toBeGreaterThan(viaRazorpay.chargedMinor);
  });

  it('inflates the list price as the discount deepens, keeping net flat', () => {
    const a = priceForTarget(50000, 0, base);
    const b = priceForTarget(50000, 5000, base);
    expect(b.listMinor).toBeGreaterThan(a.listMinor * 1.9);
    expect(b.achievedNetMinor).toBeGreaterThanOrEqual(50000);
  });
});
