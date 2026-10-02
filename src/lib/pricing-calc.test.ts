import { describe, it, expect } from 'vitest';
import { calculatePricing, rupeesToPaise, percentToBp } from './pricing-calc';
import type { FloorPolicy } from './margin';

const policy: FloorPolicy = {
  minNetPaise: 5000,        // ₹50
  minNetBp: 6000,           // 60%
  gstRateBp: 1800,
  gatewayFeeBp: 200,
  gatewayFeeGstBp: 1800,
  hostingPerSalePaise: 50,
};

const calc = (o: Partial<Parameters<typeof calculatePricing>[0]> = {}) =>
  calculatePricing({ listRupees: '999', discountPercent: '0', targetNetRupees: '500', place: 'intra', policy, ...o });

describe('form field coercion', () => {
  it('never returns NaN or a negative from junk input', () => {
    // These are raw <input> values. An empty field mid-typing is normal, and a
    // NaN reaching the arithmetic would render "₹NaN" across the whole page.
    for (const v of ['', '   ', 'abc', '-5', '-0.01']) {
      expect(rupeesToPaise(v)).toBe(0);
      expect(percentToBp(v)).toBe(0);
    }
  });

  it('handles a partially typed decimal', () => {
    expect(rupeesToPaise('99.')).toBe(9900);
    expect(rupeesToPaise('0.5')).toBe(50);
  });

  it('clamps a discount to 100%', () => {
    expect(percentToBp('150')).toBe(10000);
    expect(percentToBp('100')).toBe(10000);
  });
});

describe('calculatePricing', () => {
  it('charges the list price when there is no discount', () => {
    const r = calc();
    expect(r.chargedP).toBe(99900);
    expect(r.savedP).toBe(0);
  });

  it('subtracts the rounded discount rather than rounding the result', () => {
    // 999 * 17% = 169.83 -> saving rounds to 16983 paise, charged is the
    // subtraction. Rounding the RESULT instead can show a saving a paisa away
    // from the one actually charged.
    const r = calc({ discountPercent: '17' });
    expect(r.savedP).toBe(16983);
    expect(r.chargedP).toBe(99900 - 16983);
    expect(r.savedP + r.chargedP).toBe(r.listP);   // must always hold
  });

  it('zero-rates an export, so GST is not deducted', () => {
    const intra = calc({ place: 'intra' });
    const exp = calc({ place: 'export' });
    expect(exp.gstRateBp).toBe(0);
    expect(exp.margin.gstPaise).toBe(0);
    // Same price, no tax to hand over -> strictly more is kept.
    expect(exp.margin.netPaise).toBeGreaterThan(intra.margin.netPaise);
  });

  it('treats inter-state and intra-state identically for what we keep', () => {
    // The split changes (IGST vs CGST+SGST); the total tax, and therefore our
    // cut, does not. A difference here would mean the calculator is wrong.
    expect(calc({ place: 'inter' }).margin.netPaise).toBe(calc({ place: 'intra' }).margin.netPaise);
  });

  it('never claims more was kept than was charged', () => {
    for (const d of ['0', '25', '50', '90', '100']) {
      const r = calc({ discountPercent: d });
      expect(r.margin.netPaise).toBeLessThanOrEqual(r.chargedP);
    }
  });

  it('fails the floor once the discount goes too deep', () => {
    expect(calc({ discountPercent: '0' }).floor.ok).toBe(true);
    expect(calc({ discountPercent: '95' }).floor.ok).toBe(false);
  });

  it('maxDiscountBp is the actual boundary, not an estimate', () => {
    const max = calc().maxDiscountBp;
    const atMax = calc({ discountPercent: String(max / 100) });
    expect(atMax.floor.ok).toBe(true);
    // One percentage point past it must fail, or the number is not a boundary.
    const past = calc({ discountPercent: String(max / 100 + 1) });
    expect(past.floor.ok).toBe(false);
  });

  it('grosses up so the target net is actually achieved', () => {
    // The whole point: raising a price raises the gateway's cut too, so you
    // cannot just add GST to what you want to keep.
    const r = calc({ targetNetRupees: '500' });
    expect(r.target.achievedNetPaise).toBeGreaterThanOrEqual(50000 - 2);
    expect(r.target.pricePaise).toBeGreaterThan(50000 * 1.18);
  });

  it('survives a zero price without dividing by zero', () => {
    const r = calc({ listRupees: '0', discountPercent: '50' });
    expect(Number.isFinite(r.chargedP)).toBe(true);
    expect(Number.isFinite(r.margin.netPercent)).toBe(true);
    expect(r.chargedP).toBe(0);
  });

  it('produces whole paise everywhere — no fractions of a paisa', () => {
    const r = calc({ listRupees: '1234.56', discountPercent: '13' });
    for (const v of [r.chargedP, r.savedP, r.margin.netPaise, r.margin.gstPaise,
                     r.margin.gatewayFeePaise, r.target.pricePaise]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});
